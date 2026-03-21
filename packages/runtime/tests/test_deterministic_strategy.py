from pathlib import Path

import polars as pl
import pytest

from aegis_runtime.simulator.market_state import MarketState
from aegis_runtime.simulator.portfolio import PortfolioState
from aegis_runtime.strategy.diagnostics import StrategyCompileError
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

LEGACY_MOMENTUM_PINE = """//@version=4
strategy(
    "Legacy Momentum",
    overlay=true,
    default_qty_type=strategy.percent_of_equity,
    default_qty_value=100
)

src = input(title="Source", type=input.source, defval=close)
fast = input(2, title="Fast")
slow = input(3, title="Slow")
ma_fast = ema(src, fast)
ma_slow = sma(src, slow)
bull = crossover(ma_fast, ma_slow)
bear = crossunder(ma_fast, ma_slow)
long_ok = ma_fast[1] <= ma_slow[1] and bull
short_ok = ma_fast[1] >= ma_slow[1] and bear

strategy.entry("Long", true, when=long_ok)
strategy.entry("Short", false, when=short_ok)
"""

DMI_STYLE_PINE = """//@version=5
strategy(
    "DMI Momentum",
    overlay=true,
    default_qty_type=strategy.percent_of_equity,
    default_qty_value=100
)

src = input(close, "Source")
len = input.int(3, title="DI Length")
lensig = input.int(3, title="ADX Smoothing")
[diplus, diminus, adx] = ta.dmi(len, lensig)
trend_ok = diplus > diminus and adx > 10
strategy.entry("Long", strategy.long, when=trend_ok)
"""

FILL_PASSTHROUGH_PINE = """//@version=4
strategy("Fill Visual", overlay=true)
src = input(title="Source", type=input.source, defval=close)
length = input(20, title="Length")
basis = sma(src, length)
dev = stdev(src, length)
upper = basis + dev
lower = basis - dev
pb1 = plot(upper, title="Upper")
pb2 = plot(lower, title="Lower")
fill(pb1, pb2, color=color.new(color.blue, 90), title="Background")
strategy.entry("Long", true, when=close < lower)
"""

AROON_STYLE_PINE = """//@version=5
strategy("Aroon Bars", overlay=true)
length_ar = input.int(5, minval=1)
aroon_up = 100 * (ta.highestbars(high, length_ar + 1) + length_ar) / length_ar
aroon_down = 100 * (ta.lowestbars(low, length_ar + 1) + length_ar) / length_ar
buy = aroon_up > 50 and aroon_down < 50
strategy.entry("Long", strategy.long, when=buy)
"""

EMBEDDED_INPUT_PINE = """//@version=4
strategy("Embedded Input", overlay=true)
threshold = input(title="Threshold", type=input.float, defval=5) * 0.01
buy = close < open * (1 - threshold)
strategy.entry("Long", true, when=buy)
"""

NAMED_TITLE_PINE = """//@version=4
strategy(overlay=true, title="Named Title", shorttitle="Named")
buy = close > open
strategy.entry("Long", true, when=buy)
"""

EXIT_STOP_LIMIT_PINE = """//@version=5
strategy("Exit Args", overlay=true)
buy = close > open
stop_price = close - 1
limit_price = close + 2
strategy.entry("Long", strategy.long, when=buy, alert_message="go")
strategy.exit("Exit", "Long", stop=stop_price, limit=limit_price, comment="managed", alert_message="done")
"""

REQUEST_SECURITY_PINE = """//@version=5
strategy("Request Security", overlay=true)
htf_close = request.security(syminfo.tickerid, "60", close)
buy = close > htf_close
strategy.entry("Long", strategy.long, when=buy)
"""

CONDITIONAL_REASSIGN_PINE = """//@version=5
strategy("Conditional Reassign", overlay=true)
var last_trade_was_loss = false
if close < open
    last_trade_was_loss := true
if close > open
    last_trade_was_loss := false
strategy.entry("Long", strategy.long, when=last_trade_was_loss)
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
    assert "generated_by: aegis_ir_v1" in generated_python


def test_generated_python_produces_buy_then_sell_flow():
    strategy_ir = parse_pine_source(TINY_PINE)
    generated_python, _ = render_python_from_ir(strategy_ir)
    adapter = StrategyLoader.load_from_python(generated_python)

    df = pl.DataFrame(
        {
            "timestamp": [f"2024-01-0{i + 1}" for i in range(8)],
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


def test_compile_legacy_momentum_patterns_with_generic_input_and_series_indexing():
    strategy_ir = parse_pine_source(LEGACY_MOMENTUM_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert strategy_ir.inputs[0].type == "source"
    assert strategy_ir.orders[0].side == "long"
    assert strategy_ir.orders[1].side == "short"
    assert 'input.source(close, "Source")' in normalized_pine
    assert "ma_fast[1]" in normalized_pine

    StrategyValidator.validate(generated_python)
    assert StrategyLoader.load_from_python(generated_python) is not None


def test_compile_dmi_tuple_destructuring_into_generated_python():
    strategy_ir = parse_pine_source(DMI_STYLE_PINE)
    generated_python, _ = render_python_from_ir(strategy_ir)
    adapter = StrategyLoader.load_from_python(generated_python)

    assert [item.name for item in strategy_ir.inputs] == ["src", "len", "lensig"]
    assert {"diplus", "diminus", "adx"}.issubset({calc.name for calc in strategy_ir.indicators})

    df = pl.DataFrame(
        {
            "timestamp": [f"2024-02-0{i + 1}" for i in range(8)],
            "open": [10.0, 10.5, 11.0, 11.5, 11.2, 11.8, 12.2, 12.5],
            "high": [10.2, 10.8, 11.3, 11.8, 11.5, 12.0, 12.5, 12.8],
            "low": [9.8, 10.2, 10.7, 11.1, 10.9, 11.5, 11.9, 12.2],
            "close": [10.1, 10.7, 11.2, 11.7, 11.4, 11.9, 12.4, 12.7],
            "volume": [100] * 8,
        }
    )
    prepared = adapter.prepare_features(df)
    portfolio = PortfolioState(
        cash=100000,
        high_water_mark=100000,
        initial_capital=100000,
    )
    state = MarketState.from_dataframe(prepared, len(prepared) - 1, "AAPL")
    signal = adapter.generate_signal(state, portfolio)

    assert signal is None or signal["action"] in {"buy", "sell"}


def test_compile_fill_visual_passthrough_scripts():
    strategy_ir = parse_pine_source(FILL_PASSTHROUGH_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert any("fill(" in statement for statement in strategy_ir.passthroughPine)
    assert "fill(pb1, pb2" in normalized_pine
    StrategyValidator.validate(generated_python)
    assert StrategyLoader.load_from_python(generated_python) is not None


def test_compile_highestbars_and_lowestbars_expressions():
    strategy_ir = parse_pine_source(AROON_STYLE_PINE)
    generated_python, _ = render_python_from_ir(strategy_ir)
    adapter = StrategyLoader.load_from_python(generated_python)

    assert {"aroon_up", "aroon_down"}.issubset({calc.name for calc in strategy_ir.indicators})

    df = pl.DataFrame(
        {
            "timestamp": [f"2024-03-0{i + 1}" for i in range(8)],
            "open": [10.0, 10.2, 10.4, 10.1, 10.8, 11.0, 10.9, 11.2],
            "high": [10.1, 10.4, 10.7, 10.5, 11.0, 11.3, 11.1, 11.5],
            "low": [9.9, 10.0, 10.2, 9.8, 10.5, 10.8, 10.7, 11.0],
            "close": [10.0, 10.3, 10.6, 10.3, 10.9, 11.2, 11.0, 11.4],
            "volume": [100] * 8,
        }
    )
    prepared = adapter.prepare_features(df)
    portfolio = PortfolioState(
        cash=100000,
        high_water_mark=100000,
        initial_capital=100000,
    )
    state = MarketState.from_dataframe(prepared, len(prepared) - 1, "AAPL")
    signal = adapter.generate_signal(state, portfolio)

    assert signal is None or signal["action"] in {"buy", "sell"}


def test_compile_embedded_input_expression_by_hoisting_input():
    strategy_ir = parse_pine_source(EMBEDDED_INPUT_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert any(item.name.startswith("threshold__input") for item in strategy_ir.inputs)
    assert any(calc.name == "threshold" for calc in strategy_ir.indicators)
    assert "threshold__input" in normalized_pine
    StrategyValidator.validate(generated_python)
    assert StrategyLoader.load_from_python(generated_python) is not None


def test_compile_named_title_and_preserve_named_strategy_args():
    strategy_ir = parse_pine_source(NAMED_TITLE_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)

    assert strategy_ir.meta.name == "Named Title"
    assert 'strategy("Named Title"' in normalized_pine


def test_compile_exit_stop_limit_and_ignore_metadata_only_args():
    strategy_ir = parse_pine_source(EXIT_STOP_LIMIT_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    exit_order = next(order for order in strategy_ir.orders if order.kind == "exit")
    assert exit_order.fromEntryId == "Long"
    assert exit_order.stop is not None
    assert exit_order.limit is not None
    assert 'strategy.exit("Exit", "Long", stop=stop_price, limit=limit_price)' in normalized_pine
    StrategyValidator.validate(generated_python)


def test_compile_request_security_expression():
    strategy_ir = parse_pine_source(REQUEST_SECURITY_PINE)
    normalized_pine = render_strategy_ir_to_pine(strategy_ir)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert any(calc.name == "htf_close" for calc in strategy_ir.indicators)
    assert 'request.security(syminfo.tickerid, "60", close)' in normalized_pine
    StrategyValidator.validate(generated_python)


def test_compile_top_level_conditional_reassigns():
    strategy_ir = parse_pine_source(CONDITIONAL_REASSIGN_PINE)
    generated_python, _ = render_python_from_ir(strategy_ir)

    assert any(calc.kind == "reassign" for calc in strategy_ir.indicators)
    StrategyValidator.validate(generated_python)


def test_parse_error_includes_structured_diagnostic_span():
    invalid_source = """//@version=5
strategy("Bad Parse", overlay=true)
entryLong =
"""

    with pytest.raises(StrategyCompileError) as exc_info:
        parse_pine_source(invalid_source)

    diagnostic = exc_info.value.diagnostics[0]
    assert diagnostic.code == "parse_error"
    assert diagnostic.span is not None
    assert diagnostic.span.line in {3, 4}
