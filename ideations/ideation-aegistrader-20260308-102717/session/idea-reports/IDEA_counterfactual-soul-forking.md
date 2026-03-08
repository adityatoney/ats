# Idea Report: Counterfactual Soul Forking

## Summary

Extend the branch DAG concept from forking trade decisions to forking agent beliefs. Users can ask "what if this agent never experienced the 2022 crash?" and compare how different life experiences produce different trading doctrines. This creates a unique research capability with no existing analog in any trading platform.

## Origin

Free Thinker direction #4, refined through dialogue. Grounder identified as the most genuinely novel idea in the session. Connects directly to Soul-as-Product — if the soul is the product, counterfactual forking is the power-user feature that gives it experimental depth.

## The Idea

The PRD's branch DAG currently forks trade parameters: alternate thresholds, timing, exit logic. Counterfactual soul forking goes deeper — it forks the agent's beliefs and worldview by changing which experiences shaped them.

This turns the soul from a passive accumulator ("it learned over time") into a research subject ("let's test what it would believe under different conditions").

## Three Concrete Experiments

### 1. Trauma Test (MVP)
- Same agent, same strategy, started in 2019 bull market vs. 2022 bear market.
- Compare the resulting souls side by side: what does each version believe? Where do their doctrines diverge?
- "Bull-market you is aggressive on momentum. Crash-market you has strict drawdown limits and an abstention doctrine for high-volatility weeks."
- **Most intuitive, easiest to implement.** Same strategy through different time ranges, compare resulting souls.
- **Key UX requirement:** Side-by-side soul comparison screen. Not two separate pages — a unified comparison view showing belief divergence with evidence links.

### 2. Selective Amnesia (v2)
- Take a mature soul with 50+ runs of experience. Remove a specific bad period (e.g., a brutal month of losses).
- Re-derive the soul from the remaining branch history.
- Question: "Which scars are useful wisdom and which are just damage holding you back?"
- **Most emotionally resonant.** Every trader has experiences that made them too cautious. Being able to test whether removing that memory improves performance is something no human trader can do.
- **Implementation note:** Non-trivial. Beliefs in the soul are interconnected — you can't just delete lines. You'd need to re-derive the soul from branch history minus the excluded period. Worth scoping carefully.

### 3. Cross-Training (Parked)
- Expose an equity-trained agent to crypto market history. Does trading wisdom transfer across asset classes?
- **Too ambitious for early versions and value proposition is unclear.** The first two experiments map to questions real traders ask about their own psychology. This one is more academic. Park until users request it.

## Research Validation (Explorer)

Counterfactual memory manipulation is active AI research — a December 2025 arXiv survey explicitly calls for "counterfactual replay" as a frontier technique. However, zero products have implemented it. AegisTrader would be the first to productize counterfactual memory experimentation on AI agents. This is not just a feature gap — it's a research-to-product gap that creates genuine first-mover advantage.

## Grounder's Honest Take

**Buildability:** The Trauma Test is straightforward. Same strategy through different time ranges — the branch DAG and checkpoint system already support this. The new piece is the side-by-side soul comparison screen, which is UI work, not architectural change. Could ship in Phase 1 or early Phase 2. Selective Amnesia is harder — re-deriving a soul minus excluded periods requires source-tagging infrastructure from the coaching idea. Naturally a v2 feature.

**User resonance:** "What kind of trader do you become if you start in a crash vs. a bull market?" — every trader gets that instantly. Selective Amnesia goes deeper: "which of my bad experiences made me wiser and which just made me scared?" Real emotional resonance that extends beyond trading.

**What I'd watch out for:** Two souls will have dozens of small belief differences — the UI must surface the 3-5 most significant divergences, not dump everything. Also, users need to understand that soul differences come from both different experiences AND LLM non-determinism. If two identical runs produce different souls from model variance alone, the counterfactual claim weakens. The system should probably run each condition multiple times and surface stable belief differences vs. noise.

**Bottom line:** Trauma Test is the clear MVP counterfactual. Simple to build, immediately resonant, and the side-by-side comparison could be a signature screen users screenshot and share. First-mover on productizing counterfactual replay research.

## Impact on PRD

- Extend branch DAG model to support belief-level forks, not just parameter-level forks
- Add soul comparison view to UI requirements (side-by-side belief divergence with evidence links)
- Add "formative period" concept to run configuration (which historical period shapes this agent)
- Extend soul.json schema to track which experiences contributed to each belief (needed for Selective Amnesia)
- Add counterfactual experiment as a first-class workflow alongside backtest and live paper trading

## Risks

- Users may over-interpret soul differences as causal when they're partly artifacts of LLM non-determinism
- Side-by-side comparison needs careful design to avoid overwhelming users with too many belief differences
- Selective Amnesia's re-derivation could be computationally expensive for mature agents with deep branch history

## Recommendation

**Ship Trauma Test as MVP counterfactual feature.** It connects directly to the soul-first onboarding (the "fork this soul" prompt at minute 10). Design the side-by-side soul comparison screen as a core UI component. Scope Selective Amnesia for v2 with careful architectural planning.
