import { useQuery } from '@tanstack/react-query';

import { fetchRecentCouncilSessions } from '../api/assembly';

export const recentCouncilSessionsKey = ['council-sessions', 'recent'] as const;

export function useRecentCouncilSessions() {
  return useQuery({
    queryKey: recentCouncilSessionsKey,
    queryFn: ({ signal }) => fetchRecentCouncilSessions(8, signal),
  });
}

export type RecentCouncilSessionsQuery = ReturnType<
  typeof useRecentCouncilSessions
>;
