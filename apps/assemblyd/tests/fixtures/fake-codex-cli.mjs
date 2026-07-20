#!/usr/bin/node
/* global process, setInterval */

import { readFileSync } from "node:fs";

const prompt = readFileSync(0, "utf8");
const modelIndex = process.argv.indexOf("--model");
const model = modelIndex === -1 ? undefined : process.argv[modelIndex + 1];
const behavior = resolveBehavior();

if (behavior === "hang") {
  setInterval(() => undefined, 1_000);
} else if (behavior === "failure") {
  process.stderr.write("provider leaked-secret-should-not-escape\n");
  process.exitCode = 7;
} else if (behavior === "auth") {
  process.stderr.write("Not logged in. Login required.\n");
  process.exitCode = 1;
} else if (behavior === "malformed") {
  process.stdout.write("not-json\n");
} else if (behavior === "empty") {
  // Intentionally no output.
} else if (behavior === "no-message") {
  emit({ type: "turn.completed", usage: usage() });
} else if (behavior === "inspect") {
  emit({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify({
        args: process.argv.slice(2),
        environment: process.env,
        prompt,
      }),
    },
  });
  emit({ type: "turn.completed", usage: usage() });
} else {
  process.stderr.write("benign diagnostic\n");
  emit({ type: "thread.started", thread_id: "fixture-thread" });
  emit({
    type: "item.completed",
    item: {
      type: "agent_message",
      text:
        "Le point essentiel est de réduire la quête à une décision vérifiable. " +
        "Le prochain petit geste consiste à écrire un critère de réussite observable, puis à le tester localement. " +
        "Réserve : ne pas confondre vitesse et clarté, et conserver le dernier mot à la personne.",
    },
  });
  emit({ type: "turn.completed", usage: usage() });
}

function usage() {
  return {
    input_tokens: 120,
    cached_input_tokens: 80,
    output_tokens: 42,
    reasoning_output_tokens: 7,
  };
}

function resolveBehavior() {
  if (model === "revision-proof") {
    return "inspect";
  }
  if (model === "isolated-failure-proof") {
    if (prompt.includes("Rôle : Architect.")) {
      return "malformed";
    }
    if (prompt.includes("Rôle : Guardian.")) {
      return "hang";
    }
  }
  return process.env["FAKE_CODEX_BEHAVIOR"] ?? "success";
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
