import polars as pl
import pytest

from aegis_runtime.simulator.engine import Engine, EngineConfig
from aegis_runtime.simulator.fee_model import FeeModel
from aegis_runtime.simulator.fill_model import FillModel
from aegis_runtime.simulator.portfolio import PortfolioState
from aegis_runtime.simulator.types import OrderType, ProposedOrder, Side


def make_sample_data(n_bars=252, start_price=150.0) -> dict[str, pl.DataFrame]:
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


class TestPortfolio:
    def test_initial_state(self):
        portfolio = PortfolioState(cash=100000.0, high_water_mark=100000.0)
        assert portfolio.equity == 100000.0
        assert portfolio.drawdown == 0.0
        assert len(portfolio.positions) == 0

    def test_buy_creates_position(self):
        portfolio = PortfolioState(cash=100000.0, high_water_mark=100000.0)
        portfolio.apply_fill("AAPL", "buy", 100, 150.0, 1.0)
        assert "AAPL" in portfolio.positions
        assert portfolio.positions["AAPL"].quantity == 100
        assert portfolio.positions["AAPL"].avg_entry_price == 150.0
        assert portfolio.cash == 100000.0 - (150.0 * 100 + 1.0)

    def test_sell_removes_position(self):
        portfolio = PortfolioState(cash=100000.0, high_water_mark=100000.0)
        portfolio.apply_fill("AAPL", "buy", 100, 150.0, 1.0)
        portfolio.apply_fill("AAPL", "sell", 100, 160.0, 1.0)
        assert "AAPL" not in portfolio.positions
        assert portfolio.realized_pnl == 1000.0  # (160-150)*100

    def test_drawdown_calculation(self):
        portfolio = PortfolioState(cash=100000.0, high_water_mark=100000.0)
        portfolio.apply_fill("AAPL", "buy", 100, 150.0, 0)
        portfolio.update_prices({"AAPL": 140.0})
        assert portfolio.drawdown > 0

    def test_serialize_deserialize(self):
        portfolio = PortfolioState(cash=85000.0, high_water_mark=100000.0)
        portfolio.apply_fill("AAPL", "buy", 100, 150.0, 0)
        data = portfolio.to_dict()
        restored = PortfolioState.from_dict(data)
        assert restored.cash == portfolio.cash
        assert "AAPL" in restored.positions


class TestFeeModel:
    def test_per_share_fee(self):
        model = FeeModel(per_share=0.01, percentage=0)
        fee = model.compute_fee(100, 150.0)
        assert fee == 1.0  # 0.01 * 100

    def test_percentage_fee(self):
        model = FeeModel(per_share=0, percentage=0.001)
        fee = model.compute_fee(100, 150.0)
        assert fee == 15.0  # 0.001 * 100 * 150

    def test_max_of_both(self):
        model = FeeModel(per_share=0.01, percentage=0.001)
        fee = model.compute_fee(100, 150.0)
        assert fee == 15.0  # max(1.0, 15.0)


class TestFillModel:
    def test_market_order_fills_at_open(self):
        import random
        model = FillModel(slippage_bps=0, rng=random.Random(42))
        order = ProposedOrder(
            symbol="AAPL", side=Side.BUY, order_type=OrderType.MARKET, quantity=100
        )
        bar = {"open": 150.0, "high": 155.0, "low": 148.0, "close": 152.0, "timestamp": "t1"}
        fill = model.try_fill(order, bar, 1)
        assert fill is not None
        assert fill.fill_price == 150.0

    def test_market_order_slippage(self):
        import random
        model = FillModel(slippage_bps=5, rng=random.Random(42))
        order = ProposedOrder(
            symbol="AAPL", side=Side.BUY, order_type=OrderType.MARKET, quantity=100
        )
        bar = {"open": 150.0, "high": 155.0, "low": 148.0, "close": 152.0, "timestamp": "t1"}
        fill = model.try_fill(order, bar, 1)
        assert fill is not None
        assert fill.fill_price > 150.0  # Slippage adds to buy price
        assert fill.slippage == round(150.0 * 5 / 10000, 8)

    def test_limit_buy_fills_when_low_touches(self):
        import random
        model = FillModel(slippage_bps=0, rng=random.Random(42))
        order = ProposedOrder(
            symbol="AAPL", side=Side.BUY, order_type=OrderType.LIMIT,
            quantity=100, limit_price=148.0
        )
        bar = {"open": 150.0, "high": 155.0, "low": 147.0, "close": 152.0, "timestamp": "t1"}
        fill = model.try_fill(order, bar, 1)
        assert fill is not None
        assert fill.fill_price == 148.0

    def test_limit_buy_no_fill_when_too_low(self):
        import random
        model = FillModel(slippage_bps=0, rng=random.Random(42))
        order = ProposedOrder(
            symbol="AAPL", side=Side.BUY, order_type=OrderType.LIMIT,
            quantity=100, limit_price=140.0
        )
        bar = {"open": 150.0, "high": 155.0, "low": 148.0, "close": 152.0, "timestamp": "t1"}
        fill = model.try_fill(order, bar, 1)
        assert fill is None


class TestEngine:
    @pytest.mark.asyncio
    async def test_do_nothing_strategy(self):
        """No strategy = no trades, flat equity."""
        data = make_sample_data(100)
        config = EngineConfig(initial_capital=100000, seed=42)
        engine = Engine(config=config, data=data, strategy=None)
        result = await engine.run("test-run-1")
        assert result.metrics["totalTrades"] == 0
        assert result.processed_bars == 100

    @pytest.mark.asyncio
    async def test_determinism(self):
        """Two identical runs produce identical results."""
        data = make_sample_data(100)

        config = EngineConfig(initial_capital=100000, seed=42)
        engine1 = Engine(config=config, data=data, strategy=None)
        result1 = await engine1.run("test-run-det-1")

        engine2 = Engine(config=config, data=data, strategy=None)
        result2 = await engine2.run("test-run-det-2")

        assert result1.metrics == result2.metrics
        assert len(result1.snapshots) == len(result2.snapshots)

    @pytest.mark.asyncio
    async def test_engine_state_serialization(self):
        """Engine state can be serialized and deserialized."""
        data = make_sample_data(100)
        config = EngineConfig(initial_capital=100000, seed=42)
        engine = Engine(config=config, data=data, strategy=None)
        await engine.run("test-run-ser", from_bar=0)

        state = engine.get_state()
        assert state["version"] == 1
        assert "portfolio" in state
        assert "rng_state" in state
        assert "bar_index" in state
