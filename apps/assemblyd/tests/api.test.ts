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
});

function trackedApp(): ReturnType<typeof buildApp> {
  const app = buildApp({ databasePath: ":memory:" });
  apps.push(app);
  return app;
}

async function waitForCompletedSession(
  app: ReturnType<typeof buildApp>,
  sessionId: string,
): Promise<{ runs: Array<{ status: string }> }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const session = response.json<{ status: string; runs: Array<{ status: string }> }>();
    if (session.status === "completed") {
      return session;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Session ${sessionId} did not complete`);
}
