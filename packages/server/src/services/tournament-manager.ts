import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { pythonClient } from '../lib/python-client';
import { eventBus } from './event-bus';
import { ensureDeterministicArtifacts } from './strategy-artifacts';
import { tournamentLiveProgress } from './tournament-live-progress';
import { fetchTournamentView } from './tournament-progress';

export const tournamentManager = {
  async createTournament(
    projectId: string,
    name: string,
    agentIds: string[],
    config: Record<string, unknown>,
  ) {
    // Validate all agents exist and have strategies
    for (const agentId of agentIds) {
      const agent = await convex.query(api.agents.get, { id: agentId as any });
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const strategy = await convex.query(api.strategyVersions.getLatestByAgent, { agentId: agentId as any });
      if (!strategy) throw new Error(`Agent ${agentId} has no strategy`);
    }

    const tournament = await convex.mutation(api.tournaments.create, {
      pgId: '',
      projectId: projectId as any,
      name,
      configJson: config,
      status: 'pending',
      agentCount: agentIds.length,
      completedCount: 0,
    });

    for (const agentId of agentIds) {
      await convex.mutation(api.tournamentEntries.create, {
        pgId: '',
        tournamentId: tournament!._id,
        agentId: agentId as any,
        status: 'pending',
      });
    }

    return tournament;
  },

  async startTournament(tournamentId: string) {
    const tournament = await convex.query(api.tournaments.get, { id: tournamentId as any });
    if (!tournament) throw new Error('Tournament not found');
    if (tournament.status !== 'pending')
      throw new Error(`Tournament is ${tournament.status}, cannot start`);

    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });

    const config = tournament.configJson as Record<string, unknown>;

    const prefetchResult = await pythonClient.prefetchData({
      symbols: config.symbols as string[],
      startDate: config.startDate as string,
      endDate: config.endDate as string,
      timeframe: (config.timeframe as string) || '1Day',
    });

    const dataSnapshotId = (prefetchResult as Record<string, unknown>).dataSnapshotId as string;

    await convex.mutation(api.tournaments.update, {
      id: tournamentId as any,
      status: 'in_progress',
      dataSnapshotId,
      startedAt: Date.now(),
    });

    const runsConfig: Array<{
      runId: string;
      agentId: string;
      sourceKind: string;
      strategyPy: string;
      strategyIrJson?: Record<string, unknown> | null;
      config: Record<string, unknown>;
    }> = [];

    for (const entry of entries) {
      const latestStrategy = await convex.query(api.strategyVersions.getLatestByAgent, { agentId: entry.agentId });
      if (!latestStrategy) continue;
      const runnableStrategy = await ensureDeterministicArtifacts(latestStrategy);
      if (!runnableStrategy.strategyPy) {
        throw new Error(`Agent ${entry.agentId} is missing executable strategy Python`);
      }

      const run = await convex.mutation(api.runs.create, {
        pgId: '',
        agentId: entry.agentId,
        strategyVersionId: runnableStrategy._id as any,
        tournamentId: tournamentId as any,
        status: 'pending',
        runType: 'backtest',
        configJson: config,
        totalBars: 0,
        processedBars: 0,
      });

      await convex.mutation(api.tournamentEntries.update, {
        id: entry._id,
        runId: run!._id,
        status: 'running',
      });

      await convex.mutation(api.agents.update, {
        id: entry.agentId,
        status: 'backtesting',
        updatedAt: Date.now(),
      });

      runsConfig.push({
        runId: run!._id,
        agentId: entry.agentId,
        sourceKind: runnableStrategy.sourceKind,
        strategyPy: runnableStrategy.strategyPy,
        strategyIrJson: runnableStrategy.strategyIrJson as Record<string, unknown> | null,
        config,
      });
    }

    tournamentLiveProgress.registerTournament(
      tournamentId,
      entries.length,
      runsConfig.map((run) => run.runId),
    );

    await pythonClient.startTournament({
      tournamentId,
      runs: runsConfig,
      dataSnapshotId,
    });

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.started',
      payload: {
        processedBars: 0,
        totalBars: 0,
        completedAgents: 0,
        activeAgents: entries.length,
        agentCount: entries.length,
        progressPercent: 0,
      },
    });

    return { tournamentId, runsStarted: runsConfig.length };
  },

  async handleRunCompleted(runId: string, tournamentId: string) {
    // Find and update the tournament entry
    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });
    const entry = entries.find((e: any) => e.runId === runId);
    if (entry) {
      await convex.mutation(api.tournamentEntries.update, { id: entry._id, status: 'completed' });
    }

    // Increment completed count atomically
    const tournament = await convex.mutation(api.tournaments.incrementCompleted, { id: tournamentId as any });

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
    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });
    const entry = entries.find((e: any) => e.runId === runId);
    if (entry) {
      await convex.mutation(api.tournamentEntries.update, { id: entry._id, status: 'failed' });
    }

    const tournament = await convex.mutation(api.tournaments.incrementCompleted, { id: tournamentId as any });

    if (tournament && tournament.completedCount >= tournament.agentCount) {
      const updatedEntries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });
      const completedEntries = updatedEntries.filter((e: any) => e.status === 'completed');

      if (completedEntries.length === 0) {
        await convex.mutation(api.tournaments.update, {
          id: tournamentId as any,
          status: 'failed',
          completedAt: Date.now(),
        });

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
    const { leaderboardService } = await import('./leaderboard-service');
    await leaderboardService.computeLeaderboard(tournamentId);

    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });
    const failedEntries = entries.filter((e: any) => e.status === 'failed');
    const completedEntries = entries.filter((e: any) => e.status === 'completed');

    const finalStatus =
      completedEntries.length === 0 && failedEntries.length > 0
        ? 'failed'
        : failedEntries.length > 0
          ? 'partially_failed'
          : 'completed';

    await convex.mutation(api.tournaments.update, {
      id: tournamentId as any,
      status: finalStatus,
      completedAt: Date.now(),
    });

    const tournamentView = await fetchTournamentView(tournamentId);

    eventBus.publishTournament(tournamentId, {
      eventType: finalStatus === 'failed' ? 'tournament.failed' : 'tournament.completed',
      payload: tournamentView
        ? {
            status: finalStatus,
            processedBars: tournamentView.progressSummary.processedBars,
            totalBars: tournamentView.progressSummary.totalBars,
            completedAgents: tournamentView.progressSummary.completedAgents,
            activeAgents: tournamentView.progressSummary.activeAgents,
            agentCount: tournamentView.agentCount,
            progressPercent: 100,
          }
        : { status: finalStatus, progressPercent: 100 },
    });

    tournamentLiveProgress.clearTournament(tournamentId);
  },

  async cancelTournament(tournamentId: string) {
    const tournament = await convex.query(api.tournaments.get, { id: tournamentId as any });
    if (!tournament) throw new Error('Tournament not found');

    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });

    for (const entry of entries) {
      if (entry.runId && entry.status === 'running') {
        try {
          await pythonClient.cancelRun(entry.runId);
          await convex.mutation(api.runs.update, { id: entry.runId, status: 'cancelled' });
        } catch {
          // Best effort cancellation
        }
        await convex.mutation(api.tournamentEntries.update, { id: entry._id, status: 'failed' });
      }
    }

    await convex.mutation(api.tournaments.update, {
      id: tournamentId as any,
      status: 'cancelled',
      completedAt: Date.now(),
    });

    for (const entry of entries) {
      await convex.mutation(api.agents.update, {
        id: entry.agentId,
        status: 'idle',
        updatedAt: Date.now(),
      });
    }

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.cancelled',
      payload: {},
    });

    tournamentLiveProgress.clearTournament(tournamentId);
  },
};
