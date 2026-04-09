# Tournament Progress Tracker and Terminal State Repair Plan

## Summary

The current tournament detail page has two independent failures:

1. **No real-time tournament progress source**
   - The page subscribes only to tournament-level SSE events.
   - The backend publishes `tournament.progress` only when a run reaches a terminal state.
   - Per-agent `run.progress` never updates tournament SSE, so the top tracker cannot move live as agents advance.

2. **Terminal tournament summary can remain stale**
   - Live API responses show tournaments where all entries and runs are `completed`, but:
     - tournament `status` is still `in_progress`
     - tournament `completedCount` is still `0`
     - some runs have `processedBars > 0` but `totalBars = 0`
   - This blocks both fallback tracker modes:
     - aggregate run progress fails because `totalBars` is missing
     - completion-count fallback fails because `completedCount` is stale

The fix should make tournament progress derive from **agent runs first**, not the tournament row, and it should make terminal tournament state **self-healing** in the API even if stored summary fields are stale.

## Goals

- The tournament progress bar updates live while agents are running.
- The tracker reflects aggregate agent progress, not only completed agents.
- A tournament with all terminal runs never renders as `in_progress`.
- The top label and progress bar remain correct even when some persisted tournament summary fields are stale.
- Existing stale tournaments become readable without requiring manual DB repair.
- Newly created tournaments stay correct in real time and at terminal completion.

## Non-Goals

- Rebuilding the tournament model into a separate progress digest table.
- Replacing run-level SSE with direct tournament subscriptions for every subfield.
- Repairing all historical tournament documents in storage as part of this change.
- Changing the external REST routes.

## Current Behavior and Confirmed Blocking Points

### Frontend data flow
- [`useTournament`]( /Users/adityat/Documents/Projects/ats/packages/web/src/hooks/useTournament.ts ) polls `GET /api/tournaments/:id` every 2 seconds while `status` is `pending` or `in_progress`.
- [`useTournamentSSE`]( /Users/adityat/Documents/Projects/ats/packages/web/src/hooks/useTournamentSSE.ts ) subscribes only to tournament SSE.
- [`TournamentDetailPage`]( /Users/adityat/Documents/Projects/ats/packages/web/src/components/tournament/TournamentDetailPage.tsx ) currently computes overall progress from:
  1. aggregate `entry.run.processedBars / entry.run.totalBars`
  2. fallback `completedCount / agentCount`

### Backend event flow
- runtime emits `run.progress` per run
- Node publishes run SSE immediately
- tournament SSE only emits:
  - `tournament.started`
  - `tournament.progress`
  - `tournament.completed`
  - `tournament.failed`
  - `tournament.cancelled`
- `tournament.progress` is only published on terminal run bookkeeping, not during normal `run.progress`

### Live evidence
For stale tournaments currently served from Docker:
- entries are all `completed`
- nested runs are all `completed`
- tournament `status` is still `in_progress`
- tournament `completedCount` is `0`
- runs can have `processedBars > 0` and `totalBars = 0`

This means the UI lacks a valid live source and a valid fallback source.

## Public APIs, Interfaces, and Type Changes

### REST API
No route changes.

Keep:
- `GET /api/tournaments`
- `GET /api/tournaments/:id`

Behavior changes for `GET /api/tournaments/:id`:
- returned `status` must be derived from entry/run truth when stored tournament status is stale
- returned `completedCount` must be derived from terminal entry count when stored count is stale
- returned entries must include normalized run progress values
- the response should include a new derived field:
  - `progressPercent: number`
- the response should include a new derived field:
  - `progressSummary: { processedBars: number; totalBars: number; completedAgents: number; activeAgents: number }`

This avoids duplicating tournament progress math in multiple clients and makes the UI decision-free.

### Tournament SSE payloads
Keep current event names, but expand payload contract.

Add/standardize `tournament.progress` payload:
- `processedBars: number`
- `totalBars: number`
- `completedAgents: number`
- `agentCount: number`
- `progressPercent: number`

Add/standardize `tournament.completed` and `tournament.failed` payload:
- `status: string`
- `processedBars: number`
- `totalBars: number`
- `completedAgents: number`
- `agentCount: number`
- `progressPercent: 100`

### Internal server helper contract
Introduce a shared tournament progress derivation helper in the server route/service layer that takes:
- tournament doc
- normalized enriched entries

and returns:
- normalized `status`
- normalized `completedCount`
- aggregate progress totals
- progress percentage

This helper should be the single source of truth for:
- tournament detail API
- terminal tournament SSE payloads
- any later dashboard detail summaries

## Design Decisions

### 1. Overall tournament progress definition
Overall tournament progress is:

`sum(min(run.processedBars, run.totalBars)) / sum(run.totalBars)`

across all entries with `run.totalBars > 0`.

Fallback order when totals are missing:
1. if any runs have valid `totalBars > 0`, use aggregate run progress
2. else if all entries are terminal, progress is `100%`
3. else fallback to `completedAgents / agentCount`

This ensures:
- live movement during runs
- correct terminal rendering even for stale tournaments
- reasonable behavior when some older runs are missing `totalBars`

### 2. Tournament status derivation
Tournament status returned by the detail API must be derived with this precedence:

1. If all entries are terminal:
   - all failed/cancelled => `failed`
   - some failed/cancelled and some completed => `partially_failed`
   - all completed => `completed`
2. Else if any entry is `running` or any run is `running` => `in_progress`
3. Else if tournament row says `cancelled` => `cancelled`
4. Else default to stored tournament status or `pending`

This is intentionally defensive and treats entry/run truth as stronger than stale tournament summary fields.

### 3. Real-time progress source
Do **not** make the page open N run-level SSE streams for N tournament entries.

Preferred design:
- backend publishes tournament-level progress updates whenever a run emits `run.progress`
- frontend keeps one tournament SSE stream
- query invalidation remains, but the page can also optimistically use the SSE payload to render the top progress bar immediately

This keeps client complexity low and aligns with the existing tournament SSE design.

### 4. Run total bars correctness
On terminal `run.completed`, persist both:
- `processedBars`
- `totalBars`

If `totalBars` is missing in the event payload:
- fallback to current run’s stored `totalBars` if > 0
- else fallback to `processedBars` when the run is terminal

This prevents terminal runs with `4024/0 bars`.

### 5. Historical stale tournaments
Do not require a migration before the fix becomes useful.

Instead:
- make `GET /api/tournaments/:id` self-heal derived state
- make the detail UI consume derived fields from the API
- optionally provide a repair endpoint or script later, but it is not required for correctness on the page

## Implementation Plan

### A. Add a shared tournament progress/state derivation helper on the server

Create a helper near [`packages/server/src/routes/tournaments.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/routes/tournaments.ts ) or in a new server utility module.

Input:
- normalized tournament object
- enriched entries with nested normalized runs

Output:
- `status`
- `completedCount`
- `progressSummary`
- `progressPercent`

Rules:
- normalize each entry display status from terminal run status first
- normalize each run’s effective totals:
  - `effectiveProcessedBars = run.processedBars ?? 0`
  - `effectiveTotalBars = run.totalBars > 0 ? run.totalBars : terminalRun ? effectiveProcessedBars : 0`
- aggregate across all entries
- derive terminal counts and overall status
- return merged tournament view model

This helper must be pure and exported for tests.

### B. Make `GET /api/tournaments/:id` return derived progress/state

In [`packages/server/src/routes/tournaments.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/routes/tournaments.ts ):

- keep enriching entries with agent and run
- normalize entry status from run status
- pass the result through the new derivation helper
- return:
  - corrected `status`
  - corrected `completedCount`
  - `progressPercent`
  - `progressSummary`
  - enriched entries

Decision:
- `GET /api/tournaments` list route does not need full aggregate progress computation for now
- it may keep current summary ordering fix
- only the detail route needs the new derived progress fields immediately

### C. Publish tournament progress on every `run.progress`

Current blocker is lack of tournament-level live progress events.

In [`packages/server/src/services/write-queue.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/services/write-queue.ts ):

- extend `processBatch` result contract for `run.progress` to optionally include:
  - `runId`
  - `tournamentId`
  - `processedBars`
  - `totalBars`
  - `agentId`
- or, if keeping `processBatch` leaner, derive this in Node from the original batched events plus Convex run lookup when necessary

Preferred option:
- return progress result records directly from Convex `processBatch` for runs that belong to tournaments

In [`convex/webhookHandlers.ts`]( /Users/adityat/Documents/Projects/ats/convex/webhookHandlers.ts ):
- on `run.progress`, if the run belongs to a tournament, push a result record for Node:
  - `eventType: "run.progress"`
  - `runId`
  - `tournamentId`
  - `agentId`
  - `processedBars`
  - `totalBars`

In Node write queue:
- collect run-progress results per tournament during the flush
- aggregate them into a per-tournament snapshot
- publish `eventBus.publishTournament(tournamentId, { eventType: 'tournament.progress', payload })`

Payload computation:
- if only one run in the batch emitted progress, publish at least:
  - `processedBarsDeltaSource` is that run
- but to avoid inaccurate partial aggregate totals, the Node side should fetch the current tournament detail state once and publish the fully derived `progressSummary` from the API/helper layer

Preferred exact behavior:
- when at least one `run.progress` result arrives for a tournament in a flush, Node calls a shared server-side helper to fetch current tournament detail state and publishes a full derived `tournament.progress` payload

This trades one read per active tournament per flush for correctness and low client complexity.

### D. Make terminal tournament SSE payloads use the same derived helper

In [`packages/server/src/services/tournament-manager.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/services/tournament-manager.ts ):

- after finalization, fetch the current enriched tournament state via the shared helper
- publish `tournament.completed` or `tournament.failed` with:
  - final derived status
  - `progressSummary`
  - `progressPercent: 100`

This ensures:
- terminal UI immediately reflects completion
- the page no longer depends on stored tournament row freshness to flip from `in_progress`

### E. Fix terminal run `totalBars` persistence

In [`convex/webhookHandlers.ts`]( /Users/adityat/Documents/Projects/ats/convex/webhookHandlers.ts ):

For `run.completed` patch payload:
- write `totalBars` from terminal event payload if provided
- if not provided and existing run `totalBars > 0`, preserve it
- if not provided and existing run `totalBars <= 0`, set `totalBars = processedBars`

Also update the direct `handleRunCompleted` mutation similarly for consistency.

This is necessary because stale live data currently shows `processedBars: 4024, totalBars: 0`, which defeats aggregate progress.

### F. Update the frontend to use server-derived progress fields

In [`packages/web/src/components/tournament/TournamentDetailPage.tsx`]( /Users/adityat/Documents/Projects/ats/packages/web/src/components/tournament/TournamentDetailPage.tsx ):

Add to `TournamentData`:
- `progressPercent?: number`
- `progressSummary?: { processedBars: number; totalBars: number; completedAgents: number; activeAgents: number }`

Use rendering precedence:
1. `tournament.progressPercent` if present
2. old local aggregate calculation as a defensive fallback

Use label precedence:
1. `progressSummary.completedAgents / agentCount agents completed`
2. fallback to `completedCount / agentCount`

Do not compute the top-level progress bar exclusively on the client once the server-derived fields exist.

### G. Let tournament SSE update the page immediately without waiting for poll

In [`packages/web/src/hooks/useTournamentSSE.ts`]( /Users/adityat/Documents/Projects/ats/packages/web/src/hooks/useTournamentSSE.ts ):
- keep existing event list accumulation

In [`packages/web/src/components/tournament/TournamentDetailPage.tsx`]( /Users/adityat/Documents/Projects/ats/packages/web/src/components/tournament/TournamentDetailPage.tsx ):
- add local ephemeral tournament progress state fed by latest tournament SSE payload
- use it to render the top tracker immediately
- still invalidate the query on events so server truth catches up
- clear ephemeral state when query data catches up or tournament becomes terminal

This gives visible live movement even if polling lags by up to 2 seconds.

### H. Operational requirement: deploy path consistency

Because your live app is served from Docker:
- `localhost:3001` is `aegis-server`
- `localhost:5173` is `aegis-web`

Repo edits are **not live** until containers are rebuilt.

Required rollout for this fix:
1. rebuild `server`
2. rebuild `web`
3. if runtime event payload shape changes, rebuild `runtime`

Recommended command:
- `docker compose up -d --build server runtime web`

Without this, the UI will keep serving stale route logic even if the repo is correct.

## File-Level Change List

### Server
- [`packages/server/src/routes/tournaments.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/routes/tournaments.ts )
  - add shared derivation helper
  - return `progressPercent` and `progressSummary`
  - self-heal `status` and `completedCount`
- [`packages/server/src/services/write-queue.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/services/write-queue.ts )
  - consume `run.progress` result records
  - publish `tournament.progress` during active runs
  - publish derived final payloads on terminal events
- [`packages/server/src/services/tournament-manager.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/services/tournament-manager.ts )
  - terminal SSE payloads should use derived helper output

### Convex
- [`convex/webhookHandlers.ts`]( /Users/adityat/Documents/Projects/ats/convex/webhookHandlers.ts )
  - return progress results for tournament runs
  - ensure terminal `totalBars` is populated

### Web
- [`packages/web/src/components/tournament/TournamentDetailPage.tsx`]( /Users/adityat/Documents/Projects/ats/packages/web/src/components/tournament/TournamentDetailPage.tsx )
  - consume derived server fields
  - keep local SSE-backed optimistic progress state
- [`packages/web/src/hooks/useTournamentSSE.ts`]( /Users/adityat/Documents/Projects/ats/packages/web/src/hooks/useTournamentSSE.ts )
  - no protocol change required, only consumer usage update

### Optional extraction
- new helper module such as:
  - [`packages/server/src/services/tournament-progress.ts`]( /Users/adityat/Documents/Projects/ats/packages/server/src/services/tournament-progress.ts )
  - preferred if you want clean reuse between route and manager

## Test Cases and Scenarios

### Backend correctness
1. Tournament detail API returns `completed` and `completedCount = agentCount` when all entries are terminal, even if stored tournament row says `in_progress` and `0`.
2. Tournament detail API computes `progressPercent` from aggregate run progress when `totalBars > 0`.
3. Tournament detail API falls back to terminal `processedBars` as `totalBars` when a completed run has `totalBars = 0`.
4. Tournament with all failed runs derives `failed`.
5. Tournament with mixed completed and failed runs derives `partially_failed`.

### SSE / real-time
1. When a run in a tournament emits `run.progress`, the server emits `tournament.progress`.
2. `tournament.progress` payload contains:
   - `processedBars`
   - `totalBars`
   - `completedAgents`
   - `agentCount`
   - `progressPercent`
3. When the last run completes, `tournament.completed` or `tournament.failed` emits a payload with `progressPercent = 100`.

### Frontend behavior
1. Top progress bar moves while tournament runs are advancing, before any agent finishes.
2. Top progress label reflects completed agents count as runs finish.
3. Tournament badge flips to `completed` once all agents are terminal, even if stale tournaments had bad persisted counts.
4. Completed tournaments never render `0 / N agents completed` when all entries are terminal.
5. Agent cards continue to show per-agent progress from nested run data.

### Regression checks
1. `pnpm --filter @aegis/server lint`
2. `pnpm --filter @aegis/web lint`
3. `pnpm --filter @aegis/server test`
4. `pnpm --filter @aegis/web test`
5. Rebuild Docker images and verify:
   - `docker compose up -d --build server runtime web`

## Acceptance Criteria

A tournament page is correct if all of the following are true:

- While runs are active, the top progress bar visibly advances over time.
- The top progress bar is based on aggregate run progress, not only completed agent count.
- When all agents finish, the page shows:
  - status `completed` or appropriate terminal variant
  - `N / N agents completed`
  - progress bar at `100%`
- A stale historical tournament where entries/runs are already terminal also renders correctly without requiring a DB migration.
- The fix is visible through the Docker-served app after rebuild.

## Assumptions and Defaults

- `run.progress` remains the canonical live source for agent advancement.
- Tournament detail API is allowed to derive fields from enriched entries/runs instead of trusting stored tournament summary fields.
- One tournament SSE stream per page remains the desired client architecture.
- Server may perform one derived tournament-state refresh per tournament per write-queue flush that contains progress events.
- Historical storage repair is optional and out of scope; read-time self-healing is sufficient for the page.
- Since your live app is Docker-served, container rebuild is mandatory for verification.

## Rollout Notes

1. Implement the server-side derivation helper first.
2. Update the detail route to use it.
3. Add tournament progress SSE publication on `run.progress`.
4. Update the React page to consume server-derived progress and use SSE payloads optimistically.
5. Rebuild Docker images.
6. Validate with one active tournament and one stale completed tournament.
