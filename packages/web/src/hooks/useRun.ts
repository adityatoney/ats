import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: !!runId,
    // No polling — SSE-driven invalidation handles live updates
  });
}

export function useRunOrders(runId: string | undefined) {
  return useQuery({
    queryKey: ['run-orders', runId],
    queryFn: () => api.getRunOrders(runId!),
    enabled: !!runId,
  });
}

export function useRunPortfolio(runId: string | undefined) {
  return useQuery({
    queryKey: ['run-portfolio', runId],
    queryFn: () => api.getRunPortfolio(runId!),
    enabled: !!runId,
  });
}
