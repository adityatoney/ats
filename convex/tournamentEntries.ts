import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("tournamentEntries") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("tournamentEntries")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    return await ctx.db
      .query("tournamentEntries")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .collect();
  },
});

export const getByTournamentAndAgent = query({
  args: { tournamentId: v.id("tournaments"), agentId: v.id("agents") },
  handler: async (ctx, { tournamentId, agentId }) => {
    return await ctx.db
      .query("tournamentEntries")
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
    runId: v.optional(v.id("runs")),
    finalRank: v.optional(v.float64()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Enforce unique(tournamentId, agentId)
    const existing = await ctx.db
      .query("tournamentEntries")
      .withIndex("by_tournamentId_agentId", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("agentId", args.agentId)
      )
      .unique();
    if (existing) throw new Error("Agent already entered in tournament");
    return await ctx.db.insert("tournamentEntries", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("tournamentEntries"),
    runId: v.optional(v.id("runs")),
    finalRank: v.optional(v.float64()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const clearRunId = mutation({
  args: { id: v.id("tournamentEntries") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { runId: undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("tournamentEntries") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
