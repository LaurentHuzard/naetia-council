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
