import { describe, expect, it, vi } from "vitest";

import type {
  ModelEvent,
  ModelRequest,
} from "../src/model-adapters/model-adapter.js";
import type { SessionSnapshot } from "../src/orchestration/council-orchestrator.js";
import {
  DecisionDraftOrchestrator,
} from "../src/orchestration/decision-draft-orchestrator.js";

describe("DecisionDraftOrchestrator", () => {
  it("turns kept fragments into a structured, sourced and non-persisted draft", async () => {
    const requests: ModelRequest[] = [];
    const stream = vi.fn((request: ModelRequest) => {
      requests.push(request);
      return events(
        JSON.stringify({
          statement: "Tester une délégation resserrée.",
          rationale: "Les fragments convergent vers une preuve courte.",
          objection: "Une voix utile peut rester absente.",
          reviewCondition: "Réviser si un risque sans propriétaire apparaît.",
          nextSmallStep: "Lancer une session de dix minutes.",
        }),
      );
    });
    const session = completedSession();
    const before = structuredClone(session);
    const orchestrator = new DecisionDraftOrchestrator({ stream });

    const result = await orchestrator.draft(
      session,
      ["fragment-architect"],
      new AbortController().signal,
    );

    expect(result).toEqual({
      draft: {
        statement: "Tester une délégation resserrée.",
        rationale: "Les fragments convergent vers une preuve courte.",
        objection: "Une voix utile peut rester absente.",
        reviewCondition: "Réviser si un risque sans propriétaire apparaît.",
        nextSmallStep: "Lancer une session de dix minutes.",
      },
      sourceFragmentIds: ["fragment-architect"],
      modelExecution: {
        adapter: "openai-compatible",
        model: "local-council-model",
        durationMs: 420,
      },
    });
    expect(session).toEqual(before);
    const request = requests[0]!;
    expect(request.agentName).toBe("Orchestrateur de décision");
    expect(request.quest.context).toContain("fragment-architect");
    expect(request.quest.context).toContain("Architect");
    expect(request.quest.context).toContain("Garder une structure simple.");
  });

  it("rejects non-JSON output instead of inventing a fallback", async () => {
    const orchestrator = new DecisionDraftOrchestrator({
      stream: () => events("Voici une synthèse libre."),
    });

    await expect(
      orchestrator.draft(
        completedSession(),
        ["fragment-architect"],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "DECISION_DRAFT_OUTPUT_INVALID" });
  });

  it("rejects a source which is not a kept fragment", async () => {
    const stream = vi.fn(() => events("{}"));
    const orchestrator = new DecisionDraftOrchestrator({ stream });

    await expect(
      orchestrator.draft(
        completedSession(),
        ["fragment-guardian"],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "DECISION_DRAFT_SOURCE_CONFLICT" });
    expect(stream).not.toHaveBeenCalled();
  });
});

async function* events(content: string): AsyncIterable<ModelEvent> {
  yield {
    type: "completed",
    content,
    execution: {
      adapter: "openai-compatible",
      model: "local-council-model",
      durationMs: 420,
    },
  };
}

function completedSession(): SessionSnapshot {
  return {
    sessionId: "session-1",
    quest: {
      questId: "quest-1",
      title: "Choisir la prochaine expérience",
      context: "Rester local et réversible.",
    },
    status: "completed",
    createdAt: "2026-08-23T10:00:00.000Z",
    eventCursor: 12,
    agentDefinitions: [
      {
        id: "architect.v1",
        role: "architect",
        name: "Architect",
        perspective: "Structure",
        instructions: "Clarifie",
        version: 1,
      },
      {
        id: "guardian.v1",
        role: "guardian",
        name: "Guardian",
        perspective: "Risques",
        instructions: "Protège",
        version: 1,
      },
    ],
    delegationRecommendation: [
      { agentId: "architect", reason: "Structurer la décision." },
    ],
    runs: [
      {
        runId: "run-architect",
        sessionId: "session-1",
        agentId: "architect",
        agentDefinitionId: "architect.v1",
        status: "completed",
        contribution: "Garder une structure simple.",
      },
      {
        runId: "run-guardian",
        sessionId: "session-1",
        agentId: "guardian",
        agentDefinitionId: "guardian.v1",
        status: "completed",
        contribution: "Conserver un arrêt explicite.",
      },
    ],
    fragments: [
      {
        id: "fragment-architect",
        sessionId: "session-1",
        contributionId: "contribution-architect",
        runId: "run-architect",
        content: "Garder une structure simple.",
        status: "kept",
        createdAt: "2026-08-23T10:01:00.000Z",
        updatedAt: "2026-08-23T10:02:00.000Z",
      },
      {
        id: "fragment-guardian",
        sessionId: "session-1",
        contributionId: "contribution-guardian",
        runId: "run-guardian",
        content: "Conserver un arrêt explicite.",
        status: "available",
        createdAt: "2026-08-23T10:01:00.000Z",
        updatedAt: "2026-08-23T10:01:00.000Z",
      },
    ],
    events: [],
  };
}
