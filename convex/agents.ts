import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("agents").collect();
  },
});

export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    projectId: v.id("projects"),
    name: v.string(),
    status: v.string(),
    updatedAt: v.float64(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agents", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    status: v.optional(v.string()),
    updatedAt: v.optional(v.float64()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
