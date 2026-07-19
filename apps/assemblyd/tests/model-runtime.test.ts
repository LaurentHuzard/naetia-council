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
      "MODEL_ADAPTER must be either fake or codex-cli",
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
