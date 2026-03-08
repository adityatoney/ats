# Idea Report: Coaching UX and Soul Studio

## One-Line Summary

Replace the PRD's binary approve/reject model with a coaching paradigm where users shape their agent's learning through passive review, guided reflection, and direct soul editing -- all tracked for effectiveness.

## Core Insight

The PRD frames the user as an "approver" -- a gatekeeper who accepts or rejects agent change proposals. But in a soul-first product, the user's relationship to the soul is that of a coach, not an approver. A coach doesn't just say "approved" or "rejected" -- a coach says "you're over-weighting that lesson," "you learned the wrong thing from that trade," or "your risk aversion is justified but you've overcorrected."

Binary approval works for code changes to strategy.py. For soul evolution, it's too blunt. The soul isn't right or wrong -- it's developing a worldview. The coaching UX must support nuanced intervention.

## Three Coaching Modes

### Mode 1: "Let it Learn" (Passive Coaching) -- MVP

The default mode. The user sets the agent loose and reviews soul diffs after runs complete, like post-game film review.

**How it works:**
- Agent completes a run
- Soul update proposal is generated
- User reviews the soul diff with evidence links
- User accepts the full update, or flags specific beliefs for revision
- Flagged beliefs are queued for re-evaluation in the next run

**Reframe from PRD:** The user isn't approving a patch -- they're reviewing a lesson plan. The soul diff screen shows: "Here's what your agent learned. Here's the evidence. Do you agree with these lessons?"

### Mode 2: "Guided Reflection" (Active Coaching) -- v1.5

After a run completes but before the soul update commits, the user intervenes in the reflection process itself. Not by editing soul.md directly, but by providing natural language coaching prompts.

**Example coaching inputs:**
- "You're too focused on the losses in week 3. What about the recovery in week 4?"
- "You concluded momentum doesn't work, but you only tested it in low-volume conditions. That's a sampling bias."
- "Your new risk aversion is justified, but you've overcorrected. Keep the lesson but soften the constraint."
- "The drawdown in March wasn't your fault -- it was an exogenous shock. Don't learn from it."

**How it works:**
- Agent generates initial soul update proposal
- User reviews and provides coaching commentary
- Agent re-generates the soul update incorporating the coaching
- User reviews the revised proposal and accepts or iterates

The user shapes the reflection, not the conclusion. This is where the LLM layer provides unique value -- it can take natural language coaching and produce a revised, coherent soul update that integrates the user's guidance with the agent's experience.

**Agent pushback:** Critically, the agent should be able to push back on coaching. "I hear your correction, but 12 runs across 3 branches support my current belief." Coaching should be a dialogue, not a rubber stamp. If the user overrides anyway, the override is logged and tracked -- and subsequent runs will reveal whether the user or the agent was right.

### Mode 3: "Soul Surgery" (Direct Intervention) -- MVP

Power-user mode. The user directly edits soul.md or soul.json.

**Key design principle:** Manual edits get source-tagged identically to experience-derived beliefs. An experience-derived belief records "learned from run #47, branch #3." A manually-edited belief records "coach override by user on March 8."

**Why provenance tagging matters:**
- The agent can distinguish between lessons it learned organically and instructions it received from the user
- "I believe X because I learned it" vs "I believe X because my coach told me to"
- Over time, coached beliefs get validated or invalidated by subsequent experience
- The soul becomes a record of both the agent's learning AND the user's coaching -- nature plus nurture

## UI Concept: "Soul Studio"

A dedicated workspace for soul curation -- distinct from the backtest viewer and the code editor.

### Three-Panel Layout

**Left Panel: Soul Timeline**
A vertical timeline showing every soul version, what changed, and why.
- Each entry is clickable and expandable
- Color-coded by source: blue = experience-derived, gold = coach intervention, red = later invalidated
- Must include aggressive filtering and grouping from day one -- the timeline will get noisy fast
- Shows the full history of the soul's evolution at a glance

**Center Panel: Current Soul (Belief Cards)**
The live soul rendered as structured belief cards, not raw markdown.
- Each card displays: belief text, confidence level, source (run/branch/coach), age
- Each card has a "challenge" button -- the primary coaching interaction point
- Cards can be grouped by category: market beliefs, risk doctrine, timing lessons, anti-patterns

**Right Panel: Evidence Drawer**
When any belief is selected, the right panel shows supporting evidence:
- Specific trades that informed the belief
- Branch comparisons that tested it
- PnL impact of following vs not following the belief
- If coached: the original coaching input and subsequent validation/invalidation

### The "Challenge" Button

The primary coaching interaction. When the user clicks "challenge" on a belief card:
1. A coaching input field appears
2. User types their challenge or correction in natural language
3. System queues a guided reflection for the next run, OR generates an immediate soul revision proposal
4. The challenge itself becomes part of the soul's provenance history

## The Retention Hook: "Am I a Good Coach?"

Every coaching intervention is logged, timestamped, and tracked against subsequent agent performance.

Over time, the user can answer: "Did my coaching actually help? Did the beliefs I imposed perform better than the beliefs the agent learned on its own?"

**Coaching effectiveness dashboard (v2+):**
- Per-belief coaching attribution: track effectiveness at the individual belief level, not just aggregate
- Coached beliefs vs organic beliefs: which perform better?
- Coach intervention frequency over time
- Beliefs that the user overrode which were later validated by experience (the agent was right)
- Beliefs the user imposed that outperformed the agent's original learning (the user was right)

The meta-question "am I a good trading coach?" is a retention hook no other platform can offer. It turns the user's engagement from passive observation into an active, trackable skill.

## Impact on PRD

### What Changes
- Section 4.2 (Approval-Gated Writes): expand to include coaching modes for soul artifacts, not just binary approve/reject
- Section 4.3 (Approval Modes): add "coaching" as a distinct interaction pattern alongside once/session/scoped
- Section 6 (UI): add Soul Studio as a primary UI surface
- Soul artifact policy: soul.md and soul.json should support both agent-written and user-written beliefs with provenance tagging
- New data model entities: CoachingInput, BeliefProvenance, CoachingEffectivenessMetric
- soul.json schema must include source tagging (self-learned vs coached vs counterfactual-derived) from day one -- not a later addition

### What Stays the Same
- Approval-gated writes for strategy.py and other code artifacts (binary approve/reject is correct for code)
- The deterministic/non-deterministic boundary (coaching is entirely within the non-deterministic layer)
- File classification policy (safe_to_edit, approval_required, never_editable_by_agent)

## MVP Scope

- Mode 1 (Passive Coaching): soul diff review with accept/flag
- Mode 3 (Soul Surgery): direct editing with provenance tagging
- Belief cards UI (simplified version -- may not need full three-panel layout in MVP)
- Provenance tagging: coached vs experience-derived beliefs

## v1.5 Scope

- Mode 2 (Guided Reflection): natural language coaching with LLM-assisted soul revision -- this is where the magic lives, should ship as soon after MVP as possible

## v2 Scope

- Full Soul Studio three-panel layout
- Challenge button on belief cards
- Coaching effectiveness dashboard with per-belief attribution

## Risks

- Guided Reflection (Mode 2) quality depends heavily on LLM ability to integrate coaching input coherently -- if the LLM ignores or misinterprets coaching, users lose trust
- Over-coaching could produce agents that reflect the user's biases rather than learning from evidence -- need to surface when coaching contradicts evidence
- Soul Surgery (Mode 3) without guardrails could let users create internally contradictory souls -- consider validation checks
- The coaching effectiveness dashboard requires enough data (many runs, many interventions) to be statistically meaningful -- may not be useful until agents have substantial history

## Origin

Developed through Free Thinker / Grounder dialogue. Grounder identified the gap: the PRD's approval model is transactional, but a soul-first product needs a coaching relationship. Free Thinker proposed the three-mode model (Passive, Guided Reflection, Soul Surgery), the Soul Studio UI, belief provenance tagging, and the "am I a good coach?" retention hook. Grounder validated and refined: Mode 2 should be v1.5 not v2 (it's where the magic lives), Soul Timeline needs aggressive filtering from day one, coaching attribution should be per-belief not aggregate, and source tagging must be in the soul.json schema from day one.

## Unified Narrative

The three idea reports form one coherent product story: **choose a personality** (soul-as-product onboarding) -> **grow it** (counterfactual forking) -> **coach it** (Soul Studio). That's AegisTrader.
