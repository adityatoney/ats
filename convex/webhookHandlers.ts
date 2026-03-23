import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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
    // Find pending order using compound index
    const pendingOrders = await ctx.db
      .query("orders")
      .withIndex("by_runId_status", (q) =>
        q.eq("runId", args.runId).eq("status", "pending")
      )
      .collect();
    const pendingOrder = pendingOrders.find(
      (o) => o.symbol === args.symbol && o.side === args.side
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

// Batch process multiple events in a single transaction.
// Called by the Node server write queue — up to 25 events per call.
export const processBatch = mutation({
  args: {
    events: v.array(
      v.object({
        runId: v.string(),
        eventType: v.string(),
        payload: v.any(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      tournamentId?: string;
      agentId?: string;
      eventType: string;
    }> = [];

    // Track latest progress per run to avoid redundant patches
    const latestProgressByRun = new Map<
      string,
      { processedBars: number; totalBars: number }
    >();

    for (const event of args.events) {
      const runId = event.runId as Id<"runs">;
      const p = event.payload as Record<string, any>;

      // agentEvents are NOT logged per-event here — they're bulk-inserted
      // after run completion via bulkInsertAgentEvents to reduce write volume.

      switch (event.eventType) {
        case "run.started": {
          await ctx.db.patch(runId, { status: "running" });
          break;
        }

        case "order.submitted": {
          await ctx.db.insert("orders", {
            pgId: "",
            runId,
            symbol: p.symbol,
            side: p.side,
            orderType: p.order_type,
            quantity: p.quantity,
            status: "pending",
            barIndex: p.bar_index ?? 0,
            submittedAtSim: p.timestamp
              ? new Date(p.timestamp).getTime()
              : undefined,
          });
          break;
        }

        case "order.filled": {
          // Find pending order using compound index — only reads pending orders, not all
          const pendingOrders = await ctx.db
            .query("orders")
            .withIndex("by_runId_status", (q) =>
              q.eq("runId", runId).eq("status", "pending")
            )
            .collect();
          const pendingOrder = pendingOrders.find(
            (o) =>
              o.symbol === p.symbol &&
              o.side === p.side
          );

          let orderId: Id<"orders">;
          const filledAtSim = p.timestamp
            ? new Date(p.timestamp).getTime()
            : undefined;

          if (pendingOrder) {
            await ctx.db.patch(pendingOrder._id, {
              status: "filled",
              barIndex: p.bar_index ?? 0,
              filledAtSim,
            });
            orderId = pendingOrder._id;
          } else {
            orderId = await ctx.db.insert("orders", {
              pgId: "",
              runId,
              symbol: p.symbol,
              side: p.side,
              orderType: p.order_type,
              quantity: p.quantity,
              status: "filled",
              barIndex: p.bar_index ?? 0,
              submittedAtSim: filledAtSim,
              filledAtSim,
            });
          }

          await ctx.db.insert("fills", {
            pgId: "",
            orderId,
            runId,
            fillPrice: p.fill_price,
            fillQuantity: p.quantity,
            fee: p.fee ?? 0,
            slippage: p.slippage ?? 0,
            filledAtSim,
          });
          break;
        }

        case "run.progress": {
          // Insert every portfolio snapshot
          if (p.barIndex !== undefined) {
            await ctx.db.insert("portfolioSnapshots", {
              pgId: "",
              runId,
              barIndex: p.barIndex,
              timestampSimulated: p.timestampSimulated
                ? new Date(p.timestampSimulated).getTime()
                : undefined,
              cash: p.cash ?? 0,
              equity: p.equity ?? 0,
              positionsJson: p.positionsJson ?? {},
              drawdown: p.drawdown ?? 0,
              highWaterMark: p.highWaterMark ?? 0,
            });
          }
          // Only keep latest progress values — patched once after loop
          latestProgressByRun.set(event.runId, {
            processedBars: p.processedBars ?? 0,
            totalBars: p.totalBars ?? 0,
          });
          break;
        }

        case "checkpoint.saved": {
          await ctx.db.insert("checkpoints", {
            pgId: "",
            runId,
            barIndex: p.barIndex ?? 0,
            stateBlob: p.state ?? {},
          });
          break;
        }

        case "run.completed": {
          const run = await ctx.db.get(runId);
          if (run) {
            await ctx.db.patch(runId, {
              status: "completed",
              metricsJson: p.metrics ?? undefined,
              processedBars: p.processedBars ?? 0,
              completedAt: Date.now(),
            });
            await ctx.db.patch(run.agentId, {
              status: "idle",
              updatedAt: Date.now(),
            });
            // Remove from progress map — no need to patch run again
            latestProgressByRun.delete(event.runId);
            results.push({
              tournamentId: run.tournamentId as string | undefined,
              agentId: run.agentId as string,
              eventType: "run.completed",
            });
          }
          break;
        }

        case "run.failed": {
          const failedRun = await ctx.db.get(runId);
          if (failedRun) {
            await ctx.db.patch(runId, {
              status: "failed",
              errorMessage: p.error ?? "Unknown error",
              completedAt: Date.now(),
            });
            await ctx.db.patch(failedRun.agentId, {
              status: "idle",
              updatedAt: Date.now(),
            });
            latestProgressByRun.delete(event.runId);
            results.push({
              tournamentId: failedRun.tournamentId as string | undefined,
              agentId: failedRun.agentId as string,
              eventType: "run.failed",
            });
          }
          break;
        }

        case "soul.generated": {
          if (p.soulMd && p.soulJson) {
            const soulRun = await ctx.db.get(runId);
            if (soulRun) {
              const souls = await ctx.db
                .query("soulVersions")
                .withIndex("by_agentId_version", (q) =>
                  q.eq("agentId", soulRun.agentId)
                )
                .collect();
              const latestVersion =
                souls.length > 0
                  ? Math.max(...souls.map((s) => s.version))
                  : 0;
              await ctx.db.insert("soulVersions", {
                pgId: "",
                agentId: soulRun.agentId,
                version: latestVersion + 1,
                soulMd: p.soulMd,
                soulJson: p.soulJson,
                status: "pending",
                derivedFromRunId: runId,
              });
            }
          }
          break;
        }

        case "branch.completed": {
          if (p.resultDelta) {
            const branches = await ctx.db
              .query("branches")
              .withIndex("by_runId", (q) => q.eq("runId", runId))
              .collect();
            for (const branch of branches) {
              await ctx.db.patch(branch._id, {
                resultDeltaJson: p.resultDelta,
                status: "completed",
              });
            }
          }
          break;
        }
      }
    }

    // Apply deduplicated progress patches — only every 500 bars or on last bar.
    // Frontend reads progress from SSE, not DB. DB value is only for crash recovery.
    for (const [runIdStr, progress] of latestProgressByRun) {
      const isLastBar = progress.totalBars > 0 && progress.processedBars >= progress.totalBars;
      const isCheckpoint = progress.processedBars % 500 === 0;
      if (isLastBar || isCheckpoint) {
        const runId = runIdStr as Id<"runs">;
        await ctx.db.patch(runId, {
          status: "running",
          processedBars: progress.processedBars,
          totalBars: progress.totalBars,
        });
      }
    }

    return results;
  },
});

// Bulk-insert agent events after run completion.
// Called once per run instead of per-event — reduces write volume by ~50%.
// Convex transactions handle up to ~100 inserts comfortably; batch to 100 from Node side.
export const bulkInsertAgentEvents = mutation({
  args: {
    events: v.array(
      v.object({
        runId: v.string(),
        eventType: v.string(),
        payload: v.any(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const event of args.events) {
      await ctx.db.insert("agentEvents", {
        pgId: "",
        runId: event.runId as Id<"runs">,
        eventType: event.eventType,
        payload: event.payload,
      });
    }
  },
});
