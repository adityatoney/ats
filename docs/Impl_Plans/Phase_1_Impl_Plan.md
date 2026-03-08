# Phase 1 Implementation Plan: Single-Agent Deterministic Backtester

## Context

AegisTrader is a greenfield AI-powered paper trading research platform. The repo currently has zero code — only docs (PRD, concept, phase plans) and an `.env` with Alpaca credentials. Phase 1 builds the foundation: a deterministic simulation engine, checkpointing, branching, soul generation, a Node.js API layer, and a basic React UI. Everything downstream (multi-agent competition, live trading, governance) depends on this being solid.

The core architectural principle: **the deterministic engine owns truth; the AI layer only proposes/reflects.**

---

## Tech Stack Decisions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Monorepo | pnpm workspaces + Turborepo | Fast, workspace protocol, task caching |
| Node.js server | **Hono** | Lighter than Express, first-class TS, built-in SSE |
| ORM | **Drizzle** | Better TS types, SQL-like, lighter than Prisma |
| Database | PostgreSQL 16 (Docker) | Canonical transactional store |
| Frontend | React + Vite + TypeScript + TailwindCSS + shadcn/ui | Modern, fast DX |
| Charts | **TradingView Lightweight Charts** | Purpose-built for financial data |
| Branch DAG viz | **React Flow** (@xyflow/react) + dagre layout | Best React DAG library |
| Python runtime | **FastAPI** + **uv** for project management | Modern async, uv already installed |
| DataFrames | **Polars** | Faster than Pandas, better typed |
| Market data storage | Parquet files in local `data/` dir | Efficient, deterministic |
| Testing | Vitest (TS), pytest (Python) | Fast, modern |
| Realtime | SSE from Hono → browser EventSource | Simpler than WebSocket for one-way streaming |
| Node↔Python | HTTP REST (Node calls Python; Python webhooks back to Node) | Simplest for MVP |
| LLM | Anthropic SDK directly (defer LiteLLM to Phase 2+) | Minimal dependencies |
| Auth | Skip for Phase 1 (single-user local) | Defer to Phase 2+ |
| Workflow orchestration | Simple FastAPI BackgroundTasks (defer Temporal to Phase 3) | Good enough for local |

---

## Monorepo Structure

```
ats/
  package.json                    # root scripts, devDependencies
  pnpm-workspace.yaml             # packages: ["packages/*"]
  turbo.json                      # build/lint/test/dev pipeline
  tsconfig.base.json              # shared TS config
  docker-compose.yml              # Postgres 16
  .env                            # existing (Alpaca keys) + DATABASE_URL, ANTHROPIC_API_KEY
  data/                           # Parquet files (gitignored)
  docs/                           # existing
  packages/
    shared/                       # @aegis/shared — TS types + constants
      src/types/                  # agent.ts, run.ts, branch.ts, order.ts, portfolio.ts, soul.ts, events.ts, api.ts
      src/constants/              # event-types.ts, run-status.ts, order-status.ts
    db/                           # @aegis/db — Drizzle schema + migrations
      src/schema/                 # users.ts, projects.ts, agents.ts, strategy-versions.ts, ...
      src/seed.ts
      drizzle.config.ts
    server/                       # @aegis/server — Hono control plane
      src/routes/                 # projects.ts, agents.ts, runs.ts, checkpoints.ts, branches.ts, souls.ts, events-sse.ts
      src/services/               # run-manager.ts, event-bus.ts, branch-service.ts
      src/lib/                    # python-client.ts, db.ts
    web/                          # @aegis/web — React + Vite frontend
      src/components/             # dashboard/, agent/, run/, branch/, backtest/, ui/
      src/hooks/                  # useSSE.ts, useRun.ts, useAgent.ts
      src/lib/                    # api-client.ts
    runtime/                      # Python simulation engine
      pyproject.toml              # uv-managed, deps: fastapi, uvicorn, polars, alpaca-py, anthropic, psycopg, pydantic
      src/aegis_runtime/
        api/routes/               # runs.py, health.py
        data/                     # alpaca_client.py, data_catalog.py, data_loader.py, schemas.py
        simulator/                # engine.py, fill_model.py, fee_model.py, portfolio.py, market_state.py, types.py
        strategy/                 # parser.py, loader.py, protocol.py, validator.py
        checkpoint/               # serializer.py, manager.py
        branch/                   # manager.py, dag.py, delta.py
        soul/                     # generator.py, prompts.py, schemas.py
        db/                       # connection.py, repositories.py
      tests/
        fixtures/                 # sample_strategy.md, sample_strategy.py, sample_bars.parquet
```

---

## Milestones (Build Order)

### Milestone 1.1 — Project Scaffolding

**Create:**
- Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `docker-compose.yml` (Postgres 16 on port 5432, user: aegis, db: aegis_trader)
- `.prettierrc`, `.eslintrc.cjs`, `.gitignore` additions (node_modules, dist, data/, *.parquet, __pycache__, .venv)
- Each package: `package.json`, `tsconfig.json`, placeholder health endpoint
- Python: `pyproject.toml` with all deps, `src/aegis_runtime/api/app.py` with `/health`
- Web: Vite scaffold with TailwindCSS + shadcn/ui init, proxy `/api` → `localhost:3001`

**Root scripts:**
- `pnpm dev:server` / `pnpm dev:web` / `pnpm dev:runtime`
- `pnpm lint` / `pnpm lint:py` / `pnpm test` / `pnpm test:py`
- `pnpm docker:up` / `pnpm docker:down`
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed`

**Verify:**
- `pnpm install` succeeds
- `pnpm lint` + `ruff check` pass
- `docker compose up -d` starts Postgres (accepts connections)
- All 3 services start and `/health` responds OK
- Trivial test in each package passes

---

### Milestone 1.2 — Database Schema

**Drizzle tables in `packages/db/src/schema/`:**

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `users` | id (uuid), email, name, created_at | |
| `projects` | id, owner_id→users, name, description | |
| `agents` | id, project_id→projects, name, status (enum: idle/backtesting/paused/completed/failed/cancelled) | |
| `strategy_versions` | id, agent_id→agents, version (int), strategy_md, strategy_py?, config_json (jsonb) | unique(agent_id, version) |
| `soul_versions` | id, agent_id→agents, version, soul_md, soul_json (jsonb), status (pending/active/rejected/superseded), derived_from_run_id | unique(agent_id, version) |
| `runs` | id, agent_id→agents, strategy_version_id→strategy_versions, branch_id?, status (enum), run_type (backtest/branch), config_json, metrics_json, total_bars, processed_bars, started_at, completed_at, error_message | |
| `checkpoints` | id, run_id→runs, bar_index, timestamp_simulated, state_blob (jsonb) | index(run_id, bar_index) |
| `branches` | id, run_id→runs (the NEW run), parent_checkpoint_id→checkpoints, parent_branch_id? (self-ref), parent_run_id→runs, change_summary, rationale, creator_type (user/agent), overrides_json, result_delta_json, status | |
| `orders` | id, run_id→runs, symbol, side (buy/sell), order_type (market/limit/stop), quantity, limit_price?, stop_price?, status, submitted_at_sim, filled_at_sim, bar_index | index(run_id) |
| `fills` | id, order_id→orders, run_id→runs, fill_price, fill_quantity, fee, slippage, filled_at_sim | |
| `positions` | id, run_id→runs, symbol, quantity, avg_entry_price, current_price, unrealized_pnl, realized_pnl | unique(run_id, symbol) |
| `portfolio_snapshots` | id, run_id→runs, bar_index, timestamp_simulated, cash, equity, positions_json, drawdown, high_water_mark | index(run_id, bar_index) |
| `agent_events` | id, run_id→runs, event_type, payload (jsonb), timestamp_simulated, bar_index | index(run_id, created_at) |

**Seed script:** Creates 1 user, 1 project, 1 agent, 1 strategy version.

**Verify:**
- `pnpm db:generate` + `pnpm db:migrate` runs clean
- Running twice is idempotent
- Seed creates sample data
- FK constraints enforced (orphan insert fails)
- JSONB read/write works
- Rollback works

---

### Milestone 1.3 — Market Data Ingestion (Python)

**Files:** `packages/runtime/src/aegis_runtime/data/`

- **`alpaca_client.py`** — `AlpacaHistoricalClient.fetch_bars(symbols, start, end, timeframe)` → dict[symbol, pl.DataFrame]. Uses alpaca-py. Normalizes to internal schema: `(timestamp, open, high, low, close, volume, vwap)`. Retries with backoff for rate limits.
- **`data_catalog.py`** — `DataCatalog` tracks fetched datasets via `data/manifest.json`. Methods: `has_dataset()`, `register_dataset()`, `get_dataset_path()`. Prevents redundant downloads.
- **`data_loader.py`** — `DataLoader.load(symbols, start, end, timeframe)` → dict[symbol, DataFrame]. `load_merged()` for multi-symbol unified timeline. Loads from Parquet. Raises `DataNotFoundError` if not fetched.

**Storage:** `data/{SYMBOL}/{timeframe}_{start}_{end}.parquet`

**Verify:**
- Fetch 1yr AAPL daily from Alpaca → Parquet written
- Re-fetch = cache hit (no HTTP call)
- Load → DataFrame has correct columns, no gaps on trading days
- Intraday bars sorted chronologically
- Two fetches produce identical Parquet (determinism)

**Tests:** `tests/test_data_ingestion.py` — unit tests use fixture Parquet, integration tests (tagged `@pytest.mark.integration`) hit Alpaca API.

---

### Milestone 1.7 — Strategy Loading (Python) [parallel with 1.3]

**Files:** `packages/runtime/src/aegis_runtime/strategy/`

- **`protocol.py`** — `StrategyProtocol` with methods:
  - `prepare_features(df: pl.DataFrame) -> pl.DataFrame`
  - `generate_signal(state: MarketState, portfolio: PortfolioState) -> SignalProposal | None`
  - `size_position(portfolio: PortfolioState, signal: SignalProposal) -> SizeDecision`
  - `risk_gate(order: ProposedOrder, portfolio: PortfolioState, market: MarketState) -> RiskDecision`
- **`parser.py`** — `StrategyMarkdownParser.parse(markdown) -> ParsedStrategy`. Parses H2 sections. Required: objective, universe, entry_criteria, exit_criteria, risk_rules, sizing_doctrine. Raises `StrategyValidationError` if missing.
- **`loader.py`** — `StrategyLoader.load_from_python(source)` dynamically loads strategy.py via `exec()` into isolated module. Validates required functions exist. Returns `StrategyModuleAdapter` implementing protocol.
- **`validator.py`** — Static checks: blocks `import requests/urllib/socket/os/sys/subprocess`, blocks `datetime.now()/time.time()`.

**Verify:**
- Parse complete strategy.md → all fields populated
- Parse missing required section → StrategyValidationError
- Load strategy.py with required functions → callable
- Load strategy.py missing generate_signal → StrategyLoadError
- Validator catches forbidden imports

---

### Milestone 1.4 — Deterministic Simulation Engine (Python) [CRITICAL]

**Files:** `packages/runtime/src/aegis_runtime/simulator/`

- **`types.py`** — `Side`, `OrderType`, `OrderStatus` enums; `SignalProposal`, `SizeDecision`, `RiskDecision`, `ProposedOrder`, `SimulatedFill` dataclasses
- **`market_state.py`** — `MarketState(current_bar, bar_index, timestamp, history)`
- **`portfolio.py`** — `Position(symbol, quantity, avg_entry_price, current_price)` with `.market_value`, `.unrealized_pnl` properties. `PortfolioState(cash, positions, realized_pnl, high_water_mark)` with `.equity`, `.drawdown`, `.update_prices()`
- **`fill_model.py`** — `FillModel(slippage_bps)`. Market orders fill at next bar open ± slippage. Limit buy fills if bar low ≤ limit_price. Limit sell fills if bar high ≥ limit_price.
- **`fee_model.py`** — `FeeModel(per_share, percentage)`. `compute_fee(quantity, price)` = max(per_share × qty, percentage × qty × price).
- **`engine.py`** — `Engine(config, data, strategy)`:
  - `run(run_id, from_bar=0) -> EngineResult` — Main loop
  - Per bar: update prices → process pending orders (fills) → build MarketState → call strategy hooks (generate_signal → size_position → risk_gate) → submit orders → record snapshot → maybe checkpoint
  - `pause()`, `cancel()` — Signal flags
  - `get_state() -> dict` — Serialize for checkpointing
  - `Engine.from_state(state, data, strategy)` — Restore from checkpoint
  - Determinism: no network calls, no system clock, seeded `random.Random(seed)`, same inputs → identical outputs

**Verify:**
- Buy-and-hold 1yr AAPL: final equity matches manual calc (within 0.01%)
- Two identical runs produce byte-identical orders/fills/snapshots
- Buy Mon/sell Fri: orders on correct weekdays
- Fee: 100 shares × $150, $0.01/share = $1.00
- Slippage: 5bps on $150 = $0.075 shift
- Limit order at $140 when trading at $150 → never fills
- Market order fills at next bar open
- Short position has negative quantity
- Do-nothing strategy → flat equity, zero orders
- Engine emits events per step

**Risks:** Floating-point determinism (use `round(value, 8)`). Multi-symbol missing-bar alignment. Wrap strategy hooks in try/except. Serialize `rng.getstate()` for checkpoint determinism.

---

### Milestone 1.5 — Checkpointing and Resume (Python)

**Files:** `packages/runtime/src/aegis_runtime/checkpoint/`

- **`serializer.py`** — `EngineStateSerializer.serialize(engine) -> dict` / `.deserialize(state, data, strategy) -> Engine`. State blob includes: version, config, bar_index, portfolio (cash, positions, realized_pnl, high_water_mark), pending_orders, rng_state (625 ints), event_count.
- **`manager.py`** — `CheckpointManager(db)`: `save_checkpoint(run_id, engine) -> checkpoint_id`, `load_checkpoint(checkpoint_id) -> dict`, `list_checkpoints(run_id)`, `get_latest_checkpoint(run_id)`.

**Stored as JSONB** in `checkpoints.state_blob` column. Typical size <100KB.

**Verify:**
- 1yr daily, checkpoint_interval=50 → ~5 checkpoints written
- Full run = Run A. Pause at bar 100, resume → identical metrics to A
- Pause at 50, resume, pause at 150, resume → identical to A
- Cancel at 200 → status "cancelled", checkpoint exists
- Resume cancelled run → completes correctly
- Corrupt blob → clear CheckpointCorruptError

---

### Milestone 1.6 — Branching and Branch DAG (Python)

**Files:** `packages/runtime/src/aegis_runtime/branch/`

- **`manager.py`** — `BranchManager.fork(parent_checkpoint_id, parent_run_id, change_summary, rationale, overrides)` → (branch_id, new_run_id). Creates branch + run records. `start_branch_run()` loads checkpoint, applies overrides, runs from bar_index+1 to end.
- **`dag.py`** — `BranchDAG.build_dag(root_run_id)` → list[DAGNode]. `to_adjacency_list()` for React Flow format.
- **`delta.py`** — `DeltaComputer.compute_delta(parent_run_id, branch_run_id)` → ResultDelta (total_return_delta, sharpe_delta, max_drawdown_delta, win_rate_delta, profit_factor_delta). Stores in `branches.result_delta_json`.

**Engine extension:** `Engine.apply_overrides(overrides)` patches strategy config params (e.g., `{"entry_threshold": 0.03}`).

**Verify:**
- Fork from bar 100 with different threshold → branch completes, results differ from parent
- Branch record links to correct parent checkpoint and run
- Depth-2 fork → DAG returns correct 3-level tree
- Result delta non-zero
- Fork from nonexistent checkpoint → error
- Parent data unmodified after fork

---

### Milestone 1.8 — Soul Generation (Python) [parallel with 1.5]

**Files:** `packages/runtime/src/aegis_runtime/soul/`

- **`generator.py`** — `SoulGenerator(anthropic_api_key)`. `generate(run_summary) -> SoulArtifacts`. Builds structured run summary (metrics, top/worst trades, equity curve summary, branch deltas) → sends to Claude → parses response into `soul.md` + `soul.json`.
- **`prompts.py`** — System prompt instructs Claude to produce both artifacts with evidence references. User prompt fills in run data.
- **`schemas.py`** — Pydantic models: `SoulJson(beliefs[], anti_patterns[], regime_preferences[], timing_lessons[], confidence_boundaries, playbooks[], scar_tissue[], forbidden_moves[])`, `SoulArtifacts(soul_md, soul_json)`.

**DB flow:** Insert into `soul_versions` with status=`pending`. User approves → status=`active`, previous active → `superseded`.

**Verify:**
- Completed backtest → soul.md + soul.json produced
- Soul references specific trades/metrics (evidence_refs)
- soul.json validates against Pydantic schema
- Second run → version 2 exists alongside version 1
- Diff between versions shows changes
- Empty/failed run → graceful error or minimal soul
- Status flow: pending → active (on approve)

**Tests:** Mock Anthropic client for unit tests. Integration test tagged `@pytest.mark.integration`.

---

### Milestone 1.9 — Node.js Control Plane (API)

**Files:** `packages/server/src/`

**API Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project + agents |
| POST | `/api/projects/:pid/agents` | Create agent |
| GET | `/api/agents/:id` | Get agent + latest strategy + active soul |
| PUT | `/api/agents/:id/strategy` | Update strategy (creates new version) |
| POST | `/api/agents/:aid/runs` | Start backtest |
| GET | `/api/runs/:id` | Get run status + metrics |
| GET | `/api/runs/:id/events?offset&limit` | Paginated events |
| GET | `/api/runs/:id/orders` | Trade ledger |
| GET | `/api/runs/:id/portfolio` | Portfolio snapshots |
| GET | `/api/runs/:id/checkpoints` | List checkpoints |
| POST | `/api/runs/:id/pause` | Pause run |
| POST | `/api/runs/:id/resume` | Resume run |
| POST | `/api/runs/:id/cancel` | Cancel run |
| POST | `/api/checkpoints/:id/branch` | Fork a branch |
| GET | `/api/runs/:id/branches` | Get branch DAG |
| GET | `/api/agents/:id/soul` | Get active soul |
| GET | `/api/agents/:id/soul/versions` | List soul versions |
| POST | `/api/agents/:id/soul/:vid/approve` | Approve soul |
| POST | `/api/runs/:id/generate-soul` | Trigger soul generation |
| GET | `/api/events/stream/:runId` | SSE event stream |

**Node↔Python HTTP contract:**

| Direction | Endpoint | Purpose |
|-----------|----------|---------|
| Node→Python | `POST :8000/api/runs/start` | Start backtest engine |
| Node→Python | `POST :8000/api/runs/{id}/pause` | Signal pause |
| Node→Python | `POST :8000/api/runs/{id}/resume` | Resume from checkpoint |
| Node→Python | `POST :8000/api/runs/{id}/cancel` | Signal cancel |
| Node→Python | `POST :8000/api/runs/start-branch` | Start branch run |
| Node→Python | `POST :8000/api/soul/generate` | Trigger soul gen |
| Python→Node | `POST :3001/api/webhooks/runtime-event` | Status/event callback |

**Event flow:** Python engine → HTTP POST webhook to Node → Node writes DB + pushes to in-memory EventBus → EventBus notifies SSE connections → Browser EventSource receives events.

**Key services:**
- `run-manager.ts` — Orchestrates Python runtime calls
- `event-bus.ts` — In-process EventEmitter for SSE fanout
- `python-client.ts` — HTTP client wrapping Python FastAPI calls

**Python side:** `engine_registry` = in-memory dict `{run_id: Engine}` for pause/cancel signaling. FastAPI BackgroundTasks for async run execution.

**Verify:** All endpoints return correct data, status transitions work, SSE streams events, invalid requests return 400/404.

---

### Milestone 1.10 — Basic Web UI

**Routes:** `/` (Dashboard) → `/agents/:id` (Agent Detail) → `/agents/:id/backtest` (Config Form) → `/runs/:id` (Run Detail)

**Key components:**
- **DashboardPage** — Agent cards with status, "Run Backtest" button
- **AgentDetailPage** — Tabs: Strategy (Monaco/textarea editor), Soul (viewer + version diffs + approve/reject), Run History
- **RunDetailPage** — Status/progress bar, RunControls (pause/resume/cancel). Tabs: Overview (MetricsCards + EquityCurve via Lightweight Charts), Trades (TradeLedger table), Events (EventTimeline), Branches (BranchDAG via React Flow + BranchComparison)
- **BacktestConfigForm** — Symbol input, date range, timeframe, capital, slippage, fees, seed

**Key hooks:**
- `useSSE(runId)` — EventSource subscription, updates React state on events
- `useRun(runId)` / `useAgent(agentId)` — React Query wrappers

**Dependencies:** `@tanstack/react-query`, `react-router-dom`, `lightweight-charts`, `@xyflow/react`, `@monaco-editor/react` (optional), `date-fns`

**Verify:** Dashboard loads agents, create/edit agent works, backtest starts from form, run detail shows live progress via SSE, equity curve renders, trade ledger populates, branch DAG renders, soul viewer shows versions with diffs, controls work.

---

### Milestone 1.11 — End-to-End Integration Test

**No new code.** Automated pytest integration test + manual UI verification.

**Test scenario:**
1. Create project + agent via API
2. Upload strategy (sample MA crossover strategy.md + strategy.py)
3. Start backtest: AAPL + MSFT, 2022→2023, daily, $100K
4. Poll until completed — verify metrics populated, orders > 0, snapshots valid (cash + positions ≈ equity)
5. Generate soul → approve → verify active, contains evidence refs
6. Fork branch from mid-checkpoint with different threshold → completes, DAG shows 2 nodes, delta non-zero
7. **Reproducibility check:** Run identical backtest → identical metrics and order-level determinism
8. Manual UI walkthrough: dashboard, agent detail, run detail, equity curve, trade ledger, branch tree, soul viewer

---

## Verification Strategy

| Milestone | How to test | Framework |
|-----------|-------------|-----------|
| 1.1 | Health endpoints, lint, Docker connects | Vitest + pytest smoke |
| 1.2 | Migration idempotency, FK enforcement, JSONB r/w, seed | Vitest + real Postgres |
| 1.3 | Parquet write/load, cache hit, determinism | pytest (fixtures + integration) |
| 1.7 | Parse/load/validate strategies | pytest |
| 1.4 | Buy-and-hold math, determinism, edge cases | pytest (heaviest test suite) |
| 1.5 | Interrupt+resume = identical to uninterrupted | pytest |
| 1.6 | Fork→run→delta, DAG queries, parent immutability | pytest |
| 1.8 | Soul generation (mocked LLM), schema validation, versioning | pytest |
| 1.9 | All API endpoints, SSE streaming, webhook processing | Vitest |
| 1.10 | Component rendering with mock data | Vitest + React Testing Library |
| 1.11 | Full workflow: create→backtest→soul→branch→reproduce | pytest integration + manual |

**Run all:** `pnpm test && pnpm test:py` after each milestone before moving to the next.

---

## Critical Files

- `packages/runtime/src/aegis_runtime/simulator/engine.py` — Core simulation loop. Most critical file. Must be deterministic.
- `packages/db/src/schema/runs.ts` — Central DB table linking agents, strategies, checkpoints, branches, orders.
- `packages/server/src/services/run-manager.ts` — Orchestration bridge between Node.js and Python.
- `packages/server/src/routes/events-sse.ts` — SSE streaming for real-time UI updates.
- `packages/runtime/src/aegis_runtime/simulator/portfolio.py` — Portfolio state management.
- `packages/runtime/src/aegis_runtime/checkpoint/serializer.py` — Engine state serialization (determinism depends on this).
