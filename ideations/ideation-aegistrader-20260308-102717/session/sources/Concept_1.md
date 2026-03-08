## Part 1: Core architecture and research direction

Yes, this is buildable, but only if you split the system into **two layers**:

1. a **deterministic trading engine** that owns truth, replay, fills, scoring, and branch history
2. a **non-deterministic agent layer** that proposes hypotheses, explores branches, reflects, and writes the “trading soul”

That separation is the most important design decision here. If you make the LLM the source of truth, you will never get reliable replay, auditability, or branch comparison. If you make the simulator the source of truth, then the agents become powerful but safe. This is exactly where an OpenClaw-like pattern helps: OpenClaw is fundamentally a long-lived gateway/control-plane with WebSocket-connected clients and nodes, typed events, and operator control, not “just a chatbot.” That pattern fits your system very well for UI visibility, live control, and background runtimes. ([OpenClaw][1])

### My top-level recommendation

Use an **OpenClaw-inspired control plane**, but do **not** use an OpenClaw-style freeform agent runtime as the trading core.

Use this instead:

* **React + Vite frontend** for branch tree, run timeline, orders, PnL, soul diffs
* **Node.js control plane** for auth, project config, UI APIs, realtime event fanout
* **Python runtime** for backtesting, feature calc, simulation, live paper execution
* **Temporal** for long-running workflows, pause/resume, user signals, retries, crash recovery
* **LangGraph optionally inside the Python runtime** for agent checkpointing/time-travel/forks
* **Convex for realtime UI-facing metadata and subscriptions**
* **Postgres for canonical transactional truth**
* **Parquet/object storage for market data lake**
* **Markdown + JSON artifacts for each agent soul/version**

Temporal is a strong fit because it is built for long-running reliable workflows and supports reading and controlling workflow state through queries, signals, and updates. LangGraph is useful because it already supports durable execution, persistence, and time-travel that creates forks from earlier checkpoints. Convex is excellent for live-updating UI state, scheduled functions, and file storage, but Convex actions have a 10-minute timeout, so it should not be the engine that runs hour/day-long backtests. ([Temporal Docs][2])

---

## 1. What to borrow from OpenClaw

From OpenClaw, borrow these ideas:

### A. Single long-lived gateway

OpenClaw’s model is a single long-lived Gateway with WebSocket clients and typed events. For your product, that becomes the **Agent Control Plane**:

* browser UI connects over WebSocket/SSE
* Python runners connect as worker nodes
* scheduler/admin tools connect as operators
* all state changes emit structured events

That gives you one place for:

* agent lifecycle
* run state
* branch creation
* live status
* human overrides
* approvals for risky transitions ([OpenClaw][1])

### B. Separate control plane from execution

The gateway should not backtest. It should coordinate:

* start run
* fork branch
* stop run
* resume from checkpoint
* schedule live wake-up
* stream progress to UI

The Python runtime does the heavy work.

### C. Typed protocol, not loose chat logs

Every action should be a typed event:

* `RUN_STARTED`
* `CHECKPOINT_CREATED`
* `BRANCH_FORKED`
* `ORDER_PROPOSED`
* `ORDER_ACCEPTED`
* `ORDER_REJECTED`
* `SOUL_UPDATED`
* `RUN_PAUSED`
* `LIVE_TICK_EVALUATED`

This is what makes your UI actually debuggable.

---

## 2. The architecture I would actually build

### Layer 1: deterministic market/simulation core

This is where truth lives.

It should own:

* historical data loading
* corporate action normalization
* indicators/features
* portfolio/account state
* fills, slippage, fees
* position sizing math
* drawdown rules
* order ledger
* replay
* checkpoint serialization
* branch DAG
* benchmark scoring

This layer must be reproducible from:

* exact data snapshot
* strategy version
* simulator version
* config version
* random seed where applicable

No LLM should directly mutate this state except by emitting a structured proposal that this engine validates.

### Layer 2: agent cognition layer

Each agent gets:

* `strategy.md`
* optional `strategy.py`
* access to deterministic tools
* read-only visibility into other agents’ PnL leaderboard
* writable private memory/soul
* branch creation rights inside its own run budget

The agent can:

* inspect results
* propose alternate branches
* reflect on mistakes
* update its soul
* decide whether timing changes matter
* choose when to wake in live mode

The agent cannot:

* bypass hard risk rules
* rewrite fills
* fabricate data
* inspect other agents’ reasoning
* submit orders that violate deterministic guards

---

## 3. How the “trading soul” should work

The soul should not just be a diary. It should be a **structured evolving doctrine**.

I would define each soul as two files:

### `soul.md`

Human-readable narrative:

* identity: what kind of trader this agent believes it is
* market beliefs
* favored regimes
* disliked regimes
* known failure modes
* timing lessons
* examples of good trades
* examples of bad trades
* branch lineage highlights
* unresolved questions
* current confidence boundaries

### `soul.json`

Machine-readable memory:

* `beliefs[]`
* `anti_patterns[]`
* `regime_preferences[]`
* `risk_bias`
* `timing_preferences`
* `feature_trust_scores`
* `symbol_blacklist/whitelist`
* `playbooks[]`
* `counterfactual_lessons[]`
* `evidence_refs[]`
* `soul_version`
* `derived_from_branch_id`

The soul should be **derived**, versioned, diffable, and replay-linked.
In other words: the soul is not truth. It is a learned interpretation of truth.

### What else to include in the soul

You asked what else should go there. Add these:

* **scar tissue**: repeated mistakes the agent is now biased against
* **confidence calibration**: when it should reduce size or abstain
* **regime map**: trending, mean-reverting, volatile, low-volume, earnings week, macro event day
* **timing self-critique**: “I was right on direction, wrong on when”
* **branch evidence links**: exact runs that changed the soul
* **forbidden moves**: things it is no longer allowed to do without extra evidence
* **contrarian trigger**: when the agent intentionally flips its default instinct
* **abstention doctrine**: when no trade is the right trade

---

## 4. Branching and git-tree style history

This is one of your strongest ideas.

You do not want a simple backtest log. You want a **branch DAG**.

Each run should look like this:

* root run = baseline strategy on selected time range
* checkpoint every N decisions / N bars / major events
* from any checkpoint, the agent can fork:

  * change threshold
  * change timing window
  * skip a trade
  * reduce size
  * try alternate exit
  * reinterpret a regime
* each fork becomes a child branch with:

  * parent checkpoint
  * diff from parent
  * result delta
  * soul delta

This is exactly the kind of thing LangGraph’s time-travel model can help with conceptually, because it supports resuming from a prior checkpoint and creating a new fork in history. But I would still keep your **canonical branch DAG in your own database**, not inside agent framework state alone. ([LangChain Docs][3])

### Canonical branch entities

You will want tables like:

* `agents`
* `strategies`
* `runs`
* `checkpoints`
* `branches`
* `orders`
* `fills`
* `positions`
* `market_snapshots`
* `agent_events`
* `soul_versions`
* `llm_calls`
* `tool_calls`
* `schedules`

---

## 5. Data sources: what to use first and what to use later

### Best MVP path

Use **Alpaca** first for:

* historical stock data
* real-time stock data
* paper trading
* simple paper/live boundary

Alpaca provides historical equities data, realtime streams, and paper trading. Its paper environment simulates fills from real-time quotes, but Alpaca explicitly says paper trading does not account for market impact, information leakage, latency slippage, non-marketable queue position, price improvement, regulatory fees, or dividends. That is fine for MVP paper trading, but not enough for “research-grade” backtesting by itself. ([Alpaca API Docs][4])

### Better data path for serious research

For higher-fidelity research, use a separate market-data provider:

* **Massive (formerly Polygon)** for real-time U.S. stock WebSocket streams and REST access ([Massive][5])
* **Databento** for high-resolution historical datasets and large batch downloads; their historical API supports large requests and nanosecond-resolution time ranges ([Databento][6])
* **IBKR** later if you want broader brokerage integration and paper/live workflow closer to brokerage reality, though the API surface is heavier operationally ([Interactive Brokers][7])
* **Twelve Data** is fine for broad asset coverage and WebSocket support, but I would put it behind Alpaca/Massive/Databento for this product’s first serious version ([Twelve Data][8])

### Practical recommendation

* **MVP**: Alpaca only
* **V2 serious backtest**: Databento or Massive for research data + Alpaca for paper execution
* **V3**: add IBKR adapter if you want more instruments and brokerage portability

---

## 6. How strategy should be defined

Your idea is right: **`.md` + optional Python`** is the right balance.

### `strategy.md`

Use it for declarative intent:

* objective
* asset universe
* allowed instruments
* timeframe
* session rules
* entry criteria
* exit criteria
* risk limits
* sizing doctrine
* max concurrent positions
* forbidden conditions
* wake-up rules for live mode
* reflection policy
* branch budget policy

### `strategy.py`

Use it for deterministic hooks only:

* feature engineering
* signal calculation
* order construction
* risk checks
* scoring
* custom regime classification

### Do not allow arbitrary Python everywhere

Only expose a narrow interface, such as:

* `prepare_features(df) -> df`
* `generate_signal(state, market) -> SignalProposal`
* `size_position(portfolio, signal) -> SizeDecision`
* `risk_gate(order, portfolio, market) -> RiskDecision`

That keeps the system testable.

---

## 7. Deterministic vs non-deterministic contract

This must be explicit from day one.

### Deterministic

* data snapshotting
* bar/tick replay
* indicators/features
* signal execution rules
* fill engine
* fees/slippage models
* portfolio accounting
* branch DAG persistence
* leaderboard ranking
* final PnL statistics

### Non-deterministic

* LLM reflections
* soul generation
* branch proposals
* counterfactual exploration ideas
* strategy criticism
* timing introspection
* narrative summaries

### Rule

The non-deterministic layer may only produce:

* proposals
* annotations
* hypotheses
* summaries

The deterministic layer alone produces:

* accepted decisions
* account state
* fills
* branch outcomes
* scoreboard

That is the only way your backtests remain explainable.

---

## 8. Whether to use Convex, and for what

Use **Convex**, but not as the whole backend.

Convex is very good for:

* live-updating app state
* realtime subscriptions to branch/run progress
* auth-linked frontend data
* file storage for generated artifacts
* scheduled functions / cron
* lightweight Node-side actions and APIs ([Convex Developer Hub][9])

But Convex actions time out after 10 minutes, which is a bad fit for your “run for 1 hour / 1 day / 10 days” backtests. So:

### Use Convex for

* UI-facing run metadata
* event projections
* soul artifact URLs
* user config
* schedules visible in app
* notifications

### Do not use Convex for

* heavy historical simulation
* long-running multi-day agent workflows
* canonical order/fill truth
* market time-series lake

### Use Postgres for

* orders
* fills
* checkpoints
* branches
* strategy versions
* run state
* audit logs

### Use Parquet/object storage for

* OHLCV / tick history
* precomputed features
* archived run snapshots
* branch export bundles

---

## 9. Model stack recommendation

Since you want Claude and open models together:

### Router

Use **LiteLLM** in front of everything so the rest of your system talks one API. LiteLLM supports routing/load balancing/fallbacks, and it can route to OpenAI-compatible endpoints. ([LiteLLM][10])

### Claude

Use Claude for:

* branch proposal generation
* soul synthesis
* critique
* meta-reasoning
* high-value regime interpretation

Anthropic’s tool-use model fits this well because Claude can choose client-side tools that run on your systems while keeping tool schemas explicit. ([Claude][11])

### Open models

Use:

* **vLLM** when you want server-hosted open models behind an OpenAI-compatible API ([vLLM][12])
* **Ollama** for local/dev usage and smaller non-stateful helper models ([Ollama Docs][13])

### Suggested split

* small open model: cheap summarization / low-stakes reflections
* Claude Sonnet/Opus tier: strategic critique, soul merge, branch design
* deterministic Python: actual final trading decisions and simulation math

---

## 10. The build should be done in parts

Here is the phased plan I’d use.

### Phase 1: deterministic single-agent backtester

Build first:

* one agent
* one strategy
* one dataset
* branch DAG
* checkpointing
* no live trading yet
* soul generation after run
* UI for run timeline and branch tree

Goal: prove replay and auditability.

### Phase 2: multi-agent tournament mode

Add:

* multiple agents
* shared historical dataset
* isolated souls
* shared leaderboard only
* no cross-agent reasoning leakage
* compare branches and doctrine evolution

Goal: prove competition model.

### Phase 3: paper live mode

Add:

* scheduled wake-ups
* streaming/live polling
* paper broker adapter
* deterministic risk gate before every order
* live soul updates with delayed commit

Goal: prove live loop without real money risk.

### Phase 4: human governance and controls

Add:

* kill switch
* branch approval gates
* run budget limits
* max token budget
* max branch depth
* explain-before-submit mode
* export/import runs as bundle

Goal: make it operable.

---

## Bottom line

Your idea is good, but the winning version is **not** “many autonomous traders freely improvising forever.”

The winning version is:

**an event-sourced deterministic trading lab with LLM agents layered on top for exploration, reflection, and strategy evolution.**

That gives you:

* reproducible backtests
* visible branch trees
* inspectable souls
* long-running workflows
* safe paper trading
* a UI that actually explains what happened

And the cleanest stack for your requirements is:

**React/Vite + Node control plane + Python simulation/runtime + Temporal + Postgres + Convex + Parquet/object storage + LiteLLM + Claude + optional vLLM/Ollama**

Send **part 2** and I’ll turn this into:

* exact database schema
* event model
* branch DAG model
* service boundaries
* API design
* folder structure for the monorepo and Python runtime

[1]: https://docs.openclaw.ai/concepts/architecture "Gateway Architecture - OpenClaw"
[2]: https://docs.temporal.io/ "Temporal Docs | Temporal Platform Documentation"
[3]: https://docs.langchain.com/oss/javascript/langgraph/use-time-travel "Use time-travel - Docs by LangChain"
[4]: https://docs.alpaca.markets/docs/historical-stock-data-1 "Historical Stock Data"
[5]: https://massive.com/docs/websocket/stocks/overview?utm_source=chatgpt.com "Overview | Stocks WebSocket"
[6]: https://databento.com/docs/api-reference-historical "Databento API documentation - Historical"
[7]: https://www.interactivebrokers.com/campus/ibkr-api-page/ibkr-api-home/ "IBKR API | Developer Documentation and Reference Home"
[8]: https://twelvedata.com/docs?utm_source=chatgpt.com "API Documentation"
[9]: https://docs.convex.dev/home "Convex Docs | Convex Developer Hub"
[10]: https://docs.litellm.ai/docs/routing?utm_source=chatgpt.com "Router - Load Balancing"
[11]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview "Tool use with Claude - Claude API Docs"
[12]: https://docs.vllm.ai/en/latest/serving/openai_compatible_server/?utm_source=chatgpt.com "OpenAI-Compatible Server - vLLM"
[13]: https://docs.ollama.com/api/openai-compatibility?utm_source=chatgpt.com "OpenAI compatibility"
