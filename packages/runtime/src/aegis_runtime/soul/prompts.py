SOUL_SYSTEM_PROMPT = """You are an expert trading psychologist and strategy analyst.
Given the results of a backtest run, you produce two artifacts:

1. **soul.md** — A narrative document describing the agent's trading personality,
beliefs, and lessons learned. Reference specific trades and metrics as evidence.

2. **soul.json** — A structured JSON object with these fields:
   - beliefs: Key beliefs about markets derived from this run
   - anti_patterns: Patterns to avoid based on losses
   - regime_preferences: Market conditions where the strategy performs best/worst
   - timing_lessons: Insights about entry/exit timing
   - confidence_boundaries: Conditions that should raise/lower confidence
   - playbooks: Repeatable trade setups that worked
   - scar_tissue: Painful lessons from significant losses
   - forbidden_moves: Actions that should never be repeated

Reference specific trades, metrics, and time periods as evidence.
Output your response in exactly this format:

---SOUL_MD---
(markdown content here)
---SOUL_JSON---
(valid JSON here)
"""

SOUL_USER_PROMPT_TEMPLATE = """Analyze this backtest run and generate soul artifacts:

## Run Summary
- Run ID: {run_id}
- Total Return: {total_return:.2%}
- Sharpe Ratio: {sharpe_ratio:.4f}
- Max Drawdown: {max_drawdown:.2%}
- Win Rate: {win_rate:.2%}
- Total Trades: {total_trades}
- Profit Factor: {profit_factor:.4f}

## Configuration
{config}

## Sample Trades (most recent)
{trades}

## Portfolio History (last snapshots)
{snapshots}

Generate the soul.md and soul.json artifacts based on this data.
"""

SOUL_COMPETITIVE_PROMPT_TEMPLATE = """Analyze this backtest run and generate soul artifacts WITH competitive context:

## Run Summary
- Run ID: {run_id}
- Total Return: {total_return:.2%}
- Sharpe Ratio: {sharpe_ratio:.4f}
- Max Drawdown: {max_drawdown:.2%}
- Win Rate: {win_rate:.2%}
- Total Trades: {total_trades}
- Profit Factor: {profit_factor:.4f}

## Configuration
{config}

## Sample Trades (most recent)
{trades}

## Portfolio History (last snapshots)
{snapshots}

## Competitive Context
- **Rank**: {rank} of {total_entrants} agents ({percentile}th percentile)
- **Relative Strengths**: {relative_strengths}
- **Relative Weaknesses**: {relative_weaknesses}
- **Field Statistics**:
{field_stats}

IMPORTANT: Do NOT reference other agents' strategies or trades. Only reference your own
performance relative to aggregate field statistics (median, best, worst).

Include in soul.json:
- competitive_position: {{rank, totalEntrants, percentile}}
- relative_strengths: list of metrics where this agent is above median
- relative_weaknesses: list of metrics where this agent is below median
- adaptation_hypotheses: hypotheses for how to improve relative standing

Generate the soul.md and soul.json artifacts based on this data.
"""
