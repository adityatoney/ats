# Phase 4: Human Governance, Approval Workflows, and Operational Controls

## Goal

Make the platform operable and safe for sustained use. Add kill switches, approval-gated self-improvement, token/compute budgets, run exports, and the full permission system described in the PRD. This phase turns AegisTrader from a working prototype into a governed, auditable system.

Phase 4 assumes Phases 1–3 are complete and stable.

---

## Milestone 4.1 — Full Approval Workflow for Agent File Changes

### What to build

- Change proposal system
  - Agents submit structured `ChangeProposal` objects when they want to modify files:
    - `target_file` — which file to change
    - `file_classification` — safe_to_edit, approval_required, never_editable_by_agent
    - `patch_diff` — the actual change as a unified diff
    - `reason` — why the agent wants this change
    - `expected_impact` — what the agent thinks will happen
    - `confidence` — how certain the agent is (0–1)
    - `evidence_refs` — links to runs, branches, or trades that support the change
    - `rollback_note` — how to undo if the change is bad
  - Data model: `change_proposals` table with all fields above plus status (pending, approved, rejected, applied, rolled_back)

- File classification engine
  - Classify every file path according to the PRD categories:
    - `safe_to_edit`: strategy.md, soul.md, soul.json, branch notes, experiment docs
    - `approval_required`: strategy.py, strategy_overrides.json, agent-local feature hooks, agent-local config
    - `never_editable_by_agent`: simulator core, risk policies, fill engine, scheduler core, permission policies, secrets, broker adapters
  - Classification is config-driven (a policy file) and itself never_editable_by_agent
  - Unknown files default to `approval_required`

- Approval routing
  - `safe_to_edit` files: auto-apply immediately, log the change
  - `approval_required` files: create an approval request, block until resolved
  - `never_editable_by_agent` files: reject immediately with an explanation

- Approval request entity
  - `approval_requests` table: id, change_proposal_id, agent_id, status (pending, approved, rejected, expired), requested_at, resolved_at, resolved_by
  - `approval_decisions` table: id, approval_request_id, decision (approve_once, approve_session, approve_scoped_persistent, reject), reason, decided_by, decided_at

### How to test

- [ ] Agent submits a change to `strategy.md` (safe_to_edit); change is auto-applied, no approval needed
- [ ] Agent submits a change to `strategy.py` (approval_required); approval request created, change blocked
- [ ] Agent submits a change to `risk_policies.json` (never_editable); rejected immediately with reason
- [ ] Owner approves a pending request; change is applied and status updates
- [ ] Owner rejects a pending request; change is not applied, rejection reason stored
- [ ] Patch that no longer applies cleanly (file changed since proposal) is rejected at apply time
- [ ] All proposals, requests, and decisions are stored with timestamps and actor IDs
- [ ] Unknown file paths default to approval_required
- [ ] File classification policy itself cannot be modified by agents

---

## Milestone 4.2 — Approval Modes and Scoped Permissions

### What to build

- Approval modes as defined in the PRD:
  - **Once**: approval applies to this specific change proposal only
  - **Session**: approval applies to all changes to this file by this agent during the current run
  - **Scoped persistent**: approval applies to all changes to this file by this agent across all future runs (until revoked)
  - **Admin developer mode**: auto-approve all changes for a specific agent (dangerous, requires explicit opt-in and warning)

- Permission cache
  - Track active session and scoped-persistent permissions
  - `active_permissions` table: id, agent_id, file_path (or glob pattern), scope (session/persistent), granted_by, granted_at, revoked_at, run_id (for session scope)
  - When a new change proposal arrives, check active permissions before creating an approval request
  - Session permissions expire when the run ends

- Re-validation at apply time
  - Even if a permission exists, re-check at apply time that:
    - The file classification hasn't changed
    - The patch still applies cleanly
    - The permission hasn't been revoked
    - The agent is still running (not cancelled/failed)

- Permission revocation
  - Owner can revoke any active permission at any time
  - Revocation takes effect immediately (next apply-time check fails)
  - Admin developer mode can be disabled at any time

### How to test

- [ ] Approve "once" for a strategy.py change; next change to same file still requires approval
- [ ] Approve "session" for strategy.py changes; subsequent changes during the same run auto-approve
- [ ] Session permission expires when the run ends; new run requires fresh approval
- [ ] Approve "scoped persistent" for strategy.py; changes auto-approve across multiple runs
- [ ] Revoke a persistent permission; next change requires approval again
- [ ] Enable admin developer mode for an agent; all changes auto-approve with a warning logged
- [ ] Disable admin developer mode; changes require normal approval flow again
- [ ] Re-validation catches a revoked permission at apply time (even though it was valid at proposal time)
- [ ] Re-validation catches a stale patch at apply time (file was modified since proposal)
- [ ] Permission cache correctly tracks multiple agents with different scopes

---

## Milestone 4.3 — Approval Inbox UI

### What to build

- **Approval inbox page**
  - List of all pending approval requests across all agents
  - Each entry shows: agent name, target file, change summary, confidence, timestamp
  - Sort by newest first, filterable by agent and file classification
- **Approval detail view**
  - Full diff viewer (unified diff with syntax highlighting)
  - Agent's reason and expected impact
  - Evidence links (clickable, navigate to referenced run/branch/trade)
  - Confidence meter
  - Rollback instructions
  - Action buttons: Approve Once, Approve Session, Approve Persistent, Reject
  - Rejection requires a reason (text input)
- **Approval history**
  - Searchable log of all past proposals and decisions
  - Filter by agent, decision type, file, date range
  - Shows who approved/rejected and when
- **Notification system**
  - When a new approval request is created, show a badge/indicator in the nav bar
  - Optional: browser notification for pending approvals (if user opts in)
- **Active permissions view**
  - Table of all active session and persistent permissions
  - One-click revoke button for each

### How to test

- [ ] Pending approval shows up in the inbox when an agent proposes a change
- [ ] Inbox badge shows the count of pending approvals
- [ ] Diff viewer renders the patch correctly with syntax highlighting
- [ ] Evidence links in the detail view navigate to the correct run/branch
- [ ] Approving "once" from the UI applies the change and removes it from pending
- [ ] Approving "session" from the UI applies the change and grants session permission
- [ ] Rejecting from the UI requires a reason; proposal status changes to rejected
- [ ] Approval history shows all past decisions with correct metadata
- [ ] Active permissions view shows current session and persistent grants
- [ ] Revoking a permission from the UI immediately invalidates it

---

## Milestone 4.4 — Kill Switches and Emergency Controls

### What to build

- **Agent kill switch**
  - Immediately stop all activity for a specific agent:
    - Cancel any running backtest
    - Cancel any running live evaluation
    - Disable the agent's schedule
    - Cancel all pending orders via broker adapter
    - Set agent status to "killed"
  - Available from: UI button, API endpoint, CLI command
  - Kill is immediate — does not wait for graceful shutdown

- **Project-wide kill switch**
  - Stop all agents in a project at once
  - Same behavior as per-agent kill but applied to all agents

- **Global emergency stop**
  - Stop all agents across all projects
  - Intended for infrastructure-level emergencies
  - Requires admin authentication

- **Kill switch audit trail**
  - Every kill records: who triggered it, when, which agents affected, what was cancelled
  - Kill events are prominently visible in the event timeline

- **Recovery after kill**
  - Killed agents can be manually reactivated by the owner
  - Reactivation requires reviewing the kill reason and confirming
  - Backtest runs can be resumed from last checkpoint
  - Live mode restarts fresh from broker state

### How to test

- [ ] Kill a running backtest agent; run status immediately becomes "cancelled", no more events emitted
- [ ] Kill a live trading agent; schedule disabled, pending orders cancelled in Alpaca paper
- [ ] Kill switch from UI works within 2 seconds
- [ ] Kill switch from API works within 2 seconds
- [ ] Project-wide kill stops all 3 agents in a tournament simultaneously
- [ ] Global emergency stop halts everything
- [ ] Kill audit trail shows who killed what and when
- [ ] Reactivating a killed agent requires explicit owner confirmation
- [ ] Resuming a killed backtest from checkpoint works correctly
- [ ] Restarting live mode after kill reads fresh state from broker (no stale positions)

---

## Milestone 4.5 — Token and Compute Budgets

### What to build

- **Token budget per agent per run**
  - Track total input and output tokens consumed by LLM calls during a run
  - Configurable max token budget (input tokens + output tokens)
  - When budget is exhausted: pause the run and notify the owner
  - Owner can: increase budget and resume, or cancel the run
  - Budget tracking at the `llm_calls` table level: each call records model, input_tokens, output_tokens, cost_estimate

- **Token budget per agent across runs**
  - Cumulative monthly or rolling-window budget
  - When cumulative budget is near exhaustion (80%, 90%, 100%): send warnings
  - At 100%: block new LLM calls, allow deterministic simulation to continue

- **Compute budget per run**
  - Track wall-clock time or bar-processing count
  - Configurable max run duration (e.g., "max 4 hours" or "max 50,000 bars")
  - When exceeded: pause and notify

- **Model routing cost awareness**
  - LiteLLM model router configuration per agent:
    - Default model for cheap operations (e.g., small open model)
    - Premium model for high-value operations (e.g., Claude for soul synthesis)
  - Routing rules: if remaining budget < threshold, downgrade to cheaper model
  - Log every model routing decision

- **Budget configuration UI**
  - Per-agent budget settings page
  - Current usage vs budget (progress bar)
  - Usage history chart (tokens/day, cost/day)
  - Budget exhaustion warnings displayed inline

- Data model additions:
  - `llm_calls` table: id, run_id, agent_id, model, prompt_tokens, completion_tokens, cost_estimate, purpose (soul_generation, branch_proposal, reflection, etc.), created_at
  - `budget_configs` table: id, agent_id, max_tokens_per_run, max_tokens_monthly, max_run_duration_seconds, max_bars_per_run, model_routing_json, created_at
  - `budget_alerts` table: id, agent_id, alert_type (warning_80, warning_90, exhausted), message, created_at, acknowledged_at

### How to test

- [ ] Run a backtest with soul generation; token usage is tracked per LLM call
- [ ] Set a low token budget (1000 tokens); run pauses when budget exhausted
- [ ] Owner increases budget and resumes; run continues
- [ ] Monthly budget warning fires at 80% usage
- [ ] Monthly budget exhaustion blocks LLM calls but allows deterministic simulation
- [ ] Compute budget of "max 100 bars" pauses the run after 100 bars
- [ ] Model routing switches to cheaper model when budget is low
- [ ] Budget configuration UI shows correct current usage
- [ ] Usage history chart renders daily token consumption
- [ ] All LLM calls record model, tokens, and purpose correctly

---

## Milestone 4.6 — Run Export and Import

### What to build

- **Run export bundle**
  - Export a complete run (including branches) as a portable archive:
    - Run metadata and config
    - Strategy version used (strategy.md + strategy.py)
    - Soul version at start and end of run
    - All orders and fills
    - All portfolio snapshots
    - All checkpoints (or references)
    - Branch tree with all branch metadata and result deltas
    - Key metrics summary
    - Agent events timeline
    - LLM call logs (prompts and responses)
    - Tool call logs
  - Format: ZIP archive containing JSON files and the strategy/soul artifacts
  - Export via API endpoint and UI button
  - Include a manifest file (`export_manifest.json`) with versions, checksums, and export timestamp

- **Run import**
  - Import a previously exported run bundle into a project
  - Validate manifest integrity (checksums)
  - Create run, orders, fills, snapshots, branches as read-only historical records
  - Imported runs are marked as "imported" (not replayable from this instance, but inspectable)

- **Selective export**
  - Export only a specific branch subtree
  - Export only metrics and summary (lightweight export without full event logs)

### How to test

- [ ] Export a completed run with 2 branches; ZIP is created with all expected files
- [ ] Export manifest lists all included files with checksums
- [ ] Import the exported ZIP into a different project; all data is visible in the UI
- [ ] Imported run is marked as "imported" and shows correct metrics
- [ ] Imported branch tree renders correctly
- [ ] Imported orders and fills are inspectable
- [ ] Export with tampered checksum fails import validation
- [ ] Selective branch export includes only the selected subtree
- [ ] Lightweight metrics-only export produces a small file with just the summary
- [ ] Export and import of a run with a soul produces the correct soul version

---

## Milestone 4.7 — Enhanced Audit Trail and Observability

### What to build

- **Comprehensive audit log**
  - Every meaningful system action is recorded:
    - Agent created, updated, deleted
    - Strategy version created
    - Soul version created, approved, rejected
    - Run started, paused, resumed, cancelled, completed, failed
    - Branch created
    - Order submitted, filled, cancelled, rejected by risk gate
    - Change proposal submitted, approved, rejected, applied, rolled back
    - Permission granted, revoked
    - Kill switch activated, agent reactivated
    - Budget warning, budget exhaustion
    - Schedule created, updated, enabled, disabled
    - Export created, import completed
  - Each audit entry: id, timestamp, actor_type (user/agent/system), actor_id, action, entity_type, entity_id, details_json, ip_address (for user actions)
  - `audit_log` table with appropriate indexes for querying

- **Audit log UI**
  - Searchable, filterable audit trail
  - Filter by: actor, action type, entity, date range, agent
  - Timeline visualization
  - Export audit log as CSV or JSON

- **Worker observability**
  - Python runtime health checks
  - Active run count and worker utilization
  - Average bar processing time
  - Checkpoint write latency
  - Event emission latency
  - Exposed via metrics endpoint (Prometheus-compatible or simple JSON)
  - Health dashboard in the UI (admin-only)

- **Error tracking**
  - Structured error logging for all components
  - Errors linked to the run/agent that caused them
  - Error summary page in UI (admin-only)
  - Alert on repeated errors (same error N times in M minutes)

### How to test

- [ ] Every action type listed above produces an audit log entry
- [ ] Audit log entries have correct actor (user vs agent vs system)
- [ ] Audit log UI loads and displays entries in reverse chronological order
- [ ] Filtering by agent shows only that agent's events
- [ ] Filtering by action type (e.g., "kill_switch") shows only matching events
- [ ] Export audit log as CSV; file contains correct data
- [ ] Worker health endpoint returns current metrics
- [ ] Health dashboard shows active run count and processing rates
- [ ] An intentional error (e.g., invalid strategy) appears in the error summary page
- [ ] Repeated error alert fires after threshold is crossed

---

## Milestone 4.8 — Role-Based Access Control

### What to build

- **User roles**
  - `owner`: full access to the project, all agents, all data, all controls
  - `admin`: same as owner but cannot delete the project or transfer ownership
  - `viewer`: read-only access to all project data (runs, branches, metrics, souls)
  - `agent_operator`: can start/stop runs, activate/deactivate live mode, and review approvals, but cannot edit strategies or risk configs
- **Permission model**
  - `project_memberships` table: id, project_id, user_id, role, invited_at, accepted_at
  - All API endpoints check the requesting user's role before processing
  - UI hides/disables controls the current user doesn't have permission for
- **Invitation flow**
  - Owner can invite users to a project with a specific role
  - Invitation via email or link
  - Invited user accepts to join
- **Role-based UI**
  - Viewers see dashboards, runs, branches, metrics, but no action buttons
  - Agent operators see start/stop and approval controls but no strategy editing
  - Owners/admins see everything including risk config, budgets, and danger zone

### How to test

- [ ] Owner can perform all actions (create agent, start run, edit strategy, kill switch, export)
- [ ] Admin can perform all actions except delete project and transfer ownership
- [ ] Viewer can view all data but cannot start runs, edit strategies, or approve changes
- [ ] Agent operator can start/stop runs and review approvals but cannot edit strategy or risk config
- [ ] API returns 403 for unauthorized actions per role
- [ ] UI hides the "Edit Strategy" button for viewers
- [ ] UI hides "Risk Config" for agent operators
- [ ] Inviting a user sends an email/link and shows pending invitation
- [ ] Accepting an invitation grants the specified role
- [ ] Changing a user's role takes effect immediately

---

## Milestone 4.9 — Integration Test: Full Governed Workflow

### What to build

No new code — full integration test of Phase 4 capabilities in the context of the complete system.

### Test scenario

1. **Setup**
   - Owner creates a project and invites a viewer
   - Owner creates 2 agents with different strategies
   - Owner configures budgets: 50K tokens/run, $10/month per agent

2. **Backtest with governance**
   - Run a backtest for Agent A
   - During the run, Agent A proposes a change to `strategy.py`
   - Approval request appears in the inbox
   - Owner reviews the diff, evidence links, and confidence
   - Owner approves with "session" scope
   - Agent proposes a second change to `strategy.py` during the same run; auto-approved (session)
   - Agent proposes a change to `risk_policies.json`; rejected immediately (never_editable)
   - All proposals and decisions are in the audit log

3. **Budget enforcement**
   - Run a second backtest with heavy soul generation
   - Token budget hits 80%; warning appears in UI
   - Token budget exhausted; run pauses
   - Owner increases budget; run resumes
   - All budget events are in the audit log

4. **Live paper with kill switch**
   - Activate Agent A for live paper trading
   - Let it run for several evaluation cycles
   - Trigger kill switch for Agent A
   - All activity stops immediately; pending orders cancelled
   - Kill event in audit log
   - Owner reviews kill reason, reactivates agent
   - Agent resumes from clean broker state

5. **Export and audit**
   - Export Agent A's best backtest run (with branches)
   - Verify export bundle is complete
   - Import into a new project; data is visible and correct
   - Export audit log as CSV; all events from the session are present

6. **RBAC check**
   - Viewer logs in; can see all dashboards and runs
   - Viewer tries to start a run; blocked
   - Viewer tries to approve a change; blocked
   - Viewer tries to export; allowed (read-only action)

### How to test

- [ ] All 6 sections complete without errors
- [ ] Approval workflow correctly gates strategy.py changes
- [ ] Never-editable files are always rejected
- [ ] Session scope permission works across multiple proposals in one run
- [ ] Budget warning and exhaustion fire at correct thresholds
- [ ] Kill switch stops all agent activity within 2 seconds
- [ ] Export and import produce identical inspectable data
- [ ] Audit log captures every significant action from the session
- [ ] RBAC correctly blocks unauthorized actions for viewer role
- [ ] No data corruption or state inconsistency across all operations
