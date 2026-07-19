import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCouncilEvent,
  type CouncilEventMessage,
} from "@naetia/assembly-protocol";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { CouncilOrchestrator } from "../src/orchestration/council-orchestrator.js";
import { resolveAssemblyDatabasePath } from "../src/persistence/database-path.js";
import {
  SqliteEventJournal,
} from "../src/persistence/sqlite-event-journal.js";
import type { JournalError } from "../src/persistence/sqlite-event-journal.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.sequential("SQLite Council event journal", () => {
  it("persists and reloads a created session event", () => {
    const databasePath = temporaryDatabasePath();
    const event = sessionCreatedEvent();

    const firstJournal = new SqliteEventJournal(databasePath);
    expect(firstJournal.append(event)).toEqual({ sequence: 1, event });
    firstJournal.close();

    const secondJournal = new SqliteEventJournal(databasePath);
    expect(secondJournal.readAll()).toEqual([event]);
    expect(secondJournal.countEvents()).toBe(1);
    secondJournal.close();
  });

  it("deduplicates identical events and rejects identifier collisions", () => {
    const journal = new SqliteEventJournal(temporaryDatabasePath());
    const event = sessionCreatedEvent();
    expect(journal.append(event)).toEqual({ sequence: 1, event });
    expect(journal.append(event)).toBeUndefined();

    const collision = parseCouncilEvent({
      ...event,
      occurredAt: "2026-07-19T13:00:00.000Z",
    });
    expect(() => journal.append(collision)).toThrowError(
      expect.objectContaining<Partial<JournalError>>({
        code: "EVENT_ID_COLLISION",
      }),
    );
    expect(journal.countEvents()).toBe(1);
    journal.close();
  });

  it("rolls back an event batch when one identifier collides", () => {
    const journal = new SqliteEventJournal(temporaryDatabasePath());
    const existing = sessionCreatedEvent();
    journal.append(existing);
    const newSession = sessionCreatedEvent();
    const collision = parseCouncilEvent({
      ...existing,
      occurredAt: "2026-07-19T14:00:00.000Z",
    });

    expect(() => journal.appendMany([newSession, collision])).toThrowError(
      expect.objectContaining<Partial<JournalError>>({
        code: "EVENT_ID_COLLISION",
      }),
    );
    expect(journal.readAll()).toEqual([existing]);
    journal.close();
  });

  it("marks a non-terminal run as failed when the daemon restarts", async () => {
    const databasePath = temporaryDatabasePath();
    const created = sessionCreatedEvent();
    const runId = randomUUID();
    const definition = {
      id: "architect.v1",
      role: "architect",
      name: "Architect",
      perspective: "Structure et clarifie.",
      instructions: "Trouve le prochain geste.",
      version: 1,
    } as const;
    const journal = new SqliteEventJournal(databasePath);
    journal.appendMany([
      created,
      parseCouncilEvent({
        id: randomUUID(),
        type: "session.convened",
        sessionId: created.sessionId,
        occurredAt: "2026-07-19T12:00:01.000Z",
        payload: { agentDefinitions: [definition] },
      }),
      parseCouncilEvent({
        id: randomUUID(),
        type: "agent_run.spawned",
        sessionId: created.sessionId,
        runId,
        occurredAt: "2026-07-19T12:00:02.000Z",
        payload: {
          run: {
            id: runId,
            sessionId: created.sessionId,
            agentDefinitionId: definition.id,
            status: "pending",
          },
        },
      }),
      parseCouncilEvent({
        id: randomUUID(),
        type: "agent_run.started",
        sessionId: created.sessionId,
        runId,
        occurredAt: "2026-07-19T12:00:03.000Z",
        payload: { processId: 99_999 },
      }),
      parseCouncilEvent({
        id: randomUUID(),
        type: "agent_run.status_changed",
        sessionId: created.sessionId,
        runId,
        occurredAt: "2026-07-19T12:00:04.000Z",
        payload: { previousStatus: "starting", status: "running" },
      }),
      parseCouncilEvent({
        id: randomUUID(),
        type: "contribution.delta",
        sessionId: created.sessionId,
        runId,
        occurredAt: "2026-07-19T12:00:05.000Z",
        payload: {
          contributionId: randomUUID(),
          delta: "Fragment conservé avant l’arrêt.",
          index: 0,
        },
      }),
    ]);
    journal.close();

    const orchestrator = new CouncilOrchestrator({
      journal: new SqliteEventJournal(databasePath),
    });
    const recovered = orchestrator.getSession(created.sessionId);
    expect(recovered?.runs[0]).toMatchObject({
      runId,
      status: "failed",
      contribution: "Fragment conservé avant l’arrêt.",
      error: { code: "DAEMON_RESTARTED" },
    });
    expect(recovered?.runs[0]?.pid).toBeUndefined();
    await orchestrator.close();

    const verificationJournal = new SqliteEventJournal(databasePath);
    expect(
      verificationJournal
        .readAll()
        .filter((event) => event.type === "agent_run.failed"),
    ).toHaveLength(1);
    verificationJournal.close();
  });

  it("applies the initial migration idempotently", () => {
    const databasePath = temporaryDatabasePath();
    new SqliteEventJournal(databasePath).close();
    const reopened = new SqliteEventJournal(databasePath);
    expect(reopened.countEvents()).toBe(0);
    reopened.close();
  });

  it("reads only one session after an exclusive sequence cursor", () => {
    const journal = new SqliteEventJournal(temporaryDatabasePath());
    const firstSession = sessionCreatedEvent();
    const otherSession = sessionCreatedEvent();
    const firstEntry = journal.append(firstSession);
    journal.append(otherSession);
    const laterEvent = parseCouncilEvent({
      id: randomUUID(),
      type: "session.convened",
      sessionId: firstSession.sessionId,
      occurredAt: "2026-07-19T12:00:01.000Z",
      payload: {
        agentDefinitions: [
          {
            id: "architect.v1",
            role: "architect",
            name: "Architect",
            perspective: "Structure.",
            instructions: "Clarifie.",
            version: 1,
          },
        ],
      },
    });
    const laterEntry = journal.append(laterEvent);

    expect(firstEntry?.sequence).toBe(1);
    expect(laterEntry?.sequence).toBe(3);
    expect(journal.readSessionEventsAfter(firstSession.sessionId, 1)).toEqual([
      laterEntry,
    ]);
    expect(journal.latestSequence(firstSession.sessionId)).toBe(3);
    journal.close();
  });

  it("allows only one live Assembly owner for a file journal", () => {
    const databasePath = temporaryDatabasePath();
    const owner = new SqliteEventJournal(databasePath);
    expect(() => new SqliteEventJournal(databasePath)).toThrowError(
      expect.objectContaining<Partial<JournalError>>({
        code: "PERSISTENCE_UNAVAILABLE",
      }),
    );
    owner.close();

    expect(() => new SqliteEventJournal(databasePath).close()).not.toThrow();
  });

  it("resolves configured relative database paths from the repository root", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(resolveAssemblyDatabasePath("data/custom.sqlite")).toBe(
      resolve(repositoryRoot, "data/custom.sqlite"),
    );
  });

  it("refuses a serialized event that does not satisfy the protocol", () => {
    const databasePath = temporaryDatabasePath();
    new SqliteEventJournal(databasePath).close();
    const rawDatabase = new Database(databasePath);
    rawDatabase
      .prepare(`
        INSERT INTO council_events (
          event_id,
          session_id,
          type,
          occurred_at,
          event_json
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        randomUUID(),
        "session.created",
        "2026-07-19T12:00:00.000Z",
        JSON.stringify({ invalid: true }),
      );
    rawDatabase.close();

    const journal = new SqliteEventJournal(databasePath);
    expect(() => journal.readAll()).toThrowError(
      expect.objectContaining<Partial<JournalError>>({
        code: "CORRUPT_JOURNAL",
      }),
    );
    journal.close();
  });
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "naetia-council-"));
  temporaryDirectories.push(directory);
  return join(directory, "assembly.sqlite");
}

function sessionCreatedEvent(): CouncilEventMessage {
  const sessionId = randomUUID();
  const questId = randomUUID();
  const occurredAt = "2026-07-19T12:00:00.000Z";
  return parseCouncilEvent({
    id: randomUUID(),
    type: "session.created",
    sessionId,
    occurredAt,
    payload: {
      quest: {
        id: questId,
        title: "Retrouver le Council",
        context: "Après un redémarrage",
        createdAt: occurredAt,
      },
      session: {
        id: sessionId,
        questId,
        status: "draft",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    },
  });
}
