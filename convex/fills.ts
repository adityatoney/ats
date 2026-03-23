import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("fills") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("fills")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    return await ctx.db
      .query("fills")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .collect();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("fills")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    orderId: v.id("orders"),
    runId: v.id("runs"),
    fillPrice: v.float64(),
    fillQuantity: v.float64(),
    fee: v.float64(),
    slippage: v.float64(),
    filledAtSim: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("fills", args);
  },
});

export const remove = mutation({
  args: { id: v.id("fills") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
