import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelAgentRun,
  conveneCouncilSession,
  createCouncilSession,
  fetchCouncilSession,
  type AgentRunSnapshot,
  type CouncilSessionSnapshot,
} from '../api/assembly';
import { useCouncilUiStore } from '../state/council-ui-store';

const quest = {
  title: 'Ouvrir la porte du royaume',
  context:
    'Le royaume est scellé. Trouver et ouvrir la porte sans déclencher les anciens verrous ni trahir les pactes en vigueur.',
} as const;

function councilSessionKey(sessionId: string) {
  return ['council-session', sessionId] as const;
}

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
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      return snapshot?.runs.some(isRunActive) === true ? 250 : false;
    },
  });

  const conveneMutation = useMutation({
    mutationFn: async () => {
      const created = await createCouncilSession(quest);
      setActiveSessionId(created.sessionId);
      queryClient.setQueryData(councilSessionKey(created.sessionId), created);
      return conveneCouncilSession(created.sessionId);
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(councilSessionKey(snapshot.sessionId), snapshot);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: (run) => {
      if (activeSessionId === null) {
        return;
      }

      queryClient.setQueryData<CouncilSessionSnapshot>(
        councilSessionKey(activeSessionId),
        (snapshot) => {
          if (snapshot === undefined) {
            return snapshot;
          }

          return {
            ...snapshot,
            runs: snapshot.runs.map((currentRun) =>
              currentRun.runId === run.runId ? run : currentRun,
            ),
          };
        },
      );
    },
  });

  return {
    session: sessionQuery.data ?? null,
    sessionError: sessionQuery.error,
    isConvening: conveneMutation.isPending,
    hasActiveRuns: sessionQuery.data?.runs.some(isRunActive) ?? false,
    conveneError: conveneMutation.error,
    convene: conveneMutation.mutate,
    cancelRun: cancelMutation.mutate,
    cancelError: cancelMutation.error,
    cancellingRunId: cancelMutation.isPending
      ? (cancelMutation.variables ?? null)
      : null,
  };
}

export type CouncilSessionController = ReturnType<typeof useCouncilSession>;
