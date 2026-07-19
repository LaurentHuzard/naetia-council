import { randomUUID } from "node:crypto";

process.once("message", (rawMessage: unknown) => {
  if (
    typeof rawMessage !== "object" ||
    rawMessage === null ||
    !("runId" in rawMessage) ||
    !("sessionId" in rawMessage) ||
    !("quest" in rawMessage) ||
    typeof rawMessage.runId !== "string" ||
    typeof rawMessage.sessionId !== "string" ||
    typeof rawMessage.quest !== "object" ||
    rawMessage.quest === null ||
    !("title" in rawMessage.quest) ||
    typeof rawMessage.quest.title !== "string"
  ) {
    process.exitCode = 2;
    process.disconnect();
    return;
  }

  if (rawMessage.quest.title === "invalid-ipc") {
    process.send?.({ type: "delta", missing: "identity envelope" });
    setTimeout(() => process.disconnect(), 50);
    return;
  }

  const base = {
    sessionId: rawMessage.sessionId,
    runId: rawMessage.runId,
    occurredAt: new Date().toISOString(),
  } as const;

  process.send?.({
    ...base,
    type: "status",
    eventId: randomUUID(),
    status: "starting",
  });
  process.send?.({
    ...base,
    type: "status",
    eventId: randomUUID(),
    status: "running",
  });

  const duplicateDelta = {
    ...base,
    type: "delta",
    eventId: randomUUID(),
    contributionId: randomUUID(),
    delta: "fragment unique",
    index: 0,
  } as const;
  process.send?.(duplicateDelta);
  process.send?.(duplicateDelta);
  process.send?.({
    ...base,
    type: "completed",
    eventId: randomUUID(),
    contributionId: duplicateDelta.contributionId,
    content: duplicateDelta.delta,
    modelExecution: {
      adapter: "fake",
      durationMs: 1,
    },
  });
  process.send?.({
    ...base,
    type: "status",
    eventId: randomUUID(),
    status: "completed",
  });
  process.disconnect();
});
