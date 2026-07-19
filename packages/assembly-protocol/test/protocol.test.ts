import { describe, expect, it } from "vitest";

import {
  agentWorkerCommandSchema,
  agentWorkerEventSchema,
  assemblyCommandSchema,
  councilEventSchema,
  parseAgentWorkerCommand,
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
});

describe("assembly commands", () => {
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
