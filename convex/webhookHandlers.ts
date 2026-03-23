import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Handle order.submitted event
export const handleOrderSubmitted = mutation({
  args: {
    runId: v.id("runs"),
    symbol: v.string(),
    side: v.string(),
    orderType: v.string(),
    quantity: v.float64(),
    barIndex: v.float64(),
    submittedAtSim: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("orders", {
      pgId: "",
      runId: args.runId,
      symbol: args.symbol,
      side: args.side,
      orderType: args.orderType,
      quantity: args.quantity,
      status: "pending",
      barIndex: args.barIndex,
      submittedAtSim: args.submittedAtSim,
    });
  },
});

// Handle order.filled event — atomically finds pending order and creates fill
export const handleOrderFilled = mutation({
  args: {
    runId: v.id("runs"),
    symbol: v.string(),
    side: v.string(),
    orderType: v.string(),
    quantity: v.float64(),
    fillPrice: v.float64(),
    fee: v.float64(),
    slippage: v.float64(),
    barIndex: v.float64(),
    filledAtSim: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    // Find pending order
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .collect();
    const pendingOrder = orders.find(
      (o) => o.symbol === args.symbol && o.side === args.side && o.status === "pending"
    );

    let orderId;
    if (pendingOrder) {
      await ctx.db.patch(pendingOrder._id, {
        status: "filled",
        barIndex: args.barIndex,
        filledAtSim: args.filledAtSim,
      });
      orderId = pendingOrder._id;
    } else {
      // No matching pending order — insert as filled directly
      orderId = await ctx.db.insert("orders", {
        pgId: "",
        runId: args.runId,
        symbol: args.symbol,
        side: args.side,
        orderType: args.orderType,
        quantity: args.quantity,
        status: "filled",
        barIndex: args.barIndex,
        submittedAtSim: args.filledAtSim,
        filledAtSim: args.filledAtSim,
      });
    }

    await ctx.db.insert("fills", {
      pgId: "",
      orderId,
      runId: args.runId,
      fillPrice: args.fillPrice,
      fillQuantity: args.quantity,
      fee: args.fee,
      slippage: args.slippage,
      filledAtSim: args.filledAtSim,
    });
  },
});

// Handle run.progress event
export const handleRunProgress = mutation({
  args: {
    runId: v.id("runs"),
    barIndex: v.optional(v.float64()),
    timestampSimulated: v.optional(v.float64()),
    cash: v.optional(v.float64()),
    equity: v.optional(v.float64()),
    positionsJson: v.optional(v.any()),
    drawdown: v.optional(v.float64()),
    highWaterMark: v.optional(v.float64()),
    processedBars: v.optional(v.float64()),
    totalBars: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    // Insert portfolio snapshot if barIndex provided
    if (args.barIndex !== undefined) {
      await ctx.db.insert("portfolioSnapshots", {
        pgId: "",
        runId: args.runId,
        barIndex: args.barIndex,
        timestampSimulated: args.timestampSimulated,
        cash: args.cash ?? 0,
        equity: args.equity ?? 0,
        positionsJson: args.positionsJson ?? {},
        drawdown: args.drawdown ?? 0,
        highWaterMark: args.highWaterMark ?? 0,
      });
    }

    // Update run progress
    await ctx.db.patch(args.runId, {
      status: "running",
      processedBars: args.processedBars ?? 0,
      totalBars: args.totalBars ?? 0,
    });
  },
});

// Handle run.completed event
export const handleRunCompleted = mutation({
  args: {
    runId: v.id("runs"),
    metrics: v.optional(v.any()),
    processedBars: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    await ctx.db.patch(args.runId, {
      status: "completed",
      metricsJson: args.metrics ?? undefined,
      processedBars: args.processedBars ?? 0,
      completedAt: Date.now(),
    });

    // Reset agent status
    await ctx.db.patch(run.agentId, { status: "idle", updatedAt: Date.now() });

    // Return tournamentId for external handling
    return { tournamentId: run.tournamentId, agentId: run.agentId };
  },
});

// Handle run.failed event
export const handleRunFailed = mutation({
  args: {
    runId: v.id("runs"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    await ctx.db.patch(args.runId, {
      status: "failed",
      errorMessage: args.error ?? "Unknown error",
      completedAt: Date.now(),
    });

    await ctx.db.patch(run.agentId, { status: "idle", updatedAt: Date.now() });

    return { tournamentId: run.tournamentId, agentId: run.agentId };
  },
});

// Handle checkpoint.saved event
export const handleCheckpointSaved = mutation({
  args: {
    runId: v.id("runs"),
    barIndex: v.float64(),
    state: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("checkpoints", {
      pgId: "",
      runId: args.runId,
      barIndex: args.barIndex,
      stateBlob: args.state ?? {},
    });
  },
});

// Handle soul.generated event
export const handleSoulGenerated = mutation({
  args: {
    runId: v.id("runs"),
    soulMd: v.string(),
    soulJson: v.any(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    // Find latest soul version for this agent
    const souls = await ctx.db
      .query("soulVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", run.agentId))
      .collect();
    const latestVersion = souls.length > 0
      ? Math.max(...souls.map((s) => s.version))
      : 0;

    await ctx.db.insert("soulVersions", {
      pgId: "",
      agentId: run.agentId,
      version: latestVersion + 1,
      soulMd: args.soulMd,
      soulJson: args.soulJson,
      status: "pending",
      derivedFromRunId: args.runId,
    });
  },
});

// Handle branch.completed event
export const handleBranchCompleted = mutation({
  args: {
    runId: v.id("runs"),
    resultDelta: v.any(),
  },
  handler: async (ctx, args) => {
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .collect();
    for (const branch of branches) {
      await ctx.db.patch(branch._id, {
        resultDeltaJson: args.resultDelta,
        status: "completed",
      });
    }
  },
});

// Log agent event
export const logAgentEvent = mutation({
  args: {
    runId: v.id("runs"),
    eventType: v.string(),
    payload: v.any(),
    timestampSimulated: v.optional(v.float64()),
    barIndex: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentEvents", {
      pgId: "",
      runId: args.runId,
      eventType: args.eventType,
      payload: args.payload,
      timestampSimulated: args.timestampSimulated,
      barIndex: args.barIndex,
    });
  },
});
