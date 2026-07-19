import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import {
  parseCouncilEvent,
  type CouncilEventMessage,
} from "@naetia/assembly-protocol";

const SCHEMA_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type JournalErrorCode =
  | "CORRUPT_JOURNAL"
  | "EVENT_ID_COLLISION"
  | "PERSISTENCE_UNAVAILABLE"
  | "UNSUPPORTED_SCHEMA";

export class JournalError extends Error {
  readonly code: JournalErrorCode;

  constructor(code: JournalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JournalError";
    this.code = code;
  }
}

export interface SqliteEventJournalOptions {
  readonly busyTimeoutMs?: number;
}

export class SqliteEventJournal {
  readonly #database: Database.Database;
  readonly #ownerFilePath: string | undefined;

  constructor(
    databasePath: string,
    options: SqliteEventJournalOptions = {},
  ) {
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error("busyTimeoutMs must be a non-negative integer");
    }

    let database: Database.Database | undefined;
    let ownerFilePath: string | undefined;
    try {
      if (databasePath !== ":memory:") {
        mkdirSync(dirname(databasePath), { recursive: true });
        ownerFilePath = acquireOwnership(databasePath);
      }
      database = new Database(databasePath);
      database.pragma("foreign_keys = ON");
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
      database.pragma(`busy_timeout = ${String(busyTimeoutMs)}`);
      this.#database = database;
      this.#ownerFilePath = ownerFilePath;
      this.#migrate();
    } catch (error) {
      if (database?.open === true) {
        database.close();
      }
      if (ownerFilePath !== undefined) {
        releaseOwnership(ownerFilePath);
      }
      throw asJournalError(error, "Unable to open the Assembly event journal");
    }
  }

  append(event: CouncilEventMessage): boolean {
    return this.appendMany([event]).length === 1;
  }

  appendMany(candidates: readonly CouncilEventMessage[]): readonly CouncilEventMessage[] {
    const events = candidates.map((candidate) => parseCouncilEvent(candidate));
    try {
      const findById = this.#database.prepare(
        "SELECT event_json FROM council_events WHERE event_id = ?",
      );
      const insert = this.#database.prepare(`
        INSERT INTO council_events (
          event_id,
          session_id,
          run_id,
          type,
          occurred_at,
          event_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const appendTransaction = this.#database.transaction(() => {
        const inserted: CouncilEventMessage[] = [];
        for (const event of events) {
          const eventJson = JSON.stringify(event);
          const existing = findById.get(event.id) as
            | Readonly<{ event_json: string }>
            | undefined;
          if (existing !== undefined) {
            if (existing.event_json !== eventJson) {
              throw new JournalError(
                "EVENT_ID_COLLISION",
                `Event ${event.id} already exists with different content`,
              );
            }
            continue;
          }

          insert.run(
            event.id,
            event.sessionId,
            "runId" in event ? event.runId : null,
            event.type,
            event.occurredAt,
            eventJson,
          );
          inserted.push(event);
        }
        return inserted;
      });

      return appendTransaction();
    } catch (error) {
      if (error instanceof JournalError) {
        throw error;
      }
      throw asJournalError(error, "Unable to append Council events");
    }
  }

  readAll(): readonly CouncilEventMessage[] {
    try {
      const rows = this.#database
        .prepare("SELECT event_json FROM council_events ORDER BY sequence ASC")
        .all() as readonly Readonly<{ event_json: string }>[];

      return rows.map((row) => {
        try {
          return parseCouncilEvent(JSON.parse(row.event_json));
        } catch (error) {
          throw new JournalError(
            "CORRUPT_JOURNAL",
            "The Assembly event journal contains an invalid event",
            { cause: error },
          );
        }
      });
    } catch (error) {
      if (error instanceof JournalError) {
        throw error;
      }
      throw asJournalError(error, "Unable to read Council events");
    }
  }

  countEvents(): number {
    try {
      const row = this.#database
        .prepare("SELECT COUNT(*) AS count FROM council_events")
        .get() as Readonly<{ count: number }>;
      return row.count;
    } catch (error) {
      throw asJournalError(error, "Unable to count Council events");
    }
  }

  close(): void {
    if (this.#database.open) {
      this.#database.close();
    }
    if (this.#ownerFilePath !== undefined) {
      releaseOwnership(this.#ownerFilePath);
    }
  }

  #migrate(): void {
    const currentVersion = this.#database.pragma("user_version", {
      simple: true,
    }) as number;
    if (currentVersion === SCHEMA_VERSION) {
      return;
    }
    if (currentVersion !== 0) {
      throw new JournalError(
        "UNSUPPORTED_SCHEMA",
        `Unsupported Assembly journal schema version ${String(currentVersion)}`,
      );
    }

    const migration = readFileSync(
      new URL("../../migrations/0001_event_journal.sql", import.meta.url),
      "utf8",
    );
    const migrate = this.#database.transaction(() => {
      this.#database.exec(migration);
      this.#database.pragma(`user_version = ${String(SCHEMA_VERSION)}`);
    });
    migrate();
  }
}

function acquireOwnership(databasePath: string): string {
  const ownerFilePath = `${databasePath}-owner`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = openSync(ownerFilePath, "wx", 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid }), "utf8");
      } finally {
        closeSync(descriptor);
      }
      return ownerFilePath;
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }
      const ownerPid = readOwnerPid(ownerFilePath);
      if (ownerPid !== undefined && isProcessAlive(ownerPid)) {
        throw new JournalError(
          "PERSISTENCE_UNAVAILABLE",
          `The Assembly journal is already owned by process ${String(ownerPid)}`,
        );
      }
      try {
        unlinkSync(ownerFilePath);
      } catch (unlinkError) {
        if (!isFileMissingError(unlinkError)) {
          throw unlinkError;
        }
      }
    }
  }
  throw new JournalError(
    "PERSISTENCE_UNAVAILABLE",
    "Unable to acquire ownership of the Assembly journal",
  );
}

function releaseOwnership(ownerFilePath: string): void {
  if (readOwnerPid(ownerFilePath) !== process.pid) {
    return;
  }
  try {
    unlinkSync(ownerFilePath);
  } catch (error) {
    if (!isFileMissingError(error)) {
      throw error;
    }
  }
}

function readOwnerPid(ownerFilePath: string): number | undefined {
  try {
    const candidate = JSON.parse(readFileSync(ownerFilePath, "utf8")) as unknown;
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "pid" in candidate &&
      typeof candidate.pid === "number" &&
      Number.isInteger(candidate.pid) &&
      candidate.pid > 0
    ) {
      return candidate.pid;
    }
  } catch (error) {
    if (!isFileMissingError(error)) {
      return undefined;
    }
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function asJournalError(error: unknown, message: string): JournalError {
  if (error instanceof JournalError) {
    return error;
  }
  return new JournalError("PERSISTENCE_UNAVAILABLE", message, { cause: error });
}
