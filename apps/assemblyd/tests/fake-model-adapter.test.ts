import { describe, expect, it } from "vitest";

import { FakeModelAdapter } from "../src/model-adapters/fake-model-adapter.js";

describe("FakeModelAdapter", () => {
  it("streams deterministic deltas", async () => {
    const adapter = new FakeModelAdapter();
    const events = [];

    for await (const event of adapter.stream(
      {
        agentId: "architect",
        quest: { title: "Choisir une direction" },
        latencyMs: 0,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "delta")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      content: expect.stringContaining("Choisir une direction"),
    });
  });

  it("stops promptly when aborted", async () => {
    const adapter = new FakeModelAdapter();
    const controller = new AbortController();
    const consume = async (): Promise<void> => {
      for await (const event of adapter.stream(
        {
          agentId: "guardian",
          quest: { title: "Protéger le rythme" },
          latencyMs: 1_000,
        },
        controller.signal,
      )) {
        // The first delayed delta must never be reached.
        void event;
      }
    };

    const pending = consume();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
