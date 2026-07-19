import { useQuery } from '@tanstack/react-query';

import { fetchAssemblyHealth } from '../api/assembly';

export const assemblyHealthQueryKey = ['assembly-health'] as const;

export function useAssemblyHealth() {
  return useQuery({
    queryKey: assemblyHealthQueryKey,
    queryFn: ({ signal }) => fetchAssemblyHealth(signal),
  });
}

export type AssemblyHealthQuery = ReturnType<typeof useAssemblyHealth>;
