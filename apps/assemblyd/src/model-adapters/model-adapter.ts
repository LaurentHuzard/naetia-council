export type AgentId = "architect" | "trickster" | "guardian";

export interface ModelRequest {
  readonly agentId: AgentId;
  readonly quest: Readonly<{
    title: string;
    context?: string;
  }>;
  readonly latencyMs?: number;
  readonly failAtDelta?: number;
  readonly empty?: boolean;
}

export type ModelEvent =
  | Readonly<{ type: "delta"; index: number; delta: string }>
  | Readonly<{ type: "completed"; content: string }>;

export interface ModelAdapter {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
}
