"""Unit tests for tournament coordinator."""
from pathlib import Path

import polars as pl
import pytest

from aegis_runtime.tournament.coordinator import TournamentCoordinator

FIXTURES_DIR = Path(__file__).parent / "fixtures"

DUMMY_STRATEGY_MD = """# Test Strategy

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


def make_sample_data(n_bars=100, start_price=150.0) -> dict[str, pl.DataFrame]:
    """Generate deterministic sample OHLCV data."""
    import random

    rng = random.Random(42)
    rows = []
    price = start_price

    for i in range(n_bars):
        change = rng.gauss(0, 0.02)
        open_price = round(price, 2)
        close_price = round(price * (1 + change), 2)
        high_price = round(max(open_price, close_price) * (1 + abs(rng.gauss(0, 0.005))), 2)
        low_price = round(min(open_price, close_price) * (1 - abs(rng.gauss(0, 0.005))), 2)
        volume = rng.randint(1000000, 5000000)

        rows.append({
            "timestamp": f"2022-01-{(i % 28) + 1:02d}T00:00:00",
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": float(volume),
            "vwap": round((open_price + close_price + high_price + low_price) / 4, 2),
        })
        price = close_price

    return {"AAPL": pl.DataFrame(rows)}


def load_strategy_from_file(filepath: Path) -> str:
    return filepath.read_text()


class TestTournamentCoordinator:
    @pytest.mark.asyncio
    async def test_concurrent_execution(self):
        """Multiple engines run concurrently and all complete."""
        events_collected = []

        async def mock_callback(run_id, event_type, payload):
            events_collected.append((run_id, event_type))

        data = make_sample_data(50)
        buy_hold_code = load_strategy_from_file(FIXTURES_DIR / "buy_hold_strategy.py")

        runs_config = []
        for i in range(3):
            runs_config.append({
                "runId": f"test-run-{i}",
                "agentId": f"agent-{i}",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": buy_hold_code,
                "config": {
                    "symbols": ["AAPL"],
                    "startDate": "2022-01-01",
                    "endDate": "2022-04-01",
                    "initialCapital": 100000,
                    "seed": 42,
                },
            })

        coordinator = TournamentCoordinator(event_callback=mock_callback)
        result = await coordinator.run_tournament("tournament-1", runs_config, data)

        assert result["completed"] == 3
        assert result["failed"] == 0

        # Verify all runs started and completed
        started = [e for e in events_collected if e[1] == "run.started"]
        completed = [e for e in events_collected if e[1] == "run.completed"]
        assert len(started) == 3
        assert len(completed) == 3

    @pytest.mark.asyncio
    async def test_shared_data_isolation(self):
        """All engines receive the same data and produce deterministic results."""
        results_per_run = {}

        async def collect_callback(run_id, event_type, payload):
            if event_type == "run.completed":
                results_per_run[run_id] = payload.get("metrics", {})

        data = make_sample_data(50)
        buy_hold_code = load_strategy_from_file(FIXTURES_DIR / "buy_hold_strategy.py")

        runs_config = []
        for i in range(2):
            runs_config.append({
                "runId": f"identical-run-{i}",
                "agentId": f"agent-{i}",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": buy_hold_code,
                "config": {
                    "symbols": ["AAPL"],
                    "startDate": "2022-01-01",
                    "endDate": "2022-04-01",
                    "initialCapital": 100000,
                    "seed": 42,
                },
            })

        coordinator = TournamentCoordinator(event_callback=collect_callback)
        await coordinator.run_tournament("det-test", runs_config, data)

        # Same strategy + same data + same seed = identical metrics
        metrics_0 = results_per_run["identical-run-0"]
        metrics_1 = results_per_run["identical-run-1"]
        assert metrics_0["totalReturn"] == metrics_1["totalReturn"]
        assert metrics_0["sharpeRatio"] == metrics_1["sharpeRatio"]

    @pytest.mark.asyncio
    async def test_partial_failure(self):
        """If one engine fails, others continue; summary reflects failure."""
        async def noop_callback(run_id, event_type, payload):
            pass

        data = make_sample_data(50)

        # Bad strategy that fails to load (missing required function)
        bad_code = '''
def some_unrelated_function():
    pass
'''
        buy_hold_code = load_strategy_from_file(FIXTURES_DIR / "buy_hold_strategy.py")

        runs_config = [
            {
                "runId": "good-run",
                "agentId": "agent-0",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": buy_hold_code,
                "config": {"symbols": ["AAPL"], "initialCapital": 100000, "seed": 42},
            },
            {
                "runId": "bad-run",
                "agentId": "agent-1",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": bad_code,
                "config": {"symbols": ["AAPL"], "initialCapital": 100000, "seed": 42},
            },
        ]

        coordinator = TournamentCoordinator(event_callback=noop_callback)
        result = await coordinator.run_tournament("partial-test", runs_config, data)

        assert result["completed"] == 1
        assert result["failed"] == 1
        assert len(result["errors"]) == 1
        assert result["errors"][0]["runId"] == "bad-run"

    @pytest.mark.asyncio
    async def test_different_strategies_produce_different_results(self):
        """Different strategies produce different metrics."""
        results = {}

        async def collect_callback(run_id, event_type, payload):
            if event_type == "run.completed":
                results[run_id] = payload.get("metrics", {})

        data = make_sample_data(100)
        buy_hold_code = load_strategy_from_file(FIXTURES_DIR / "buy_hold_strategy.py")
        mean_rev_code = load_strategy_from_file(FIXTURES_DIR / "mean_reverter_strategy.py")

        runs_config = [
            {
                "runId": "buy-hold",
                "agentId": "agent-bh",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": buy_hold_code,
                "config": {"symbols": ["AAPL"], "initialCapital": 100000, "seed": 42},
            },
            {
                "runId": "mean-rev",
                "agentId": "agent-mr",
                "strategyMd": DUMMY_STRATEGY_MD,
                "strategyPy": mean_rev_code,
                "config": {"symbols": ["AAPL"], "initialCapital": 100000, "seed": 42},
            },
        ]

        coordinator = TournamentCoordinator(event_callback=collect_callback)
        result = await coordinator.run_tournament("diff-strat-test", runs_config, data)

        assert result["completed"] == 2
        # Different strategies should yield different total returns
        assert results["buy-hold"]["totalReturn"] != results["mean-rev"]["totalReturn"]
