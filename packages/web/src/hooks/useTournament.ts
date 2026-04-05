import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';

export function useTournament(id: string | undefined, options?: { sseConnected?: boolean }) {
  return useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.getTournament(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as Record<string, unknown> | undefined;
      const status = data?.status as string;
      if (status !== 'in_progress' && status !== 'pending') return false;
      return options?.sseConnected ? 10000 : 2000;
    },
  });
}

export function useTournamentLeaderboard(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament-leaderboard', id],
    queryFn: () => api.getTournamentLeaderboard(id!),
    enabled: !!id,
  });
}

export function useTournamentComparison(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament-comparison', id],
    queryFn: () => api.getTournamentComparison(id!),
    enabled: !!id,
  });
}
