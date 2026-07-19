import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/api/app.js";

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

function trackedApp(): ReturnType<typeof buildApp> {
  const app = buildApp({ databasePath: ":memory:" });
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
}
