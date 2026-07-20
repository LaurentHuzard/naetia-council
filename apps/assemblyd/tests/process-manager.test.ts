import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CouncilOrchestrator,
  type SessionSnapshot,
} from "../src/orchestration/council-orchestrator.js";
import {
  AgentProcessManager,
  type RunSnapshot,
} from "../src/process-manager/process-manager.js";
import type { AgentWorkerEvent } from "@naetia/assembly-protocol";
import type { AgentDefinition, AgentRole } from "@naetia/assembly-domain";

const orchestrators: CouncilOrchestrator[] = [];
const processManagers: AgentProcessManager[] = [];

afterEach(async () => {
  await Promise.all([
    ...orchestrators.splice(0).map((orchestrator) => orchestrator.close()),
    ...processManagers.splice(0).map((manager) => manager.close()),
  ]);
});

describe.sequential("The Assembly process boundary", () => {
  it("spawns processes only for the selected Council members", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Explorer avec Scout" });
    const convened = orchestrator.convene(created.sessionId, {
      agentIds: ["scout", "architect"],
      behavior: { latencyMs: 2 },
    });

    expect(convened?.agentDefinitions.map(({ role }) => role)).toEqual([
      "architect",
      "scout",
    ]);
    expect(convened?.runs.map(({ agentId }) => agentId)).toEqual([
      "architect",
      "scout",
    ]);
    expect(new Set(convened?.runs.map(({ pid }) => pid)).size).toBe(2);

    const cursor = convened!.eventCursor;
    const retry = orchestrator.convene(created.sessionId, {
      agentIds: ["architect", "scout"],
    });
    expect(retry?.eventCursor).toBe(cursor);
    expect(retry?.runs).toHaveLength(2);
    expect(() =>
      orchestrator.convene(created.sessionId, {
        agentIds: ["architect", "guardian"],
      }),
    ).toThrowError(/already convened another delegation/);

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.fragments).toHaveLength(2);
    expect(completed.runs.some(({ agentId }) => agentId === "guardian")).toBe(
      false,
    );
  });

  it("spawns three distinct processes and receives progressive contributions", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Ouvrir la porte" });
    const convened = orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 20 },
        trickster: { latencyMs: 20 },
        guardian: { latencyMs: 20 },
      },
    });

    expect(convened).toBeDefined();
    expect(convened?.runs).toHaveLength(3);
    expect(new Set(convened?.runs.map((run) => run.pid)).size).toBe(3);

    const partial = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) =>
        session.runs.some((run) => run.contribution.length > 0) &&
        session.runs.some((run) => run.status === "running"),
    );
    expect(
      partial.events.some((event) => event.type === "contribution.delta"),
    ).toBe(true);
    expect(partial.runs.some((run) => run.status !== "completed")).toBe(true);

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.runs.every((run) => run.status === "completed"),
    );

    expect(completed.runs.map((run) => run.agentId).sort()).toEqual([
      "architect",
      "guardian",
      "trickster",
    ]);
    expect(completed.runs.every((run) => run.contribution.length > 0)).toBe(true);
    expect(
      completed.events.filter((event) => event.type === "contribution.delta")
        .length,
    ).toBeGreaterThanOrEqual(9);
  });

  it("cancels Guardian without cancelling the other runs", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Décider sans surcharge" });
    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 2 },
        trickster: { latencyMs: 2 },
        guardian: { latencyMs: 100 },
      },
    });

    const running = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.runs.some((run) => run.agentId === "guardian" && run.status === "running"),
    );
    const guardian = running.runs.find((run) => run.agentId === "guardian");
    expect(guardian).toBeDefined();
    orchestrator.cancelRun(guardian!.runId);

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.runs.find((run) => run.agentId === "guardian")?.status).toBe("cancelled");
    expect(completed.runs.find((run) => run.agentId === "architect")?.status).toBe("completed");
    expect(completed.runs.find((run) => run.agentId === "trickster")?.status).toBe("completed");
  });

  it("contains a brutal child crash to its own run", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Résister à une avarie" });
    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 2, crashAtDelta: 0 },
        trickster: { latencyMs: 2 },
        guardian: { latencyMs: 2 },
      },
    });

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.runs.find((run) => run.agentId === "architect")).toMatchObject({
      status: "failed",
      error: { code: "CHILD_EXIT" },
    });
    expect(completed.runs.find((run) => run.agentId === "trickster")?.status).toBe("completed");
    expect(completed.runs.find((run) => run.agentId === "guardian")?.status).toBe("completed");
  });

  it("fails only the run that exceeds its timeout", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Respecter le temps" });
    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 2 },
        trickster: { latencyMs: 2 },
        guardian: { latencyMs: 500, timeoutMs: 25 },
      },
    });

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.runs.find((run) => run.agentId === "guardian")).toMatchObject({
      status: "failed",
      error: { code: "RUN_TIMEOUT" },
    });
    expect(completed.runs.filter((run) => run.status === "completed")).toHaveLength(2);
  });

  it("fails an empty contribution without affecting the other voices", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({ title: "Refuser le vide" });
    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 2 },
        trickster: { latencyMs: 2 },
        guardian: { latencyMs: 2, empty: true },
      },
    });

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.runs.find((run) => run.agentId === "guardian")).toMatchObject({
      status: "failed",
      error: { code: "MODEL_ERROR" },
    });
    expect(completed.runs.filter((run) => run.status === "completed")).toHaveLength(2);
  });

  it("fails a worker that emits invalid IPC", async () => {
    const manager = trackedScriptedManager();
    const run = manager.spawn({
      runId: randomUUID(),
      sessionId: randomUUID(),
      agentDefinition: definition("architect"),
      quest: { title: "invalid-ipc" },
      model: { adapter: "fake" },
    });

    const failed = await waitForRun(
      manager,
      run.runId,
      (snapshot) => snapshot.status === "failed",
    );
    expect(failed.error).toEqual({
      code: "INVALID_IPC",
      message: "Agent emitted an invalid IPC event",
    });
  });

  it("deduplicates a repeated worker event id", async () => {
    const manager = trackedScriptedManager();
    const events: AgentWorkerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const run = manager.spawn({
      runId: randomUUID(),
      sessionId: randomUUID(),
      agentDefinition: definition("trickster"),
      quest: { title: "duplicate-event" },
      model: { adapter: "fake" },
    });

    const completed = await waitForRun(
      manager,
      run.runId,
      (snapshot) => snapshot.status === "completed",
    );
    expect(completed.contribution).toBe("fragment unique");
    expect(events.filter((event) => event.type === "delta")).toHaveLength(1);
  });
});

function trackedOrchestrator(): CouncilOrchestrator {
  const orchestrator = new CouncilOrchestrator();
  orchestrators.push(orchestrator);
  return orchestrator;
}

function trackedScriptedManager(): AgentProcessManager {
  const manager = new AgentProcessManager({
    workerPath: fileURLToPath(
      new URL("./fixtures/scripted-worker.ts", import.meta.url),
    ),
    workerExecArgv: ["--experimental-strip-types"],
  });
  processManagers.push(manager);
  return manager;
}

function definition(role: AgentRole): AgentDefinition {
  return {
    id: `${role}-v1`,
    role,
    name: role[0]!.toUpperCase() + role.slice(1),
    perspective: `Perspective ${role}`,
    instructions: `Instructions ${role}`,
    version: 1,
  };
}

async function waitForSession(
  orchestrator: CouncilOrchestrator,
  sessionId: string,
  predicate: (session: SessionSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<SessionSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = orchestrator.getSession(sessionId);
    if (session !== undefined && predicate(session)) {
      return session;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Session ${sessionId} did not reach the expected state`);
}

async function waitForRun(
  manager: AgentProcessManager,
  runId: string,
  predicate: (run: RunSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<RunSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = manager.get(runId);
    if (run !== undefined && predicate(run)) {
      return run;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Run ${runId} did not reach the expected state`);
}
