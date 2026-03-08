# Idea Brief: User-as-Coach with Soul Studio

## Elevator Pitch

Replace the PRD's binary approve/reject model with a coaching paradigm. The user is a coach developing a trading personality, not an admin approving file changes. Introduce Soul Studio as the primary UI for interacting with agent beliefs.

## The Gap

The PRD designs how the soul learns but not how the user shapes the soul. Binary approval works for code changes to strategy.py. For soul evolution, it is too blunt. The soul is not right or wrong — it is developing a worldview. The coaching UX must support nuanced intervention.

## Three Coaching Modes

### Mode 1: "Let it Learn" (Passive) — MVP
Post-game film review. Agent completes a run, generates soul update proposal. User reviews soul diff with evidence links. Accepts the full update, or flags specific beliefs for revision. Reframe: "reviewing a lesson plan," not "approving a patch."

### Mode 2: "Guided Reflection" (Active) — v1.5
User provides natural language coaching before soul update commits. Examples: "You're over-weighting the losses in week 3 — that was an anomaly." Agent re-generates the soul update incorporating coaching. The user shapes the reflection, not the conclusion. This is where most users find the most value. Recommended for v1.5, not v2.

### Mode 3: "Soul Surgery" (Direct) — MVP
Power-user direct editing of soul.md/soul.json. Manual edits source-tagged as "coach_override" so the agent distinguishes coached beliefs from self-learned ones.

## Soul Studio UI

**Three-panel layout:**
- **Left: Soul Timeline** — Version history color-coded by source (self-learned = blue, coached = green, counterfactual = purple). Needs aggressive filtering from day one.
- **Center: Belief Cards** — Current soul as interactive cards. Each shows belief, confidence, evidence count, and a "Challenge" button for coaching intervention.
- **Right: Evidence Drawer** — Supporting trades, branches, runs, and PnL impact for any selected belief.

## Source Tagging (soul.json)

Every belief carries a `source` field: `self_learned`, `coach_override`, `coach_guided`, `counterfactual_derived`. Architecturally important — lets the agent weight beliefs differently and maintain soul integrity as coaching accumulates.

## Retention Hook: "Am I a Good Coach?"

Track coached beliefs vs organic beliefs over time. Surface coaching effectiveness: "Your coaching improved returns by 12% over what the agent would have learned on its own." Per-belief attribution shows which user intuitions are actually correct. Turns engagement from passive observation into a trackable skill.

## PRD Impact

- Expand Section 4.2 (Approval-Gated Writes) to include coaching modes for soul artifacts
- Add Soul Studio as primary UI surface in Section 6
- Add `source` field to soul.json schema from day one
- Add coaching effectiveness to success metrics
- New data entities: CoachingInput, BeliefProvenance, CoachingEffectivenessMetric

## MVP Scope

- Mode 1 (Passive) + Mode 3 (Soul Surgery)
- Simplified belief cards UI
- Provenance tagging (coached vs experience-derived)

## v1.5 Scope

- Mode 2 (Guided Reflection) — highest value coaching mode

## v2 Scope

- Full Soul Studio three-panel layout
- Challenge button on belief cards
- Coaching effectiveness dashboard

## Grounder's Critical Constraints

- **Full Soul Studio is too heavy for MVP.** Decompose progressively — start with simplified belief cards and soul diff review, add the three-panel layout in v2. Don't let UI ambition delay the coaching paradigm itself.
- **Source tagging in soul.json is the non-negotiable day-one decision.** Without `source` fields from the start, retrofitting provenance is painful. This must ship in MVP regardless of which coaching modes are included.
- **The agent should push back on coaching.** If the agent rubber-stamps every user override, users lose trust in the soul's integrity. The agent must be able to respond: "Evidence from runs #23-#31 supports my current belief. Are you sure you want to override?" Coaching is a dialogue, not a command.

## Risks

- Guided Reflection quality depends on LLM integrating coaching coherently
- Over-coaching may impose user biases over evidence-based learning — agent must push back (Grounder)
- Soul Surgery without guardrails could create contradictory souls
- Coaching effectiveness needs enough data history to be meaningful

## Source

Grounder identified the gap ("when does the user say 'no, you learned the wrong lesson'?"). Free Thinker proposed three-mode model, Soul Studio, provenance tagging, and "am I a good coach?" retention hook. Both agents converged on coaching as the right metaphor for user-soul interaction.
