# Vision: AegisTrader

## What This Is

Consolidated output of ideation session `ideation-aegistrader-20260308-102717` (2026-03-08). This is the **source of truth for the production phase**. The architecture defined in Concept_1.md and PRD.md remains the technical foundation — this document reshapes the product framing, UX, and user experience layer on top of it.

---

## Core Thesis

AegisTrader is not a backtesting platform with AI features. It is a platform for growing, experimenting on, and coaching trading personalities.

The backtest engine provides credibility. The soul provides the experience. Users choose a trading philosophy, give it life experience through historical markets, watch it develop beliefs and doctrine, fork it into alternate timelines, and coach it toward better judgment.

This is a new product category. No existing platform — not QuantConnect, not Composer, not Numerai, not any AI agent framework — offers evolving trading personalities grounded in deterministic, reproducible simulation.

---

## Governing Principle

**"Soul powered by backtest."**

Every soul claim must trace back to deterministic, reproducible evidence. The deterministic engine provides reproducibility, auditability, and trust. The soul provides meaning, engagement, and differentiation. Neither works without the other.

---

## Three Moves

### Move 1: Soul as the Product

Reframe AegisTrader's positioning. The trading soul — not the backtest engine — is the primary object of user attention. "Grow trading personalities that learn from experience" is the pitch, not "backtesting platform with AI agents."

**Soul-First Onboarding:**

1. **Archetype picker** (min 0-2): User chooses a trading philosophy — Mean Reversion, Trend Following, Event-Driven, Defensive Value. Each archetype = pre-built strategy.md + seed soul.md. The user is choosing a worldview, not configuring software. Archetypes use trading philosophy language, not character class language.

2. **Formative experience** (min 2-5): System auto-selects a dramatic historical period and runs a compressed 3-6 month backtest. UI emphasizes soul formation: "Your agent just experienced its first 30% drawdown. It's forming its first scar tissue."

3. **Soul diff** (min 5-10): Before/after screen showing how the agent changed. Every belief is evidence-linked: "This agent now reduces size after consecutive losses — that came from losing 12% in week 3."

4. **Fork prompt**: "Want to keep training? Or fork this soul and see what happens if it had a different experience?" Bridges directly to counterfactual forking.

**"Grow trading personalities" positioning**: The current PRD reads like "QuantConnect plus ChatGPT." The soul-first framing creates a product category that does not exist. Competitive research confirms zero market analogs for evolving agent doctrine as a product feature.

**Critical constraint (Grounder)**: Seed archetype quality is non-negotiable. Each archetype's strategy.md must be a genuinely viable trading approach, not a demo. A bad first backtest kills the onboarding. Evidence-linking in soul diffs is what prevents the soul-first framing from being perceived as a gimmick.

### Move 2: Counterfactual Soul Forking

Fork an agent's beliefs — not just its trades — to run "what if" experiments on trading psychology itself. The branch DAG becomes a psychology lab. The soul becomes a research subject the user experiments on.

**MVP Feature — Trauma Test:**
- Clone the same archetype. Run one through a bull market era, one through a bear market era. Compare the resulting souls side by side.
- The bull-market agent becomes aggressive and naive about drawdowns. The bear-forged agent becomes cautious and misses rallies. Neither is "right."
- The divergence teaches how formative experience shapes trading doctrine.
- Implementation: same strategy, different time ranges, compare resulting souls. Builds on existing branch DAG.

**Signature UX — Side-by-Side Soul Comparison:**
- Not two separate soul pages. A unified view: "Bull-market you believes X. Crash-market you believes Y. Here's where they diverge."
- Top 3-5 most significant divergences surfaced prominently, not a raw dump. Evidence links on every belief.
- This screen is where AegisTrader's identity crystallizes for the user (see "Convergence Screen" below).

**V2 Feature — Selective Amnesia:**
- "What if my agent forgot its worst month?" Remove a period from a mature soul's experience. Re-derive the soul from branch history minus the excluded period.
- Tests whether specific scars are wisdom or damage. "Which scars are useful and which are just damage?" Deep emotional resonance.
- Implementation: non-trivial. Beliefs are interconnected. Requires re-derivation from parameterized experience set.

**Critical constraint (Grounder)**: LLM non-determinism could undermine counterfactual claims. The same agent run through the same period twice may produce different soul reflections due to LLM variance, not genuine experience-driven divergence. Mitigation: may need to run each condition multiple times and surface only stable, reproducible differences.

**Architecture impact:**
- New entity: "soul fork" (distinct from branch — branch = alternate trades within a run, soul fork = alternate life experiences across runs)
- Soul comparison infrastructure with divergence ranking/prioritization
- Experience-set parameterization for soul derivation
- Multi-run stability checking for counterfactual claims

### Move 3: User as Coach

Replace the PRD's binary approve/reject model for soul modifications with a coaching paradigm. The user is a coach developing a trading personality, not an admin approving file changes.

**Three Coaching Modes:**

1. **"Let it Learn" (Passive) — MVP**: Post-game film review. User reviews soul diffs after runs, accepts or flags specific beliefs. Reframe: "reviewing a lesson plan," not "approving a patch."

2. **"Guided Reflection" (Active) — v1.5**: User provides natural language coaching before soul update commits. "You're over-weighting the losses in week 3." Agent re-generates incorporating coaching. This is where most users find the most value. Recommended for v1.5, not v2.

3. **"Soul Surgery" (Direct) — MVP**: Power-user direct editing of soul.md/soul.json. Edits source-tagged as `coach_override`.

**Soul Studio UI** (full version v2, simplified MVP):
- **Left: Soul Timeline** — Version history color-coded by source (self-learned = blue, coached = green, counterfactual = purple). Aggressive filtering needed.
- **Center: Belief Cards** — Current soul as interactive cards with confidence, evidence count, and "Challenge" button.
- **Right: Evidence Drawer** — Supporting trades, branches, runs for any selected belief.

**Belief Provenance Tagging** (from day one):
Every belief carries a `source` field: `self_learned`, `coach_override`, `coach_guided`, `counterfactual_derived`. This lets the agent distinguish coached beliefs from organic ones and track provenance over the soul's lifetime.

**Retention Hook — "Am I a Good Coach?":**
Track coached beliefs vs organic beliefs over time. Surface coaching effectiveness. Per-belief attribution shows which user intuitions are correct. Turns engagement from passive observation into a trackable skill.

**Critical constraints (Grounder):**
- Full Soul Studio three-panel layout is too heavy for MVP. Decompose progressively — start with simplified belief cards and soul diff review, add the full layout in v2.
- Source tagging in soul.json is the non-negotiable day-one decision. Without `source` fields from the start, retrofitting provenance is painful.
- The agent must push back on coaching. If the agent rubber-stamps every user override, users lose trust. The agent should respond: "Evidence from runs #23-#31 supports my current belief. Are you sure you want to override?" Coaching is a dialogue, not a command.

---

## How They Fit Together

**Choose a personality -> Grow it through experimentation -> Coach it to improve.**

```
Archetype Picker (Move 1)
    |
    v
Formative Experience Backtest (Move 1)
    |
    v
Soul Diff Screen (Move 1) <--- Evidence-grounded beliefs
    |
    +---> Fork Prompt (Move 2) ---> Trauma Test ---> Side-by-Side Comparison
    |
    v
Coaching Interaction (Move 3)
    |
    +---> Let it Learn (review)
    +---> Guided Reflection (shape)
    +---> Soul Surgery (edit)
    |
    v
Next Run / Next Fork / Next Coaching Cycle
```

### The Convergence Screen: Side-by-Side Soul Comparison

The side-by-side soul comparison screen is where all three moves converge into a single experience. It is the screen where AegisTrader's identity crystallizes for the user.

On this screen, the user simultaneously:
- **Sees two souls shaped by different experiences** (counterfactual forking) — the bull-market agent and the bear-forged agent side by side
- **Reads their divergent beliefs with evidence links** (soul-as-product) — each belief traces to specific trades and runs, grounded in the deterministic engine
- **Can challenge or coach either one** (coaching UX) — the user intervenes in the soul's development, shaping which lessons stick

No other screen in the product brings all three moves together. This is the moment where "grow trading personalities through experimentation and coaching" stops being a description and becomes something the user is doing.

**Design priority**: This screen should receive outsized design investment. It is not a comparison utility — it is the product's defining interaction.

---

## Key Design Decisions

### 1. Evidence Chain as Shared Infrastructure

All three moves depend on a common capability: **structured evidence provenance for every belief in soul.json**. This is the architectural foundation that makes soul diffs trustworthy, counterfactual comparisons meaningful, and coaching attribution possible.

| Move | What it needs from evidence chain |
|---|---|
| Soul Diffs (Move 1) | Verifiable links from each belief to the trades/runs that produced it |
| Counterfactual Comparison (Move 2) | Distinguishing genuine experience-driven divergence from LLM noise |
| Coaching Attribution (Move 3) | Measuring whether coached beliefs outperform self-learned ones |

**Required `evidence_refs[]` structure in soul.json:**

The current Concept_1.md defines `evidence_refs[]` as a flat list. This is insufficient. Each evidence reference needs:

- **`run_id` / `branch_id`** — which run or branch produced this evidence
- **`trade_ids[]`** — which specific trades within that run support the belief
- **`branch_comparisons[]`** — which branch-vs-branch comparisons tested the belief
- **`confidence`** — confidence level based on sample size (how many runs/trades support this)
- **`source_type`** — `self_learned` | `coach_override` | `coach_guided` | `counterfactual_derived`
- **`timestamp`** — when this evidence was incorporated

**MVP requirement**: The evidence chain schema must ship in Phase 1. Retrofitting structured provenance onto flat evidence lists is architecturally painful. This is a day-one decision.

### 2. Deterministic/Non-Deterministic Boundary Stays Sharp

The two-layer architecture from Concept_1.md is preserved. The soul-first framing makes the deterministic engine *more* important, not less — it is the credibility layer. The non-deterministic layer (LLM reflections, soul generation, coaching integration) may only produce proposals, annotations, hypotheses, and summaries. The deterministic layer alone produces accepted decisions, account state, fills, and branch outcomes.

The coaching paradigm (Move 3) does not blur this boundary. Coaching operates entirely within the non-deterministic layer. When a coached belief needs to become a hard deterministic constraint, it flows through the existing approval-gated write mechanism to strategy.py.

### 3. Source Tagging From Day One

Every belief in soul.json carries a `source` field from MVP launch. This is non-negotiable. It enables: agent pushback on coaching, coaching effectiveness measurement, counterfactual provenance, and soul integrity over time.

---

## Boundaries

- **Not a brokerage.** AegisTrader does not execute real-money trades in initial versions.
- **Not financial advice.** The platform must clearly label itself as paper trading and research tooling.
- **Not an opaque AI black box.** Every soul belief links to evidence. Every decision is inspectable. The soul is interpretation, not truth.
- **The soul is not the source of truth.** The deterministic engine is. The soul is a learned interpretation of truth — derived, versioned, diffable, and replay-linked.

---

## Open Questions

1. **LLM non-determinism in counterfactuals**: How many runs are needed to establish stable soul divergences? What's the threshold for surfacing a difference as "real" vs noise? This needs empirical testing during Phase 1.

2. **Guided Reflection quality**: Can LLMs reliably integrate vague natural language coaching ("you're too cautious") into coherent, structured soul updates? This determines whether v1.5 ships as designed or needs significant prompt engineering investment.

3. **Soul Timeline noise management**: After 20+ runs, the soul timeline will be dense. What summarization and grouping strategies keep it usable? Must ship with filtering from day one, not retrofit later.

4. **Archetype design**: Who designs the seed strategy.md + soul.md for each archetype? These must be genuinely viable strategies — they are the product's first impression.

5. **Coaching effectiveness validity**: How much run history is needed before coaching effectiveness metrics are statistically meaningful? Early results may be noisy.

---

## Impact on Existing PRD

### Rewrite Required

| PRD Section | Change |
|---|---|
| Executive Summary | Lead with soul evolution, not backtesting |
| Vision | "The best platform for growing AI trading personalities" |
| User Stories | Soul-curation as primary stories; backtesting as supporting |
| Onboarding (Workflow A) | Replace create-agent-write-strategy with archetype picker flow |
| Section 4.2 (Approval-Gated Writes) | Expand to coaching modes for soul artifacts |
| Section 6 (UI) | Soul diff as hero screen; add Soul Studio; add side-by-side soul comparison |
| Success Metrics | Add soul-curation and coaching effectiveness metrics |

### Preserve As-Is

| PRD Section | Reason |
|---|---|
| Deterministic engine architecture | This IS the credibility layer — soul-first framing makes it more important, not less |
| Branch DAG design | Reframed as biography, but same technical model |
| Data sources and model stack | Unchanged |
| File classification policy | Unchanged |
| Non-functional requirements | Unchanged |
| Live paper trading | Unchanged |
| Scheduling | Unchanged |

### New Elements to Add

| Element | Scope |
|---|---|
| Archetype templates (strategy.md + seed soul.md per archetype) | MVP |
| Soul fork entity in data model | MVP |
| Structured `evidence_refs[]` in soul.json | MVP |
| `source` field in soul.json schema | MVP |
| Side-by-side soul comparison screen | MVP |
| CoachingInput, BeliefProvenance data entities | MVP |
| Guided Reflection mode | v1.5 |
| Full Soul Studio three-panel UI | v2 |
| Selective Amnesia counterfactual | v2 |
| Coaching effectiveness metrics and dashboard | v2 |

---

## Revised Phasing

The existing PRD phases remain valid. The soul-first framing reshapes what ships in each phase and adds a v1.5 milestone.

### Phase 1: Single-Agent Soul Evolution (MVP)
Everything in the current Phase 1, plus:
- Archetype picker with 4 trading philosophies
- Compressed formative experience backtest
- Soul diff as hero screen with evidence links
- Trauma Test counterfactual (same agent, different eras)
- Side-by-side soul comparison with divergence ranking
- Mode 1 (passive coaching) + Mode 3 (soul surgery)
- Source tagging and structured evidence_refs in soul.json

### Phase 1.5: Guided Coaching (NEW)
- Mode 2 (guided reflection) — natural language coaching
- Challenge button on belief cards
- Enhanced Soul Studio layout

### Phase 2: Multi-Agent Competition
As currently defined in PRD, plus:
- Coaching effectiveness tracking across agents
- Per-agent soul comparison

### Phase 3: Live Paper Trading
As currently defined in PRD, plus:
- Live soul updates with coaching review before commit
- Coaching effectiveness dashboard

### Phase 4: Governance and Advanced Features
As currently defined, plus:
- Selective Amnesia counterfactual
- Full coaching effectiveness analytics
- Consider: Adversarial Soul Dynamics (parked from ideation — evaluate based on user demand)

---

## Deferred Ideas

| Idea | Reason Deferred | Revisit When |
|---|---|---|
| Adversarial Soul Dynamics | Premature complexity; multi-agent basics need to work first | Phase 3/4, if users request |
| Cross-Training Counterfactual | Unclear user value; academic curiosity | When users request cross-asset experiments |
| Broad Belief Graduation (soul auto-feeding deterministic layer) | Risks eroding the deterministic boundary | If coaching UX proves the narrow version works safely |

---

## Competitive Positioning

AegisTrader's moat is the combination of four things no competitor offers together:

1. **Deterministic simulation truth** — reproducible, auditable backtests (validated by NautilusTrader pattern)
2. **Evolving trading souls** — versioned, diffable, evidence-linked agent doctrine (zero market analogs)
3. **Branch DAG as biography** — git-like history for both trades and beliefs (zero market analogs)
4. **Coaching relationship** — user shapes agent development through review, guidance, and direct intervention

The positioning should lead with what is unique: "Grow trading personalities that learn from experience." The backtesting engine, while essential, is table stakes — it is the credibility layer, not the differentiator.

**Market context**: Algorithmic trading market $24B (2025) projected to $44.5B (2030), 13.2% CAGR. AegisTrader targets the research-oriented builder segment with a product that no existing platform addresses.

---

## Key Design Principles

1. **"Soul powered by backtest"** — the engine is credibility, the soul is experience. Neither without the other.
2. **Evidence-grounded, not narrative-first** — every soul belief links to specific trades, branches, and outcomes. Compelling AND trustworthy.
3. **Trading philosophy language, not game language** — archetypes are Mean Reversion, not Patient Contrarian. The product is serious but accessible.
4. **Coach, not approver** — the user's relationship to the soul is developmental, not bureaucratic.
5. **The soul diff is the hero screen** — after every run, the most important thing is who the agent became, not what its PnL was.
6. **Provenance is a first-class concept** — every belief knows where it came from. This enables trust, debugging, and coaching effectiveness.
7. **The agent pushes back** — coaching is a dialogue, not a command. Rubber-stamping kills trust.
8. **Progressive disclosure, not feature overload** — start simple, layer complexity across versions.

---

## Session Provenance

This vision document was produced from ideation session `ideation-aegistrader-20260308-102717`.

**Participants**: Free Thinker (divergent ideation), Grounder (convergent refinement), Explorer (competitive research), Writer (observation and synthesis).

**Source documents**: `docs/Concept_1.md`, `docs/PRD.md`

**Session artifacts**: Ideation graph, 5 snapshots, 5 idea reports, 3 briefs, 2 research reports, session summary.

**All session artifacts**: `ideations/ideation-aegistrader-20260308-102717/session/`
