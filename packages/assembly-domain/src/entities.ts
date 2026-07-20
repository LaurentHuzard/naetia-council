export type QuestId = string;
export type SessionId = string;
export type AgentDefinitionId = string;
export type AgentRunId = string;
export type ContributionId = string;
export type FragmentId = string;
export type DecisionId = string;
export type EventId = string;

export const AGENT_ROLES = [
  "architect",
  "builder",
  "trickster",
  "guardian",
  "archivist",
  "game-designer",
  "llm-genie",
  "inner-child",
  "scout",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_RUN_STATUSES = [
  "pending",
  "starting",
  "running",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const SESSION_STATUSES = ["draft", "convening", "active", "completed"] as const;
export type CouncilSessionStatus = (typeof SESSION_STATUSES)[number];

export const CONTRIBUTION_STATUSES = ["streaming", "completed"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const FRAGMENT_STATUSES = ["available", "kept", "challenged", "composted"] as const;
export type FragmentStatus = (typeof FRAGMENT_STATUSES)[number];

export const FRAGMENT_STATUS_TRANSITIONS = {
  available: ["kept", "challenged", "composted"],
  kept: ["challenged", "composted"],
  challenged: ["kept", "composted"],
  composted: [],
} as const satisfies Readonly<Record<FragmentStatus, readonly FragmentStatus[]>>;

export function canTransitionFragmentStatus(
  current: FragmentStatus,
  next: FragmentStatus,
): boolean {
  return (FRAGMENT_STATUS_TRANSITIONS[current] as readonly FragmentStatus[]).includes(
    next,
  );
}

export interface Quest {
  readonly id: QuestId;
  readonly title: string;
  readonly context?: string;
  readonly createdAt: string;
}

export interface DecisionRevision {
  readonly sourceSessionId: SessionId;
  readonly sourceDecisionId: DecisionId;
  readonly intent: string;
}

export interface CouncilSession {
  readonly id: SessionId;
  readonly questId: QuestId;
  readonly status: CouncilSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisionOf?: DecisionRevision;
}

export interface AgentDefinition {
  readonly id: AgentDefinitionId;
  readonly role: AgentRole;
  readonly name: string;
  readonly perspective: string;
  readonly instructions: string;
  readonly version: number;
}

export interface AgentRunFailure {
  readonly code: string;
  readonly message: string;
}

export interface AgentRun {
  readonly id: AgentRunId;
  readonly sessionId: SessionId;
  readonly agentDefinitionId: AgentDefinitionId;
  readonly status: AgentRunStatus;
  readonly processId?: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failure?: AgentRunFailure;
}

export interface Contribution {
  readonly id: ContributionId;
  readonly sessionId: SessionId;
  readonly runId: AgentRunId;
  readonly agentDefinitionId: AgentDefinitionId;
  readonly content: string;
  readonly status: ContributionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Fragment {
  readonly id: FragmentId;
  readonly sessionId: SessionId;
  readonly contributionId: ContributionId;
  readonly runId: AgentRunId;
  readonly content: string;
  readonly status: FragmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DecisionSource {
  readonly fragmentId: FragmentId;
  readonly contributionId: ContributionId;
  readonly runId: AgentRunId;
  readonly agentDefinitionId: AgentDefinitionId;
}

export interface Decision {
  readonly id: DecisionId;
  readonly sessionId: SessionId;
  readonly statement: string;
  readonly rationale: string;
  readonly objection?: string;
  readonly reviewCondition?: string;
  readonly sources: readonly DecisionSource[];
  readonly createdAt: string;
}

export interface ReturnPoint {
  readonly sessionId: SessionId;
  readonly decisionId?: DecisionId;
  readonly summary: string;
  readonly openObjection?: string;
  readonly nextSmallStep?: string;
  readonly updatedAt: string;
}
