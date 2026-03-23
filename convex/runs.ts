import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("runs").collect();
  },
});

export const get = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .collect();
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    agentId: v.id("agents"),
    strategyVersionId: v.id("strategyVersions"),
    tournamentId: v.optional(v.id("tournaments")),
    branchId: v.optional(v.string()),
    status: v.string(),
    runType: v.string(),
    configJson: v.any(),
    metricsJson: v.optional(v.any()),
    totalBars: v.float64(),
    processedBars: v.float64(),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("runs", args);
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("runs"),
    status: v.optional(v.string()),
    runType: v.optional(v.string()),
    metricsJson: v.optional(v.any()),
    totalBars: v.optional(v.float64()),
    processedBars: v.optional(v.float64()),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
    errorMessage: v.optional(v.string()),
    branchId: v.optional(v.string()),
    tournamentId: v.optional(v.id("tournaments")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const clearTournamentId = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { tournamentId: undefined });
  },
});
