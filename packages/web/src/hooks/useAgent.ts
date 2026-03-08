import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';

export function useAgent(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => api.getAgent(agentId!),
    enabled: !!agentId,
  });
}
