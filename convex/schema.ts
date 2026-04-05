import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    pgId: v.string(),
    email: v.string(),
    name: v.string(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_email", ["email"]),

  projects: defineTable({
    pgId: v.string(),
    ownerId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
  })
    .index("by_pgId", ["pgId"])
    .index("by_ownerId", ["ownerId"]),

  agents: defineTable({
    pgId: v.string(),
    projectId: v.id("projects"),
    name: v.string(),
    status: v.string(),
    updatedAt: v.float64(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_projectId", ["projectId"]),

  strategyVersions: defineTable({
    pgId: v.string(),
    agentId: v.id("agents"),
    version: v.float64(),
    sourceKind: v.string(),
    strategyMd: v.optional(v.string()),
    strategyPine: v.optional(v.string()),
    strategyPy: v.optional(v.string()),
    strategyIrJson: v.optional(v.any()),
    configJson: v.any(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_agentId_version", ["agentId", "version"]),

  soulVersions: defineTable({
    pgId: v.string(),
    agentId: v.id("agents"),
    version: v.float64(),
    soulMd: v.string(),
    soulJson: v.any(),
    status: v.string(),
    derivedFromRunId: v.optional(v.id("runs")),
  })
    .index("by_pgId", ["pgId"])
    .index("by_agentId_version", ["agentId", "version"]),

  runs: defineTable({
    pgId: v.string(),
    agentId: v.id("agents"),
    strategyVersionId: v.id("strategyVersions"),
    tournamentId: v.optional(v.id("tournaments")),
    branchId: v.optional(v.string()),
    status: v.string(),
    runType: v.string(),
    configJson: v.any(),
    metricsJson: v.optional(v.any()),
    totalBars: v.float64(),
    processedBars: v.float64(),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_pgId", ["pgId"])
    .index("by_agentId", ["agentId"])
    .index("by_tournamentId", ["tournamentId"])
    .index("by_status", ["status"]),

  orders: defineTable({
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
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId", ["runId"])
    .index("by_runId_and_status", ["runId", "status"])
    .index("by_runId_and_clientOrderId", ["runId", "clientOrderId"]),

  fills: defineTable({
    pgId: v.string(),
    orderId: v.id("orders"),
    runId: v.id("runs"),
    fillPrice: v.float64(),
    fillQuantity: v.float64(),
    fee: v.float64(),
    slippage: v.float64(),
    filledAtSim: v.optional(v.float64()),
  })
    .index("by_pgId", ["pgId"])
    .index("by_orderId", ["orderId"])
    .index("by_runId", ["runId"]),

  positions: defineTable({
    pgId: v.string(),
    runId: v.id("runs"),
    symbol: v.string(),
    quantity: v.float64(),
    avgEntryPrice: v.float64(),
    currentPrice: v.float64(),
    unrealizedPnl: v.float64(),
    realizedPnl: v.float64(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId_symbol", ["runId", "symbol"]),

  portfolioSnapshots: defineTable({
    pgId: v.string(),
    runId: v.id("runs"),
    barIndex: v.float64(),
    timestampSimulated: v.optional(v.float64()),
    cash: v.float64(),
    equity: v.float64(),
    positionsJson: v.any(),
    drawdown: v.float64(),
    highWaterMark: v.float64(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId_barIndex", ["runId", "barIndex"]),

  agentEvents: defineTable({
    pgId: v.string(),
    runId: v.id("runs"),
    eventType: v.string(),
    payload: v.any(),
    timestampSimulated: v.optional(v.float64()),
    barIndex: v.optional(v.float64()),
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId", ["runId"]),

  checkpoints: defineTable({
    pgId: v.string(),
    runId: v.id("runs"),
    barIndex: v.float64(),
    timestampSimulated: v.optional(v.float64()),
    stateBlob: v.any(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId_barIndex", ["runId", "barIndex"]),

  branches: defineTable({
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
  })
    .index("by_pgId", ["pgId"])
    .index("by_runId", ["runId"])
    .index("by_parentRunId", ["parentRunId"]),

  tournaments: defineTable({
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
  })
    .index("by_pgId", ["pgId"])
    .index("by_projectId", ["projectId"]),

  tournamentEntries: defineTable({
    pgId: v.string(),
    tournamentId: v.id("tournaments"),
    agentId: v.id("agents"),
    runId: v.optional(v.id("runs")),
    finalRank: v.optional(v.float64()),
    status: v.string(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_agentId", ["tournamentId", "agentId"]),

  leaderboardEntries: defineTable({
    pgId: v.string(),
    tournamentId: v.id("tournaments"),
    agentId: v.id("agents"),
    runId: v.id("runs"),
    rank: v.float64(),
    totalReturn: v.optional(v.float64()),
    sharpeRatio: v.optional(v.float64()),
    sortinoRatio: v.optional(v.float64()),
    maxDrawdown: v.optional(v.float64()),
    winRate: v.optional(v.float64()),
    profitFactor: v.optional(v.float64()),
    netProfit: v.optional(v.float64()),
    totalTrades: v.optional(v.float64()),
    metricsJson: v.any(),
    computedAt: v.float64(),
  })
    .index("by_pgId", ["pgId"])
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_agentId", ["tournamentId", "agentId"]),
});
