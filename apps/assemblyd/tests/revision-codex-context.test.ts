import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CouncilOrchestrator,
  type SessionSnapshot,
} from "../src/orchestration/council-orchestrator.js";
import { SqliteEventJournal } from "../src/persistence/sqlite-event-journal.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-codex-cli.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];
const orchestrators: CouncilOrchestrator[] = [];

afterEach(async () => {
  await Promise.all(
    orchestrators.splice(0).map((orchestrator) => orchestrator.close()),
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.sequential("Codex revision context", () => {
  it("sends D1 and the human intent to three distinct Codex runs and replays their usage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "naetia-revision-codex-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "journal.sqlite");
    const source = trackedOrchestrator(databasePath);
    const created = source.createSession({
      title: "Réduire une décision sans perdre sa mémoire",
      context: "Le test initial dure une semaine.",
    });

    source.convene(created.sessionId);
    const sourceCompleted = await waitForSession(
      source,
      created.sessionId,
      (session) => session.status === "completed",
    );
    const sourceFragment = sourceCompleted.fragments[0]!;
    source.keepFragment(sourceFragment.id);
    const d1Statement = "Observer pendant sept jours avant d'élargir le test.";
    const d1Rationale =
      "La première décision privilégie une observation longue.";
    const d1Objection =
      "Le délai peut devenir incompatible avec la situation.";
    const d1ReviewCondition =
      "Réviser si une échéance plus proche apparaît.";
    const d1NextSmallStep = "Noter un signal par jour.";
    const d1 = source.forgeDecision(created.sessionId, {
      fragmentIds: [sourceFragment.id],
      statement: d1Statement,
      rationale: d1Rationale,
      objection: d1Objection,
      reviewCondition: d1ReviewCondition,
      nextSmallStep: d1NextSmallStep,
    })!;
    const sourceBeforeRevision = structuredClone(d1);
    const intent =
      "Une échéance dans vingt-quatre heures impose un geste beaucoup plus petit.";
    const revision = source.createRevision(created.sessionId, {
      decisionId: d1.decision!.id,
      intent,
    })!;

    source.convene(revision.sessionId);
    const completed = await waitForSession(
      source,
      revision.sessionId,
      (session) => session.status === "completed",
    );

    expect(completed.runs).toHaveLength(3);
    expect(new Set(completed.runs.map((run) => run.pid)).size).toBe(3);
    for (const run of completed.runs) {
      const inspection = JSON.parse(run.contribution) as {
        prompt: string;
      };
      expect(inspection.prompt).toContain(d1Statement);
      expect(inspection.prompt).toContain(d1Rationale);
      expect(inspection.prompt).toContain(d1Objection);
      expect(inspection.prompt).toContain(d1ReviewCondition);
      expect(inspection.prompt).toContain(d1NextSmallStep);
      expect(inspection.prompt).toContain(intent);
      expect(inspection.prompt).toContain(`Rôle : ${agentName(run.agentId)}.`);
      expect(inspection.prompt).toContain(
        "cite-les explicitement puis indique ce que ton rôle conserve, change ou conteste",
      );
      expect(run.modelExecution).toMatchObject({
        adapter: "codex-cli",
        model: "revision-proof",
        durationMs: expect.any(Number),
        usage: {
          inputTokens: 120,
          cachedInputTokens: 80,
          outputTokens: 42,
          reasoningOutputTokens: 7,
        },
      });
    }
    expect(source.getSession(created.sessionId)).toEqual(sourceBeforeRevision);

    const completedEvents = completed.events.filter(
      (event) => event.type === "contribution.completed",
    );
    expect(completedEvents).toHaveLength(3);
    for (const run of completed.runs) {
      expect(
        completedEvents.find((event) => event.runId === run.runId)?.payload
          .modelExecution,
      ).toEqual(run.modelExecution);
    }

    await source.close();
    orchestrators.splice(orchestrators.indexOf(source), 1);
    const replayed = trackedOrchestrator(databasePath).getSession(revision.sessionId)!;
    expect(replayed.runs.map((run) => run.modelExecution)).toEqual(
      completed.runs.map((run) => run.modelExecution),
    );
  });

  it("contains invalid JSONL and a timeout to their own Codex runs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "naetia-codex-failures-"));
    temporaryDirectories.push(directory);
    const orchestrator = trackedOrchestrator(
      join(directory, "journal.sqlite"),
      "isolated-failure-proof",
    );
    const created = orchestrator.createSession({
      title: "Isoler deux avaries Codex",
    });

    orchestrator.convene(created.sessionId, {
      behaviorByAgent: { guardian: { timeoutMs: 40 } },
    });
    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );

    expect(completed.runs.find((run) => run.agentId === "architect")).toMatchObject({
      status: "failed",
      error: { code: "CODEX_OUTPUT_INVALID" },
    });
    expect(completed.runs.find((run) => run.agentId === "guardian")).toMatchObject({
      status: "failed",
      error: { code: "RUN_TIMEOUT" },
    });
    expect(completed.runs.find((run) => run.agentId === "trickster")).toMatchObject({
      status: "completed",
      contribution: expect.stringContaining("prochain petit geste"),
      modelExecution: {
        adapter: "codex-cli",
        model: "isolated-failure-proof",
        usage: {
          inputTokens: 120,
          cachedInputTokens: 80,
          outputTokens: 42,
          reasoningOutputTokens: 7,
        },
      },
    });
  });
});

function trackedOrchestrator(
  databasePath: string,
  model = "revision-proof",
): CouncilOrchestrator {
  const orchestrator = new CouncilOrchestrator({
    journal: new SqliteEventJournal(databasePath),
    model: {
      adapter: "codex-cli",
      executablePath: fixturePath,
      model,
      revealDelayMs: 0,
    },
  });
  orchestrators.push(orchestrator);
  return orchestrator;
}

function agentName(agentId: SessionSnapshot["runs"][number]["agentId"]): string {
  if (agentId === "architect") {
    return "Architect";
  }
  if (agentId === "trickster") {
    return "Trickster";
  }
  return "Guardian";
}

async function waitForSession(
  orchestrator: CouncilOrchestrator,
  sessionId: string,
  predicate: (session: SessionSnapshot) => boolean,
): Promise<SessionSnapshot> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const session = orchestrator.getSession(sessionId);
    if (session !== undefined && predicate(session)) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${sessionId} did not reach the expected state`);
}
