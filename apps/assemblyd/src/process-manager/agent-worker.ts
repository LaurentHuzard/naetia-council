import { randomUUID } from "node:crypto";

import {
  agentWorkerCommandSchema,
  agentWorkerEventSchema,
  type AgentWorkerCommand,
  type AgentWorkerEvent,
} from "@naetia/assembly-protocol";

import { FakeModelAdapter } from "../model-adapters/fake-model-adapter.js";
import type { ModelRequest } from "../model-adapters/model-adapter.js";

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
      agentId: command.agentId,
      quest: {
        title: command.quest.title,
        ...(command.quest.context === undefined
          ? {}
          : { context: command.quest.context }),
      },
      ...(command.model?.latencyMs === undefined
        ? {}
        : { latencyMs: command.model.latencyMs }),
      ...(command.model?.failAtDelta === undefined
        ? {}
        : { failAtDelta: command.model.failAtDelta }),
      ...(command.model?.empty === undefined
        ? {}
        : { empty: command.model.empty }),
    };

    const adapter = new FakeModelAdapter();
    for await (const modelEvent of adapter.stream(
      request,
      abortController.signal,
    )) {
      if (
        modelEvent.type === "delta" &&
        command.model?.crashAtDelta === modelEvent.index
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
        throw new Error("The fake model produced an empty contribution");
      }

      sendEvent({
        type: "completed",
        eventId: randomUUID(),
        ...baseEvent,
        occurredAt: new Date().toISOString(),
        contributionId,
        content: modelEvent.content,
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
          code: "MODEL_ERROR",
          message: error instanceof Error ? error.message : "Unknown model error",
        },
      });
    }
  } finally {
    activeRun = undefined;
    process.disconnect();
  }
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
