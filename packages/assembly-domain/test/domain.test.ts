import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  AGENT_RUN_STATUSES,
  canTransitionFragmentStatus,
  FRAGMENT_STATUS_TRANSITIONS,
  ModelProfileRegistry,
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
      {
        agentId: "builder",
        defaultModelProfileId: "codex-default",
        allowedModelProfileIds: ["codex-default"],
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

  it("freezes an explicit selection without mutating agent defaults", () => {
    const builderBefore = registry.resolve({ agentId: "builder" });
    const architect = registry.resolve({
      agentId: "architect",
      explicitModelProfileId: "local-qwen",
    });
    const builderAfter = registry.resolve({ agentId: "builder" });

    expect(architect).toEqual({
      agentId: "architect",
      providerProfileId: "llama-local",
      providerLabel: "llama.cpp local",
      adapter: "openai-compatible",
      locality: "local",
      modelProfileId: "local-qwen",
      modelLabel: "Qwen local",
      model: "qwen2.5-coder-7b",
    });
    expect(Object.isFrozen(architect)).toBe(true);
    expect(builderAfter).toEqual(builderBefore);
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
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );
  });

  it("keeps agents without a policy bounded to the Council default", () => {
    expect(
      registry.allowedModelsFor("guardian").map((profile) => profile.id),
    ).toEqual(["codex-default"]);
    expect(registry.resolve({ agentId: "guardian" }).modelProfileId).toBe(
      "codex-default",
    );
    expect(() =>
      registry.resolve({
        agentId: "guardian",
        explicitModelProfileId: "local-qwen",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );
  });

  it("uses the Council default when an agent policy permits it", () => {
    const fallback = new ModelProfileRegistry({
      providers: registry.listProviders(),
      models: registry.listModels(),
      agentPolicies: [
        {
          agentId: "guardian",
          allowedModelProfileIds: ["local-qwen", "codex-default"],
        },
      ],
      councilDefaultModelProfileId: "codex-default",
    });

    expect(
      fallback.allowedModelsFor("guardian").map((profile) => profile.id),
    ).toEqual(["local-qwen", "codex-default"]);
    expect(fallback.resolve({ agentId: "guardian" }).modelProfileId).toBe(
      "codex-default",
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid provider concurrency %s",
    (concurrency) => {
      expect(
        () =>
          new ModelProfileRegistry({
            providers: [
              {
                id: "broken",
                label: "Broken",
                adapter: "fake",
                locality: "local",
                concurrency,
              },
            ],
            models: [],
            agentPolicies: [],
          }),
      ).toThrowError(
        expect.objectContaining({
          code: "PROVIDER_CONCURRENCY_INVALID",
        }),
      );
    },
  );

  it("rejects model profiles that reference a missing provider", () => {
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
      expect.objectContaining({
        code: "MODEL_PROVIDER_NOT_FOUND",
      }),
    );
  });

  it("rejects dangling model profile references", () => {
    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [],
          councilDefaultModelProfileId: "missing",
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_FOUND",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              allowedModelProfileIds: ["missing"],
            },
          ],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_FOUND",
      }),
    );
  });

  it("rejects defaults outside an agent allowlist", () => {
    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              defaultModelProfileId: "local-qwen",
              allowedModelProfileIds: ["codex-default"],
            },
          ],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              allowedModelProfileIds: ["local-qwen"],
            },
          ],
          councilDefaultModelProfileId: "codex-default",
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );
  });

  it("rejects duplicate registry and policy entries", () => {
    const provider = registry.listProviders()[0];
    const model = registry.listModels()[0];

    expect(provider).toBeDefined();
    expect(model).toBeDefined();
    if (provider === undefined || model === undefined) {
      throw new Error("Expected registry fixtures");
    }

    expect(
      () =>
        new ModelProfileRegistry({
          providers: [provider, provider],
          models: [],
          agentPolicies: [],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_PROVIDER_PROFILE",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: [model, model],
          agentPolicies: [],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_MODEL_PROFILE",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              allowedModelProfileIds: ["codex-default"],
            },
            {
              agentId: "guardian",
              allowedModelProfileIds: ["codex-default"],
            },
          ],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_AGENT_POLICY",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              allowedModelProfileIds: ["codex-default", "codex-default"],
            },
          ],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_ALLOWED_MODEL_PROFILE",
      }),
    );

    expect(
      () =>
        new ModelProfileRegistry({
          providers: registry.listProviders(),
          models: registry.listModels(),
          agentPolicies: [
            {
              agentId: "guardian",
              allowedModelProfileIds: ["missing", "missing"],
            },
          ],
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_ALLOWED_MODEL_PROFILE",
      }),
    );
  });

  it("reports when no model selection is available", () => {
    const unavailable = new ModelProfileRegistry({
      providers: registry.listProviders(),
      models: registry.listModels(),
      agentPolicies: [],
    });

    expect(unavailable.allowedModelsFor("guardian")).toEqual([]);
    expect(() => unavailable.resolve({ agentId: "guardian" })).toThrowError(
      expect.objectContaining({
        code: "MODEL_SELECTION_UNAVAILABLE",
      }),
    );
    expect(() =>
      unavailable.resolve({
        agentId: "guardian",
        explicitModelProfileId: "codex-default",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROFILE_NOT_ALLOWED",
      }),
    );
  });
});
