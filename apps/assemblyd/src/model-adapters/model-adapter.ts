export type AgentId = "architect" | "trickster" | "guardian";

export interface ModelRequest {
  readonly agentId: AgentId;
  readonly agentName: string;
  readonly perspective: string;
  readonly instructions: string;
  readonly quest: Readonly<{
    title: string;
    context?: string;
  }>;
  readonly latencyMs?: number;
  readonly failAtDelta?: number;
  readonly empty?: boolean;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

export interface ModelExecution {
  readonly adapter: "fake" | "codex-cli";
  readonly model?: string;
  readonly durationMs: number;
  readonly usage?: ModelUsage;
}

export type ModelEvent =
  | Readonly<{ type: "delta"; index: number; delta: string }>
  | Readonly<{
      type: "completed";
      content: string;
      execution: ModelExecution;
    }>;

export type ModelAdapterErrorCode =
  | "CODEX_CLI_UNAVAILABLE"
  | "CODEX_AUTH_MISSING"
  | "CODEX_EXEC_FAILED"
  | "CODEX_OUTPUT_INVALID"
  | "CODEX_EMPTY_OUTPUT";

export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;

  constructor(code: ModelAdapterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelAdapterError";
    this.code = code;
  }
}

export interface ModelAdapter {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
}
