import { eq, and, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  tournaments,
  tournamentEntries,
  runs,
  agents,
  strategyVersions,
} from '@aegis/db/schema';
import { pythonClient } from '../lib/python-client';
import { eventBus } from './event-bus';

export const tournamentManager = {
  async createTournament(
    projectId: string,
    name: string,
    agentIds: string[],
    config: Record<string, unknown>,
  ) {
    // Validate all agents exist and have strategies
    for (const agentId of agentIds) {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
      });
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const strategy = await db.query.strategyVersions.findFirst({
        where: eq(strategyVersions.agentId, agentId),
        orderBy: (sv, { desc }) => [desc(sv.version)],
      });
      if (!strategy) throw new Error(`Agent ${agentId} has no strategy`);
    }

    const [tournament] = await db
      .insert(tournaments)
      .values({
        projectId,
        name,
        configJson: config,
        status: 'pending',
        agentCount: agentIds.length,
        completedCount: 0,
      })
      .returning();

    // Create entries for each agent
    for (const agentId of agentIds) {
      await db.insert(tournamentEntries).values({
        tournamentId: tournament.id,
        agentId,
        status: 'pending',
      });
    }

    return tournament;
  },

  async startTournament(tournamentId: string) {
    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, tournamentId),
    });
    if (!tournament) throw new Error('Tournament not found');
    if (tournament.status !== 'pending')
      throw new Error(`Tournament is ${tournament.status}, cannot start`);

    const entries = await db.query.tournamentEntries.findMany({
      where: eq(tournamentEntries.tournamentId, tournamentId),
    });

    const config = tournament.configJson as Record<string, unknown>;

    // Pre-fetch data once
    const prefetchResult = await pythonClient.prefetchData({
      symbols: config.symbols as string[],
      startDate: config.startDate as string,
      endDate: config.endDate as string,
      timeframe: (config.timeframe as string) || '1Day',
    });

    const dataSnapshotId = (prefetchResult as Record<string, unknown>).dataSnapshotId as string;

    // Update tournament with data snapshot and status
    await db
      .update(tournaments)
      .set({
        status: 'in_progress',
        dataSnapshotId,
        startedAt: new Date(),
      })
      .where(eq(tournaments.id, tournamentId));

    // Create runs for each agent
    const runsConfig: Array<{
      runId: string;
      agentId: string;
      strategyMd: string;
      strategyPy: string | null;
      config: Record<string, unknown>;
    }> = [];

    for (const entry of entries) {
      const latestStrategy = await db.query.strategyVersions.findFirst({
        where: eq(strategyVersions.agentId, entry.agentId),
        orderBy: (sv, { desc }) => [desc(sv.version)],
      });
      if (!latestStrategy) continue;

      const [run] = await db
        .insert(runs)
        .values({
          agentId: entry.agentId,
          strategyVersionId: latestStrategy.id,
          tournamentId,
          status: 'pending',
          runType: 'backtest',
          configJson: config,
          totalBars: 0,
          processedBars: 0,
        })
        .returning();

      // Link entry to run
      await db
        .update(tournamentEntries)
        .set({ runId: run.id, status: 'running' })
        .where(eq(tournamentEntries.id, entry.id));

      await db.update(agents).set({ status: 'backtesting' }).where(eq(agents.id, entry.agentId));

      runsConfig.push({
        runId: run.id,
        agentId: entry.agentId,
        strategyMd: latestStrategy.strategyMd,
        strategyPy: latestStrategy.strategyPy,
        config,
      });
    }

    // Start all runs concurrently via Python
    await pythonClient.startTournament({
      tournamentId,
      runs: runsConfig,
      dataSnapshotId,
    });

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.started',
      payload: { agentCount: entries.length },
    });

    return { tournamentId, runsStarted: runsConfig.length };
  },

  async handleRunCompleted(runId: string, tournamentId: string) {
    // Update the tournament entry
    await db
      .update(tournamentEntries)
      .set({ status: 'completed' })
      .where(
        and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.runId, runId)),
      );

    // Increment completed count atomically
    await db
      .update(tournaments)
      .set({
        completedCount: sql`${tournaments.completedCount} + 1`,
      })
      .where(eq(tournaments.id, tournamentId));

    // Check if all runs done
    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, tournamentId),
    });

    if (tournament && tournament.completedCount >= tournament.agentCount) {
      await this.finalizeTournament(tournamentId);
    } else if (tournament) {
      eventBus.publishTournament(tournamentId, {
        eventType: 'tournament.progress',
        payload: {
          completedCount: tournament.completedCount,
          agentCount: tournament.agentCount,
        },
      });
    }
  },

  async handleRunFailed(runId: string, tournamentId: string) {
    await db
      .update(tournamentEntries)
      .set({ status: 'failed' })
      .where(
        and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.runId, runId)),
      );

    await db
      .update(tournaments)
      .set({
        completedCount: sql`${tournaments.completedCount} + 1`,
      })
      .where(eq(tournaments.id, tournamentId));

    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, tournamentId),
    });

    if (tournament && tournament.completedCount >= tournament.agentCount) {
      // Check if any succeeded
      const completedEntries = await db.query.tournamentEntries.findMany({
        where: and(
          eq(tournamentEntries.tournamentId, tournamentId),
          eq(tournamentEntries.status, 'completed'),
        ),
      });

      if (completedEntries.length === 0) {
        await db
          .update(tournaments)
          .set({ status: 'failed', completedAt: new Date() })
          .where(eq(tournaments.id, tournamentId));

        eventBus.publishTournament(tournamentId, {
          eventType: 'tournament.failed',
          payload: {},
        });
      } else {
        await this.finalizeTournament(tournamentId);
      }
    }
  },

  async finalizeTournament(tournamentId: string) {
    // Import leaderboard service lazily to avoid circular deps
    const { leaderboardService } = await import('./leaderboard-service');
    await leaderboardService.computeLeaderboard(tournamentId);

    // Check for any failed entries
    const failedEntries = await db.query.tournamentEntries.findMany({
      where: and(
        eq(tournamentEntries.tournamentId, tournamentId),
        eq(tournamentEntries.status, 'failed'),
      ),
    });

    const finalStatus = failedEntries.length > 0 ? 'partially_failed' : 'completed';

    await db
      .update(tournaments)
      .set({ status: finalStatus, completedAt: new Date() })
      .where(eq(tournaments.id, tournamentId));

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.completed',
      payload: { status: finalStatus },
    });
  },

  async cancelTournament(tournamentId: string) {
    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, tournamentId),
    });
    if (!tournament) throw new Error('Tournament not found');

    const entries = await db.query.tournamentEntries.findMany({
      where: eq(tournamentEntries.tournamentId, tournamentId),
    });

    // Cancel all running runs
    for (const entry of entries) {
      if (entry.runId && entry.status === 'running') {
        try {
          await pythonClient.cancelRun(entry.runId);
          await db.update(runs).set({ status: 'cancelled' }).where(eq(runs.id, entry.runId));
        } catch {
          // Best effort cancellation
        }
        await db
          .update(tournamentEntries)
          .set({ status: 'failed' })
          .where(eq(tournamentEntries.id, entry.id));
      }
    }

    await db
      .update(tournaments)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(tournaments.id, tournamentId));

    // Reset agent statuses
    for (const entry of entries) {
      await db.update(agents).set({ status: 'idle' }).where(eq(agents.id, entry.agentId));
    }

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.cancelled',
      payload: {},
    });
  },
};
