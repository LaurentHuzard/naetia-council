import { describe, expect, it } from "vitest";

import { recommendDelegation } from "../src/orchestration/delegation-planner.js";

describe("delegation planner", () => {
  it("recommends a small general-purpose party", () => {
    expect(
      recommendDelegation({ title: "Choisir la persistance locale" }).map(
        ({ agentId }) => agentId,
      ),
    ).toEqual(["architect", "builder", "guardian"]);
  });

  it("calls specialists only when the quest asks for their mandate", () => {
    expect(
      recommendDelegation({ title: "Améliorer le prompt du modèle" }).map(
        ({ agentId }) => agentId,
      ),
    ).toEqual(["llm-genie", "architect", "trickster", "guardian"]);
    expect(
      recommendDelegation({ title: "Vérifier une documentation externe" }).map(
        ({ agentId }) => agentId,
      ),
    ).toEqual(["scout", "architect", "guardian"]);
  });
});
