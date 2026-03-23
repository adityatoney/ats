import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("positions") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const getByRunAndSymbol = query({
  args: { runId: v.id("runs"), symbol: v.string() },
  handler: async (ctx, { runId, symbol }) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_runId_symbol", (q) => q.eq("runId", runId).eq("symbol", symbol))
      .unique();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_runId_symbol", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    runId: v.id("runs"),
    symbol: v.string(),
    quantity: v.float64(),
    avgEntryPrice: v.float64(),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    realizedPnl: v.float64(),
  },
  handler: async (ctx, args) => {
    // Enforce unique(runId, symbol)
    const existing = await ctx.db
      .query("positions")
      .withIndex("by_runId_symbol", (q) => q.eq("runId", args.runId).eq("symbol", args.symbol))
      .unique();
    if (existing) throw new Error(`Position for ${args.symbol} already exists in run`);
    return await ctx.db.insert("positions", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("positions"),
    quantity: v.optional(v.float64()),
    avgEntryPrice: v.optional(v.float64()),
    currentPrice: v.optional(v.float64()),
    unrealizedPnl: v.optional(v.float64()),
    realizedPnl: v.optional(v.float64()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("positions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
