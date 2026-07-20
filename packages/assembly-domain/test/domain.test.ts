import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  AGENT_RUN_STATUSES,
  canTransitionFragmentStatus,
  FRAGMENT_STATUS_TRANSITIONS,
  RUN_EVENT_TYPES,
  type CouncilEvent,
} from "../src/index.js";

describe("assembly domain vocabulary", () => {
  it("keeps the whole council explicit", () => {
    expect(AGENT_ROLES).toEqual([
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
    expect(new Set(AGENT_ROLES).size).toBe(9);
  });

  it("models independent cancellation states", () => {
    expect(AGENT_RUN_STATUSES).toContain("cancelling");
    expect(AGENT_RUN_STATUSES).toContain("cancelled");
  });

  it("requires run events to carry a run identifier", () => {
    const event: CouncilEvent = {
      id: "event-1",
      type: "agent_run.started",
      sessionId: "session-1",
      runId: "run-1",
      occurredAt: "2026-07-19T10:00:00.000Z",
      payload: { processId: 4242 },
    };

    expect(RUN_EVENT_TYPES).toContain(event.type);
    expect("runId" in event && event.runId).toBe("run-1");
  });

  it("keeps fragment disposition under explicit human transitions", () => {
    expect(FRAGMENT_STATUS_TRANSITIONS.available).toEqual([
      "kept",
      "challenged",
      "composted",
    ]);
    expect(canTransitionFragmentStatus("challenged", "kept")).toBe(true);
    expect(canTransitionFragmentStatus("kept", "composted")).toBe(true);
    expect(canTransitionFragmentStatus("composted", "kept")).toBe(false);
    expect(canTransitionFragmentStatus("kept", "kept")).toBe(false);
  });
});
