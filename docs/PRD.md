# Product Requirements Document

## Product

Multi-Agent Financial Paper Trading Research Platform

Working title: Project AegisTrader

## Document Status

Draft v1

## Executive Summary

Project AegisTrader is a web-based and server-hosted research platform for designing, simulating, evolving, and paper-trading multiple AI trading agents. Each agent follows a user-defined strategy, performs deep backtesting on historical data, explores alternate decision branches, develops an evolving "trading soul" from experience, and can later operate in live paper-trading mode under strict guardrails.

The system is designed around one core principle:

**The trading engine must be deterministic and auditable, while the AI layer may be non-deterministic but only in bounded, reviewable ways.**

This product is not a brokerage, not an auto-live-money trading platform, and not an opaque AI black box. It is a controlled research and paper-trading environment where users can observe, compare, inspect, and evolve trading agents over time.

## Problem Statement

Most trading backtesting tools are static, rule-based, and optimized for single-strategy replay. Most AI agent platforms, by contrast, are highly flexible but difficult to audit, reproduce, and trust for financial workflows.

There is a gap in the market for a system that can:

* Let users define trading doctrine in both natural language and code
* Allow agents to simulate deeply across years of historical data
* Preserve branch history and alternate decision paths like a git tree
* Separate deterministic simulation truth from AI reasoning and reflection
* Turn simulation learnings into evolving agent memory and doctrine
* Expose every backtest, fork, branch, lesson, and decision in a visual UI
* Transition agents from historical replay to live paper trading under scheduled or always-on execution
* Support multiple competing agents that can see only each other’s performance, not internal reasoning
* Safely allow certain self-improving edits with explicit owner approval

## Vision

Build the best platform for AI-assisted trading research and paper execution, where users can create multiple autonomous-but-governed agents, inspect their reasoning and evolution over time, compare their performance, and continuously refine strategy doctrine without losing reproducibility.

## Product Principles

1. Deterministic truth over agent improvisation
2. Replayability and auditability by default
3. Human approval for sensitive state changes
4. Observable branches, not hidden thought chains
5. Strategy evolution is allowed, platform-law rewriting is not
6. Long-running backtests must be durable and recoverable
7. Live paper trading must honor risk gates and scheduling policy
8. All meaningful events should be visible in the web UI
9. Agent competition should be fair and leakage-limited
10. The system must be decomposable into phases and shippable incrementally

## Goals

### Business Goals

* Create a differentiated AI-native trading research platform
* Enable users to compare multiple AI trading agents under controlled conditions
* Support a premium workflow centered on research depth, visibility, and evolution
* Lay the foundation for future paid hosted offerings

### User Goals

* Define a strategy using Markdown and optional Python
* Run long-range historical backtests over 1 year, 5 years, or 10 years
* Allow agents to branch and explore alternate decision paths
* See exactly why an agent acted, what happened, and what it learned
* Preserve a durable evolving memory of each agent’s doctrine
* Run paper trading on live data after backtesting
* Configure when each agent wakes and trades
* Approve or reject sensitive self-modification actions

### Technical Goals

* Maintain deterministic simulation reproducibility
* Support durable long-running workflows
* Provide real-time UI updates for run status and events
* Enforce strong permission boundaries around tool use and file writes
* Keep live mode and backtest mode consistent through shared core abstractions

## Non-Goals

* Executing real-money trades in the initial versions
* Offering financial advice
* Predicting future returns with guarantees
* Letting agents freely rewrite the deterministic core engine
* Building a fully code-free retail-first trading bot product in phase 1
* Supporting every asset class in the MVP
* Replacing high-end quant research infrastructure in the MVP

## Users and Personas

### Primary Persona: Research-Oriented Builder

A technical user who wants to define strategies, inspect historical behavior, compare multiple agents, and iteratively evolve them with a mix of code and natural language.

Needs:

* high visibility
* exportability
* reproducibility
* strategy control
* branch inspection

### Secondary Persona: AI Experimenter

A user who cares more about agent evolution and doctrine than raw quant implementation details, and wants the system to help generate, compare, and refine strategies.

Needs:

* approachable strategy authoring
* strong UI explanations
* soul evolution and summaries
* guided approvals

### Internal/Admin Persona

A system owner or developer operating the platform.

Needs:

* auditability
* role-based permissions
* worker observability
* workflow control
* cost control
* safety policies

## Core Product Concepts

### Agent

An autonomous research and paper-trading entity with:

* a strategy definition
* optional deterministic code hooks
* a trading soul
* a branch lineage
* runtime policy and schedule
* paper portfolio state

### Strategy

The declarative and optionally programmable doctrine the agent follows.

Recommended files:

* `strategy.md`
* `strategy.py`
* `strategy_overrides.json`

### Trading Soul

The evolving doctrine an agent develops through historical and live experience.

Recommended files:

* `soul.md`
* `soul.json`

The soul is versioned, diffable, and tied to evidence from runs and branches.

### Backtest Run

A deterministic replay of a selected time range, market universe, strategy version, simulator version, and configuration.

### Branch

A fork from a prior checkpoint representing an alternate path, parameter change, interpretation, or decision.

### Checkpoint

A persisted simulation state from which a run can be resumed or forked.

### Live Paper Run

A workflow where the agent wakes according to schedule or continuous mode, evaluates live or near-live market data, proposes trades, passes risk checks, and places paper orders.

## Key User Stories

1. As a user, I want to create an agent from a Markdown strategy and optional Python hooks.
2. As a user, I want to select a historical time range and market universe for a backtest.
3. As a user, I want the agent to run for as long as needed, including long-running exploration.
4. As a user, I want the agent to branch from prior checkpoints and compare alternate outcomes.
5. As a user, I want to inspect every trade, decision, branch, and lesson in the UI.
6. As a user, I want each agent to generate a durable trading soul after historical learning.
7. As a user, I want agents to compete in paper mode while only seeing each other’s performance.
8. As a user, I want to define cron-like schedules or always-on mode for live evaluation.
9. As a user, I want agents to request approval before editing protected strategy-related files.
10. As an owner, I want to approve writes once, for a session, or as a scoped persistent permission.
11. As an owner, I want to reject unsafe modifications and keep the platform deterministic.
12. As an admin, I want long-running workflows to survive process restarts and resume safely.

## Scope

### In Scope for PRD Baseline

* Multi-agent backtesting on historical data
* Branching and checkpointing
* Agent soul creation and evolution
* Paper trading on live data
* Leaderboard-based competitive visibility
* User-configurable schedules and run modes
* Visual UI for runs, branches, decisions, and files
* Tool calling and permission-gated writes
* Audit trails and replay metadata
* Support for Claude and open models

### Explicitly Out of Scope for MVP

* Real-money brokerage execution
* Complex options strategies
* Portfolio margin simulation
* Institutional-grade market microstructure simulation
* Unlimited open filesystem access for agents
* Cross-agent reasoning sharing beyond PnL/leaderboard visibility

## Functional Requirements

## 1. Agent Authoring

### 1.1 Strategy Definition

The system must allow users to define strategy in:

* Markdown only
* Markdown plus Python hooks

Markdown should support sections such as:

* objective
* universe
* entry criteria
* exit criteria
* risk rules
* position sizing doctrine
* no-trade conditions
* market session preferences
* wake-up logic
* reflection instructions
* branch exploration policy

Python should be restricted to approved interfaces such as:

* feature calculation
* signal generation
* risk evaluation hooks
* sizing hooks

### 1.2 Soul Definition

The system must allow agents to generate and update soul artifacts that include:

* market beliefs
* favored regimes
* failure patterns
* timing lessons
* confidence boundaries
* anti-patterns
* playbooks
* evidence links to runs and branches

The system must store soul versions over time.

## 2. Historical Backtesting

### 2.1 Dataset Selection

Users must be able to select:

* symbols or symbol groups
* time range
* timeframe resolution
* starting capital
* slippage model
* fee model
* run budget constraints

### 2.2 Execution

The deterministic engine must:

* replay historical data deterministically
* evaluate strategy hooks consistently
* compute positions and PnL reproducibly
* persist checkpoints periodically
* persist all orders, fills, and state transitions

### 2.3 Long-Running Mode

Backtests may run for extended durations ranging from minutes to days.
The platform must support:

* pause
* resume
* cancel
* restart from checkpoint
* recover after server restart or worker failure

## 3. Branching and Exploration

### 3.1 Branch Creation

The system must allow a backtest run to fork from a checkpoint.

A branch may represent:

* alternate threshold
* alternate timing
* alternate exit logic
* alternate interpretation of market regime
* skipped trade
* reduced size
* inverted decision

### 3.2 Branch Metadata

Each branch must record:

* parent checkpoint
* parent run or branch
* change summary
* rationale
* creator type (user or agent)
* expected benefit
* actual benefit
* soul deltas

### 3.3 Branch Visualization

The UI must visualize the full branch DAG and allow users to inspect lineage, diffs, and result deltas.

## 4. Agent Reasoning and Tool Calling

### 4.1 Tool Calling

Agents must be able to invoke typed tools for:

* reading historical data
* reading live data
* running backtests
* forking branches
* querying indicators/features
* reading strategy files
* reading soul files
* writing proposed diffs
* generating reports

### 4.2 Approval-Gated Writes

Agents must not directly overwrite files.
They must submit structured change proposals.

Change proposal fields should include:

* target file
* file classification
* patch diff
* reason
* expected impact
* confidence
* evidence references
* rollback note

### 4.3 Approval Modes

The system must support:

* once
* session
* scoped persistent
* admin developer mode

The system must re-check permissions at apply time, not only at request time.

### 4.4 File Categories

The system must classify files as:

* safe_to_edit
* approval_required
* never_editable_by_agent

Examples:

* safe or approval-based: strategy docs, soul docs, branch configs, agent-local config
* never editable by agent: deterministic core engine, fill model, risk hard limits, broker adapters, permission policies

## 5. Live Paper Trading

### 5.1 Live Modes

The system must support:

* always-on monitoring
* schedule-based wake-up
* interval-based evaluation
* mixed mode

### 5.2 Data Ingestion

The system must support live or near-live data adapters for paper trading.

### 5.3 Live Evaluation

In live mode, each agent must:

* wake according to schedule or stream trigger
* load current strategy and soul
* inspect current market state
* evaluate signal proposals
* pass deterministic risk validation
* create paper orders
* track fills and portfolio state
* write outcome summaries and optional soul updates

### 5.4 Competition Rules

Agents may observe:

* leaderboard rank
* realized/unrealized PnL
* basic performance metrics of peers

Agents may not observe:

* peer strategies
* peer soul files
* peer branch trees
* peer tool traces
* peer internal reasoning

## 6. UI and Visualization

The UI must provide:

* agent list and status dashboard
* run history
* branch tree visualization
* checkpoint browser
* trade ledger
* portfolio timeline
* PnL charts
* strategy editor
* soul viewer with diffs
* approval inbox
* scheduler configuration
* live event feed
* agent comparison dashboard

The UI should also provide:

* replay mode
* run export bundle
* branch diff comparison
* event timeline filters

## 7. Scheduling

Users must be able to define:

* cron-like schedules
* timezone
* trading session windows
* blackout windows
* always-on mode
* market-open only mode
* interval polling mode

## 8. Auditability and Reproducibility

The system must store enough metadata to reproduce a run, including:

* strategy version
* soul version
* deterministic engine version
* market data snapshot reference
* model version and prompts where relevant
* tool call log
* checkpoint lineage
* random seed where applicable
* approval events

## Non-Functional Requirements

### Reliability

* Long-running workflows must survive restarts
* No silent loss of branch or checkpoint state
* Order and fill records must be durable

### Performance

* UI should stream event updates with low latency
* Historical run startup time should remain acceptable for common workloads
* Large run histories must remain queryable and renderable

### Security

* File writes must be policy-gated
* Secrets must never be exposed to agents in raw form
* Model providers must be isolated via server-side adapters
* Role-based access control is required for owner/admin actions

### Cost Control

* Token usage budgets per agent/run
  n- model routing policies
* backtest compute budgets
* storage lifecycle policies for raw and derived artifacts

### Explainability

* Every trade should link to the evidence and state that produced it
* Every soul update should link back to supporting runs and branches
* Every approval-gated write should preserve proposal, decision, and applied diff

## Deterministic vs Non-Deterministic Boundary

### Deterministic Layer

The deterministic layer is the source of truth for:

* historical replay
* feature computation
* signal execution rules
* order simulation
* fill logic
* fees and slippage
* portfolio accounting
* checkpoints
* branch DAG
* leaderboard calculations

### Non-Deterministic Layer

The AI layer may be used for:

* proposing branches
* reflecting on losses and wins
* generating soul updates
* summarizing regime interpretation
* proposing file changes
* explaining outcomes

The AI layer must not be the source of truth for fills, balances, or final order acceptance.

## Proposed System Architecture

## Frontend

* React with Vite
* realtime subscriptions
* branch DAG visualization
* rich run inspection
* approval workflow UI

## Control Plane

* Node.js service
* authentication and authorization
* project, agent, and schedule management
* event fanout to UI
* API gateway for the frontend
* approval service

## Python Runtime Layer

* deterministic simulator
* feature and strategy execution sandbox
* agent orchestration
* branch and checkpoint manager
* live paper trading loop
* integration with LLM provider router

## Workflow Orchestration

* Durable workflow engine for backtests and live runs
* pause, resume, cancel, signal, and query support
* human approval wait states

## Storage

### Canonical transactional store

* PostgreSQL for orders, fills, runs, branches, checkpoints, approvals, schedules

### Realtime projection layer

* Convex for UI-facing subscriptions, lightweight metadata, notifications, and file references

### Object storage / data lake

* Parquet files and object storage for historical market data, feature snapshots, and run exports

### Local/project artifacts

* Markdown and JSON files for strategy and soul artifacts

## Suggested External Integrations

### Market Data and Paper Trading

MVP candidates:

* Alpaca for historical data, live market data, and paper trading

Expansion candidates:

* Databento for richer historical datasets
* Massive for real-time market data streams
* Interactive Brokers adapters later if needed

### Model Providers

* Claude via Anthropic-compatible integration
* Open models via vLLM or Ollama-compatible endpoints
* unified routing through a model gateway layer

## Data Model Overview

Key entities:

* User
* Project
* Agent
* StrategyVersion
* SoulVersion
* Run
* Checkpoint
* Branch
* Order
* Fill
* Position
* PortfolioSnapshot
* AgentEvent
* ToolCall
* LLMCall
* ApprovalRequest
* ApprovalDecision
* Schedule
* MarketDataSnapshot
* RunArtifact

## Detailed File/Artifact Policy

### Safe or low-risk editable artifacts

* `strategy.md`
* `soul.md`
* `soul.json`
* branch notes
* experiment result docs

### Approval required artifacts

* `strategy.py`
* `strategy_overrides.json`
* agent-local feature hooks
* agent-local configuration files

### Never editable by agents

* simulator core
* risk hard-limit policies
* fill/slippage engine
* scheduler core
* permission policies
* secret stores
* broker adapters
* cross-agent visibility policy

## Major Workflows

## Workflow A: Create Agent

1. User creates project
2. User creates agent
3. User uploads or edits `strategy.md`
4. User optionally adds `strategy.py`
5. System validates strategy
6. Agent is ready for backtest

## Workflow B: Historical Backtest

1. User selects dataset and time range
2. User starts run
3. Workflow is created and assigned to a Python worker
4. Worker replays data deterministically
5. Checkpoints and events stream to UI
6. Agent may propose branches during run
7. At completion, system computes metrics and generates soul update proposal
8. Approved soul version is stored

## Workflow C: Branch Exploration

1. User or agent selects checkpoint
2. System forks new branch
3. Branch change metadata is stored
4. Deterministic replay executes on branch
5. Result deltas and soul deltas are recorded
6. UI updates branch DAG

## Workflow D: Approval-Gated File Change

1. Agent submits `ChangeProposal`
2. System classifies target file and required permission
3. If permission missing, create approval request
4. Owner reviews diff and rationale
5. Owner approves once, session, scoped persistent, or rejects
6. System re-validates policy and patch applicability
7. Patch is applied if still valid
8. Run continues and audit event is written

## Workflow E: Live Paper Trading

1. User configures live mode and schedule
2. Scheduler wakes workflow or keeps it streaming
3. Agent loads latest approved strategy and soul
4. Market state is read
5. Signal proposal is generated
6. Deterministic risk engine validates proposal
7. Paper order is placed via adapter
8. Fill and PnL updates stream to UI
9. Optional delayed soul update proposal is created

## Metrics and Success Criteria

### Product Metrics

* number of created agents per project
* number of backtest runs completed
* average branch count per successful run
* percentage of runs viewed in replay/inspection UI
* number of live paper agents activated
* number of approval requests reviewed and accepted

### System Metrics

* run success rate
* average resume success after interruption or restart
* checkpoint write latency
* event stream latency to UI
* live loop evaluation latency
* policy enforcement error rate

### User Value Metrics

* agent strategy iteration frequency
* number of soul versions created over time
* branch-to-improvement conversion rate
* proportion of users comparing multiple agents

## Risks

1. Users may over-trust non-deterministic reflections as truth
2. Long-running backtests may create large storage and compute cost
3. Large branch DAGs may become visually and operationally heavy
4. Model costs may spike without routing and budgeting controls
5. Live market data quality may not match research-grade replay assumptions
6. Paper trading fills may diverge from expected real-world execution
7. Allowing strategy.py changes may increase operational risk
8. UI complexity may overwhelm non-technical users without good defaults

## Mitigations

* make deterministic truth explicit in UI and docs
* apply run budgets and archival policies
* collapse or summarize low-signal branches in UI
* enforce token and compute budgets
* separate research and live execution configs
* require approval for code-affecting changes
* provide safe templates and presets

## Compliance and Safety Notes

* The system must clearly label itself as paper trading and research tooling
* The platform must not present generated content as financial advice
* Risk warnings should be shown before live paper activation
* All model-generated strategy modifications should be reviewable

## MVP Recommendation

### MVP Scope

Build the following first:

* one project with multiple agents
* strategy.md and optional minimal strategy.py
* deterministic historical backtesting
* checkpoints and branch DAG
* soul generation and versioning
* approval-gated writes for strategy-related files
* basic leaderboard
* live paper trading via one provider
* UI for branch tree, trades, PnL, soul versions, and approvals

### MVP Exclusions

* advanced multi-asset derivatives
* large-scale autonomous code generation
* freeform core-engine rewrites
* multi-broker support

## Recommended Stack

### Frontend

* React
* Vite
* TypeScript
* graph visualization library for branch DAG

### Backend Control Plane

* Node.js
* TypeScript
* websocket or SSE event streaming

### Runtime

* Python
* deterministic simulator core
* LLM orchestration and tool wrappers

### Orchestration

* durable workflow engine

### Data

* PostgreSQL
* Convex for realtime UI projections
* object storage for datasets and exports
* Markdown and JSON artifacts on device or project storage

## Rollout Plan

### Phase 1

Single-agent deterministic backtester with soul generation and branch DAG

### Phase 2

Multi-agent competition with leaderboard isolation

### Phase 3

Live paper trading with schedules and approval-gated self-improvement

### Phase 4

Advanced analytics, richer data providers, and stronger experiment management

## Open Questions

1. What asset classes should MVP support besides U.S. equities, if any?
2. Should live mode be bar-based only in MVP, or tick-aware where available?
3. How much Python flexibility should strategy hooks have in MVP?
4. Should owners be able to edit soul files manually, or only accept/reject agent proposals?
5. How aggressively should the platform auto-summarize large branch trees?
6. Should a soul update require approval every time in early versions?
7. What are the minimum viable slippage and fill models for trustable paper research?
8. Should the model router support cost-aware dynamic fallback in MVP?
9. Will projects be single-user in MVP or support collaboration?
10. How should run exports be packaged for portability and offline review?

## Appendix: High-Level Technical Direction

The platform should follow an OpenClaw-like pattern for a long-lived gateway/control plane and typed event protocol, while keeping simulation truth in a deterministic Python engine. Long-running runs and approval waits should be durable. Agent tool use should be typed, observable, and policy-gated. The UI should expose branches, checkpoints, trades, and soul evolution as first-class product concepts rather than hiding them behind chat transcripts.
