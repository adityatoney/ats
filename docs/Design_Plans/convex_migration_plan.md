# PostgreSQL → Convex Migration Plan

## Context

Migrating the AegisTrader database from PostgreSQL (Drizzle ORM) to Convex. This replaces the current 16-table Postgres schema with Convex document tables, rewrites the Node.js server to call Convex functions instead of Drizzle, updates the Python runtime's direct SQL access, updates the React frontend to use Convex's reactive hooks, creates a one-shot data migration script, and provides a verification test suite.

---

## Phase 1: Convex Setup & Schema

### 1.1 Initialize Convex
- `npx convex init` at monorepo root
- Creates `convex/` directory with `_generated/` and `tsconfig.json`
- Add `CONVEX_URL` to `.env`
- Add `convex` dependency to root `package.json`

### 1.2 Define Schema — `convex/schema.ts`

All 16 tables mapped. Convex auto-provides `_id` and `_creationTime` (replaces `id` UUID and `createdAt`). Every table gets `pgId: v.string()` for migration mapping (removable post-migration).

**Numeric precision**: Use `v.float64()` for all financial fields. Paper trading platform, data already flows through JS float64 in the webhook pipeline.

**Timestamps**: Store as `v.float64()` (Unix ms), matching Convex's `_creationTime` format.

```
users           — pgId, email, name
                  indexes: by_pgId, by_email

projects        — pgId, ownerId→users, name, description?
                  indexes: by_pgId, by_ownerId

agents          — pgId, projectId→projects, name, status, updatedAt
                  indexes: by_pgId, by_projectId

strategyVersions — pgId, agentId→agents, version, sourceKind, strategyMd?, strategyPine?, strategyPy?, strategyIrJson?(any), configJson(any)
                   indexes: by_pgId, by_agentId_version

soulVersions    — pgId, agentId→agents, version, soulMd, soulJson(any), status, derivedFromRunId?→runs
                  indexes: by_pgId, by_agentId_version

runs            — pgId, agentId→agents, strategyVersionId→strategyVersions, tournamentId?→tournaments, branchId?, status, runType, configJson(any), metricsJson?(any), totalBars, processedBars, startedAt?, completedAt?, errorMessage?
                  indexes: by_pgId, by_agentId, by_tournamentId, by_status

orders          — pgId, runId→runs, symbol, side, orderType, quantity, limitPrice?, stopPrice?, status, submittedAtSim?, filledAtSim?, barIndex
                  indexes: by_pgId, by_runId

fills           — pgId, orderId→orders, runId→runs, fillPrice, fillQuantity, fee, slippage, filledAtSim?
                  indexes: by_pgId, by_orderId, by_runId

positions       — pgId, runId→runs, symbol, quantity, avgEntryPrice, currentPrice, unrealizedPnl, realizedPnl
                  indexes: by_pgId, by_runId_symbol

portfolioSnapshots — pgId, runId→runs, barIndex, timestampSimulated?, cash, equity, positionsJson(any), drawdown, highWaterMark
                     indexes: by_pgId, by_runId_barIndex

agentEvents     — pgId, runId→runs, eventType, payload(any), timestampSimulated?, barIndex?
                  indexes: by_pgId, by_runId

checkpoints     — pgId, runId→runs, barIndex, timestampSimulated?, stateBlob(any)
                  indexes: by_pgId, by_runId_barIndex

branches        — pgId, runId→runs, parentCheckpointId→checkpoints, parentBranchId?→branches, parentRunId→runs, changeSummary, rationale?, creatorType, overridesJson(any), resultDeltaJson?(any), status
                  indexes: by_pgId, by_runId, by_parentRunId

tournaments     — pgId, projectId→projects, name, configJson(any), status, dataSnapshotId?, agentCount, completedCount, startedAt?, completedAt?
                  indexes: by_pgId, by_projectId

tournamentEntries — pgId, tournamentId→tournaments, agentId→agents, runId?→runs, finalRank?, status
                    indexes: by_pgId, by_tournamentId, by_tournamentId_agentId

leaderboardEntries — pgId, tournamentId→tournaments, agentId→agents, runId→runs, rank, totalReturn?, sharpeRatio?, sortinoRatio?, maxDrawdown?, winRate?, profitFactor?, netProfit?, totalTrades?, metricsJson(any), computedAt
                     indexes: by_pgId, by_tournamentId, by_tournamentId_agentId
```

### 1.3 Convex Functions — CRUD Mutations & Queries

Create one file per logical domain under `convex/`:

| File | Purpose |
|---|---|
| `convex/users.ts` | CRUD for users; enforce email uniqueness via index check |
| `convex/projects.ts` | CRUD for projects |
| `convex/agents.ts` | CRUD for agents |
| `convex/strategyVersions.ts` | CRUD; enforce unique(agentId, version) via index |
| `convex/soulVersions.ts` | CRUD; enforce unique(agentId, version) |
| `convex/runs.ts` | CRUD for runs |
| `convex/orders.ts` | CRUD for orders |
| `convex/fills.ts` | CRUD for fills |
| `convex/positions.ts` | CRUD; enforce unique(runId, symbol) |
| `convex/portfolioSnapshots.ts` | CRUD for snapshots |
| `convex/agentEvents.ts` | CRUD for events |
| `convex/checkpoints.ts` | CRUD for checkpoints |
| `convex/branches.ts` | CRUD for branches |
| `convex/tournaments.ts` | CRUD for tournaments |
| `convex/tournamentEntries.ts` | CRUD; enforce unique(tournamentId, agentId) |
| `convex/leaderboardEntries.ts` | CRUD; enforce unique(tournamentId, agentId) |
| `convex/deleteService.ts` | Cascade delete mutations (deleteRun, deleteAgent, deleteTournament) |
| `convex/migrations.ts` | Batch insert mutation + verification queries (migration-only) |

Each CRUD file exposes:
- **Queries**: `list`, `get`, `getByPgId` (migration), plus domain-specific queries
- **Mutations**: `create`, `update`, `remove`, plus domain-specific mutations

**Unique constraint enforcement**: Check-then-insert within a single mutation (atomic in Convex).

**The LEFT JOIN replacement** (runs.ts `/:id/orders`): Fetch orders by runId, then fetch fills by orderId for each, combine in JS. Use `Promise.all` for parallel resolution.

**Atomic counter** (tournament completedCount): Read document, increment field, patch — naturally atomic in a single Convex mutation.

---

## Phase 2: Server Rewrite

### 2.1 Replace `packages/server/src/lib/db.ts`

Create `packages/server/src/lib/convex.ts`:
```ts
import { ConvexHttpClient } from "convex/browser";
const client = new ConvexHttpClient(process.env.CONVEX_URL!);
export { client as convex };
```

### 2.2 Rewrite Server Routes

Each route file replaces Drizzle queries with Convex client calls:

| File | Key Changes |
|---|---|
| `routes/agents.ts` | Replace `db.query.agents.findMany/findFirst`, `db.insert(agents)`, Drizzle imports → `convex.query/mutation` calls |
| `routes/runs.ts` | Replace all Drizzle queries. LEFT JOIN (orders+fills) becomes two queries + JS merge |
| `routes/projects.ts` | Replace find/insert for projects and agents |
| `routes/webhooks.ts` | Most complex — each event type's insert/update/find becomes Convex mutation calls. Move the complex logic (order.filled find-then-update) into a Convex mutation for atomicity |
| `routes/branches.ts` | Replace branch + run queries |
| `routes/checkpoints.ts` | Replace checkpoint lookup, run/branch insert. `.returning()` replaced by mutation return value |
| `routes/souls.ts` | Replace soulVersion queries and updates |
| `routes/tournaments.ts` | Replace tournament/entry/leaderboard queries |

### 2.3 Rewrite Services

| File | Key Changes |
|---|---|
| `services/run-manager.ts` | Replace Drizzle insert/update/find → Convex mutations. `insert().returning()` → mutation returns `_id` |
| `services/tournament-manager.ts` | Replace all Drizzle calls. `sql\`completedCount + 1\`` → Convex mutation with read-modify-write |
| `services/leaderboard-service.ts` | Replace delete + insert loop → Convex mutation |
| `services/delete-service.ts` | Replace with calls to `convex/deleteService.ts` mutations (cascade logic moves to Convex) |
| `services/strategy-artifacts.ts` | Replace `db.update(strategyVersions)` → Convex mutation |
| `middleware/agent-isolation.ts` | Replace `db.query.runs.findFirst` → Convex query |

### 2.4 SSE & Event Bus — No Changes Needed
`services/event-bus.ts` and `routes/events-sse.ts` use in-memory EventEmitter, no DB calls. Keep as-is.

### 2.5 Update Server Dependencies
- Remove: `@aegis/db`, `drizzle-orm`, `postgres`
- Add: `convex`

---

## Phase 3: Python Runtime Changes

### 3.1 Replace Direct SQL with HTTP Calls to Node

Currently Python (`repositories.py`) directly queries Postgres. Two options:
- **Option A**: Python calls Convex directly via HTTP (Convex has an HTTP API)
- **Option B**: Python calls existing Node webhook endpoint (already the primary pattern)

**Chosen: Option B** — The Python runtime already sends webhook events to Node for most writes. The `repositories.py` direct SQL calls are limited to:
- `RunRepository.get_run()` — Replace with HTTP call to `GET /api/runs/:id`
- `RunRepository.update_run()` — Replace with HTTP call to `PATCH /api/runs/:id` (new endpoint)
- `OrderRepository.insert_order()` — Already handled via webhook `order.submitted`; remove direct insert
- `PortfolioSnapshotRepository.insert_snapshot()` — Already handled via webhook `run.progress`; remove direct insert

### 3.2 Files to Modify
- `packages/runtime/src/aegis_runtime/db/connection.py` — Remove (no more Postgres)
- `packages/runtime/src/aegis_runtime/db/repositories.py` — Replace with HTTP client calling Node API
- Remove `psycopg` from Python dependencies

---

## Phase 4: Frontend Changes

### 4.1 Add Convex React Provider

In `packages/web/src/main.tsx`, wrap app with `ConvexProvider`:
```tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
// Wrap <App /> with <ConvexProvider client={convex}>
```

### 4.2 Optionally Replace React Query with Convex Hooks

The frontend currently uses `@tanstack/react-query` with `fetch()` to the Hono API. Two approaches:
- **Minimal change**: Keep React Query + fetch → Hono API → Convex (works immediately, no frontend rewrite)
- **Full Convex**: Replace React Query with `useQuery`/`useMutation` from Convex React client (more work, gains real-time reactivity)

**Chosen: Minimal change for now** — Keep the Hono API layer. The frontend talks to Hono, Hono talks to Convex. This limits the blast radius. Real-time is already handled by SSE. A follow-up task can replace React Query with Convex hooks.

### 4.3 Dependencies
- Add: `convex` to `packages/web`
- Add `VITE_CONVEX_URL` to `.env`

---

## Phase 5: Migration Script

### 5.1 Create `scripts/migrate-to-convex.ts`

Standalone Node script using `ConvexHttpClient` + `postgres` to read from PG and write to Convex.

**Topological insertion order** (respects FK dependencies):
```
Level 0: users
Level 1: projects
Level 2: agents, tournaments
Level 3: strategyVersions, tournamentEntries
Level 4: runs (→ agents, strategyVersions, tournaments)
Level 5: orders, positions, portfolioSnapshots, agentEvents, checkpoints, soulVersions (→ runs)
Level 6: fills (→ orders, runs), leaderboardEntries (→ tournaments, agents, runs)
Level 7: branches (→ runs, checkpoints; self-ref parentBranchId)
```

**ID mapping**: In-memory `Map<string, ConvexId>` per table. Postgres UUID → Convex `_id`.

**Batch size**: 100 documents per mutation call (Convex ~8MB transaction limit).

**Self-referencing FK** (branches.parentBranchId): Two-pass — first insert all branches without parentBranchId, then patch in the self-references.

**Conversion helpers**:
- `pgTimestampToMs(ts)` → `new Date(ts).getTime()` or `undefined`
- `pgNumericToFloat(val)` → `parseFloat(val)` or `undefined`
- `resolveFk(idMap, pgUuid)` → Convex `_id` or `undefined` (for nullable FKs)

### 5.2 Convex Migration Mutation — `convex/migrations.ts`

```ts
export const batchInsert = mutation({
  args: { table: v.string(), documents: v.array(v.any()) },
  handler: async (ctx, { table, documents }) => {
    const ids = [];
    for (const doc of documents) {
      ids.push(await ctx.db.insert(table, doc));
    }
    return ids;
  },
});

export const patchDocument = mutation({
  args: { table: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, { table, id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});
```

---

## Phase 6: Verification Test Suite

### 6.1 Create `scripts/verify-migration.ts`

Four categories of verification, all run post-migration:

#### A. Row Count Verification
For each of the 16 tables, compare `SELECT count(*) FROM pg_table` with Convex document count. Must match exactly.

Convex query helper:
```ts
export const countTable = query({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    const docs = await ctx.db.query(table).collect();
    return docs.length;
  },
});
```

#### B. Referential Integrity — Every ID Points to an Existing Document

For all 28 FK relationships across 16 tables, verify every referenced `_id` resolves to an existing document:

```
projects.ownerId → users
agents.projectId → projects
strategyVersions.agentId → agents
soulVersions.agentId → agents
soulVersions.derivedFromRunId? → runs
runs.agentId → agents
runs.strategyVersionId → strategyVersions
runs.tournamentId? → tournaments
orders.runId → runs
fills.orderId → orders
fills.runId → runs
positions.runId → runs
portfolioSnapshots.runId → runs
agentEvents.runId → runs
checkpoints.runId → runs
branches.runId → runs
branches.parentCheckpointId → checkpoints
branches.parentBranchId? → branches
branches.parentRunId → runs
tournaments.projectId → projects
tournamentEntries.tournamentId → tournaments
tournamentEntries.agentId → agents
tournamentEntries.runId? → runs
leaderboardEntries.tournamentId → tournaments
leaderboardEntries.agentId → agents
leaderboardEntries.runId → runs
```

Convex verification query fetches all docs from each table and calls `ctx.db.get(refId)` for every FK field. Returns array of errors.

#### C. Null Handling Verification
For each nullable Postgres column, count NULLs in Postgres and count documents missing that field in Convex. Counts must match.

Key nullable fields to verify:
- `projects.description`, `runs.tournamentId`, `runs.metricsJson`, `runs.startedAt`, `runs.completedAt`, `runs.errorMessage`, `orders.limitPrice`, `orders.stopPrice`, `orders.submittedAtSim`, `orders.filledAtSim`, `fills.filledAtSim`, `soulVersions.derivedFromRunId`, `branches.parentBranchId`, `branches.rationale`, `branches.resultDeltaJson`, `tournaments.dataSnapshotId`, `tournaments.startedAt`, `tournaments.completedAt`, `tournamentEntries.runId`, `tournamentEntries.finalRank`, `strategyVersions.strategyMd`, `strategyVersions.strategyPine`, `strategyVersions.strategyPy`, `strategyVersions.strategyIrJson`

#### D. Data Fidelity Spot Checks
For each table, fetch a sample (up to 10 rows) from Postgres, look up by `pgId` in Convex, and compare all field values. Verify:
- String fields match exactly
- Numeric fields match within float64 tolerance (±1e-8)
- Timestamps converted correctly (Postgres Date → Unix ms)
- JSONB objects deeply equal

---

## Phase 7: Cleanup

### 7.1 Remove Postgres Dependencies
- Remove `@aegis/db` package entirely (or gut it)
- Remove `drizzle-orm`, `drizzle-kit`, `postgres` from all package.json files
- Remove `psycopg` from Python `pyproject.toml`
- Remove `DATABASE_URL` from `.env`
- Remove `db:generate`, `db:migrate`, `db:seed` scripts from root `package.json`

### 7.2 Update Seed Script
Create `convex/seed.ts` (or use Convex dashboard) to recreate the seed data:
- 1 user (Default Trader)
- 1 project (Default Project)
- 4 agents with strategy versions

### 7.3 Remove `pgId` Indexes (Optional)
After migration is verified, the `by_pgId` indexes on all tables can be removed to save index storage.

---

## Files to Create (New)

| Path | Purpose |
|---|---|
| `convex/schema.ts` | Convex schema definition |
| `convex/users.ts` | User queries/mutations |
| `convex/projects.ts` | Project queries/mutations |
| `convex/agents.ts` | Agent queries/mutations |
| `convex/strategyVersions.ts` | Strategy version queries/mutations |
| `convex/soulVersions.ts` | Soul version queries/mutations |
| `convex/runs.ts` | Run queries/mutations |
| `convex/orders.ts` | Order queries/mutations |
| `convex/fills.ts` | Fill queries/mutations |
| `convex/positions.ts` | Position queries/mutations |
| `convex/portfolioSnapshots.ts` | Snapshot queries/mutations |
| `convex/agentEvents.ts` | Event queries/mutations |
| `convex/checkpoints.ts` | Checkpoint queries/mutations |
| `convex/branches.ts` | Branch queries/mutations |
| `convex/tournaments.ts` | Tournament queries/mutations |
| `convex/tournamentEntries.ts` | Entry queries/mutations |
| `convex/leaderboardEntries.ts` | Leaderboard queries/mutations |
| `convex/deleteService.ts` | Cascade delete mutations |
| `convex/migrations.ts` | Migration helpers (batch insert, verification) |
| `convex/seed.ts` | Seed data |
| `packages/server/src/lib/convex.ts` | ConvexHttpClient singleton |
| `scripts/migrate-to-convex.ts` | One-shot PG→Convex migration |
| `scripts/verify-migration.ts` | Post-migration verification suite |

## Files to Modify (Existing)

| Path | Change |
|---|---|
| `packages/server/src/routes/agents.ts` | Replace Drizzle → Convex client calls |
| `packages/server/src/routes/runs.ts` | Replace Drizzle → Convex; rewrite LEFT JOIN |
| `packages/server/src/routes/projects.ts` | Replace Drizzle → Convex |
| `packages/server/src/routes/webhooks.ts` | Replace all Drizzle inserts/updates → Convex mutations |
| `packages/server/src/routes/branches.ts` | Replace Drizzle → Convex |
| `packages/server/src/routes/checkpoints.ts` | Replace Drizzle → Convex |
| `packages/server/src/routes/souls.ts` | Replace Drizzle → Convex |
| `packages/server/src/routes/tournaments.ts` | Replace Drizzle → Convex |
| `packages/server/src/services/run-manager.ts` | Replace Drizzle → Convex |
| `packages/server/src/services/tournament-manager.ts` | Replace Drizzle → Convex; fix atomic counter |
| `packages/server/src/services/leaderboard-service.ts` | Replace Drizzle → Convex |
| `packages/server/src/services/delete-service.ts` | Replace with Convex deleteService calls |
| `packages/server/src/services/strategy-artifacts.ts` | Replace Drizzle update → Convex mutation |
| `packages/server/src/middleware/agent-isolation.ts` | Replace Drizzle query → Convex query |
| `packages/server/package.json` | Remove drizzle-orm/postgres, add convex |
| `packages/runtime/src/aegis_runtime/db/repositories.py` | Replace SQL → HTTP calls to Node |
| `packages/runtime/src/aegis_runtime/db/connection.py` | Remove (no Postgres) |
| `packages/web/package.json` | Add convex |
| `package.json` | Remove db:* scripts, add convex scripts |
| `.env` | Add CONVEX_URL, VITE_CONVEX_URL; remove DATABASE_URL |

## Verification

1. **Schema deployment**: `npx convex dev` — schema should deploy without errors
2. **Migration script**: `npx tsx scripts/migrate-to-convex.ts` — should complete with 0 errors
3. **Verification suite**: `npx tsx scripts/verify-migration.ts` — all 4 categories pass:
   - Row counts match for all 16 tables
   - 0 referential integrity errors across all 28 FK relationships
   - Null counts match for all nullable columns
   - Spot check data values match within tolerance
4. **Server smoke test**: `pnpm dev:server` + `pnpm dev:runtime` + manual API calls:
   - `GET /api/agents` returns agents
   - `POST /api/runs` starts a backtest
   - Webhook events persist correctly
   - SSE streams work
5. **Existing tests**: `npx turbo run test` — all TS tests pass (may need test updates for Convex mocking)
6. **Python tests**: `cd packages/runtime && uv run pytest tests/ -v` — all pass
