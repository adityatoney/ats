# Phase 1: Single-Agent Deterministic Backtester

## Goal

Prove that the deterministic simulation layer works correctly: reproducible replays, checkpointing, branching, soul generation, and a basic UI that shows what happened and why.

This phase is the foundation everything else builds on. Nothing ships until replay is bit-for-bit reproducible and the branch DAG is solid.

---

## Milestone 1.1 — Project Scaffolding and Monorepo Setup

### What to build

- Monorepo structure with workspaces:
  - `packages/web` — React + Vite + TypeScript frontend
  - `packages/server` — Node.js + TypeScript control plane
  - `packages/runtime` — Python simulation and agent runtime
  - `packages/shared` — shared TypeScript types and constants
  - `packages/db` — database schemas, migrations, seed scripts
- Dev tooling: ESLint, Prettier, Ruff (Python), pre-commit hooks
- Docker Compose for local Postgres, optional Redis
- Environment config: `.env` loading for all packages
- CI pipeline skeleton (lint + type-check + test for all packages)

### How to test

- [ ] `pnpm install` succeeds from repo root
- [ ] `pnpm lint` passes across all TS packages
- [ ] `ruff check` passes on Python package
- [ ] `docker compose up` starts Postgres and it accepts connections
- [ ] Each package has a trivial health-check test that passes
- [ ] CI runs green on a clean checkout

---

## Milestone 1.2 — Database Schema and Core Data Model

### What to build

Postgres tables for the canonical transactional store:

- `users` — id, email, created_at
- `projects` — id, owner_id, name, created_at
- `agents` — id, project_id, name, status, created_at
- `strategy_versions` — id, agent_id, version, strategy_md, strategy_py (nullable), config_json, created_at
- `soul_versions` — id, agent_id, version, soul_md, soul_json, derived_from_run_id, created_at
- `runs` — id, agent_id, strategy_version_id, status (pending/running/paused/completed/failed/cancelled), run_type (backtest), config_json (symbols, time_range, capital, slippage_model, fee_model, seed), started_at, completed_at, error_message
- `checkpoints` — id, run_id, branch_id (nullable), bar_index, timestamp_simulated, state_blob (JSONB or ref to object store), created_at
- `branches` — id, run_id, parent_checkpoint_id, parent_branch_id (nullable, self-ref), change_summary, rationale, creator_type (user/agent), status, created_at
- `orders` — id, run_id, branch_id (nullable), symbol, side, order_type, quantity, limit_price, status, submitted_at_sim, filled_at_sim
- `fills` — id, order_id, fill_price, fill_quantity, fee, slippage, filled_at_sim
- `positions` — id, run_id, branch_id (nullable), symbol, quantity, avg_entry_price, current_price, unrealized_pnl, updated_at_sim
- `portfolio_snapshots` — id, run_id, branch_id (nullable), bar_index, timestamp_simulated, cash, equity, positions_json, drawdown, created_at
- `agent_events` — id, run_id, branch_id (nullable), event_type, payload (JSONB), timestamp_simulated, created_at

Migration tooling: use Drizzle ORM or Prisma for schema management.

### How to test

- [ ] Migrations run cleanly on fresh Postgres (`pnpm db:migrate`)
- [ ] Migrations are idempotent (running twice doesn't fail)
- [ ] Seed script creates a sample project, agent, and strategy version
- [ ] Foreign key constraints are enforced (inserting orphan records fails)
- [ ] JSONB fields accept and return valid structures
- [ ] Rollback migrations work (`pnpm db:rollback`)

---

## Milestone 1.3 — Market Data Ingestion and Storage

### What to build

Python module: `runtime/data/`

- Alpaca historical data client
  - Fetch daily and intraday OHLCV bars for a symbol list and date range
  - Normalize to a standard internal schema: `(timestamp, open, high, low, close, volume, vwap)`
  - Store as Parquet files partitioned by symbol and date range
- Data catalog
  - Track which datasets have been fetched and their parameters
  - Avoid redundant downloads
- Data loader
  - Load a Parquet dataset into a Pandas/Polars DataFrame for a given symbol list and date range
  - Return bars in deterministic chronological order
  - Support multiple timeframes (1D, 1H, 15m, 5m, 1m)

### How to test

- [ ] Fetch 1 year of daily AAPL data from Alpaca; file is written to `data/` directory
- [ ] Re-running the same fetch does not re-download (cache hit)
- [ ] Load the fetched data; DataFrame has correct columns and no gaps on trading days
- [ ] Fetch intraday (5m) data for 1 month; bars are in chronological order
- [ ] Fetching a symbol that doesn't exist returns a clear error, not a crash
- [ ] Two fetches of the same data produce identical Parquet files (determinism)

---

## Milestone 1.4 — Deterministic Simulation Engine (Core Loop)

### What to build

Python module: `runtime/simulator/`

This is the most important component. It must be fully deterministic.

- `Engine` class
  - Accepts: strategy config, dataset, starting capital, fee model, slippage model, random seed
  - Steps through bars one at a time
  - At each bar:
    1. Update market state (current prices)
    2. Process pending orders (fill simulation)
    3. Update positions and portfolio
    4. Call strategy hooks (`generate_signal`, `risk_gate`, `size_position`)
    5. Submit new orders if signal passes risk gate
    6. Record portfolio snapshot
    7. Emit events
  - At configurable intervals: create checkpoints
- `FillModel`
  - Simple: fill at close price ± configurable slippage
  - Market orders fill next bar open
  - Limit orders fill if price crosses limit
- `FeeModel`
  - Configurable per-share or percentage fee
- `PortfolioState`
  - Cash, positions (symbol → quantity, avg entry), equity curve
  - Realized and unrealized PnL tracking
- Strategy interface (Python protocol):
  - `prepare_features(df: DataFrame) -> DataFrame`
  - `generate_signal(state: MarketState, portfolio: PortfolioState) -> SignalProposal | None`
  - `size_position(portfolio: PortfolioState, signal: SignalProposal) -> SizeDecision`
  - `risk_gate(order: ProposedOrder, portfolio: PortfolioState, market: MarketState) -> RiskDecision`
- Determinism contract:
  - Same inputs → identical outputs
  - No network calls during simulation
  - No system clock references (use simulated time)
  - Seeded RNG where randomness is needed

### How to test

- [ ] Run engine on 1 year of AAPL daily data with a trivial "buy and hold" strategy; final equity matches manual calculation
- [ ] Run the same backtest twice; every order, fill, and portfolio snapshot is identical
- [ ] Run with a "buy on Monday, sell on Friday" strategy; orders appear on correct days
- [ ] Fee model subtracts correct amount from cash on each fill
- [ ] Slippage model shifts fill price in expected direction
- [ ] Limit order that never triggers does not fill
- [ ] Market order fills at next bar open
- [ ] Short selling tracks negative positions correctly
- [ ] A strategy that does nothing produces flat equity and zero orders
- [ ] Engine emits structured events for each step (bar processed, order submitted, order filled, snapshot created)

---

## Milestone 1.5 — Checkpointing and Resume

### What to build

Extension to the engine:

- Checkpoint serialization
  - Serialize full engine state to a JSON-compatible blob: portfolio, pending orders, current bar index, RNG state, feature cache
  - Write to `checkpoints` table with run_id and bar_index
  - Configurable checkpoint interval (every N bars, or every N simulated days)
- Checkpoint restore
  - Load a checkpoint blob and reconstruct engine state exactly
  - Resume simulation from that bar index forward
  - Produce identical results as if the run had never been interrupted
- Pause / resume / cancel
  - Engine supports a `pause()` call that writes a checkpoint and stops
  - `resume(checkpoint_id)` restores and continues
  - `cancel()` writes a final checkpoint and marks run as cancelled

### How to test

- [ ] Run a 1-year backtest, checkpoint every 50 bars; verify N checkpoints written
- [ ] Run same backtest to completion without interruption (run A)
- [ ] Run same backtest, pause at bar 100, resume from checkpoint; final result identical to run A
- [ ] Pause at bar 50, resume, pause at bar 150, resume to end; final result identical to run A
- [ ] Cancel at bar 200; run status is "cancelled", checkpoint at bar 200 exists
- [ ] Resume a cancelled run from its last checkpoint; continues correctly
- [ ] Corrupted checkpoint blob returns a clear error on restore attempt

---

## Milestone 1.6 — Branching and Branch DAG

### What to build

- Branch manager module
  - `fork(checkpoint_id, change_description, changed_config)` → creates a new branch record and new run
  - The forked run starts from the checkpoint state but applies a parameter override (e.g., different threshold, different exit logic, different strategy version)
  - Branch records link to parent checkpoint and parent branch
- Parameter overrides
  - Support `strategy_overrides.json` that can modify strategy parameters at fork time
  - Override examples: entry threshold, exit multiplier, position size cap, stop-loss distance
- Branch DAG queries
  - Given a run, return its full branch lineage (ancestors and descendants)
  - Return branch tree as adjacency list for visualization
- Result deltas
  - After a branch run completes, compute delta metrics vs parent: Sharpe delta, total return delta, max drawdown delta, win rate delta

### How to test

- [ ] Run a backtest to completion; fork from checkpoint at bar 100 with a different entry threshold
- [ ] Forked run starts at bar 100 and runs to the end; its results differ from the parent
- [ ] Branch record correctly links to parent checkpoint and parent run
- [ ] Fork a branch from another branch (depth 2); DAG query returns correct 3-level tree
- [ ] Result delta correctly shows the performance difference between parent and child
- [ ] Cannot fork from a checkpoint that doesn't exist (error returned)
- [ ] Branch tree serialization matches expected adjacency list format
- [ ] Forking does not mutate the parent run's data

---

## Milestone 1.7 — Strategy Loading from Markdown + Python

### What to build

- Strategy parser module
  - Parse `strategy.md` into structured sections: objective, universe, entry criteria, exit criteria, risk rules, sizing, session preferences, reflection instructions
  - Convert parsed sections into a strategy config object
  - Validate required sections are present
- Strategy Python loader
  - If `strategy.py` is provided, dynamically load it and verify it exports the required interface functions
  - If not provided, use the AI layer to interpret `strategy.md` into trading decisions (later milestone — for now, require `strategy.py`)
- Strategy version management
  - On each edit, create a new `strategy_versions` record
  - Runs always reference a specific strategy version (immutable after run starts)

### How to test

- [ ] Parse a sample `strategy.md` with all sections; output config has all fields populated
- [ ] Parse a `strategy.md` missing a required section; returns a validation error
- [ ] Load a `strategy.py` that exports `generate_signal` and `risk_gate`; functions are callable
- [ ] Load a `strategy.py` missing a required function; returns a clear error
- [ ] Create two strategy versions for the same agent; both are retrievable
- [ ] A run references strategy version 1; editing the strategy creates version 2 but the run still uses version 1

---

## Milestone 1.8 — Soul Generation After Backtest

### What to build

- Soul generator module (uses LLM)
  - After a run completes, gather:
    - Full trade ledger (orders + fills)
    - Portfolio equity curve
    - Key metrics (Sharpe, max drawdown, win rate, profit factor)
    - Worst trades and best trades
    - Branch result deltas (if branches exist)
  - Send structured summary to Claude via LiteLLM
  - Prompt asks the model to generate:
    - `soul.md` — narrative identity, beliefs, lessons, failure modes, evidence links
    - `soul.json` — structured beliefs, anti-patterns, regime preferences, confidence boundaries, playbooks, evidence refs
- Soul versioning
  - Each generation creates a new `soul_versions` record
  - `derived_from_run_id` links back to the run
  - Soul diffs between versions are computable
- Soul is proposal-only for now
  - Generated soul is stored as "pending" until user reviews (simple approve/reject, no full approval workflow yet)

### How to test

- [ ] After a completed backtest run, trigger soul generation; `soul.md` and `soul.json` are produced
- [ ] Soul references specific trades and metrics from the run (evidence links)
- [ ] Soul JSON has all required fields from the schema
- [ ] Generating a soul for a second run creates version 2; both versions exist
- [ ] Soul diff between version 1 and 2 shows meaningful changes
- [ ] Soul generation with a failed/empty run returns a graceful error or minimal soul
- [ ] Generated soul is stored with status "pending" (not auto-applied)
- [ ] Approving a pending soul changes its status to "active"

---

## Milestone 1.9 — Node.js Control Plane (API Layer)

### What to build

REST API server in `packages/server`:

- Auth (simplified for MVP): API key or session-based
- Endpoints:
  - `POST /projects` — create project
  - `GET /projects/:id` — get project with agents
  - `POST /projects/:projectId/agents` — create agent
  - `GET /agents/:id` — get agent with latest strategy and soul
  - `PUT /agents/:id/strategy` — update strategy (creates new version)
  - `POST /agents/:agentId/runs` — start a backtest run
  - `GET /runs/:id` — get run with status, metrics, events
  - `GET /runs/:id/events` — paginated event stream
  - `GET /runs/:id/orders` — trade ledger
  - `GET /runs/:id/portfolio` — portfolio snapshots
  - `GET /runs/:id/checkpoints` — list checkpoints
  - `POST /runs/:id/pause` — pause a running backtest
  - `POST /runs/:id/resume` — resume from last checkpoint
  - `POST /runs/:id/cancel` — cancel a running backtest
  - `POST /checkpoints/:id/branch` — fork a branch from a checkpoint
  - `GET /runs/:id/branches` — get branch tree
  - `GET /agents/:id/soul` — get latest active soul
  - `GET /agents/:id/soul/versions` — list soul versions
  - `POST /agents/:id/soul/:versionId/approve` — approve a pending soul
- Communication with Python runtime:
  - HTTP or message queue to trigger runs on Python workers
  - Status updates from Python → Node via webhook callbacks or polling

### How to test

- [ ] Create a project via API; returns project with ID
- [ ] Create an agent within a project; returns agent with ID
- [ ] Upload a strategy.md to an agent; strategy version is created
- [ ] Start a backtest run; returns run ID with "pending" status
- [ ] Poll run status; transitions from pending → running → completed
- [ ] Get events for a completed run; events are in chronological order
- [ ] Get orders for a completed run; matches what the engine produced
- [ ] Pause a running backtest; status becomes "paused"
- [ ] Resume a paused backtest; status becomes "running" again
- [ ] Fork a branch from a checkpoint; returns new branch and run ID
- [ ] Get branch tree; returns correct DAG structure
- [ ] Approve a soul version; status changes to "active"
- [ ] Invalid requests return proper error codes (400, 404, etc.)

---

## Milestone 1.10 — Basic Web UI

### What to build

React + Vite frontend in `packages/web`:

- **Dashboard page**
  - List of agents in the current project
  - Agent status (idle, backtesting, completed)
  - Quick-start a backtest from dashboard
- **Agent detail page**
  - Strategy editor (Markdown editor with preview)
  - Soul viewer (current active soul, version history, diffs between versions)
  - Run history list
- **Run detail page**
  - Run status and progress indicator
  - Equity curve chart (line chart of portfolio value over time)
  - Key metrics cards: total return, Sharpe ratio, max drawdown, win rate, profit factor
  - Trade ledger table (orders + fills, sortable, filterable)
  - Event timeline (scrollable list of agent events)
  - Pause / resume / cancel controls
- **Branch tree page**
  - DAG visualization of branches for a run (simple tree layout)
  - Click a branch node to see its run detail
  - Branch comparison: side-by-side metrics between parent and child
- **Backtest configuration form**
  - Symbol selection (text input, comma-separated for MVP)
  - Date range picker
  - Starting capital input
  - Timeframe selector (1D, 1H, 15m, 5m)
  - Fee and slippage model selection
  - Start button

### How to test

- [ ] Dashboard loads and shows agents for the current project
- [ ] Creating a new agent from the UI works and agent appears in the list
- [ ] Editing strategy.md in the editor saves a new version
- [ ] Starting a backtest from the config form triggers a run
- [ ] Run detail page shows live progress (status updates)
- [ ] Equity curve renders correctly after a completed run
- [ ] Metrics cards show correct values matching the API response
- [ ] Trade ledger shows all orders and fills
- [ ] Branch tree renders a DAG with correct parent-child relationships
- [ ] Clicking a branch node navigates to its run detail
- [ ] Branch comparison shows delta metrics
- [ ] Soul viewer shows the current soul and version history
- [ ] Pause/resume/cancel buttons work and update the UI

---

## Milestone 1.11 — Integration Test: End-to-End Single-Agent Backtest

### What to build

No new code — this is a full integration test of milestones 1.1–1.10 working together.

### Test scenario

1. Start all services (Postgres, Node server, Python runtime, React frontend)
2. Via the UI:
   - Create a project called "Test Lab"
   - Create an agent called "Momentum Alpha"
   - Write a `strategy.md` describing a simple momentum strategy
   - Provide a `strategy.py` with moving-average crossover logic
   - Configure a backtest: AAPL + MSFT, 2022-01-01 to 2023-01-01, daily, $100K capital
   - Start the backtest
3. Watch the run execute:
   - Status transitions: pending → running → completed
   - Events stream into the UI
   - Equity curve builds up over time
4. After completion:
   - Review trade ledger — orders and fills look correct
   - Review metrics — Sharpe, drawdown, return calculated
   - Review portfolio snapshots — cash + positions = equity at each bar
5. Trigger soul generation:
   - Soul.md and soul.json are produced
   - Soul references actual trades from the run
   - Approve the soul
6. Fork a branch:
   - Pick a checkpoint midway through the run
   - Fork with a different moving-average window
   - Branch run completes
   - Branch tree shows parent and child
   - Result delta shows how the change affected returns
7. Reproducibility check:
   - Run the exact same backtest again
   - Every order, fill, and snapshot is identical to the first run

### How to test

- [ ] All 7 steps above complete without errors
- [ ] The UI correctly reflects every state transition
- [ ] Reproducibility check passes: two runs produce byte-identical results
- [ ] Branch result delta is non-zero (the parameter change had an effect)
- [ ] Soul contains evidence linked to the actual run
- [ ] No data leaks between the branch and the parent (branch didn't modify parent data)
