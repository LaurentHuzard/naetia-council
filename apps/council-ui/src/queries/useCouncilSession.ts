import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import {
  cancelAgentRun,
  conveneCouncilSession,
  createCouncilSession,
  fetchCouncilSession,
  type AgentRunSnapshot,
  type CouncilSessionSnapshot,
} from '../api/assembly';
import { useCouncilUiStore } from '../state/council-ui-store';
import { councilSessionKey } from './council-session-key';
import { useCouncilEventStream } from './useCouncilEventStream';

const quest = {
  title: 'Ouvrir la porte du royaume',
  context:
    'Le royaume est scellé. Trouver et ouvrir la porte sans déclencher les anciens verrous ni trahir les pactes en vigueur.',
} as const;

function isRunActive(run: AgentRunSnapshot) {
  return (
    run.status === 'pending' ||
    run.status === 'starting' ||
    run.status === 'running' ||
    run.status === 'cancelling'
  );
}

export function useCouncilSession() {
  const activeSessionId = useCouncilUiStore((state) => state.activeSessionId);
  const setActiveSessionId = useCouncilUiStore(
    (state) => state.setActiveSessionId,
  );
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: councilSessionKey(activeSessionId ?? 'none'),
    queryFn: ({ signal }) => {
      if (activeSessionId === null) {
        throw new Error('Aucune session active.');
      }
      return fetchCouncilSession(activeSessionId, signal);
    },
    enabled: activeSessionId !== null,
  });

  const hasActiveRuns = sessionQuery.data?.runs.some(isRunActive) ?? false;
  const signal = useCouncilEventStream({
    sessionId: activeSessionId,
    hasSnapshot: sessionQuery.data !== undefined,
    hasActiveRuns,
  });

  const conveneMutation = useMutation({
    mutationFn: async () => {
      const created = await createCouncilSession(quest);
      setActiveSessionId(created.sessionId);
      queryClient.setQueryData(councilSessionKey(created.sessionId), created);
      return conveneCouncilSession(created.sessionId);
    },
    onSuccess: (snapshot) => {
      setFreshestSnapshot(queryClient, snapshot);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: () => {
      if (activeSessionId === null) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: councilSessionKey(activeSessionId),
        exact: true,
      });
    },
  });

  return {
    session: sessionQuery.data ?? null,
    sessionError: sessionQuery.error,
    isConvening: conveneMutation.isPending,
    hasActiveRuns,
    conveneError: conveneMutation.error,
    convene: conveneMutation.mutate,
    cancelRun: cancelMutation.mutate,
    cancelError: cancelMutation.error,
    signalStatus: signal.status,
    signalError: signal.error,
    cancellingRunId: cancelMutation.isPending
      ? (cancelMutation.variables ?? null)
      : null,
  };
}

export type CouncilSessionController = ReturnType<typeof useCouncilSession>;

function setFreshestSnapshot(
  queryClient: QueryClient,
  incoming: CouncilSessionSnapshot,
): void {
  queryClient.setQueryData<CouncilSessionSnapshot>(
    councilSessionKey(incoming.sessionId),
    (current) =>
      current !== undefined && current.eventCursor > incoming.eventCursor
        ? current
        : incoming,
  );
}
