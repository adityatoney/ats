import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("tournaments").collect();
  },
});

export const get = query({
  args: { id: v.id("tournaments") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    projectId: v.id("projects"),
    name: v.string(),
    configJson: v.any(),
    status: v.string(),
    dataSnapshotId: v.optional(v.string()),
    agentCount: v.float64(),
    completedCount: v.float64(),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("tournaments", args);
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("tournaments"),
    status: v.optional(v.string()),
    dataSnapshotId: v.optional(v.string()),
    agentCount: v.optional(v.float64()),
    completedCount: v.optional(v.float64()),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const incrementCompleted = mutation({
  args: { id: v.id("tournaments") },
  handler: async (ctx, { id }) => {
    const tournament = await ctx.db.get(id);
    if (!tournament) throw new Error("Tournament not found");
    await ctx.db.patch(id, { completedCount: tournament.completedCount + 1 });
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("tournaments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
