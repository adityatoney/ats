import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("branches") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("branches")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("branches")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const listByParentRun = query({
  args: { parentRunId: v.id("runs") },
  handler: async (ctx, { parentRunId }) => {
    return await ctx.db
      .query("branches")
      .withIndex("by_parentRunId", (q) => q.eq("parentRunId", parentRunId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    runId: v.id("runs"),
    parentCheckpointId: v.id("checkpoints"),
    parentBranchId: v.optional(v.id("branches")),
    parentRunId: v.id("runs"),
    changeSummary: v.string(),
    rationale: v.optional(v.string()),
    creatorType: v.string(),
    overridesJson: v.any(),
    resultDeltaJson: v.optional(v.any()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("branches", args);
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("branches"),
    resultDeltaJson: v.optional(v.any()),
    status: v.optional(v.string()),
    parentBranchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("branches") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
