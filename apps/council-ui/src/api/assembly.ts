import {
  councilEventSchema,
  decisionRevisionSchema,
  decisionSchema,
  fragmentSchema,
  returnPointSchema,
  sessionIndexSchema,
  type CouncilEventMessage,
  type DecisionMessage,
  type DecisionRevisionMessage,
  type FragmentMessage,
  type ReturnPointMessage,
  type SessionSummaryMessage,
} from '@naetia/assembly-protocol';

export type AssemblyHealth = {
  status: 'ok';
  service?: string;
  timestamp?: string;
  modelAdapter?: 'fake' | 'codex-cli';
  model?: string;
};

export type AgentRunStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export type AgentRunSnapshot = {
  runId: string;
  sessionId: string;
  agentId: 'architect' | 'trickster' | 'guardian';
  agentDefinitionId: string;
  status: AgentRunStatus;
  pid?: number;
  contribution: string;
  startedAt?: string;
  completedAt?: string;
  error?: { code: string; message: string };
};

export type CouncilSessionSnapshot = {
  sessionId: string;
  quest: {
    questId: string;
    title: string;
    context?: string;
  };
  status: 'created' | 'running' | 'completed';
  createdAt: string;
  eventCursor: number;
  runs: AgentRunSnapshot[];
  fragments: FragmentMessage[];
  revisionOf?: DecisionRevisionMessage;
  previousDecision?: {
    sessionId: string;
    decision: DecisionMessage;
    returnPoint: ReturnPointMessage;
  };
  decision?: DecisionMessage;
  returnPoint?: ReturnPointMessage;
  events: CouncilEventMessage[];
};

export type CouncilSessionSummary = SessionSummaryMessage;

export class AssemblyRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'AssemblyRequestError';
    this.status = status;
    this.code = code;
  }
}

export type CreateCouncilSessionInput = {
  title: string;
  context?: string;
};

export type FragmentActionInput = {
  fragmentId: string;
  action: 'keep' | 'challenge' | 'compost';
  prompt?: string;
};

export type ForgeCouncilDecisionInput = {
  fragmentIds: string[];
  statement: string;
  rationale: string;
  objection?: string;
  reviewCondition?: string;
  nextSmallStep: string;
};

export type CreateCouncilRevisionInput = {
  decisionId: string;
  intent: string;
};

const agentRunStatuses: readonly string[] = [
  'pending',
  'starting',
  'running',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
];

function isAssemblyHealth(value: unknown): value is AssemblyHealth {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    'status' in value &&
    value.status === 'ok' &&
    (!('modelAdapter' in value) ||
      value.modelAdapter === 'fake' ||
      value.modelAdapter === 'codex-cli') &&
    (!('model' in value) || typeof value.model === 'string')
  );
}

export async function fetchAssemblyHealth(
  signal?: AbortSignal,
): Promise<AssemblyHealth> {
  const payload = await requestJson(
    '/api/health',
    signal === undefined ? {} : { signal },
  );

  if (!isAssemblyHealth(payload)) {
    throw new Error('The Assembly a renvoyé une réponse de santé invalide.');
  }

  return payload;
}

export async function createCouncilSession(
  quest: CreateCouncilSessionInput,
): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ quest }),
    }),
  );
}

export async function createCouncilRevision(
  sessionId: string,
  input: CreateCouncilRevisionInput,
): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson(
      `/api/sessions/${encodeURIComponent(sessionId)}/revisions`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  );
}

export async function conveneCouncilSession(
  sessionId: string,
): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/convene`, {
      method: 'POST',
    }),
  );
}

export async function fetchCouncilSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      signal === undefined ? {} : { signal },
    ),
  );
}

export async function fetchRecentCouncilSessions(
  limit = 8,
  signal?: AbortSignal,
): Promise<readonly CouncilSessionSummary[]> {
  const payload = await requestJson(
    `/api/sessions?limit=${String(limit)}`,
    signal === undefined ? {} : { signal },
  );
  const parsed = sessionIndexSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('The Assembly a renvoyé un index de sessions invalide.');
  }
  return parsed.data.sessions;
}

export async function cancelAgentRun(
  runId: string,
): Promise<AgentRunSnapshot> {
  const payload = await requestJson(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });

  if (!isRecord(payload) || !isAgentRunSnapshot(payload.run)) {
    throw new Error('The Assembly a renvoyé une annulation invalide.');
  }

  return payload.run;
}

export async function actOnFragment({
  fragmentId,
  action,
  prompt,
}: FragmentActionInput): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson(
      `/api/fragments/${encodeURIComponent(fragmentId)}/${action}`,
      {
        method: 'POST',
        ...(action !== 'challenge'
          ? {}
          : {
              body: JSON.stringify(
                prompt === undefined ? {} : { prompt },
              ),
            }),
      },
    ),
  );
}

export async function forgeCouncilDecision(
  sessionId: string,
  input: ForgeCouncilDecisionInput,
): Promise<CouncilSessionSnapshot> {
  return parseSessionSnapshot(
    await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/forge`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

async function requestJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });

  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new AssemblyRequestError(
      response.status,
      errorPayload?.message ??
        `The Assembly a répondu avec le statut ${response.status}.`,
      errorPayload?.code,
    );
  }

  return response.json() as Promise<unknown>;
}

function parseSessionSnapshot(value: unknown): CouncilSessionSnapshot {
  if (!isRecord(value) || !isRecord(value.quest)) {
    throw new Error('The Assembly a renvoyé un snapshot de session invalide.');
  }

  const validStatus =
    value.status === 'created' ||
    value.status === 'running' ||
    value.status === 'completed';
  const validQuest =
    typeof value.quest.questId === 'string' &&
    typeof value.quest.title === 'string' &&
    (value.quest.context === undefined || typeof value.quest.context === 'string');
  const validRuns =
    Array.isArray(value.runs) && value.runs.every(isAgentRunSnapshot);
  const validEvents =
    Array.isArray(value.events) &&
    value.events.every((event) => councilEventSchema.safeParse(event).success);
  const validFragments =
    Array.isArray(value.fragments) &&
    value.fragments.every((fragment) => fragmentSchema.safeParse(fragment).success);
  const validDecision =
    value.decision === undefined || decisionSchema.safeParse(value.decision).success;
  const validReturnPoint =
    value.returnPoint === undefined ||
    returnPointSchema.safeParse(value.returnPoint).success;
  const validRevisionOf =
    value.revisionOf === undefined ||
    decisionRevisionSchema.safeParse(value.revisionOf).success;
  const validPreviousDecision =
    value.previousDecision === undefined ||
    (isRecord(value.previousDecision) &&
      typeof value.previousDecision.sessionId === 'string' &&
      decisionSchema.safeParse(value.previousDecision.decision).success &&
      returnPointSchema.safeParse(value.previousDecision.returnPoint).success);
  const validRevisionPair =
    (value.revisionOf === undefined && value.previousDecision === undefined) ||
    (isRecord(value.revisionOf) &&
      isRecord(value.previousDecision) &&
      isRecord(value.previousDecision.decision) &&
      isRecord(value.previousDecision.returnPoint) &&
      value.previousDecision.sessionId === value.revisionOf.sourceSessionId &&
      value.previousDecision.decision.id === value.revisionOf.sourceDecisionId &&
      value.previousDecision.returnPoint.decisionId ===
        value.revisionOf.sourceDecisionId);
  const validOutcomePair =
    (value.decision === undefined && value.returnPoint === undefined) ||
    (value.decision !== undefined && value.returnPoint !== undefined);

  if (
    typeof value.sessionId !== 'string' ||
    !validStatus ||
    typeof value.createdAt !== 'string' ||
    !validQuest ||
    !validRuns ||
    !validFragments ||
    !validDecision ||
    !validReturnPoint ||
    !validRevisionOf ||
    !validPreviousDecision ||
    !validRevisionPair ||
    !validOutcomePair ||
    !Number.isInteger(value.eventCursor) ||
    (value.eventCursor as number) < 0 ||
    !validEvents
  ) {
    throw new Error('The Assembly a renvoyé un snapshot de session invalide.');
  }

  return {
    ...(value as CouncilSessionSnapshot),
    fragments: (value.fragments as unknown[]).map((fragment) =>
      fragmentSchema.parse(fragment),
    ),
    ...(value.decision === undefined
      ? {}
      : { decision: decisionSchema.parse(value.decision) }),
    ...(value.returnPoint === undefined
      ? {}
      : { returnPoint: returnPointSchema.parse(value.returnPoint) }),
    ...(value.revisionOf === undefined
      ? {}
      : { revisionOf: decisionRevisionSchema.parse(value.revisionOf) }),
    ...(isRecord(value.previousDecision)
      ? {
          previousDecision: {
            sessionId: value.previousDecision.sessionId as string,
            decision: decisionSchema.parse(value.previousDecision.decision),
            returnPoint: returnPointSchema.parse(
              value.previousDecision.returnPoint,
            ),
          },
        }
      : {}),
    events: (value.events as unknown[]).map((event) =>
      councilEventSchema.parse(event),
    ),
  };
}

function isAgentRunSnapshot(value: unknown): value is AgentRunSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.runId === 'string' &&
    typeof value.sessionId === 'string' &&
    (value.agentId === 'architect' ||
      value.agentId === 'trickster' ||
      value.agentId === 'guardian') &&
    typeof value.agentDefinitionId === 'string' &&
    typeof value.status === 'string' &&
    agentRunStatuses.includes(value.status) &&
    (value.pid === undefined || typeof value.pid === 'number') &&
    typeof value.contribution === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readErrorPayload(
  response: Response,
): Promise<Readonly<{ code?: string; message?: string }> | undefined> {
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return undefined;
    }
    return {
      ...(typeof payload.error === 'string' ? { code: payload.error } : {}),
      ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
    };
  } catch {
    return undefined;
  }
}
