import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type {
  AgentDefinition,
  AgentRole,
  AgentRunStatus,
  Quest,
} from "@naetia/assembly-domain";
import {
  parseCouncilEvent,
  type AgentWorkerEvent,
  type CouncilEventMessage,
} from "@naetia/assembly-protocol";

import {
  JournalError,
  SqliteEventJournal,
  type JournalEntry,
} from "../persistence/sqlite-event-journal.js";
import {
  AgentProcessManager,
  type RunSnapshot as LiveRunSnapshot,
} from "../process-manager/process-manager.js";

const TERMINAL_STATUSES = new Set<AgentRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const COUNCIL_AGENT_DEFINITIONS = [
  {
    id: "architect.v1",
    role: "architect",
    name: "Architect",
    perspective: "Structure et clarifie la quête.",
    instructions: "Dégage la structure, les choix et le prochain geste vérifiable.",
    version: 1,
  },
  {
    id: "trickster.v1",
    role: "trickster",
    name: "Trickster",
    perspective: "Challenge les prémisses de la quête.",
    instructions: "Cherche l’hypothèse fragile et prouve la même valeur avec moins.",
    version: 1,
  },
  {
    id: "guardian.v1",
    role: "guardian",
    name: "Guardian",
    perspective: "Détecte les risques et la surcharge.",
    instructions: "Protège le contrôle humain, le budget et la possibilité de revenir.",
    version: 1,
  },
] as const satisfies readonly AgentDefinition[];

export interface QuestSnapshot {
  readonly questId: string;
  readonly title: string;
  readonly context?: string;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly sessionId: string;
  readonly agentId: AgentRole;
  readonly agentDefinitionId: string;
  readonly status: AgentRunStatus;
  readonly pid?: number;
  readonly contribution: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: Readonly<{ code: string; message: string }>;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly status: "created" | "running" | "completed";
  readonly createdAt: string;
  readonly eventCursor: number;
  readonly runs: readonly RunSnapshot[];
  readonly events: readonly CouncilEventMessage[];
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

export interface CouncilOrchestratorOptions {
  readonly processManager?: AgentProcessManager;
  readonly journal?: SqliteEventJournal;
}

interface MutableRunProjection {
  runId: string;
  sessionId: string;
  agentId: AgentRole;
  agentDefinitionId: string;
  status: AgentRunStatus;
  pid?: number;
  contribution: string;
  contributionId?: string;
  contributionCreatedAt?: string;
  nextDeltaIndex: number;
  startedAt?: string;
  completedAt?: string;
  error?: Readonly<{ code: string; message: string }>;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly createdAt: string;
  readonly agentDefinitions: Map<string, AgentDefinition>;
  readonly runs: Map<string, MutableRunProjection>;
  readonly events: CouncilEventMessage[];
  readonly eventIds: Set<string>;
}

export class CouncilOrchestrator {
  readonly #processManager: AgentProcessManager;
  readonly #journal: SqliteEventJournal;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #runToSession = new Map<string, string>();
  readonly #persistenceFailedRuns = new Set<string>();
  readonly #publishedEvents = new EventEmitter();
  readonly #unsubscribe: () => void;
  #fatalPersistenceError: JournalError | undefined;

  constructor(options: CouncilOrchestratorOptions = {}) {
    this.#processManager = options.processManager ?? new AgentProcessManager();
    this.#journal = options.journal ?? new SqliteEventJournal(":memory:");
    this.#publishedEvents.setMaxListeners(0);

    try {
      for (const event of this.#journal.readAll()) {
        this.#apply(event);
      }
      for (const session of this.#sessions.values()) {
        for (const run of session.runs.values()) {
          delete run.pid;
        }
      }
      this.#reconcileInterruptedRuns();
    } catch (error) {
      this.#journal.close();
      throw error;
    }

    this.#unsubscribe = this.#processManager.onEvent((event) => {
      this.#handleWorkerEvent(event);
    });
  }

  createSession(questInput: Readonly<{ title: string; context?: string }>): SessionSnapshot {
    this.#assertPersistenceAvailable();
    const occurredAt = new Date().toISOString();
    const sessionId = randomUUID();
    const quest: Quest = {
      id: randomUUID(),
      title: questInput.title,
      ...(questInput.context === undefined ? {} : { context: questInput.context }),
      createdAt: occurredAt,
    };
    const event = parseCouncilEvent({
      id: randomUUID(),
      type: "session.created",
      sessionId,
      occurredAt,
      payload: {
        quest,
        session: {
          id: sessionId,
          questId: quest.id,
          status: "draft",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      },
    });

    this.#persistAndApply(event);
    return this.#snapshot(this.#requireSession(sessionId));
  }

  convene(sessionId: string, options: ConveneOptions = {}): SessionSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    if (session.runs.size > 0) {
      return this.#snapshot(session);
    }

    const occurredAt = new Date().toISOString();
    const preparedRuns = COUNCIL_AGENT_DEFINITIONS.map((definition) => ({
      definition,
      runId: randomUUID(),
    }));
    const preparedEvents: CouncilEventMessage[] = [
      parseCouncilEvent({
        id: randomUUID(),
        type: "session.convened",
        sessionId,
        occurredAt,
        payload: { agentDefinitions: COUNCIL_AGENT_DEFINITIONS },
      }),
      ...preparedRuns.map(({ definition, runId }) =>
        parseCouncilEvent({
          id: randomUUID(),
          type: "agent_run.spawned",
          sessionId,
          runId,
          occurredAt,
          payload: {
            run: {
              id: runId,
              sessionId,
              agentDefinitionId: definition.id,
              status: "pending",
            },
          },
        }),
      ),
    ];

    const inserted = this.#journal.appendMany(preparedEvents);
    for (const entry of inserted) {
      this.#applyCommitted(entry);
    }

    for (const { definition, runId } of preparedRuns) {
      const behavior = options.behaviorByAgent?.[definition.role];
      let liveRun: LiveRunSnapshot;
      try {
        liveRun = this.#processManager.spawn({
          runId,
          sessionId,
          agentId: definition.role,
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
      } catch (error) {
        this.#persistAndApply(
          parseCouncilEvent({
            id: randomUUID(),
            type: "agent_run.failed",
            sessionId,
            runId,
            occurredAt: new Date().toISOString(),
            payload: {
              failure: {
                code: "SPAWN_FAILED",
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to spawn the agent process",
              },
            },
          }),
        );
        continue;
      }

      try {
        this.#persistAndApply(
          parseCouncilEvent({
            id: randomUUID(),
            type: "agent_run.started",
            sessionId,
            runId,
            occurredAt: new Date().toISOString(),
            payload: { processId: liveRun.pid },
          }),
        );
      } catch (error) {
        this.#processManager.cancel(runId);
        throw error;
      }
    }

    return this.#snapshot(session);
  }

  getSession(sessionId: string): SessionSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const session = this.#sessions.get(sessionId);
    return session === undefined ? undefined : this.#snapshot(session);
  }

  cancelRun(runId: string): RunSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const sessionId = this.#runToSession.get(runId);
    if (sessionId === undefined) {
      return undefined;
    }
    const session = this.#sessions.get(sessionId);
    const run = session?.runs.get(runId);
    if (run === undefined || TERMINAL_STATUSES.has(run.status)) {
      return run === undefined ? undefined : runSnapshot(run);
    }

    const liveRun = this.#processManager.cancel(runId);
    return liveRun === undefined ? undefined : runSnapshot(run);
  }

  async close(): Promise<void> {
    await this.#processManager.close();
    this.#unsubscribe();
    this.#publishedEvents.removeAllListeners();
    this.#journal.close();
  }

  assertPersistenceAvailable(): void {
    this.#assertPersistenceAvailable();
  }

  getSessionEventsAfter(
    sessionId: string,
    sequence: number,
  ): readonly JournalEntry[] {
    this.#assertPersistenceAvailable();
    return this.#journal.readSessionEventsAfter(sessionId, sequence);
  }

  onSessionEvent(
    sessionId: string,
    listener: (entry: JournalEntry) => void,
  ): () => void {
    const eventName = sessionEventName(sessionId);
    const safeListener = (entry: JournalEntry): void => {
      try {
        listener(entry);
      } catch {
        // A disconnected transport must never affect the durable orchestrator.
      }
    };
    this.#publishedEvents.on(eventName, safeListener);
    return () => this.#publishedEvents.off(eventName, safeListener);
  }

  #handleWorkerEvent(workerEvent: AgentWorkerEvent): void {
    if (
      this.#fatalPersistenceError !== undefined ||
      this.#persistenceFailedRuns.has(workerEvent.runId)
    ) {
      return;
    }
    const event = this.#normalizeWorkerEvent(workerEvent);
    if (event === undefined) {
      return;
    }

    let inserted: JournalEntry | undefined;
    try {
      inserted = this.#journal.append(event);
    } catch (error) {
      if (!(error instanceof JournalError)) {
        throw error;
      }
      this.#fatalPersistenceError = error;
      this.#persistenceFailedRuns.add(workerEvent.runId);
      this.#processManager.cancel(workerEvent.runId);
      return;
    }
    if (inserted !== undefined) {
      this.#applyCommitted(inserted);
    }
  }

  #normalizeWorkerEvent(workerEvent: AgentWorkerEvent): CouncilEventMessage | undefined {
    const session = this.#sessions.get(workerEvent.sessionId);
    const run = session?.runs.get(workerEvent.runId);
    if (session === undefined || run === undefined) {
      return undefined;
    }

    if (workerEvent.type === "status") {
      if (workerEvent.status === "starting") {
        return undefined;
      }
      if (workerEvent.status === "completed") {
        return parseCouncilEvent({
          id: workerEvent.eventId,
          type: "agent_run.completed",
          sessionId: workerEvent.sessionId,
          runId: workerEvent.runId,
          occurredAt: workerEvent.occurredAt,
          payload: { completedAt: workerEvent.occurredAt },
        });
      }
      if (workerEvent.status === "cancelled") {
        return parseCouncilEvent({
          id: workerEvent.eventId,
          type: "agent_run.cancelled",
          sessionId: workerEvent.sessionId,
          runId: workerEvent.runId,
          occurredAt: workerEvent.occurredAt,
          payload: { cancelledAt: workerEvent.occurredAt },
        });
      }
      if (workerEvent.status === "failed") {
        return undefined;
      }
      return parseCouncilEvent({
        id: workerEvent.eventId,
        type: "agent_run.status_changed",
        sessionId: workerEvent.sessionId,
        runId: workerEvent.runId,
        occurredAt: workerEvent.occurredAt,
        payload: {
          previousStatus: run.status,
          status: workerEvent.status,
        },
      });
    }

    if (workerEvent.type === "delta") {
      return parseCouncilEvent({
        id: workerEvent.eventId,
        type: "contribution.delta",
        sessionId: workerEvent.sessionId,
        runId: workerEvent.runId,
        occurredAt: workerEvent.occurredAt,
        payload: {
          contributionId: workerEvent.contributionId,
          delta: workerEvent.delta,
          index: workerEvent.index,
        },
      });
    }

    if (workerEvent.type === "completed") {
      return parseCouncilEvent({
        id: workerEvent.eventId,
        type: "contribution.completed",
        sessionId: workerEvent.sessionId,
        runId: workerEvent.runId,
        occurredAt: workerEvent.occurredAt,
        payload: {
          contribution: {
            id: workerEvent.contributionId,
            sessionId: workerEvent.sessionId,
            runId: workerEvent.runId,
            agentDefinitionId: run.agentDefinitionId,
            content: workerEvent.content,
            status: "completed",
            createdAt: run.contributionCreatedAt ?? workerEvent.occurredAt,
            updatedAt: workerEvent.occurredAt,
          },
        },
      });
    }

    return parseCouncilEvent({
      id: workerEvent.eventId,
      type: "agent_run.failed",
      sessionId: workerEvent.sessionId,
      runId: workerEvent.runId,
      occurredAt: workerEvent.occurredAt,
      payload: { failure: workerEvent.error },
    });
  }

  #persistAndApply(event: CouncilEventMessage): void {
    this.#assertPersistenceAvailable();
    const inserted = this.#journal.append(event);
    if (inserted !== undefined) {
      this.#applyCommitted(inserted);
    }
  }

  #applyCommitted(entry: JournalEntry): void {
    const { event } = entry;
    try {
      this.#apply(event);
    } catch (error) {
      const fatalError = new JournalError(
        "CORRUPT_JOURNAL",
        `A durable ${event.type} event could not be applied`,
        { cause: error },
      );
      this.#fatalPersistenceError = fatalError;
      throw fatalError;
    }
    this.#publishedEvents.emit(sessionEventName(event.sessionId), entry);
  }

  #assertPersistenceAvailable(): void {
    if (this.#fatalPersistenceError !== undefined) {
      throw this.#fatalPersistenceError;
    }
  }

  #apply(event: CouncilEventMessage): void {
    if (event.type === "session.created") {
      const { quest, session } = event.payload;
      if (this.#sessions.has(event.sessionId)) {
        throw new Error(`Session ${event.sessionId} was created twice`);
      }
      if (session.id !== event.sessionId || session.questId !== quest.id) {
        throw new Error("Session creation identities do not match the event");
      }
      this.#sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        quest: {
          questId: quest.id,
          title: quest.title,
          ...(quest.context === undefined ? {} : { context: quest.context }),
        },
        createdAt: session.createdAt,
        agentDefinitions: new Map(),
        runs: new Map(),
        events: [event],
        eventIds: new Set([event.id]),
      });
      return;
    }

    const session = this.#requireSession(event.sessionId);
    if (session.eventIds.has(event.id)) {
      return;
    }

    if (event.type === "session.convened") {
      if (session.agentDefinitions.size > 0 || session.runs.size > 0) {
        throw new Error(`Session ${event.sessionId} was convened twice`);
      }
      for (const definition of event.payload.agentDefinitions) {
        session.agentDefinitions.set(definition.id, { ...definition });
      }
    } else if (event.type === "agent_run.spawned") {
      if (
        session.runs.has(event.runId) ||
        event.payload.run.id !== event.runId ||
        event.payload.run.sessionId !== event.sessionId
      ) {
        throw new Error(`Run ${event.runId} has conflicting identities`);
      }
      const definition = session.agentDefinitions.get(
        event.payload.run.agentDefinitionId,
      );
      if (definition === undefined) {
        throw new Error(
          `Run ${event.runId} references an unknown agent definition`,
        );
      }
      const run: MutableRunProjection = {
        runId: event.runId,
        sessionId: event.sessionId,
        agentId: definition.role,
        agentDefinitionId: definition.id,
        status: event.payload.run.status,
        contribution: "",
        nextDeltaIndex: 0,
      };
      session.runs.set(event.runId, run);
      this.#runToSession.set(event.runId, event.sessionId);
    } else if (event.type === "agent_run.started") {
      const run = requireRun(session, event.runId);
      requireRunStatus(run, "pending", event.type);
      run.status = "starting";
      run.pid = event.payload.processId;
      run.startedAt = event.occurredAt;
    } else if (event.type === "agent_run.status_changed") {
      const run = requireRun(session, event.runId);
      if (run.status !== event.payload.previousStatus) {
        throw new Error(
          `Run ${event.runId} expected status ${event.payload.previousStatus}, found ${run.status}`,
        );
      }
      if (!isValidProjectedTransition(run.status, event.payload.status)) {
        throw new Error(
          `Run ${event.runId} cannot transition from ${run.status} to ${event.payload.status}`,
        );
      }
      run.status = event.payload.status;
    } else if (event.type === "agent_run.completed") {
      const run = requireRun(session, event.runId);
      requireRunStatus(run, "running", event.type);
      if (run.contribution.trim().length === 0) {
        throw new Error(`Run ${event.runId} completed without a contribution`);
      }
      run.status = "completed";
      run.completedAt = event.payload.completedAt;
    } else if (event.type === "agent_run.failed") {
      const run = requireRun(session, event.runId);
      if (TERMINAL_STATUSES.has(run.status)) {
        throw new Error(`Run ${event.runId} failed after reaching a terminal state`);
      }
      run.status = "failed";
      run.error = { ...event.payload.failure };
      run.completedAt = event.occurredAt;
    } else if (event.type === "agent_run.cancelled") {
      const run = requireRun(session, event.runId);
      requireRunStatus(run, "cancelling", event.type);
      run.status = "cancelled";
      run.completedAt = event.payload.cancelledAt;
    } else if (event.type === "contribution.delta") {
      const run = requireRun(session, event.runId);
      requireRunStatus(run, "running", event.type);
      if (run.nextDeltaIndex !== event.payload.index) {
        throw new Error(
          `Run ${event.runId} expected delta ${String(run.nextDeltaIndex)}, found ${String(event.payload.index)}`,
        );
      }
      if (
        run.contributionId !== undefined &&
        run.contributionId !== event.payload.contributionId
      ) {
        throw new Error(`Run ${event.runId} changed contribution identity`);
      }
      run.contributionId = event.payload.contributionId;
      run.contributionCreatedAt ??= event.occurredAt;
      run.contribution += event.payload.delta;
      run.nextDeltaIndex += 1;
    } else if (event.type === "contribution.completed") {
      const run = requireRun(session, event.runId);
      requireRunStatus(run, "running", event.type);
      if (
        event.payload.contribution.sessionId !== event.sessionId ||
        event.payload.contribution.runId !== event.runId ||
        event.payload.contribution.agentDefinitionId !== run.agentDefinitionId ||
        (run.contributionId !== undefined &&
          run.contributionId !== event.payload.contribution.id)
      ) {
        throw new Error(`Run ${event.runId} completed a conflicting contribution`);
      }
      run.contributionId = event.payload.contribution.id;
      run.contribution = event.payload.contribution.content;
      run.contributionCreatedAt = event.payload.contribution.createdAt;
    }

    session.eventIds.add(event.id);
    session.events.push(event);
  }

  #reconcileInterruptedRuns(): void {
    const events: CouncilEventMessage[] = [];
    for (const session of this.#sessions.values()) {
      for (const run of session.runs.values()) {
        if (!TERMINAL_STATUSES.has(run.status)) {
          events.push(
            parseCouncilEvent({
              id: randomUUID(),
              type: "agent_run.failed",
              sessionId: session.sessionId,
              runId: run.runId,
              occurredAt: new Date().toISOString(),
              payload: {
                failure: {
                  code: "DAEMON_RESTARTED",
                  message: "The Assembly restarted before this run completed",
                },
              },
            }),
          );
        }
      }
    }
    const inserted = this.#journal.appendMany(events);
    for (const entry of inserted) {
      this.#applyCommitted(entry);
    }
  }

  #snapshot(session: SessionRecord): SessionSnapshot {
    const runs = [...session.runs.values()].map(runSnapshot);
    return {
      sessionId: session.sessionId,
      quest: { ...session.quest },
      status: sessionStatus(runs),
      createdAt: session.createdAt,
      eventCursor: this.#journal.latestSequence(session.sessionId),
      runs,
      events: session.events.map((event) => structuredClone(event)),
    };
  }

  #requireSession(sessionId: string): SessionRecord {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Session ${sessionId} is missing from the journal projection`);
    }
    return session;
  }
}

function sessionEventName(sessionId: string): string {
  return `session:${sessionId}`;
}

function requireRun(session: SessionRecord, runId: string): MutableRunProjection {
  const run = session.runs.get(runId);
  if (run === undefined) {
    throw new Error(`Run ${runId} is missing from the journal projection`);
  }
  return run;
}

function requireRunStatus(
  run: MutableRunProjection,
  expected: AgentRunStatus,
  eventType: CouncilEventMessage["type"],
): void {
  if (run.status !== expected) {
    throw new Error(
      `${eventType} expected run ${run.runId} to be ${expected}, found ${run.status}`,
    );
  }
}

function isValidProjectedTransition(
  current: AgentRunStatus,
  next: AgentRunStatus,
): boolean {
  const transitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
    pending: ["starting", "cancelling"],
    starting: ["running", "cancelling"],
    running: ["cancelling"],
    cancelling: [],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return transitions[current].includes(next);
}

function runSnapshot(run: MutableRunProjection): RunSnapshot {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    agentId: run.agentId,
    agentDefinitionId: run.agentDefinitionId,
    status: run.status,
    ...(run.pid === undefined ? {} : { pid: run.pid }),
    contribution: run.contribution,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    ...(run.error === undefined ? {} : { error: { ...run.error } }),
  };
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
