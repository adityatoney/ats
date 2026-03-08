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

    def apply_fill(self, symbol: str, side: str, quantity: int, price: float, fee: float):
        if side == "buy":
            if symbol in self.positions:
                pos = self.positions[symbol]
                total_cost = pos.avg_entry_price * pos.quantity + price * quantity
                pos.quantity += quantity
                pos.avg_entry_price = round(total_cost / pos.quantity, 8) if pos.quantity else 0
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
            if symbol in self.positions:
                pos = self.positions[symbol]
                pnl = round((price - pos.avg_entry_price) * quantity, 8)
                pos.realized_pnl += pnl
                self.realized_pnl += pnl
                pos.quantity -= quantity
                pos.current_price = price
                if pos.quantity <= 0:
                    del self.positions[symbol]
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
        )
