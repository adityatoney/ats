# Tournament Throughput and State-Consistency Fix Plan

## Summary

This plan addresses four observed issues in the current repo:

1. Tournament runs are slow because the runtime produces a high volume of Convex writes, and the Node write queue serializes expensive batches that still persist too much data.
2. The tournament detail page only shows the overall progress bar while the tournament is `in_progress`, so finished tournaments lose the indicator entirely.
3. Tournament completion state is inconsistent: the tournament can reach `completed` while most `tournamentEntries` remain `running`.
4. The dashboard’s “Recent Tournaments” section is not actually recent because the API returns tournaments in default ascending creation order and the UI takes the first three.

The most important correctness bug is already identifiable from the current code and live data:
- `convex/webhookHandlers.processBatch` returns terminal results without `runId`
- `packages/server/src/services/write-queue.ts` then matches each result back to `batch.find((e) => e.eventType === result.eventType)`
- when a batch contains multiple `run.completed` events, every result is attributed to the first completed run in the batch
- this explains the live state at `kx74j98tgsp41rabeckkzj0wkx847gp9`: tournament `completedCount = 5`, tournament status `completed`, but only one entry marked `completed` and only one leaderboard row

I could not get Convex Insights for the configured project because the local CLI does not have access to that deployment, so the performance part below is based on code audit and the live API state.

## Public APIs, Interfaces, and Type Changes

### Internal runtime event contract changes
Add `runId` to terminal batch results returned from `convex/webhookHandlers.processBatch`.

Add a deterministic `clientOrderId` to runtime-emitted order events:
- `order.submitted`
- `order.filled`

This is an internal interface between Python runtime and Node/Convex, not a user-facing API.

### Convex schema changes
Add `clientOrderId?: string` to `orders` and index it for direct lookup within a run:
- preferred index: `by_runId_and_clientOrderId`

No external HTTP API shape needs to change.

### HTTP/API behavior changes
Keep the existing REST routes, but change behavior:
- `GET /api/tournaments` should return tournaments sorted descending by recency
- `GET /api/tournaments/:id` should continue returning entries plus runs, but the server should normalize entry display status defensively from run status when run data is present

## Implementation Plan

### 1. Fix terminal tournament bookkeeping so completion is atomic and correct

#### Problem
Terminal bookkeeping is split across two systems:
- Convex mutation updates `runs` and `agents`
- Node callback later updates `tournamentEntries` and `tournaments.completedCount`

Because the callback result mapping is wrong, tournament state diverges.

#### Changes
In [convex/webhookHandlers.ts](/Users/adityat/Documents/Projects/ats/convex/webhookHandlers.ts):

- Change terminal event handling in `processBatch` so each terminal result includes:
  - `runId`
  - `agentId`
  - `tournamentId`
  - `eventType`
  - `shouldFinalizeTournament` boolean or a dedupable `tournamentIdToFinalize`

- Move `tournamentEntries` status updates into `processBatch` itself:
  - on `run.completed`, find the tournament entry by `(tournamentId, agentId)` using `by_tournamentId_agentId` and patch it to `completed`
  - on `run.failed`, patch the entry to `failed`

- Move `completedCount` increment into the same mutation:
  - read the tournament once
  - increment `completedCount`
  - determine whether that increment reaches `agentCount`
  - return that finalization signal from the mutation

- Keep leaderboard computation outside Convex if desired, but only after the mutation returns which tournaments are ready to finalize

In [packages/server/src/services/write-queue.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/services/write-queue.ts):

- Remove the current `batch.find(...)` eventType-based re-association logic entirely
- Consume the explicit `runId` returned by `processBatch`
- Deduplicate tournament finalization calls by `tournamentId` per flush
- Call `tournamentManager.finalizeTournament(tournamentId)` once per tournament ready for finalization

In [packages/server/src/services/tournament-manager.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/services/tournament-manager.ts):

- Remove or deprecate `handleRunCompleted` and `handleRunFailed` as the primary live path
- Keep `finalizeTournament` as the post-terminal aggregation step
- Ensure `finalizeTournament` only computes leaderboard after all entry statuses are already correct

### 2. Reduce tournament write pressure on Convex

#### Problem
The hot path currently does too much write work:
- Python emits `run.progress` every 5 bars per run
- Convex still inserts a `portfolioSnapshots` document for every progress event
- checkpoint payloads can be large
- `order.filled` scans all pending orders for the run, then filters in JS
- Node write queue is single-flight and processes relatively small batches

This is especially expensive in tournaments because multiple engines emit concurrently.

#### Changes

In [packages/runtime/src/aegis_runtime/simulator/engine.py](/Users/adityat/Documents/Projects/ats/packages/runtime/src/aegis_runtime/simulator/engine.py):

- Keep live `run.progress` emission frequency at every 5 bars for UI responsiveness and SSE
- Add a deterministic `clientOrderId` when creating order events
  - use an engine-local monotonic counter or a deterministic composite string
  - the same `clientOrderId` must be used for both submitted and filled events

In [convex/schema.ts](/Users/adityat/Documents/Projects/ats/convex/schema.ts):

- Add `clientOrderId` to `orders`
- add an index that supports direct lookup by run and order identity

In [convex/webhookHandlers.ts](/Users/adityat/Documents/Projects/ats/convex/webhookHandlers.ts):

- Change `order.submitted` handling to persist `clientOrderId`
- Change `order.filled` handling to resolve the order via `clientOrderId` instead of querying all pending orders and filtering in JS
- For `run.progress`, stop inserting a snapshot for every progress event
- Persist snapshots only:
  - every 25 bars
  - and the final bar
- Persist `runs.processedBars` and `runs.totalBars` only:
  - every 100 bars
  - and the final bar
- Keep SSE immediate; DB progress remains a recovery snapshot, not the real-time source

In [packages/server/src/services/write-queue.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/services/write-queue.ts):

- Add `enqueueBatch(events)` so `/runtime-events-batch` can append a whole batch without per-event flush decisions
- Increase throughput defaults:
  - `MAX_BATCH_SIZE` from `25` to `50`
  - `FLUSH_INTERVAL_MS` from `200` to `50`
- Keep a single in-flight flush to avoid avoidable OCC pressure, but make each flush more productive
- Bulk-write deferred `agentEvents` sequentially by chunk instead of `Promise.all` if the current deployment shows contention; default to sequential chunks for safer load shaping

In [packages/server/src/routes/webhooks.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/routes/webhooks.ts):

- Switch the batch endpoint to one queue append operation instead of looping `enqueue(...)`
- Preserve immediate SSE fanout before persistence

### 3. Make tournament detail progress visible and robust

#### Problem
The page only renders the overall progress section when `status === 'in_progress'`, so a completed tournament with valid counts shows no progress section. Also, agent cards trust `entry.status` even when `run.status` is newer.

#### Changes
In [packages/web/src/components/tournament/TournamentDetailPage.tsx](/Users/adityat/Documents/Projects/ats/packages/web/src/components/tournament/TournamentDetailPage.tsx):

- Render the overall progress card for any non-pending tournament where `agentCount > 0`
- Compute progress percentage from:
  - `completedCount / agentCount`
- Show `100%` for completed tournaments

For each agent card:
- derive a display status with precedence:
  - `run.status` if `run` exists and is terminal
  - otherwise `entry.status`
- derive progress bars from `run.processedBars / run.totalBars`
- if `run.status` is terminal and `processedBars === totalBars`, visually show the run as complete even if `entry.status` lags
- this is a defensive UI fallback; backend correctness still needs the atomic fix above

In [packages/web/src/hooks/useTournament.ts](/Users/adityat/Documents/Projects/ats/packages/web/src/hooks/useTournament.ts):

- keep polling while status is `pending` or `in_progress`
- after terminal state, stop polling as it already does

### 4. Fix “Recent Tournaments” ordering

#### Problem
The dashboard uses `tournaments.slice(0, 3)` on an unsorted API result. Convex `.collect()` preserves ascending creation order by default, so the dashboard currently shows old tournaments first.

#### Changes

Preferred fix in the server/API layer:

In [packages/server/src/routes/tournaments.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/routes/tournaments.ts):

- sort tournaments descending before returning them
- sort key:
  - `completedAt ?? startedAt ?? _creationTime`
- use the same sorting for both:
  - `GET /api/tournaments`
  - project-filtered tournament lists

Optional Convex-side cleanup later:
- if tournament list size grows materially, replace the full-table `.collect()` with a dedicated recent query path and appropriate index strategy
- that is not required for the current fix

No client-side special casing should remain in [packages/web/src/components/dashboard/DashboardPage.tsx](/Users/adityat/Documents/Projects/ats/packages/web/src/components/dashboard/DashboardPage.tsx); it should keep taking the first three from an already-sorted response.

### 5. Clean up leaderboard finalization behavior

#### Problem
The current leaderboard service reads and writes in many small server-to-Convex round trips and depends on `tournamentEntries.status === completed`. Once entry status is corrected, leaderboard rows will be correct again, but the service is still chatty.

#### Changes
In [packages/server/src/services/leaderboard-service.ts](/Users/adityat/Documents/Projects/ats/packages/server/src/services/leaderboard-service.ts):

- keep current behavior for now, but tighten assumptions:
  - only finalize after all terminal statuses have already been written by `processBatch`
- as a follow-up within the same change set if time permits:
  - fetch all completed runs once
  - avoid repeated `getByTournamentAndAgent` queries during rank assignment by building an entry map up front

This is secondary to the correctness and hot-path fixes.

## Test Cases and Scenarios

### Backend correctness
1. Single batch with multiple `run.completed` events for the same tournament updates the correct `tournamentEntries`, increments `completedCount` correctly, and finalizes once.
2. Mixed batch with `run.completed` and `run.failed` events updates the right entries and produces `partially_failed` when appropriate.
3. A completed tournament never has `completedCount === agentCount` while entries remain `running`.
4. Leaderboard row count matches the number of completed entries in a completed tournament.

### Performance-sensitive paths
1. Tournament run with 5 agents over a long bar range generates fewer `portfolioSnapshots` than before, with final snapshots still present.
2. `order.filled` resolves submitted orders by indexed `clientOrderId` without scanning all pending orders for a run.
3. Batch webhook ingestion processes larger runtime batches without breaking terminal handling.
4. UI still updates live progress promptly via SSE while DB snapshot frequency is reduced.

### UI behavior
1. Tournament detail page shows the overall progress card during `in_progress`.
2. Tournament detail page still shows the overall progress card after completion at `100%`.
3. Agent cards display terminal completion when the run is completed, even if entry status is stale.
4. Dashboard recent tournaments show the newest tournaments first.
5. Tournament list page also reflects the same descending recency order.

### Regression checks
1. `pnpm test` remains green.
2. Add focused server tests for tournament completion mapping and ordering.
3. Add a React test for tournament detail progress visibility in completed state.
4. Add a React test for dashboard ordering if the list is supplied newest-first.

## Assumptions and Defaults

- Default implementation should prioritize low-risk, high-leverage fixes over a full event pipeline redesign.
- SSE remains the real-time source of truth for live progress; Convex progress fields become coarse recovery state.
- Snapshot persistence is reduced to every 25 bars plus final bar by default.
- Run progress persistence to `runs` is reduced to every 100 bars plus final bar by default.
- Order matching should move to explicit `clientOrderId` rather than more complex compound pending-order scans.
- Tournament ordering should be fixed server-side, not by ad hoc client sorting.
- Convex Insights could not be collected from the configured project because the local CLI lacks project access; if access is later available, run `npx convex insights --details` after implementation to validate the hot-path improvements.
