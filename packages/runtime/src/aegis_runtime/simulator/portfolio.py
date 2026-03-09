from dataclasses import dataclass, field
from typing import Any


@dataclass
class Position:
    symbol: str
    quantity: float
    avg_entry_price: float
    current_price: float = 0.0
    realized_pnl: float = 0.0

    @property
    def market_value(self) -> float:
        return round(self.quantity * self.current_price, 8)

    @property
    def unrealized_pnl(self) -> float:
        return round(self.quantity * (self.current_price - self.avg_entry_price), 8)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "quantity": self.quantity,
            "avg_entry_price": round(self.avg_entry_price, 8),
            "current_price": round(self.current_price, 8),
            "market_value": self.market_value,
            "unrealized_pnl": self.unrealized_pnl,
            "realized_pnl": round(self.realized_pnl, 8),
        }


@dataclass
class PortfolioState:
    cash: float
    positions: dict[str, Position] = field(default_factory=dict)
    realized_pnl: float = 0.0
    high_water_mark: float = 0.0
    initial_capital: float = 0.0

    @property
    def equity(self) -> float:
        positions_value = sum(p.market_value for p in self.positions.values())
        return round(self.cash + positions_value, 8)

    @property
    def drawdown(self) -> float:
        if self.high_water_mark <= 0:
            return 0.0
        return round((self.high_water_mark - self.equity) / self.high_water_mark, 8)

    def update_prices(self, prices: dict[str, float]):
        for symbol, price in prices.items():
            if symbol in self.positions:
                self.positions[symbol].current_price = price
        # Update high water mark
        eq = self.equity
        if eq > self.high_water_mark:
            self.high_water_mark = eq

    def apply_fill(self, symbol: str, side: str, quantity: float, price: float, fee: float):
        pos = self.positions.get(symbol)
        pos_qty = pos.quantity if pos else 0.0

        if side == "buy":
            if pos_qty < 0:
                # Covering short position (partially or fully)
                close_qty = min(quantity, abs(pos_qty))
                pnl = round((pos.avg_entry_price - price) * close_qty, 8)
                self.realized_pnl += pnl
                pos.realized_pnl += pnl

                remaining = quantity - close_qty
                new_short_qty = abs(pos_qty) - close_qty

                if remaining > 0:
                    # Closed entire short, now opening long with remainder
                    self.positions[symbol] = Position(
                        symbol=symbol,
                        quantity=remaining,
                        avg_entry_price=price,
                        current_price=price,
                        realized_pnl=pos.realized_pnl,
                    )
                elif new_short_qty > 0:
                    # Partially closed short
                    pos.quantity = -new_short_qty
                    pos.current_price = price
                else:
                    # Exactly closed short
                    del self.positions[symbol]
            else:
                # Opening or adding to long position
                if pos:
                    total_cost = pos.avg_entry_price * pos_qty + price * quantity
                    pos.quantity += quantity
                    pos.avg_entry_price = (
                        round(total_cost / pos.quantity, 8) if pos.quantity else 0
                    )
                    pos.current_price = price
                else:
                    self.positions[symbol] = Position(
                        symbol=symbol,
                        quantity=quantity,
                        avg_entry_price=price,
                        current_price=price,
                    )
            self.cash -= round(price * quantity + fee, 8)

        elif side == "sell":
            if pos_qty > 0:
                # Closing long position (partially or fully)
                close_qty = min(quantity, pos_qty)
                pnl = round((price - pos.avg_entry_price) * close_qty, 8)
                self.realized_pnl += pnl
                pos.realized_pnl += pnl

                remaining = quantity - close_qty
                new_long_qty = pos_qty - close_qty

                if remaining > 0:
                    # Closed entire long, now opening short with remainder
                    self.positions[symbol] = Position(
                        symbol=symbol,
                        quantity=-remaining,
                        avg_entry_price=price,
                        current_price=price,
                        realized_pnl=pos.realized_pnl,
                    )
                elif new_long_qty > 0:
                    # Partially closed long
                    pos.quantity = new_long_qty
                    pos.current_price = price
                else:
                    # Exactly closed long
                    del self.positions[symbol]
            else:
                # Opening or adding to short position
                if pos:
                    total_cost = pos.avg_entry_price * abs(pos_qty) + price * quantity
                    new_short_qty = abs(pos_qty) + quantity
                    pos.quantity = -new_short_qty
                    pos.avg_entry_price = round(total_cost / new_short_qty, 8)
                    pos.current_price = price
                else:
                    self.positions[symbol] = Position(
                        symbol=symbol,
                        quantity=-quantity,
                        avg_entry_price=price,
                        current_price=price,
                    )
            self.cash += round(price * quantity - fee, 8)

    def snapshot(self, bar_index: int, timestamp: str) -> dict[str, Any]:
        return {
            "bar_index": bar_index,
            "timestamp_simulated": timestamp,
            "cash": round(self.cash, 8),
            "equity": self.equity,
            "positions_json": {s: p.to_dict() for s, p in self.positions.items()},
            "drawdown": self.drawdown,
            "high_water_mark": round(self.high_water_mark, 8),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "cash": round(self.cash, 8),
            "positions": {s: p.to_dict() for s, p in self.positions.items()},
            "realized_pnl": round(self.realized_pnl, 8),
            "high_water_mark": round(self.high_water_mark, 8),
            "initial_capital": round(self.initial_capital, 8),
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "PortfolioState":
        positions = {}
        for symbol, pdata in data.get("positions", {}).items():
            positions[symbol] = Position(
                symbol=symbol,
                quantity=pdata["quantity"],
                avg_entry_price=pdata["avg_entry_price"],
                current_price=pdata.get("current_price", 0),
                realized_pnl=pdata.get("realized_pnl", 0),
            )
        return PortfolioState(
            cash=data["cash"],
            positions=positions,
            realized_pnl=data.get("realized_pnl", 0),
            high_water_mark=data.get("high_water_mark", 0),
            initial_capital=data.get("initial_capital", 0),
        )
