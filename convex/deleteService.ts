import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Delete all child records of a run.
 * Mirrors packages/server/src/services/delete-service.ts deleteRunChildren
 */
async function deleteRunChildren(ctx: any, runId: any) {
  // Delete fills (via orders)
  const runOrders = await ctx.db
    .query("orders")
    .withIndex("by_runId", (q: any) => q.eq("runId", runId))
    .collect();
  for (const order of runOrders) {
    const orderFills = await ctx.db
      .query("fills")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", order._id))
      .collect();
    for (const fill of orderFills) {
      await ctx.db.delete(fill._id);
    }
  }

  // Delete orders
  for (const order of runOrders) {
    await ctx.db.delete(order._id);
  }

  // Delete positions
  const positions = await ctx.db
    .query("positions")
    .withIndex("by_runId_symbol", (q: any) => q.eq("runId", runId))
    .collect();
  for (const pos of positions) {
    await ctx.db.delete(pos._id);
  }

  // Delete portfolio snapshots
  const snapshots = await ctx.db
    .query("portfolioSnapshots")
    .withIndex("by_runId_barIndex", (q: any) => q.eq("runId", runId))
    .collect();
  for (const snap of snapshots) {
    await ctx.db.delete(snap._id);
  }

  // Delete agent events
  const events = await ctx.db
    .query("agentEvents")
    .withIndex("by_runId", (q: any) => q.eq("runId", runId))
    .collect();
  for (const event of events) {
    await ctx.db.delete(event._id);
  }

  // Delete branches (where runId or parentRunId)
  const branchesByRun = await ctx.db
    .query("branches")
    .withIndex("by_runId", (q: any) => q.eq("runId", runId))
    .collect();
  for (const branch of branchesByRun) {
    await ctx.db.delete(branch._id);
  }
  const branchesByParent = await ctx.db
    .query("branches")
    .withIndex("by_parentRunId", (q: any) => q.eq("parentRunId", runId))
    .collect();
  for (const branch of branchesByParent) {
    // May already be deleted if runId === parentRunId
    const existing = await ctx.db.get(branch._id);
    if (existing) await ctx.db.delete(branch._id);
  }

  // Delete checkpoints
  const checkpoints = await ctx.db
    .query("checkpoints")
    .withIndex("by_runId_barIndex", (q: any) => q.eq("runId", runId))
    .collect();
  for (const cp of checkpoints) {
    await ctx.db.delete(cp._id);
  }

  // Delete leaderboard entries referencing this run
  const allLeaderboard = await ctx.db.query("leaderboardEntries").collect();
  for (const entry of allLeaderboard) {
    if (entry.runId === runId) {
      await ctx.db.delete(entry._id);
    }
  }

  // Nullify runId on tournament entries
  const allTournamentEntries = await ctx.db.query("tournamentEntries").collect();
  for (const entry of allTournamentEntries) {
    if (entry.runId === runId) {
      await ctx.db.patch(entry._id, { runId: undefined });
    }
  }
}

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export const deleteRun = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) throw new Error("Run not found");
    if (!TERMINAL_STATUSES.includes(run.status)) {
      throw new Error("Cannot delete a running or paused run. Cancel it first.");
    }
    await deleteRunChildren(ctx, id);
    await ctx.db.delete(id);
  },
});

export const deleteAgent = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const agent = await ctx.db.get(id);
    if (!agent) throw new Error("Agent not found");

    const agentRuns = await ctx.db
      .query("runs")
      .withIndex("by_agentId", (q) => q.eq("agentId", id))
      .collect();
    const activeRuns = agentRuns.filter((r) => !TERMINAL_STATUSES.includes(r.status));
    if (activeRuns.length > 0) {
      throw new Error("Cannot delete agent with active runs. Cancel them first.");
    }

    // Delete tournament entries and leaderboard entries for this agent
    const allTE = await ctx.db.query("tournamentEntries").collect();
    for (const entry of allTE) {
      if (entry.agentId === id) await ctx.db.delete(entry._id);
    }
    const allLE = await ctx.db.query("leaderboardEntries").collect();
    for (const entry of allLE) {
      if (entry.agentId === id) await ctx.db.delete(entry._id);
    }

    // Delete all runs and their children
    for (const run of agentRuns) {
      await deleteRunChildren(ctx, run._id);
      await ctx.db.delete(run._id);
    }

    // Delete soul versions
    const souls = await ctx.db
      .query("soulVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", id))
      .collect();
    for (const soul of souls) {
      await ctx.db.delete(soul._id);
    }

    // Delete strategy versions
    const strategies = await ctx.db
      .query("strategyVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", id))
      .collect();
    for (const sv of strategies) {
      await ctx.db.delete(sv._id);
    }

    // Delete the agent
    await ctx.db.delete(id);
  },
});

export const deleteTournament = mutation({
  args: { id: v.id("tournaments") },
  handler: async (ctx, { id }) => {
    const tournament = await ctx.db.get(id);
    if (!tournament) throw new Error("Tournament not found");
    if (tournament.status === "in_progress") {
      throw new Error("Cannot delete an in-progress tournament. Cancel it first.");
    }

    // Delete leaderboard entries
    const leaderboard = await ctx.db
      .query("leaderboardEntries")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", id))
      .collect();
    for (const entry of leaderboard) {
      await ctx.db.delete(entry._id);
    }

    // Delete tournament entries
    const entries = await ctx.db
      .query("tournamentEntries")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", id))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    // Nullify tournamentId on runs
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", id))
      .collect();
    for (const run of runs) {
      await ctx.db.patch(run._id, { tournamentId: undefined });
    }

    // Delete the tournament
    await ctx.db.delete(id);
  },
});
