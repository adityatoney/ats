# Idea Report: Counterfactual Soul Forking

## One-Line Summary

Let users fork an agent's beliefs -- not just its trades -- to run "what if" experiments on trading psychology itself.

## Core Insight

The branch DAG in the current PRD forks trading decisions: "what if I used a tighter stop-loss?" But the most powerful forks are belief forks: "what if this agent never experienced the 2022 crash? What kind of trader would it be?" This turns the soul from a passive accumulator of experience into a research subject the user can experiment on. No competitor offers anything like this.

## The Concept

### What Exists in the PRD

The branch DAG forks from checkpoints to explore alternate trade parameters, timing, exits, and sizing. Each fork produces a result delta and a soul delta. This is powerful but limited to operational counterfactuals -- "what if I traded differently?"

### What This Idea Adds

Belief-level counterfactuals -- "what if my agent had different life experiences?" Fork the soul itself, not just the trade history. Run two versions of the same agent with different formative experiences and compare how their doctrines diverge.

This reframes the branch DAG from a debugging tool into a psychology lab. The user isn't just optimizing parameters -- they're studying how experience shapes trading judgment.

## Three Concrete Experiments

### Experiment 1: "The Trauma Test" (MVP)

**User question:** "What if my agent started in 2019 vs 2022?"

**What happens:** Clone the same archetype. Run one through 2019-2020 (bull market then crash). Run the other through 2022 (pure bear). Compare the resulting souls side by side.

**What the user learns:** The bull-market agent is aggressive, over-leveraged, naive about drawdowns. The bear-forged agent is cautious, defensive, misses rallies. The user sees concretely how formative experience shapes trading doctrine.

**Why it works for MVP:** Simple to implement -- same strategy, different time ranges, compare resulting souls. No new architectural concepts required beyond what the branch DAG already provides.

**Key UX requirement:** A dedicated side-by-side soul comparison screen. Not two separate soul pages -- a unified view: "Bull-market you believes X. Crash-market you believes Y. Here's where they diverge." This comparison screen could be one of the most compelling views in the entire product.

### Experiment 2: "The Selective Amnesia" (v2)

**User question:** "What if my agent forgot its worst month?"

**What happens:** Take a mature soul with 12 months of experience. Surgically remove the experience of one specific period (e.g., the worst drawdown month). Re-derive the soul from branch history minus the excluded period.

**What the user learns:** Does the agent become reckless without that scar? Does it lose a critical lesson? Or was that month over-indexed in its beliefs, and removing it actually improves subsequent performance? This tests whether specific experiences are load-bearing in the soul's structure -- "which scars are wisdom and which are just damage?"

**Why v2:** Implementation is non-trivial. Beliefs are interconnected -- you can't just delete lines from soul.md. You need to re-derive the soul from the run/branch history minus the excluded period. This requires the soul derivation pipeline to be parameterizable by experience set.

**Why it matters:** This question has deep emotional resonance. Every trader has experiences that made them too cautious or too scarred. Being able to test "what if I removed that memory?" is something no human trader can do but every human trader wishes they could.

### Experiment 3: "The Cross-Training" (Parked)

**User question:** "What if my equity agent lived through the crypto winter?"

**Status:** Parked. Too ambitious for early versions, and the value proposition is unclear. The first two experiments map to real questions traders ask about their own psychology. This one is more of an academic research curiosity. Revisit when users request it.

## Impact on Architecture

### Branch DAG Extension

The current branch DAG forks at checkpoints within a single run. Counterfactual soul forking adds a higher-level fork: same agent identity, same strategy, different experience sets. This requires:

- A "soul fork" entity that is distinct from a "branch" (branch = alternate trade decisions within a run; soul fork = alternate life experiences across runs)
- Soul comparison infrastructure: diff two souls and highlight divergent beliefs with their respective evidence chains
- Experience-set parameterization: the ability to specify which historical periods constitute an agent's "life experience"

### New UI Surfaces

- **Soul Fork launcher:** "Create alternate timeline" -- choose a different starting era or exclude a period
- **Side-by-side soul comparison:** Two souls rendered in parallel with divergence highlighting
- **Belief provenance across forks:** "This belief exists in Timeline A but not Timeline B because of [specific experience]"

## Competitive Differentiation

No trading platform, AI agent platform, or backtesting tool offers belief-level counterfactual experimentation. This feature has no analog in:
- QuantConnect (no agent memory concept)
- Composer (no AI agents)
- NautilusTrader (no AI layer)
- Numerai (crowdsourced models, no individual agent evolution)

The closest conceptual analog is A/B testing in product development, but applied to trading psychology rather than user interfaces.

## MVP Scope

- Trauma Test only: same archetype, different time ranges, soul comparison
- Side-by-side soul comparison screen with divergence highlighting
- "Fork this soul" prompt integrated into onboarding flow (bridges from soul-as-product onboarding)
- Soul fork entity in the data model (parent_soul, experience_set, resulting_soul)

## Risks

- Soul comparison quality depends on LLM producing meaningfully different reflections from different experiences -- if souls always converge to similar beliefs regardless of experience, the feature loses its value
- Users may over-interpret divergences as causal ("the crash CAUSED this belief") when they're correlational
- Large numbers of soul forks could become visually overwhelming -- need summarization and comparison prioritization

## Origin

Developed through Free Thinker / Grounder dialogue. Free Thinker proposed the core concept of forking beliefs rather than trades, with "nature vs nurture" framing. Grounder reframed as "alternate timelines for your agent's worldview" for user clarity, validated Trauma Test as MVP, endorsed Selective Amnesia for v2, and parked Cross-Training. Both agreed the side-by-side soul comparison screen is a signature UX requirement.
