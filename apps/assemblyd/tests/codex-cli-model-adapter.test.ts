import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CodexCliModelAdapter,
  buildCodexPrompt,
} from "../src/model-adapters/codex-cli-model-adapter.js";
import type {
  ModelEvent,
  ModelRequest,
} from "../src/model-adapters/model-adapter.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-codex-cli.mjs", import.meta.url),
);

describe("CodexCliModelAdapter", () => {
  it("reads Codex JSONL, reveals multiple deltas and records usage", async () => {
    const events = await collect(adapter("success").stream(request(), signal()));

    expect(events.filter((event) => event.type === "delta").length).toBeGreaterThan(1);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      content: expect.stringContaining("prochain petit geste"),
      execution: {
        adapter: "codex-cli",
        model: "fixture-model",
        durationMs: expect.any(Number),
        usage: {
          inputTokens: 120,
          cachedInputTokens: 80,
          outputTokens: 42,
          reasoningOutputTokens: 7,
        },
      },
    });
  });

  it("passes the prompt through stdin and constrains the Codex process", async () => {
    const events = await collect(
      adapter("inspect", { CODEX_HOME: "/tmp/codex-home" }).stream(
        request(),
        signal(),
      ),
    );
    const completed = events.at(-1);
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") {
      return;
    }
    const inspection = JSON.parse(completed.content) as {
      args: string[];
      environment: Record<string, string>;
      prompt: string;
    };

    expect(inspection.args).toContain("--ephemeral");
    expect(inspection.args).toContain("--ignore-user-config");
    expect(inspection.args).toContain("--ignore-rules");
    expect(inspection.args).toContain("read-only");
    expect(inspection.args).toContain('web_search="disabled"');
    expect(inspection.args).toContain('shell_environment_policy.inherit="none"');
    expect(inspection.args).not.toContain("Ouvrir une porte locale");
    expect(inspection.environment).toEqual({
      CODEX_HOME: "/tmp/codex-home",
      FAKE_CODEX_BEHAVIOR: "inspect",
    });
    expect(inspection.prompt).toContain("Rôle : Architect.");
    expect(inspection.prompt).toContain("Perspective : Structure et clarifie.");
    expect(inspection.prompt).toContain("<titre>Ouvrir une porte locale</titre>");
  });

  it.each([
    ["failure", "CODEX_EXEC_FAILED"],
    ["auth", "CODEX_AUTH_MISSING"],
    ["malformed", "CODEX_OUTPUT_INVALID"],
    ["empty", "CODEX_EMPTY_OUTPUT"],
    ["no-message", "CODEX_OUTPUT_INVALID"],
  ] as const)("returns a stable error for %s", async (behavior, code) => {
    await expect(
      collect(adapter(behavior).stream(request(), signal())),
    ).rejects.toMatchObject({ code });
  });

  it("does not expose Codex stderr in its failure", async () => {
    await expect(
      collect(adapter("failure").stream(request(), signal())),
    ).rejects.not.toThrow(/leaked-secret/u);
  });

  it("reports an unavailable Codex executable", async () => {
    const unavailable = new CodexCliModelAdapter({
      executablePath: "/definitely/missing/naetia-codex",
      revealDelayMs: 0,
    });

    await expect(
      collect(unavailable.stream(request(), signal())),
    ).rejects.toMatchObject({ code: "CODEX_CLI_UNAVAILABLE" });
  });

  it("terminates the Codex process when the run is aborted", async () => {
    const controller = new AbortController();
    const pending = collect(
      adapter("hang", {}, { killGraceMs: 20 }).stream(request(), controller.signal),
    );
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("builds distinct prompts from the immutable agent definition", () => {
    const architect = buildCodexPrompt(request());
    const guardian = buildCodexPrompt({
      ...request(),
      agentId: "guardian",
      agentName: "Guardian",
      perspective: "Détecte les risques.",
      instructions: "Signale la surcharge.",
    });

    expect(architect).not.toBe(guardian);
    expect(guardian).toContain("Rôle : Guardian.");
    expect(guardian).toContain("Signale la surcharge.");
  });
});

function adapter(
  behavior: string,
  environment: NodeJS.ProcessEnv = {},
  overrides: Readonly<{ killGraceMs?: number }> = {},
): CodexCliModelAdapter {
  return new CodexCliModelAdapter({
    executablePath: fixturePath,
    model: "fixture-model",
    revealDelayMs: 0,
    environment: { ...environment, FAKE_CODEX_BEHAVIOR: behavior },
    ...overrides,
  });
}

function request(): ModelRequest {
  return {
    agentId: "architect",
    agentName: "Architect",
    perspective: "Structure et clarifie.",
    instructions: "Découpe la quête en choix réversibles.",
    quest: {
      title: "Ouvrir une porte locale",
      context: "Le Council doit rester sous contrôle humain.",
    },
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const collected: ModelEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
