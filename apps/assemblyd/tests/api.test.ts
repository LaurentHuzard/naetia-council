import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/api/app.js";
import type { DecisionDraftOrchestratorPort } from "../src/orchestration/decision-draft-orchestrator.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe.sequential("assemblyd HTTP API", () => {
  it("reports its health", async () => {
    const app = trackedApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "assemblyd",
      modelAdapter: "fake",
    });
  });

  it("reports the configured OpenAI-compatible model without exposing its endpoint or key", async () => {
    const app = trackedApp({
      modelRuntime: {
        adapter: "openai-compatible",
        model: {
          adapter: "openai-compatible",
          url: "http://compute-host:8003/v1/chat/completions",
          model: "local-council-model",
          maxTokens: 512,
          revealDelayMs: 0,
        },
        runTimeoutMs: 5_000,
        workerEnvironment: {
          OPENAI_COMPATIBLE_API_KEY: "must-not-leak",
        },
      },
    });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "assemblyd",
      modelAdapter: "openai-compatible",
      model: "local-council-model",
    });
    expect(response.body).not.toContain("compute-host");
    expect(response.body).not.toContain("must-not-leak");
  });

  it("lists recent sessions by durable activity without snapshot cargo", async () => {
    const app = trackedApp();
    const empty = await app.inject({ method: "GET", url: "/sessions" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ sessions: [] });

    const firstCreation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        quest: { title: "Première quête", context: "Ne pas indexer ce contexte" },
      },
    });
    const first = firstCreation.json<{ sessionId: string }>();
    const secondCreation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Deuxième quête" } },
    });
    const second = secondCreation.json<{ sessionId: string }>();

    const createdIndex = await app.inject({ method: "GET", url: "/sessions" });
    const createdSessions = createdIndex.json<SessionIndexResponse>().sessions;
    expect(createdSessions.map(({ sessionId }) => sessionId)).toEqual([
      second.sessionId,
      first.sessionId,
    ]);
    expect(createdSessions[1]).toMatchObject({
      quest: { title: "Première quête" },
      status: "created",
      hasDecision: false,
    });
    expect(createdSessions[1]?.quest).not.toHaveProperty("context");
    expect(createdSessions[1]).not.toHaveProperty("events");
    expect(createdSessions[1]).not.toHaveProperty("runs");

    const convening = await app.inject({
      method: "POST",
      url: `/sessions/${first.sessionId}/convene`,
    });
    expect(convening.statusCode).toBe(202);
    const recent = await app.inject({ method: "GET", url: "/sessions?limit=1" });
    expect(recent.json<SessionIndexResponse>().sessions).toEqual([
      expect.objectContaining({
        sessionId: first.sessionId,
        status: "running",
        hasDecision: false,
      }),
    ]);

    const repeatedRead = await app.inject({ method: "GET", url: "/sessions" });
    const repeatedAgain = await app.inject({ method: "GET", url: "/sessions" });
    expect(repeatedAgain.json()).toEqual(repeatedRead.json());
  });

  it("rejects invalid session index queries", async () => {
    const app = trackedApp();
    for (const url of [
      "/sessions?limit=0",
      "/sessions?limit=51",
      "/sessions?limit=1.5",
      "/sessions?limit=nope",
      "/sessions?unexpected=true",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    }
  });

  it("creates, convenes and observes a Council session", async () => {
    const app = trackedApp();
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Choisir le prochain geste", context: "Local-first" } },
    });
    expect(creation.statusCode).toBe(201);
    const created = creation.json<{ sessionId: string }>();

    const convening = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    expect(convening.statusCode).toBe(202);
    expect(convening.json<{ runs: unknown[] }>().runs).toHaveLength(3);

    const observed = await waitForCompletedSession(app, created.sessionId);
    expect(observed.runs).toHaveLength(3);
    expect(observed.runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("accepts a Full Council selection and rejects malformed delegations", async () => {
    const app = trackedApp();
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Revue fondatrice" } },
    });
    const created = creation.json<{ sessionId: string }>();
    const agentIds = [
      "architect",
      "builder",
      "trickster",
      "guardian",
      "archivist",
      "game-designer",
      "llm-genie",
      "inner-child",
      "scout",
    ];
    const fullCouncil = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
      payload: { agentIds },
    });

    expect(fullCouncil.statusCode).toBe(202);
    expect(fullCouncil.json<{ runs: unknown[] }>().runs).toHaveLength(9);
    expect(
      fullCouncil.json<{ agentDefinitions: unknown[] }>().agentDefinitions,
    ).toHaveLength(9);

    for (const invalidAgentIds of [
      [],
      ["architect", "architect"],
      ["oracle"],
    ]) {
      const another = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { quest: { title: "Délégation invalide" } },
      });
      const response = await app.inject({
        method: "POST",
        url: `/sessions/${another.json<{ sessionId: string }>().sessionId}/convene`,
        payload: { agentIds: invalidAgentIds },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    }
  });

  it("rejects malformed serialized input", async () => {
    const app = trackedApp();
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "" }, unexpected: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_REQUEST" });
  });

  it("keeps, challenges, composts and forges durable Council outcomes", async () => {
    const app = trackedApp();
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Forger sans perdre les objections" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    const completed = await waitForCompletedSession(app, created.sessionId);
    expect(completed.fragments).toHaveLength(3);
    const [keptFragment, challengedFragment, compostedFragment] =
      completed.fragments;
    expect(keptFragment).toBeDefined();
    expect(challengedFragment).toBeDefined();
    expect(compostedFragment).toBeDefined();

    const kept = await app.inject({
      method: "POST",
      url: `/fragments/${keptFragment!.id}/keep`,
    });
    expect(kept.statusCode).toBe(200);
    const keptSnapshot = kept.json<SessionResponse>();
    expect(
      keptSnapshot.fragments.find((fragment) => fragment.id === keptFragment!.id)
        ?.status,
    ).toBe("kept");
    const keepRetry = await app.inject({
      method: "POST",
      url: `/fragments/${keptFragment!.id}/keep`,
    });
    expect(keepRetry.json<SessionResponse>().eventCursor).toBe(
      keptSnapshot.eventCursor,
    );

    const challenged = await app.inject({
      method: "POST",
      url: `/fragments/${challengedFragment!.id}/challenge`,
      payload: { prompt: "Quelle objection mérite de rester visible ?" },
    });
    expect(challenged.statusCode).toBe(200);
    expect(
      challenged
        .json<SessionResponse>()
        .fragments.find((fragment) => fragment.id === challengedFragment!.id)
        ?.status,
    ).toBe("challenged");

    const composted = await app.inject({
      method: "POST",
      url: `/fragments/${compostedFragment!.id}/compost`,
    });
    expect(composted.statusCode).toBe(200);
    expect(
      composted
        .json<SessionResponse>()
        .fragments.find((fragment) => fragment.id === compostedFragment!.id)
        ?.status,
    ).toBe("composted");

    const duplicateSources = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [keptFragment!.id, keptFragment!.id],
        statement: "Ne doit pas passer",
        rationale: "La provenance est dupliquée.",
        nextSmallStep: "Corriger",
      },
    });
    expect(duplicateSources.statusCode).toBe(400);

    const nonKeptSource = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [challengedFragment!.id],
        statement: "Ne doit pas passer",
        rationale: "Le fragment n’est pas conservé.",
        nextSmallStep: "Garder explicitement",
      },
    });
    expect(nonKeptSource.statusCode).toBe(409);
    expect(nonKeptSource.json()).toMatchObject({
      error: "DECISION_SOURCE_CONFLICT",
    });

    const forge = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [keptFragment!.id],
        statement: "Ouvrir une porte réversible.",
        rationale: "Le fragment conservé donne une première preuve.",
        objection: "Une surcharge reste possible.",
        reviewCondition: "Réviser si la confusion augmente.",
        nextSmallStep: "Tester pendant dix minutes.",
      },
    });
    expect(forge.statusCode).toBe(200);
    const forged = forge.json<SessionResponse>();
    expect(forged.decision?.sources).toEqual([
      expect.objectContaining({ fragmentId: keptFragment!.id }),
    ]);
    expect(forged.returnPoint).toMatchObject({
      decisionId: forged.decision?.id,
      openObjection: "Une surcharge reste possible.",
      nextSmallStep: "Tester pendant dix minutes.",
    });

    const lockedFragment = await app.inject({
      method: "POST",
      url: `/fragments/${keptFragment!.id}/compost`,
    });
    expect(lockedFragment.statusCode).toBe(409);
    expect(lockedFragment.json()).toMatchObject({
      error: "FRAGMENT_TRANSITION_CONFLICT",
    });
  });

  it("returns a model-backed decision draft without changing the journal", async () => {
    let receivedSessionId: string | undefined;
    let receivedFragmentIds: readonly string[] | undefined;
    const decisionDraftOrchestrator: DecisionDraftOrchestratorPort = {
      async draft(session, fragmentIds) {
        receivedSessionId = session.sessionId;
        receivedFragmentIds = fragmentIds;
        return {
          draft: {
            statement: "Tester une décision réversible.",
            rationale: "Le fragment conservé propose une preuve courte.",
            objection: "Une contrainte peut encore manquer.",
            reviewCondition: "Réviser si le test échoue deux fois.",
            nextSmallStep: "Lancer le test pendant dix minutes.",
          },
          sourceFragmentIds: [...fragmentIds],
          modelExecution: {
            adapter: "openai-compatible",
            model: "local-council-model",
            durationMs: 720,
          },
        };
      },
    };
    const app = trackedApp({ decisionDraftOrchestrator });
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Préparer un brouillon humainement révisable" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    const completed = await waitForCompletedSession(app, created.sessionId);
    const sourceFragment = completed.fragments[0]!;
    const kept = await app.inject({
      method: "POST",
      url: `/fragments/${sourceFragment.id}/keep`,
    });
    const cursorBeforeDraft = kept.json<SessionResponse>().eventCursor;

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/decision-draft`,
      payload: { fragmentIds: [sourceFragment.id] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      draft: {
        statement: "Tester une décision réversible.",
        objection: "Une contrainte peut encore manquer.",
        reviewCondition: "Réviser si le test échoue deux fois.",
        nextSmallStep: "Lancer le test pendant dix minutes.",
      },
      sourceFragmentIds: [sourceFragment.id],
      modelExecution: {
        adapter: "openai-compatible",
        model: "local-council-model",
      },
    });
    expect(receivedSessionId).toBe(created.sessionId);
    expect(receivedFragmentIds).toEqual([sourceFragment.id]);

    const afterDraft = await app.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    expect(afterDraft.json<SessionResponse>().eventCursor).toBe(
      cursorBeforeDraft,
    );
    expect(afterDraft.json<SessionResponse>().decision).toBeUndefined();
  });

  it("creates a linked revision without convening or changing its source", async () => {
    const app = trackedApp();
    const missing = await app.inject({
      method: "POST",
      url: `/sessions/${randomUUID()}/revisions`,
      payload: { decisionId: randomUUID(), intent: "Réviser." },
    });
    expect(missing.statusCode).toBe(404);

    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Préparer une seconde délibération" } },
    });
    const created = creation.json<{ sessionId: string }>();
    const invalid = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId: "not-a-uuid", intent: "   " },
    });
    expect(invalid.statusCode).toBe(400);
    const tooEarly = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId: randomUUID(), intent: "Le contexte a changé." },
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json()).toMatchObject({ error: "REVISION_NOT_READY" });

    await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    const completed = await waitForCompletedSession(app, created.sessionId);
    const sourceFragment = completed.fragments[0]!;
    await app.inject({
      method: "POST",
      url: `/fragments/${sourceFragment.id}/keep`,
    });
    const forge = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [sourceFragment.id],
        statement: "Garder la première décision intacte.",
        rationale: "Elle reste la trace de la première délibération.",
        nextSmallStep: "Observer le changement.",
      },
    });
    const sourceBefore = forge.json<SessionResponse>();
    const decisionId = sourceBefore.decision!.id;
    const intent = "Un nouveau risque demande un Council distinct.";

    const stale = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId: randomUUID(), intent },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: "REVISION_SOURCE_CONFLICT" });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId, intent },
    });
    expect(response.statusCode).toBe(201);
    const revision = response.json<SessionResponse>();
    expect(revision).toMatchObject({
      status: "created",
      revisionOf: {
        sourceSessionId: created.sessionId,
        sourceDecisionId: decisionId,
        intent,
      },
      previousDecision: {
        sessionId: created.sessionId,
        decision: sourceBefore.decision,
        returnPoint: sourceBefore.returnPoint,
      },
      runs: [],
      fragments: [],
    });
    const sourceAfter = await app.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    expect(sourceAfter.json()).toEqual(sourceBefore);

    const retry = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId, intent },
    });
    expect(retry.json()).toEqual(revision);
    const conflicting = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: { decisionId, intent: "Une branche différente." },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({
      error: "REVISION_ALREADY_STARTED",
    });

    const index = await app.inject({ method: "GET", url: "/sessions" });
    expect(index.json<SessionIndexResponse>().sessions[0]).toMatchObject({
      sessionId: revision.sessionId,
      status: "created",
      hasDecision: false,
      revisionOf: revision.revisionOf,
    });
  });

  it("returns clear errors for invalid and missing fragments", async () => {
    const app = trackedApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/fragments/not-a-uuid/keep",
    });
    const missing = await app.inject({
      method: "POST",
      url: `/fragments/${randomUUID()}/keep`,
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "INVALID_REQUEST" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "FRAGMENT_NOT_FOUND" });
  });
});

function trackedApp(
  options: Parameters<typeof buildApp>[0] = {},
): ReturnType<typeof buildApp> {
  const app = buildApp({ databasePath: ":memory:", ...options });
  apps.push(app);
  return app;
}

async function waitForCompletedSession(
  app: ReturnType<typeof buildApp>,
  sessionId: string,
): Promise<SessionResponse> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const session = response.json<SessionResponse & { status: string }>();
    if (session.status === "completed") {
      return session;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Session ${sessionId} did not complete`);
}

interface SessionResponse {
  readonly sessionId: string;
  readonly status: string;
  readonly eventCursor: number;
  readonly runs: Array<{ status: string }>;
  readonly fragments: Array<{
    id: string;
    status: string;
  }>;
  readonly decision?: {
    id: string;
    sources: Array<{ fragmentId: string }>;
  };
  readonly returnPoint?: {
    decisionId: string;
    openObjection?: string;
    nextSmallStep: string;
  };
  readonly revisionOf?: {
    sourceSessionId: string;
    sourceDecisionId: string;
    intent: string;
  };
  readonly previousDecision?: {
    sessionId: string;
    decision: NonNullable<SessionResponse["decision"]>;
    returnPoint: NonNullable<SessionResponse["returnPoint"]>;
  };
}

interface SessionIndexResponse {
  readonly sessions: Array<{
    readonly sessionId: string;
    readonly quest: { readonly questId: string; readonly title: string };
    readonly status: "created" | "running" | "completed";
    readonly createdAt: string;
    readonly lastActivityAt: string;
    readonly eventCursor: number;
    readonly hasDecision: boolean;
    readonly nextSmallStep?: string;
    readonly revisionOf?: {
      readonly sourceSessionId: string;
      readonly sourceDecisionId: string;
      readonly intent: string;
    };
  }>;
}
