import type { ServerResponse } from "node:http";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import { z } from "zod";

import {
  resolveModelRuntime,
  type ModelRuntime,
} from "../model-adapters/model-runtime.js";
import {
  CouncilCommandError,
  CouncilOrchestrator,
} from "../orchestration/council-orchestrator.js";
import { resolveAssemblyDatabasePath } from "../persistence/database-path.js";
import {
  JournalError,
  SqliteEventJournal,
  type JournalEntry,
} from "../persistence/sqlite-event-journal.js";
import { AgentProcessManager } from "../process-manager/process-manager.js";
import {
  eventStreamQuerySchema,
  formatSseEntry,
  resolveEventCursor,
} from "./sse.js";

const createSessionBodySchema = z
  .object({
    quest: z
      .object({
        title: z.string().trim().min(1).max(200),
        context: z.string().trim().max(10_000).optional(),
      })
      .strict(),
  })
  .strict();

const idParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

const runIdParamsSchema = z.object({
  runId: z.string().uuid(),
});

const fragmentIdParamsSchema = z.object({
  fragmentId: z.string().uuid(),
});

const challengeFragmentBodySchema = z
  .object({
    prompt: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const forgeDecisionBodySchema = z
  .object({
    fragmentIds: z
      .array(z.string().uuid())
      .min(1)
      .max(20)
      .refine((identifiers) => new Set(identifiers).size === identifiers.length),
    statement: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(5_000),
    objection: z.string().trim().min(1).max(5_000).optional(),
    reviewCondition: z.string().trim().min(1).max(2_000).optional(),
    nextSmallStep: z.string().trim().min(1).max(1_000),
  })
  .strict();

const DEFAULT_FAKE_MODEL_DELAY_MS = 200;
const SSE_HEARTBEAT_MS = 15_000;

export interface BuildAppOptions {
  readonly orchestrator?: CouncilOrchestrator;
  readonly fakeModelDelayMs?: number;
  readonly databasePath?: string;
  readonly databaseBusyTimeoutMs?: number;
  readonly modelRuntime?: ModelRuntime;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const modelRuntime = options.modelRuntime ?? resolveModelRuntime();
  const orchestrator =
    options.orchestrator ??
    new CouncilOrchestrator({
      processManager: new AgentProcessManager({
        defaultTimeoutMs: modelRuntime.runTimeoutMs,
        workerEnvironment: modelRuntime.workerEnvironment,
      }),
      journal: new SqliteEventJournal(
        options.databasePath ??
          resolveAssemblyDatabasePath(process.env["ASSEMBLY_DB_PATH"]),
        options.databaseBusyTimeoutMs === undefined
          ? {}
          : { busyTimeoutMs: options.databaseBusyTimeoutMs },
      ),
      model: modelRuntime.model,
    });
  const fakeModelDelayMs =
    options.fakeModelDelayMs ??
    (modelRuntime.adapter === "fake"
      ? parseFakeModelDelay(process.env["FAKE_MODEL_DELAY_MS"])
      : DEFAULT_FAKE_MODEL_DELAY_MS);
  const eventStreams = new Set<ServerResponse>();

  app.get("/health", async () => {
    orchestrator.assertPersistenceAvailable();
    return {
      status: "ok",
      service: "assemblyd",
      modelAdapter: modelRuntime.adapter,
      ...(modelRuntime.model.adapter !== "codex-cli" ||
      modelRuntime.model.model === undefined
        ? {}
        : { model: modelRuntime.model.model }),
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof JournalError &&
      error.code === "PERSISTENCE_UNAVAILABLE"
    ) {
      return reply.code(503).send({
        error: "PERSISTENCE_UNAVAILABLE",
        message: "The Assembly journal is temporarily unavailable",
      });
    }
    if (error instanceof CouncilCommandError) {
      return reply.code(409).send({
        error: error.code,
        message: error.message,
      });
    }
    return reply.send(error);
  });

  app.post("/sessions", async (request, reply) => {
    const body = createSessionBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A non-empty quest title is required",
      });
    }
    return reply.code(201).send(
      orchestrator.createSession({
        title: body.data.quest.title,
        ...(body.data.quest.context === undefined
          ? {}
          : { context: body.data.quest.context }),
      }),
    );
  });

  app.post("/sessions/:sessionId/convene", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid session id is required",
      });
    }
    const behavior = { latencyMs: fakeModelDelayMs } as const;
    const session = orchestrator.convene(params.data.sessionId, {
      behaviorByAgent: {
        architect: behavior,
        trickster: behavior,
        guardian: behavior,
      },
    });
    if (session === undefined) {
      return reply.code(404).send({
        error: "SESSION_NOT_FOUND",
        message: "Council session not found",
      });
    }
    return reply.code(202).send(session);
  });

  app.get("/sessions/:sessionId", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid session id is required",
      });
    }
    const session = orchestrator.getSession(params.data.sessionId);
    if (session === undefined) {
      return reply.code(404).send({
        error: "SESSION_NOT_FOUND",
        message: "Council session not found",
      });
    }
    return session;
  });

  app.get("/sessions/:sessionId/events", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const query = eventStreamQuerySchema.safeParse(request.query);
    let cursor: number;
    try {
      cursor = resolveEventCursor(
        query.success ? query.data.after : undefined,
        request.headers["last-event-id"],
      );
    } catch {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid event cursor is required",
      });
    }
    if (!params.success || !query.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid session id and event cursor are required",
      });
    }
    if (orchestrator.getSession(params.data.sessionId) === undefined) {
      return reply.code(404).send({
        error: "SESSION_NOT_FOUND",
        message: "Council session not found",
      });
    }

    const pending: JournalEntry[] = [];
    let isStreaming = false;
    let lastSentSequence = cursor;
    let cleanedUp = false;
    const response = reply.raw;
    const writeEntry = (entry: JournalEntry): void => {
      if (entry.sequence <= lastSentSequence || response.writableEnded) {
        return;
      }
      response.write(formatSseEntry(entry));
      lastSentSequence = entry.sequence;
    };
    const unsubscribe = orchestrator.onSessionEvent(
      params.data.sessionId,
      (entry) => {
        if (isStreaming) {
          writeEntry(entry);
        } else {
          pending.push(entry);
        }
      },
    );

    let backlog: readonly JournalEntry[];
    try {
      backlog = orchestrator.getSessionEventsAfter(
        params.data.sessionId,
        cursor,
      );
    } catch (error) {
      unsubscribe();
      throw error;
    }

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) {
        response.write(": heartbeat\n\n");
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();

    const cleanup = (): void => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      unsubscribe();
      clearInterval(heartbeat);
      eventStreams.delete(response);
    };

    reply.hijack();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write("retry: 1000\n\n");
    eventStreams.add(response);
    response.once("close", cleanup);
    request.raw.once("aborted", cleanup);

    for (const entry of backlog) {
      writeEntry(entry);
    }
    isStreaming = true;
    for (const entry of [...pending].sort(
      (left, right) => left.sequence - right.sequence,
    )) {
      writeEntry(entry);
    }
    return reply;
  });

  app.post("/runs/:runId/cancel", async (request, reply) => {
    const params = runIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid run id is required",
      });
    }
    const run = orchestrator.cancelRun(params.data.runId);
    if (run === undefined) {
      return reply.code(404).send({
        error: "RUN_NOT_FOUND",
        message: "Agent run not found",
      });
    }
    return reply.code(202).send({ run });
  });

  app.post("/fragments/:fragmentId/keep", async (request, reply) => {
    const params = fragmentIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return invalidFragmentId(reply);
    }
    const session = orchestrator.keepFragment(params.data.fragmentId);
    if (session === undefined) {
      return fragmentNotFound(reply);
    }
    return session;
  });

  app.post("/fragments/:fragmentId/challenge", async (request, reply) => {
    const params = fragmentIdParamsSchema.safeParse(request.params);
    const body = challengeFragmentBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid fragment id and challenge are required",
      });
    }
    const session = orchestrator.challengeFragment(
      params.data.fragmentId,
      body.data.prompt,
    );
    if (session === undefined) {
      return fragmentNotFound(reply);
    }
    return session;
  });

  app.post("/fragments/:fragmentId/compost", async (request, reply) => {
    const params = fragmentIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return invalidFragmentId(reply);
    }
    const session = orchestrator.compostFragment(params.data.fragmentId);
    if (session === undefined) {
      return fragmentNotFound(reply);
    }
    return session;
  });

  app.post("/sessions/:sessionId/forge", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = forgeDecisionBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        message: "A valid decision and at least one kept fragment are required",
      });
    }
    const session = orchestrator.forgeDecision(params.data.sessionId, {
      fragmentIds: body.data.fragmentIds,
      statement: body.data.statement,
      rationale: body.data.rationale,
      ...(body.data.objection === undefined
        ? {}
        : { objection: body.data.objection }),
      ...(body.data.reviewCondition === undefined
        ? {}
        : { reviewCondition: body.data.reviewCondition }),
      nextSmallStep: body.data.nextSmallStep,
    });
    if (session === undefined) {
      return reply.code(404).send({
        error: "SESSION_NOT_FOUND",
        message: "Council session not found",
      });
    }
    return session;
  });

  app.addHook("preClose", async () => {
    for (const response of eventStreams) {
      response.end();
    }
    eventStreams.clear();
  });

  app.addHook("onClose", async () => {
    await orchestrator.close();
  });

  return app;
}

function parseFakeModelDelay(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_FAKE_MODEL_DELAY_MS;
  }
  const delay = Number(value);
  if (!Number.isInteger(delay) || delay < 0 || delay > 30_000) {
    throw new Error("FAKE_MODEL_DELAY_MS must be an integer from 0 to 30000");
  }
  return delay;
}

function invalidFragmentId(reply: FastifyReply) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    message: "A valid fragment id is required",
  });
}

function fragmentNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "FRAGMENT_NOT_FOUND",
    message: "Council fragment not found",
  });
}
