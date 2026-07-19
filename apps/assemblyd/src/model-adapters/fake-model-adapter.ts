import type {
  AgentId,
  ModelAdapter,
  ModelEvent,
  ModelRequest,
} from "./model-adapter.js";

const DEFAULT_LATENCY_MS = 25;

const perspectives: Readonly<Record<AgentId, readonly string[]>> = {
  architect: [
    "Cadre la quête autour d'un résultat observable. ",
    "Sépare les contraintes des préférences. ",
    "Choisis un prochain geste petit et vérifiable.",
  ],
  trickster: [
    "Challenge la prémisse la plus coûteuse. ",
    "Cherche ce qui peut être retiré sans perdre la preuve. ",
    "Teste l'alternative la plus réversible.",
  ],
  guardian: [
    "Protège l'énergie et le droit d'interrompre. ",
    "Rends visibles les risques avant l'engagement. ",
    "Garde une condition explicite de révision.",
  ],
};

export class FakeModelAdapter implements ModelAdapter {
  async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const chunks = request.empty
      ? []
      : [
          `[${request.agentId}] ${request.quest.title}: `,
          ...perspectives[request.agentId],
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
    yield { type: "completed", content };
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
