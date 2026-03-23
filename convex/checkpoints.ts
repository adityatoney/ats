import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("checkpoints") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_runId_barIndex", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    runId: v.id("runs"),
    barIndex: v.float64(),
    timestampSimulated: v.optional(v.float64()),
    stateBlob: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("checkpoints", args);
  },
});

export const remove = mutation({
  args: { id: v.id("checkpoints") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
