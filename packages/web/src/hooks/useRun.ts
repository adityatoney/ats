import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as Record<string, unknown> | undefined;
      const status = data?.status;
      if (status === 'running' || status === 'pending') return 2000;
      return false;
    },
  });
}

export function useRunOrders(runId: string | undefined) {
  return useQuery({
    queryKey: ['run-orders', runId],
    queryFn: () => api.getRunOrders(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      // Self-manage polling: check the run status from the run query
      const data = query.state.data as Array<Record<string, unknown>> | undefined;
      // Keep polling if data is still empty or actively running
      // SSE invalidation handles the rest
      return false;
    },
  });
}

export function useRunPortfolio(runId: string | undefined) {
  return useQuery({
    queryKey: ['run-portfolio', runId],
    queryFn: () => api.getRunPortfolio(runId!),
    enabled: !!runId,
  });
}
