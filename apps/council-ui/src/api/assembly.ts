export type AssemblyHealth = {
  status: 'ok';
  service?: string;
  timestamp?: string;
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
  runs: AgentRunSnapshot[];
  events: unknown[];
};

export type CreateCouncilSessionInput = {
  title: string;
  context?: string;
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

  return 'status' in value && value.status === 'ok';
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
    throw new Error(`The Assembly a répondu avec le statut ${response.status}.`);
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

  if (
    typeof value.sessionId !== 'string' ||
    !validStatus ||
    typeof value.createdAt !== 'string' ||
    !validQuest ||
    !validRuns ||
    !Array.isArray(value.events)
  ) {
    throw new Error('The Assembly a renvoyé un snapshot de session invalide.');
  }

  return value as CouncilSessionSnapshot;
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
