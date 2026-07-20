import { randomUUID } from "node:crypto";

import { parseCouncilEvent } from "@naetia/assembly-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/api/app.js";
import {
  formatSseEntry,
  resolveEventCursor,
} from "../src/api/sse.js";
import {
  CouncilOrchestrator,
  type SessionSnapshot,
} from "../src/orchestration/council-orchestrator.js";
import type { JournalEntry } from "../src/persistence/sqlite-event-journal.js";

const apps: ReturnType<typeof buildApp>[] = [];
const orchestrators: CouncilOrchestrator[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    orchestrators.splice(0).map((orchestrator) => orchestrator.close()),
  );
});

describe.sequential("Council SSE transport", () => {
  it("uses the newest cursor from the query and Last-Event-ID", () => {
    expect(resolveEventCursor(5, "7")).toBe(7);
    expect(resolveEventCursor(9, "7")).toBe(9);
    expect(resolveEventCursor(undefined, undefined)).toBe(0);
    expect(() => resolveEventCursor(0, "-1")).toThrow();
    expect(() => resolveEventCursor(0, ["1", "2"])).toThrow();
  });

  it("serializes a durable sequence as a named SSE event", () => {
    const sessionId = randomUUID();
    const questId = randomUUID();
    const occurredAt = "2026-07-19T12:00:00.000Z";
    const event = parseCouncilEvent({
      id: randomUUID(),
      type: "session.created",
      sessionId,
      occurredAt,
      payload: {
        quest: {
          id: questId,
          title: "Ouvrir les signaux",
          createdAt: occurredAt,
        },
        session: {
          id: sessionId,
          questId,
          status: "draft",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      },
    });

    expect(formatSseEntry({ sequence: 12, event })).toBe(
      `id: 12\nevent: council-event\ndata: ${JSON.stringify(event)}\n\n`,
    );
  });

  it("publishes committed events in replayable sequence order", async () => {
    const orchestrator = new CouncilOrchestrator();
    orchestrators.push(orchestrator);
    const created = orchestrator.createSession({ title: "Tester le signal" });
    const delivered: JournalEntry[] = [];
    const unsubscribe = orchestrator.onSessionEvent(
      created.sessionId,
      (entry) => delivered.push(entry),
    );
    orchestrator.onSessionEvent(created.sessionId, () => {
      throw new Error("transport disconnected");
    });

    expect(() =>
      orchestrator.convene(created.sessionId, {
        behaviorByAgent: {
          architect: { latencyMs: 10_000 },
          trickster: { latencyMs: 10_000 },
          guardian: { latencyMs: 10_000 },
        },
      }),
    ).not.toThrow();
    unsubscribe();

    expect(delivered.length).toBeGreaterThanOrEqual(7);
    expect(delivered.map(({ sequence }) => sequence)).toEqual(
      [...delivered.map(({ sequence }) => sequence)].sort(
        (left, right) => left - right,
      ),
    );
    expect(new Set(delivered.map(({ sequence }) => sequence)).size).toBe(
      delivered.length,
    );
    const replayed = orchestrator.getSessionEventsAfter(
      created.sessionId,
      created.eventCursor,
    );
    expect(replayed.slice(0, delivered.length)).toEqual(delivered);
  });

  it("rejects invalid cursors and unknown sessions before opening a stream", async () => {
    const app = buildApp({ databasePath: ":memory:" });
    apps.push(app);

    const invalid = await app.inject({
      method: "GET",
      url: `/sessions/${randomUUID()}/events?after=-1`,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "INVALID_REQUEST" });

    const missing = await app.inject({
      method: "GET",
      url: `/sessions/${randomUUID()}/events?after=0`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "SESSION_NOT_FOUND" });
  });

  it("keeps revision creation out of the source session stream", async () => {
    const orchestrator = new CouncilOrchestrator();
    orchestrators.push(orchestrator);
    const source = orchestrator.createSession({ title: "Isoler la révision" });
    orchestrator.convene(source.sessionId, {
      behaviorByAgent: {
        architect: { latencyMs: 1 },
        trickster: { latencyMs: 1 },
        guardian: { latencyMs: 1 },
      },
    });
    const completed = await waitForSession(
      orchestrator,
      source.sessionId,
      (session) => session.status === "completed",
    );
    const fragment = completed.fragments[0]!;
    orchestrator.keepFragment(fragment.id);
    const forged = orchestrator.forgeDecision(source.sessionId, {
      fragmentIds: [fragment.id],
      statement: "Préserver le signal source.",
      rationale: "La révision possède son propre flux.",
      nextSmallStep: "Créer la session enfant.",
    })!;
    const sourceEntries: JournalEntry[] = [];
    const unsubscribe = orchestrator.onSessionEvent(
      source.sessionId,
      (entry) => sourceEntries.push(entry),
    );

    const revision = orchestrator.createRevision(source.sessionId, {
      decisionId: forged.decision!.id,
      intent: "Une nouvelle contrainte doit rester isolée.",
    })!;
    unsubscribe();

    expect(sourceEntries).toEqual([]);
    expect(
      orchestrator
        .getSessionEventsAfter(revision.sessionId, 0)
        .map(({ event }) => event.type),
    ).toEqual(["session.created"]);
  });
});

async function waitForSession(
  orchestrator: CouncilOrchestrator,
  sessionId: string,
  predicate: (session: SessionSnapshot) => boolean,
): Promise<SessionSnapshot> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const session = orchestrator.getSession(sessionId);
    if (session !== undefined && predicate(session)) return session;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Session ${sessionId} did not reach the expected state`);
}
