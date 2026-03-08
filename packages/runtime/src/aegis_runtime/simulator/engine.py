import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import polars as pl

from aegis_runtime.simulator.fee_model import FeeModel
from aegis_runtime.simulator.fill_model import FillModel
from aegis_runtime.simulator.market_state import MarketState
from aegis_runtime.simulator.portfolio import PortfolioState
from aegis_runtime.simulator.types import (
    EngineResult,
    OrderType,
    ProposedOrder,
    RiskDecision,
    Side,
    SignalProposal,
    SizeDecision,
)

logger = logging.getLogger(__name__)


@dataclass
class EngineConfig:
    initial_capital: float = 100000.0
    slippage_bps: float = 5.0
    fee_per_share: float = 0.01
    fee_percentage: float = 0.0
    seed: int = 42
    checkpoint_interval: int = 50


class Engine:
    def __init__(
        self,
        config: EngineConfig,
        data: dict[str, pl.DataFrame],
        strategy: Any | None = None,
        parsed_strategy: Any | None = None,
        run_id: str = "",
        event_callback: Callable[..., Awaitable[None]] | None = None,
    ):
        self.config = config
        self.data = data
        self.strategy = strategy
        self.parsed_strategy = parsed_strategy
        self.run_id = run_id
        self.event_callback = event_callback

        self.rng = random.Random(config.seed)
        self.portfolio = PortfolioState(
            cash=config.initial_capital,
            high_water_mark=config.initial_capital,
        )
        self.fill_model = FillModel(slippage_bps=config.slippage_bps, rng=self.rng)
        self.fee_model = FeeModel(per_share=config.fee_per_share, percentage=config.fee_percentage)

        self.pending_orders: list[ProposedOrder] = []
        self.all_orders: list[dict[str, Any]] = []
        self.all_fills: list[dict[str, Any]] = []
        self.snapshots: list[dict[str, Any]] = []
        self.bar_index = 0
        self.event_count = 0

        self._paused = False
        self._cancelled = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()

        # Prepare features if strategy has prepare_features
        self._prepared_data: dict[str, pl.DataFrame] = {}
        for symbol, df in self.data.items():
            if self.strategy and hasattr(self.strategy, "prepare_features"):
                try:
                    self._prepared_data[symbol] = self.strategy.prepare_features(df)
                except Exception as e:
                    logger.warning(f"prepare_features failed for {symbol}: {e}")
                    self._prepared_data[symbol] = df
            else:
                self._prepared_data[symbol] = df

    def pause(self):
        self._paused = True
        self._pause_event.clear()

    def cancel(self):
        self._cancelled = True
        self._pause_event.set()  # Unblock if paused

    async def resume_run(self):
        self._paused = False
        self._pause_event.set()

    def apply_overrides(self, overrides: dict[str, Any]):
        if self.strategy and hasattr(self.strategy, "config"):
            for key, value in overrides.items():
                setattr(self.strategy.config, key, value)
        self._overrides = overrides

    async def _emit_event(self, event_type: str, payload: dict[str, Any]):
        self.event_count += 1
        if self.event_callback:
            await self.event_callback(self.run_id, event_type, payload)

    def _get_total_bars(self) -> int:
        if not self._prepared_data:
            return 0
        return min(len(df) for df in self._prepared_data.values())

    async def run(self, run_id: str, from_bar: int = 0) -> EngineResult:
        self.run_id = run_id
        total_bars = self._get_total_bars()

        if total_bars == 0:
            return EngineResult(
                metrics=self._compute_metrics(),
                processed_bars=0,
                total_bars=0,
            )

        symbols = list(self._prepared_data.keys())

        for bar_idx in range(from_bar, total_bars):
            # Check pause/cancel
            if self._cancelled:
                break

            if self._paused:
                # Save checkpoint before pausing
                await self._save_checkpoint(bar_idx)
                await self._emit_event("run.paused", {"barIndex": bar_idx})
                await self._pause_event.wait()
                if self._cancelled:
                    break

            self.bar_index = bar_idx

            # 1. Get current prices and timestamp for all symbols
            current_prices: dict[str, float] = {}
            bar_timestamp: str | None = None
            for symbol in symbols:
                df = self._prepared_data[symbol]
                if bar_idx < len(df):
                    row = df.row(bar_idx, named=True)
                    current_prices[symbol] = float(row.get("close", 0))
                    if bar_timestamp is None and "timestamp" in row:
                        bar_timestamp = str(row["timestamp"])

            # 2. Update portfolio prices
            self.portfolio.update_prices(current_prices)

            # 3. Process pending orders (fill against current bar)
            if bar_idx > from_bar or (from_bar > 0 and bar_idx == from_bar):
                orders_to_process = self.pending_orders[:]
                self.pending_orders = []
                for order in orders_to_process:
                    if order.symbol in self._prepared_data:
                        df = self._prepared_data[order.symbol]
                        if bar_idx < len(df):
                            bar_data = df.row(bar_idx, named=True)
                            fill = self.fill_model.try_fill(order, bar_data, bar_idx)
                            if fill:
                                fee = self.fee_model.compute_fee(
                                    fill.fill_quantity, fill.fill_price
                                )
                                fill.fee = fee
                                self.portfolio.apply_fill(
                                    order.symbol,
                                    order.side.value,
                                    fill.fill_quantity,
                                    fill.fill_price,
                                    fee,
                                )
                                fill_record = {
                                    "symbol": order.symbol,
                                    "side": order.side.value,
                                    "order_type": order.order_type.value,
                                    "quantity": fill.fill_quantity,
                                    "fill_price": fill.fill_price,
                                    "fee": fee,
                                    "slippage": fill.slippage,
                                    "bar_index": bar_idx,
                                    "timestamp": fill.timestamp,
                                }
                                self.all_fills.append(fill_record)
                                await self._emit_event("order.filled", fill_record)
                            else:
                                # Order didn't fill - re-add for limit/stop
                                if order.order_type != OrderType.MARKET:
                                    self.pending_orders.append(order)

            # 4. Build market state and call strategy for each symbol
            if self.strategy:
                for symbol in symbols:
                    df = self._prepared_data[symbol]
                    if bar_idx >= len(df):
                        continue

                    market_state = MarketState.from_dataframe(df, bar_idx, symbol)

                    try:
                        signal = self.strategy.generate_signal(market_state, self.portfolio)
                    except Exception as e:
                        logger.warning(f"generate_signal error at bar {bar_idx}: {e}")
                        signal = None

                    if signal:
                        if isinstance(signal, dict):
                            signal = SignalProposal(
                                action=signal.get("action", ""),
                                symbol=signal.get("symbol", symbol),
                                confidence=signal.get("confidence", 0.5),
                                reason=signal.get("reason", ""),
                                price=current_prices.get(symbol, 0),
                            )

                        await self._emit_event("signal.generated", {
                            "symbol": signal.symbol,
                            "action": signal.action,
                            "confidence": signal.confidence,
                            "reason": signal.reason,
                            "barIndex": bar_idx,
                        })

                        # Size position
                        try:
                            size = self.strategy.size_position(self.portfolio, {
                                "action": signal.action,
                                "symbol": signal.symbol,
                                "confidence": signal.confidence,
                                "price": current_prices.get(signal.symbol, 0),
                            })
                        except Exception as e:
                            logger.warning(f"size_position error: {e}")
                            size = {"quantity": 0}

                        if isinstance(size, dict):
                            size = SizeDecision(quantity=size.get("quantity", 0))

                        if size.quantity > 0:
                            side = Side.BUY if signal.action == "buy" else Side.SELL
                            order = ProposedOrder(
                                symbol=signal.symbol,
                                side=side,
                                order_type=OrderType.MARKET,
                                quantity=size.quantity,
                            )

                            # Risk gate
                            try:
                                risk = self.strategy.risk_gate(
                                    order, self.portfolio, market_state
                                )
                            except Exception as e:
                                logger.warning(f"risk_gate error: {e}")
                                risk = {"approved": True}

                            if isinstance(risk, dict):
                                risk = RiskDecision(
                                    approved=risk.get("approved", True),
                                    reason=risk.get("reason", ""),
                                )

                            if risk.approved:
                                self.pending_orders.append(order)
                                order_record = {
                                    "symbol": order.symbol,
                                    "side": order.side.value,
                                    "order_type": order.order_type.value,
                                    "quantity": order.quantity,
                                    "bar_index": bar_idx,
                                    "status": "pending",
                                }
                                self.all_orders.append(order_record)
                                await self._emit_event("order.submitted", order_record)

            # 5. Record snapshot
            snapshot = self.portfolio.snapshot(bar_idx, str(current_prices))
            self.snapshots.append(snapshot)

            # 6. Checkpoint if interval
            if (
                self.config.checkpoint_interval > 0
                and bar_idx > 0
                and bar_idx % self.config.checkpoint_interval == 0
            ):
                await self._save_checkpoint(bar_idx)

            # 7. Progress event (every 5 bars) — includes snapshot for DB persistence
            if bar_idx % 5 == 0 or bar_idx == total_bars - 1:
                await self._emit_event("run.progress", {
                    "processedBars": bar_idx + 1,
                    "totalBars": total_bars,
                    "barIndex": bar_idx,
                    "timestampSimulated": bar_timestamp,
                    "cash": round(self.portfolio.cash, 8),
                    "equity": self.portfolio.equity,
                    "drawdown": self.portfolio.drawdown,
                    "highWaterMark": round(self.portfolio.high_water_mark, 8),
                    "positionsJson": {
                        s: p.to_dict() for s, p in self.portfolio.positions.items()
                    },
                })

            # Yield to event loop to allow SSE streaming to observers
            await asyncio.sleep(0)

        # Final checkpoint
        await self._save_checkpoint(self.bar_index)

        return EngineResult(
            metrics=self._compute_metrics(),
            processed_bars=self.bar_index + 1,
            total_bars=total_bars,
            orders=self.all_orders,
            snapshots=self.snapshots,
        )

    async def _save_checkpoint(self, bar_index: int):
        state = self.get_state()
        state["bar_index"] = bar_index
        await self._emit_event("checkpoint.saved", {
            "barIndex": bar_index,
            "state": state,
        })

    def get_state(self) -> dict[str, Any]:
        return {
            "version": 1,
            "config": {
                "initial_capital": self.config.initial_capital,
                "slippage_bps": self.config.slippage_bps,
                "fee_per_share": self.config.fee_per_share,
                "fee_percentage": self.config.fee_percentage,
                "seed": self.config.seed,
                "checkpoint_interval": self.config.checkpoint_interval,
            },
            "bar_index": self.bar_index,
            "portfolio": self.portfolio.to_dict(),
            "pending_orders": [
                {
                    "symbol": o.symbol,
                    "side": o.side.value,
                    "order_type": o.order_type.value,
                    "quantity": o.quantity,
                    "limit_price": o.limit_price,
                    "stop_price": o.stop_price,
                }
                for o in self.pending_orders
            ],
            "rng_state": list(self.rng.getstate()[1]),
            "event_count": self.event_count,
        }

    @staticmethod
    def from_state(
        state: dict[str, Any],
        config: EngineConfig,
        data: dict[str, pl.DataFrame],
        strategy: Any | None = None,
        parsed_strategy: Any | None = None,
        run_id: str = "",
        event_callback: Callable[..., Awaitable[None]] | None = None,
    ) -> "Engine":
        engine = Engine(
            config=config,
            data=data,
            strategy=strategy,
            parsed_strategy=parsed_strategy,
            run_id=run_id,
            event_callback=event_callback,
        )

        # Restore portfolio
        engine.portfolio = PortfolioState.from_dict(state["portfolio"])

        # Restore RNG state
        if "rng_state" in state:
            rng_state = state["rng_state"]
            # random.Random state is (version, internalstate, gauss_next)
            engine.rng.setstate((3, tuple(rng_state), None))
            engine.fill_model.rng = engine.rng

        # Restore pending orders
        engine.pending_orders = [
            ProposedOrder(
                symbol=o["symbol"],
                side=Side(o["side"]),
                order_type=OrderType(o["order_type"]),
                quantity=o["quantity"],
                limit_price=o.get("limit_price"),
                stop_price=o.get("stop_price"),
            )
            for o in state.get("pending_orders", [])
        ]

        engine.bar_index = state["bar_index"]
        engine.event_count = state.get("event_count", 0)

        return engine

    def _compute_metrics(self) -> dict[str, Any]:
        if not self.snapshots:
            return {
                "totalReturn": 0,
                "annualizedReturn": 0,
                "sharpeRatio": 0,
                "maxDrawdown": 0,
                "winRate": 0,
                "profitFactor": 0,
                "totalTrades": 0,
                "avgTradeReturn": 0,
            }

        initial_equity = self.config.initial_capital
        final_equity = self.portfolio.equity
        total_return = round((final_equity - initial_equity) / initial_equity, 8)

        # Compute returns series
        equities = [s["equity"] for s in self.snapshots]
        returns = []
        for i in range(1, len(equities)):
            if equities[i - 1] != 0:
                r = (equities[i] - equities[i - 1]) / equities[i - 1]
                returns.append(r)

        # Annualized return (assume 252 trading days)
        n_bars = len(equities)
        if n_bars > 1:
            annualized = round(((1 + total_return) ** (252 / n_bars)) - 1, 8)
        else:
            annualized = 0.0

        # Sharpe ratio
        if returns:
            import statistics

            mean_return = statistics.mean(returns)
            std_return = statistics.stdev(returns) if len(returns) > 1 else 0
            sharpe = round(mean_return / std_return * (252**0.5), 8) if std_return > 0 else 0
        else:
            sharpe = 0.0

        # Max drawdown
        max_dd = 0.0
        peak = equities[0]
        for eq in equities:
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd
        max_dd = round(max_dd, 8)

        # Compute round-trip trade PnL from fills
        trade_pnls = self._compute_trade_pnls()
        total_trades = len(self.all_fills)
        closed_trades = len(trade_pnls)
        winning_trades = [p for p in trade_pnls if p > 0]
        losing_trades = [p for p in trade_pnls if p < 0]

        win_rate = round(len(winning_trades) / closed_trades, 8) if closed_trades > 0 else 0

        gross_profit = sum(winning_trades)
        gross_loss = abs(sum(losing_trades))
        profit_factor = round(gross_profit / gross_loss, 8) if gross_loss > 0 else 0

        avg_trade_return = (
            round(sum(trade_pnls) / (closed_trades * initial_equity), 8)
            if closed_trades > 0 else 0
        )

        return {
            "totalReturn": total_return,
            "annualizedReturn": annualized,
            "sharpeRatio": sharpe,
            "maxDrawdown": max_dd,
            "winRate": win_rate,
            "profitFactor": profit_factor,
            "totalTrades": total_trades,
            "avgTradeReturn": avg_trade_return,
        }

    def _compute_trade_pnls(self) -> list[float]:
        """Compute PnL for each round-trip trade from fills."""
        # Track positions per symbol: {symbol: (quantity, cost_basis)}
        positions: dict[str, tuple[float, float]] = {}
        trade_pnls: list[float] = []

        for fill in self.all_fills:
            symbol = fill["symbol"]
            side = fill["side"]
            qty = fill["quantity"]
            price = fill["fill_price"]
            fee = fill.get("fee", 0)

            pos_qty, pos_cost = positions.get(symbol, (0.0, 0.0))

            if side == "buy":
                if pos_qty < 0:
                    # Closing short position
                    close_qty = min(qty, abs(pos_qty))
                    avg_entry = pos_cost / abs(pos_qty) if pos_qty != 0 else 0
                    pnl = close_qty * (avg_entry - price) - fee
                    trade_pnls.append(round(pnl, 8))
                    remaining = qty - close_qty
                    if remaining > 0:
                        positions[symbol] = (remaining, remaining * price)
                    else:
                        new_qty = pos_qty + close_qty
                        new_cost = pos_cost + close_qty * avg_entry if new_qty != 0 else 0
                        positions[symbol] = (new_qty, new_cost)
                else:
                    # Opening/adding to long position
                    positions[symbol] = (pos_qty + qty, pos_cost + qty * price)
            elif side == "sell":
                if pos_qty > 0:
                    # Closing long position
                    close_qty = min(qty, pos_qty)
                    avg_entry = pos_cost / pos_qty if pos_qty != 0 else 0
                    pnl = close_qty * (price - avg_entry) - fee
                    trade_pnls.append(round(pnl, 8))
                    remaining = qty - close_qty
                    if remaining > 0:
                        positions[symbol] = (-remaining, remaining * price)
                    else:
                        new_qty = pos_qty - close_qty
                        new_cost = pos_cost - close_qty * avg_entry if new_qty != 0 else 0
                        positions[symbol] = (new_qty, new_cost)
                else:
                    # Opening/adding to short position
                    positions[symbol] = (pos_qty - qty, pos_cost + qty * price)

        return trade_pnls
