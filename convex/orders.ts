import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("orders") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByPgId = query({
  args: { pgId: v.string() },
  handler: async (ctx, { pgId }) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_pgId", (q) => q.eq("pgId", pgId))
      .unique();
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const findPendingOrder = query({
  args: { runId: v.id("runs"), symbol: v.string(), side: v.string() },
  handler: async (ctx, { runId, symbol, side }) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .collect();
    return orders.find((o) => o.symbol === symbol && o.side === side && o.status === "pending") ?? null;
  },
});

export const getByRunAndClientOrderId = query({
  args: { runId: v.id("runs"), clientOrderId: v.string() },
  handler: async (ctx, { runId, clientOrderId }) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_runId_and_clientOrderId", (q) =>
        q.eq("runId", runId).eq("clientOrderId", clientOrderId)
      )
      .unique();
  },
});

export const create = mutation({
  args: {
    pgId: v.string(),
    runId: v.id("runs"),
    clientOrderId: v.optional(v.string()),
    symbol: v.string(),
    side: v.string(),
    orderType: v.string(),
    quantity: v.float64(),
    limitPrice: v.optional(v.float64()),
    stopPrice: v.optional(v.float64()),
    status: v.string(),
    submittedAtSim: v.optional(v.float64()),
    filledAtSim: v.optional(v.float64()),
    barIndex: v.float64(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("orders", args);
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("orders"),
    status: v.optional(v.string()),
    barIndex: v.optional(v.float64()),
    filledAtSim: v.optional(v.float64()),
    clientOrderId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
