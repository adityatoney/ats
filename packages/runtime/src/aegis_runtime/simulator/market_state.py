from dataclasses import dataclass, field
from typing import Any

import polars as pl


@dataclass
class MarketState:
    current_bar: dict[str, Any]
    bar_index: int
    timestamp: str
    symbol: str
    history: list[dict[str, Any]] = field(default_factory=list)

    @staticmethod
    def from_dataframe(df: pl.DataFrame, bar_index: int, symbol: str) -> "MarketState":
        rows = df.to_dicts()
        current = rows[bar_index]
        return MarketState(
            current_bar=current,
            bar_index=bar_index,
            timestamp=str(current.get("timestamp", "")),
            symbol=symbol,
            history=rows[: bar_index + 1],
        )
