import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import {
  actOnFragment,
  cancelAgentRun,
  conveneCouncilSession,
  createCouncilSession,
  fetchCouncilSession,
  forgeCouncilDecision,
  type AgentRunSnapshot,
  type CouncilSessionSnapshot,
  type CreateCouncilSessionInput,
  type ForgeCouncilDecisionInput,
  type FragmentActionInput,
} from '../api/assembly';
import { useCouncilUiStore } from '../state/council-ui-store';
import { councilSessionKey } from './council-session-key';
import { useCouncilEventStream } from './useCouncilEventStream';

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
  const clearActiveSessionId = useCouncilUiStore(
    (state) => state.clearActiveSessionId,
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
    mutationFn: async (quest: CreateCouncilSessionInput) => {
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

  const fragmentMutation = useMutation({
    mutationFn: (input: FragmentActionInput) => actOnFragment(input),
    onSuccess: (snapshot) => {
      setFreshestSnapshot(queryClient, snapshot);
    },
  });

  const forgeMutation = useMutation({
    mutationFn: (input: ForgeCouncilDecisionInput) => {
      if (activeSessionId === null) {
        throw new Error('Aucune session active à forger.');
      }
      return forgeCouncilDecision(activeSessionId, input);
    },
    onSuccess: (snapshot) => {
      setFreshestSnapshot(queryClient, snapshot);
    },
  });

  return {
    session: sessionQuery.data ?? null,
    sessionError: sessionQuery.error,
    isConvening: conveneMutation.isPending,
    hasActiveRuns,
    conveneError: conveneMutation.error,
    convene: conveneMutation.mutate,
    newQuest: clearActiveSessionId,
    cancelRun: cancelMutation.mutate,
    cancelError: cancelMutation.error,
    actOnFragment: fragmentMutation.mutate,
    fragmentError: fragmentMutation.error,
    actingFragmentId: fragmentMutation.isPending
      ? (fragmentMutation.variables?.fragmentId ?? null)
      : null,
    forgeDecision: forgeMutation.mutate,
    forgeError: forgeMutation.error,
    isForging: forgeMutation.isPending,
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
