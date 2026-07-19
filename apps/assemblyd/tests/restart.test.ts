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
    });
    const beforeRestart = await waitForCompletedSession(firstApp, created.sessionId);
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
    expect(afterRestart.runs).toHaveLength(3);
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
    expect(afterRestart.events).toEqual(beforeRestart.events);
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
  readonly quest: Readonly<{
    questId: string;
    title: string;
    context?: string;
  }>;
  readonly runs: readonly Readonly<{
    runId: string;
    agentId: string;
    agentDefinitionId: string;
    status: string;
    contribution: string;
    pid?: number;
    error?: Readonly<{ code: string; message: string }>;
  }>[];
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
