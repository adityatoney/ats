from pathlib import Path

import polars as pl

from aegis_runtime.simulator.market_state import MarketState
from aegis_runtime.simulator.portfolio import PortfolioState
from aegis_runtime.strategy.loader import StrategyLoader
from aegis_runtime.strategy.markdown_compiler import compile_markdown_source
from aegis_runtime.strategy.pine_compiler import (
    parse_pine_source,
    render_strategy_ir_to_pine,
)
from aegis_runtime.strategy.python_renderer import render_python_from_ir
from aegis_runtime.strategy.reverse_renderer import (
    extract_ir_from_generated_python,
    render_pine_from_generated_python,
)
from aegis_runtime.strategy.validator import StrategyValidator

REPO_ROOT = Path(__file__).resolve().parents[3]
MA_FIXTURE = REPO_ROOT / "packages/data/strategy/MACrossoverStrategy.pine"
MA_250_FIXTURE = REPO_ROOT / "packages/data/strategy/50/250CrossoverStrategy.pine"

STRICT_MARKDOWN = """## Inputs
```yaml
meta:
  name: Markdown Test Strategy
  scriptVersion: 5
  direction: long
  overlay: true
  initialCapital: 100000
  defaultQtyType: percent_of_equity
  defaultQtyValue: 50
parameters:
  - name: fast_length
    type: int
    default: 2
    title: Fast
  - name: slow_length
    type: int
    default: 3
    title: Slow
```

## Indicators
```yaml
calculations:
  - name: sma_fast
    expression: ta.sma(close, fast_length)
  - name: sma_slow
    expression: ta.sma(close, slow_length)
  - name: bull_cross
    expression: ta.crossover(sma_fast, sma_slow)
  - name: bear_cross
    expression: ta.crossunder(sma_fast, sma_slow)
```

## Entry Rules
```yaml
- id: Long
  kind: entry
  side: long
  when: bull_cross
```

## Exit Rules
```yaml
- id: Long
  kind: close
  when: bear_cross
```

## Risk Rules
```yaml
gates: []
```

## Sizing
```yaml
mode: strategy_default
```
"""

TINY_PINE = """//@version=5
strategy(
    "Tiny Cross",
    overlay=true,
    initial_capital=100000,
    default_qty_type=strategy.fixed,
    default_qty_value=10
)

sma_fast = ta.sma(close, 2)
sma_slow = ta.sma(close, 3)
bull_cross = ta.crossover(sma_fast, sma_slow)
bear_cross = ta.crossunder(sma_fast, sma_slow)

if bull_cross
    strategy.entry("Long", strategy.long)

if bear_cross
    strategy.close("Long")
"""


def test_compile_ma_fixture_round_trips_through_ir_and_generated_python():
    source = MA_FIXTURE.read_text()
    strategy_ir = parse_pine_source(source)

    assert strategy_ir.meta.name == "MA Crossover - AegisTrader"
    assert any(order.kind == "entry" for order in strategy_ir.orders)
    assert any(calc.name == "high_water_mark" for calc in strategy_ir.indicators)

    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    StrategyValidator.validate(generated_python)
    adapter = StrategyLoader.load_from_python(generated_python)
    assert adapter is not None

    extracted_ir = extract_ir_from_generated_python(generated_python)
    assert extracted_ir.meta.name == strategy_ir.meta.name
    assert render_pine_from_generated_python(generated_python) == normalized_pine


def test_compile_second_fixture_preserves_passthrough_visual_statements():
    source = MA_250_FIXTURE.read_text()
    strategy_ir = parse_pine_source(source)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)

    assert any("alertcondition(" in statement for statement in strategy_ir.passthroughPine)
    assert any("table.new(" in statement for statement in strategy_ir.passthroughPine)
    assert "alertcondition(buy_signal" in normalized_pine
    assert "table.new(position.top_right" in normalized_pine


def test_compile_strict_markdown_yaml_to_ir_and_python():
    strategy_ir = compile_markdown_source(STRICT_MARKDOWN)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert strategy_ir.meta.name == "Markdown Test Strategy"
    assert strategy_ir.meta.defaultQtyType == "percent_of_equity"
    assert [order.kind for order in strategy_ir.orders] == ["entry", "close"]
    StrategyValidator.validate(generated_python)
    assert 'generated_by: aegis_ir_v1' in generated_python


def test_generated_python_produces_buy_then_sell_flow():
    strategy_ir = parse_pine_source(TINY_PINE)
    generated_python, _ = render_python_from_ir(strategy_ir)
    adapter = StrategyLoader.load_from_python(generated_python)

    df = pl.DataFrame(
        {
            "timestamp": [f"2024-01-0{i+1}" for i in range(8)],
            "open": [10, 9, 8, 9, 10, 11, 10, 9],
            "high": [10, 9, 8, 9, 10, 11, 10, 9],
            "low": [10, 9, 8, 9, 10, 11, 10, 9],
            "close": [10, 9, 8, 9, 10, 11, 10, 9],
            "volume": [100] * 8,
        }
    )

    prepared = adapter.prepare_features(df)
    portfolio = PortfolioState(
        cash=100000,
        high_water_mark=100000,
        initial_capital=100000,
    )
    actions: list[str] = []

    for bar_index in range(len(prepared)):
        state = MarketState.from_dataframe(prepared, bar_index, "AAPL")
        signal = adapter.generate_signal(state, portfolio)
        if not signal:
            continue

        size = adapter.size_position(
            portfolio,
            {
                "action": signal["action"],
                "symbol": signal["symbol"],
                "confidence": signal["confidence"],
                "price": state.current_bar["close"],
            },
        )
        if size["quantity"] <= 0:
            continue

        portfolio.apply_fill(
            symbol="AAPL",
            side=size["side"],
            quantity=size["quantity"],
            price=float(state.current_bar["close"]),
            fee=0,
        )
        actions.append(size["side"])

    assert actions[:2] == ["buy", "sell"]
