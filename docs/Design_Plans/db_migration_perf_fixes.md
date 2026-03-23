# Fix React Performance / Re-rendering Issues Post-Migration

## Context

After the PostgreSQL → Convex migration, the UI is noticeably slower when viewing run details. The root causes are: (1) unbounded data fetching — portfolio snapshots (up to 27K+) and orders are returned in full with no pagination or downsampling, (2) redundant polling on top of SSE-driven invalidation, (3) cascading query invalidations that re-fetch huge datasets on every SSE event, and (4) unbounded SSE event array growth in memory.

**Note:** The SSE hook (`useSSE.ts`) uses `useCallback` with `[runId]` dependency, so the connection is stable — this is NOT a reconnection bug despite initial suspicion.

---

## Fix 1: Server-Side Portfolio Downsampling (CRITICAL)

**Why:** `GET /runs/:id/portfolio` returns ALL snapshots (27K+) with no limit. Each snapshot includes `positionsJson`. `normalizeAll()` maps over every document.

**Files:**

- `/packages/server/src/routes/runs.ts` (lines 86-90)

**Changes:**

- Accept `?maxPoints=500` query param (default 500)
- After fetching from Convex, downsample: if `snapshots.length > maxPoints`, keep every Nth snapshot (always include first and last)
- Apply `normalizeAll` only to the downsampled subset
- Strip `positionsJson` from the response (only needed for the positions table, not the equity chart)

---

## Fix 2: Selective Query Invalidation (HIGH)

**Why:** Each SSE `run.progress` event triggers invalidation of run + orders + portfolio queries. During fast backtests, this means the full 27K portfolio is re-fetched on every bar.

**File:**

- `/packages/web/src/components/run/RunDetailPage.tsx` (lines 55-72)

**Changes:**

- `run.progress` → only invalidate `['run', id]` (progress bar)
- `run.completed` → invalidate all three (run, orders, portfolio) — one-time terminal event
- `run.failed` → only invalidate `['run', id]`
- `order.submitted` / `order.filled` → only invalidate `['run-orders', id]`

---

## Fix 3: Remove Redundant Polling (HIGH)

**Why:** `useRun` polls every 2s while run is active, duplicating SSE-driven invalidation. Same in `useTournament`.

**Files:**

- `/packages/web/src/hooks/useRun.ts` (lines 9-14) — remove `refetchInterval`
- `/packages/web/src/hooks/useTournament.ts` (lines 9-12) — remove `refetchInterval`

---

## Fix 4: Cap SSE Event Array (HIGH)

**Why:** Events accumulate unbounded in `useState` array. Long backtests produce thousands. Only last ~100 are ever displayed.

**File:**

- `/packages/web/src/hooks/useSSE.ts` (event handlers)

**Changes:**

- Cap array at 200 entries: `next.length > 200 ? next.slice(-200) : next`
- Same fix in `/packages/web/src/hooks/useTournamentSSE.ts`

---

## Fix 5: Defer Data Loading by Tab (MEDIUM)

**Why:** `useRunOrders` and `useRunPortfolio` fire immediately regardless of active tab.

**Files:**

- `/packages/web/src/hooks/useRun.ts` — add `enabled` parameter
- `/packages/web/src/components/run/RunDetailPage.tsx` — pass `enabled` based on active tab

---

## Fix 6: Separate Chart Creation from Marker Updates (MEDIUM)

**Why:** Toggling a symbol filter in `EquityCurve` destroys and recreates the entire chart. Chart creation is expensive (DOM + canvas).

**File:**

- `/packages/web/src/components/run/EquityCurve.tsx`

**Changes:**

- Split into two effects: chart creation (depends on snapshots) and marker update (depends on visibleSymbols, orders)
- Use `useMemo` for `buildEquityData(snapshots)`
- Store chart/series in refs for marker-only updates

---

## Fix 7: Stabilize Empty Array References (LOW)

**File:**

- `/packages/web/src/components/run/RunDetailPage.tsx` (lines 231-233)

**Changes:**

- Define `const EMPTY_ARRAY: Array<Record<string, unknown>> = []` at module level
- Use `?? EMPTY_ARRAY` instead of `|| []` to prevent new ref on every render

---

## Implementation Order

1. **Fix 1 + Fix 2** together (biggest impact — stops the flood of full-dataset refetches)
2. **Fix 3** (one-line removal in 2 files)
3. **Fix 4** (quick cap in SSE hooks)
4. **Fix 6** (chart refactor)
5. **Fix 5 + Fix 7** (cleanup)

## Verification

- Start a backtest run, open run detail page, watch browser DevTools Network tab — should see portfolio endpoint return ~500 points max, not 27K
- During active backtest, confirm no portfolio refetches until run completes
- Confirm no 2s polling requests in Network tab
- Toggle symbol filters on equity chart — should update markers without chart flash
- Run a long backtest (1000+ bars) — confirm memory stays stable in DevTools Performance tab

