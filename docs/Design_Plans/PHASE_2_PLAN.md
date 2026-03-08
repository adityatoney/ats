# Phase 2: Multi-Agent Competition with Leaderboard Isolation

## Goal

Prove that multiple agents can compete on the same historical dataset with isolated strategies and souls, sharing only a leaderboard. No agent can see another agent's reasoning, strategy, or soul — only aggregate performance metrics.

Phase 2 assumes all of Phase 1 is complete and stable.

---

## Milestone 2.1 — Multi-Agent Run Orchestration

### What to build

- Run coordinator module
  - Accept a "tournament" request: a list of agent IDs, a shared dataset config (symbols, time range, capital, fees), and run parameters
  - Create individual runs for each agent against the same dataset
  - Ensure all agents receive identical market data (same Parquet files, same bar sequence)
  - Runs can execute concurrently (separate Python worker processes or threads)
  - Track tournament-level status: pending, in_progress, completed, partially_failed
- Tournament entity
  - `tournaments` table: id, project_id, name, config_json, status, created_at
  - `tournament_entries` table: id, tournament_id, agent_id, run_id, final_rank
- Shared dataset guarantee
  - Market data is fetched once and referenced by all runs in the tournament
  - Data snapshot ID is recorded in each run config for reproducibility

### How to test

- [ ] Create a tournament with 3 agents; all 3 runs are created and start executing
- [ ] All 3 runs receive identical market data (verify bar-for-bar equality)
- [ ] Runs execute concurrently (wall-clock time < 3× single-run time)
- [ ] If one agent's run fails, the others continue; tournament status is "partially_failed"
- [ ] Tournament entry records link each agent to its run and eventual rank
- [ ] Re-running the same tournament with the same config produces identical per-agent results

---

## Milestone 2.2 — Agent Isolation Enforcement

### What to build

- Isolation boundary module
  - Each agent's runtime context can only access:
    - Its own strategy files
    - Its own soul files
    - Its own run history and branches
    - The shared market data
    - The leaderboard (read-only, limited fields)
  - Explicitly blocked:
    - Reading another agent's strategy.md or strategy.py
    - Reading another agent's soul.md or soul.json
    - Reading another agent's run events, orders, or branches
    - Reading another agent's tool call logs or LLM call logs
- Isolation is enforced at the API layer (Node.js) and at the Python runtime level
  - API endpoints filter by agent ownership
  - Python tool wrappers only resolve files within the agent's own scope
- Audit logging for any cross-agent access attempt

### How to test

- [ ] Agent A requests agent B's strategy via API; returns 403 forbidden
- [ ] Agent A requests agent B's soul; returns 403 forbidden
- [ ] Agent A requests agent B's run events; returns 403 forbidden
- [ ] Agent A requests the leaderboard; returns only permitted fields (rank, PnL, Sharpe — no strategy info)
- [ ] Python runtime tool for "read strategy" only resolves the calling agent's files
- [ ] Cross-agent access attempt is logged in the audit trail
- [ ] An admin/owner can see all agents' data (isolation is agent-to-agent, not user-to-data)

---

## Milestone 2.3 — Leaderboard and Competitive Metrics

### What to build

- Leaderboard service
  - After all runs in a tournament complete, compute rankings based on configurable metrics:
    - Total return
    - Sharpe ratio
    - Max drawdown
    - Win rate
    - Profit factor
    - Risk-adjusted return
  - Default ranking: Sharpe ratio (configurable)
  - Leaderboard is a materialized view or computed table, updated when runs complete
- Leaderboard data model
  - `leaderboard_entries` table: id, tournament_id, agent_id, run_id, rank, total_return, sharpe, max_drawdown, win_rate, profit_factor, computed_at
- Leaderboard visibility rules
  - Agents can read the leaderboard: rank, agent name, total return, Sharpe, max drawdown
  - Agents cannot read: strategy, soul, trade details, or branch tree of other agents
  - Users (owners) can read everything

### How to test

- [ ] After a 3-agent tournament completes, leaderboard shows all 3 agents ranked by Sharpe
- [ ] Rankings update correctly if a new run for an agent completes with better results
- [ ] Agent requesting leaderboard sees only permitted fields
- [ ] Leaderboard sorts correctly (highest Sharpe = rank 1)
- [ ] Changing the ranking metric (e.g., to total return) reorders the leaderboard
- [ ] Leaderboard shows correct values matching individual run metrics
- [ ] User (owner) view includes all data including per-agent links to runs

---

## Milestone 2.4 — Agent-Aware Soul Generation

### What to build

Extend the soul generation from Phase 1 to incorporate competitive context:

- When generating a soul update after a tournament run, include:
  - The agent's own performance metrics
  - Its leaderboard rank and relative standing
  - How it performed vs the field (above/below median on each metric)
  - What market regimes occurred during the run
- The soul should NOT include:
  - Other agents' strategies or reasoning
  - Specific trades by other agents
  - Other agents' soul contents
- New soul sections:
  - `competitive_position` — how the agent perceives its standing
  - `relative_strengths` — where it outperformed the field
  - `relative_weaknesses` — where it underperformed
  - `adaptation_hypotheses` — what the agent thinks it should change

### How to test

- [ ] After a tournament, triggering soul generation for agent A includes its rank
- [ ] Soul mentions "ranked 2nd of 3" (or similar) based on actual leaderboard data
- [ ] Soul does NOT contain any reference to another agent's strategy content
- [ ] Soul does NOT contain another agent's specific trade details
- [ ] Soul JSON includes `competitive_position` and `relative_strengths` fields
- [ ] Generating soul for the top-ranked agent reflects confidence; last-ranked reflects critique
- [ ] Soul evidence links still point to the agent's own run data

---

## Milestone 2.5 — Multi-Agent UI Extensions

### What to build

Extend the Phase 1 UI:

- **Tournament page**
  - Create a new tournament: select agents, configure dataset, start
  - Tournament status and progress (per-agent progress bars)
  - Tournament results summary
- **Leaderboard view**
  - Table with rank, agent name, key metrics
  - Sortable by any metric column
  - Click an agent to navigate to its run detail
- **Agent comparison view**
  - Side-by-side equity curves (overlaid on same chart)
  - Side-by-side metrics table
  - Comparative drawdown chart
  - Per-agent trade count and activity heatmap
- **Dashboard updates**
  - Show number of agents per project
  - Show latest tournament results summary
  - Quick-start a new tournament

### How to test

- [ ] Tournament creation form shows all agents in the project
- [ ] Starting a tournament shows per-agent progress
- [ ] Tournament results page shows final leaderboard
- [ ] Leaderboard table is sortable by each metric column
- [ ] Clicking an agent in the leaderboard navigates to its run detail
- [ ] Comparison view overlays equity curves for all agents on one chart
- [ ] Comparison view handles agents with very different return profiles (axis scaling)
- [ ] Dashboard shows tournament summary after completion
- [ ] Creating a tournament with only 1 agent works (degenerates to a solo run with rank 1)

---

## Milestone 2.6 — Integration Test: Multi-Agent Tournament

### What to build

No new code — full integration test of milestones 2.1–2.5.

### Test scenario

1. Start all services
2. Create a project with 3 agents:
   - Agent "Trend Follower" — moving-average crossover strategy
   - Agent "Mean Reverter" — RSI overbought/oversold strategy
   - Agent "Buy and Hold" — baseline strategy that buys day 1 and holds
3. Configure a tournament:
   - Symbols: SPY, QQQ, AAPL, MSFT, GOOGL
   - Time range: 2020-01-01 to 2023-12-31 (includes COVID crash and recovery)
   - Daily bars, $100K capital each
4. Run the tournament:
   - All 3 agents execute concurrently
   - Each agent generates trades based on its own strategy
   - Progress visible in UI per-agent
5. Review results:
   - Leaderboard shows all 3 ranked
   - "Buy and Hold" serves as a meaningful baseline
   - Equity curves diverge at crisis points (March 2020)
   - Metrics differ across agents
6. Generate souls for each agent:
   - Each soul reflects different lessons (trend follower learned about whipsaws; mean reverter learned about V-shaped recoveries)
   - Each soul includes competitive positioning
   - No cross-agent strategy leakage in any soul
7. Agent isolation check:
   - Attempt cross-agent data access via API; all blocked
   - Verify audit logs captured the attempts
8. Fork branches on the worst-performing agent:
   - Create branches from checkpoints during the worst drawdown period
   - Test alternate parameters
   - See if any branch improves the agent's ranking

### How to test

- [ ] All 3 agents complete their runs
- [ ] Leaderboard ranking is consistent with actual Sharpe ratios
- [ ] Equity curve comparison chart renders all 3 curves
- [ ] Soul generation completes for all agents with no cross-contamination
- [ ] Isolation enforcement blocks all cross-agent access attempts
- [ ] Branch from worst-performer produces a different result
- [ ] Re-running the tournament produces identical results for all agents
