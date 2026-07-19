import type {
  AgentDefinitionId,
  AgentRun,
  AgentRunFailure,
  AgentRunId,
  AgentRunStatus,
  Contribution,
  ContributionId,
  CouncilSession,
  Decision,
  EventId,
  Fragment,
  FragmentId,
  Quest,
  ReturnPoint,
  SessionId,
} from "./entities.js";

interface EventEnvelope<TType extends string, TPayload> {
  readonly id: EventId;
  readonly type: TType;
  readonly sessionId: SessionId;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

interface RunEventEnvelope<TType extends string, TPayload>
  extends EventEnvelope<TType, TPayload> {
  readonly runId: AgentRunId;
}

export type SessionCreatedEvent = EventEnvelope<
  "session.created",
  { readonly quest: Quest; readonly session: CouncilSession }
>;

export type SessionConvenedEvent = EventEnvelope<
  "session.convened",
  { readonly agentDefinitionIds: readonly AgentDefinitionId[] }
>;

export type AgentRunSpawnedEvent = RunEventEnvelope<
  "agent_run.spawned",
  { readonly run: AgentRun }
>;

export type AgentRunStartedEvent = RunEventEnvelope<
  "agent_run.started",
  { readonly processId: number }
>;

export type AgentRunStatusChangedEvent = RunEventEnvelope<
  "agent_run.status_changed",
  {
    readonly previousStatus: AgentRunStatus;
    readonly status: AgentRunStatus;
  }
>;

export type AgentRunCompletedEvent = RunEventEnvelope<
  "agent_run.completed",
  { readonly completedAt: string }
>;

export type AgentRunFailedEvent = RunEventEnvelope<
  "agent_run.failed",
  { readonly failure: AgentRunFailure }
>;

export type AgentRunCancelledEvent = RunEventEnvelope<
  "agent_run.cancelled",
  { readonly cancelledAt: string; readonly reason?: string }
>;

export type ContributionDeltaEvent = RunEventEnvelope<
  "contribution.delta",
  {
    readonly contributionId: ContributionId;
    readonly delta: string;
    readonly index: number;
  }
>;

export type ContributionCompletedEvent = RunEventEnvelope<
  "contribution.completed",
  { readonly contribution: Contribution }
>;

export type FragmentCreatedEvent = EventEnvelope<
  "fragment.created",
  { readonly fragment: Fragment }
>;

export type FragmentKeptEvent = EventEnvelope<
  "fragment.kept",
  { readonly fragmentId: FragmentId }
>;

export type FragmentCompostedEvent = EventEnvelope<
  "fragment.composted",
  { readonly fragmentId: FragmentId }
>;

export type ChallengeRequestedEvent = EventEnvelope<
  "challenge.requested",
  { readonly fragmentId: FragmentId; readonly prompt?: string }
>;

export type DecisionForgedEvent = EventEnvelope<
  "decision.forged",
  { readonly decision: Decision }
>;

export type ReturnPointUpdatedEvent = EventEnvelope<
  "return_point.updated",
  { readonly returnPoint: ReturnPoint }
>;

export type CouncilEvent =
  | SessionCreatedEvent
  | SessionConvenedEvent
  | AgentRunSpawnedEvent
  | AgentRunStartedEvent
  | AgentRunStatusChangedEvent
  | AgentRunCompletedEvent
  | AgentRunFailedEvent
  | AgentRunCancelledEvent
  | ContributionDeltaEvent
  | ContributionCompletedEvent
  | FragmentCreatedEvent
  | FragmentKeptEvent
  | FragmentCompostedEvent
  | ChallengeRequestedEvent
  | DecisionForgedEvent
  | ReturnPointUpdatedEvent;

export type RunCouncilEvent = Extract<CouncilEvent, { readonly runId: AgentRunId }>;

export const RUN_EVENT_TYPES = [
  "agent_run.spawned",
  "agent_run.started",
  "agent_run.status_changed",
  "agent_run.completed",
  "agent_run.failed",
  "agent_run.cancelled",
  "contribution.delta",
  "contribution.completed",
] as const satisfies readonly RunCouncilEvent["type"][];
