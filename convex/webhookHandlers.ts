import { mutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

const SNAPSHOT_INTERVAL_BARS = 25;
const RUN_PROGRESS_INTERVAL_BARS = 100;

function toMillis(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function shouldPersistProgressSnapshot(
  processedBars: number,
  totalBars: number,
): boolean {
  if (processedBars <= 0) {
    return false;
  }

  return processedBars >= totalBars || processedBars % SNAPSHOT_INTERVAL_BARS === 0;
}

function shouldPersistRunProgress(
  processedBars: number,
  totalBars: number,
): boolean {
  if (processedBars <= 0) {
    return false;
  }

  return processedBars >= totalBars || processedBars % RUN_PROGRESS_INTERVAL_BARS === 0;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

async function updateTournamentStateForTerminalRun(
  ctx: MutationCtx,
  runId: Id<"runs">,
  status: "completed" | "failed",
  patch: Record<string, unknown>,
) {
  const run = await ctx.db.get(runId);
  if (!run) {
    return null;
  }

  await ctx.db.patch(runId, withoutUndefined(patch));
  await ctx.db.patch(run.agentId, {
    status: "idle",
    updatedAt: Date.now(),
  });

  let tournamentIdToFinalize: string | undefined;
  let completedCount: number | undefined;
  let agentCount: number | undefined;

  if (run.tournamentId) {
    const tournamentId = run.tournamentId;
    const entry = await ctx.db
      .query("tournamentEntries")
      .withIndex("by_tournamentId_agentId", (q) =>
        q.eq("tournamentId", tournamentId).eq("agentId", run.agentId)
      )
      .unique();

    const isAlreadyTerminal =
      entry?.status === "completed" || entry?.status === "failed";

    if (entry && entry.status !== status) {
      await ctx.db.patch(entry._id, { status });
    }

    if (!isAlreadyTerminal) {
      const tournament = await ctx.db.get(tournamentId);
      if (tournament) {
        completedCount = Math.min(
          tournament.agentCount,
          tournament.completedCount + 1,
        );
        agentCount = tournament.agentCount;

        if (completedCount !== tournament.completedCount) {
          await ctx.db.patch(tournament._id, { completedCount });
        }

        if (completedCount >= tournament.agentCount) {
          tournamentIdToFinalize = tournament._id;
        }
      }
    } else {
      const tournament = await ctx.db.get(tournamentId);
      completedCount = tournament?.completedCount;
      agentCount = tournament?.agentCount;
    }
  }

  return {
    run,
    tournamentIdToFinalize,
    completedCount,
    agentCount,
  };
}

// Handle order.submitted event
export const handleOrderSubmitted = mutation({
  args: {
    runId: v.id("runs"),
    clientOrderId: v.optional(v.string()),
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
      clientOrderId: args.clientOrderId,
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
    clientOrderId: v.optional(v.string()),
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
    const filledAtSim = args.filledAtSim;
    let orderId: Id<"orders">;

    const byClientOrderId = args.clientOrderId
      ? await ctx.db
          .query("orders")
          .withIndex("by_runId_and_clientOrderId", (q) =>
            q.eq("runId", args.runId).eq("clientOrderId", args.clientOrderId!)
          )
          .unique()
      : null;

    if (byClientOrderId) {
      if (byClientOrderId.status !== "filled") {
        await ctx.db.patch(byClientOrderId._id, {
          status: "filled",
          barIndex: args.barIndex,
          filledAtSim,
        });
      }
      orderId = byClientOrderId._id;
    } else {
      const pendingOrders = await ctx.db
        .query("orders")
        .withIndex("by_runId_and_status", (q) =>
          q.eq("runId", args.runId).eq("status", "pending")
        )
        .collect();
      const pendingOrder = pendingOrders.find(
        (o) => o.symbol === args.symbol && o.side === args.side,
      );

      if (pendingOrder) {
        await ctx.db.patch(pendingOrder._id, {
          clientOrderId: args.clientOrderId ?? pendingOrder.clientOrderId,
          status: "filled",
          barIndex: args.barIndex,
          filledAtSim,
        });
        orderId = pendingOrder._id;
      } else {
        orderId = await ctx.db.insert("orders", {
          pgId: "",
          runId: args.runId,
          clientOrderId: args.clientOrderId,
          symbol: args.symbol,
          side: args.side,
          orderType: args.orderType,
          quantity: args.quantity,
          status: "filled",
          barIndex: args.barIndex,
          submittedAtSim: filledAtSim,
          filledAtSim,
        });
      }
    }

    await ctx.db.insert("fills", {
      pgId: "",
      orderId,
      runId: args.runId,
      fillPrice: args.fillPrice,
      fillQuantity: args.quantity,
      fee: args.fee,
      slippage: args.slippage,
      filledAtSim,
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
    const processedBars = args.processedBars ?? 0;
    const totalBars = args.totalBars ?? 0;

    if (
      args.barIndex !== undefined &&
      shouldPersistProgressSnapshot(processedBars, totalBars)
    ) {
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

    if (shouldPersistRunProgress(processedBars, totalBars)) {
      await ctx.db.patch(args.runId, {
        status: "running",
        processedBars,
        totalBars,
      });
    }
  },
});

// Handle run.completed event
export const handleRunCompleted = mutation({
  args: {
    runId: v.id("runs"),
    metrics: v.optional(v.any()),
    processedBars: v.optional(v.float64()),
    totalBars: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const existingRun = await ctx.db.get(args.runId);
    const totalBars = args.totalBars ?? existingRun?.totalBars ?? args.processedBars ?? 0;
    const result = await updateTournamentStateForTerminalRun(ctx, args.runId, "completed", {
      status: "completed",
      metricsJson: args.metrics ?? undefined,
      processedBars: args.processedBars ?? 0,
      totalBars,
      completedAt: Date.now(),
    });

    if (!result) {
      return null;
    }

    return {
      runId: args.runId,
      tournamentId: result.run.tournamentId,
      agentId: result.run.agentId,
      eventType: "run.completed",
      tournamentIdToFinalize: result.tournamentIdToFinalize,
      completedCount: result.completedCount,
      agentCount: result.agentCount,
    };
  },
});

// Handle run.failed event
export const handleRunFailed = mutation({
  args: {
    runId: v.id("runs"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await updateTournamentStateForTerminalRun(ctx, args.runId, "failed", {
      status: "failed",
      errorMessage: args.error ?? "Unknown error",
      completedAt: Date.now(),
    });

    if (!result) {
      return null;
    }

    return {
      runId: args.runId,
      tournamentId: result.run.tournamentId,
      agentId: result.run.agentId,
      eventType: "run.failed",
      tournamentIdToFinalize: result.tournamentIdToFinalize,
      completedCount: result.completedCount,
      agentCount: result.agentCount,
    };
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

    const souls = await ctx.db
      .query("soulVersions")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", run.agentId))
      .collect();
    const latestVersion =
      souls.length > 0 ? Math.max(...souls.map((s) => s.version)) : 0;

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

export const processBatch = mutation({
  args: {
    events: v.array(
      v.object({
        runId: v.string(),
        eventType: v.string(),
        payload: v.any(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      runId: string;
      tournamentId?: string;
      agentId?: string;
      eventType: string;
      tournamentIdToFinalize?: string;
      completedCount?: number;
      agentCount?: number;
      processedBars?: number;
      totalBars?: number;
    }> = [];

    const latestProgressByRun = new Map<
      string,
      {
        processedBars: number;
        totalBars: number;
      }
    >();

    for (const event of args.events) {
      const runId = event.runId as Id<"runs">;
      const p = event.payload as Record<string, any>;

      switch (event.eventType) {
        case "run.started": {
          await ctx.db.patch(runId, { status: "running" });
          break;
        }

        case "order.submitted": {
          await ctx.db.insert("orders", {
            pgId: "",
            runId,
            clientOrderId:
              typeof p.client_order_id === "string" ? p.client_order_id : undefined,
            symbol: p.symbol,
            side: p.side,
            orderType: p.order_type,
            quantity: p.quantity,
            status: "pending",
            barIndex: p.bar_index ?? 0,
            submittedAtSim: toMillis(p.timestamp),
          });
          break;
        }

        case "order.filled": {
          const filledAtSim = toMillis(p.timestamp);
          const clientOrderId =
            typeof p.client_order_id === "string" ? p.client_order_id : undefined;

          const byClientOrderId = clientOrderId
            ? await ctx.db
                .query("orders")
                .withIndex("by_runId_and_clientOrderId", (q) =>
                  q.eq("runId", runId).eq("clientOrderId", clientOrderId)
                )
                .unique()
            : null;

          let orderId: Id<"orders">;

          if (byClientOrderId) {
            if (byClientOrderId.status !== "filled") {
              await ctx.db.patch(byClientOrderId._id, {
                status: "filled",
                barIndex: p.bar_index ?? 0,
                filledAtSim,
              });
            }
            orderId = byClientOrderId._id;
          } else {
            const pendingOrders = await ctx.db
              .query("orders")
              .withIndex("by_runId_and_status", (q) =>
                q.eq("runId", runId).eq("status", "pending")
              )
              .collect();
            const pendingOrder = pendingOrders.find(
              (o) => o.symbol === p.symbol && o.side === p.side,
            );

            if (pendingOrder) {
              await ctx.db.patch(pendingOrder._id, {
                clientOrderId: clientOrderId ?? pendingOrder.clientOrderId,
                status: "filled",
                barIndex: p.bar_index ?? 0,
                filledAtSim,
              });
              orderId = pendingOrder._id;
            } else {
              orderId = await ctx.db.insert("orders", {
                pgId: "",
                runId,
                clientOrderId,
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
          const processedBars = p.processedBars ?? 0;
          const totalBars = p.totalBars ?? 0;
          const progressRun = await ctx.db.get(runId);

          if (
            p.barIndex !== undefined &&
            shouldPersistProgressSnapshot(processedBars, totalBars)
          ) {
            await ctx.db.insert("portfolioSnapshots", {
              pgId: "",
              runId,
              barIndex: p.barIndex,
              timestampSimulated: toMillis(p.timestampSimulated),
              cash: p.cash ?? 0,
              equity: p.equity ?? 0,
              positionsJson: p.positionsJson ?? {},
              drawdown: p.drawdown ?? 0,
              highWaterMark: p.highWaterMark ?? 0,
            });
          }

          latestProgressByRun.set(event.runId, {
            processedBars,
            totalBars,
          });
          if (progressRun?.tournamentId) {
            results.push({
              runId: event.runId,
              tournamentId: progressRun.tournamentId as string,
              agentId: progressRun.agentId as string,
              eventType: "run.progress",
              processedBars,
              totalBars,
            });
          }
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
          const existingRun = await ctx.db.get(runId);
          const totalBars = p.totalBars ?? existingRun?.totalBars ?? p.processedBars ?? 0;
          const result = await updateTournamentStateForTerminalRun(
            ctx,
            runId,
            "completed",
            withoutUndefined({
              status: "completed",
              metricsJson: p.metrics ?? undefined,
              processedBars: p.processedBars ?? 0,
              totalBars,
              completedAt: Date.now(),
            }),
          );

          latestProgressByRun.delete(event.runId);

          if (result) {
            results.push({
              runId: event.runId,
              tournamentId: result.run.tournamentId as string | undefined,
              agentId: result.run.agentId as string,
              eventType: "run.completed",
              tournamentIdToFinalize: result.tournamentIdToFinalize,
              completedCount: result.completedCount,
              agentCount: result.agentCount,
              processedBars: p.processedBars ?? 0,
              totalBars,
            });
          }
          break;
        }

        case "run.failed": {
          const result = await updateTournamentStateForTerminalRun(ctx, runId, "failed", {
            status: "failed",
            errorMessage: p.error ?? "Unknown error",
            completedAt: Date.now(),
          });

          latestProgressByRun.delete(event.runId);

          if (result) {
            results.push({
              runId: event.runId,
              tournamentId: result.run.tournamentId as string | undefined,
              agentId: result.run.agentId as string,
              eventType: "run.failed",
              tournamentIdToFinalize: result.tournamentIdToFinalize,
              completedCount: result.completedCount,
              agentCount: result.agentCount,
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
                  q.eq("agentId", soulRun.agentId),
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

    for (const [runIdStr, progress] of latestProgressByRun) {
      if (!shouldPersistRunProgress(progress.processedBars, progress.totalBars)) {
        continue;
      }

      await ctx.db.patch(runIdStr as Id<"runs">, {
        status: "running",
        processedBars: progress.processedBars,
        totalBars: progress.totalBars,
      });
    }

    return results;
  },
});

export const bulkInsertAgentEvents = mutation({
  args: {
    events: v.array(
      v.object({
        runId: v.string(),
        eventType: v.string(),
        payload: v.any(),
      }),
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
