from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any

import yaml

from aegis_runtime.strategy.diagnostics import StrategyCompileError
from aegis_runtime.strategy.ir import (
    IRExpression,
    StrategyCalculation,
    StrategyInput,
    StrategyIR,
    StrategyMeta,
    StrategyOrderAction,
    StrategyRisk,
    StrategySizing,
)
from aegis_runtime.strategy.pine_compiler import parse_pine_expression, render_expression

_REQUIRED_HEADINGS = [
    "Inputs",
    "Indicators",
    "Entry Rules",
    "Exit Rules",
    "Risk Rules",
    "Sizing",
]


def compile_markdown_source(markdown: str) -> StrategyIR:
    sections = _extract_sections(markdown)
    meta, inputs = _parse_inputs(sections["Inputs"])
    calculations = _parse_calculations(sections["Indicators"])
    entry_orders = _parse_orders(sections["Entry Rules"], default_kind="entry")
    exit_orders = _parse_orders(sections["Exit Rules"], default_kind="close")
    risk = _parse_risk(sections["Risk Rules"])
    sizing = _parse_sizing(sections["Sizing"])
    orders = entry_orders + exit_orders

    if sizing.mode == "fixed_quantity" and sizing.value is not None:
        meta.defaultQtyType = "fixed"
        meta.defaultQtyValue = sizing.value
    elif sizing.mode == "percent_of_equity" and sizing.value is not None:
        meta.defaultQtyType = "percent_of_equity"
        meta.defaultQtyValue = sizing.value
    elif sizing.mode == "cash_amount" and sizing.value is not None:
        meta.defaultQtyType = "cash"
        meta.defaultQtyValue = sizing.value

    entry_signals = _unique_expressions(
        [order.when for order in orders if order.kind == "entry"]
    )
    exit_signals = _unique_expressions(
        [order.when for order in orders if order.kind in {"close", "exit"}]
    )

    directions = {order.side for order in orders if order.side}
    if directions == {"long"}:
        meta.direction = "long"
    elif directions == {"short"}:
        meta.direction = "short"
    elif directions:
        meta.direction = "both"

    return StrategyIR(
        meta=meta,
        inputs=inputs,
        indicators=calculations,
        signals={"entry": entry_signals, "exit": exit_signals},
        orders=orders,
        risk=risk,
        sizing=sizing,
    )


def _extract_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_heading: str | None = None
    in_yaml_block = False
    block_lines: list[str] = []
    seen_blocks: set[str] = set()

    for raw_line in markdown.splitlines():
        heading_match = re.match(r"^##\s+(.+?)\s*$", raw_line)
        if heading_match and not in_yaml_block:
            current_heading = heading_match.group(1)
            continue

        fence_match = re.match(r"^```([a-zA-Z0-9_-]+)?\s*$", raw_line)
        if fence_match and current_heading:
            fence_lang = (fence_match.group(1) or "").lower()
            if not in_yaml_block:
                if fence_lang not in {"yaml", "yml"}:
                    continue
                if current_heading in seen_blocks:
                    raise StrategyCompileError(
                        f"Section '{current_heading}' must contain exactly one YAML block"
                    )
                in_yaml_block = True
                block_lines = []
            else:
                in_yaml_block = False
                sections[current_heading] = "\n".join(block_lines).strip()
                seen_blocks.add(current_heading)
            continue

        if in_yaml_block:
            block_lines.append(raw_line)

    if in_yaml_block:
        raise StrategyCompileError("Unterminated YAML code fence in strategy markdown")

    missing = [heading for heading in _REQUIRED_HEADINGS if heading not in sections]
    if missing:
        raise StrategyCompileError(
            f"Missing required markdown sections: {', '.join(missing)}"
        )

    return sections


def _parse_yaml_block(section_name: str, payload: str) -> Any:
    try:
        return yaml.safe_load(payload) or {}
    except yaml.YAMLError as exc:
        raise StrategyCompileError(
            f"Invalid YAML in section '{section_name}': {exc}"
        ) from exc


def _parse_inputs(payload: str) -> tuple[StrategyMeta, list[StrategyInput]]:
    data = _parse_yaml_block("Inputs", payload)
    if isinstance(data, list):
        meta_data: dict[str, Any] = {}
        inputs_data = data
    elif isinstance(data, dict):
        meta_data = data.get("meta", {}) or {}
        inputs_data = data.get("parameters", data.get("inputs", [])) or []
    else:
        raise StrategyCompileError("Inputs section must be a YAML mapping or list")

    if not isinstance(inputs_data, list):
        raise StrategyCompileError("Inputs.parameters must be a list")

    default_qty_type = str(meta_data.get("defaultQtyType", "percent_of_equity"))
    if default_qty_type.startswith("strategy."):
        default_qty_type = default_qty_type.removeprefix("strategy.")

    meta = StrategyMeta(
        name=str(meta_data.get("name", "Markdown Strategy")),
        scriptVersion=int(meta_data.get("scriptVersion", 5)),
        direction=str(meta_data.get("direction", "long")),
        overlay=bool(meta_data.get("overlay", False)),
        initialCapital=float(meta_data.get("initialCapital", 100000.0)),
        defaultQtyType=default_qty_type,
        defaultQtyValue=float(meta_data.get("defaultQtyValue", 100.0)),
    )

    inputs = []
    for item in inputs_data:
        if not isinstance(item, dict):
            raise StrategyCompileError("Each input definition must be a YAML mapping")
        options = item.get("options", []) or []
        if not isinstance(options, list):
            raise StrategyCompileError("Input options must be a list")
        inputs.append(
            StrategyInput(
                name=str(item["name"]),
                type=str(item.get("type", "string")),
                default=item.get("default"),
                title=item.get("title"),
                options=options,
            )
        )

    return meta, inputs


def _parse_calculations(payload: str) -> list[StrategyCalculation]:
    data = _parse_yaml_block("Indicators", payload)
    items = data.get("calculations", data) if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise StrategyCompileError("Indicators section must define a list of calculations")

    calculations = []
    for item in items:
        if not isinstance(item, dict):
            raise StrategyCompileError("Each indicator entry must be a YAML mapping")
        mode = str(item.get("mode", item.get("kind", "assign")))
        mode_map = {
            "assign": "assign",
            "persistent": "persistent_assign",
            "persistent_assign": "persistent_assign",
            "reassign": "reassign",
        }
        if mode not in mode_map:
            raise StrategyCompileError(f"Unsupported calculation mode: {mode}")
        calculations.append(
            StrategyCalculation(
                name=str(item["name"]),
                expression=_parse_expression_field(item, "expression"),
                kind=mode_map[mode],
                typeHint=item.get("typeHint"),
            )
        )
    return calculations


def _parse_orders(payload: str, default_kind: str) -> list[StrategyOrderAction]:
    data = _parse_yaml_block("orders", payload)
    items = data.get("orders", data) if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise StrategyCompileError("Order sections must define a list")

    orders = []
    for item in items:
        if not isinstance(item, dict):
            raise StrategyCompileError("Each order rule must be a YAML mapping")
        kind = str(item.get("kind", default_kind))
        quantity = None
        quantity_type = None
        if "quantity" in item:
            quantity = _coerce_expression(item["quantity"])
            quantity_type = str(item.get("quantityType", "qty"))
        side = item.get("side")
        if side is not None:
            side = str(side)
        orders.append(
            StrategyOrderAction(
                kind=kind,
                orderId=str(item.get("orderId", item.get("id", "Long"))),
                when=_parse_expression_field(item, "when"),
                side=side,
                quantity=quantity,
                quantityType=quantity_type,
            )
        )
    return orders


def _parse_risk(payload: str) -> StrategyRisk:
    data = _parse_yaml_block("Risk Rules", payload)
    if isinstance(data, list):
        gates = data
    else:
        gates = data.get("gates", []) if isinstance(data, dict) else []
    if not isinstance(gates, list):
        raise StrategyCompileError("Risk gates must be a list")
    return StrategyRisk(gates=[_coerce_expression(item) for item in gates])


def _parse_sizing(payload: str) -> StrategySizing:
    data = _parse_yaml_block("Sizing", payload)
    if not isinstance(data, dict):
        raise StrategyCompileError("Sizing section must be a YAML mapping")

    expression = None
    if "expression" in data:
        expression = _coerce_expression(data["expression"])

    value = data.get("value")
    return StrategySizing(
        mode=str(data.get("mode", "strategy_default")),
        value=float(value) if value is not None else None,
        expression=expression,
    )


def _parse_expression_field(item: dict[str, Any], key: str) -> IRExpression:
    if key not in item:
        raise StrategyCompileError(f"Missing required expression field '{key}'")
    return _coerce_expression(item[key])


def _coerce_expression(value: Any) -> IRExpression:
    if isinstance(value, bool) or isinstance(value, int) or isinstance(value, float):
        return IRExpression(kind="constant", value=value)
    if value is None:
        return IRExpression(kind="constant", value=None)
    if isinstance(value, str):
        return parse_pine_expression(value)
    raise StrategyCompileError("Expression values must be scalars or Pine expression strings")


def _unique_expressions(expressions: list[IRExpression]) -> list[IRExpression]:
    unique: OrderedDict[str, IRExpression] = OrderedDict()
    for expression in expressions:
        unique.setdefault(render_expression(expression), expression)
    return list(unique.values())
