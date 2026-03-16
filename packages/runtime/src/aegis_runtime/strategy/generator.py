import logging
import re

from aegis_runtime.strategy.validator import StrategyValidator, StrategyValidationError

logger = logging.getLogger(__name__)

STRATEGY_SYSTEM_PROMPT = """\
You are an expert quantitative trading strategy developer. Your job is to convert \
a natural-language trading strategy description (in markdown) into TWO implementations:

1. A Python module for the AegisTrader backtesting engine
2. A Pine Script v6 indicator for TradingView validation

---

## PART 1: Python Implementation

You must produce a Python module with these functions:

### 1. `prepare_features(df: pl.DataFrame) -> pl.DataFrame`
Add technical indicators/features to the OHLCV dataframe. The input dataframe has columns:
  - timestamp, open, high, low, close, volume (and possibly others)
Use Polars (import polars as pl). Return the dataframe with new indicator columns added.

### 2. `generate_signal(state, portfolio) -> dict | None`
Evaluate the current bar and decide whether to buy, sell, or do nothing.

Arguments:
  - `state`: MarketState object with:
    - `state.current_bar`: dict of current bar data (all columns including your indicators)
    - `state.bar_index`: int (0-based bar number)
    - `state.symbol`: str (e.g., "AAPL")
    - `state.history`: list[dict] of all bars up to and including current
  - `portfolio`: PortfolioState object with:
    - `portfolio.equity`: float (total portfolio value)
    - `portfolio.cash`: float
    - `portfolio.positions`: dict[str, Position] where each Position has:
      - `.quantity`: float
      - `.avg_entry_price`: float
      - `.current_price`: float
      - `.market_value`: float
      - `.unrealized_pnl`: float

Return a dict with keys: `action` ("buy" or "sell"), `symbol`, `confidence` (0-1), `reason` (str).
Return `None` for no signal.

### 3. `size_position(portfolio, signal) -> dict`
Determine how many shares to buy or sell.

Arguments:
  - `portfolio`: PortfolioState (same as above)
  - `signal`: dict with keys: `action`, `symbol`, `price`, `confidence`

Return a dict with: `side` ("buy" or "sell"), `quantity` (int). Return `{"side": "", "quantity": 0}` for no action.

### 4. `risk_gate(order, portfolio, market) -> dict`
Final risk check before order submission.

Arguments:
  - `order`: dict with keys: `symbol`, `side`, `quantity`
  - `portfolio`: PortfolioState
  - `market`: MarketState

Return: `{"approved": True, "reason": ""}` to allow, or `{"approved": False, "reason": "..."}` to block.

### Python Rules
1. Only import `polars as pl` and standard library modules (math, statistics, collections, etc.).
2. Do NOT import: requests, urllib, socket, os, sys, subprocess, pathlib, http, datetime.now, time.time, time.sleep.
3. Use `pl.col("close").rolling_mean(N)` for moving averages.
4. Handle None/null values from indicators (early bars won't have enough data).
5. Use `int()` for share quantities — no fractional shares.
6. Access position quantities via `portfolio.positions.get(symbol)` — check `.quantity > 0`.

---

## PART 2: Pine Script v6 Indicator

Create a TradingView Pine Script v6 indicator that implements the SAME entry/exit logic as the Python code.

### Pine Script Rules
1. Use `indicator()` (not `strategy()`) so it works on any TradingView plan.
2. Start with `//@version=6` on the first line.
3. Plot the key indicators used in the strategy (moving averages, RSI, bands, etc.).
4. Use `plotshape()` to mark buy signals (green triangle below bar) and sell signals (red triangle above bar).
5. Use `alertcondition()` for buy and sell signals.
6. Add a background highlight (`bgcolor`) on signal bars for visibility.
7. The signal logic MUST match the Python implementation exactly — same indicator parameters, same crossover/threshold conditions.
8. Include brief comments explaining the logic.

### Pine Script CRITICAL constraints (must follow to avoid compile errors)
9. When `overlay=true`, ALL `plot()` calls MUST plot price-scale values only. Do NOT plot volume, ratios, oscillators, or multipliers on an overlay chart. Use `display=display.data_window` if you want non-price data visible only in the data window, but NEVER plot non-price-scale series as visible lines on an overlay chart.
10. Guard against `na` in division: use `nz()` to replace na with 0 before dividing, e.g. `nz(avg_volume, 1)`.
11. Do NOT use `strategy.*` functions — this is an `indicator()`, not a `strategy()`.
12. Test that the script compiles with NO errors. Common pitfalls:
    - Mixing overlay and non-overlay plots (use separate `plot()` with `display=display.none` or `display=display.data_window` for non-price data)
    - Using undefined variables or functions
    - Incorrect function signatures
13. For long-period indicators (e.g., SMA 200+), add `max_bars_back=500` in the `indicator()` call to ensure enough historical data.

---

## Output Format

You MUST separate the two parts with these exact delimiters:

---PYTHON---
(Python code here — no markdown fences)
---PINE---
(Pine Script code here — no markdown fences)
---END---

Do NOT include any text before ---PYTHON--- or after ---END---.
Do NOT wrap code in markdown fences (```).
Include brief comments within each code block."""

STRATEGY_USER_PROMPT_TEMPLATE = """\
Convert the following trading strategy description into both a Python implementation \
(for AegisTrader) and a Pine Script v6 indicator (for TradingView validation).

## Strategy Description

{strategy_md}

---

Generate both implementations. The Pine Script signal logic must match the Python logic exactly \
(same indicators, same parameters, same conditions) so the user can validate on TradingView \
that the strategy behaves as expected."""


class StrategyGenerator:
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def generate(self, strategy_md: str) -> dict:
        """Generate Python strategy code and Pine Script from markdown description.

        Returns dict with keys: strategyPy, pineScript, valid, errors
        """
        import anthropic

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=8192,
            system=STRATEGY_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": STRATEGY_USER_PROMPT_TEMPLATE.format(
                        strategy_md=strategy_md
                    ),
                }
            ],
        )

        raw = message.content[0].text
        strategy_py, pine_script = self._parse_response(raw)

        # Validate the generated Python code
        errors = []
        try:
            StrategyValidator.validate(strategy_py)
        except StrategyValidationError as e:
            errors.append(str(e))

        return {
            "strategyPy": strategy_py,
            "pineScript": pine_script,
            "valid": len(errors) == 0,
            "errors": errors,
        }

    @staticmethod
    def _parse_response(raw: str) -> tuple[str, str]:
        """Parse the delimited response into Python and Pine Script."""
        strategy_py = ""
        pine_script = ""

        if "---PYTHON---" in raw and "---PINE---" in raw:
            # Extract Python section
            py_match = re.search(
                r"---PYTHON---\s*\n(.*?)---PINE---", raw, re.DOTALL
            )
            if py_match:
                strategy_py = py_match.group(1).strip()

            # Extract Pine Script section
            pine_match = re.search(
                r"---PINE---\s*\n(.*?)(?:---END---|$)", raw, re.DOTALL
            )
            if pine_match:
                pine_script = pine_match.group(1).strip()
        else:
            # Fallback: treat entire response as Python (no Pine Script)
            strategy_py = raw.strip()

        # Clean markdown fences if present
        strategy_py = _clean_code(strategy_py)
        pine_script = _clean_code(pine_script)

        return strategy_py, pine_script


def _clean_code(raw: str) -> str:
    """Strip markdown fences if the LLM wrapped the code."""
    code = raw.strip()
    code = re.sub(r"^```(?:python|pine)?\s*\n", "", code)
    code = re.sub(r"\n```\s*$", "", code)
    return code.strip()
