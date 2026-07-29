import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  AGENT_RUN_STATUSES,
  canTransitionFragmentStatus,
  FRAGMENT_STATUS_TRANSITIONS,
  ModelProfileRegistry,
  ModelSelectionError,
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

describe("per-agent model profile selection", () => {
  const registry = new ModelProfileRegistry({
    providers: [
      {
        id: "codex-cli",
        label: "Codex CLI",
        adapter: "codex-cli",
        locality: "remote",
        concurrency: 3,
      },
      {
        id: "llama-local",
        label: "llama.cpp local",
        adapter: "openai-compatible",
        locality: "local",
        concurrency: 1,
      },
    ],
    models: [
      {
        id: "codex-default",
        label: "Codex default",
        providerId: "codex-cli",
      },
      {
        id: "local-qwen",
        label: "Qwen local",
        providerId: "llama-local",
        model: "qwen2.5-coder-7b",
      },
    ],
    agentPolicies: [
      {
        agentId: "architect",
        defaultModelProfileId: "codex-default",
        allowedModelProfileIds: ["codex-default", "local-qwen"],
      },
      {
        agentId: "archivist",
        defaultModelProfileId: "local-qwen",
        allowedModelProfileIds: ["local-qwen", "codex-default"],
      },
    ],
    councilDefaultModelProfileId: "codex-default",
  });

  it("resolves independent defaults for each agent", () => {
    expect(registry.resolve({ agentId: "architect" })).toMatchObject({
      agentId: "architect",
      providerProfileId: "codex-cli",
      modelProfileId: "codex-default",
      locality: "remote",
    });
    expect(registry.resolve({ agentId: "archivist" })).toMatchObject({
      agentId: "archivist",
      providerProfileId: "llama-local",
      modelProfileId: "local-qwen",
      model: "qwen2.5-coder-7b",
      locality: "local",
    });
  });

  it("allows an explicit selection without mutating another agent", () => {
    const architect = registry.resolve({
      agentId: "architect",
      explicitModelProfileId: "local-qwen",
    });
    const archivist = registry.resolve({ agentId: "archivist" });

    expect(architect.modelProfileId).toBe("local-qwen");
    expect(archivist.modelProfileId).toBe("local-qwen");
    expect(registry.resolve({ agentId: "architect" }).modelProfileId).toBe(
      "codex-default",
    );
  });

  it("rejects a model outside the agent allowlist", () => {
    const restricted = new ModelProfileRegistry({
      providers: registry.listProviders(),
      models: registry.listModels(),
      agentPolicies: [
        {
          agentId: "guardian",
          defaultModelProfileId: "codex-default",
          allowedModelProfileIds: ["codex-default"],
        },
      ],
    });

    expect(() =>
      restricted.resolve({
        agentId: "guardian",
        explicitModelProfileId: "local-qwen",
      }),
    ).toThrowError(
      expect.objectContaining<ModelSelectionError>({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );
  });

  it("rejects invalid provider concurrency and dangling providers", () => {
    expect(
      () =>
        new ModelProfileRegistry({
          providers: [
            {
              id: "broken",
              label: "Broken",
              adapter: "fake",
              locality: "local",
              concurrency: 0,
            },
          ],
          models: [],
          agentPolicies: [],
        }),
    ).toThrowError(
      expect.objectContaining<ModelSelectionError>({
        code: "PROVIDER_CONCURRENCY_INVALID",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: [],
          models: [
            {
              id: "orphan",
              label: "Orphan",
              providerId: "missing",
            },
          ],
          agentPolicies: [],
        }),
    ).toThrowError(
      expect.objectContaining<ModelSelectionError>({
        code: "MODEL_PROVIDER_NOT_FOUND",
      }),
    );
  });
});
