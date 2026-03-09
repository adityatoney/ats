import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(import.meta.dirname, '../../../.env') });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from './schema/users';
import { projects } from './schema/projects';
import { agents } from './schema/agents';
import { strategyVersions } from './schema/strategy-versions';

const SAMPLE_STRATEGY_MD = `# Moving Average Crossover Strategy

## Objective
Capture medium-term trends using dual moving average crossover signals.

## Universe
AAPL, MSFT

## Entry Criteria
- Buy when 20-day SMA crosses above 50-day SMA
- Confirm with volume > 1.5x 20-day average volume

## Exit Criteria
- Sell when 20-day SMA crosses below 50-day SMA
- Stop loss at 5% below entry price

## Risk Rules
- Maximum position size: 50% of portfolio per symbol
- Maximum total exposure: 100% of portfolio
- No new positions if drawdown exceeds 10%

## Sizing Doctrine
- Equal weight across signals
- Scale position by signal confidence
`;

const SAMPLE_STRATEGY_PY = `import polars as pl


def prepare_features(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns([
        pl.col("close").rolling_mean(20).alias("sma_20"),
        pl.col("close").rolling_mean(50).alias("sma_50"),
        pl.col("volume").rolling_mean(20).alias("vol_avg_20"),
    ])


def generate_signal(state, portfolio):
    bar = state.current_bar
    if bar["sma_20"] is None or bar["sma_50"] is None:
        return None

    if bar["sma_20"] > bar["sma_50"]:
        if state.bar_index > 0:
            prev = state.history[state.bar_index - 1]
            if prev["sma_20"] is not None and prev["sma_50"] is not None and prev["sma_20"] <= prev["sma_50"]:
                return {
                    "action": "buy",
                    "symbol": state.symbol,
                    "confidence": 0.7,
                    "reason": "SMA crossover bullish",
                }

    if bar["sma_20"] < bar["sma_50"]:
        if state.bar_index > 0:
            prev = state.history[state.bar_index - 1]
            if prev["sma_20"] is not None and prev["sma_50"] is not None and prev["sma_20"] >= prev["sma_50"]:
                return {
                    "action": "sell",
                    "symbol": state.symbol,
                    "confidence": 0.7,
                    "reason": "SMA crossover bearish",
                }

    return None


def size_position(portfolio, signal):
    if signal is None:
        return {"side": "", "quantity": 0}
    action = signal.get("action", "")
    symbol = signal.get("symbol", "")
    price = signal.get("price", 0)
    if price <= 0:
        return {"side": "", "quantity": 0}

    # Check current position for this symbol
    pos = portfolio.positions.get(symbol)
    current_qty = pos.quantity if pos else 0

    if action == "buy":
        # Buy 50% of equity worth, minus what we already hold
        target_qty = int(portfolio.equity * 0.5 / price)
        buy_qty = max(0, target_qty - max(0, current_qty))
        if buy_qty > 0:
            return {"side": "buy", "quantity": buy_qty}

    elif action == "sell":
        # Close entire long position
        if current_qty > 0:
            return {"side": "sell", "quantity": int(current_qty)}

    return {"side": "", "quantity": 0}


## === RISK CONFIGURATION ===
# "initial_capital" = drawdown measured from starting capital (resets never)
# "high_water_mark" = drawdown measured from peak equity (ratchets up)
DRAWDOWN_METHOD = "initial_capital"
MAX_DRAWDOWN_PCT = 0.25  # Block new entries when drawdown exceeds 25%


def risk_gate(order, portfolio, market):
    # Always allow closing positions (sell when long)
    if order.get("side") == "sell":
        symbol = order.get("symbol", "")
        pos = portfolio.positions.get(symbol)
        if pos and pos.quantity > 0:
            return {"approved": True, "reason": ""}

    # Calculate drawdown based on configured method
    if DRAWDOWN_METHOD == "high_water_mark":
        drawdown = portfolio.drawdown  # (HWM - equity) / HWM
    else:
        initial = portfolio.initial_capital
        drawdown = (initial - portfolio.equity) / initial if initial > 0 else 0

    if drawdown > MAX_DRAWDOWN_PCT:
        return {"approved": False, "reason": f"Drawdown {drawdown*100:.1f}% exceeds {MAX_DRAWDOWN_PCT*100:.0f}% limit ({DRAWDOWN_METHOD})"}

    return {"approved": True, "reason": ""}
`;

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = postgres(url);
  const db = drizzle(client);

  console.log('Seeding database...');

  const [user] = await db
    .insert(users)
    .values({
      email: 'trader@aegis.local',
      name: 'Default Trader',
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    console.log('User already exists, skipping seed.');
    await client.end();
    return;
  }

  const [project] = await db
    .insert(projects)
    .values({
      ownerId: user.id,
      name: 'Default Project',
      description: 'Initial research project',
    })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({
      projectId: project.id,
      name: 'MA Crossover Agent',
      status: 'idle',
    })
    .returning();

  await db.insert(strategyVersions).values({
    agentId: agent.id,
    version: 1,
    strategyMd: SAMPLE_STRATEGY_MD,
    strategyPy: SAMPLE_STRATEGY_PY,
    configJson: {
      sma_fast: 20,
      sma_slow: 50,
      volume_multiplier: 1.5,
      max_position_pct: 0.5,
      max_drawdown: 0.1,
      stop_loss_pct: 0.05,
    },
  });

  console.log('Seed complete!');
  console.log(`  User: ${user.id}`);
  console.log(`  Project: ${project.id}`);
  console.log(`  Agent: ${agent.id}`);

  await client.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
