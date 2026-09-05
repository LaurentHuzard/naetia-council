import type { AgentRole } from "./entities.js";

export type ModelAdapterId = "fake" | "codex-cli" | "openai-compatible";
export type ProviderLocality = "local" | "remote";

export interface ProviderProfile {
  readonly id: string;
  readonly label: string;
  readonly adapter: ModelAdapterId;
  readonly locality: ProviderLocality;
  readonly concurrency: number;
}

export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly model?: string;
}

export interface AgentModelPolicy {
  readonly agentId: AgentRole;
  readonly defaultModelProfileId?: string;
  readonly allowedModelProfileIds: readonly string[];
}

export interface RunModelSelection {
  readonly agentId: AgentRole;
  readonly providerProfileId: string;
  readonly providerLabel: string;
  readonly adapter: ModelAdapterId;
  readonly locality: ProviderLocality;
  readonly modelProfileId: string;
  readonly modelLabel: string;
  readonly model?: string;
}

export type ModelSelectionErrorCode =
  | "DUPLICATE_PROVIDER_PROFILE"
  | "DUPLICATE_MODEL_PROFILE"
  | "DUPLICATE_AGENT_POLICY"
  | "DUPLICATE_ALLOWED_MODEL_PROFILE"
  | "MODEL_PROVIDER_NOT_FOUND"
  | "MODEL_PROFILE_NOT_ALLOWED"
  | "MODEL_PROFILE_NOT_FOUND"
  | "MODEL_SELECTION_UNAVAILABLE"
  | "PROVIDER_CONCURRENCY_INVALID";

export class ModelSelectionError extends Error {
  readonly code: ModelSelectionErrorCode;

  constructor(code: ModelSelectionErrorCode, message: string) {
    super(message);
    this.name = "ModelSelectionError";
    this.code = code;
  }
}

export interface ModelProfileRegistryInput {
  readonly providers: readonly ProviderProfile[];
  readonly models: readonly ModelProfile[];
  readonly agentPolicies: readonly AgentModelPolicy[];
  readonly councilDefaultModelProfileId?: string;
}

export interface ResolveAgentModelSelectionInput {
  readonly agentId: AgentRole;
  readonly explicitModelProfileId?: string;
}

export class ModelProfileRegistry {
  readonly #providers: ReadonlyMap<string, ProviderProfile>;
  readonly #models: ReadonlyMap<string, ModelProfile>;
  readonly #agentPolicies: ReadonlyMap<AgentRole, AgentModelPolicy>;
  readonly #councilDefaultModelProfileId: string | undefined;

  constructor(input: ModelProfileRegistryInput) {
    this.#providers = uniqueMap(
      input.providers,
      "DUPLICATE_PROVIDER_PROFILE",
      "provider profile",
    );
    this.#models = uniqueMap(
      input.models,
      "DUPLICATE_MODEL_PROFILE",
      "model profile",
    );
    this.#agentPolicies = uniqueAgentPolicyMap(input.agentPolicies);
    this.#councilDefaultModelProfileId = input.councilDefaultModelProfileId;

    for (const provider of this.#providers.values()) {
      if (!Number.isInteger(provider.concurrency) || provider.concurrency < 1) {
        throw new ModelSelectionError(
          "PROVIDER_CONCURRENCY_INVALID",
          `Provider profile ${provider.id} must define a positive integer concurrency`,
        );
      }
    }

    for (const model of this.#models.values()) {
      if (!this.#providers.has(model.providerId)) {
        throw new ModelSelectionError(
          "MODEL_PROVIDER_NOT_FOUND",
          `Model profile ${model.id} references unknown provider ${model.providerId}`,
        );
      }
    }

    if (this.#councilDefaultModelProfileId !== undefined) {
      this.#requireModel(this.#councilDefaultModelProfileId);
    }

    for (const policy of this.#agentPolicies.values()) {
      const seenModelProfileIds = new Set<string>();
      for (const profileId of policy.allowedModelProfileIds) {
        if (seenModelProfileIds.has(profileId)) {
          throw new ModelSelectionError(
            "DUPLICATE_ALLOWED_MODEL_PROFILE",
            `Model profile ${profileId} is allowed more than once for agent ${policy.agentId}`,
          );
        }
        seenModelProfileIds.add(profileId);
      }
      for (const profileId of policy.allowedModelProfileIds) {
        this.#requireModel(profileId);
      }

      const defaultModelProfileId =
        policy.defaultModelProfileId ?? this.#councilDefaultModelProfileId;
      if (defaultModelProfileId === undefined) {
        continue;
      }

      this.#requireModel(defaultModelProfileId);
      if (!policy.allowedModelProfileIds.includes(defaultModelProfileId)) {
        throw new ModelSelectionError(
          "MODEL_PROFILE_NOT_ALLOWED",
          `Default model profile ${defaultModelProfileId} is not allowed for agent ${policy.agentId}`,
        );
      }
    }
  }

  listProviders(): readonly ProviderProfile[] {
    return [...this.#providers.values()];
  }

  listModels(): readonly ModelProfile[] {
    return [...this.#models.values()];
  }

  allowedModelsFor(agentId: AgentRole): readonly ModelProfile[] {
    return this.#allowedModelProfileIdsFor(agentId).map((profileId) =>
      this.#requireModel(profileId),
    );
  }

  resolve({
    agentId,
    explicitModelProfileId,
  }: ResolveAgentModelSelectionInput): RunModelSelection {
    const policy = this.#agentPolicies.get(agentId);
    const modelProfileId =
      explicitModelProfileId ??
      policy?.defaultModelProfileId ??
      this.#councilDefaultModelProfileId;

    if (modelProfileId === undefined) {
      throw new ModelSelectionError(
        "MODEL_SELECTION_UNAVAILABLE",
        `No model profile is available for agent ${agentId}`,
      );
    }

    if (!this.#allowedModelProfileIdsFor(agentId).includes(modelProfileId)) {
      throw new ModelSelectionError(
        "MODEL_PROFILE_NOT_ALLOWED",
        `Model profile ${modelProfileId} is not allowed for agent ${agentId}`,
      );
    }

    const modelProfile = this.#requireModel(modelProfileId);
    const providerProfile = this.#providers.get(modelProfile.providerId);
    if (providerProfile === undefined) {
      throw new ModelSelectionError(
        "MODEL_PROVIDER_NOT_FOUND",
        `Model profile ${modelProfile.id} references unknown provider ${modelProfile.providerId}`,
      );
    }

    return Object.freeze({
      agentId,
      providerProfileId: providerProfile.id,
      providerLabel: providerProfile.label,
      adapter: providerProfile.adapter,
      locality: providerProfile.locality,
      modelProfileId: modelProfile.id,
      modelLabel: modelProfile.label,
      ...(modelProfile.model === undefined ? {} : { model: modelProfile.model }),
    });
  }

  #requireModel(profileId: string): ModelProfile {
    const model = this.#models.get(profileId);
    if (model === undefined) {
      throw new ModelSelectionError(
        "MODEL_PROFILE_NOT_FOUND",
        `Unknown model profile ${profileId}`,
      );
    }
    return model;
  }

  #allowedModelProfileIdsFor(agentId: AgentRole): readonly string[] {
    const policy = this.#agentPolicies.get(agentId);
    if (policy !== undefined) {
      return policy.allowedModelProfileIds;
    }

    return this.#councilDefaultModelProfileId === undefined
      ? []
      : [this.#councilDefaultModelProfileId];
  }
}

function uniqueMap<T extends Readonly<{ id: string }>>(
  values: readonly T[],
  duplicateCode: Extract<
    ModelSelectionErrorCode,
    "DUPLICATE_PROVIDER_PROFILE" | "DUPLICATE_MODEL_PROFILE"
  >,
  noun: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) {
      throw new ModelSelectionError(
        duplicateCode,
        `Duplicate ${noun} ${value.id}`,
      );
    }
    result.set(value.id, Object.freeze({ ...value }));
  }
  return result;
}

function uniqueAgentPolicyMap(
  policies: readonly AgentModelPolicy[],
): ReadonlyMap<AgentRole, AgentModelPolicy> {
  const result = new Map<AgentRole, AgentModelPolicy>();
  for (const policy of policies) {
    if (result.has(policy.agentId)) {
      throw new ModelSelectionError(
        "DUPLICATE_AGENT_POLICY",
        `Duplicate model policy for agent ${policy.agentId}`,
      );
    }
    result.set(
      policy.agentId,
      Object.freeze({
        ...policy,
        allowedModelProfileIds: Object.freeze([
          ...policy.allowedModelProfileIds,
        ]),
      }),
    );
  }
  return result;
}
