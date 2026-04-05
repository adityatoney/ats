from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"


class OrderStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


@dataclass
class SignalProposal:
    action: str  # "buy" or "sell"
    symbol: str
    confidence: float = 0.5
    reason: str = ""
    price: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SizeDecision:
    quantity: int = 0
    reason: str = ""


@dataclass
class RiskDecision:
    approved: bool = True
    reason: str = ""


@dataclass
class ProposedOrder:
    client_order_id: str
    symbol: str
    side: Side
    order_type: OrderType
    quantity: int
    limit_price: float | None = None
    stop_price: float | None = None


@dataclass
class SimulatedFill:
    order: ProposedOrder
    fill_price: float
    fill_quantity: int
    fee: float
    slippage: float
    bar_index: int
    timestamp: str


@dataclass
class EngineResult:
    metrics: dict[str, Any]
    processed_bars: int
    total_bars: int
    orders: list[dict[str, Any]] = field(default_factory=list)
    snapshots: list[dict[str, Any]] = field(default_factory=list)
