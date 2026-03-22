import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  agents,
  runs,
  orders,
  fills,
  positions,
  portfolioSnapshots,
  agentEvents,
  checkpoints,
  branches,
  strategyVersions,
  soulVersions,
  tournamentEntries,
  leaderboardEntries,
  tournaments,
} from '@aegis/db/schema';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

/**
 * Delete all child records of a run within a transaction context.
 * Used by both deleteRun and deleteAgent.
 */
async function deleteRunChildren(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], runId: string) {
  // Delete fills (via orders)
  const runOrders = await tx.select({ id: orders.id }).from(orders).where(eq(orders.runId, runId));
  for (const order of runOrders) {
    await tx.delete(fills).where(eq(fills.orderId, order.id));
  }

  // Delete orders
  await tx.delete(orders).where(eq(orders.runId, runId));

  // Delete positions
  await tx.delete(positions).where(eq(positions.runId, runId));

  // Delete portfolio snapshots
  await tx.delete(portfolioSnapshots).where(eq(portfolioSnapshots.runId, runId));

  // Delete agent events
  await tx.delete(agentEvents).where(eq(agentEvents.runId, runId));

  // Delete branches (where runId or parentRunId)
  await tx.delete(branches).where(eq(branches.runId, runId));
  await tx.delete(branches).where(eq(branches.parentRunId, runId));

  // Delete checkpoints
  await tx.delete(checkpoints).where(eq(checkpoints.runId, runId));

  // Clean up leaderboard entries referencing this run
  await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.runId, runId));

  // Nullify runId on tournament entries (don't delete the entry itself)
  await tx
    .update(tournamentEntries)
    .set({ runId: null })
    .where(eq(tournamentEntries.runId, runId));
}

/**
 * Delete a single run and all its children.
 * Run must be in a terminal state (completed, failed, cancelled).
 */
export async function deleteRun(runId: string): Promise<void> {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) {
    throw new Error('Run not found');
  }
  if (!TERMINAL_STATUSES.includes(run.status)) {
    throw new Error('Cannot delete a running or paused run. Cancel it first.');
  }

  await db.transaction(async (tx) => {
    await deleteRunChildren(tx, runId);
    await tx.delete(runs).where(eq(runs.id, runId));
  });
}

/**
 * Delete an agent and ALL related data (runs, strategy versions, soul versions).
 * All runs must be in terminal states.
 */
export async function deleteAgent(agentId: string): Promise<void> {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) {
    throw new Error('Agent not found');
  }

  const agentRuns = await db.query.runs.findMany({ where: eq(runs.agentId, agentId) });
  const activeRuns = agentRuns.filter((r) => !TERMINAL_STATUSES.includes(r.status));
  if (activeRuns.length > 0) {
    throw new Error('Cannot delete agent with active runs. Cancel them first.');
  }

  await db.transaction(async (tx) => {
    // Delete tournament entries and leaderboard entries for this agent
    await tx.delete(tournamentEntries).where(eq(tournamentEntries.agentId, agentId));
    await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.agentId, agentId));

    // Delete all runs and their children
    for (const run of agentRuns) {
      await deleteRunChildren(tx, run.id);
      await tx.delete(runs).where(eq(runs.id, run.id));
    }

    // Delete soul versions
    await tx.delete(soulVersions).where(eq(soulVersions.agentId, agentId));

    // Delete strategy versions
    await tx.delete(strategyVersions).where(eq(strategyVersions.agentId, agentId));

    // Delete the agent
    await tx.delete(agents).where(eq(agents.id, agentId));
  });
}

/**
 * Delete a tournament and its metadata (entries, leaderboard).
 * Preserves runs — they belong to agents.
 */
export async function deleteTournament(tournamentId: string): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) {
    throw new Error('Tournament not found');
  }
  if (tournament.status === 'in_progress') {
    throw new Error('Cannot delete an in-progress tournament. Cancel it first.');
  }

  await db.transaction(async (tx) => {
    // Delete leaderboard entries
    await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.tournamentId, tournamentId));

    // Delete tournament entries
    await tx.delete(tournamentEntries).where(eq(tournamentEntries.tournamentId, tournamentId));

    // Nullify tournamentId on runs
    await tx
      .update(runs)
      .set({ tournamentId: null })
      .where(eq(runs.tournamentId, tournamentId));

    // Delete the tournament
    await tx.delete(tournaments).where(eq(tournaments.id, tournamentId));
  });
}
