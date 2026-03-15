# Phase 2 Implementation Plan: Multi-Agent Competition with Leaderboard Isolation

## Context

Phase 1 is complete — AegisTrader has a deterministic single-agent backtester with checkpointing, branching, soul generation, a Node.js API, and a React UI. Phase 2 adds a tournament orchestration layer so multiple agents can compete on the same dataset with isolated strategies/souls, sharing only a leaderboard. This is the foundation for the competitive AI trading research loop.

Design doc: `docs/Design_Plans/PHASE_2_PLAN.md`

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Concurrent engines | `asyncio.gather` on existing async engine | Engine already yields every bar via `await asyncio.sleep(0)`. No shared mutable state. Simplest for 3-10 agents. Upgrade to `ProcessPoolExecutor` in Phase 3 if needed. |
| Agent isolation | API-layer middleware with `agentContext` query param | No auth system yet. Middleware checks resource ownership. Without `agentContext` = owner/admin access. |
| Shared data | Pre-fetch once, all engines load same Parquet | DataLoader caches by `{symbol}/{timeframe}_{start}_{end}.parquet`. Polars DataFrames are immutable. |
| Tournament state | DB-driven, webhook-triggered finalization | `handleRunCompleted` checks `completedCount == agentCount`, then finalizes. Idempotent on restart. |
| Leaderboard compute | On-demand after tournament finalization | Not materialized views — computed once and written to `leaderboard_entries`. Re-computable with different ranking metric. |

---

## Milestones

### Milestone 2.1 — Multi-Agent Run Orchestration

#### 2.1.1 Database Schema (3 new tables + 1 modification)

**Create** `packages/db/src/schema/tournaments.ts`:
```
tournaments: id(uuid PK), projectId(FK→projects), name(varchar 255),
  configJson(jsonb), status(varchar 50: pending|in_progress|completed|partially_failed|failed|cancelled),
  dataSnapshotId(varchar 255), agentCount(int), completedCount(int default 0),
  startedAt(timestamp?), completedAt(timestamp?), createdAt(timestamp)
```

**Create** `packages/db/src/schema/tournament-entries.ts`:
```
tournament_entries: id(uuid PK), tournamentId(FK→tournaments), agentId(FK→agents),
  runId(FK→runs, nullable), finalRank(int, nullable), status(varchar 50: pending|running|completed|failed),
  createdAt(timestamp)
  unique: (tournamentId, agentId)
```

**Create** `packages/db/src/schema/leaderboard-entries.ts`:
```
leaderboard_entries: id(uuid PK), tournamentId(FK→tournaments), agentId(FK→agents),
  runId(FK→runs), rank(int), totalReturn(numeric 18,8), sharpeRatio(numeric 18,8),
  sortinoRatio(numeric 18,8), maxDrawdown(numeric 18,8), winRate(numeric 18,8),
  profitFactor(numeric 18,8), netProfit(numeric 18,8), totalTrades(int),
  metricsJson(jsonb), computedAt(timestamp)
  unique: (tournamentId, agentId)
```

**Modify** `packages/db/src/schema/runs.ts` — add nullable `tournamentId` column (FK→tournaments)

**Modify** `packages/db/src/schema/index.ts` — export 3 new tables

#### 2.1.2 Node.js Server

**Create** `packages/server/src/services/tournament-manager.ts`:
- `createTournament(projectId, name, agentIds[], config)` — validates agents have strategies, inserts tournament + entries
- `startTournament(tournamentId)` — pre-fetches data via Python, creates runs per agent (with `tournamentId`), calls `pythonClient.startTournament()`
- `handleRunCompleted(runId, tournamentId)` — updates entry status, increments `completedCount`, finalizes when all done
- `finalizeTournament(tournamentId)` — calls leaderboard service, sets status

**Create** `packages/server/src/routes/tournaments.ts`:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/tournaments` | Create tournament (name, agentIds[], config) |
| GET | `/api/tournaments` | List tournaments (by projectId query param) |
| GET | `/api/tournaments/:id` | Get tournament + entries + runs |
| POST | `/api/tournaments/:id/start` | Start tournament |
| POST | `/api/tournaments/:id/cancel` | Cancel tournament |
| GET | `/api/tournaments/:id/leaderboard` | Get leaderboard (restricted if ?agentContext) |
| GET | `/api/tournaments/:id/comparison` | Get all agents' portfolio snapshots for overlay |

**Modify** `packages/server/src/index.ts` — add `app.route('/api/tournaments', tournamentRoutes)`

**Modify** `packages/server/src/routes/webhooks.ts` — in `run.completed` handler, check for `tournamentId` on the run and call `tournamentManager.handleRunCompleted()`. Same for `run.failed`.

**Modify** `packages/server/src/lib/python-client.ts` — add `prefetchData(config)` and `startTournament(data)` methods

**Modify** `packages/server/src/services/event-bus.ts` — add `publishTournament()` / `subscribeToTournament()` for tournament-level SSE

**Modify** `packages/server/src/routes/events-sse.ts` — add `GET /stream/tournament/:tournamentId`

#### 2.1.3 Python Runtime

**Create** `packages/runtime/src/aegis_runtime/tournament/__init__.py`
**Create** `packages/runtime/src/aegis_runtime/tournament/coordinator.py`:
- `TournamentCoordinator.run_tournament(tournament_id, runs_config[], shared_data)` — uses `asyncio.gather(*tasks, return_exceptions=True)` to run all engines concurrently. Each task is the existing `run_backtest` flow. Handles partial failures.

**Create** `packages/runtime/src/aegis_runtime/api/routes/tournaments.py`:
- `POST /api/tournaments/start` — accepts `{ tournamentId, runs: [{runId, agentId, strategyMd, strategyPy, config}], dataSnapshotId }`, loads data once, dispatches to coordinator
- `POST /api/data/prefetch` — accepts `{ symbols, startDate, endDate, timeframe }`, ensures Parquet cache populated, returns `{ dataSnapshotId, barCounts }`

**Modify** `packages/runtime/src/aegis_runtime/api/app.py` — mount `tournaments_router` at `/api/tournaments`

#### 2.1.4 Verify
- [ ] 3-agent tournament: all 3 runs created and execute
- [ ] All 3 runs receive identical market data (same bar counts)
- [ ] Runs execute concurrently (wall-clock < 3x single run)
- [ ] If one fails, others continue; tournament status = `partially_failed`
- [ ] Re-running same config produces identical per-agent results

---

### Milestone 2.2 — Agent Isolation Enforcement

#### 2.2.1 Node.js Middleware

**Create** `packages/server/src/middleware/agent-isolation.ts`:
- Hono middleware that extracts `agentContext` from query params
- If present: verifies the requested resource belongs to that agent, returns 403 if not
- If absent: owner/admin access (full data)
- Logs violation attempts

**Create** `packages/server/src/services/audit-logger.ts`:
- Logs cross-agent access attempts to `agent_events` table with `eventType: 'isolation.violation_attempt'`

**Modify** existing route files to apply isolation middleware:
- `packages/server/src/routes/agents.ts` — `GET /:id`, `GET /:id/runs`
- `packages/server/src/routes/runs.ts` — `GET /:id`, `GET /:id/orders`, `GET /:id/portfolio`
- `packages/server/src/routes/souls.ts` — `GET /agent/:id`, `GET /agent/:id/versions`

#### 2.2.2 Verify
- [ ] Agent A requests agent B's strategy with `?agentContext=A` → 403
- [ ] Agent A requests agent B's soul → 403
- [ ] Agent A requests agent B's run events → 403
- [ ] Leaderboard with `?agentContext=A` returns only visible fields (rank, name, return, Sharpe, drawdown)
- [ ] Without `agentContext` → full data (owner access)
- [ ] Violation attempts logged in `agent_events`

---

### Milestone 2.3 — Leaderboard and Competitive Metrics

#### 2.3.1 Leaderboard Service

**Create** `packages/server/src/services/leaderboard-service.ts`:
- `computeLeaderboard(tournamentId, rankingMetric = 'sharpeRatio')` — queries completed runs, ranks agents, writes `leaderboard_entries`
- `getLeaderboard(tournamentId, agentContext?)` — returns full or restricted view
- `recomputeLeaderboard(tournamentId, rankingMetric)` — re-ranks by different metric
- `getAgentStanding(tournamentId, agentId)` — returns rank, percentile, above/below median per metric, field medians/best/worst (for soul generation). NO strategy/trade details of other agents.

#### 2.3.2 Verify
- [ ] 3-agent tournament → leaderboard has 3 entries ranked by Sharpe
- [ ] Changing ranking metric reorders entries correctly
- [ ] Leaderboard values match individual run `metricsJson`
- [ ] Agent standing computes correct percentile and relative strengths/weaknesses

---

### Milestone 2.4 — Agent-Aware Soul Generation

#### 2.4.1 Python Changes

**Modify** `packages/runtime/src/aegis_runtime/soul/schemas.py` — add to `SoulJson`:
- `competitive_position: dict = {}` (rank, totalEntrants, percentile)
- `relative_strengths: list[str] = []`
- `relative_weaknesses: list[str] = []`
- `adaptation_hypotheses: list[str] = []`

**Modify** `packages/runtime/src/aegis_runtime/soul/prompts.py` — add `SOUL_COMPETITIVE_PROMPT_TEMPLATE` extending the base with a "Competitive Context" section (rank, field stats, above/below median). Explicit instruction: "Do NOT reference other agents' strategies or trades."

**Modify** `packages/runtime/src/aegis_runtime/soul/generator.py` — add `generate_competitive(run_summary, competitive_context)` method using the competitive prompt. Falls back to regular `generate()` if no context.

**Modify** `packages/runtime/src/aegis_runtime/api/routes/soul.py` — accept optional `competitiveContext` in request

#### 2.4.2 Node.js Integration

**Modify** `packages/server/src/routes/runs.ts` — in `POST /:id/generate-soul`, check if run has `tournamentId`. If so, call `leaderboardService.getAgentStanding()` and pass `competitiveContext` to Python.

#### 2.4.3 Verify
- [ ] Soul after tournament includes `competitive_position` in `soul_json`
- [ ] Soul.md mentions rank ("ranked 2nd of 3")
- [ ] Soul contains NO other agents' strategy/trade details
- [ ] Solo run (no tournament) → soul generated normally (backward compat)

---

### Milestone 2.5 — Multi-Agent UI Extensions

#### 2.5.1 New Routes

**Modify** `packages/web/src/main.tsx` — add:
- `/tournaments` → TournamentListPage
- `/tournaments/new` → CreateTournamentPage
- `/tournaments/:id` → TournamentDetailPage
- `/tournaments/:id/compare` → AgentComparisonPage

#### 2.5.2 New Components

**Create** `packages/web/src/components/tournament/TournamentListPage.tsx` — list of tournaments with status badges, agent count, "New Tournament" button

**Create** `packages/web/src/components/tournament/CreateTournamentPage.tsx` — form: name, multi-select agents, dataset config (reuse BacktestConfigForm pattern)

**Create** `packages/web/src/components/tournament/TournamentDetailPage.tsx` — header with status/progress, per-agent progress cards, SSE integration, leaderboard table on completion

**Create** `packages/web/src/components/tournament/LeaderboardTable.tsx` — sortable table: rank, agent name, return, Sharpe, Sortino, drawdown, win rate, profit factor, trades. Click agent → run detail.

**Create** `packages/web/src/components/tournament/AgentComparisonPage.tsx` — overlaid equity curves (all agents on one Lightweight Chart), side-by-side metrics table, comparative drawdown chart

#### 2.5.3 New Hooks

**Create** `packages/web/src/hooks/useTournament.ts` — `useTournament(id)`, `useTournamentLeaderboard(id)`, `useTournamentComparison(id)`

**Create** `packages/web/src/hooks/useTournamentSSE.ts` — subscribe to `tournament.*` events

#### 2.5.4 Modifications

**Modify** `packages/web/src/lib/api-client.ts` — add tournament API methods (list, create, get, start, cancel, leaderboard, comparison)

**Modify** `packages/web/src/components/dashboard/DashboardPage.tsx` — add "Tournaments" section, recent results, "New Tournament" button

**Modify** `packages/web/src/components/ui/Layout.tsx` — add "Tournaments" nav link

#### 2.5.5 Verify
- [ ] Tournament creation form shows all project agents
- [ ] Per-agent progress via SSE during execution
- [ ] Leaderboard renders and is sortable by column
- [ ] Comparison view overlays equity curves on one chart
- [ ] Side-by-side metrics table populates
- [ ] Dashboard shows tournament summary
- [ ] Single-agent tournament works (rank 1)

---

### Milestone 2.6 — Integration Test

**Create** `packages/runtime/tests/fixtures/mean_reverter_strategy.py` — RSI-based mean reversion
**Create** `packages/runtime/tests/fixtures/buy_hold_strategy.py` — buy day 1, hold forever

**Create** `packages/runtime/tests/test_tournament.py` — unit tests for coordinator (concurrent execution, partial failure, shared data)

**Create** `packages/runtime/tests/test_tournament_integration.py` — end-to-end:
1. Create 3 agents (Trend Follower, Mean Reverter, Buy & Hold)
2. Create tournament: SPY/QQQ/AAPL/MSFT/GOOGL, 2020-2023, daily, $100K
3. Run tournament → all 3 complete
4. Leaderboard has 3 entries ranked correctly
5. Soul generation per agent with competitive context
6. No cross-agent data in souls
7. Re-run = identical results (determinism)
8. Isolation attempts → 403

---

## Build Order

```
Milestone 2.1 (Days 1-4):  DB schema → Node tournament service/routes → Python coordinator
Milestone 2.2 (Days 5-6):  Isolation middleware → audit logging → route modifications
Milestone 2.3 (Days 7-8):  Leaderboard service → API → agent standing computation
Milestone 2.4 (Days 9-10): Soul schema/prompts → competitive generator → Node integration
Milestone 2.5 (Days 11-14): Frontend pages → hooks → dashboard updates
Milestone 2.6 (Day 15):    Integration test → manual UI verification
```

Dependencies: 2.2 needs 2.1. 2.3 needs 2.1. 2.4 needs 2.3. 2.5 needs 2.1+2.3. 2.6 needs all.

---

## File Inventory

### New Files (21)

| # | File | Milestone |
|---|------|-----------|
| 1 | `packages/db/src/schema/tournaments.ts` | 2.1 |
| 2 | `packages/db/src/schema/tournament-entries.ts` | 2.1 |
| 3 | `packages/db/src/schema/leaderboard-entries.ts` | 2.1 |
| 4 | `packages/server/src/routes/tournaments.ts` | 2.1 |
| 5 | `packages/server/src/services/tournament-manager.ts` | 2.1 |
| 6 | `packages/server/src/services/leaderboard-service.ts` | 2.3 |
| 7 | `packages/server/src/middleware/agent-isolation.ts` | 2.2 |
| 8 | `packages/server/src/services/audit-logger.ts` | 2.2 |
| 9 | `packages/runtime/src/aegis_runtime/tournament/__init__.py` | 2.1 |
| 10 | `packages/runtime/src/aegis_runtime/tournament/coordinator.py` | 2.1 |
| 11 | `packages/runtime/src/aegis_runtime/api/routes/tournaments.py` | 2.1 |
| 12 | `packages/web/src/components/tournament/TournamentListPage.tsx` | 2.5 |
| 13 | `packages/web/src/components/tournament/CreateTournamentPage.tsx` | 2.5 |
| 14 | `packages/web/src/components/tournament/TournamentDetailPage.tsx` | 2.5 |
| 15 | `packages/web/src/components/tournament/LeaderboardTable.tsx` | 2.5 |
| 16 | `packages/web/src/components/tournament/AgentComparisonPage.tsx` | 2.5 |
| 17 | `packages/web/src/hooks/useTournament.ts` | 2.5 |
| 18 | `packages/web/src/hooks/useTournamentSSE.ts` | 2.5 |
| 19 | `packages/runtime/tests/test_tournament.py` | 2.6 |
| 20 | `packages/runtime/tests/fixtures/mean_reverter_strategy.py` | 2.6 |
| 21 | `packages/runtime/tests/fixtures/buy_hold_strategy.py` | 2.6 |

### Modified Files (16)

| # | File | Change | Milestone |
|---|------|--------|-----------|
| 1 | `packages/db/src/schema/runs.ts` | Add nullable `tournamentId` FK | 2.1 |
| 2 | `packages/db/src/schema/index.ts` | Export 3 new tables | 2.1 |
| 3 | `packages/server/src/index.ts` | Mount tournament routes | 2.1 |
| 4 | `packages/server/src/routes/webhooks.ts` | Tournament run completion handling | 2.1 |
| 5 | `packages/server/src/services/run-manager.ts` | Tournament run start | 2.1 |
| 6 | `packages/server/src/lib/python-client.ts` | prefetchData, startTournament | 2.1 |
| 7 | `packages/server/src/services/event-bus.ts` | Tournament event channels | 2.1 |
| 8 | `packages/server/src/routes/events-sse.ts` | Tournament SSE stream | 2.1 |
| 9 | `packages/server/src/routes/agents.ts` | Isolation middleware | 2.2 |
| 10 | `packages/server/src/routes/runs.ts` | Isolation middleware + competitive soul | 2.2/2.4 |
| 11 | `packages/server/src/routes/souls.ts` | Isolation middleware | 2.2 |
| 12 | `packages/runtime/src/aegis_runtime/api/app.py` | Mount tournament router | 2.1 |
| 13 | `packages/runtime/src/aegis_runtime/soul/schemas.py` | Competitive soul fields | 2.4 |
| 14 | `packages/runtime/src/aegis_runtime/soul/prompts.py` | Competitive prompt template | 2.4 |
| 15 | `packages/runtime/src/aegis_runtime/soul/generator.py` | `generate_competitive()` | 2.4 |
| 16 | `packages/runtime/src/aegis_runtime/api/routes/soul.py` | Accept competitiveContext | 2.4 |
| 17 | `packages/web/src/main.tsx` | Tournament routes | 2.5 |
| 18 | `packages/web/src/lib/api-client.ts` | Tournament API methods | 2.5 |
| 19 | `packages/web/src/components/dashboard/DashboardPage.tsx` | Tournament section | 2.5 |
| 20 | `packages/web/src/components/ui/Layout.tsx` | Nav link | 2.5 |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Async engine starvation with many agents | Slow execution | Engines yield every bar. Upgrade to ProcessPoolExecutor if >10 agents needed. |
| Shared DataFrame mutation | Data corruption | Polars DataFrames are immutable. `prepare_features` creates per-engine copy. |
| Tournament status inconsistency on crash | Stuck tournaments | `handleRunCompleted` is idempotent (reads from DB). Add health-check reconciliation endpoint. |
| Soul generation leaking competitor data | Isolation violation | `getAgentStanding` returns only aggregates. Prompt instructs no cross-agent references. Post-gen grep as safety net. |
| `runs.tournamentId` migration breaking Phase 1 | Regression | Nullable column, no default. Existing rows get NULL. Run full Phase 1 test suite after migration. |
