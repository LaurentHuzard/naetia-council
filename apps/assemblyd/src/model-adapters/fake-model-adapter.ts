import type {
  ModelAdapter,
  ModelEvent,
  ModelRequest,
} from "./model-adapter.js";

const DEFAULT_LATENCY_MS = 25;

export class FakeModelAdapter implements ModelAdapter {
  async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const startedAt = Date.now();
    const chunks = request.empty
      ? []
      : [
          `[${request.agentId}] ${request.quest.title}: `,
          `${request.agentName} — ${request.perspective} `,
          request.instructions,
        ];
    let content = "";

    for (const [index, delta] of chunks.entries()) {
      throwIfAborted(signal);
      await abortableDelay(request.latencyMs ?? DEFAULT_LATENCY_MS, signal);

      if (request.failAtDelta === index) {
        throw new Error(`Fake model failure at delta ${index}`);
      }

      content += delta;
      yield { type: "delta", index, delta };
    }

    throwIfAborted(signal);
    yield {
      type: "completed",
      content,
      execution: {
        adapter: "fake",
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("Model generation aborted");
  error.name = "AbortError";
  return error;
}
