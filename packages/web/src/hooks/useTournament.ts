import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';

export function useTournament(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.getTournament(id!),
    enabled: !!id,
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
