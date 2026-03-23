import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("strategyVersions") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("strategyVersions")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const getLatestByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const versions = await ctx.db
      .query("strategyVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", agentId))
      .collect();
    if (versions.length === 0) return null;
    return versions.reduce((latest, v) => (v.version > latest.version ? v : latest));
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    return await ctx.db
      .query("strategyVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", agentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    agentId: v.id("agents"),
    version: v.float64(),
    sourceKind: v.string(),
    strategyMd: v.optional(v.string()),
    strategyPine: v.optional(v.string()),
    strategyPy: v.optional(v.string()),
    strategyIrJson: v.optional(v.any()),
    configJson: v.any(),
  },
  handler: async (ctx, args) => {
    // Enforce unique(agentId, version)
    const existing = await ctx.db
      .query("strategyVersions")
      .withIndex("by_agentId_version", (q) =>
        q.eq("agentId", args.agentId).eq("version", args.version)
      )
      .unique();
    if (existing) throw new Error(`Strategy version ${args.version} already exists for agent`);
    return await ctx.db.insert("strategyVersions", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("strategyVersions"),
    strategyPine: v.optional(v.string()),
    strategyPy: v.optional(v.string()),
    strategyIrJson: v.optional(v.any()),
    configJson: v.optional(v.any()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("strategyVersions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
