from __future__ import annotations

from typing import Any

import polars as pl

from aegis_runtime.strategy.ir import IRExpression, StrategyIR, StrategyOrderAction


class DeterministicStrategyRuntime:
    def __init__(self, strategy_ir: StrategyIR | dict[str, Any]):
        self.ir = (
            strategy_ir
            if isinstance(strategy_ir, StrategyIR)
            else StrategyIR.model_validate(strategy_ir)
        )
        self.input_values = {item.name: item.default for item in self.ir.inputs}
        self.symbol_states: dict[str, dict[str, Any]] = {}
        self._last_signal_plan: dict[str, Any] | None = None

    def prepare_features(self, df: pl.DataFrame) -> pl.DataFrame:
        return df

    def generate_signal(self, state, portfolio) -> dict[str, Any] | None:
        symbol_state = self._ensure_symbol_state(state.symbol)
        env = self._ensure_bar_values(state, portfolio, symbol_state)
        price = self._to_number(env.get("close")) or self._to_number(state.current_bar.get("close"))

        self._last_signal_plan = None
        if price is None or price <= 0:
            return None

        for order in self.ir.orders:
            if not self._is_truthy(
                self._evaluate_expression(
                    order.when,
                    state.history,
                    state.bar_index,
                    symbol_state,
                    portfolio,
                    env,
                )
            ):
                continue

            plan = self._build_order_plan(order, state.symbol, price, portfolio)
            if not plan:
                continue

            self._last_signal_plan = plan
            return {
                "action": plan["side"],
                "symbol": state.symbol,
                "confidence": 1.0,
                "reason": f"{order.kind}:{order.orderId}",
            }

        return None

    def size_position(self, portfolio, signal) -> dict[str, Any]:
        if not self._last_signal_plan:
            return {"side": "", "quantity": 0}
        if signal.get("symbol") != self._last_signal_plan.get("symbol"):
            return {"side": "", "quantity": 0}
        return {
            "side": self._last_signal_plan["side"],
            "quantity": self._last_signal_plan["quantity"],
        }

    def risk_gate(self, order, portfolio, market) -> dict[str, Any]:
        if not self.ir.risk.gates:
            return {"approved": True, "reason": ""}

        symbol_state = self._ensure_symbol_state(market.symbol)
        env = self._ensure_bar_values(market, portfolio, symbol_state)
        extra_context = {"order": order}
        for gate in self.ir.risk.gates:
            approved = self._is_truthy(
                self._evaluate_expression(
                    gate,
                    market.history,
                    market.bar_index,
                    symbol_state,
                    portfolio,
                    env,
                    extra_context=extra_context,
                )
            )
            if not approved:
                return {"approved": False, "reason": "Risk gate rejected the order"}
        return {"approved": True, "reason": ""}

    def export_state(self) -> dict[str, Any]:
        return {
            "symbolStates": self.symbol_states,
            "lastSignalPlan": self._last_signal_plan,
        }

    def import_state(self, state: dict[str, Any] | None) -> None:
        if not state:
            return
        self.symbol_states = state.get("symbolStates", {}) or {}
        self._last_signal_plan = state.get("lastSignalPlan")

    def _ensure_symbol_state(self, symbol: str) -> dict[str, Any]:
        if symbol not in self.symbol_states:
            self.symbol_states[symbol] = {
                "bar_values": [],
                "persistent_values": {},
            }
        return self.symbol_states[symbol]

    def _ensure_bar_values(self, state, portfolio, symbol_state: dict[str, Any]) -> dict[str, Any]:
        bar_values: list[dict[str, Any]] = symbol_state["bar_values"]
        persistent_values: dict[str, Any] = symbol_state["persistent_values"]

        while len(bar_values) <= state.bar_index:
            bar_index = len(bar_values)
            row = dict(state.history[bar_index])
            env: dict[str, Any] = {**self.input_values, **row}
            env.update(persistent_values)

            calculated_values: dict[str, Any] = {}
            for calculation in self.ir.indicators:
                if calculation.kind == "persistent_assign":
                    if calculation.name not in persistent_values:
                        persistent_values[calculation.name] = self._evaluate_expression(
                            calculation.expression,
                            state.history,
                            bar_index,
                            symbol_state,
                            portfolio,
                            env,
                        )
                    value = persistent_values[calculation.name]
                else:
                    value = self._evaluate_expression(
                        calculation.expression,
                        state.history,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env,
                    )
                    if (
                        calculation.kind == "reassign"
                        or calculation.name in persistent_values
                    ):
                        persistent_values[calculation.name] = value

                env[calculation.name] = value
                calculated_values[calculation.name] = value

            bar_values.append(calculated_values)

        env = {**self.input_values, **state.history[state.bar_index], **bar_values[state.bar_index]}
        env.update(
            {
                key: value
                for key, value in persistent_values.items()
                if key not in env
            }
        )
        return env

    def _evaluate_expression(
        self,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        if expression.kind == "constant":
            return expression.value

        if expression.kind == "name":
            return self._resolve_name(
                expression.name or "",
                history_rows,
                bar_index,
                symbol_state,
                env_current,
                extra_context=extra_context,
            )

        if expression.kind == "attribute":
            return self._resolve_attribute(
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if expression.kind == "call":
            return self._evaluate_call(
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if expression.kind == "binary":
            left = self._evaluate_expression(
                expression.left,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            right = self._evaluate_expression(
                expression.right,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            return self._apply_binary(expression.op or "", left, right)

        if expression.kind == "comparison":
            left = self._evaluate_expression(
                expression.left,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            for op, comparator in zip(expression.ops, expression.comparators):
                right = self._evaluate_expression(
                    comparator,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
                if not self._apply_comparison(op, left, right):
                    return False
                left = right
            return True

        if expression.kind == "bool":
            values = [
                self._is_truthy(
                    self._evaluate_expression(
                        value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                for value in expression.values
            ]
            if expression.op == "and":
                return all(values)
            return any(values)

        if expression.kind == "ternary":
            predicate = self._evaluate_expression(
                expression.test,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            branch = expression.body if self._is_truthy(predicate) else expression.orelse
            return self._evaluate_expression(
                branch,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if expression.kind == "tuple":
            return [
                self._evaluate_expression(
                    item,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
                for item in expression.elements
            ]

        if expression.kind == "unary":
            operand = self._evaluate_expression(
                expression.operand,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            if expression.op == "not":
                return not self._is_truthy(operand)
            if expression.op == "-":
                number = self._to_number(operand)
                return -number if number is not None else None
            if expression.op == "+":
                return self._to_number(operand)

        return None

    def _resolve_name(
        self,
        name: str,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        if name in env_current:
            return env_current[name]
        if extra_context and name in extra_context:
            return extra_context[name]
        if name == "na":
            return None
        if name in self.input_values:
            return self.input_values[name]
        if history_rows and 0 <= bar_index < len(history_rows):
            row = history_rows[bar_index]
            if name in row:
                return row[name]
        bar_values = symbol_state["bar_values"]
        if bar_index < len(bar_values) and name in bar_values[bar_index]:
            return bar_values[bar_index][name]
        return None

    def _resolve_attribute(
        self,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        base = expression.base
        if base.kind == "name" and base.name == "strategy":
            if expression.attr == "equity":
                return portfolio.equity
            if expression.attr == "initial_capital":
                return portfolio.initial_capital
            return f"strategy.{expression.attr}"

        if base.kind == "name" and base.name in {
            "color",
            "shape",
            "location",
            "size",
            "position",
            "barstate",
        }:
            return f"{base.name}.{expression.attr}"

        if base.kind == "name" and base.name == "order" and extra_context:
            order = extra_context.get("order", {})
            if isinstance(order, dict):
                return order.get(expression.attr)

        resolved_base = self._evaluate_expression(
            base,
            history_rows,
            bar_index,
            symbol_state,
            portfolio,
            env_current,
            extra_context=extra_context,
        )
        if isinstance(resolved_base, dict):
            return resolved_base.get(expression.attr)
        return getattr(resolved_base, expression.attr, None)

    def _evaluate_call(
        self,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        call_path = self._expression_path(expression.callee)
        if call_path == "math.max":
            values = [
                self._evaluate_expression(
                    arg.value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
                for arg in expression.args
            ]
            filtered = [value for value in values if value is not None]
            return max(filtered) if filtered else None

        if call_path == "math.min":
            values = [
                self._evaluate_expression(
                    arg.value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
                for arg in expression.args
            ]
            filtered = [value for value in values if value is not None]
            return min(filtered) if filtered else None

        if call_path == "nz":
            primary = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            if primary is not None:
                return primary
            if len(expression.args) > 1:
                return self._evaluate_expression(
                    expression.args[1].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            return 0

        if call_path == "color.new":
            return self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if call_path == "ta.sma":
            values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    expression.args[1].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._sma(values, length)

        if call_path == "ta.ema":
            values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    expression.args[1].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._ema(values, length)

        if call_path == "ta.rsi":
            values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    expression.args[1].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._rsi(values, length)

        if call_path == "ta.crossover":
            left = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            right = self._series_values(
                expression.args[1].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            return self._crossover(left, right)

        if call_path == "ta.crossunder":
            left = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            right = self._series_values(
                expression.args[1].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            return self._crossunder(left, right)

        return None

    def _series_values(
        self,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        current_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
    ) -> list[Any]:
        values = []
        for idx in range(current_index + 1):
            env = {**self.input_values, **history_rows[idx]}
            if idx < len(symbol_state["bar_values"]):
                env.update(symbol_state["bar_values"][idx])
            if idx == current_index:
                env.update(env_current)
            values.append(
                self._evaluate_expression(
                    expression,
                    history_rows,
                    idx,
                    symbol_state,
                    portfolio,
                    env,
                )
            )
        return values

    def _build_order_plan(
        self,
        order: StrategyOrderAction,
        symbol: str,
        price: float,
        portfolio,
    ) -> dict[str, Any] | None:
        position = portfolio.positions.get(symbol)
        current_position = float(position.quantity) if position else 0.0

        if order.kind == "entry":
            target_abs = self._quantity_for_order(order, price, portfolio)
            if target_abs <= 0:
                return None
            target_position = target_abs if order.side == "long" else -target_abs
        else:
            target_position = 0.0

        delta = int(round(target_position - current_position))
        if delta > 0:
            return {"symbol": symbol, "side": "buy", "quantity": delta}
        if delta < 0:
            return {"symbol": symbol, "side": "sell", "quantity": abs(delta)}
        return None

    def _quantity_for_order(self, order: StrategyOrderAction, price: float, portfolio) -> int:
        if price <= 0:
            return 0

        if order.quantity is not None and order.quantityType is not None:
            quantity_value = self._coerce_number(
                self._evaluate_expression(
                    order.quantity,
                    [],
                    0,
                    {"bar_values": [], "persistent_values": {}},
                    portfolio,
                    self.input_values,
                )
            )
            if quantity_value is None:
                return 0
            if order.quantityType == "qty":
                return max(0, int(quantity_value))
            if order.quantityType == "qty_percent":
                return max(0, int((portfolio.equity * quantity_value / 100.0) / price))
            if order.quantityType == "cash":
                return max(0, int(quantity_value / price))

        if self.ir.sizing.mode == "fixed_quantity":
            return max(0, int(self.ir.sizing.value or 0))
        if self.ir.sizing.mode == "percent_of_equity":
            return max(0, int((portfolio.equity * (self.ir.sizing.value or 0) / 100.0) / price))
        if self.ir.sizing.mode == "cash_amount":
            return max(0, int((self.ir.sizing.value or 0) / price))
        if self.ir.sizing.mode == "expression" and self.ir.sizing.expression is not None:
            quantity_value = self._coerce_number(
                self._evaluate_expression(
                    self.ir.sizing.expression,
                    [],
                    0,
                    {"bar_values": [], "persistent_values": {}},
                    portfolio,
                    self.input_values,
                )
            )
            return max(0, int(quantity_value or 0))

        if self.ir.meta.defaultQtyType == "percent_of_equity":
            return max(
                0,
                int((portfolio.equity * self.ir.meta.defaultQtyValue / 100.0) / price),
            )
        if self.ir.meta.defaultQtyType == "cash":
            return max(0, int(self.ir.meta.defaultQtyValue / price))
        return max(0, int(self.ir.meta.defaultQtyValue))

    def _apply_binary(self, op: str, left: Any, right: Any) -> Any:
        left_number = self._to_number(left)
        right_number = self._to_number(right)
        if op == "+":
            if left_number is not None and right_number is not None:
                return left_number + right_number
            if isinstance(left, str) and isinstance(right, str):
                return left + right
            return None
        if op == "-":
            if left_number is None or right_number is None:
                return None
            return left_number - right_number
        if op == "*":
            if left_number is None or right_number is None:
                return None
            return left_number * right_number
        if op == "/":
            if left_number is None or right_number in (None, 0):
                return None
            return left_number / right_number
        if op == "%":
            if left_number is None or right_number in (None, 0):
                return None
            return left_number % right_number
        return None

    def _apply_comparison(self, op: str, left: Any, right: Any) -> bool:
        if left is None or right is None:
            return op == "==" and left is right
        if op == "==":
            return left == right
        if op == "!=":
            return left != right
        if op == ">":
            return left > right
        if op == ">=":
            return left >= right
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        return False

    def _expression_path(self, expression: IRExpression) -> str:
        if expression.kind == "name":
            return expression.name or ""
        if expression.kind == "attribute":
            return f"{self._expression_path(expression.base)}.{expression.attr}"
        return ""

    def _sma(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        return sum(window) / length

    def _ema(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        numeric_values = [self._to_number(value) for value in values]
        if any(value is None for value in numeric_values[:length]):
            return None
        alpha = 2 / (length + 1)
        ema = sum(numeric_values[:length]) / length
        for value in numeric_values[length:]:
            if value is None:
                return None
            ema = (value * alpha) + (ema * (1 - alpha))
        return ema

    def _rsi(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) <= length:
            return None
        numeric_values = [self._to_number(value) for value in values]
        if any(value is None for value in numeric_values):
            return None
        gains = []
        losses = []
        for previous, current in zip(numeric_values[:-1], numeric_values[1:]):
            change = current - previous
            gains.append(max(change, 0))
            losses.append(abs(min(change, 0)))
        if len(gains) < length:
            return None
        avg_gain = sum(gains[-length:]) / length
        avg_loss = sum(losses[-length:]) / length
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def _crossover(self, left: list[Any], right: list[Any]) -> bool:
        if len(left) < 2 or len(right) < 2:
            return False
        left_prev, left_curr = self._to_number(left[-2]), self._to_number(left[-1])
        right_prev, right_curr = self._to_number(right[-2]), self._to_number(right[-1])
        if None in {left_prev, left_curr, right_prev, right_curr}:
            return False
        return left_curr > right_curr and left_prev <= right_prev

    def _crossunder(self, left: list[Any], right: list[Any]) -> bool:
        if len(left) < 2 or len(right) < 2:
            return False
        left_prev, left_curr = self._to_number(left[-2]), self._to_number(left[-1])
        right_prev, right_curr = self._to_number(right[-2]), self._to_number(right[-1])
        if None in {left_prev, left_curr, right_prev, right_curr}:
            return False
        return left_curr < right_curr and left_prev >= right_prev

    def _is_truthy(self, value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, str):
            return value != ""
        return bool(value)

    def _to_number(self, value: Any) -> float | None:
        if isinstance(value, bool):
            return float(value)
        if isinstance(value, (int, float)):
            return float(value)
        return None

    def _coerce_number(self, value: Any) -> float | None:
        return self._to_number(value)
