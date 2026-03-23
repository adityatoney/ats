import { mutation } from "./_generated/server";

export const seedDatabase = mutation({
  handler: async (ctx) => {
    // Check if already seeded
    const existingUsers = await ctx.db.query("users").collect();
    if (existingUsers.length > 0) {
      return { message: "Database already seeded", seeded: false };
    }

    // Create default user
    const userId = await ctx.db.insert("users", {
      pgId: "seed-user",
      email: "trader@aegis.local",
      name: "Default Trader",
    });

    // Create default project
    const projectId = await ctx.db.insert("projects", {
      pgId: "seed-project",
      ownerId: userId,
      name: "Default Project",
    });

    // Create MA Crossover Agent
    const maCrossoverId = await ctx.db.insert("agents", {
      pgId: "seed-agent-ma",
      projectId,
      name: "MA Crossover Agent",
      status: "idle",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("strategyVersions", {
      pgId: "seed-sv-ma",
      agentId: maCrossoverId,
      version: 1,
      sourceKind: "legacy_python",
      strategyMd: "SMA crossover strategy: buy when fast SMA crosses above slow SMA, sell when it crosses below.",
      strategyPy: `def init(ctx):\n    ctx.sma_fast = ctx.param("sma_fast", 20)\n    ctx.sma_slow = ctx.param("sma_slow", 50)\n\ndef on_bar(ctx, bar):\n    fast = ctx.indicator("sma", bar.close, ctx.sma_fast)\n    slow = ctx.indicator("sma", bar.close, ctx.sma_slow)\n    if fast > slow and not ctx.position:\n        ctx.buy(bar.symbol, quantity=100)\n    elif fast < slow and ctx.position:\n        ctx.sell(bar.symbol, quantity=100)\n`,
      configJson: {
        sma_fast: 20,
        sma_slow: 50,
        volume_multiplier: 1.5,
        max_position_pct: 0.5,
        max_drawdown: 0.1,
        stop_loss_pct: 0.05,
        symbols: ["AAPL", "MSFT"],
      },
    });

    // Create Mean Reverter Agent
    const meanReverterId = await ctx.db.insert("agents", {
      pgId: "seed-agent-mr",
      projectId,
      name: "Mean Reverter",
      status: "idle",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("strategyVersions", {
      pgId: "seed-sv-mr",
      agentId: meanReverterId,
      version: 1,
      sourceKind: "legacy_python",
      strategyMd: "RSI mean reversion: buy when RSI < oversold threshold, sell when RSI > overbought threshold.",
      strategyPy: `def init(ctx):\n    ctx.rsi_period = ctx.param("rsi_period", 14)\n    ctx.oversold = ctx.param("oversold", 30)\n    ctx.overbought = ctx.param("overbought", 70)\n\ndef on_bar(ctx, bar):\n    rsi = ctx.indicator("rsi", bar.close, ctx.rsi_period)\n    if rsi < ctx.oversold and not ctx.position:\n        ctx.buy(bar.symbol, quantity=100)\n    elif rsi > ctx.overbought and ctx.position:\n        ctx.sell(bar.symbol, quantity=100)\n`,
      configJson: {
        rsi_period: 14,
        oversold: 30,
        overbought: 70,
        symbols: ["AAPL", "MSFT"],
      },
    });

    // Create Buy & Hold Agent
    const buyHoldId = await ctx.db.insert("agents", {
      pgId: "seed-agent-bh",
      projectId,
      name: "Buy & Hold",
      status: "idle",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("strategyVersions", {
      pgId: "seed-sv-bh",
      agentId: buyHoldId,
      version: 1,
      sourceKind: "legacy_python",
      strategyMd: "Buy on bar 0, hold forever.",
      strategyPy: `def init(ctx):\n    ctx.bought = False\n\ndef on_bar(ctx, bar):\n    if not ctx.bought:\n        ctx.buy(bar.symbol, quantity=100)\n        ctx.bought = True\n`,
      configJson: { symbols: ["AAPL", "MSFT"] },
    });

    // Create Deterministic MA Crossover Agent
    const detMaId = await ctx.db.insert("agents", {
      pgId: "seed-agent-det-ma",
      projectId,
      name: "Deterministic MA Crossover",
      status: "idle",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("strategyVersions", {
      pgId: "seed-sv-det-ma",
      agentId: detMaId,
      version: 1,
      sourceKind: "pine",
      strategyPine: `//@version=5\nstrategy("MA Crossover", overlay=true)\nfast = ta.sma(close, 20)\nslow = ta.sma(close, 50)\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.close("Long")\n`,
      configJson: { symbols: ["AAPL", "MSFT"] },
    });

    return {
      message: "Database seeded successfully",
      seeded: true,
      userId,
      projectId,
      agents: [maCrossoverId, meanReverterId, buyHoldId, detMaId],
    };
  },
});
