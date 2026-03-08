import pytest

from aegis_runtime.strategy.loader import StrategyLoader, StrategyLoadError
from aegis_runtime.strategy.parser import StrategyMarkdownParser, StrategyValidationError
from aegis_runtime.strategy.validator import StrategyValidationError as ValidatorError
from aegis_runtime.strategy.validator import StrategyValidator

VALID_STRATEGY_MD = """# Test Strategy

## Objective
Test objective

## Universe
AAPL

## Entry Criteria
Buy when price goes up

## Exit Criteria
Sell when price goes down

## Risk Rules
Max 50% position

## Sizing Doctrine
Equal weight
"""

VALID_STRATEGY_PY = '''
import polars as pl


def prepare_features(df):
    return df


def generate_signal(state, portfolio):
    return None


def size_position(portfolio, signal):
    return {"quantity": 0}


def risk_gate(order, portfolio, market):
    return {"approved": True, "reason": ""}
'''


class TestStrategyParser:
    def test_parse_complete_strategy(self):
        parsed = StrategyMarkdownParser.parse(VALID_STRATEGY_MD)
        assert parsed.objective == "Test objective"
        assert parsed.universe == "AAPL"
        assert parsed.entry_criteria != ""
        assert parsed.exit_criteria != ""
        assert parsed.risk_rules != ""
        assert parsed.sizing_doctrine != ""

    def test_parse_missing_section_raises(self):
        incomplete = """# Test

## Objective
Something
"""
        with pytest.raises(StrategyValidationError):
            StrategyMarkdownParser.parse(incomplete)


class TestStrategyLoader:
    def test_load_valid_strategy(self):
        adapter = StrategyLoader.load_from_python(VALID_STRATEGY_PY)
        assert adapter is not None
        result = adapter.generate_signal(None, None)
        assert result is None

    def test_load_missing_generate_signal(self):
        code = "def some_other_func(): pass"
        with pytest.raises(StrategyLoadError):
            StrategyLoader.load_from_python(code)


class TestStrategyValidator:
    def test_blocks_forbidden_import(self):
        code = "import os\ndef generate_signal(s, p): pass"
        with pytest.raises(ValidatorError, match="Forbidden import"):
            StrategyValidator.validate(code)

    def test_blocks_requests(self):
        code = "import requests\ndef generate_signal(s, p): pass"
        with pytest.raises(ValidatorError, match="Forbidden import"):
            StrategyValidator.validate(code)

    def test_blocks_datetime_now(self):
        code = "from datetime import datetime\nx = datetime.now()\ndef generate_signal(s, p): pass"
        with pytest.raises(ValidatorError, match="Forbidden call"):
            StrategyValidator.validate(code)

    def test_allows_polars(self):
        code = "import polars as pl\ndef generate_signal(s, p): pass"
        StrategyValidator.validate(code)  # should not raise
