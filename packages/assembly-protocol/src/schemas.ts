import { z } from "zod";

const identifierSchema = z.string().trim().min(1);
const timestampSchema = z.string().datetime({ offset: true });
const nonEmptyTextSchema = z.string().trim().min(1);
const boundedOptionalTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();
const uniqueIdentifierListSchema = z
  .array(identifierSchema)
  .min(1)
  .max(20)
  .refine((identifiers) => new Set(identifiers).size === identifiers.length, {
    message: "Identifiers must be unique",
  });

export const agentRoleSchema = z.enum([
  "architect",
  "builder",
  "trickster",
  "guardian",
  "archivist",
  "game-designer",
  "llm-genie",
  "inner-child",
  "scout",
]);
export const agentSelectionSchema = z
  .array(agentRoleSchema)
  .min(1)
  .max(9)
  .refine((roles) => new Set(roles).size === roles.length, {
    message: "Agent roles must be unique",
  });
export const agentRunStatusSchema = z.enum([
  "pending",
  "starting",
  "running",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);
export const sessionStatusSchema = z.enum(["draft", "convening", "active", "completed"]);
export const contributionStatusSchema = z.enum(["streaming", "completed"]);
export const fragmentStatusSchema = z.enum(["available", "kept", "challenged", "composted"]);
export const modelAdapterSchema = z.enum([
  "fake",
  "codex-cli",
  "openai-compatible",
]);
export const sessionSummaryStatusSchema = z.enum(["created", "running", "completed"]);

export const decisionRevisionSchema = z
  .object({
    sourceSessionId: identifierSchema,
    sourceDecisionId: identifierSchema,
    intent: z.string().trim().min(1).max(2_000),
  })
  .strict();

const sessionSummaryBaseShape = {
  sessionId: identifierSchema,
  quest: z
    .object({
      questId: identifierSchema,
      title: z.string().trim().min(1).max(200),
    })
    .strict(),
  status: sessionSummaryStatusSchema,
  createdAt: timestampSchema,
  lastActivityAt: timestampSchema,
  eventCursor: z.number().int().nonnegative(),
  revisionOf: decisionRevisionSchema.optional(),
};

export const sessionSummarySchema = z.discriminatedUnion("hasDecision", [
  z
    .object({
      ...sessionSummaryBaseShape,
      hasDecision: z.literal(false),
    })
    .strict(),
  z
    .object({
      ...sessionSummaryBaseShape,
      hasDecision: z.literal(true),
      nextSmallStep: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const sessionIndexSchema = z
  .object({
    sessions: z.array(sessionSummarySchema).max(50),
  })
  .strict();

export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
  })
  .strict();

export const modelExecutionSchema = z
  .object({
    adapter: modelAdapterSchema,
    model: z.string().trim().min(1).optional(),
    durationMs: z.number().int().nonnegative(),
    usage: modelUsageSchema.optional(),
  })
  .strict();

export const questSchema = z
  .object({
    id: identifierSchema,
    title: nonEmptyTextSchema,
    context: z.string().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const councilSessionSchema = z
  .object({
    id: identifierSchema,
    questId: identifierSchema,
    status: sessionStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revisionOf: decisionRevisionSchema.optional(),
  })
  .strict();

export const agentDefinitionSchema = z
  .object({
    id: identifierSchema,
    role: agentRoleSchema,
    name: nonEmptyTextSchema,
    perspective: nonEmptyTextSchema,
    instructions: nonEmptyTextSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const agentRunFailureSchema = z
  .object({
    code: nonEmptyTextSchema,
    message: nonEmptyTextSchema,
  })
  .strict();

export const agentRunSchema = z
  .object({
    id: identifierSchema,
    sessionId: identifierSchema,
    agentDefinitionId: identifierSchema,
    status: agentRunStatusSchema,
    processId: z.number().int().positive().optional(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    failure: agentRunFailureSchema.optional(),
  })
  .strict();

export const contributionSchema = z
  .object({
    id: identifierSchema,
    sessionId: identifierSchema,
    runId: identifierSchema,
    agentDefinitionId: identifierSchema,
    content: z.string(),
    status: contributionStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const fragmentSchema = z
  .object({
    id: identifierSchema,
    sessionId: identifierSchema,
    contributionId: identifierSchema,
    runId: identifierSchema,
    content: nonEmptyTextSchema,
    status: fragmentStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const decisionSourceSchema = z
  .object({
    fragmentId: identifierSchema,
    contributionId: identifierSchema,
    runId: identifierSchema,
    agentDefinitionId: identifierSchema,
  })
  .strict();

export const decisionSchema = z
  .object({
    id: identifierSchema,
    sessionId: identifierSchema,
    statement: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(5_000),
    objection: boundedOptionalTextSchema(5_000),
    reviewCondition: boundedOptionalTextSchema(2_000),
    sources: z.array(decisionSourceSchema).min(1).max(20),
    createdAt: timestampSchema,
  })
  .strict();

export const returnPointSchema = z
  .object({
    sessionId: identifierSchema,
    decisionId: identifierSchema,
    summary: nonEmptyTextSchema,
    openObjection: boundedOptionalTextSchema(5_000),
    nextSmallStep: z.string().trim().min(1).max(1_000),
    updatedAt: timestampSchema,
  })
  .strict();

const eventEnvelopeShape = {
  id: identifierSchema,
  sessionId: identifierSchema,
  occurredAt: timestampSchema,
};

const runEventEnvelopeShape = {
  ...eventEnvelopeShape,
  runId: identifierSchema,
};

export const councilEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("session.created"),
      payload: z.object({ quest: questSchema, session: councilSessionSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("session.convened"),
      payload: z
        .object({
          agentDefinitions: z.array(agentDefinitionSchema).min(1).max(9),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.spawned"),
      payload: z.object({ run: agentRunSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.started"),
      payload: z.object({ processId: z.number().int().positive() }).strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.status_changed"),
      payload: z
        .object({ previousStatus: agentRunStatusSchema, status: agentRunStatusSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.completed"),
      payload: z.object({ completedAt: timestampSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.failed"),
      payload: z.object({ failure: agentRunFailureSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("agent_run.cancelled"),
      payload: z.object({ cancelledAt: timestampSchema, reason: z.string().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("contribution.delta"),
      payload: z
        .object({
          contributionId: identifierSchema,
          delta: z.string(),
          index: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...runEventEnvelopeShape,
      type: z.literal("contribution.completed"),
      payload: z
        .object({
          contribution: contributionSchema,
          modelExecution: modelExecutionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("fragment.created"),
      payload: z.object({ fragment: fragmentSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("fragment.kept"),
      payload: z.object({ fragmentId: identifierSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("fragment.composted"),
      payload: z.object({ fragmentId: identifierSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("challenge.requested"),
      payload: z.object({ fragmentId: identifierSchema, prompt: z.string().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("decision.forged"),
      payload: z.object({ decision: decisionSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelopeShape,
      type: z.literal("return_point.updated"),
      payload: z.object({ returnPoint: returnPointSchema }).strict(),
    })
    .strict(),
]);

const commandEnvelopeShape = {
  commandId: identifierSchema,
};

export const assemblyCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("quest.create"),
      title: nonEmptyTextSchema,
      context: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("session.create"),
      questId: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("session.convene"),
      sessionId: identifierSchema,
      agentIds: agentSelectionSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("agent_run.cancel"),
      sessionId: identifierSchema,
      runId: identifierSchema,
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("fragment.keep"),
      sessionId: identifierSchema,
      fragmentId: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("fragment.compost"),
      sessionId: identifierSchema,
      fragmentId: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("fragment.challenge"),
      sessionId: identifierSchema,
      fragmentId: identifierSchema,
      prompt: boundedOptionalTextSchema(2_000),
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("decision.forge"),
      sessionId: identifierSchema,
      fragmentIds: uniqueIdentifierListSchema,
      statement: z.string().trim().min(1).max(500),
      rationale: z.string().trim().min(1).max(5_000),
      objection: boundedOptionalTextSchema(5_000),
      reviewCondition: boundedOptionalTextSchema(2_000),
      nextSmallStep: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      ...commandEnvelopeShape,
      type: z.literal("decision.revise"),
      sessionId: identifierSchema,
      decisionId: identifierSchema,
      intent: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

const fakeModelOptionsSchema = z
  .object({
    adapter: z.literal("fake"),
    latencyMs: z.number().int().nonnegative().optional(),
    failAtDelta: z.number().int().nonnegative().optional(),
    crashAtDelta: z.number().int().nonnegative().optional(),
    empty: z.boolean().optional(),
  })
  .strict();

const codexCliModelOptionsSchema = z
  .object({
    adapter: z.literal("codex-cli"),
    executablePath: nonEmptyTextSchema,
    model: nonEmptyTextSchema.optional(),
    revealDelayMs: z.number().int().nonnegative().max(5_000),
  })
  .strict();

const openAiCompatibleModelOptionsSchema = z
  .object({
    adapter: z.literal("openai-compatible"),
    url: z.string().url(),
    model: nonEmptyTextSchema,
    maxTokens: z.number().int().min(32).max(4_096),
    enableThinking: z.boolean().optional(),
    revealDelayMs: z.number().int().nonnegative().max(5_000),
  })
  .strict();

export const agentWorkerModelOptionsSchema = z.discriminatedUnion("adapter", [
  fakeModelOptionsSchema,
  codexCliModelOptionsSchema,
  openAiCompatibleModelOptionsSchema,
]);

export const agentWorkerCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      runId: identifierSchema,
      sessionId: identifierSchema,
      agentDefinition: agentDefinitionSchema,
      quest: z
        .object({
          title: nonEmptyTextSchema,
          context: z.string().optional(),
        })
        .strict(),
      model: agentWorkerModelOptionsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cancel"),
      runId: identifierSchema,
    })
    .strict(),
]);

const workerEventEnvelopeShape = {
  eventId: identifierSchema,
  sessionId: identifierSchema,
  runId: identifierSchema,
  occurredAt: timestampSchema,
};

export const agentWorkerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...workerEventEnvelopeShape,
      type: z.literal("status"),
      status: agentRunStatusSchema,
      processId: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...workerEventEnvelopeShape,
      type: z.literal("delta"),
      contributionId: identifierSchema,
      delta: z.string().min(1),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...workerEventEnvelopeShape,
      type: z.literal("completed"),
      contributionId: identifierSchema,
      content: z.string().trim().min(1),
      modelExecution: modelExecutionSchema,
    })
    .strict(),
  z
    .object({
      ...workerEventEnvelopeShape,
      type: z.literal("failed"),
      error: agentRunFailureSchema,
    })
    .strict(),
]);

export type AgentRoleMessage = z.infer<typeof agentRoleSchema>;
export type AgentRunStatusMessage = z.infer<typeof agentRunStatusSchema>;
export type QuestMessage = z.infer<typeof questSchema>;
export type CouncilSessionMessage = z.infer<typeof councilSessionSchema>;
export type AgentDefinitionMessage = z.infer<typeof agentDefinitionSchema>;
export type AgentRunMessage = z.infer<typeof agentRunSchema>;
export type ContributionMessage = z.infer<typeof contributionSchema>;
export type FragmentMessage = z.infer<typeof fragmentSchema>;
export type DecisionMessage = z.infer<typeof decisionSchema>;
export type DecisionSourceMessage = z.infer<typeof decisionSourceSchema>;
export type DecisionRevisionMessage = z.infer<typeof decisionRevisionSchema>;
export type ReturnPointMessage = z.infer<typeof returnPointSchema>;
export type SessionSummaryMessage = z.infer<typeof sessionSummarySchema>;
export type SessionIndexMessage = z.infer<typeof sessionIndexSchema>;
export type ModelAdapterMessage = z.infer<typeof modelAdapterSchema>;
export type ModelUsageMessage = z.infer<typeof modelUsageSchema>;
export type ModelExecutionMessage = z.infer<typeof modelExecutionSchema>;
export type CouncilEventMessage = z.infer<typeof councilEventSchema>;
export type AssemblyCommand = z.infer<typeof assemblyCommandSchema>;
export type AgentWorkerModelOptions = z.infer<typeof agentWorkerModelOptionsSchema>;
export type AgentWorkerCommand = z.infer<typeof agentWorkerCommandSchema>;
export type AgentWorkerEvent = z.infer<typeof agentWorkerEventSchema>;

export const parseCouncilEvent = (input: unknown): CouncilEventMessage =>
  councilEventSchema.parse(input);

export const parseAssemblyCommand = (input: unknown): AssemblyCommand =>
  assemblyCommandSchema.parse(input);

export const parseAgentWorkerCommand = (input: unknown): AgentWorkerCommand =>
  agentWorkerCommandSchema.parse(input);

export const parseAgentWorkerEvent = (input: unknown): AgentWorkerEvent =>
  agentWorkerEventSchema.parse(input);
