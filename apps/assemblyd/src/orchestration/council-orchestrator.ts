import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  canTransitionFragmentStatus,
  type AgentDefinition,
  type AgentRole,
  type AgentRunStatus,
  type FragmentStatus,
  type Quest,
} from "@naetia/assembly-domain";
import {
  agentWorkerModelOptionsSchema,
  parseCouncilEvent,
  type AgentWorkerEvent,
  type AgentWorkerModelOptions,
  type CouncilEventMessage,
  type DecisionMessage,
  type DecisionRevisionMessage,
  type FragmentMessage,
  type ModelExecutionMessage,
  type ReturnPointMessage,
  type SessionSummaryMessage,
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

const MAX_SESSION_INDEX_SIZE = 50;

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
  readonly modelExecution?: ModelExecutionMessage;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly status: "created" | "running" | "completed";
  readonly createdAt: string;
  readonly eventCursor: number;
  readonly runs: readonly RunSnapshot[];
  readonly fragments: readonly FragmentMessage[];
  readonly revisionOf?: DecisionRevisionMessage;
  readonly previousDecision?: Readonly<{
    sessionId: string;
    decision: DecisionMessage;
    returnPoint: ReturnPointMessage;
  }>;
  readonly decision?: DecisionMessage;
  readonly returnPoint?: ReturnPointMessage;
  readonly events: readonly CouncilEventMessage[];
}

export interface ForgeDecisionInput {
  readonly fragmentIds: readonly string[];
  readonly statement: string;
  readonly rationale: string;
  readonly objection?: string;
  readonly reviewCondition?: string;
  readonly nextSmallStep: string;
}

export interface CreateRevisionInput {
  readonly decisionId: string;
  readonly intent: string;
}

export type CouncilCommandErrorCode =
  | "FRAGMENT_TRANSITION_CONFLICT"
  | "DECISION_SOURCE_CONFLICT"
  | "DECISION_ALREADY_FORGED"
  | "REVISION_NOT_READY"
  | "REVISION_SOURCE_CONFLICT"
  | "REVISION_ALREADY_STARTED";

export class CouncilCommandError extends Error {
  readonly code: CouncilCommandErrorCode;

  constructor(code: CouncilCommandErrorCode, message: string) {
    super(message);
    this.name = "CouncilCommandError";
    this.code = code;
  }
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
  readonly model?: AgentWorkerModelOptions;
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
  contributionCompleted: boolean;
  nextDeltaIndex: number;
  startedAt?: string;
  completedAt?: string;
  error?: Readonly<{ code: string; message: string }>;
  modelExecution?: ModelExecutionMessage;
}

interface MutableFragmentProjection {
  fragment: FragmentMessage;
  challengePrompt?: string;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly quest: QuestSnapshot;
  readonly questCreatedAt: string;
  readonly createdAt: string;
  readonly agentDefinitions: Map<string, AgentDefinition>;
  readonly runs: Map<string, MutableRunProjection>;
  readonly fragments: Map<string, MutableFragmentProjection>;
  readonly events: CouncilEventMessage[];
  readonly eventIds: Set<string>;
  readonly revisionOf?: DecisionRevisionMessage;
  decision?: DecisionMessage;
  returnPoint?: ReturnPointMessage;
}

export class CouncilOrchestrator {
  readonly #processManager: AgentProcessManager;
  readonly #journal: SqliteEventJournal;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #runToSession = new Map<string, string>();
  readonly #fragmentToSession = new Map<string, string>();
  readonly #revisionByDecision = new Map<string, string>();
  readonly #persistenceFailedRuns = new Set<string>();
  readonly #publishedEvents = new EventEmitter();
  readonly #model: AgentWorkerModelOptions;
  readonly #unsubscribe: () => void;
  #fatalPersistenceError: JournalError | undefined;

  constructor(options: CouncilOrchestratorOptions = {}) {
    this.#processManager = options.processManager ?? new AgentProcessManager();
    this.#journal = options.journal ?? new SqliteEventJournal(":memory:");
    this.#model = agentWorkerModelOptionsSchema.parse(
      options.model ?? { adapter: "fake" },
    );
    this.#publishedEvents.setMaxListeners(0);

    try {
      for (const event of this.#journal.readAll()) {
        this.#apply(event);
      }
      this.#reconcileMissingFragments();
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

  createRevision(
    sourceSessionId: string,
    input: CreateRevisionInput,
  ): SessionSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const source = this.#sessions.get(sourceSessionId);
    if (source === undefined) {
      return undefined;
    }
    if (source.decision === undefined || source.returnPoint === undefined) {
      throw new CouncilCommandError(
        "REVISION_NOT_READY",
        "A revision requires a forged decision and its return point",
      );
    }
    if (source.decision.id !== input.decisionId) {
      throw new CouncilCommandError(
        "REVISION_SOURCE_CONFLICT",
        "The requested decision is not the current decision of this session",
      );
    }

    const intent = input.intent.trim();
    const existingRevisionId = this.#revisionByDecision.get(source.decision.id);
    if (existingRevisionId !== undefined) {
      const existingRevision = this.#requireSession(existingRevisionId);
      if (existingRevision.revisionOf?.intent === intent) {
        return this.#snapshot(existingRevision);
      }
      throw new CouncilCommandError(
        "REVISION_ALREADY_STARTED",
        "This decision already owns a revision with another intent",
      );
    }

    const occurredAt = new Date().toISOString();
    const sessionId = randomUUID();
    const revisionOf = {
      sourceSessionId,
      sourceDecisionId: source.decision.id,
      intent,
    } satisfies DecisionRevisionMessage;
    const event = parseCouncilEvent({
      id: randomUUID(),
      type: "session.created",
      sessionId,
      occurredAt,
      payload: {
        quest: {
          id: source.quest.questId,
          title: source.quest.title,
          ...(source.quest.context === undefined
            ? {}
            : { context: source.quest.context }),
          createdAt: source.questCreatedAt,
        },
        session: {
          id: sessionId,
          questId: source.quest.questId,
          status: "draft",
          createdAt: occurredAt,
          updatedAt: occurredAt,
          revisionOf,
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
      const model =
        this.#model.adapter === "fake"
          ? {
              ...this.#model,
              ...(behavior?.latencyMs === undefined
                ? {}
                : { latencyMs: behavior.latencyMs }),
              ...(behavior?.failAtDelta === undefined
                ? {}
                : { failAtDelta: behavior.failAtDelta }),
              ...(behavior?.crashAtDelta === undefined
                ? {}
                : { crashAtDelta: behavior.crashAtDelta }),
              ...(behavior?.empty === undefined
                ? {}
                : { empty: behavior.empty }),
            }
          : this.#model;
      let liveRun: LiveRunSnapshot;
      try {
        const quest = this.#agentQuest(session);
        liveRun = this.#processManager.spawn({
          runId,
          sessionId,
          agentDefinition: definition,
          quest,
          model,
          ...(behavior?.timeoutMs === undefined
            ? {}
            : { timeoutMs: behavior.timeoutMs }),
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

  listSessions(limit = 8): readonly SessionSummaryMessage[] {
    this.#assertPersistenceAvailable();
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_SESSION_INDEX_SIZE
    ) {
      throw new Error(
        `Session index limit must be between 1 and ${String(MAX_SESSION_INDEX_SIZE)}`,
      );
    }

    return [...this.#sessions.values()]
      .map((session) => this.#sessionSummary(session))
      .sort(
        (left, right) =>
          right.eventCursor - left.eventCursor ||
          left.sessionId.localeCompare(right.sessionId),
      )
      .slice(0, limit);
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

  keepFragment(fragmentId: string): SessionSnapshot | undefined {
    return this.#transitionFragment(fragmentId, "kept");
  }

  challengeFragment(
    fragmentId: string,
    prompt?: string,
  ): SessionSnapshot | undefined {
    return this.#transitionFragment(
      fragmentId,
      "challenged",
      normalizeOptionalText(prompt),
    );
  }

  compostFragment(fragmentId: string): SessionSnapshot | undefined {
    return this.#transitionFragment(fragmentId, "composted");
  }

  forgeDecision(
    sessionId: string,
    input: ForgeDecisionInput,
  ): SessionSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }

    const fragmentIds = [...input.fragmentIds];
    if (
      fragmentIds.length === 0 ||
      new Set(fragmentIds).size !== fragmentIds.length
    ) {
      throw new CouncilCommandError(
        "DECISION_SOURCE_CONFLICT",
        "A decision requires distinct kept fragments",
      );
    }
    const fragments = fragmentIds.map((fragmentId) => {
      const projection = session.fragments.get(fragmentId);
      if (projection === undefined || projection.fragment.status !== "kept") {
        throw new CouncilCommandError(
          "DECISION_SOURCE_CONFLICT",
          "Every decision source must be a kept fragment from this session",
        );
      }
      return projection.fragment;
    });
    const statement = input.statement.trim();
    const rationale = input.rationale.trim();
    const objection = normalizeOptionalText(input.objection);
    const reviewCondition = normalizeOptionalText(input.reviewCondition);
    const nextSmallStep = input.nextSmallStep.trim();

    if (session.decision !== undefined) {
      if (
        decisionMatches(
          session.decision,
          session.returnPoint,
          fragmentIds,
          {
            statement,
            rationale,
            objection,
            reviewCondition,
            nextSmallStep,
          },
        )
      ) {
        return this.#snapshot(session);
      }
      throw new CouncilCommandError(
        "DECISION_ALREADY_FORGED",
        "This Council session already owns a forged decision",
      );
    }

    const occurredAt = new Date().toISOString();
    const decisionId = randomUUID();
    const decision = {
      id: decisionId,
      sessionId,
      statement,
      rationale,
      ...(objection === undefined ? {} : { objection }),
      ...(reviewCondition === undefined ? {} : { reviewCondition }),
      sources: fragments.map((fragment) => {
        const run = requireRun(session, fragment.runId);
        return {
          fragmentId: fragment.id,
          contributionId: fragment.contributionId,
          runId: fragment.runId,
          agentDefinitionId: run.agentDefinitionId,
        };
      }),
      createdAt: occurredAt,
    } satisfies DecisionMessage;
    const returnPoint = {
      sessionId,
      decisionId,
      summary: statement,
      ...(objection === undefined ? {} : { openObjection: objection }),
      nextSmallStep,
      updatedAt: occurredAt,
    } satisfies ReturnPointMessage;
    const events = [
      parseCouncilEvent({
        id: randomUUID(),
        type: "decision.forged",
        sessionId,
        occurredAt,
        payload: { decision },
      }),
      parseCouncilEvent({
        id: randomUUID(),
        type: "return_point.updated",
        sessionId,
        occurredAt,
        payload: { returnPoint },
      }),
    ];
    const inserted = this.#journal.appendMany(events);
    for (const entry of inserted) {
      this.#applyCommitted(entry);
    }
    return this.#snapshot(session);
  }

  async close(): Promise<void> {
    await this.#processManager.close();
    this.#unsubscribe();
    this.#publishedEvents.removeAllListeners();
    this.#journal.close();
  }

  #transitionFragment(
    fragmentId: string,
    targetStatus: Extract<FragmentStatus, "kept" | "challenged" | "composted">,
    challengePrompt?: string,
  ): SessionSnapshot | undefined {
    this.#assertPersistenceAvailable();
    const sessionId = this.#fragmentToSession.get(fragmentId);
    const session =
      sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    const projection = session?.fragments.get(fragmentId);
    if (session === undefined || projection === undefined) {
      return undefined;
    }
    if (session.decision !== undefined) {
      throw new CouncilCommandError(
        "FRAGMENT_TRANSITION_CONFLICT",
        "Fragments are locked after the decision is forged",
      );
    }

    if (projection.fragment.status === targetStatus) {
      if (
        targetStatus === "challenged" &&
        projection.challengePrompt !== challengePrompt
      ) {
        throw new CouncilCommandError(
          "FRAGMENT_TRANSITION_CONFLICT",
          "This fragment was already challenged with another prompt",
        );
      }
      return this.#snapshot(session);
    }

    const currentStatus = projection.fragment.status;
    const canTransition = canTransitionFragmentStatus(
      currentStatus,
      targetStatus,
    );
    if (!canTransition) {
      throw new CouncilCommandError(
        "FRAGMENT_TRANSITION_CONFLICT",
        `Fragment ${fragmentId} cannot move from ${currentStatus} to ${targetStatus}`,
      );
    }

    const occurredAt = new Date().toISOString();
    const event =
      targetStatus === "kept"
        ? parseCouncilEvent({
            id: randomUUID(),
            type: "fragment.kept",
            sessionId,
            occurredAt,
            payload: { fragmentId },
          })
        : targetStatus === "composted"
          ? parseCouncilEvent({
              id: randomUUID(),
              type: "fragment.composted",
              sessionId,
              occurredAt,
              payload: { fragmentId },
            })
          : parseCouncilEvent({
              id: randomUUID(),
              type: "challenge.requested",
              sessionId,
              occurredAt,
              payload: {
                fragmentId,
                ...(challengePrompt === undefined ? {} : { prompt: challengePrompt }),
              },
            });
    this.#persistAndApply(event);
    return this.#snapshot(session);
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
    const events = this.#normalizeWorkerEvents(workerEvent);
    if (events.length === 0) {
      return;
    }

    let inserted: readonly JournalEntry[];
    try {
      inserted = this.#journal.appendMany(events);
    } catch (error) {
      if (!(error instanceof JournalError)) {
        throw error;
      }
      this.#fatalPersistenceError = error;
      this.#persistenceFailedRuns.add(workerEvent.runId);
      this.#processManager.cancel(workerEvent.runId);
      return;
    }
    for (const entry of inserted) {
      this.#applyCommitted(entry);
    }
  }

  #normalizeWorkerEvents(
    workerEvent: AgentWorkerEvent,
  ): readonly CouncilEventMessage[] {
    const session = this.#sessions.get(workerEvent.sessionId);
    const run = session?.runs.get(workerEvent.runId);
    if (session === undefined || run === undefined) {
      return [];
    }

    if (workerEvent.type === "status") {
      if (workerEvent.status === "starting") {
        return [];
      }
      if (workerEvent.status === "completed") {
        return [parseCouncilEvent({
          id: workerEvent.eventId,
          type: "agent_run.completed",
          sessionId: workerEvent.sessionId,
          runId: workerEvent.runId,
          occurredAt: workerEvent.occurredAt,
          payload: { completedAt: workerEvent.occurredAt },
        })];
      }
      if (workerEvent.status === "cancelled") {
        return [parseCouncilEvent({
          id: workerEvent.eventId,
          type: "agent_run.cancelled",
          sessionId: workerEvent.sessionId,
          runId: workerEvent.runId,
          occurredAt: workerEvent.occurredAt,
          payload: { cancelledAt: workerEvent.occurredAt },
        })];
      }
      if (workerEvent.status === "failed") {
        return [];
      }
      return [parseCouncilEvent({
        id: workerEvent.eventId,
        type: "agent_run.status_changed",
        sessionId: workerEvent.sessionId,
        runId: workerEvent.runId,
        occurredAt: workerEvent.occurredAt,
        payload: {
          previousStatus: run.status,
          status: workerEvent.status,
        },
      })];
    }

    if (workerEvent.type === "delta") {
      return [parseCouncilEvent({
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
      })];
    }

    if (workerEvent.type === "completed") {
      if (run.contributionCompleted) {
        return [];
      }
      const fragmentId = randomUUID();
      return [
        parseCouncilEvent({
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
            modelExecution: workerEvent.modelExecution,
          },
        }),
        parseCouncilEvent({
          id: randomUUID(),
          type: "fragment.created",
          sessionId: workerEvent.sessionId,
          occurredAt: workerEvent.occurredAt,
          payload: {
            fragment: {
              id: fragmentId,
              sessionId: workerEvent.sessionId,
              contributionId: workerEvent.contributionId,
              runId: workerEvent.runId,
              content: workerEvent.content,
              status: "available",
              createdAt: workerEvent.occurredAt,
              updatedAt: workerEvent.occurredAt,
            },
          },
        }),
      ];
    }

    return [parseCouncilEvent({
      id: workerEvent.eventId,
      type: "agent_run.failed",
      sessionId: workerEvent.sessionId,
      runId: workerEvent.runId,
      occurredAt: workerEvent.occurredAt,
      payload: { failure: workerEvent.error },
    })];
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
      const revisionOf = session.revisionOf;
      if (revisionOf !== undefined) {
        const source = this.#sessions.get(revisionOf.sourceSessionId);
        if (
          source === undefined ||
          source.decision === undefined ||
          source.returnPoint === undefined ||
          source.decision.id !== revisionOf.sourceDecisionId ||
          quest.id !== source.quest.questId ||
          quest.title !== source.quest.title ||
          quest.context !== source.quest.context ||
          quest.createdAt !== source.questCreatedAt ||
          this.#revisionByDecision.has(revisionOf.sourceDecisionId)
        ) {
          throw new Error(
            `Revision session ${event.sessionId} conflicts with its source decision`,
          );
        }
      }
      this.#sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        quest: {
          questId: quest.id,
          title: quest.title,
          ...(quest.context === undefined ? {} : { context: quest.context }),
        },
        questCreatedAt: quest.createdAt,
        createdAt: session.createdAt,
        agentDefinitions: new Map(),
        runs: new Map(),
        fragments: new Map(),
        events: [event],
        eventIds: new Set([event.id]),
        ...(revisionOf === undefined
          ? {}
          : { revisionOf: structuredClone(revisionOf) }),
      });
      if (revisionOf !== undefined) {
        this.#revisionByDecision.set(
          revisionOf.sourceDecisionId,
          event.sessionId,
        );
      }
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
        contributionCompleted: false,
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
      run.contributionCompleted = true;
      if (event.payload.modelExecution === undefined) {
        delete run.modelExecution;
      } else {
        run.modelExecution = structuredClone(event.payload.modelExecution);
      }
    } else if (event.type === "fragment.created") {
      const fragment = event.payload.fragment;
      const run = requireRun(session, fragment.runId);
      if (
        session.fragments.has(fragment.id) ||
        fragment.sessionId !== event.sessionId ||
        fragment.contributionId !== run.contributionId ||
        !run.contributionCompleted ||
        fragment.content !== run.contribution ||
        fragment.status !== "available"
      ) {
        throw new Error(`Fragment ${fragment.id} conflicts with its contribution`);
      }
      session.fragments.set(fragment.id, {
        fragment: structuredClone(fragment),
      });
      this.#fragmentToSession.set(fragment.id, event.sessionId);
    } else if (event.type === "fragment.kept") {
      requireFragmentsMutable(session, event.type);
      const projection = requireFragment(session, event.payload.fragmentId);
      requireFragmentTransition(projection.fragment, "kept", event.type);
      projection.fragment = {
        ...projection.fragment,
        status: "kept",
        updatedAt: event.occurredAt,
      };
    } else if (event.type === "fragment.composted") {
      requireFragmentsMutable(session, event.type);
      const projection = requireFragment(session, event.payload.fragmentId);
      requireFragmentTransition(projection.fragment, "composted", event.type);
      projection.fragment = {
        ...projection.fragment,
        status: "composted",
        updatedAt: event.occurredAt,
      };
    } else if (event.type === "challenge.requested") {
      requireFragmentsMutable(session, event.type);
      const projection = requireFragment(session, event.payload.fragmentId);
      requireFragmentTransition(projection.fragment, "challenged", event.type);
      projection.fragment = {
        ...projection.fragment,
        status: "challenged",
        updatedAt: event.occurredAt,
      };
      if (event.payload.prompt === undefined) {
        delete projection.challengePrompt;
      } else {
        projection.challengePrompt = event.payload.prompt;
      }
    } else if (event.type === "decision.forged") {
      const decision = event.payload.decision;
      if (
        session.decision !== undefined ||
        decision.sessionId !== event.sessionId ||
        new Set(decision.sources.map((source) => source.fragmentId)).size !==
          decision.sources.length
      ) {
        throw new Error(`Decision ${decision.id} conflicts with this session`);
      }
      for (const source of decision.sources) {
        const fragment = requireFragment(session, source.fragmentId).fragment;
        const run = requireRun(session, source.runId);
        if (
          fragment.status !== "kept" ||
          fragment.contributionId !== source.contributionId ||
          fragment.runId !== source.runId ||
          run.agentDefinitionId !== source.agentDefinitionId
        ) {
          throw new Error(`Decision ${decision.id} contains invalid provenance`);
        }
      }
      session.decision = structuredClone(decision);
    } else if (event.type === "return_point.updated") {
      const returnPoint = event.payload.returnPoint;
      if (
        session.returnPoint !== undefined ||
        session.decision === undefined ||
        returnPoint.sessionId !== event.sessionId ||
        returnPoint.decisionId !== session.decision.id
      ) {
        throw new Error("Return point conflicts with the forged decision");
      }
      session.returnPoint = structuredClone(returnPoint);
    }

    session.eventIds.add(event.id);
    session.events.push(event);
  }

  #reconcileMissingFragments(): void {
    const events: CouncilEventMessage[] = [];
    for (const session of this.#sessions.values()) {
      const contributionIds = new Set(
        [...session.fragments.values()].map(
          (projection) => projection.fragment.contributionId,
        ),
      );
      for (const run of session.runs.values()) {
        if (
          !run.contributionCompleted ||
          run.contributionId === undefined ||
          run.contribution.trim().length === 0 ||
          contributionIds.has(run.contributionId)
        ) {
          continue;
        }
        const occurredAt = new Date().toISOString();
        const fragmentId = randomUUID();
        events.push(
          parseCouncilEvent({
            id: randomUUID(),
            type: "fragment.created",
            sessionId: session.sessionId,
            occurredAt,
            payload: {
              fragment: {
                id: fragmentId,
                sessionId: session.sessionId,
                contributionId: run.contributionId,
                runId: run.runId,
                content: run.contribution,
                status: "available",
                createdAt: occurredAt,
                updatedAt: occurredAt,
              },
            },
          }),
        );
        contributionIds.add(run.contributionId);
      }
    }
    const inserted = this.#journal.appendMany(events);
    for (const entry of inserted) {
      this.#applyCommitted(entry);
    }
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

  #agentQuest(
    session: SessionRecord,
  ): Readonly<{ title: string; context?: string }> {
    if (session.revisionOf === undefined) {
      return {
        title: session.quest.title,
        ...(session.quest.context === undefined
          ? {}
          : { context: session.quest.context }),
      };
    }

    const source = this.#requireSession(session.revisionOf.sourceSessionId);
    if (source.decision === undefined || source.returnPoint === undefined) {
      throw new Error(
        `Revision source ${source.sessionId} has no complete decision`,
      );
    }
    const decision = source.decision;
    const returnPoint = source.returnPoint;
    const context = [
      session.quest.context === undefined
        ? undefined
        : `Contexte initial:\n${session.quest.context}`,
      `Intention humaine de révision:\n${session.revisionOf.intent}`,
      `Décision précédente:\n${decision.statement}`,
      `Raison précédente:\n${decision.rationale}`,
      decision.objection === undefined
        ? undefined
        : `Objection conservée:\n${decision.objection}`,
      decision.reviewCondition === undefined
        ? undefined
        : `Condition de révision:\n${decision.reviewCondition}`,
      `Dernier petit geste:\n${returnPoint.nextSmallStep}`,
    ]
      .filter((block): block is string => block !== undefined)
      .join("\n\n");
    return { title: session.quest.title, context };
  }

  #snapshot(session: SessionRecord): SessionSnapshot {
    const runs = [...session.runs.values()].map(runSnapshot);
    const previousDecision =
      session.revisionOf === undefined
        ? undefined
        : this.#previousDecision(session.revisionOf);
    return {
      sessionId: session.sessionId,
      quest: { ...session.quest },
      status: sessionStatus(runs),
      createdAt: session.createdAt,
      eventCursor: this.#journal.latestSequence(session.sessionId),
      runs,
      fragments: [...session.fragments.values()].map((projection) =>
        structuredClone(projection.fragment),
      ),
      ...(session.revisionOf === undefined
        ? {}
        : { revisionOf: structuredClone(session.revisionOf) }),
      ...(previousDecision === undefined ? {} : { previousDecision }),
      ...(session.decision === undefined
        ? {}
        : { decision: structuredClone(session.decision) }),
      ...(session.returnPoint === undefined
        ? {}
        : { returnPoint: structuredClone(session.returnPoint) }),
      events: session.events.map((event) => structuredClone(event)),
    };
  }

  #sessionSummary(session: SessionRecord): SessionSummaryMessage {
    const eventCursor = this.#journal.latestSequence(session.sessionId);
    const lastActivityAt = session.events.at(-1)?.occurredAt ?? session.createdAt;
    const base = {
      sessionId: session.sessionId,
      quest: {
        questId: session.quest.questId,
        title: session.quest.title,
      },
      status: sessionStatus([...session.runs.values()].map(runSnapshot)),
      createdAt: session.createdAt,
      lastActivityAt,
      eventCursor,
      ...(session.revisionOf === undefined
        ? {}
        : { revisionOf: structuredClone(session.revisionOf) }),
    } as const;

    if (session.decision === undefined) {
      return { ...base, hasDecision: false };
    }
    if (session.returnPoint === undefined) {
      throw new Error(
        `Session ${session.sessionId} has a decision without a return point`,
      );
    }
    return {
      ...base,
      hasDecision: true,
      nextSmallStep: session.returnPoint.nextSmallStep,
    };
  }

  #requireSession(sessionId: string): SessionRecord {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Session ${sessionId} is missing from the journal projection`);
    }
    return session;
  }

  #previousDecision(
    revisionOf: DecisionRevisionMessage,
  ): SessionSnapshot["previousDecision"] {
    const source = this.#requireSession(revisionOf.sourceSessionId);
    if (
      source.decision === undefined ||
      source.returnPoint === undefined ||
      source.decision.id !== revisionOf.sourceDecisionId
    ) {
      throw new Error(
        `Revision source ${revisionOf.sourceSessionId} is incomplete`,
      );
    }
    return {
      sessionId: source.sessionId,
      decision: structuredClone(source.decision),
      returnPoint: structuredClone(source.returnPoint),
    };
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

function requireFragment(
  session: SessionRecord,
  fragmentId: string,
): MutableFragmentProjection {
  const fragment = session.fragments.get(fragmentId);
  if (fragment === undefined) {
    throw new Error(`Fragment ${fragmentId} is missing from the journal projection`);
  }
  return fragment;
}

function requireFragmentsMutable(
  session: SessionRecord,
  eventType: CouncilEventMessage["type"],
): void {
  if (session.decision !== undefined) {
    throw new Error(`${eventType} cannot change a fragment after decision.forged`);
  }
}

function requireFragmentTransition(
  fragment: FragmentMessage,
  target: Extract<FragmentStatus, "kept" | "challenged" | "composted">,
  eventType: CouncilEventMessage["type"],
): void {
  const current = fragment.status;
  const allowed = canTransitionFragmentStatus(current, target);
  if (!allowed) {
    throw new Error(
      `${eventType} cannot move fragment ${fragment.id} from ${current} to ${target}`,
    );
  }
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
    ...(run.modelExecution === undefined
      ? {}
      : { modelExecution: structuredClone(run.modelExecution) }),
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

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

interface NormalizedDecisionInput {
  readonly statement: string;
  readonly rationale: string;
  readonly objection: string | undefined;
  readonly reviewCondition: string | undefined;
  readonly nextSmallStep: string;
}

function decisionMatches(
  decision: DecisionMessage,
  returnPoint: ReturnPointMessage | undefined,
  fragmentIds: readonly string[],
  input: NormalizedDecisionInput,
): boolean {
  return (
    returnPoint !== undefined &&
    decision.statement === input.statement &&
    decision.rationale === input.rationale &&
    decision.objection === input.objection &&
    decision.reviewCondition === input.reviewCondition &&
    returnPoint.nextSmallStep === input.nextSmallStep &&
    decision.sources.length === fragmentIds.length &&
    decision.sources.every(
      (source, index) => source.fragmentId === fragmentIds[index],
    )
  );
}
