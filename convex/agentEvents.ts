import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("agentEvents") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const listByRunPaginated = query({
  args: { runId: v.id("runs"), offset: v.float64(), limit: v.float64() },
  handler: async (ctx, { runId, offset, limit }) => {
    const all = await ctx.db
      .query("agentEvents")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
    return all.slice(offset, offset + limit);
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    runId: v.id("runs"),
    eventType: v.string(),
    payload: v.any(),
    timestampSimulated: v.optional(v.float64()),
    barIndex: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentEvents", args);
  },
});

export const remove = mutation({
  args: { id: v.id("agentEvents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
