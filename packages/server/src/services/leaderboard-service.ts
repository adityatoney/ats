import { eq, and, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  leaderboardEntries,
  tournamentEntries,
  runs,
  agents,
} from '@aegis/db/schema';

export const leaderboardService = {
  async computeLeaderboard(tournamentId: string, rankingMetric = 'sharpeRatio') {
    // Get all completed entries
    const entries = await db.query.tournamentEntries.findMany({
      where: and(
        eq(tournamentEntries.tournamentId, tournamentId),
        eq(tournamentEntries.status, 'completed'),
      ),
    });

    // Fetch run metrics for each entry
    const entryMetrics: Array<{
      agentId: string;
      runId: string;
      metrics: Record<string, number>;
    }> = [];

    for (const entry of entries) {
      if (!entry.runId) continue;
      const run = await db.query.runs.findFirst({
        where: eq(runs.id, entry.runId),
      });
      if (!run?.metricsJson) continue;

      entryMetrics.push({
        agentId: entry.agentId,
        runId: entry.runId,
        metrics: run.metricsJson as Record<string, number>,
      });
    }

    // Sort by ranking metric (descending — higher is better)
    // Exception: maxDrawdown should be sorted ascending (less negative is better)
    const isLowerBetter = rankingMetric === 'maxDrawdown';
    entryMetrics.sort((a, b) => {
      const aVal = a.metrics[rankingMetric] ?? 0;
      const bVal = b.metrics[rankingMetric] ?? 0;
      return isLowerBetter ? bVal - aVal : bVal - aVal;
    });

    // For maxDrawdown, we actually want the LEAST negative (closest to 0) to rank first
    if (rankingMetric === 'maxDrawdown') {
      entryMetrics.sort((a, b) => {
        const aVal = a.metrics[rankingMetric] ?? 0;
        const bVal = b.metrics[rankingMetric] ?? 0;
        // Less negative (closer to 0) = better
        return bVal - aVal;
      });
    }

    // Delete existing leaderboard entries for this tournament
    await db
      .delete(leaderboardEntries)
      .where(eq(leaderboardEntries.tournamentId, tournamentId));

    // Insert ranked entries
    for (let i = 0; i < entryMetrics.length; i++) {
      const em = entryMetrics[i];
      const m = em.metrics;

      await db.insert(leaderboardEntries).values({
        tournamentId,
        agentId: em.agentId,
        runId: em.runId,
        rank: i + 1,
        totalReturn: String(m.totalReturn ?? 0),
        sharpeRatio: String(m.sharpeRatio ?? 0),
        sortinoRatio: String(m.sortinoRatio ?? 0),
        maxDrawdown: String(m.maxDrawdown ?? 0),
        winRate: String(m.winRate ?? 0),
        profitFactor: String(m.profitFactor ?? 0),
        netProfit: String(m.netProfit ?? 0),
        totalTrades: m.totalTrades ?? 0,
        metricsJson: m,
      });

      // Update tournament entry with final rank
      await db
        .update(tournamentEntries)
        .set({ finalRank: i + 1 })
        .where(
          and(
            eq(tournamentEntries.tournamentId, tournamentId),
            eq(tournamentEntries.agentId, em.agentId),
          ),
        );
    }

    return entryMetrics.length;
  },

  async getLeaderboard(tournamentId: string, agentContext?: string) {
    const entries = await db.query.leaderboardEntries.findMany({
      where: eq(leaderboardEntries.tournamentId, tournamentId),
      orderBy: [leaderboardEntries.rank],
    });

    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, entry.agentId),
        });
        return { ...entry, agentName: agent?.name || 'Unknown' };
      }),
    );

    if (agentContext) {
      return enriched.map((e) => ({
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
    const allEntries = await db.query.leaderboardEntries.findMany({
      where: eq(leaderboardEntries.tournamentId, tournamentId),
      orderBy: [leaderboardEntries.rank],
    });

    const agentEntry = allEntries.find((e) => e.agentId === agentId);
    if (!agentEntry) return null;

    const totalEntrants = allEntries.length;
    const rank = agentEntry.rank;
    const percentile = ((totalEntrants - rank) / totalEntrants) * 100;

    // Compute field stats for comparison
    const metricKeys = [
      'totalReturn',
      'sharpeRatio',
      'sortinoRatio',
      'maxDrawdown',
      'winRate',
      'profitFactor',
      'netProfit',
    ] as const;

    const fieldStats: Record<string, { median: number; best: number; worst: number }> = {};
    const relativeStrengths: string[] = [];
    const relativeWeaknesses: string[] = [];

    for (const key of metricKeys) {
      const values = allEntries
        .map((e) => parseFloat(e[key] as string) || 0)
        .sort((a, b) => a - b);

      const median = values[Math.floor(values.length / 2)];
      const best = key === 'maxDrawdown' ? Math.max(...values) : Math.max(...values);
      const worst = key === 'maxDrawdown' ? Math.min(...values) : Math.min(...values);

      fieldStats[key] = { median, best, worst };

      const agentVal = parseFloat(agentEntry[key] as string) || 0;
      if (key === 'maxDrawdown') {
        // For drawdown, closer to 0 is better
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
