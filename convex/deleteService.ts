import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const BATCH_SIZE = 200;

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

/**
 * Ordered phases for deleting a run's children.
 * Each phase targets one table+index combination.
 * Fills are deleted before orders (FK dependency).
 * "nullify" mode patches runId to undefined instead of deleting.
 */
const DELETE_PHASES: ReadonlyArray<{
  table: string;
  index: string;
  field: string;
  mode?: "nullify";
}> = [
  { table: "fills",              index: "by_runId",          field: "runId" },
  { table: "orders",             index: "by_runId",          field: "runId" },
  { table: "positions",          index: "by_runId_symbol",   field: "runId" },
  { table: "portfolioSnapshots", index: "by_runId_barIndex", field: "runId" },
  { table: "agentEvents",        index: "by_runId",          field: "runId" },
  { table: "branches",           index: "by_runId",          field: "runId" },
  { table: "branches",           index: "by_parentRunId",    field: "parentRunId" },
  { table: "checkpoints",        index: "by_runId_barIndex", field: "runId" },
  { table: "leaderboardEntries", index: "by_runId",          field: "runId" },
  { table: "tournamentEntries",  index: "by_runId",          field: "runId", mode: "nullify" },
];

// ---------------------------------------------------------------------------
// Internal: batched self-scheduling run deletion worker
// ---------------------------------------------------------------------------
export const deleteRunBatch = internalMutation({
  args: {
    runId: v.id("runs"),
    phase: v.float64(),
  },
  handler: async (ctx, { runId, phase }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "deleting") return;

    // All phases done — delete the run document itself
    if (phase >= DELETE_PHASES.length) {
      await ctx.db.delete(runId);
      return;
    }

    const p = DELETE_PHASES[phase];
    const docs = await ctx.db
      .query(p.table as any)
      .withIndex(p.index, (q: any) => q.eq(p.field, runId))
      .take(BATCH_SIZE);

    if (docs.length === 0) {
      // Phase complete, advance to next
      await ctx.scheduler.runAfter(0, internal.deleteService.deleteRunBatch, {
        runId,
        phase: phase + 1,
      });
      return;
    }

    for (const doc of docs) {
      if (p.mode === "nullify") {
        await ctx.db.patch((doc as any)._id, { runId: undefined });
      } else {
        await ctx.db.delete((doc as any)._id);
      }
    }

    // If we got a full batch there may be more rows — re-run same phase.
    // Otherwise advance to the next phase.
    await ctx.scheduler.runAfter(0, internal.deleteService.deleteRunBatch, {
      runId,
      phase: docs.length === BATCH_SIZE ? phase : phase + 1,
    });
  },
});

// ---------------------------------------------------------------------------
// Public: kick off run deletion (thin entry point)
// ---------------------------------------------------------------------------
export const deleteRun = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) throw new Error("Run not found");
    if (run.status === "deleting") return; // Already in progress
    if (!TERMINAL_STATUSES.includes(run.status)) {
      throw new Error("Cannot delete a running or paused run. Cancel it first.");
    }
    await ctx.db.patch(id, { status: "deleting" });
    await ctx.scheduler.runAfter(0, internal.deleteService.deleteRunBatch, {
      runId: id,
      phase: 0,
    });
  },
});

// ---------------------------------------------------------------------------
// Internal: finalize agent deletion after all its runs are gone
// ---------------------------------------------------------------------------
export const deleteAgentFinalize = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return; // Already deleted

    // Check if any runs still exist for this agent
    const remaining = await ctx.db
      .query("runs")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .take(1);
    if (remaining.length > 0) {
      // Runs still being deleted — check again in 1 second
      await ctx.scheduler.runAfter(1000, internal.deleteService.deleteAgentFinalize, {
        agentId,
      });
      return;
    }

    // Batched cleanup of agent-owned records
    const souls = await ctx.db
      .query("soulVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", agentId))
      .take(BATCH_SIZE);
    for (const s of souls) {
      await ctx.db.delete(s._id);
    }
    if (souls.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.deleteService.deleteAgentFinalize, { agentId });
      return;
    }

    const strategies = await ctx.db
      .query("strategyVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", agentId))
      .take(BATCH_SIZE);
    for (const s of strategies) {
      await ctx.db.delete(s._id);
    }
    if (strategies.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.deleteService.deleteAgentFinalize, { agentId });
      return;
    }

    // Everything cleaned up — delete the agent
    await ctx.db.delete(agentId);
  },
});

// ---------------------------------------------------------------------------
// Public: kick off agent deletion
// ---------------------------------------------------------------------------
export const deleteAgent = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const agent = await ctx.db.get(id);
    if (!agent) throw new Error("Agent not found");

    const agentRuns = await ctx.db
      .query("runs")
      .withIndex("by_agentId", (q) => q.eq("agentId", id))
      .collect();
    const activeRuns = agentRuns.filter(
      (r) => !TERMINAL_STATUSES.includes(r.status) && r.status !== "deleting",
    );
    if (activeRuns.length > 0) {
      throw new Error("Cannot delete agent with active runs. Cancel them first.");
    }

    // Mark all terminal runs as deleting and kick off their deletion
    for (const run of agentRuns) {
      if (run.status !== "deleting") {
        await ctx.db.patch(run._id, { status: "deleting" });
      }
      await ctx.scheduler.runAfter(0, internal.deleteService.deleteRunBatch, {
        runId: run._id,
        phase: 0,
      });
    }

    // Schedule agent cleanup after all runs are deleted
    await ctx.scheduler.runAfter(0, internal.deleteService.deleteAgentFinalize, {
      agentId: id,
    });
  },
});

// ---------------------------------------------------------------------------
// Public: delete tournament (kept synchronous — indexed queries, small data)
// ---------------------------------------------------------------------------
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
