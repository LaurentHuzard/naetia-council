import {
  decisionDraftSchema,
  type DecisionDraftResultMessage,
  type ModelExecutionMessage,
} from "@naetia/assembly-protocol";

import type {
  ModelAdapter,
  ModelRequest,
} from "../model-adapters/model-adapter.js";
import type { SessionSnapshot } from "./council-orchestrator.js";

export type DecisionDraftErrorCode =
  | "DECISION_DRAFT_NOT_READY"
  | "DECISION_DRAFT_SOURCE_CONFLICT"
  | "DECISION_DRAFT_OUTPUT_INVALID";

export class DecisionDraftError extends Error {
  readonly code: DecisionDraftErrorCode;

  constructor(
    code: DecisionDraftErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DecisionDraftError";
    this.code = code;
  }
}

export interface DecisionDraftOrchestratorPort {
  draft(
    session: SessionSnapshot,
    fragmentIds: readonly string[],
    signal: AbortSignal,
  ): Promise<DecisionDraftResultMessage>;
}

export class DecisionDraftOrchestrator
  implements DecisionDraftOrchestratorPort
{
  readonly #modelAdapter: ModelAdapter;

  constructor(modelAdapter: ModelAdapter) {
    this.#modelAdapter = modelAdapter;
  }

  async draft(
    session: SessionSnapshot,
    fragmentIds: readonly string[],
    signal: AbortSignal,
  ): Promise<DecisionDraftResultMessage> {
    if (session.status !== "completed" || session.decision !== undefined) {
      throw new DecisionDraftError(
        "DECISION_DRAFT_NOT_READY",
        "A draft requires a completed Council session without a forged decision.",
      );
    }

    const selectedFragments = fragmentIds.map((fragmentId) => {
      const fragment = session.fragments.find(
        (candidate) => candidate.id === fragmentId,
      );
      if (fragment === undefined || fragment.status !== "kept") {
        throw new DecisionDraftError(
          "DECISION_DRAFT_SOURCE_CONFLICT",
          "Every draft source must be a kept fragment from this session.",
        );
      }
      const run = session.runs.find(
        (candidate) => candidate.runId === fragment.runId,
      );
      const definition = session.agentDefinitions.find(
        (candidate) => candidate.id === run?.agentDefinitionId,
      );
      return {
        id: fragment.id,
        agentName: definition?.name ?? "Voix du Council",
        content: fragment.content,
      };
    });

    const request = buildDecisionDraftRequest(session, selectedFragments);
    let completed:
      | Readonly<{ content: string; execution: ModelExecutionMessage }>
      | undefined;
    for await (const event of this.#modelAdapter.stream(request, signal)) {
      if (event.type === "completed") {
        completed = event;
      }
    }
    if (completed === undefined) {
      throw invalidOutput("The decision orchestrator returned no result.");
    }

    let rawDraft: unknown;
    try {
      rawDraft = JSON.parse(completed.content);
    } catch (error) {
      throw invalidOutput(
        "The decision orchestrator did not return strict JSON.",
        error,
      );
    }
    const draft = decisionDraftSchema.safeParse(rawDraft);
    if (!draft.success) {
      throw invalidOutput(
        "The decision orchestrator returned an invalid draft.",
        draft.error,
      );
    }

    return {
      draft: draft.data,
      sourceFragmentIds: [...fragmentIds],
      modelExecution: completed.execution,
    };
  }
}

function buildDecisionDraftRequest(
  session: SessionSnapshot,
  fragments: readonly Readonly<{
    id: string;
    agentName: string;
    content: string;
  }>[],
): ModelRequest {
  const sources = fragments
    .map(
      (fragment) =>
        `<fragment id="${escapeXml(fragment.id)}" agent="${escapeXml(fragment.agentName)}">\n${escapeXml(fragment.content)}\n</fragment>`,
    )
    .join("\n");

  return {
    agentId: "architect",
    agentName: "Orchestrateur de décision",
    perspective:
      "Synthèse fidèle des fragments conservés, sans effacer les tensions.",
    instructions: [
      "Prépare un brouillon éditable. Ne prends pas la décision et n’ajoute aucun fait absent des sources.",
      "Retourne exclusivement un objet JSON strict, sans Markdown ni texte autour.",
      "Utilise exactement ces cinq clés avec des chaînes non vides : statement, rationale, objection, reviewCondition, nextSmallStep.",
      "statement formule une décision vivante et concrète.",
      "rationale explique pourquoi elle est raisonnable maintenant.",
      "objection garde ouverte la tension ou le risque principal.",
      "reviewCondition donne un signal observable qui déclenchera une révision.",
      "nextSmallStep est une action courte, réversible et vérifiable.",
    ].join(" "),
    quest: {
      title: session.quest.title,
      context: [
        ...(session.quest.context === undefined
          ? []
          : [`Contexte initial : ${session.quest.context}`]),
        "Fragments KEEP sélectionnés :",
        sources,
      ].join("\n\n"),
    },
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function invalidOutput(message: string, cause?: unknown): DecisionDraftError {
  return new DecisionDraftError(
    "DECISION_DRAFT_OUTPUT_INVALID",
    message,
    cause === undefined ? undefined : { cause },
  );
}
