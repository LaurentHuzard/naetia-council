import { z } from "zod";

import { buildCouncilModelPrompt } from "./council-model-prompt.js";
import {
  ModelAdapterError,
  type ModelAdapter,
  type ModelEvent,
  type ModelRequest,
  type ModelUsage,
} from "./model-adapter.js";

const DEFAULT_REVEAL_DELAY_MS = 40;
const MAX_RESPONSE_BYTES = 512 * 1024;
const CONTRIBUTION_CHUNK_SIZE = 180;

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const chatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: usageSchema.optional(),
  })
  .passthrough();

export interface OpenAiCompatibleModelAdapterOptions {
  readonly url: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly maxTokens: number;
  readonly enableThinking?: boolean;
  readonly revealDelayMs?: number;
  readonly fetcher?: typeof fetch;
}

export class OpenAiCompatibleModelAdapter implements ModelAdapter {
  readonly #url: string;
  readonly #model: string;
  readonly #apiKey: string | undefined;
  readonly #maxTokens: number;
  readonly #enableThinking: boolean | undefined;
  readonly #revealDelayMs: number;
  readonly #fetcher: typeof fetch;

  constructor(options: OpenAiCompatibleModelAdapterOptions) {
    this.#url = options.url;
    this.#model = options.model;
    this.#apiKey = options.apiKey;
    this.#maxTokens = options.maxTokens;
    this.#enableThinking = options.enableThinking;
    this.#revealDelayMs =
      options.revealDelayMs ?? DEFAULT_REVEAL_DELAY_MS;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    throwIfAborted(signal);
    const startedAt = Date.now();
    const result = await this.#complete(request, signal);
    const generationDurationMs = Date.now() - startedAt;
    let content = "";

    for (const [index, delta] of chunkContribution(result.content).entries()) {
      throwIfAborted(signal);
      if (this.#revealDelayMs > 0) {
        await abortableDelay(this.#revealDelayMs, signal);
      }
      content += delta;
      yield { type: "delta", index, delta };
    }

    throwIfAborted(signal);
    yield {
      type: "completed",
      content,
      execution: {
        adapter: "openai-compatible",
        model: this.#model,
        durationMs: generationDurationMs,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      },
    };
  }

  async #complete(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<Readonly<{ content: string; usage?: ModelUsage }>> {
    let response: Response;
    try {
      response = await this.#fetcher(this.#url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#apiKey === undefined
            ? {}
            : { authorization: `Bearer ${this.#apiKey}` }),
        },
        body: JSON.stringify({
          model: this.#model,
          messages: [
            { role: "user", content: buildCouncilModelPrompt(request) },
          ],
          max_tokens: this.#maxTokens,
          ...(this.#enableThinking === undefined
            ? {}
            : {
                chat_template_kwargs: {
                  enable_thinking: this.#enableThinking,
                },
              }),
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_UNAVAILABLE",
        "The configured OpenAI-compatible provider is unavailable.",
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_HTTP_ERROR",
        `The OpenAI-compatible provider returned HTTP ${String(response.status)}.`,
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_OUTPUT_INVALID",
        "The OpenAI-compatible provider response could not be read.",
        { cause: error },
      );
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_OUTPUT_INVALID",
        "The OpenAI-compatible provider returned more output than The Assembly accepts.",
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_OUTPUT_INVALID",
        "The OpenAI-compatible provider returned invalid JSON.",
        { cause: error },
      );
    }
    const parsed = chatCompletionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_OUTPUT_INVALID",
        "The OpenAI-compatible provider returned an invalid chat completion.",
      );
    }

    const content = parsed.data.choices[0]!.message.content.trim();
    if (content.length === 0) {
      throw new ModelAdapterError(
        "OPENAI_COMPATIBLE_EMPTY_OUTPUT",
        "The OpenAI-compatible provider completed without a contribution.",
      );
    }

    return {
      content,
      ...(parsed.data.usage === undefined
        ? {}
        : { usage: normalizeUsage(parsed.data.usage) }),
    };
  }
}

function normalizeUsage(usage: z.infer<typeof usageSchema>): ModelUsage {
  return {
    inputTokens: usage.prompt_tokens,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.completion_tokens,
    reasoningOutputTokens:
      usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

function chunkContribution(content: string): readonly string[] {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += CONTRIBUTION_CHUNK_SIZE) {
    chunks.push(content.slice(index, index + CONTRIBUTION_CHUNK_SIZE));
  }
  return chunks;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
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
