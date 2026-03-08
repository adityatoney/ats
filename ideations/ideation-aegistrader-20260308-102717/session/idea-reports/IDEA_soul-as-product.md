# Idea Report: Soul as the Product

## One-Line Summary

Reframe AegisTrader from "backtesting platform with AI agents" to "platform for growing and curating trading personalities that learn from experience."

## Core Insight

The trading soul -- not the backtest engine -- is AegisTrader's true product. The backtest is the gym where souls train. The branch DAG is the soul's biography. The deterministic engine is the credibility layer that makes the soul trustworthy. No competitor offers anything like this: evolving, inspectable, diffable trading personalities grounded in reproducible evidence.

**Positioning formula:** "Soul powered by backtest." The engine provides credibility. The soul provides experience.

## The Problem with Current Framing

The PRD positions AegisTrader as a backtesting platform with AI features. That pitch sounds like "QuantConnect plus ChatGPT" -- a crowded, undifferentiated space. The soul concept is buried as a feature rather than elevated as the product's identity. Competitive research confirms: branch DAGs and evolving agent doctrine have zero analogs in the market. Leading with what's unique changes the entire product category.

## Product Vision

### What Changes

| Current PRD Framing | Soul-First Framing |
|---|---|
| Create agent, write strategy, run backtest | Choose a trading personality, give it life experience, watch it evolve |
| Backtest results are the primary output | Soul evolution is the primary output |
| Branch DAG is a debugging/inspection tool | Branch DAG is the soul's biography |
| PnL charts are the hero screen | Soul diff is the hero screen |
| User is an operator/approver | User is a coach/curator |
| Agents compete on returns | Agents develop divergent worldviews |

### Soul-First Onboarding (First 10 Minutes)

**Minute 0-2: "What kind of trader do you want to grow?"**
User picks from trading philosophy archetypes -- not strategies, not configs:
- **Mean Reversion** -- waits for overreactions, buys fear, sells greed
- **Trend Following** -- rides momentum until it breaks
- **Event-Driven** -- trades around catalysts and earnings
- **Defensive Value** -- small positions, high win rate, avoids volatility

Each archetype is a pre-built strategy.md + seed soul.md. The user chooses a trading worldview to develop, not a configuration file to fill out.

**Minute 2-5: "Let's give it some life experience."**
The system auto-selects a dramatic historical period (2020 crash, 2021 melt-up, 2022 bear market) and runs a compressed "formative experience" backtest -- 3-6 months of the most character-building market period for that archetype. The UI emphasizes soul formation over PnL: "Your agent just experienced its first 30% drawdown. It's forming its first scar tissue."

**Minute 5-10: "Here's who your agent became."**
The soul diff screen appears. Before: the seed archetype. After: a personality shaped by what it lived through. Each belief is evidence-linked: "This agent now reduces size after consecutive losses -- that came from losing 12% in week 3."

Then the key prompt: "Want to keep training? Or fork this soul and see what happens if it had a different experience?"

The user's second action is "create an alternate timeline," not "configure another backtest." This bridges directly to counterfactual soul forking.

### Why This Onboarding Matters

The current PRD onboarding creates a backtesting user. This onboarding creates a soul curator. Different starting experience produces a different long-term engagement pattern. The user's relationship with the product becomes personal -- they're growing something, not operating a tool.

## Evidence-Grounded Soul Diffs (UX Principle)

The soul diff screen should be the hero screen of the product, but it must stay evidence-grounded rather than purely narrative. The right format:

"Before run #47, this agent believed momentum works in all regimes. After run #47, it learned that momentum fails in low-volume weeks. Here's the exact trade that changed its mind."

Each belief transformation links to: the specific trades that caused it, the branch comparisons that informed it, and the PnL impact. Evidence-linked transformation is compelling AND trustworthy. Pure narrative without evidence becomes creative writing that users stop trusting.

## Competitive Differentiation

- No existing product combines deterministic backtesting + AI agent exploration + branch DAG + evolving souls
- QuantConnect's Mia V2 is an AI coding assistant -- fundamentally different interaction model
- Composer offers visual strategies with no AI agent layer
- NautilusTrader validates the deterministic engine pattern but deliberately excludes AI, UI, and branching
- The "grow a trading personality" framing creates a product category that does not currently exist

### Research Validation (Explorer)

Archetype-based onboarding has market precedent in fintech (risk profile quizzes, investment style selectors), but applying archetypes to AI agents rather than human users is the novel twist. No existing product lets users choose a trading philosophy and then watch an AI agent develop that philosophy through simulated experience. This is the differentiation — not the archetype concept itself, but the agent-evolves-from-archetype loop.

## Grounder's Honest Take

**What makes it land:** This solves a real positioning problem. "AI backtesting platform" puts AegisTrader in a cage with every other backtester. "Grow trading personalities" creates a category that doesn't exist. The archetype-first onboarding is the right entry — choosing a trading philosophy feels like a meaningful decision, not a setup wizard. The formative experience backtest in the first 5 minutes gives users an emotional hook before they've learned any features.

**What could lose users:** Two failure modes. First, if the archetypes are shallow — if "Mean Reversion" is just a bad RSI strategy that loses money on the first run, the soul-as-product framing collapses immediately. The seed strategies MUST be credible. They don't need to be profitable, but they need to produce interesting, believable behavior. Second, there's a trust gap: sophisticated users (the primary persona) may see "trading personality" language and think it's marketing fluff. The evidence-grounded soul diff is the antidote — every soul claim must link to real trades and real results. The moment users see a soul belief they can't trace back to evidence, trust evaporates.

**Bottom line:** Strongest idea of the session. Adopt as primary positioning. But the credibility of the seed archetypes and the evidence-linking in soul diffs are non-negotiable — without them, "trading personality" becomes a gimmick.

## Impact on PRD

### Sections That Need Rewriting
- Executive Summary: lead with soul evolution, not backtesting
- Vision: "the best platform for growing AI trading personalities" not "AI-assisted trading research"
- User Stories: add soul-curation stories as primary, move backtesting stories to supporting
- UI section: elevate soul diff and soul timeline; de-emphasize raw analytics views
- Onboarding workflow: replace create-agent-write-strategy with archetype-picker flow

### Sections That Stay the Same
- Deterministic engine architecture (this IS the credibility layer)
- Branch DAG design (reframed as soul biography, but same technical design)
- Approval-gated writes (reframed as coaching, same mechanism)
- Data sources and model stack (unchanged)

## MVP Scope

- Archetype picker with 4 pre-built trading philosophies
- Compressed "formative experience" backtest (auto-selected historical periods)
- Soul diff as hero screen with evidence-linked beliefs
- "Fork this soul" prompt bridging to counterfactual forking
- All existing deterministic engine requirements unchanged

## Risks

- "Growing personalities" framing may feel too gamified for serious quant users -- mitigate by grounding everything in evidence and reproducibility
- Pre-built archetypes may feel limiting to advanced users -- offer "blank slate" option for users who want to write strategy.md from scratch
- Soul evolution quality depends on LLM reflection quality -- poor reflections will undermine the entire product promise
- Archetype templates must be genuinely useful strategies, not just marketing -- a bad first backtest undermines the onboarding
- The "formative experience" period selection must be curated carefully; a boring period kills the hook

## Origin

Developed through Free Thinker / Grounder dialogue. Free Thinker proposed the inversion ("soul as the product, backtest as the gym"). Grounder refined the positioning to "soul powered by backtest" and corrected archetype naming from character classes to trading philosophy language. Competitive research from Explorer confirmed zero market analogs for soul evolution as a product feature.

## Recommendation

Adopt as primary product positioning. This should reshape the PRD's framing, onboarding design, and marketing language. The architecture remains the same -- this is a positioning and UX reframe, not a technical change.
