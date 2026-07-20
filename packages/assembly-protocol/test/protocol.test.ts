import { describe, expect, it } from "vitest";

import {
  agentWorkerCommandSchema,
  agentWorkerEventSchema,
  assemblyCommandSchema,
  councilEventSchema,
  parseAgentWorkerCommand,
  sessionIndexSchema,
  sessionSummarySchema,
} from "../src/index.js";

const occurredAt = "2026-07-19T10:00:00.000Z";
const architectDefinition = {
  id: "architect.v1",
  role: "architect",
  name: "Architect",
  perspective: "Structure et clarifie.",
  instructions: "Dégage le prochain geste vérifiable.",
  version: 1,
} as const;

describe("council events", () => {
  it("accepts a serializable run event envelope", () => {
    const input = {
      id: "event-1",
      type: "contribution.delta",
      sessionId: "session-1",
      runId: "run-1",
      occurredAt,
      payload: {
        contributionId: "contribution-1",
        delta: "Une structure claire",
        index: 0,
      },
    };

    const event = councilEventSchema.parse(JSON.parse(JSON.stringify(input)));

    expect(event.type).toBe("contribution.delta");
  });

  it("rejects a run event without its runId", () => {
    const result = councilEventSchema.safeParse({
      id: "event-1",
      type: "agent_run.started",
      sessionId: "session-1",
      occurredAt,
      payload: { processId: 42 },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a revision link on the child session creation event", () => {
    const event = councilEventSchema.parse({
      id: "event-revision-created",
      type: "session.created",
      sessionId: "session-revision",
      occurredAt,
      payload: {
        quest: {
          id: "quest-source",
          title: "Réviser une décision",
          createdAt: occurredAt,
        },
        session: {
          id: "session-revision",
          questId: "quest-source",
          status: "draft",
          createdAt: occurredAt,
          updatedAt: occurredAt,
          revisionOf: {
            sourceSessionId: "session-source",
            sourceDecisionId: "decision-source",
            intent: "Une nouvelle contrainte est apparue.",
          },
        },
      },
    });

    expect(event.type).toBe("session.created");
  });
});

describe("assembly commands", () => {
  it("accepts a variable Council delegation and rejects invalid selections", () => {
    const command = assemblyCommandSchema.parse({
      commandId: "command-convene-1",
      type: "session.convene",
      sessionId: "session-1",
      agentIds: ["architect", "builder", "guardian"],
    });

    if (command.type !== "session.convene") {
      throw new Error("Expected a session.convene command");
    }
    expect(command.agentIds).toEqual(["architect", "builder", "guardian"]);
    expect(
      assemblyCommandSchema.safeParse({
        commandId: "command-convene-empty",
        type: "session.convene",
        sessionId: "session-1",
        agentIds: [],
      }).success,
    ).toBe(false);
    expect(
      assemblyCommandSchema.safeParse({
        commandId: "command-convene-duplicate",
        type: "session.convene",
        sessionId: "session-1",
        agentIds: ["architect", "architect"],
      }).success,
    ).toBe(false);
    expect(
      assemblyCommandSchema.safeParse({
        commandId: "command-convene-unknown",
        type: "session.convene",
        sessionId: "session-1",
        agentIds: ["oracle"],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields at a serialized boundary", () => {
    const result = assemblyCommandSchema.safeParse({
      commandId: "command-1",
      type: "session.convene",
      sessionId: "session-1",
      sqlitePath: "/tmp/agents-write-directly.db",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a forge command with an explicit return point", () => {
    const command = assemblyCommandSchema.parse({
      commandId: "command-forge-1",
      type: "decision.forge",
      sessionId: "session-1",
      fragmentIds: ["fragment-architect", "fragment-trickster"],
      statement: "Ouvrir une porte réversible.",
      rationale: "Deux perspectives conservées soutiennent ce test.",
      objection: "La surcharge reste possible.",
      reviewCondition: "Réviser si la confusion augmente.",
      nextSmallStep: "Tester pendant dix minutes.",
    });

    expect(command.type).toBe("decision.forge");
  });

  it("rejects duplicate forge sources and a missing next step", () => {
    const duplicateSources = assemblyCommandSchema.safeParse({
      commandId: "command-forge-2",
      type: "decision.forge",
      sessionId: "session-1",
      fragmentIds: ["fragment-1", "fragment-1"],
      statement: "Décider.",
      rationale: "Une raison.",
      nextSmallStep: "Agir.",
    });
    const missingNextStep = assemblyCommandSchema.safeParse({
      commandId: "command-forge-3",
      type: "decision.forge",
      sessionId: "session-1",
      fragmentIds: ["fragment-1"],
      statement: "Décider.",
      rationale: "Une raison.",
    });

    expect(duplicateSources.success).toBe(false);
    expect(missingNextStep.success).toBe(false);
  });

  it("rejects whitespace-only optional human input", () => {
    const result = assemblyCommandSchema.safeParse({
      commandId: "command-challenge-1",
      type: "fragment.challenge",
      sessionId: "session-1",
      fragmentId: "fragment-1",
      prompt: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("accepts an explicit decision revision and rejects empty intent", () => {
    const command = assemblyCommandSchema.parse({
      commandId: "command-revision-1",
      type: "decision.revise",
      sessionId: "session-source",
      decisionId: "decision-source",
      intent: "Le risque observé change la prochaine délibération.",
    });
    const emptyIntent = assemblyCommandSchema.safeParse({
      commandId: "command-revision-2",
      type: "decision.revise",
      sessionId: "session-source",
      decisionId: "decision-source",
      intent: "   ",
    });

    expect(command.type).toBe("decision.revise");
    expect(emptyIntent.success).toBe(false);
  });
});

describe("Council outcomes", () => {
  it("rejects a forged decision without provenance", () => {
    const result = councilEventSchema.safeParse({
      id: "event-decision-1",
      type: "decision.forged",
      sessionId: "session-1",
      occurredAt,
      payload: {
        decision: {
          id: "decision-1",
          sessionId: "session-1",
          statement: "Une décision sans source.",
          rationale: "Elle ne doit pas passer.",
          sources: [],
          createdAt: occurredAt,
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("session index", () => {
  it("accepts compact created and forged session summaries", () => {
    const index = sessionIndexSchema.parse({
      sessions: [
        {
          sessionId: "session-forged",
          quest: { questId: "quest-forged", title: "Reprendre la décision" },
          status: "completed",
          createdAt: occurredAt,
          lastActivityAt: "2026-07-19T10:05:00.000Z",
          eventCursor: 42,
          hasDecision: true,
          nextSmallStep: "Relire le pacte demain.",
        },
        {
          sessionId: "session-created",
          quest: { questId: "quest-created", title: "Convoquer plus tard" },
          status: "created",
          createdAt: occurredAt,
          lastActivityAt: occurredAt,
          eventCursor: 1,
          hasDecision: false,
        },
      ],
    });

    expect(index.sessions).toHaveLength(2);
  });

  it("requires a next step for a forged session", () => {
    const result = sessionSummarySchema.safeParse({
      sessionId: "session-forged",
      quest: { questId: "quest-forged", title: "Reprendre la décision" },
      status: "completed",
      createdAt: occurredAt,
      lastActivityAt: occurredAt,
      eventCursor: 42,
      hasDecision: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects snapshot cargo and unknown fields from the compact index", () => {
    const result = sessionSummarySchema.safeParse({
      sessionId: "session-created",
      quest: { questId: "quest-created", title: "Convoquer plus tard" },
      status: "created",
      createdAt: occurredAt,
      lastActivityAt: occurredAt,
      eventCursor: 1,
      hasDecision: false,
      events: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a compact revision link and rejects unknown revision cargo", () => {
    const revision = {
      sourceSessionId: "session-source",
      sourceDecisionId: "decision-source",
      intent: "Une contrainte nouvelle est apparue.",
    };
    const summary = sessionSummarySchema.parse({
      sessionId: "session-revision",
      quest: { questId: "quest-source", title: "Réviser le passage" },
      status: "created",
      createdAt: occurredAt,
      lastActivityAt: occurredAt,
      eventCursor: 43,
      revisionOf: revision,
      hasDecision: false,
    });
    const invalid = sessionSummarySchema.safeParse({
      ...summary,
      revisionOf: { ...revision, sourceDecision: { statement: "copie" } },
    });

    expect(summary.revisionOf).toEqual(revision);
    expect(invalid.success).toBe(false);
  });
});

describe("agent worker IPC", () => {
  it("accepts a deterministic fake-model start command", () => {
    const command = parseAgentWorkerCommand({
      type: "start",
      runId: "run-architect",
      sessionId: "session-1",
      agentDefinition: architectDefinition,
      quest: { title: "Ouvrir la porte" },
      model: { adapter: "fake", latencyMs: 5, failAtDelta: 2 },
    });

    expect(command.type).toBe("start");
  });

  it("rejects an invalid IPC command", () => {
    const result = agentWorkerCommandSchema.safeParse({
      type: "start",
      runId: "run-1",
      sessionId: "session-1",
      agentDefinition: { ...architectDefinition, role: "oracle" },
      quest: { title: "" },
      model: { adapter: "fake" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid worker event before orchestration", () => {
    const result = agentWorkerEventSchema.safeParse({
      type: "delta",
      eventId: "event-1",
      sessionId: "session-1",
      runId: "run-1",
      occurredAt,
      contributionId: "contribution-1",
      delta: "Signal partiel",
      index: -1,
    });

    expect(result.success).toBe(false);
  });
});
