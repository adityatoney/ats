import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("leaderboardEntries") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    return await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .collect();
  },
});

export const getByTournamentAndAgent = query({
  args: { tournamentId: v.id("tournaments"), agentId: v.id("agents") },
  handler: async (ctx, { tournamentId, agentId }) => {
    return await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_tournamentId_agentId", (q) =>
        q.eq("tournamentId", tournamentId).eq("agentId", agentId)
      )
      .unique();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    tournamentId: v.id("tournaments"),
    agentId: v.id("agents"),
    runId: v.id("runs"),
    rank: v.float64(),
    totalReturn: v.optional(v.float64()),
    sharpeRatio: v.optional(v.float64()),
    sortinoRatio: v.optional(v.float64()),
    maxDrawdown: v.optional(v.float64()),
    winRate: v.optional(v.float64()),
    profitFactor: v.optional(v.float64()),
    netProfit: v.optional(v.float64()),
    totalTrades: v.optional(v.float64()),
    metricsJson: v.any(),
    computedAt: v.float64(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("leaderboardEntries", args);
  },
});

export const deleteByTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    const entries = await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
  },
});

export const deleteByRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const entries = await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
  },
});

export const deleteByAgent = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const all = await ctx.db.query("leaderboardEntries").collect();
    for (const entry of all) {
      if (entry.agentId === agentId) {
        await ctx.db.delete(entry._id);
      }
    }
  },
});

export const remove = mutation({
  args: { id: v.id("leaderboardEntries") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
