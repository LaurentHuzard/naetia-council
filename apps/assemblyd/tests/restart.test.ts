import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/api/app.js";

const applications: ReturnType<typeof buildApp>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.sequential("Assembly daemon restart", () => {
  it("rebuilds completed runs and contributions from the SQLite journal", async () => {
    const databasePath = temporaryDatabasePath();
    const firstApp = trackedApp({ databasePath, fakeModelDelayMs: 2 });
    const creation = await firstApp.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        quest: {
          title: "Revenir au Council",
          context: "Prouver la reconstruction",
        },
      },
    });
    const created = creation.json<{ sessionId: string }>();
    await firstApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
      payload: { agentIds: ["architect", "scout"] },
    });
    const completed = await waitForCompletedSession(firstApp, created.sessionId);
    const sourceFragment = completed.fragments[0];
    expect(sourceFragment).toBeDefined();
    await firstApp.inject({
      method: "POST",
      url: `/fragments/${sourceFragment!.id}/keep`,
    });
    const forge = await firstApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [sourceFragment!.id],
        statement: "Revenir à une décision vivante.",
        rationale: "La provenance doit survivre au redémarrage.",
        objection: "Le contexte peut encore changer.",
        reviewCondition: "Réviser après le premier essai.",
        nextSmallStep: "Relire la décision demain.",
      },
    });
    expect(forge.statusCode).toBe(200);
    const beforeRestart = forge.json<SessionResponse>();
    const revisionIntent = "Une nouvelle contrainte mérite un second Council.";
    const revisionResponse = await firstApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: {
        decisionId: beforeRestart.decision!.id,
        intent: revisionIntent,
      },
    });
    expect(revisionResponse.statusCode).toBe(201);
    const revisionBeforeRestart = revisionResponse.json<SessionResponse>();
    const unchangedSource = await firstApp.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    expect(unchangedSource.json()).toEqual(beforeRestart);
    const indexBeforeRestart = await firstApp.inject({
      method: "GET",
      url: "/sessions",
    });
    expect(indexBeforeRestart.json()).toEqual({
      sessions: [
        expect.objectContaining({
          sessionId: revisionBeforeRestart.sessionId,
          status: "created",
          hasDecision: false,
          revisionOf: {
            sourceSessionId: created.sessionId,
            sourceDecisionId: beforeRestart.decision!.id,
            intent: revisionIntent,
          },
        }),
        expect.objectContaining({
          sessionId: created.sessionId,
          status: "completed",
          hasDecision: true,
          nextSmallStep: "Relire la décision demain.",
        }),
      ],
    });
    await firstApp.close();
    applications.splice(applications.indexOf(firstApp), 1);

    const secondApp = trackedApp({ databasePath, fakeModelDelayMs: 2 });
    const response = await secondApp.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    expect(response.statusCode).toBe(200);
    const afterRestart = response.json<SessionResponse>();

    expect(afterRestart.quest).toEqual(beforeRestart.quest);
    expect(afterRestart.runs).toHaveLength(2);
    expect(afterRestart.agentDefinitions).toEqual(
      beforeRestart.agentDefinitions,
    );
    expect(
      afterRestart.runs.map(({ runId, agentId, agentDefinitionId, status, contribution }) => ({
        runId,
        agentId,
        agentDefinitionId,
        status,
        contribution,
      })),
    ).toEqual(
      beforeRestart.runs.map(
        ({ runId, agentId, agentDefinitionId, status, contribution }) => ({
          runId,
          agentId,
          agentDefinitionId,
          status,
          contribution,
        }),
      ),
    );
    expect(afterRestart.runs.every((run) => run.pid === undefined)).toBe(true);
    expect(afterRestart.fragments).toEqual(beforeRestart.fragments);
    expect(afterRestart.decision).toEqual(beforeRestart.decision);
    expect(afterRestart.returnPoint).toEqual(beforeRestart.returnPoint);
    expect(afterRestart.events).toEqual(beforeRestart.events);
    const revisionAfterRestartResponse = await secondApp.inject({
      method: "GET",
      url: `/sessions/${revisionBeforeRestart.sessionId}`,
    });
    const revisionAfterRestart =
      revisionAfterRestartResponse.json<SessionResponse>();
    expect(revisionAfterRestart).toEqual(revisionBeforeRestart);
    const revisionRetry = await secondApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload: {
        decisionId: beforeRestart.decision!.id,
        intent: revisionIntent,
      },
    });
    expect(revisionRetry.json()).toEqual(revisionBeforeRestart);
    const indexAfterRestart = await secondApp.inject({
      method: "GET",
      url: "/sessions",
    });
    expect(indexAfterRestart.json()).toEqual(indexBeforeRestart.json());
  });

  it("returns 503 without a partial convocation when SQLite is locked", async () => {
    const databasePath = temporaryDatabasePath();
    const app = trackedApp({
      databasePath,
      fakeModelDelayMs: 2,
      databaseBusyTimeoutMs: 10,
    });
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Attendre le journal" } },
    });
    const created = creation.json<{ sessionId: string }>();
    const lock = new Database(databasePath);
    lock.exec("BEGIN EXCLUSIVE");
    try {
      const unavailable = await app.inject({
        method: "POST",
        url: `/sessions/${created.sessionId}/convene`,
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toMatchObject({
        error: "PERSISTENCE_UNAVAILABLE",
      });
    } finally {
      lock.exec("ROLLBACK");
    }
    const row = lock
      .prepare("SELECT COUNT(*) AS count FROM council_events")
      .get() as Readonly<{ count: number }>;
    expect(row.count).toBe(1);
    lock.close();

    const unchanged = await app.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    expect(unchanged.json<SessionResponse>().runs).toHaveLength(0);

    const retry = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    expect(retry.statusCode).toBe(202);
    await waitForCompletedSession(app, created.sessionId);
  });

  it("never persists a decision without its return point when SQLite is locked", async () => {
    const databasePath = temporaryDatabasePath();
    const app = trackedApp({
      databasePath,
      fakeModelDelayMs: 2,
      databaseBusyTimeoutMs: 10,
    });
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Forger atomiquement" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    const completed = await waitForCompletedSession(app, created.sessionId);
    const fragment = completed.fragments[0];
    expect(fragment).toBeDefined();
    await app.inject({
      method: "POST",
      url: `/fragments/${fragment!.id}/keep`,
    });

    const forgePayload = {
      fragmentIds: [fragment!.id],
      statement: "Une paire durable.",
      rationale: "La décision et le retour doivent rester inséparables.",
      nextSmallStep: "Vérifier le journal.",
    };
    const lock = new Database(databasePath);
    lock.exec("BEGIN EXCLUSIVE");
    try {
      const unavailable = await app.inject({
        method: "POST",
        url: `/sessions/${created.sessionId}/forge`,
        payload: forgePayload,
      });
      expect(unavailable.statusCode).toBe(503);
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }

    const unchanged = await app.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    const snapshot = unchanged.json<SessionResponse>();
    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.returnPoint).toBeUndefined();
    expect(
      snapshot.events.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          (event.type === "decision.forged" ||
            event.type === "return_point.updated"),
      ),
    ).toHaveLength(0);

    const retry = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: forgePayload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json<SessionResponse>()).toMatchObject({
      decision: { statement: forgePayload.statement },
      returnPoint: { nextSmallStep: forgePayload.nextSmallStep },
    });
  });

  it("never creates a partial revision while SQLite is locked", async () => {
    const databasePath = temporaryDatabasePath();
    const app = trackedApp({
      databasePath,
      fakeModelDelayMs: 2,
      databaseBusyTimeoutMs: 10,
    });
    const creation = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Réviser atomiquement" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    const completed = await waitForCompletedSession(app, created.sessionId);
    const fragment = completed.fragments[0]!;
    await app.inject({
      method: "POST",
      url: `/fragments/${fragment.id}/keep`,
    });
    const forge = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/forge`,
      payload: {
        fragmentIds: [fragment.id],
        statement: "Conserver la première trace.",
        rationale: "La révision sera une autre session.",
        nextSmallStep: "Préparer la révision.",
      },
    });
    const source = forge.json<SessionResponse>();
    const payload = {
      decisionId: source.decision!.id,
      intent: "Une contrainte nouvelle demande un autre Council.",
    };
    const lock = new Database(databasePath);
    const countBefore = lock
      .prepare("SELECT COUNT(*) AS count FROM council_events")
      .get() as Readonly<{ count: number }>;
    lock.exec("BEGIN EXCLUSIVE");
    try {
      const unavailable = await app.inject({
        method: "POST",
        url: `/sessions/${created.sessionId}/revisions`,
        payload,
      });
      expect(unavailable.statusCode).toBe(503);
    } finally {
      lock.exec("ROLLBACK");
    }
    const countAfter = lock
      .prepare("SELECT COUNT(*) AS count FROM council_events")
      .get() as Readonly<{ count: number }>;
    lock.close();
    expect(countAfter).toEqual(countBefore);

    const unchangedIndex = await app.inject({ method: "GET", url: "/sessions" });
    expect(unchangedIndex.json<{ sessions: unknown[] }>().sessions).toHaveLength(1);
    const retry = await app.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/revisions`,
      payload,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json<SessionResponse>().revisionOf).toMatchObject({
      sourceSessionId: created.sessionId,
      sourceDecisionId: source.decision!.id,
    });
  });

  it("persists controlled interruptions when the daemon stops mid-session", async () => {
    const databasePath = temporaryDatabasePath();
    const firstApp = trackedApp({ databasePath, fakeModelDelayMs: 100 });
    const creation = await firstApp.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Interrompre sans perdre" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await firstApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    await waitForRunningSession(firstApp, created.sessionId);
    await firstApp.close();
    applications.splice(applications.indexOf(firstApp), 1);

    const secondApp = trackedApp({ databasePath, fakeModelDelayMs: 2 });
    const response = await secondApp.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    const recovered = response.json<SessionResponse & { status: string }>();
    expect(response.statusCode).toBe(200);
    expect(recovered.status).toBe("completed");
    expect(recovered.runs).toHaveLength(3);
    expect(recovered.runs.every((run) => run.status === "cancelled")).toBe(true);
    expect(recovered.runs.every((run) => run.pid === undefined)).toBe(true);
  });

  it("enters a visible degraded state when SQLite fails during streaming", async () => {
    const databasePath = temporaryDatabasePath();
    const firstApp = trackedApp({
      databasePath,
      fakeModelDelayMs: 100,
      databaseBusyTimeoutMs: 10,
    });
    const creation = await firstApp.inject({
      method: "POST",
      url: "/sessions",
      payload: { quest: { title: "Rendre la panne visible" } },
    });
    const created = creation.json<{ sessionId: string }>();
    await firstApp.inject({
      method: "POST",
      url: `/sessions/${created.sessionId}/convene`,
    });
    await waitForRunningSession(firstApp, created.sessionId);

    const lock = new Database(databasePath);
    lock.exec("BEGIN EXCLUSIVE");
    try {
      const degraded = await waitForHttpStatus(firstApp, "/health", 503);
      expect(degraded.json()).toMatchObject({
        error: "PERSISTENCE_UNAVAILABLE",
      });
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }

    await firstApp.close();
    applications.splice(applications.indexOf(firstApp), 1);

    const secondApp = trackedApp({ databasePath, fakeModelDelayMs: 2 });
    const response = await secondApp.inject({
      method: "GET",
      url: `/sessions/${created.sessionId}`,
    });
    const recovered = response.json<SessionResponse & { status: string }>();
    expect(response.statusCode).toBe(200);
    expect(recovered.runs.some((run) => run.error?.code === "DAEMON_RESTARTED"))
      .toBe(true);
    expect(
      recovered.runs.every(
        (run) =>
          run.status === "completed" ||
          run.status === "failed" ||
          run.status === "cancelled",
      ),
    ).toBe(true);
  });
});

interface SessionResponse {
  readonly sessionId: string;
  readonly status: string;
  readonly quest: Readonly<{
    questId: string;
    title: string;
    context?: string;
  }>;
  readonly agentDefinitions: readonly Readonly<{
    id: string;
    role: string;
    name: string;
    perspective: string;
    instructions: string;
    version: number;
  }>[];
  readonly runs: readonly Readonly<{
    runId: string;
    agentId: string;
    agentDefinitionId: string;
    status: string;
    contribution: string;
    pid?: number;
    error?: Readonly<{ code: string; message: string }>;
  }>[];
  readonly fragments: readonly Readonly<{
    id: string;
    sessionId: string;
    contributionId: string;
    runId: string;
    content: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>[];
  readonly decision?: Readonly<{
    id: string;
    sessionId: string;
    statement: string;
    rationale: string;
    objection?: string;
    reviewCondition?: string;
    sources: readonly unknown[];
    createdAt: string;
  }>;
  readonly returnPoint?: Readonly<{
    sessionId: string;
    decisionId: string;
    summary: string;
    openObjection?: string;
    nextSmallStep: string;
    updatedAt: string;
  }>;
  readonly revisionOf?: Readonly<{
    sourceSessionId: string;
    sourceDecisionId: string;
    intent: string;
  }>;
  readonly previousDecision?: Readonly<{
    sessionId: string;
    decision: NonNullable<SessionResponse["decision"]>;
    returnPoint: NonNullable<SessionResponse["returnPoint"]>;
  }>;
  readonly events: readonly unknown[];
}

function trackedApp(
  options: Parameters<typeof buildApp>[0],
): ReturnType<typeof buildApp> {
  const app = buildApp(options);
  applications.push(app);
  return app;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "naetia-restart-"));
  temporaryDirectories.push(directory);
  return join(directory, "assembly.sqlite");
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

async function waitForRunningSession(
  app: ReturnType<typeof buildApp>,
  sessionId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const session = response.json<SessionResponse & { status: string }>();
    if (session.runs.some((run) => run.status === "running")) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Session ${sessionId} did not start running`);
}

async function waitForHttpStatus(
  app: ReturnType<typeof buildApp>,
  url: string,
  statusCode: number,
): Promise<Awaited<ReturnType<typeof app.inject>>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode === statusCode) {
      return response;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`${url} did not return ${String(statusCode)}`);
}
