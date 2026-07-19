import { pathToFileURL } from "node:url";

import { buildApp } from "./api/app.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

export async function startServer(): Promise<void> {
  const app = buildApp();
  const port = parsePort(process.env["ASSEMBLY_PORT"]);

  await app.listen({ host: DEFAULT_HOST, port });

  const stop = async (): Promise<void> => {
    await app.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ASSEMBLY_PORT must be a valid TCP port");
  }
  return port;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  void startServer();
}
