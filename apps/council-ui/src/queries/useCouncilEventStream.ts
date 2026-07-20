import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { openCouncilEventSource } from '../api/council-event-source';
import type { CouncilSessionSnapshot } from '../api/assembly';
import { councilSessionKey } from './council-session-key';
import { recentCouncilSessionsKey } from './useRecentCouncilSessions';

export type CouncilSignalStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'polling';

interface UseCouncilEventStreamInput {
  readonly sessionId: string | null;
  readonly hasSnapshot: boolean;
  readonly hasActiveRuns: boolean;
}

export function useCouncilEventStream({
  sessionId,
  hasSnapshot,
  hasActiveRuns,
}: UseCouncilEventStreamInput) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CouncilSignalStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (sessionId === null || !hasSnapshot) {
      setStatus('idle');
      setError(null);
      return;
    }

    const queryKey = councilSessionKey(sessionId);
    const snapshot = queryClient.getQueryData<CouncilSessionSnapshot>(queryKey);
    if (snapshot === undefined) {
      return;
    }

    let latestCursor = snapshot.eventCursor;
    let refreshTimer: number | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    let disposed = false;
    const runRefresh = async (): Promise<void> => {
      refreshInFlight = true;
      try {
        do {
          refreshQueued = false;
          await Promise.all([
            queryClient.invalidateQueries(
              { queryKey, exact: true },
              { cancelRefetch: false },
            ),
            queryClient.invalidateQueries({
              queryKey: recentCouncilSessionsKey,
              exact: true,
            }),
          ]);
          const refreshed =
            queryClient.getQueryData<CouncilSessionSnapshot>(queryKey);
          if (
            refreshed !== undefined &&
            refreshed.eventCursor < latestCursor
          ) {
            refreshQueued = true;
          }
        } while (refreshQueued && !disposed);
      } catch {
        if (!disposed) {
          setStatus('polling');
        }
      } finally {
        refreshInFlight = false;
      }
    };
    const scheduleRefresh = (): void => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      if (refreshTimer !== undefined) {
        return;
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void runRefresh();
      }, 24);
    };
    setStatus('connecting');
    setError(null);
    const stream = openCouncilEventSource(sessionId, latestCursor, {
      onOpen: () => {
        setStatus('live');
        setError(null);
      },
      onError: () => {
        setStatus('reconnecting');
      },
      onInvalid: (streamError) => {
        setError(streamError);
        setStatus('polling');
        void queryClient.invalidateQueries({ queryKey, exact: true });
        void queryClient.invalidateQueries({
          queryKey: recentCouncilSessionsKey,
          exact: true,
        });
      },
      onEvent: ({ cursor }) => {
        if (cursor <= latestCursor) {
          return;
        }
        latestCursor = cursor;
        scheduleRefresh();
      },
    });

    if (stream === undefined) {
      setStatus('polling');
      return;
    }

    return () => {
      disposed = true;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      stream.close();
    };
  }, [hasSnapshot, queryClient, sessionId]);

  useEffect(() => {
    if (
      sessionId === null ||
      !hasActiveRuns ||
      status === 'live' ||
      status === 'idle'
    ) {
      return;
    }

    const queryKey = councilSessionKey(sessionId);
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns, queryClient, sessionId, status]);

  return { status, error } as const;
}
