import { accessSync, constants, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import {
  agentWorkerModelOptionsSchema,
  type AgentWorkerModelOptions,
  type ModelAdapterMessage,
} from "@naetia/assembly-protocol";

const DEFAULT_FAKE_TIMEOUT_MS = 10_000;
const DEFAULT_CODEX_TIMEOUT_MS = 180_000;
const DEFAULT_CODEX_REVEAL_DELAY_MS = 40;
const DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS = 180_000;
const DEFAULT_OPENAI_COMPATIBLE_REVEAL_DELAY_MS = 40;
const DEFAULT_OPENAI_COMPATIBLE_MAX_TOKENS = 512;

export interface ModelRuntime {
  readonly adapter: ModelAdapterMessage;
  readonly model: AgentWorkerModelOptions;
  readonly runTimeoutMs: number;
  readonly workerEnvironment: NodeJS.ProcessEnv;
}

export function resolveModelRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): ModelRuntime {
  const adapter = environment["MODEL_ADAPTER"] ?? "fake";
  if (adapter === "fake") {
    return {
      adapter,
      model: agentWorkerModelOptionsSchema.parse({ adapter }),
      runTimeoutMs: DEFAULT_FAKE_TIMEOUT_MS,
      workerEnvironment: {},
    };
  }
  if (adapter === "openai-compatible") {
    const url = requiredNonEmpty(
      environment["OPENAI_COMPATIBLE_CHAT_URL"],
      "OPENAI_COMPATIBLE_CHAT_URL",
    );
    requireHttpUrl(url, "OPENAI_COMPATIBLE_CHAT_URL");
    const model = requiredNonEmpty(
      environment["OPENAI_COMPATIBLE_MODEL"],
      "OPENAI_COMPATIBLE_MODEL",
    );
    const revealDelayMs = parseIntegerSetting(
      environment["OPENAI_COMPATIBLE_REVEAL_DELAY_MS"],
      "OPENAI_COMPATIBLE_REVEAL_DELAY_MS",
      DEFAULT_OPENAI_COMPATIBLE_REVEAL_DELAY_MS,
      0,
      5_000,
    );
    const maxTokens = parseIntegerSetting(
      environment["OPENAI_COMPATIBLE_MAX_TOKENS"],
      "OPENAI_COMPATIBLE_MAX_TOKENS",
      DEFAULT_OPENAI_COMPATIBLE_MAX_TOKENS,
      32,
      4_096,
    );
    const enableThinking = parseOptionalBooleanSetting(
      environment["OPENAI_COMPATIBLE_ENABLE_THINKING"],
      "OPENAI_COMPATIBLE_ENABLE_THINKING",
    );
    const runTimeoutMs = parseIntegerSetting(
      environment["OPENAI_COMPATIBLE_RUN_TIMEOUT_MS"],
      "OPENAI_COMPATIBLE_RUN_TIMEOUT_MS",
      DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS,
      1_000,
      600_000,
    );
    const apiKey = optionalNonEmpty(
      environment["OPENAI_COMPATIBLE_API_KEY"],
      "OPENAI_COMPATIBLE_API_KEY",
    );

    return {
      adapter,
      model: agentWorkerModelOptionsSchema.parse({
        adapter,
        url,
        model,
        maxTokens,
        ...(enableThinking === undefined ? {} : { enableThinking }),
        revealDelayMs,
      }),
      runTimeoutMs,
      workerEnvironment:
        apiKey === undefined ? {} : { OPENAI_COMPATIBLE_API_KEY: apiKey },
    };
  }
  if (adapter !== "codex-cli") {
    throw new Error(
      "MODEL_ADAPTER must be fake, codex-cli or openai-compatible",
    );
  }

  const executablePath = resolveCodexExecutable(
    environment["CODEX_CLI_PATH"],
    environment["PATH"],
  );
  const codexHome = environment["CODEX_HOME"] ?? join(homedir(), ".codex");
  const model = optionalNonEmpty(environment["CODEX_MODEL"], "CODEX_MODEL");
  const revealDelayMs = parseIntegerSetting(
    environment["CODEX_REVEAL_DELAY_MS"],
    "CODEX_REVEAL_DELAY_MS",
    DEFAULT_CODEX_REVEAL_DELAY_MS,
    0,
    5_000,
  );
  const runTimeoutMs = parseIntegerSetting(
    environment["CODEX_RUN_TIMEOUT_MS"],
    "CODEX_RUN_TIMEOUT_MS",
    DEFAULT_CODEX_TIMEOUT_MS,
    1_000,
    600_000,
  );

  return {
    adapter,
    model: agentWorkerModelOptionsSchema.parse({
      adapter,
      executablePath,
      ...(model === undefined ? {} : { model }),
      revealDelayMs,
    }),
    runTimeoutMs,
    workerEnvironment: { CODEX_HOME: codexHome },
  };
}

function resolveCodexExecutable(
  configuredPath: string | undefined,
  searchPath: string | undefined,
): string {
  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) {
      throw new Error("CODEX_CLI_PATH must be an absolute path");
    }
    return requireExecutable(configuredPath);
  }

  for (const directory of searchPath?.split(delimiter) ?? []) {
    if (directory.length === 0) {
      continue;
    }
    const candidate = join(directory, "codex");
    try {
      return requireExecutable(candidate);
    } catch {
      // Continue until an executable Codex CLI is found on PATH.
    }
  }
  throw new Error(
    "Codex CLI was not found. Set CODEX_CLI_PATH to the absolute executable path.",
  );
}

function requireExecutable(path: string): string {
  try {
    accessSync(path, constants.X_OK);
    return realpathSync(path);
  } catch (error) {
    throw new Error(`Codex CLI is not executable at ${path}`, { cause: error });
  }
}

function optionalNonEmpty(
  value: string | undefined,
  setting: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${setting} must not be empty when set`);
  }
  return normalized;
}

function requiredNonEmpty(value: string | undefined, setting: string): string {
  const normalized = optionalNonEmpty(value, setting);
  if (normalized === undefined) {
    throw new Error(`${setting} is required`);
  }
  return normalized;
}

function requireHttpUrl(value: string, setting: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${setting} must be a valid HTTP URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${setting} must be a valid HTTP URL`);
  }
}

function parseIntegerSetting(
  value: string | undefined,
  setting: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${setting} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  return parsed;
}

function parseOptionalBooleanSetting(
  value: string | undefined,
  setting: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${setting} must be either true or false`);
}
