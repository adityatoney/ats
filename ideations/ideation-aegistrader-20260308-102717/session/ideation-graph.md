# Ideation Graph — Project AegisTrader

## Session Metadata
- **Concept**: Multi-Agent Financial Paper Trading Research Platform
- **Session ID**: ideation-aegistrader-20260308-102717
- **Date**: 2026-03-08
- **Depth**: Standard
- **Focus**: Explore new dimensions (UX paradigms, product positioning, differentiation, novel agent interaction patterns) while refining existing architectural and PRD decisions

## Seed Concepts

The session begins from two source documents:

1. **Concept_1.md** — A detailed architectural blueprint covering:
   - Two-layer architecture: deterministic trading engine + non-deterministic agent layer
   - OpenClaw-inspired control plane pattern
   - Stack: React/Vite + Node control plane + Python runtime + Temporal + Postgres + Convex + Parquet + LiteLLM
   - Trading soul as structured evolving doctrine (soul.md + soul.json)
   - Branch DAG for git-tree style history
   - Strategy as markdown + optional Python hooks
   - Deterministic vs non-deterministic contract
   - Phased rollout: single-agent backtester -> multi-agent tournament -> paper live -> governance

2. **PRD.md** — Full product requirements document covering:
   - 10 product principles anchored in determinism and auditability
   - Agent authoring, backtesting, branching, tool calling, approval-gated writes
   - Live paper trading modes (always-on, scheduled, interval, mixed)
   - Competition rules with leaderboard-only visibility
   - UI requirements: branch tree, trade ledger, soul viewer, approval inbox
   - File classification: safe_to_edit / approval_required / never_editable_by_agent
   - Data model with 17+ core entities
   - 5 major workflows (create agent, backtest, branch, approval, live paper)
   - MVP scope and rollout phases

## Thread Registry

| Thread ID | Label | Status | Origin | Forked From | Flagged |
|-----------|-------|--------|--------|-------------|---------|
| T1 | Soul as the Product | **ARBITER CONFIRMED** | Free Thinker R1 | seed | INTERESTING |
| T2 | Adversarial Soul Dynamics | **parked** | Free Thinker R1 | seed | -- |
| T3 | Soul Diff as First-Class UX | **active (refined)** | Free Thinker R1 | seed | -- |
| T4 | Counterfactual Soul Forking | **ARBITER CONFIRMED** | Free Thinker R1 | seed | INTERESTING |
| T5 | Soul-to-Deterministic Graduation | **cautioned** | Free Thinker R1 | seed | -- |
| T6 | Coaching UX (User-Soul Relationship) | **active (pending eval)** | Grounder R2 | T1, T3 | expected |

## Active Threads

### T1: Soul as the Product (not the backtest)
**Proposed by**: Free Thinker (Round 1)
**Core idea**: Invert the product framing. The backtest is the gym; the soul is the athlete. Users "grow and curate trading personalities." The branch DAG becomes the soul's biography. Reframes UX from analytics dashboard to "creature evolution simulator for finance."
**Grounder response (Round 1)**: Agrees this is the strongest direction but grounds it — "soul powered by backtest, not soul instead of backtest." The deterministic engine is the credibility; the soul is the experience. Key positioning insight from Grounder: saying "backtesting platform with AI agents" makes users hear "QuantConnect-with-ChatGPT," but "you grow trading personalities that learn from experience" is a completely different product.
**Round 2 development — Detailed onboarding flow (Free Thinker)**:
- **Min 0-2: Archetype picker.** User picks a trading personality (not a blank strategy.md). Each archetype = pre-built strategy.md + seed soul.md. Free Thinker proposed: Patient Contrarian, Momentum Surfer, Cautious Earner, Regime Reader.
- **Min 2-5: Formative experience.** System auto-selects a dramatic historical period (2020 crash, 2021 melt-up, 2022 bear) and runs a compressed 3-6 month backtest. UI emphasizes soul formation over PnL: "Your agent just experienced its first 30% drawdown. It's forming its first scar tissue."
- **Min 5-10: Soul diff + fork prompt.** Before/after screen: seed archetype vs shaped personality. Specific trades linked to specific beliefs. Then: "Want to keep training? Or fork this soul and see what happens if it had a different experience?" — bridging directly to T4.
- **Key insight (Free Thinker)**: "The current onboarding creates a backtesting user. This onboarding creates a soul curator."
**Grounder correction (Round 2)**: Archetype names should be trading philosophies, not character classes. Grounder's specific alternatives: "Mean Reversion — Waits for overreactions," "Trend Follower — Rides momentum until it breaks," "Event-Driven — Trades around catalysts." Quote: "The user should feel like they're choosing a trading philosophy, not a Pokemon."
**Key framing locked**: "Soul powered by backtest" — engine is credibility, soul is experience.
**Status**: Converging and deepening. Onboarding flow validated. Core framing solidified.

### T3: Soul Diff as First-Class UX Moment
**Proposed by**: Free Thinker (Round 1)
**Core idea**: Elevate the soul diff from metadata to the most important screen in the product.
**Grounder response (Round 1)**: Keep evidence-grounded. Grounder's specific UI direction: "show the soul diff as a before/after with evidence links. 'Before run #47, this agent believed X. After run #47, it believes Y. Here's the trade that changed its mind.'"
**Status**: Active, refined. Now integrated into the onboarding flow (T1) as the payoff moment after first backtest.

### T4: Counterfactual Soul Forking
**Proposed by**: Free Thinker (Round 1)
**Core idea**: Fork the soul itself, not just trade history. Run two versions with different life experiences, observe doctrinal divergence.
**Round 2 development — Three counterfactual experiments proposed (Free Thinker)**:
1. **Trauma Test** (MVP feature): Same agent, different eras. "What if your trend-follower was forged in the 2008 crash vs the 2020-2021 bull run?" The bull-baby becomes aggressive, over-leveraged, naive about drawdowns. The bear-forged agent becomes cautious, defensive, misses rallies. Neither is "right" — the divergence teaches the user how experience shapes doctrine. Most intuitive because it maps to how humans think about trading psychology.
2. **Selective Amnesia** (compelling v2): "What if we erased the agent's worst month?" Tests whether specific experiences are load-bearing in the soul's structure. Does removing the worst month make the agent reckless, or does it remove over-indexed damage? "Which scars are useful and which are just damage?" Needs the soul to be mature enough first. **Grounder implementation note**: Can't just delete lines from soul.md — beliefs are interconnected. Would need to re-derive the soul from the branch history minus the excluded period. Architecturally non-trivial but scoped for v2.
3. **Cross-Training** (parked): "What if my equity agent lived through the crypto winter of 2022?" Expose an agent to a different asset class's history to see if trading wisdom transfers across domains. Most creative but most ambitious. Free Thinker self-assessed as too ambitious for early versions.
**Grounder Round 2**: Trauma Test confirmed as MVP counterfactual feature. Flagged need for **side-by-side soul comparison UX** — not two separate soul pages but a unified comparison: "Bull-market you believes X. Crash-market you believes Y. Here's where they diverge." Grounder: "That screen could be one of the most compelling things in the whole product."
**Status**: Converging. Trauma Test is the concrete MVP expression. Selective Amnesia is the compelling v2 hook.

### T6: Coaching UX (User-Soul Relationship) — NEW
**Proposed by**: Grounder (Round 2), emerging from T1/T3 discussion
**Core idea**: The Grounder asked: "When does the user say 'no, you learned the wrong lesson'?" The PRD frames the user-agent relationship as approver (approve/reject file changes). But if the soul is the product, the user's relationship to the agent is more like a **coach** than a bureaucratic approver. The user guides the agent's development, corrects mistaken beliefs, reinforces good lessons.
**Status**: New thread, about to be explored by Free Thinker.
**Note**: This reframes Workflow D (Approval-Gated File Change) from a permission system into a coaching interaction. Significant UX and product implications.
**Connections**: Forked from T1 (soul as product) and T3 (soul diff UX). If the soul diff shows "here's what changed," the coaching UX answers "and here's where the user can intervene."

## Parked Threads

### T2: Adversarial Soul Dynamics
**Proposed by**: Free Thinker (Round 1)
**Core idea**: Agents develop theories about each other based solely on observable PnL patterns.
**Grounder verdict**: Parked — too early. Phase 3/4 idea.
**Status**: Parked. May resurface in later phases.

### T4c: Cross-Training Counterfactual
**Proposed by**: Free Thinker (Round 2, as part of T4 counterfactual proposals)
**Core idea**: Run one strategy's soul through a different strategy's backtest environment.
**Verdict**: Parked — value unclear for real users.

## Cautioned Threads

### T5: Soul-to-Deterministic Graduation
**Proposed by**: Free Thinker (Round 1)
**Core idea**: Allow soul-derived beliefs to "compile down" into deterministic rules with user approval.
**Grounder verdict**: Cautioned — risks eroding the deterministic boundary. However, Grounder acknowledged a narrow version: "the soul proposes a hard rule, the user approves it, and it becomes a deterministic constraint. But that's just the existing approval-gated write system with better framing."
**Status**: Cautioned. The narrow version is essentially already in the PRD. The broader vision remains resisted.
**Note**: T6 (coaching UX) may absorb the useful parts of T5. If the user is a coach who can accept/reject/modify soul lessons, and those lessons can become strategy constraints via the existing approval system, then T5's aspiration is achieved without blurring the architectural boundary.

## Abandoned Threads

*None formally abandoned. T2 and T4c are parked. T5 is cautioned.*

## Connections & Cross-Links

- **T1 <-> T3**: Soul-as-product framing (T1) implies the soul diff (T3) is the core engagement loop. T3 is now embedded in the T1 onboarding flow.
- **T1 <-> T4**: If the soul is the product, then forking the soul (T4) is the power-user mechanic. The onboarding flow ends with a fork prompt, connecting these directly.
- **T1 + T3 + T4 core cluster**: These three threads are mutually reinforcing. The cluster is solidifying: soul-centric product (T1) with narrative-evidence diffs (T3) and counterfactual forking (T4).
- **T6 forked from T1 + T3**: The coaching UX emerges naturally from asking "what does the user DO after seeing the soul diff?" It extends the cluster from observation to intervention.
- **T6 may absorb T5**: The coaching relationship could be the safe, bounded version of belief graduation — the user (not the system) decides which lessons become hard rules, using the existing approval mechanism.
- **T1 + T3 + T4 + T6 forming an expanded cluster**: The vision is becoming: soul-centric product, narrative diffs, counterfactual forking, and coaching relationship.

## Key Tensions Identified

1. **Soul as reflective summary vs. soul as active product** (T1, T3): RESOLVED. "Soul powered by backtest" is the settled formulation. Both agents aligned.

2. **Strict deterministic/non-deterministic boundary vs. graduated beliefs** (T5): HOLDING but potentially resolving through T6. If coaching UX subsumes the useful parts of T5, the boundary stays clean.

3. **Simplicity of agent interaction vs. emergent game theory** (T2): DEFERRED. Parked to phase 3/4.

4. **Narrative soul diff vs. evidence-grounded soul diff** (T3): PRODUCTIVE TENSION. Grounder's constraint accepted. The direction is "narrative backed by evidence."

5. **Trading-domain language vs. game/fiction language** (T1, Round 2): NEW. Grounder corrected archetype naming from character classes to trading philosophies. This tension may recur as the "creature evolution" framing pushes toward game metaphors while the Grounder pulls toward finance credibility.

6. **Approver vs. coach relationship** (T6): EMERGING. The PRD frames user-agent interaction as permission-granting. T6 reframes it as coaching. This has deep implications for the approval workflow UX.

## Research Inputs

### Competitive Landscape (Grounder research, pre-dialogue)
- **No existing product combines** deterministic backtesting + AI agent exploration + branch DAG + evolving souls.
- **Closest competitors**: QuantConnect, Composer, Numerai — none have soul or branch DAG concepts.
- **Branch DAG and trading soul have zero analogs** in the market.
- **Biggest competitive risk**: QuantConnect adding AI features.
- Full report: `session/research/COMPETITIVE_LANDSCAPE.md`

### Deep Competitive Landscape (Explorer research)
Additional findings extending the initial report:
- **QuantConnect Mia V2** is closest in spirit — agentic AI that ideates, writes code, runs backtests via MCP. But it's a coding assistant, not a self-evolving agent with memory/soul. Different interaction model.
- **NautilusTrader** validates the deterministic engine pattern: Rust-native core, event-driven, deterministic, Python control plane, nanosecond resolution. AegisTrader's Layer 1 should learn from this. NautilusTrader deliberately excludes AI/UI/orchestration — AegisTrader adds exactly that.
- **Deterministic boundary comparison**: NautilusTrader excludes AI entirely. QuantConnect separates Mia from LEAN. AlgoTrader blurs (ML in strategies). AegisTrader's "proposals only" contract is the most rigorous.
- **Agent memory evolution** is active 2025-2026 research (arXiv Dec 2025 taxonomy, Google Titans+MIRAS, SEAL, "Digital DNA"). No trading product has productized it.
- **LangGraph time-travel** checkpoint/fork mechanics are directly applicable and unoccupied in trading.
- **Market**: Algo trading $24B (2025) -> $44.5B (2030), 13.2% CAGR.
- **Alpaca confirmed** as right MVP choice (best algo broker 2026, MCP server for AI agents).
- Full report: `session/research/RESEARCH_competitive-landscape.md`

## Convergence Signals

1. **Early signal (pre-dialogue)**: Grounder's competitive research independently validates soul and branch DAG as primary differentiators.

2. **Round 1 convergence on T1**: Both agents agree the soul should be the primary product lens. "Soul powered by backtest" accepted as core formulation.

3. **Round 1 convergence on T4**: Both agents excited about counterfactual soul forking. "Alternate timelines" framing accepted.

4. **Round 2 convergence on onboarding**: Archetype picker -> formative experience -> soul diff -> fork prompt flow validated by both agents. Grounder's naming correction accepted.

5. **Round 2 convergence on Trauma Test**: Confirmed as MVP counterfactual feature. Side-by-side soul comparison UX flagged as needed.

6. **Round 2 convergence on Selective Amnesia**: Both see it as compelling v2 feature. "Which scars are useful vs just damage" is a strong hook.

7. **ARBITER CONFIRMATION — T1 (Soul as Product + Onboarding)**: Flagged as INTERESTING. Idea report written: `IDEA_soul-as-product.md`.

8. **ARBITER CONFIRMATION — T4 (Counterfactual Soul Forking + Trauma Test)**: Flagged as INTERESTING. Idea report written: `IDEA_counterfactual-forking.md`.

9. **Unified product narrative emerging**: The Arbiter identifies T1 + T4 + T6 as forming a coherent loop: "choose a personality -> grow it through experimentation -> coach it to improve." T6 (coaching) evaluation pending but expected to be confirmed.

## Arbiter Status

- **Approaching convergence.** Two of three expected ideas confirmed as INTERESTING. Third (T6 / Coaching UX) pending evaluation.
- **Next phase**: Once T6 is evaluated, the team lead will signal move to final briefs and vision document.

## Open Questions for Next Round

- **Coaching UX (T6)**: What does the coaching interaction look like? When/how does the user intervene in soul development? What's the difference between coaching and approving?
- **Side-by-side soul comparison**: What UX surfaces the results of a counterfactual fork? (Flagged by Grounder for T4)
- **Domain language boundary**: How far can the "creature evolution" framing go before it undermines credibility with serious trading users?
