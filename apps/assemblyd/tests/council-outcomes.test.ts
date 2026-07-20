import { afterEach, describe, expect, it } from "vitest";

import {
  CouncilOrchestrator,
  type CouncilCommandError,
  type SessionSnapshot,
} from "../src/orchestration/council-orchestrator.js";

const orchestrators: CouncilOrchestrator[] = [];

afterEach(async () => {
  await Promise.all(
    orchestrators.splice(0).map((orchestrator) => orchestrator.close()),
  );
});

describe.sequential("Council outcomes", () => {
  it("turns three contributions into human-governed fragments and a return point", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({
      title: "Ouvrir une porte réelle",
      context: "Conserver la provenance et le pouvoir humain",
    });
    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 1 },
        trickster: { latencyMs: 1 },
        guardian: { latencyMs: 1 },
      },
    });

    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    expect(completed.fragments).toHaveLength(3);
    expect(completed.fragments.every((fragment) => fragment.status === "available"))
      .toBe(true);
    expect(
      completed.events.filter((event) => event.type === "fragment.created"),
    ).toHaveLength(3);
    for (const fragment of completed.fragments) {
      const run = completed.runs.find((candidate) => candidate.runId === fragment.runId);
      expect(run).toBeDefined();
      expect(fragment).toMatchObject({
        sessionId: created.sessionId,
        contributionId: expect.any(String),
        content: run?.contribution,
      });
    }

    const [architectFragment, tricksterFragment, guardianFragment] =
      completed.fragments;
    expect(architectFragment).toBeDefined();
    expect(tricksterFragment).toBeDefined();
    expect(guardianFragment).toBeDefined();

    const kept = orchestrator.keepFragment(architectFragment!.id)!;
    expect(fragmentStatus(kept, architectFragment!.id)).toBe("kept");
    const keepCursor = kept.eventCursor;
    expect(orchestrator.keepFragment(architectFragment!.id)?.eventCursor).toBe(
      keepCursor,
    );

    const challenged = orchestrator.challengeFragment(
      tricksterFragment!.id,
      "Quelle prémisse reste fragile ?",
    )!;
    expect(fragmentStatus(challenged, tricksterFragment!.id)).toBe("challenged");
    const challengeCursor = challenged.eventCursor;
    expect(
      orchestrator.challengeFragment(
        tricksterFragment!.id,
        "Quelle prémisse reste fragile ?",
      )?.eventCursor,
    ).toBe(challengeCursor);
    expect(() =>
      orchestrator.challengeFragment(
        tricksterFragment!.id,
        "Un autre challenge silencieux",
      ),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "FRAGMENT_TRANSITION_CONFLICT",
      }),
    );
    expect(() =>
      orchestrator.forgeDecision(created.sessionId, {
        fragmentIds: [tricksterFragment!.id],
        statement: "Trop tôt",
        rationale: "Le fragment n’est pas conservé.",
        nextSmallStep: "Attendre",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "DECISION_SOURCE_CONFLICT",
      }),
    );

    const reconsidered = orchestrator.keepFragment(tricksterFragment!.id)!;
    expect(fragmentStatus(reconsidered, tricksterFragment!.id)).toBe("kept");
    const composted = orchestrator.compostFragment(guardianFragment!.id)!;
    expect(fragmentStatus(composted, guardianFragment!.id)).toBe("composted");
    expect(orchestrator.compostFragment(guardianFragment!.id)?.eventCursor).toBe(
      composted.eventCursor,
    );
    expect(() => orchestrator.keepFragment(guardianFragment!.id)).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "FRAGMENT_TRANSITION_CONFLICT",
      }),
    );

    expect(() =>
      orchestrator.forgeDecision(created.sessionId, {
        fragmentIds: [architectFragment!.id, architectFragment!.id],
        statement: "Refuser les doublons",
        rationale: "Une source ne compte qu’une fois.",
        nextSmallStep: "Dédupliquer",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "DECISION_SOURCE_CONFLICT",
      }),
    );

    const forgeInput = {
      fragmentIds: [architectFragment!.id, tricksterFragment!.id],
      statement: "Ouvrir une porte étroite et réversible.",
      rationale: "Deux perspectives conservées convergent vers un test local.",
      objection: "Le Guardian craint encore une surcharge.",
      reviewCondition: "Réviser si le test augmente la confusion.",
      nextSmallStep: "Exécuter un essai de dix minutes.",
    } as const;
    const forged = orchestrator.forgeDecision(created.sessionId, forgeInput)!;

    expect(forged.decision).toMatchObject({
      sessionId: created.sessionId,
      statement: forgeInput.statement,
      rationale: forgeInput.rationale,
      objection: forgeInput.objection,
      reviewCondition: forgeInput.reviewCondition,
    });
    expect(forged.decision?.sources.map((source) => source.fragmentId)).toEqual(
      forgeInput.fragmentIds,
    );
    for (const source of forged.decision?.sources ?? []) {
      const fragment = forged.fragments.find(
        (candidate) => candidate.id === source.fragmentId,
      );
      const run = forged.runs.find((candidate) => candidate.runId === source.runId);
      expect(source).toEqual({
        fragmentId: fragment?.id,
        contributionId: fragment?.contributionId,
        runId: fragment?.runId,
        agentDefinitionId: run?.agentDefinitionId,
      });
    }
    expect(forged.returnPoint).toMatchObject({
      sessionId: created.sessionId,
      decisionId: forged.decision?.id,
      summary: forgeInput.statement,
      openObjection: forgeInput.objection,
      nextSmallStep: forgeInput.nextSmallStep,
    });
    expect(
      forged.events.slice(-2).map((event) => event.type),
    ).toEqual(["decision.forged", "return_point.updated"]);

    const forgeCursor = forged.eventCursor;
    expect(
      orchestrator.forgeDecision(created.sessionId, forgeInput)?.eventCursor,
    ).toBe(forgeCursor);
    expect(() =>
      orchestrator.forgeDecision(created.sessionId, {
        ...forgeInput,
        statement: "Une autre décision",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "DECISION_ALREADY_FORGED",
      }),
    );
    expect(() => orchestrator.compostFragment(architectFragment!.id)).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "FRAGMENT_TRANSITION_CONFLICT",
      }),
    );
  });

  it("starts an idempotent child session without changing the source decision", async () => {
    const orchestrator = trackedOrchestrator();
    const created = orchestrator.createSession({
      title: "Réviser une porte sans effacer la première",
      context: "La provenance initiale doit rester intacte.",
    });
    expect(() =>
      orchestrator.createRevision(created.sessionId, {
        decisionId: "decision-missing",
        intent: "Réviser trop tôt",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "REVISION_NOT_READY",
      }),
    );

    orchestrator.convene(created.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 1 },
        trickster: { latencyMs: 1 },
        guardian: { latencyMs: 1 },
      },
    });
    const completed = await waitForSession(
      orchestrator,
      created.sessionId,
      (session) => session.status === "completed",
    );
    const sourceFragment = completed.fragments[0]!;
    orchestrator.keepFragment(sourceFragment.id);
    const forged = orchestrator.forgeDecision(created.sessionId, {
      fragmentIds: [sourceFragment.id],
      statement: "Ouvrir prudemment la première porte.",
      rationale: "La première preuve reste suffisante pour maintenant.",
      objection: "Le contexte peut évoluer.",
      reviewCondition: "Réviser lorsqu’une contrainte apparaît.",
      nextSmallStep: "Observer la porte pendant une journée.",
    })!;
    const sourceDecisionId = forged.decision!.id;
    const sourceBeforeRevision = structuredClone(forged);
    const intent = "Une contrainte de temps rend le premier geste trop large.";

    expect(() =>
      orchestrator.createRevision(created.sessionId, {
        decisionId: "another-decision",
        intent,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "REVISION_SOURCE_CONFLICT",
      }),
    );

    const revision = orchestrator.createRevision(created.sessionId, {
      decisionId: sourceDecisionId,
      intent,
    })!;
    expect(orchestrator.getSession(created.sessionId)).toEqual(
      sourceBeforeRevision,
    );
    expect(revision).toMatchObject({
      quest: forged.quest,
      status: "created",
      revisionOf: {
        sourceSessionId: created.sessionId,
        sourceDecisionId,
        intent,
      },
      previousDecision: {
        sessionId: created.sessionId,
        decision: forged.decision,
        returnPoint: forged.returnPoint,
      },
      runs: [],
      fragments: [],
    });
    expect(revision.events.map((event) => event.type)).toEqual([
      "session.created",
    ]);

    const retry = orchestrator.createRevision(created.sessionId, {
      decisionId: sourceDecisionId,
      intent,
    });
    expect(retry).toEqual(revision);
    expect(() =>
      orchestrator.createRevision(created.sessionId, {
        decisionId: sourceDecisionId,
        intent: "Une autre branche concurrente.",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CouncilCommandError>>({
        code: "REVISION_ALREADY_STARTED",
      }),
    );

    orchestrator.convene(revision.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 1 },
        trickster: { latencyMs: 1 },
        guardian: { latencyMs: 1 },
      },
    });
    const revisionCompleted = await waitForSession(
      orchestrator,
      revision.sessionId,
      (session) => session.status === "completed",
    );
    expect(revisionCompleted.runs).toHaveLength(3);
    expect(
      revisionCompleted.runs.every(
        (run) => !forged.runs.some((sourceRun) => sourceRun.runId === run.runId),
      ),
    ).toBe(true);
    expect(orchestrator.getSession(created.sessionId)).toEqual(
      sourceBeforeRevision,
    );
  });
});

function trackedOrchestrator(): CouncilOrchestrator {
  const orchestrator = new CouncilOrchestrator();
  orchestrators.push(orchestrator);
  return orchestrator;
}

function fragmentStatus(session: SessionSnapshot, fragmentId: string): string {
  return session.fragments.find((fragment) => fragment.id === fragmentId)?.status ?? "missing";
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
