import { randomUUID } from "node:crypto";

import type {
  AgentRole,
  AgentRunStatus,
} from "@naetia/assembly-domain";
import type { AgentWorkerEvent } from "@naetia/assembly-protocol";

import {
  AgentProcessManager,
  type RunSnapshot,
} from "../process-manager/process-manager.js";

const COUNCIL_AGENTS = ["architect", "trickster", "guardian"] as const satisfies readonly AgentRole[];
const TERMINAL_STATUSES = new Set<AgentRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export interface QuestSnapshot {
  readonly questId: string;
  readonly title: string;
  readonly context?: string;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly status: "created" | "running" | "completed";
  readonly createdAt: string;
  readonly runs: readonly RunSnapshot[];
  readonly events: readonly AgentWorkerEvent[];
}

export interface RunBehavior {
  readonly latencyMs?: number;
  readonly failAtDelta?: number;
  readonly crashAtDelta?: number;
  readonly empty?: boolean;
  readonly timeoutMs?: number;
}

export interface ConveneOptions {
  readonly behaviorByAgent?: Readonly<Partial<Record<AgentRole, RunBehavior>>>;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly createdAt: string;
  readonly runIds: string[];
  readonly events: AgentWorkerEvent[];
  readonly eventIds: Set<string>;
}

export class CouncilOrchestrator {
  readonly #processManager: AgentProcessManager;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #runToSession = new Map<string, string>();
  readonly #unsubscribe: () => void;

  constructor(processManager = new AgentProcessManager()) {
    this.#processManager = processManager;
    this.#unsubscribe = processManager.onEvent((event) => {
      const session = this.#sessions.get(event.sessionId);
      if (session === undefined || session.eventIds.has(event.eventId)) {
        return;
      }
      session.eventIds.add(event.eventId);
      session.events.push(event);
    });
  }

  createSession(quest: Readonly<{ title: string; context?: string }>): SessionSnapshot {
    const sessionId = randomUUID();
    const session: SessionRecord = {
      sessionId,
      quest: {
        questId: randomUUID(),
        title: quest.title,
        ...(quest.context === undefined ? {} : { context: quest.context }),
      },
      createdAt: new Date().toISOString(),
      runIds: [],
      events: [],
      eventIds: new Set(),
    };
    this.#sessions.set(sessionId, session);
    return this.#snapshot(session);
  }

  convene(sessionId: string, options: ConveneOptions = {}): SessionSnapshot | undefined {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    if (session.runIds.length > 0) {
      return this.#snapshot(session);
    }

    for (const agentId of COUNCIL_AGENTS) {
      const runId = randomUUID();
      const behavior = options.behaviorByAgent?.[agentId];
      session.runIds.push(runId);
      this.#runToSession.set(runId, sessionId);
      this.#processManager.spawn({
        runId,
        sessionId,
        agentId,
        quest: {
          title: session.quest.title,
          ...(session.quest.context === undefined
            ? {}
            : { context: session.quest.context }),
        },
        ...(behavior === undefined
          ? {}
          : {
              model: {
                ...(behavior.latencyMs === undefined
                  ? {}
                  : { latencyMs: behavior.latencyMs }),
                ...(behavior.failAtDelta === undefined
                  ? {}
                  : { failAtDelta: behavior.failAtDelta }),
                ...(behavior.crashAtDelta === undefined
                  ? {}
                  : { crashAtDelta: behavior.crashAtDelta }),
                ...(behavior.empty === undefined
                  ? {}
                  : { empty: behavior.empty }),
              },
              ...(behavior.timeoutMs === undefined
                ? {}
                : { timeoutMs: behavior.timeoutMs }),
            }),
      });
    }

    return this.#snapshot(session);
  }

  getSession(sessionId: string): SessionSnapshot | undefined {
    const session = this.#sessions.get(sessionId);
    return session === undefined ? undefined : this.#snapshot(session);
  }

  cancelRun(runId: string): RunSnapshot | undefined {
    if (!this.#runToSession.has(runId)) {
      return undefined;
    }
    return this.#processManager.cancel(runId);
  }

  async close(): Promise<void> {
    this.#unsubscribe();
    await this.#processManager.close();
  }

  #snapshot(session: SessionRecord): SessionSnapshot {
    const runs = session.runIds
      .map((runId) => this.#processManager.get(runId))
      .filter((run): run is RunSnapshot => run !== undefined);

    return {
      sessionId: session.sessionId,
      quest: { ...session.quest },
      status: sessionStatus(runs),
      createdAt: session.createdAt,
      runs,
      events: session.events.map((event) => structuredClone(event)),
    };
  }
}

function sessionStatus(
  runs: readonly RunSnapshot[],
): "created" | "running" | "completed" {
  if (runs.length === 0) {
    return "created";
  }
  return runs.every((run) => TERMINAL_STATUSES.has(run.status))
    ? "completed"
    : "running";
}
