# Session Summary — AegisTrader Ideation

**Session**: ideation-aegistrader-20260308-102717
**Date**: 2026-03-08
**Depth**: Standard
**Concept**: Multi-Agent Financial Paper Trading Research Platform (Project AegisTrader)

## Session Arc

The session moved through four distinct phases:

1. **Divergence**: Free Thinker proposed five creative directions, all centered on elevating the "trading soul" concept from supporting feature to product identity.
2. **Sorting**: Grounder evaluated all five — endorsed two strongly (T1, T4), refined one (T3), parked one (T2), cautioned one (T5).
3. **Deepening**: The endorsed threads gained specificity — onboarding flow, concrete counterfactual experiments, and a new coaching UX thread emerged.
4. **Convergence**: Arbiter confirmed three ideas as INTERESTING, forming a unified product narrative.

## Inputs

- **Concept_1.md**: Detailed architectural blueprint — two-layer architecture, OpenClaw-inspired control plane, tech stack, trading soul structure, branch DAG, phased rollout.
- **PRD.md**: Full product requirements — 10 principles, agent authoring, backtesting, branching, approval-gated writes, live paper trading, 17+ data model entities, 5 major workflows.
- **Competitive landscape research** (two reports): Confirmed zero market analogs for soul evolution and branch DAG. Validated NautilusTrader as architectural reference. Identified QuantConnect Mia V2 as closest but fundamentally different competitor. Market size: $24B (2025) -> $44.5B (2030).

## Outputs

### Three Confirmed Ideas

**1. Soul as the Product + Soul-First Onboarding**
Reframe AegisTrader from "backtesting platform with AI agents" to "platform for growing trading personalities that learn from experience." Core formulation: "Soul powered by backtest." Includes redesigned onboarding: archetype picker -> formative experience -> soul diff -> fork prompt.

**2. Counterfactual Soul Forking (Trauma Test MVP)**
Fork beliefs, not just trades. MVP feature: Trauma Test — same agent, different eras, compare divergent souls side by side. V2: Selective Amnesia — remove a period, see which scars are wisdom vs damage. Introduces side-by-side soul comparison as a signature UX.

**3. User-as-Coach with Soul Studio**
Replace binary approve/reject with coaching paradigm. Three modes: Let it Learn (passive, MVP), Guided Reflection (active, v1.5), Soul Surgery (direct, MVP). Soul Studio UI: timeline + belief cards + evidence drawer. Source tagging in soul.json. "Am I a Good Coach?" retention hook.

### Unified Product Narrative

**Choose a personality -> Grow it through experimentation -> Coach it to improve.**

This is AegisTrader.

## Thread Disposition

| Thread | Final Status |
|---|---|
| T1: Soul as the Product | CONFIRMED INTERESTING |
| T2: Adversarial Soul Dynamics | Parked (phase 3/4) |
| T3: Soul Diff as First-Class UX | Absorbed into T1 |
| T4: Counterfactual Soul Forking | CONFIRMED INTERESTING |
| T5: Soul-to-Deterministic Graduation | Cautioned; partially absorbed by T6 |
| T6: Coaching UX / Soul Studio | CONFIRMED INTERESTING |

## Key Tensions and How They Resolved

1. **Soul as byproduct vs soul as product**: Resolved. "Soul powered by backtest" — soul is the UX surface, engine is the credibility layer.
2. **Deterministic boundary vs belief graduation**: Held. The coaching UX (T6) absorbs the useful parts of T5 without blurring the boundary — the user (not the system) decides what becomes a hard rule.
3. **Narrative vs evidence in soul diffs**: Productive tension. Direction: "narrative backed by evidence" — compelling but trustworthy.
4. **Game language vs domain language**: Resolved toward domain language. Archetypes named as trading philosophies, not character classes.
5. **Approver vs coach**: Resolved toward coaching. The user-soul relationship is developmental, not bureaucratic.

## What Did Not Survive

- **Adversarial Soul Dynamics** (T2): Interesting but premature. Multi-agent game theory on top of PnL-only visibility adds complexity without helping define the core product.
- **Cross-Training Counterfactual** (T4c): Unclear user value. Academic curiosity, not a real user question.
- **Broad belief graduation** (T5): The broader vision of soul-as-hypothesis-generator feeding the deterministic engine was rejected. The narrow version (user approves a belief becoming a hard rule) is already in the PRD via approval-gated writes.

## Impact on PRD

### Sections to Rewrite
- Executive Summary: lead with soul evolution
- Vision: "grow AI trading personalities"
- User Stories: soul-curation as primary
- Onboarding: archetype picker flow
- UI: Soul diff as hero, Soul Studio as primary surface
- Approval-Gated Writes: expand to coaching modes

### Sections to Preserve
- Deterministic engine architecture
- Branch DAG design (reframed, same technical model)
- Data sources and model stack
- File classification policy
- Non-functional requirements

### New Elements
- Archetype templates (strategy.md + seed soul.md per archetype)
- Soul fork entity in data model
- Source tagging in soul.json schema
- CoachingInput, BeliefProvenance entities
- Coaching effectiveness metrics
- Side-by-side soul comparison UX
- v1.5 milestone for Guided Reflection

## Artifacts Produced

- Ideation graph: `session/ideation-graph.md`
- Snapshots: `session/snapshots/SNAPSHOT_01.md` through `SNAPSHOT_05.md`
- Idea reports: `session/idea-reports/IDEA_soul-as-product.md`, `IDEA_counterfactual-forking.md`, `IDEA_coaching-ux.md`, `IDEA_user-as-coach-soul-studio.md`
- Briefs: `session/briefs/BRIEF_soul-as-product.md`, `BRIEF_counterfactual-forking.md`, `BRIEF_coaching-ux.md`
- Research: `session/research/COMPETITIVE_LANDSCAPE.md`, `RESEARCH_competitive-landscape.md`
- Vision document: `session/VISION_aegistrader.md`
