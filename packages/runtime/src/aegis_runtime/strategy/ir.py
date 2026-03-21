from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ExpressionKind = Literal[
    "constant",
    "name",
    "attribute",
    "call",
    "binary",
    "comparison",
    "bool",
    "ternary",
    "tuple",
    "unary",
]

AssignmentKind = Literal["assign", "persistent_assign", "reassign"]
OrderKind = Literal["entry", "close", "exit"]
DirectionKind = Literal["long", "short", "both"]
SizingMode = Literal[
    "strategy_default",
    "fixed_quantity",
    "percent_of_equity",
    "cash_amount",
    "expression",
]


class IRExpression(BaseModel):
    kind: ExpressionKind
    value: Any | None = None
    name: str | None = None
    attr: str | None = None
    op: str | None = None
    callee: "IRExpression | None" = None
    base: "IRExpression | None" = None
    left: "IRExpression | None" = None
    right: "IRExpression | None" = None
    operand: "IRExpression | None" = None
    test: "IRExpression | None" = None
    body: "IRExpression | None" = None
    orelse: "IRExpression | None" = None
    values: list["IRExpression"] = Field(default_factory=list)
    comparators: list["IRExpression"] = Field(default_factory=list)
    ops: list[str] = Field(default_factory=list)
    args: list["IRCallArg"] = Field(default_factory=list)
    elements: list["IRExpression"] = Field(default_factory=list)


class IRCallArg(BaseModel):
    value: IRExpression
    name: str | None = None


class StrategyMeta(BaseModel):
    name: str
    scriptVersion: int = 5
    direction: DirectionKind = "long"
    overlay: bool = False
    initialCapital: float = 100000.0
    defaultQtyType: str = "percent_of_equity"
    defaultQtyValue: float = 100.0
    additionalArgs: dict[str, IRExpression] = Field(default_factory=dict)


class StrategyInput(BaseModel):
    name: str
    type: Literal["int", "float", "string", "bool"]
    default: Any
    title: str | None = None
    options: list[Any] = Field(default_factory=list)


class StrategyCalculation(BaseModel):
    name: str
    expression: IRExpression
    kind: AssignmentKind = "assign"
    typeHint: str | None = None


class StrategySignals(BaseModel):
    entry: list[IRExpression] = Field(default_factory=list)
    exit: list[IRExpression] = Field(default_factory=list)


class StrategyOrderAction(BaseModel):
    kind: OrderKind
    orderId: str
    when: IRExpression
    side: Literal["long", "short"] | None = None
    quantity: IRExpression | None = None
    quantityType: Literal["qty", "qty_percent", "cash"] | None = None


class StrategyRisk(BaseModel):
    gates: list[IRExpression] = Field(default_factory=list)


class StrategySizing(BaseModel):
    mode: SizingMode = "strategy_default"
    value: float | None = None
    expression: IRExpression | None = None


class StrategyPlot(BaseModel):
    kind: str
    call: IRExpression


class StrategyIR(BaseModel):
    meta: StrategyMeta
    inputs: list[StrategyInput] = Field(default_factory=list)
    indicators: list[StrategyCalculation] = Field(default_factory=list)
    signals: StrategySignals = Field(default_factory=StrategySignals)
    orders: list[StrategyOrderAction] = Field(default_factory=list)
    risk: StrategyRisk = Field(default_factory=StrategyRisk)
    sizing: StrategySizing = Field(default_factory=StrategySizing)
    plots: list[StrategyPlot] = Field(default_factory=list)
    passthroughPine: list[str] = Field(default_factory=list)


IRExpression.model_rebuild()
