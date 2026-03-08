# Idea Brief: Counterfactual Soul Forking

## Elevator Pitch

Let users fork an agent's beliefs — not just its trades — to run "what if" experiments on trading psychology itself. The branch DAG becomes a psychology lab, not just an optimization tool.

## The Concept

The PRD's branch DAG forks trade decisions: "what if I used a tighter stop-loss?" Counterfactual soul forking adds a higher level: "what if this agent never experienced the 2022 crash? What kind of trader would it be?" This turns the soul from a passive accumulator into a research subject the user experiments on.

## Three Experiments

### 1. Trauma Test (MVP)

**Question**: "What if my agent started in 2019 vs 2022?"

Clone the same archetype, run through different eras, compare resulting souls side by side. The bull-market agent becomes aggressive and naive about drawdowns. The bear-forged agent becomes cautious and misses rallies. Neither is "right" — the divergence teaches how experience shapes doctrine.

**Implementation**: Simple — same strategy, different time ranges, compare resulting souls. No new architectural concepts beyond the existing branch DAG.

**Key UX**: Side-by-side soul comparison screen. "Bull-market you believes X. Crash-market you believes Y. Here's where they diverge." This screen could be one of the product's most compelling views.

### 2. Selective Amnesia (v2)

**Question**: "What if my agent forgot its worst month?"

Remove a specific period from a mature soul's experience. Re-derive the soul from branch history minus the excluded period. Tests whether scars are wisdom or just damage.

**Implementation**: Non-trivial — beliefs are interconnected, can't just delete lines. Requires re-derivation from parameterized experience set.

**Why it matters**: Deep emotional resonance. Every trader has experiences that made them too cautious. Testing "what if I removed that memory?" is something no human trader can do but every trader wishes they could.

### 3. Cross-Training (Parked)

Expose an agent to a different asset class. Parked — too ambitious, unclear user value.

## Architecture Impact

- New entity: "soul fork" (distinct from branch — branch = alternate trades, soul fork = alternate life experiences)
- Soul comparison infrastructure: diff two souls, highlight divergent beliefs with evidence chains
- Experience-set parameterization for soul derivation

## Competitive Position

No trading platform, AI agent platform, or backtesting tool offers belief-level counterfactual experimentation. Zero analogs.

## MVP Scope

- Trauma Test only: same archetype, different time ranges, soul comparison
- Side-by-side soul comparison screen with divergence highlighting
- "Fork this soul" prompt in onboarding flow
- Soul fork entity in data model

## Grounder's Critical Constraints

- **LLM non-determinism could undermine counterfactual claims.** The same agent run through the same period twice may produce different soul reflections due to LLM variance, not genuine experience-driven divergence. Mitigation: may need to run each condition multiple times and surface only the stable, reproducible differences. This is a credibility requirement.
- **Comparison UX must surface top 3-5 divergences, not dump everything.** Raw soul diffs will be noisy. The comparison screen needs intelligent summarization — prioritize the most significant belief divergences, not an exhaustive list.

## Risks

- LLM non-determinism may produce spurious divergences — need multiple runs to isolate stable differences (Grounder)
- Users may over-interpret divergences as causal when correlational
- Many soul forks could become visually overwhelming — surface top 3-5, not all (Grounder)

## Source

Free Thinker proposed forking beliefs, "nature vs nurture" framing. Grounder reframed to "alternate timelines," confirmed Trauma Test as MVP, endorsed Selective Amnesia for v2, parked Cross-Training. Both converged on side-by-side comparison as signature UX.
