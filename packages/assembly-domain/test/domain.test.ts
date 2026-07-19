import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  AGENT_RUN_STATUSES,
  RUN_EVENT_TYPES,
  type CouncilEvent,
} from "../src/index.js";

describe("assembly domain vocabulary", () => {
  it("keeps the first council roles explicit", () => {
    expect(AGENT_ROLES).toEqual(["architect", "trickster", "guardian"]);
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
});
