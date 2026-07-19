import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function resolveAssemblyDatabasePath(
  configuredPath: string | undefined,
): string {
  if (configuredPath !== undefined && configuredPath.trim().length > 0) {
    return resolve(REPOSITORY_ROOT, configuredPath);
  }
  return fileURLToPath(
    new URL("../../../../data/naetia-council.sqlite", import.meta.url),
  );
}
