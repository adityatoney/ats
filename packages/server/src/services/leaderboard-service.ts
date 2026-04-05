import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export const leaderboardService = {
  async computeLeaderboard(tournamentId: string, rankingMetric = 'sharpeRatio') {
    const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });
    const completedEntries = entries.filter((e: any) => e.status === 'completed');
    const entriesByAgentId = new Map(completedEntries.map((entry: any) => [entry.agentId, entry]));

    const entryMetrics: Array<{
      agentId: string;
      runId: string;
      metrics: Record<string, number>;
    }> = [];

    const runs = await Promise.all(
      completedEntries
        .filter((entry: any) => !!entry.runId)
        .map(async (entry: any) => ({
          entry,
          run: await convex.query(api.runs.get, { id: entry.runId }),
        })),
    );

    for (const { entry, run } of runs) {
      if (!entry.runId) continue;
      if (!run?.metricsJson) continue;

      entryMetrics.push({
        agentId: entry.agentId,
        runId: entry.runId,
        metrics: run.metricsJson as Record<string, number>,
      });
    }

    // Sort by ranking metric
    entryMetrics.sort((a, b) => {
      const aVal = a.metrics[rankingMetric] ?? 0;
      const bVal = b.metrics[rankingMetric] ?? 0;
      return bVal - aVal;
    });

    if (rankingMetric === 'maxDrawdown') {
      entryMetrics.sort((a, b) => {
        const aVal = a.metrics[rankingMetric] ?? 0;
        const bVal = b.metrics[rankingMetric] ?? 0;
        return bVal - aVal;
      });
    }

    // Delete existing leaderboard entries
    await convex.mutation(api.leaderboardEntries.deleteByTournament, { tournamentId: tournamentId as any });

    // Insert ranked entries
    for (let i = 0; i < entryMetrics.length; i++) {
      const em = entryMetrics[i];
      const m = em.metrics;

      await convex.mutation(api.leaderboardEntries.create, {
        pgId: '',
        tournamentId: tournamentId as any,
        agentId: em.agentId as any,
        runId: em.runId as any,
        rank: i + 1,
        totalReturn: m.totalReturn ?? 0,
        sharpeRatio: m.sharpeRatio ?? 0,
        sortinoRatio: m.sortinoRatio ?? 0,
        maxDrawdown: m.maxDrawdown ?? 0,
        winRate: m.winRate ?? 0,
        profitFactor: m.profitFactor ?? 0,
        netProfit: m.netProfit ?? 0,
        totalTrades: m.totalTrades ?? 0,
        metricsJson: m,
        computedAt: Date.now(),
      });

      // Update tournament entry with final rank
      const te = entriesByAgentId.get(em.agentId);
      if (te) {
        await convex.mutation(api.tournamentEntries.update, { id: te._id, finalRank: i + 1 });
      }
    }

    return entryMetrics.length;
  },

  async getLeaderboard(tournamentId: string, agentContext?: string) {
    const entries = await convex.query(api.leaderboardEntries.listByTournament, { tournamentId: tournamentId as any });

    const enriched = await Promise.all(
      entries.map(async (entry: any) => {
        const agent = await convex.query(api.agents.get, { id: entry.agentId });
        return { ...entry, agentName: agent?.name || 'Unknown' };
      }),
    );

    if (agentContext) {
      return enriched.map((e: any) => ({
        rank: e.rank,
        agentId: e.agentId,
        agentName: e.agentName,
        totalReturn: e.totalReturn,
        sharpeRatio: e.sharpeRatio,
        maxDrawdown: e.maxDrawdown,
        isMe: e.agentId === agentContext,
      }));
    }

    return enriched;
  },

  async recomputeLeaderboard(tournamentId: string, rankingMetric: string) {
    return this.computeLeaderboard(tournamentId, rankingMetric);
  },

  async getAgentStanding(tournamentId: string, agentId: string) {
    const allEntries = await convex.query(api.leaderboardEntries.listByTournament, { tournamentId: tournamentId as any });

    const agentEntry = allEntries.find((e: any) => e.agentId === agentId);
    if (!agentEntry) return null;

    const totalEntrants = allEntries.length;
    const rank = agentEntry.rank;
    const percentile = ((totalEntrants - rank) / totalEntrants) * 100;

    const metricKeys = [
      'totalReturn', 'sharpeRatio', 'sortinoRatio', 'maxDrawdown',
      'winRate', 'profitFactor', 'netProfit',
    ] as const;

    const fieldStats: Record<string, { median: number; best: number; worst: number }> = {};
    const relativeStrengths: string[] = [];
    const relativeWeaknesses: string[] = [];

    for (const key of metricKeys) {
      const values = allEntries
        .map((e: any) => (e[key] as number) ?? 0)
        .sort((a: number, b: number) => a - b);

      const median = values[Math.floor(values.length / 2)];
      const best = Math.max(...values);
      const worst = Math.min(...values);

      fieldStats[key] = { median, best, worst };

      const agentVal = (agentEntry as any)[key] ?? 0;
      if (key === 'maxDrawdown') {
        if (agentVal > median) relativeStrengths.push(`${key}: above median`);
        else if (agentVal < median) relativeWeaknesses.push(`${key}: below median`);
      } else {
        if (agentVal > median) relativeStrengths.push(`${key}: above median`);
        else if (agentVal < median) relativeWeaknesses.push(`${key}: below median`);
      }
    }

    return {
      rank,
      totalEntrants,
      percentile: Math.round(percentile),
      agentMetrics: {
        totalReturn: agentEntry.totalReturn,
        sharpeRatio: agentEntry.sharpeRatio,
        sortinoRatio: agentEntry.sortinoRatio,
        maxDrawdown: agentEntry.maxDrawdown,
        winRate: agentEntry.winRate,
        profitFactor: agentEntry.profitFactor,
        netProfit: agentEntry.netProfit,
        totalTrades: agentEntry.totalTrades,
      },
      fieldStats,
      relativeStrengths,
      relativeWeaknesses,
    };
  },
};
