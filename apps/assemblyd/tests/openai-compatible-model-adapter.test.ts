import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleModelAdapter,
  type OpenAiCompatibleModelAdapterOptions,
} from "../src/model-adapters/openai-compatible-model-adapter.js";
import type { ModelRequest } from "../src/model-adapters/model-adapter.js";

describe("OpenAiCompatibleModelAdapter", () => {
  it("calls a chat-completions endpoint and records model usage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Commence par une expérience locale et réversible.",
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 24,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 6 },
        },
      }),
    );
    const events = await collect(
      adapter({
        fetcher,
        apiKey: "secret-for-test",
        enableThinking: false,
        revealDelayMs: 0,
      }),
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://compute-host:8003/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer secret-for-test",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "local-council-model",
      max_tokens: 512,
      chat_template_kwargs: { enable_thinking: false },
      stream: false,
      messages: [
        {
          role: "user",
          content: expect.stringContaining("Rôle : Architect."),
        },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "completed",
      content: "Commence par une expérience locale et réversible.",
      execution: {
        adapter: "openai-compatible",
        model: "local-council-model",
        durationMs: expect.any(Number),
        usage: {
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 24,
          reasoningOutputTokens: 6,
        },
      },
    });
  });

  it("does not invent usage when the provider omits it", async () => {
    const events = await collect(
      adapter({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({
            choices: [{ message: { content: "Une réponse sans métriques." } }],
          }),
        ),
        revealDelayMs: 0,
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "completed",
      execution: { adapter: "openai-compatible" },
    });
    expect(events.at(-1)).not.toHaveProperty("execution.usage");
  });

  it("reports HTTP failures without exposing the provider response", async () => {
    const pending = collect(
      adapter({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response("remote-secret-and-stack-trace", { status: 500 }),
        ),
      }),
    );

    await expect(pending).rejects.toMatchObject({
      code: "OPENAI_COMPATIBLE_HTTP_ERROR",
      message: "The OpenAI-compatible provider returned HTTP 500.",
    });
    await expect(pending).rejects.not.toThrow("remote-secret-and-stack-trace");
  });

  it("rejects malformed and empty completions explicitly", async () => {
    await expect(
      collect(
        adapter({
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(
            jsonResponse({ choices: [] }),
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "OPENAI_COMPATIBLE_OUTPUT_INVALID" });
    await expect(
      collect(
        adapter({
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(
            jsonResponse({ choices: [{ message: { content: "   " } }] }),
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "OPENAI_COMPATIBLE_EMPTY_OUTPUT" });
  });

  it("propagates cancellation to the HTTP request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
    );
    const pending = collect(adapter({ fetcher }), controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function adapter(
  overrides: Partial<OpenAiCompatibleModelAdapterOptions> = {},
): OpenAiCompatibleModelAdapter {
  return new OpenAiCompatibleModelAdapter({
    url: "http://compute-host:8003/v1/chat/completions",
    model: "local-council-model",
    maxTokens: 512,
    ...overrides,
  });
}

async function collect(
  modelAdapter: OpenAiCompatibleModelAdapter,
  signal: AbortSignal = new AbortController().signal,
) {
  const events = [];
  for await (const event of modelAdapter.stream(request(), signal)) {
    events.push(event);
  }
  return events;
}

function request(): ModelRequest {
  return {
    agentId: "architect",
    agentName: "Architect",
    perspective: "Structure et clarifie.",
    instructions: "Propose le prochain geste vérifiable.",
    quest: { title: "Brancher le Council sur la RTX" },
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
