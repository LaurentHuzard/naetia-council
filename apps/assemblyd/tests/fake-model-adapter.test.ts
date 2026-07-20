import { describe, expect, it } from "vitest";

import { FakeModelAdapter } from "../src/model-adapters/fake-model-adapter.js";

describe("FakeModelAdapter", () => {
  it("streams deterministic deltas", async () => {
    const adapter = new FakeModelAdapter();
    const events = [];

    for await (const event of adapter.stream(
      {
        agentId: "architect",
        agentName: "Architect",
        perspective: "Structure et clarifie.",
        instructions: "Transforme la quête en prochain geste concret.",
        quest: { title: "Choisir une direction" },
        latencyMs: 0,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "delta")).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      content: expect.stringContaining("Choisir une direction"),
    });
  });

  it("uses any Council definition instead of a closed role table", async () => {
    const adapter = new FakeModelAdapter();
    const events = [];

    for await (const event of adapter.stream(
      {
        agentId: "inner-child",
        agentName: "Inner Child",
        perspective: "Simplicité, intuition et curiosité.",
        instructions: "Pose la question naïve qui simplifie.",
        quest: { title: "Rendre le Council accueillant" },
        latencyMs: 0,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "completed",
      content: expect.stringContaining("Inner Child"),
    });
  });

  it("stops promptly when aborted", async () => {
    const adapter = new FakeModelAdapter();
    const controller = new AbortController();
    const consume = async (): Promise<void> => {
      for await (const event of adapter.stream(
        {
          agentId: "guardian",
          agentName: "Guardian",
          perspective: "Détecte les risques et la surcharge.",
          instructions: "Protège le rythme et le pouvoir de décision humain.",
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
