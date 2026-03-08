from typing import Any, Protocol

import polars as pl

from aegis_runtime.simulator.market_state import MarketState
from aegis_runtime.simulator.portfolio import PortfolioState
from aegis_runtime.simulator.types import ProposedOrder, RiskDecision, SignalProposal, SizeDecision


class StrategyProtocol(Protocol):
    def prepare_features(self, df: pl.DataFrame) -> pl.DataFrame: ...
    def generate_signal(
        self, state: MarketState, portfolio: PortfolioState
    ) -> SignalProposal | None: ...
    def size_position(
        self, portfolio: PortfolioState, signal: Any
    ) -> SizeDecision: ...
    def risk_gate(
        self, order: ProposedOrder, portfolio: PortfolioState, market: MarketState
    ) -> RiskDecision: ...
