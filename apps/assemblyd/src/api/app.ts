import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { CouncilOrchestrator } from "../orchestration/council-orchestrator.js";
import { resolveAssemblyDatabasePath } from "../persistence/database-path.js";
import {
  JournalError,
  SqliteEventJournal,
} from "../persistence/sqlite-event-journal.js";

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

const DEFAULT_FAKE_MODEL_DELAY_MS = 200;

export interface BuildAppOptions {
  readonly orchestrator?: CouncilOrchestrator;
  readonly fakeModelDelayMs?: number;
  readonly databasePath?: string;
  readonly databaseBusyTimeoutMs?: number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const orchestrator =
    options.orchestrator ??
    new CouncilOrchestrator({
      journal: new SqliteEventJournal(
        options.databasePath ??
          resolveAssemblyDatabasePath(process.env["ASSEMBLY_DB_PATH"]),
        options.databaseBusyTimeoutMs === undefined
          ? {}
          : { busyTimeoutMs: options.databaseBusyTimeoutMs },
      ),
    });
  const fakeModelDelayMs =
    options.fakeModelDelayMs ??
    parseFakeModelDelay(process.env["FAKE_MODEL_DELAY_MS"]);

  app.get("/health", async () => {
    orchestrator.assertPersistenceAvailable();
    return {
      status: "ok",
      service: "assemblyd",
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
