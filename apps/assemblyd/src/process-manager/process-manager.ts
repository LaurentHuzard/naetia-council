import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  agentWorkerCommandSchema,
  agentWorkerEventSchema,
  type AgentWorkerEvent,
} from "@naetia/assembly-protocol";
import type { AgentRole, AgentRunStatus } from "@naetia/assembly-domain";

const TERMINAL_STATUSES = new Set<AgentRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);
const DEFAULT_TIMEOUT_MS = 10_000;
const FORCE_KILL_GRACE_MS = 250;

export interface SpawnRunInput {
  readonly runId: string;
  readonly sessionId: string;
  readonly agentId: AgentRole;
  readonly quest: Readonly<{ title: string; context?: string }>;
  readonly model?: Readonly<{
    latencyMs?: number;
    failAtDelta?: number;
    crashAtDelta?: number;
    empty?: boolean;
  }>;
  readonly timeoutMs?: number;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly sessionId: string;
  readonly agentId: AgentRole;
  readonly status: AgentRunStatus;
  readonly pid: number;
  readonly contribution: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: Readonly<{ code: string; message: string }>;
}

interface MutableRun {
  runId: string;
  sessionId: string;
  agentId: AgentRole;
  status: AgentRunStatus;
  pid: number;
  contribution: string;
  nextDeltaIndex: number;
  startedAt?: string;
  completedAt?: string;
  error?: Readonly<{ code: string; message: string }>;
  child: ChildProcess;
  timeout: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

export interface ProcessManagerOptions {
  readonly workerPath?: string;
  readonly workerExecArgv?: readonly string[];
  readonly defaultTimeoutMs?: number;
}

export class AgentProcessManager {
  readonly #events = new EventEmitter();
  readonly #runs = new Map<string, MutableRun>();
  readonly #eventIds = new Set<string>();
  readonly #workerPath: string;
  readonly #workerExecArgv: readonly string[];
  readonly #defaultTimeoutMs: number;

  constructor(options: ProcessManagerOptions = {}) {
    this.#workerPath = options.workerPath ?? resolveWorkerPath();
    this.#workerExecArgv = options.workerExecArgv ?? [];
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  onEvent(listener: (event: AgentWorkerEvent) => void): () => void {
    this.#events.on("event", listener);
    return () => this.#events.off("event", listener);
  }

  spawn(input: SpawnRunInput): RunSnapshot {
    if (this.#runs.has(input.runId)) {
      throw new Error(`Run ${input.runId} already exists`);
    }

    const child = fork(this.#workerPath, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
      execArgv: [...this.#workerExecArgv],
      env: {
        NODE_ENV: process.env["NODE_ENV"] ?? "development",
      },
    });
    if (child.pid === undefined) {
      child.kill();
      throw new Error("The agent worker did not receive a process id");
    }

    const run: MutableRun = {
      runId: input.runId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      status: "pending",
      pid: child.pid,
      contribution: "",
      nextDeltaIndex: 0,
      child,
      timeout: setTimeout(
        () => this.#timeoutRun(input.runId),
        input.timeoutMs ?? this.#defaultTimeoutMs,
      ),
    };
    this.#runs.set(input.runId, run);

    child.on("message", (rawMessage: unknown) => {
      this.#handleWorkerMessage(run, rawMessage);
    });
    child.once("error", (error) => {
      this.#failRun(run, "CHILD_PROCESS_ERROR", error.message);
    });
    child.once("exit", (code, signal) => {
      this.#handleExit(run, code, signal);
    });

    const command = agentWorkerCommandSchema.parse({
      type: "start",
      runId: input.runId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      quest: input.quest,
    ...(input.model === undefined ? {} : { model: input.model }),
    });
    child.send(command);

    return snapshot(run);
  }

  get(runId: string): RunSnapshot | undefined {
    const run = this.#runs.get(runId);
    return run === undefined ? undefined : snapshot(run);
  }

  cancel(runId: string): RunSnapshot | undefined {
    const run = this.#runs.get(runId);
    if (run === undefined || TERMINAL_STATUSES.has(run.status)) {
      return run === undefined ? undefined : snapshot(run);
    }

    this.#emitStatus(run, "cancelling");
    const command = agentWorkerCommandSchema.parse({ type: "cancel", runId });
    if (run.child.connected) {
      run.child.send(command);
    }
    run.killTimer = setTimeout(() => {
      if (!TERMINAL_STATUSES.has(run.status)) {
        run.child.kill("SIGTERM");
      }
    }, FORCE_KILL_GRACE_MS);

    return snapshot(run);
  }

  async close(): Promise<void> {
    const liveRuns = [...this.#runs.values()].filter(
      (run) => !TERMINAL_STATUSES.has(run.status),
    );
    for (const run of liveRuns) {
      this.cancel(run.runId);
    }
    await Promise.all(liveRuns.map((run) => waitForExit(run.child)));
  }

  #handleWorkerMessage(run: MutableRun, rawMessage: unknown): void {
    const parsed = agentWorkerEventSchema.safeParse(rawMessage);
    if (!parsed.success) {
      this.#failRun(run, "INVALID_IPC", "Agent emitted an invalid IPC event");
      run.child.kill("SIGTERM");
      return;
    }

    const event = parsed.data;
    if (event.runId !== run.runId || event.sessionId !== run.sessionId) {
      this.#failRun(run, "INVALID_IPC", "Agent event identity did not match its run");
      run.child.kill("SIGTERM");
      return;
    }

    if (this.#eventIds.has(event.eventId)) {
      return;
    }
    this.#eventIds.add(event.eventId);

    if (TERMINAL_STATUSES.has(run.status)) {
      return;
    }

    if (event.type === "status") {
      if (
        run.status === "cancelling" &&
        (event.status === "starting" || event.status === "running")
      ) {
        return;
      }
      if (!isValidStatusTransition(run.status, event.status)) {
        this.#failRun(
          run,
          "INVALID_IPC",
          `Invalid run transition from ${run.status} to ${event.status}`,
        );
        run.child.kill("SIGTERM");
        return;
      }
      if (
        event.status === "completed" &&
        run.contribution.trim().length === 0
      ) {
        this.#failRun(run, "EMPTY_CONTRIBUTION", "Agent completed without content");
        run.child.kill("SIGTERM");
        return;
      }
      run.status = event.status;
      if (event.status === "running" && run.startedAt === undefined) {
        run.startedAt = event.occurredAt;
      }
      if (TERMINAL_STATUSES.has(event.status)) {
        run.completedAt = event.occurredAt;
        clearRunTimers(run);
      }
    } else if (event.type === "delta") {
      if (event.index !== run.nextDeltaIndex) {
        this.#failRun(
          run,
          "INVALID_IPC",
          `Expected contribution delta ${run.nextDeltaIndex}, received ${event.index}`,
        );
        run.child.kill("SIGTERM");
        return;
      }
      run.contribution += event.delta;
      run.nextDeltaIndex += 1;
    } else if (event.type === "completed") {
      if (event.content.trim().length === 0) {
        this.#failRun(run, "EMPTY_CONTRIBUTION", "Agent completed without content");
        run.child.kill("SIGTERM");
        return;
      }
      run.contribution = event.content;
    } else {
      run.status = "failed";
      run.error = event.error;
      run.completedAt = event.occurredAt;
      clearRunTimers(run);
    }

    this.#events.emit("event", event);
  }

  #handleExit(
    run: MutableRun,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (!TERMINAL_STATUSES.has(run.status)) {
      const suffix = signal === null ? `code ${String(code)}` : `signal ${signal}`;
      this.#failRun(run, "CHILD_EXIT", `Agent process exited unexpectedly (${suffix})`);
    }
    clearRunTimers(run);
  }

  #timeoutRun(runId: string): void {
    const run = this.#runs.get(runId);
    if (run === undefined || TERMINAL_STATUSES.has(run.status)) {
      return;
    }

    this.#failRun(run, "RUN_TIMEOUT", "Agent run exceeded its time budget");
    run.child.kill("SIGTERM");
  }

  #failRun(run: MutableRun, code: string, message: string): void {
    if (TERMINAL_STATUSES.has(run.status)) {
      return;
    }

    const event = agentWorkerEventSchema.parse({
      type: "failed",
      eventId: randomUUID(),
      sessionId: run.sessionId,
      runId: run.runId,
      occurredAt: new Date().toISOString(),
      error: { code, message },
    });
    run.status = "failed";
    run.error = { code, message };
    run.completedAt = event.occurredAt;
    clearRunTimers(run);
    this.#eventIds.add(event.eventId);
    this.#events.emit("event", event);
  }

  #emitStatus(run: MutableRun, status: AgentRunStatus): void {
    const event = agentWorkerEventSchema.parse({
      type: "status",
      eventId: randomUUID(),
      sessionId: run.sessionId,
      runId: run.runId,
      occurredAt: new Date().toISOString(),
      status,
    });
    run.status = status;
    this.#eventIds.add(event.eventId);
    this.#events.emit("event", event);
  }
}

function snapshot(run: MutableRun): RunSnapshot {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    agentId: run.agentId,
    status: run.status,
    pid: run.pid,
    contribution: run.contribution,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    ...(run.error === undefined ? {} : { error: { ...run.error } }),
  };
}

function resolveWorkerPath(): string {
  const besideModule = fileURLToPath(new URL("./agent-worker.js", import.meta.url));
  if (existsSync(besideModule)) {
    return besideModule;
  }

  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../dist/process-manager/agent-worker.js",
  );
}

function isValidStatusTransition(
  current: AgentRunStatus,
  next: AgentRunStatus,
): boolean {
  const transitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
    pending: ["starting", "cancelling"],
    starting: ["running", "cancelling"],
    running: ["completed", "cancelling"],
    cancelling: ["cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return transitions[current].includes(next);
}

function clearRunTimers(run: MutableRun): void {
  clearTimeout(run.timeout);
  if (run.killTimer !== undefined) {
    clearTimeout(run.killTimer);
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => child.once("exit", () => resolvePromise()));
}
