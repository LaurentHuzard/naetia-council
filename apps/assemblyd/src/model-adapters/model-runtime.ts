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
  if (adapter !== "codex-cli") {
    throw new Error("MODEL_ADAPTER must be either fake or codex-cli");
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
