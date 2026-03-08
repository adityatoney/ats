import random
from dataclasses import dataclass
from typing import Any

from aegis_runtime.simulator.types import OrderType, ProposedOrder, Side, SimulatedFill


@dataclass
class FillModel:
    slippage_bps: float = 5.0
    rng: random.Random | None = None

    def try_fill(
        self,
        order: ProposedOrder,
        next_bar: dict[str, Any],
        bar_index: int,
    ) -> SimulatedFill | None:
        _ = self.rng or random.Random()  # ensure rng fallback exists

        if order.order_type == OrderType.MARKET:
            base_price = float(next_bar.get("open", 0))
            slippage_pct = self.slippage_bps / 10000.0
            if order.side == Side.BUY:
                slippage = round(base_price * slippage_pct, 8)
                fill_price = round(base_price + slippage, 8)
            else:
                slippage = round(base_price * slippage_pct, 8)
                fill_price = round(base_price - slippage, 8)

            return SimulatedFill(
                order=order,
                fill_price=fill_price,
                fill_quantity=order.quantity,
                fee=0.0,  # Fee computed separately
                slippage=slippage,
                bar_index=bar_index,
                timestamp=str(next_bar.get("timestamp", "")),
            )

        elif order.order_type == OrderType.LIMIT:
            bar_low = float(next_bar.get("low", 0))
            bar_high = float(next_bar.get("high", 0))

            if order.side == Side.BUY and order.limit_price is not None:
                if bar_low <= order.limit_price:
                    fill_price = round(order.limit_price, 8)
                    return SimulatedFill(
                        order=order,
                        fill_price=fill_price,
                        fill_quantity=order.quantity,
                        fee=0.0,
                        slippage=0.0,
                        bar_index=bar_index,
                        timestamp=str(next_bar.get("timestamp", "")),
                    )
            elif order.side == Side.SELL and order.limit_price is not None:
                if bar_high >= order.limit_price:
                    fill_price = round(order.limit_price, 8)
                    return SimulatedFill(
                        order=order,
                        fill_price=fill_price,
                        fill_quantity=order.quantity,
                        fee=0.0,
                        slippage=0.0,
                        bar_index=bar_index,
                        timestamp=str(next_bar.get("timestamp", "")),
                    )

        elif order.order_type == OrderType.STOP:
            bar_high = float(next_bar.get("high", 0))
            bar_low = float(next_bar.get("low", 0))

            if order.side == Side.SELL and order.stop_price is not None:
                if bar_low <= order.stop_price:
                    fill_price = round(order.stop_price, 8)
                    return SimulatedFill(
                        order=order,
                        fill_price=fill_price,
                        fill_quantity=order.quantity,
                        fee=0.0,
                        slippage=0.0,
                        bar_index=bar_index,
                        timestamp=str(next_bar.get("timestamp", "")),
                    )

        return None
