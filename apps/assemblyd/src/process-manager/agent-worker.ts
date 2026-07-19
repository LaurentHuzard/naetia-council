import { randomUUID } from "node:crypto";

import {
  agentWorkerCommandSchema,
  agentWorkerEventSchema,
  type AgentWorkerModelOptions,
  type AgentWorkerCommand,
  type AgentWorkerEvent,
} from "@naetia/assembly-protocol";

import { CodexCliModelAdapter } from "../model-adapters/codex-cli-model-adapter.js";
import { FakeModelAdapter } from "../model-adapters/fake-model-adapter.js";
import {
  ModelAdapterError,
  type ModelAdapter,
  type ModelRequest,
} from "../model-adapters/model-adapter.js";

let activeRun:
  | Readonly<{
      runId: string;
      sessionId: string;
      abortController: AbortController;
    }>
  | undefined;

process.on("message", (rawMessage: unknown) => {
  const parsed = agentWorkerCommandSchema.safeParse(rawMessage);
  if (!parsed.success) {
    process.exitCode = 2;
    process.disconnect();
    return;
  }

  handleCommand(parsed.data);
});
process.on("disconnect", abortActiveRun);
process.once("SIGTERM", abortActiveRun);
process.once("SIGINT", abortActiveRun);

function handleCommand(command: AgentWorkerCommand): void {
  if (command.type === "cancel") {
    if (activeRun?.runId === command.runId) {
      activeRun.abortController.abort();
    }
    return;
  }

  if (activeRun !== undefined) {
    sendEvent({
      type: "failed",
      eventId: randomUUID(),
      sessionId: command.sessionId,
      runId: command.runId,
      occurredAt: new Date().toISOString(),
      error: {
        code: "WORKER_ALREADY_RUNNING",
        message: "This agent process already owns a run",
      },
    });
    return;
  }

  const abortController = new AbortController();
  activeRun = Object.freeze({
    runId: command.runId,
    sessionId: command.sessionId,
    abortController,
  });

  void executeRun(deepFreeze(structuredClone(command)), abortController);
}

async function executeRun(
  command: Extract<AgentWorkerCommand, { type: "start" }>,
  abortController: AbortController,
): Promise<void> {
  const baseEvent = {
    sessionId: command.sessionId,
    runId: command.runId,
  } as const;
  const contributionId = randomUUID();

  try {
    sendStatus(baseEvent, "starting");
    sendStatus(baseEvent, "running");

    const request: ModelRequest = {
      agentId: command.agentDefinition.role,
      agentName: command.agentDefinition.name,
      perspective: command.agentDefinition.perspective,
      instructions: command.agentDefinition.instructions,
      quest: {
        title: command.quest.title,
        ...(command.quest.context === undefined
          ? {}
          : { context: command.quest.context }),
      },
      ...(command.model.adapter !== "fake" ||
      command.model.latencyMs === undefined
        ? {}
        : { latencyMs: command.model.latencyMs }),
      ...(command.model.adapter !== "fake" ||
      command.model.failAtDelta === undefined
        ? {}
        : { failAtDelta: command.model.failAtDelta }),
      ...(command.model.adapter !== "fake" || command.model.empty === undefined
        ? {}
        : { empty: command.model.empty }),
    };

    const adapter = createModelAdapter(command.model);
    for await (const modelEvent of adapter.stream(
      request,
      abortController.signal,
    )) {
      if (
        modelEvent.type === "delta" &&
        command.model.adapter === "fake" &&
        command.model.crashAtDelta === modelEvent.index
      ) {
        process.exit(86);
      }

      if (modelEvent.type === "delta") {
        sendEvent({
          type: "delta",
          eventId: randomUUID(),
          ...baseEvent,
          occurredAt: new Date().toISOString(),
          contributionId,
          delta: modelEvent.delta,
          index: modelEvent.index,
        });
        continue;
      }

      if (modelEvent.content.length === 0) {
        throw new Error("The model produced an empty contribution");
      }

      sendEvent({
        type: "completed",
        eventId: randomUUID(),
        ...baseEvent,
        occurredAt: new Date().toISOString(),
        contributionId,
        content: modelEvent.content,
        modelExecution: modelEvent.execution,
      });
      sendStatus(baseEvent, "completed");
    }
  } catch (error) {
    if (isAbortError(error)) {
      sendStatus(baseEvent, "cancelled");
    } else {
      sendEvent({
        type: "failed",
        eventId: randomUUID(),
        ...baseEvent,
        occurredAt: new Date().toISOString(),
        error: {
          code:
            error instanceof ModelAdapterError ? error.code : "MODEL_ERROR",
          message: error instanceof Error ? error.message : "Unknown model error",
        },
      });
    }
  } finally {
    activeRun = undefined;
    process.disconnect();
  }
}

function createModelAdapter(model: AgentWorkerModelOptions): ModelAdapter {
  if (model.adapter === "fake") {
    return new FakeModelAdapter();
  }
  return new CodexCliModelAdapter({
    executablePath: model.executablePath,
    ...(model.model === undefined ? {} : { model: model.model }),
    revealDelayMs: model.revealDelayMs,
  });
}

function abortActiveRun(): void {
  activeRun?.abortController.abort();
}

function sendStatus(
  baseEvent: Readonly<{ sessionId: string; runId: string }>,
  status:
    | "starting"
    | "running"
    | "completed"
    | "cancelled",
): void {
  sendEvent({
    type: "status",
    eventId: randomUUID(),
    ...baseEvent,
    occurredAt: new Date().toISOString(),
    status,
  });
}

function sendEvent(candidate: AgentWorkerEvent): void {
  const event = agentWorkerEventSchema.parse(candidate);
  if (process.connected) {
    process.send?.(event);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
