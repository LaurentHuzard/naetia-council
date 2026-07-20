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
  createCouncilRevision,
  createCouncilSession,
  fetchCouncilSession,
  forgeCouncilDecision,
  type AgentRunSnapshot,
  type CouncilSessionSnapshot,
  type CreateCouncilRevisionInput,
  type CreateCouncilSessionInput,
  type ForgeCouncilDecisionInput,
  type FragmentActionInput,
} from '../api/assembly';
import { useCouncilUiStore } from '../state/council-ui-store';
import { councilSessionKey } from './council-session-key';
import { useCouncilEventStream } from './useCouncilEventStream';
import { recentCouncilSessionsKey } from './useRecentCouncilSessions';

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
    mutationFn: async (quest: CreateCouncilSessionInput | undefined) => {
      if (activeSessionId !== null) {
        return conveneCouncilSession(activeSessionId);
      }
      if (quest === undefined) {
        throw new Error('Une nouvelle quête est requise.');
      }
      const created = await createCouncilSession(quest);
      setActiveSessionId(created.sessionId);
      queryClient.setQueryData(councilSessionKey(created.sessionId), created);
      return conveneCouncilSession(created.sessionId);
    },
    onSuccess: (snapshot) => {
      setFreshestSnapshot(queryClient, snapshot);
    },
    onSettled: () => {
      void invalidateRecentSessions(queryClient);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: () => {
      if (activeSessionId === null) {
        return;
      }
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: councilSessionKey(activeSessionId),
          exact: true,
        }),
        invalidateRecentSessions(queryClient),
      ]);
    },
  });

  const fragmentMutation = useMutation({
    mutationFn: (input: FragmentActionInput) => actOnFragment(input),
    onSuccess: (snapshot) => {
      setFreshestSnapshot(queryClient, snapshot);
      void invalidateRecentSessions(queryClient);
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
      void invalidateRecentSessions(queryClient);
    },
  });

  const revisionMutation = useMutation({
    mutationFn: (input: CreateCouncilRevisionInput) => {
      if (activeSessionId === null) {
        throw new Error('Aucune décision active à réviser.');
      }
      return createCouncilRevision(activeSessionId, input);
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(councilSessionKey(snapshot.sessionId), snapshot);
      setActiveSessionId(snapshot.sessionId);
      void invalidateRecentSessions(queryClient);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => fetchCouncilSession(sessionId),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(councilSessionKey(snapshot.sessionId), snapshot);
      setActiveSessionId(snapshot.sessionId);
    },
  });

  const isSessionLoading =
    activeSessionId !== null && sessionQuery.data === undefined && sessionQuery.isPending;
  const isNavigationLocked =
    isSessionLoading ||
    hasActiveRuns ||
    conveneMutation.isPending ||
    cancelMutation.isPending ||
    fragmentMutation.isPending ||
    forgeMutation.isPending ||
    revisionMutation.isPending ||
    resumeMutation.isPending;

  const resetTransientMutations = () => {
    cancelMutation.reset();
    fragmentMutation.reset();
    forgeMutation.reset();
    revisionMutation.reset();
    resumeMutation.reset();
  };

  return {
    activeSessionId,
    hasSelectedSession: activeSessionId !== null,
    session: sessionQuery.data ?? null,
    sessionError: sessionQuery.error,
    isSessionLoading,
    isConvening: conveneMutation.isPending,
    hasActiveRuns,
    conveneError: conveneMutation.error,
    convene: conveneMutation.mutate,
    newQuest: () => {
      if (isNavigationLocked) return;
      resetTransientMutations();
      clearActiveSessionId();
    },
    resumeSession: (sessionId: string) => {
      if (isNavigationLocked || sessionId === activeSessionId) return;
      resetTransientMutations();
      resumeMutation.mutate(sessionId);
    },
    resumeError: resumeMutation.error,
    resumingSessionId: resumeMutation.isPending
      ? (resumeMutation.variables ?? null)
      : null,
    isNavigationLocked,
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
    prepareRevision: revisionMutation.mutate,
    revisionError: revisionMutation.error,
    isPreparingRevision: revisionMutation.isPending,
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

function invalidateRecentSessions(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: recentCouncilSessionsKey,
    exact: true,
  });
}
