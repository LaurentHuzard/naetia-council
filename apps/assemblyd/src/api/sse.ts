import { z } from "zod";

import type { JournalEntry } from "../persistence/sqlite-event-journal.js";

const eventCursorSchema = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform((value) => Number(value)),
]);

export const eventStreamQuerySchema = z
  .object({ after: eventCursorSchema.optional() })
  .strict();

export function resolveEventCursor(
  queryCursor: number | undefined,
  lastEventId: string | string[] | undefined,
): number {
  const parsedLastEventId =
    lastEventId === undefined
      ? undefined
      : eventCursorSchema.parse(lastEventId);
  return Math.max(queryCursor ?? 0, parsedLastEventId ?? 0);
}

export function formatSseEntry(entry: JournalEntry): string {
  return [
    `id: ${String(entry.sequence)}`,
    "event: council-event",
    `data: ${JSON.stringify(entry.event)}`,
    "",
    "",
  ].join("\n");
}
