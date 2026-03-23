import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export async function deleteRun(runId: string): Promise<void> {
  await convex.mutation(api.deleteService.deleteRun, { id: runId as any });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await convex.mutation(api.deleteService.deleteAgent, { id: agentId as any });
}

export async function deleteTournament(tournamentId: string): Promise<void> {
  await convex.mutation(api.deleteService.deleteTournament, { id: tournamentId as any });
}
