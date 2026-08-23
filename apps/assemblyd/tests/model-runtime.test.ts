import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveModelRuntime } from "../src/model-adapters/model-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("model runtime configuration", () => {
  it("keeps the deterministic fake adapter as the default", () => {
    expect(resolveModelRuntime({})).toEqual({
      adapter: "fake",
      model: { adapter: "fake" },
      runTimeoutMs: 10_000,
      workerEnvironment: {},
    });
  });

  it("configures Codex from an absolute executable and forwards no secrets", () => {
    const codexHome = temporaryDirectory();
    const runtime = resolveModelRuntime({
      MODEL_ADAPTER: "codex-cli",
      CODEX_CLI_PATH: process.execPath,
      CODEX_HOME: codexHome,
      CODEX_MODEL: "gpt-fixture",
      CODEX_REVEAL_DELAY_MS: "12",
      CODEX_RUN_TIMEOUT_MS: "90000",
      OPENAI_API_KEY: "must-not-cross-ipc",
      ANTHROPIC_API_KEY: "must-not-cross-ipc",
    });

    expect(runtime).toEqual({
      adapter: "codex-cli",
      model: {
        adapter: "codex-cli",
        executablePath: process.execPath,
        model: "gpt-fixture",
        revealDelayMs: 12,
      },
      runTimeoutMs: 90_000,
      workerEnvironment: { CODEX_HOME: codexHome },
    });
  });

  it("configures an OpenAI-compatible provider without sending its key over IPC", () => {
    const runtime = resolveModelRuntime({
      MODEL_ADAPTER: "openai-compatible",
      OPENAI_COMPATIBLE_CHAT_URL:
        "http://compute-host:8003/v1/chat/completions",
      OPENAI_COMPATIBLE_MODEL: "local-council-model",
      OPENAI_COMPATIBLE_API_KEY: "local-secret",
      OPENAI_COMPATIBLE_MAX_TOKENS: "384",
      OPENAI_COMPATIBLE_ENABLE_THINKING: "false",
      OPENAI_COMPATIBLE_REVEAL_DELAY_MS: "12",
      OPENAI_COMPATIBLE_RUN_TIMEOUT_MS: "90000",
      UNRELATED_SECRET: "must-not-cross-worker-boundary",
    });

    expect(runtime).toEqual({
      adapter: "openai-compatible",
      model: {
        adapter: "openai-compatible",
        url: "http://compute-host:8003/v1/chat/completions",
        model: "local-council-model",
        maxTokens: 384,
        enableThinking: false,
        revealDelayMs: 12,
      },
      runTimeoutMs: 90_000,
      workerEnvironment: { OPENAI_COMPATIBLE_API_KEY: "local-secret" },
    });
    expect(JSON.stringify(runtime.model)).not.toContain("local-secret");
  });

  it("keeps portable OpenAI-compatible defaults and rejects invalid generation bounds", () => {
    expect(
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_CHAT_URL:
          "http://compute-host:8003/v1/chat/completions",
        OPENAI_COMPATIBLE_MODEL: "local-model",
      }).model,
    ).toEqual({
      adapter: "openai-compatible",
      url: "http://compute-host:8003/v1/chat/completions",
      model: "local-model",
      maxTokens: 512,
      revealDelayMs: 40,
    });
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_CHAT_URL:
          "http://compute-host:8003/v1/chat/completions",
        OPENAI_COMPATIBLE_MODEL: "local-model",
        OPENAI_COMPATIBLE_MAX_TOKENS: "0",
      }),
    ).toThrow("OPENAI_COMPATIBLE_MAX_TOKENS must be an integer");
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_CHAT_URL:
          "http://compute-host:8003/v1/chat/completions",
        OPENAI_COMPATIBLE_MODEL: "local-model",
        OPENAI_COMPATIBLE_ENABLE_THINKING: "sometimes",
      }),
    ).toThrow("OPENAI_COMPATIBLE_ENABLE_THINKING must be either true or false");
  });

  it("requires an explicit model and HTTP chat URL for an OpenAI-compatible provider", () => {
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_MODEL: "local-model",
      }),
    ).toThrow("OPENAI_COMPATIBLE_CHAT_URL is required");
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_CHAT_URL: "ssh://compute-host/model",
        OPENAI_COMPATIBLE_MODEL: "local-model",
      }),
    ).toThrow("OPENAI_COMPATIBLE_CHAT_URL must be a valid HTTP URL");
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "openai-compatible",
        OPENAI_COMPATIBLE_CHAT_URL:
          "http://compute-host:8003/v1/chat/completions",
      }),
    ).toThrow("OPENAI_COMPATIBLE_MODEL is required");
  });

  it("rejects a relative executable path", () => {
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "codex-cli",
        CODEX_CLI_PATH: "bin/codex",
      }),
    ).toThrow("CODEX_CLI_PATH must be an absolute path");
  });

  it("rejects invalid adapter settings", () => {
    expect(() => resolveModelRuntime({ MODEL_ADAPTER: "remote-magic" })).toThrow(
      "MODEL_ADAPTER must be fake, codex-cli or openai-compatible",
    );
    expect(() =>
      resolveModelRuntime({
        MODEL_ADAPTER: "codex-cli",
        CODEX_CLI_PATH: process.execPath,
        CODEX_RUN_TIMEOUT_MS: "50",
      }),
    ).toThrow("CODEX_RUN_TIMEOUT_MS must be an integer");
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "naetia-codex-home-"));
  temporaryDirectories.push(directory);
  return directory;
}
