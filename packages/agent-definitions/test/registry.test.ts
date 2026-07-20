import { AGENT_ROLES } from "@naetia/assembly-domain";
import { describe, expect, it } from "vitest";

import {
  COUNCIL_AGENT_DEFINITIONS,
  FOCUSED_PARTY_AGENT_IDS,
  resolveCouncilAgentDefinitions,
} from "../src/index.js";

describe("Council registry", () => {
  it("defines one versioned identity for every member of the Council", () => {
    expect(COUNCIL_AGENT_DEFINITIONS).toHaveLength(9);
    expect(COUNCIL_AGENT_DEFINITIONS.map(({ role }) => role)).toEqual(
      AGENT_ROLES,
    );
    expect(new Set(COUNCIL_AGENT_DEFINITIONS.map(({ id }) => id)).size).toBe(9);
    for (const definition of COUNCIL_AGENT_DEFINITIONS) {
      expect(definition.name.trim()).not.toBe("");
      expect(definition.perspective.trim()).not.toBe("");
      expect(definition.instructions.trim()).not.toBe("");
    }
  });

  it("resolves a focused party in canonical Council order", () => {
    expect(
      resolveCouncilAgentDefinitions([
        "guardian",
        "builder",
        "architect",
      ]).map(({ role }) => role),
    ).toEqual(FOCUSED_PARTY_AGENT_IDS);
  });
});
