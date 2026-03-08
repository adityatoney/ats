# Phase 3: Live Paper Trading with Schedules and Risk Gates

## Goal

Prove that agents can transition from historical backtesting to live paper trading. Agents wake on a schedule, evaluate real market data, propose trades, pass deterministic risk validation, and place paper orders through Alpaca — all under strict guardrails.

Phase 3 assumes Phases 1 and 2 are complete and stable.

---

## Milestone 3.1 — Live Market Data Adapter

### What to build

Python module: `runtime/data/live/`

- Alpaca real-time data client
  - REST: fetch latest bars, quotes, and snapshots for a symbol list
  - WebSocket: subscribe to real-time bar updates and trade streams
  - Normalize live data to the same internal schema used by the historical data loader: `(timestamp, open, high, low, close, volume, vwap)`
- Data adapter interface
  - `LiveDataAdapter` protocol with methods:
    - `get_latest_bars(symbols, timeframe) -> DataFrame`
    - `get_snapshot(symbols) -> dict[symbol, Snapshot]`
    - `subscribe(symbols, on_bar_callback)` (WebSocket mode)
    - `unsubscribe(symbols)`
  - Implementation for Alpaca
  - Interface allows future swapping to Databento/Massive without changing the agent or engine
- Market hours awareness
  - Know when the market is open, in pre-market, or closed
  - Expose `is_market_open()`, `next_market_open()`, `time_to_close()`

### How to test

- [ ] Fetch latest daily bar for AAPL via REST; returns a valid bar with today's data (during market hours) or last trading day (after hours)
- [ ] Fetch latest snapshot for SPY; returns bid, ask, last trade, volume
- [ ] Subscribe to real-time bars for AAPL on 1-minute timeframe; callback fires when new bars arrive (during market hours)
- [ ] Unsubscribe stops callbacks
- [ ] Market hours check returns correct result based on current time and US equity calendar
- [ ] Data normalization produces same schema as historical data loader
- [ ] Connection failure to Alpaca returns a clear error and does not crash the process
- [ ] Reconnection after a dropped WebSocket works automatically

---

## Milestone 3.2 — Paper Order Execution Adapter

### What to build

Python module: `runtime/broker/`

- Alpaca paper trading client
  - Place paper orders: market, limit, stop
  - Query order status
  - Cancel open orders
  - Get current positions
  - Get account balance and buying power
- Broker adapter interface
  - `PaperBrokerAdapter` protocol:
    - `submit_order(symbol, side, qty, order_type, limit_price=None, stop_price=None) -> OrderResult`
    - `get_order_status(order_id) -> OrderStatus`
    - `cancel_order(order_id) -> CancelResult`
    - `get_positions() -> list[Position]`
    - `get_account() -> AccountInfo`
  - Implementation for Alpaca paper
  - Adapter ensures all orders go to paper environment only (hard-coded paper URL, no live trading path)
- Safety constraint
  - The adapter must refuse to connect to a live/real-money endpoint
  - Environment variable or config flag must explicitly say "paper"
  - If the flag is missing or says "live", the adapter raises an error and refuses to start

### How to test

- [ ] Place a market buy order for 10 shares of AAPL; order fills in Alpaca paper
- [ ] Place a limit buy order below current price; order stays open
- [ ] Cancel the open limit order; order status becomes "cancelled"
- [ ] Query positions after a fill; shows correct position
- [ ] Query account; shows cash reduced by fill amount + fees
- [ ] Attempt to configure the adapter with a live endpoint; raises error and does not connect
- [ ] Adapter defaults to paper if no config is provided
- [ ] Submit order for a symbol that doesn't exist; returns clear error
- [ ] Network failure during order submit is handled (retry or error, no silent failure)

---

## Milestone 3.3 — Deterministic Risk Gate for Live Orders

### What to build

Python module: `runtime/risk/`

The risk gate sits between the agent's trade proposal and the broker adapter. It is deterministic and cannot be bypassed by the AI layer.

- `RiskGate` class
  - Validates every proposed order against hard rules before submission:
    - **Position size limit**: max % of portfolio in a single position
    - **Total exposure limit**: max % of portfolio invested (long + short)
    - **Per-order size limit**: max shares or max dollar value per order
    - **Daily loss limit**: if realized losses today exceed threshold, block new orders
    - **Max open positions**: cap on number of concurrent positions
    - **Symbol blacklist**: refuse to trade certain symbols
    - **Session check**: refuse orders if market is closed (unless explicitly configured for extended hours)
  - Returns `RiskDecision`: approved, rejected with reason, or modified (reduced size)
  - All decisions are logged to `agent_events` with full context
- Risk config
  - Stored in the agent's run config
  - User-configurable but agent-cannot-modify (never_editable_by_agent category)
  - Defaults are conservative
- Hard limits vs soft limits
  - Hard limits: always enforced, cannot be overridden
  - Soft limits: enforced by default, owner can relax per-agent

### How to test

- [ ] Propose an order for 100% of portfolio in one stock; risk gate reduces to max allowed %
- [ ] Propose an order when total exposure is at max; risk gate rejects
- [ ] Propose an order after daily loss limit hit; risk gate rejects
- [ ] Propose an order for a blacklisted symbol; risk gate rejects
- [ ] Propose an order when market is closed; risk gate rejects
- [ ] Propose a valid order within all limits; risk gate approves
- [ ] All risk decisions (approve, reject, modify) are logged with reasons
- [ ] Agent cannot modify risk config via tool calls or file writes
- [ ] Owner updates risk config; next order uses updated limits
- [ ] Risk gate with default config blocks obviously dangerous orders (e.g., 100% portfolio, 50 positions)

---

## Milestone 3.4 — Scheduling System

### What to build

- Schedule engine
  - Supports multiple scheduling modes per agent:
    - **Cron-based**: standard cron expressions (e.g., "every weekday at 9:45 AM ET")
    - **Interval-based**: evaluate every N minutes during market hours
    - **Market-open only**: trigger at market open, optional re-evaluation at configurable times
    - **Always-on**: continuous streaming mode with evaluation on each new bar
    - **Mixed**: cron schedule + interval re-checks during open hours
  - Timezone-aware (default: America/New_York for US equities)
  - Trading session windows: only trigger during configured hours
  - Blackout windows: skip evaluation during earnings, FOMC, or user-defined periods
- Schedule storage
  - `schedules` table: id, agent_id, mode, cron_expression, interval_minutes, timezone, session_start, session_end, blackout_windows_json, enabled, created_at
  - One active schedule per agent (update replaces previous)
- Schedule executor
  - Integrates with Temporal (or simple cron runner for MVP) to trigger agent wake-ups
  - On trigger: check if market is open, check if in blackout window, then invoke the agent's live evaluation loop
  - Log each trigger event (fired, skipped due to market closed, skipped due to blackout)

### How to test

- [ ] Create a cron schedule "weekdays at 9:45 AM ET"; agent wakes at 9:45 AM ET on next weekday
- [ ] Create an interval schedule "every 15 minutes"; agent wakes every 15 minutes during market hours
- [ ] Agent does NOT wake when market is closed (weekend, holiday)
- [ ] Agent does NOT wake during a configured blackout window
- [ ] Create an always-on schedule; agent receives continuous bar updates
- [ ] Disabling a schedule stops all future triggers
- [ ] Updating a schedule replaces the previous one
- [ ] Schedule respects timezone (9:45 AM ET, not 9:45 AM UTC)
- [ ] Trigger events are logged: "fired at 09:45:00 ET", "skipped: market closed"
- [ ] Two agents with different schedules fire at different times independently

---

## Milestone 3.5 — Live Evaluation Loop

### What to build

Python module: `runtime/live/`

The live evaluation loop is what runs when a scheduled trigger fires:

- `LiveEvaluationLoop` class
  1. Load the agent's latest approved strategy and active soul
  2. Fetch current market state from live data adapter
  3. Load current portfolio from broker adapter (positions, cash, P&L)
  4. Run the strategy's `generate_signal()` with current market state and portfolio
  5. If signal is produced, run `size_position()` to determine order size
  6. Run `risk_gate()` on the proposed order
  7. If approved: submit to broker adapter and record the order
  8. If rejected: log the rejection reason
  9. After execution: record portfolio snapshot, emit events to control plane
  10. Optionally: queue a soul update proposal (delayed, not every tick)
- Event emission
  - `LIVE_TICK_EVALUATED` — every evaluation cycle
  - `LIVE_ORDER_PROPOSED` — when signal produces an order
  - `LIVE_ORDER_SUBMITTED` — when risk gate approves and order sent to broker
  - `LIVE_ORDER_REJECTED` — when risk gate blocks the order
  - `LIVE_ORDER_FILLED` — when broker confirms fill
  - `LIVE_EVALUATION_ERROR` — when something fails
- Crash recovery
  - If the process dies, the scheduler re-triggers on next schedule tick
  - Portfolio state is read from broker (source of truth in live mode), not from local memory
  - No stale-state risk: each evaluation starts fresh from broker + market data

### How to test

- [ ] Trigger a live evaluation for an agent with a signal-producing strategy; order is proposed
- [ ] Proposed order passes risk gate; order is submitted to Alpaca paper
- [ ] Order fills; LIVE_ORDER_FILLED event is emitted
- [ ] Trigger evaluation with a strategy that produces no signal; no order, LIVE_TICK_EVALUATED logged
- [ ] Trigger evaluation when risk gate rejects; LIVE_ORDER_REJECTED with reason logged
- [ ] Portfolio snapshot after fill shows updated position and reduced cash
- [ ] Kill the process mid-evaluation; next scheduled trigger re-evaluates cleanly from broker state
- [ ] Strategy version update between evaluations; next evaluation uses the new version
- [ ] Soul update is queued (not applied) after a configurable number of evaluations
- [ ] All events are visible via the control plane API

---

## Milestone 3.6 — Live Mode UI Extensions

### What to build

Extend the frontend:

- **Live dashboard**
  - Per-agent live status: active (live), scheduled (waiting), idle, error
  - Next scheduled wake-up time
  - Last evaluation time and result summary
  - Live P&L for the current session
- **Live event feed**
  - Real-time scrolling feed of live events (WebSocket or SSE from control plane)
  - Event types color-coded: orders in blue, fills in green, rejections in red, evaluations in gray
  - Filterable by agent and event type
- **Live portfolio view**
  - Current positions with real-time prices (polling or WebSocket)
  - Cash balance and total equity
  - Unrealized P&L per position
  - Intraday equity chart
- **Schedule configuration UI**
  - Create/edit schedule for each agent
  - Mode selector (cron, interval, market-open, always-on)
  - Cron expression builder (visual picker for common patterns)
  - Timezone selector
  - Blackout window editor
  - Enable/disable toggle
- **Live trade ledger**
  - Table of all live orders and fills
  - Status column: submitted, filled, cancelled, rejected
  - Filter by date range and agent

### How to test

- [ ] Live dashboard shows agent status as "active" when live mode is running
- [ ] Next scheduled wake-up time is displayed correctly
- [ ] Live event feed updates in real-time when evaluations occur
- [ ] Events are color-coded by type
- [ ] Live portfolio view shows current positions with P&L
- [ ] Intraday equity chart updates as fills occur
- [ ] Schedule config UI saves a new cron schedule; agent starts waking on schedule
- [ ] Disabling a schedule via UI stops the agent from waking
- [ ] Live trade ledger shows all orders placed during live mode
- [ ] Filtering by agent shows only that agent's live events

---

## Milestone 3.7 — Backtest-to-Live Transition Workflow

### What to build

A guided workflow for transitioning an agent from backtesting to live paper trading:

- **Pre-flight check**
  - Agent must have at least one completed backtest
  - Agent must have an active approved soul
  - Strategy must be validated and parseable
  - Risk config must be set (or defaults applied)
  - Schedule must be configured
  - Alpaca paper credentials must be valid
- **Transition wizard (UI)**
  - Step 1: Review latest backtest results and soul
  - Step 2: Configure or confirm risk limits for live mode
  - Step 3: Configure schedule
  - Step 4: Review data adapter config (symbols, timeframe)
  - Step 5: Confirm and activate live mode
- **Risk warning**
  - Display clear disclaimer: "This is paper trading only. No real money is at risk."
  - Require user acknowledgment before activation
- **Activation**
  - Set agent mode to "live_paper"
  - Register schedule with executor
  - Begin live evaluation on next trigger

### How to test

- [ ] Agent without a completed backtest cannot activate live mode (pre-flight fails)
- [ ] Agent without a soul cannot activate live mode
- [ ] Agent with invalid Alpaca credentials cannot activate live mode
- [ ] Pre-flight check passes for a fully configured agent
- [ ] Transition wizard walks through all 5 steps
- [ ] Risk warning is displayed and requires acknowledgment
- [ ] After activation, agent status changes to "live_paper"
- [ ] First scheduled trigger fires and evaluation runs
- [ ] Deactivating live mode stops all scheduled triggers
- [ ] Re-activating live mode resumes from current broker state (not stale)

---

## Milestone 3.8 — Integration Test: End-to-End Live Paper Trading

### What to build

No new code — full integration test of milestones 3.1–3.7.

### Test scenario

1. Start all services including Alpaca paper connection
2. Use an agent that was successfully backtested in Phase 1/2
3. Walk through the backtest-to-live transition wizard:
   - Review backtest results
   - Configure risk limits: max 10% per position, max 50% total exposure, max 5 positions
   - Configure schedule: every 15 minutes during market hours
   - Confirm and activate
4. During market hours, observe the agent:
   - Wake-up on schedule (every 15 minutes)
   - Fetch current market data
   - Evaluate strategy
   - Propose trade if signal fires
   - Risk gate approves or rejects
   - Approved orders submitted to Alpaca paper
   - Fills reflected in portfolio
5. Monitor via UI:
   - Live event feed shows evaluations and orders in real-time
   - Live portfolio updates with positions and P&L
   - Live trade ledger accumulates orders
6. After multiple evaluation cycles:
   - Queue a soul update based on live performance
   - Soul update includes live trading lessons
   - Owner reviews and approves soul update
7. Outside market hours:
   - Agent does not wake (schedule respects market hours)
   - Portfolio shows end-of-day state
8. Stress tests:
   - Kill the Python runtime; next trigger restarts clean from broker state
   - Disconnect from Alpaca WebSocket; reconnection happens automatically
   - Agent proposes order exceeding risk limits; risk gate blocks it

### How to test

- [ ] Agent activates and begins live paper trading
- [ ] At least 3 evaluation cycles fire on schedule
- [ ] At least 1 order is proposed, approved, submitted, and filled
- [ ] Risk gate blocks at least 1 order that exceeds limits (simulate by lowering limits)
- [ ] UI shows live events in real-time
- [ ] Portfolio view shows accurate positions matching Alpaca paper account
- [ ] Soul update includes references to live trading data
- [ ] Agent does not fire outside market hours
- [ ] Process restart does not cause duplicate orders or stale state
- [ ] WebSocket reconnection works without manual intervention
