from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import polars as pl

from aegis_runtime.strategy.ir import IRExpression, IRStatement, StrategyIR, StrategyOrderAction


class DeterministicStrategyRuntime:
    def __init__(self, strategy_ir: StrategyIR | dict[str, Any]):
        self.ir = (
            strategy_ir
            if isinstance(strategy_ir, StrategyIR)
            else StrategyIR.model_validate(strategy_ir)
        )
        self.input_values = {item.name: item.default for item in self.ir.inputs}
        self.input_types = {item.name: item.type for item in self.ir.inputs}
        self.input_default_expressions = {
            item.name: item.defaultExpression
            for item in self.ir.inputs
            if item.defaultExpression is not None
        }
        self.functions = {function.name: function for function in self.ir.functions}
        self.runtime_statements = (
            self.ir.statements
            if self.ir.statements
            else [
                IRStatement(
                    kind="assign",
                    name=calculation.name,
                    expression=calculation.expression,
                    assignmentKind=calculation.kind,
                    typeHint=calculation.typeHint,
                )
                for calculation in self.ir.indicators
            ]
        )
        self.symbol_states: dict[str, dict[str, Any]] = {}
        self._last_signal_plan: dict[str, Any] | None = None
        # Track active exit orders per symbol (registered by strategy.exit, persist until position closes)
        # Each entry is a dict with pre-computed stop/limit prices (frozen at registration time)
        self._active_exits: dict[str, list[dict[str, Any]]] = {}

    def prepare_features(self, df: pl.DataFrame) -> pl.DataFrame:
        return df

    def generate_signal(self, state, portfolio) -> dict[str, Any] | None:
        symbol_state = self._ensure_symbol_state(state.symbol)
        env = self._ensure_bar_values(state, portfolio, symbol_state)
        price = self._to_number(env.get("close")) or self._to_number(state.current_bar.get("close"))

        self._last_signal_plan = None
        if price is None or price <= 0:
            return None

        inline_orders = env.get("__inline_orders__", [])
        # Collect ALL matching orders on this bar (TradingView processes all orders per bar)
        position = portfolio.positions.get(state.symbol)
        simulated_position = float(position.quantity) if position else 0.0
        original_position = simulated_position
        reasons: list[str] = []

        # First, check persistent exit orders (registered by prior strategy.exit calls)
        # These are checked every bar while a position exists, matching TradingView behavior
        exit_triggered_this_bar = False
        if simulated_position != 0 and state.symbol in self._active_exits:
            remaining_exits = []
            for exit_info in self._active_exits[state.symbol]:
                if simulated_position == 0:
                    remaining_exits.append(exit_info)
                    continue
                triggered = self._check_precomputed_exit(
                    exit_info, position, env,
                )
                if triggered:
                    simulated_position = 0.0
                    exit_triggered_this_bar = True
                    reasons.append(f"exit:{exit_info['orderId']}")
                else:
                    remaining_exits.append(exit_info)
            self._active_exits[state.symbol] = remaining_exits

        for order in [*inline_orders, *self.ir.orders]:
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

            # Register exit orders persistently (TradingView behavior)
            # Pre-compute stop/limit prices at registration time (frozen)
            if order.kind == "exit":
                exit_info = self._register_exit_order(order, position, env)
                if exit_info:
                    if state.symbol not in self._active_exits:
                        self._active_exits[state.symbol] = []
                    # Replace existing exit with same orderId
                    self._active_exits[state.symbol] = [
                        e for e in self._active_exits[state.symbol]
                        if e["orderId"] != order.orderId
                    ]
                    self._active_exits[state.symbol].append(exit_info)
                continue  # Don't process exit as immediate order; it's now registered

            # In TradingView, when a SL/TP exit fires intra-bar, no new entries
            # execute on the same bar — they start from the next bar
            if exit_triggered_this_bar and order.kind == "entry":
                continue

            plan = self._build_order_plan(
                order, state.symbol, price, portfolio, env,
                override_position=simulated_position,
            )
            if not plan:
                continue

            # Update simulated position with this order's effect
            simulated_position = plan["_target"]
            reasons.append(f"{order.kind}:{order.orderId}")

        # Clear active exits if position is now flat
        if simulated_position == 0 and state.symbol in self._active_exits:
            self._active_exits[state.symbol] = []

        # Compute net position change from all matched orders
        net_delta = int(round(simulated_position - original_position))
        if net_delta == 0:
            return None

        if net_delta > 0:
            combined_plan = {"symbol": state.symbol, "side": "buy", "quantity": net_delta}
        else:
            combined_plan = {"symbol": state.symbol, "side": "sell", "quantity": abs(net_delta)}

        self._last_signal_plan = combined_plan
        return {
            "action": combined_plan["side"],
            "symbol": state.symbol,
            "confidence": 1.0,
            "reason": "+".join(reasons),
        }

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
            "activeExits": self._active_exits,
        }

    def import_state(self, state: dict[str, Any] | None) -> None:
        if not state:
            return
        self.symbol_states = state.get("symbolStates", {}) or {}
        self._last_signal_plan = state.get("lastSignalPlan")
        self._active_exits = state.get("activeExits", {}) or {}

    def _ensure_symbol_state(self, symbol: str) -> dict[str, Any]:
        if symbol not in self.symbol_states:
            self.symbol_states[symbol] = {
                "bar_values": [],
                "persistent_values": {},
                "security_cache": {},
                "function_persistent_values": {},
            }
        return self.symbol_states[symbol]

    def _ensure_bar_values(self, state, portfolio, symbol_state: dict[str, Any]) -> dict[str, Any]:
        bar_values: list[dict[str, Any]] = symbol_state["bar_values"]
        persistent_values: dict[str, Any] = symbol_state["persistent_values"]

        while len(bar_values) <= state.bar_index:
            bar_index = len(bar_values)
            row = dict(state.history[bar_index])
            env: dict[str, Any] = {**self.input_values, **row}
            env["__symbol__"] = state.symbol
            env.update(persistent_values)

            calculated_values: dict[str, Any] = {}
            inline_orders: list[StrategyOrderAction] = []
            self._execute_statements(
                self.runtime_statements,
                state.history,
                bar_index,
                symbol_state,
                portfolio,
                env,
                persistent_values=persistent_values,
                calculated_values=calculated_values,
                inline_orders=inline_orders,
            )
            if inline_orders:
                calculated_values["__inline_orders__"] = inline_orders

            bar_values.append(calculated_values)

        env = {
            **self.input_values,
            **state.history[state.bar_index],
            **bar_values[state.bar_index],
        }
        env["__symbol__"] = state.symbol
        env.update({key: value for key, value in persistent_values.items() if key not in env})
        return env

    def _execute_statements(
        self,
        statements: list[IRStatement],
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        persistent_values: dict[str, Any],
        calculated_values: dict[str, Any] | None = None,
        inline_orders: list[StrategyOrderAction] | None = None,
    ) -> tuple[str | None, Any]:
        for statement in statements:
            if statement.kind == "assign":
                value = self._evaluate_expression(
                    statement.expression,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                )
                if statement.assignmentKind == "persistent_assign":
                    if statement.name not in persistent_values:
                        persistent_values[statement.name] = value
                    value = persistent_values[statement.name]
                else:
                    if statement.assignmentKind == "reassign" or statement.name in persistent_values:
                        persistent_values[statement.name] = value
                env_current[statement.name] = value
                if calculated_values is not None:
                    calculated_values[statement.name] = value
                continue

            if statement.kind == "expr":
                result = self._evaluate_expression(
                    statement.expression,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                )
                self._collect_inline_orders(result, inline_orders)
                continue

            if statement.kind == "if":
                branch = statement.body if self._is_truthy(
                    self._evaluate_expression(
                        statement.test,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                    )
                ) else statement.orelse
                control, value = self._execute_statements(
                    branch,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    persistent_values=persistent_values,
                    calculated_values=calculated_values,
                    inline_orders=inline_orders,
                )
                if control is not None:
                    return control, value
                continue

            if statement.kind == "for_to":
                start = self._coerce_number(
                    self._evaluate_expression(
                        statement.start,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                    )
                )
                end = self._coerce_number(
                    self._evaluate_expression(
                        statement.end,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                    )
                )
                step = 1
                if statement.step is not None:
                    step_value = self._coerce_number(
                        self._evaluate_expression(
                            statement.step,
                            history_rows,
                            bar_index,
                            symbol_state,
                            portfolio,
                            env_current,
                        )
                    )
                    step = int(step_value or 1)
                if start is None or end is None or step == 0:
                    continue
                stop = int(end) + (1 if step > 0 else -1)
                for loop_value in range(int(start), stop, step):
                    env_current[statement.name] = loop_value
                    control, value = self._execute_statements(
                        statement.body,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        persistent_values=persistent_values,
                        calculated_values=calculated_values,
                        inline_orders=inline_orders,
                    )
                    if control == "break":
                        break
                    if control == "return":
                        return control, value
                continue

            if statement.kind == "break":
                return "break", None

            if statement.kind == "return":
                value = self._evaluate_expression(
                    statement.expression,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                )
                return "return", value

        return None, None

    def _collect_inline_orders(
        self,
        result: Any,
        inline_orders: list[StrategyOrderAction] | None,
    ) -> None:
        if inline_orders is None or result is None:
            return
        if isinstance(result, StrategyOrderAction):
            inline_orders.append(result)
            return
        if isinstance(result, list):
            for item in result:
                self._collect_inline_orders(item, inline_orders)

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

        if expression.kind == "subscript":
            return self._evaluate_subscript(
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

    def _evaluate_subscript(
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
        base_path = self._expression_path(expression.base)
        if base_path == "strategy.opentrades":
            return 1 if env_current.get("__symbol__") and portfolio and portfolio.positions.get(env_current.get("__symbol__")) else 0

        index_value = self._coerce_number(
            self._evaluate_expression(
                expression.index,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
        )
        if index_value is None:
            return None

        index = int(index_value)
        base_value = self._evaluate_expression(
            expression.base,
            history_rows,
            bar_index,
            symbol_state,
            portfolio,
            env_current,
            extra_context=extra_context,
        )
        if isinstance(base_value, (list, tuple)):
            if 0 <= index < len(base_value):
                return base_value[index]
            return None

        target_index = bar_index - index
        if index < 0 or target_index < 0 or target_index >= len(history_rows):
            return None
        target_env = self._env_for_bar(
            history_rows,
            target_index,
            symbol_state,
            env_current.get("__symbol__"),
        )
        return self._evaluate_expression(
            expression.base,
            history_rows,
            target_index,
            symbol_state,
            portfolio,
            target_env,
            extra_context=extra_context,
        )

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
        if name in self.input_values and self.input_types.get(name) in {
            "source",
            "time",
            "timeframe",
        }:
            return self._resolve_input_value(
                name,
                history_rows,
                bar_index,
                symbol_state,
                env_current,
            )
        if name in env_current:
            return env_current[name]
        if extra_context and name in extra_context:
            return extra_context[name]
        if name == "na":
            return None
        if name == "time":
            row = (
                history_rows[bar_index]
                if history_rows and 0 <= bar_index < len(history_rows)
                else {}
            )
            return self._timestamp_to_epoch_ms(row.get("timestamp"))
        if name == "hour":
            row = (
                history_rows[bar_index]
                if history_rows and 0 <= bar_index < len(history_rows)
                else {}
            )
            timestamp = self._timestamp_to_epoch_ms(row.get("timestamp"))
            if timestamp is None:
                return None
            return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).hour
        if name == "dayofweek":
            row = (
                history_rows[bar_index]
                if history_rows and 0 <= bar_index < len(history_rows)
                else {}
            )
            timestamp = self._timestamp_to_epoch_ms(row.get("timestamp"))
            if timestamp is None:
                return None
            iso_day = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoweekday()
            return 1 if iso_day == 7 else iso_day + 1
        if name in {"hl2", "hlc3", "ohlc4"} and history_rows and 0 <= bar_index < len(history_rows):
            row = history_rows[bar_index]
            high = self._to_number(row.get("high"))
            low = self._to_number(row.get("low"))
            close = self._to_number(row.get("close"))
            open_value = self._to_number(row.get("open"))
            if name == "hl2" and high is not None and low is not None:
                return (high + low) / 2
            if name == "hlc3" and None not in {high, low, close}:
                return (high + low + close) / 3
            if name == "ohlc4" and None not in {open_value, high, low, close}:
                return (open_value + high + low + close) / 4
        if name in self.input_values:
            return self._resolve_input_value(
                name,
                history_rows,
                bar_index,
                symbol_state,
                env_current,
            )
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
            symbol = env_current.get("__symbol__")
            position = portfolio.positions.get(symbol) if symbol else None
            if expression.attr == "position_size":
                return position.quantity if position else 0
            if expression.attr == "position_avg_price":
                return position.avg_entry_price if position else None
            if expression.attr == "netprofit":
                return portfolio.realized_pnl
            if expression.attr == "closedtrades":
                return 0
            if expression.attr == "wintrades":
                return 0
            if expression.attr == "opentrades":
                return 1 if position else 0
            return f"strategy.{expression.attr}"

        if base.kind == "name" and base.name == "syminfo":
            if expression.attr == "tickerid":
                return env_current.get("__symbol__")
            if expression.attr == "timezone":
                return "UTC"
            if expression.attr == "mintick":
                return 0.01  # US equities default; could be parameterized per symbol
            if expression.attr == "timezone":
                return "UTC"
            return f"syminfo.{expression.attr}"

        if base.kind == "name" and base.name == "dayofweek":
            day_map = {
                "sunday": 1,
                "monday": 2,
                "tuesday": 3,
                "wednesday": 4,
                "thursday": 5,
                "friday": 6,
                "saturday": 7,
            }
            return day_map.get(expression.attr, f"dayofweek.{expression.attr}")

        if base.kind == "name" and base.name in {
            "color",
            "shape",
            "location",
            "size",
            "position",
            "barstate",
            "ticker",
            "display",
            "extend",
            "xloc",
            "barmerge",
            "plot",
            "timeframe",
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
        if call_path in {
            "strategy.entry",
            "strategy.close",
            "strategy.exit",
            "strategy.close_all",
            "strategy.cancel",
        }:
            return self._evaluate_strategy_statement_call(
                call_path,
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if call_path == "math.avg":
            values = [
                self._to_number(
                    self._evaluate_expression(
                        arg.value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                for arg in expression.args
            ]
            filtered = [value for value in values if value is not None]
            return sum(filtered) / len(filtered) if filtered else None

        if call_path == "math.pow":
            left = self._to_number(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            right = self._to_number(
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
            if left is None or right is None:
                return None
            return math.pow(left, right)

        if call_path == "int":
            value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            number = self._to_number(value)
            return int(number) if number is not None else None

        if call_path == "float":
            value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            return self._to_number(value)

        if call_path in {"heikinashi", "ticker.heikinashi"}:
            symbol = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            return {"symbol": symbol or env_current.get("__symbol__"), "transform": "heikinashi"}

        if call_path == "strategy.opentrades.entry_price":
            symbol = env_current.get("__symbol__")
            position = portfolio.positions.get(symbol) if portfolio and symbol else None
            if not position:
                return None
            if expression.args:
                index = self._coerce_number(
                    self._evaluate_expression(
                        expression.args[0].value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                if index not in {None, 0}:
                    return None
            return position.avg_entry_price

        if call_path == "array.new_float":
            size = 0
            if expression.args:
                size_value = self._coerce_number(
                    self._evaluate_expression(
                        expression.args[0].value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                size = int(size_value or 0)
            default_value = 0.0
            if len(expression.args) > 1:
                default_value = self._evaluate_expression(
                    expression.args[1].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            return [default_value for _ in range(max(size, 0))]

        if call_path == "array.get":
            array_value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            index = self._coerce_number(
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
            if not isinstance(array_value, list) or index is None:
                return None
            idx = int(index)
            return array_value[idx] if 0 <= idx < len(array_value) else None

        if call_path == "array.set":
            array_value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            index = self._coerce_number(
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
            value = self._evaluate_expression(
                expression.args[2].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            if isinstance(array_value, list) and index is not None:
                idx = int(index)
                while idx >= len(array_value):
                    array_value.append(None)
                if idx >= 0:
                    array_value[idx] = value
            return value

        if call_path == "array.push":
            array_value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            value = self._evaluate_expression(
                expression.args[1].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            if isinstance(array_value, list):
                array_value.append(value)
            return value

        if call_path == "array.size":
            array_value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            return len(array_value) if isinstance(array_value, list) else None

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

        if call_path == "avg":
            values = [
                self._to_number(
                    self._evaluate_expression(
                        arg.value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                for arg in expression.args
            ]
            filtered = [value for value in values if value is not None]
            return sum(filtered) / len(filtered) if filtered else None

        if call_path == "math.abs":
            value = self._to_number(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return abs(value) if value is not None else None

        if call_path == "math.round":
            value = self._to_number(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            if value is None:
                return None
            precision = 0
            if len(expression.args) > 1:
                precision_value = self._to_number(
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
                precision = int(precision_value or 0)
            return round(value, precision)

        if call_path == "na":
            value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            if value is None:
                return True
            if isinstance(value, float) and math.isnan(value):
                return True
            return False

        if call_path == "timestamp":
            return self._timestamp_from_call(
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if call_path == "request.security":
            return self._request_security(
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        if call_path in self.functions:
            return self._evaluate_function_call(
                call_path,
                expression,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

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

        if call_path == "str.tostring":
            value = self._evaluate_expression(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
            return "" if value is None else str(value)

        if call_path in {"table.new", "table.cell", "line.new"}:
            return {"call": call_path}

        if call_path == "ta.tr":
            return self._true_range(history_rows, bar_index)

        if call_path == "ta.atr":
            length = int(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            tr_values = [self._true_range(history_rows, idx) for idx in range(bar_index + 1)]
            return self._rma(tr_values, length)

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

        if call_path == "ta.rma":
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
            return self._rma(values, length)

        if call_path == "ta.change":
            values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = 1
            if len(expression.args) > 1:
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
            return self._change(values, length)

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

        if call_path == "ta.stdev":
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
            return self._stdev(values, length)

        if call_path == "ta.sum":
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
            return self._sum(values, length)

        if call_path == "ta.highest":
            source_expr = expression.args[0].value
            length_arg = (
                expression.args[1].value if len(expression.args) > 1 else expression.args[0].value
            )
            if len(expression.args) == 1:
                source_expr = IRExpression(kind="name", name="high")
            values = self._series_values(
                source_expr,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    length_arg,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._highest(values, length)

        if call_path == "ta.lowest":
            source_expr = expression.args[0].value
            length_arg = (
                expression.args[1].value if len(expression.args) > 1 else expression.args[0].value
            )
            if len(expression.args) == 1:
                source_expr = IRExpression(kind="name", name="low")
            values = self._series_values(
                source_expr,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    length_arg,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._lowest(values, length)

        if call_path == "ta.highestbars":
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
            return self._highestbars(values, length)

        if call_path == "ta.lowestbars":
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
            return self._lowestbars(values, length)

        if call_path == "ta.pivotlow":
            source_expr = expression.args[0].value
            left_expr = (
                expression.args[1].value if len(expression.args) > 2 else expression.args[0].value
            )
            right_expr = (
                expression.args[2].value if len(expression.args) > 2 else expression.args[1].value
            )
            if len(expression.args) == 2:
                source_expr = IRExpression(kind="name", name="low")
            values = self._series_values(
                source_expr,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            left = int(
                self._evaluate_expression(
                    left_expr,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            right = int(
                self._evaluate_expression(
                    right_expr,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._pivotlow(values, left, right)

        if call_path == "ta.pivothigh":
            source_expr = expression.args[0].value
            left_expr = (
                expression.args[1].value if len(expression.args) > 2 else expression.args[0].value
            )
            right_expr = (
                expression.args[2].value if len(expression.args) > 2 else expression.args[1].value
            )
            if len(expression.args) == 2:
                source_expr = IRExpression(kind="name", name="high")
            values = self._series_values(
                source_expr,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            left = int(
                self._evaluate_expression(
                    left_expr,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            right = int(
                self._evaluate_expression(
                    right_expr,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._pivothigh(values, left, right)

        if call_path == "ta.valuewhen":
            condition_series = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            value_series = self._series_values(
                expression.args[1].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            occurrence = int(
                self._evaluate_expression(
                    expression.args[2].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._valuewhen(condition_series, value_series, occurrence)

        if call_path == "ta.barssince":
            condition_series = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            return self._barssince(condition_series)

        if call_path == "ta.stoch":
            source_values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            high_values = self._series_values(
                expression.args[1].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            low_values = self._series_values(
                expression.args[2].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            length = int(
                self._evaluate_expression(
                    expression.args[3].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._stoch(source_values, high_values, low_values, length)

        if call_path == "ta.supertrend":
            factor = self._to_number(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            atr_length = int(
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
            return self._supertrend(history_rows, bar_index, factor or 0.0, atr_length)

        if call_path == "ta.linreg":
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
            offset = (
                int(
                    self._evaluate_expression(
                        expression.args[2].value,
                        history_rows,
                        bar_index,
                        symbol_state,
                        portfolio,
                        env_current,
                        extra_context=extra_context,
                    )
                )
                if len(expression.args) > 2
                else 0
            )
            return self._linreg(values, length, offset)

        if call_path == "ta.dmi":
            length = int(
                self._evaluate_expression(
                    expression.args[0].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            smoothing = int(
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
            return self._dmi(history_rows, bar_index, length, smoothing)

        if call_path == "ta.macd":
            values = self._series_values(
                expression.args[0].value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
            )
            fast_length = int(
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
            slow_length = int(
                self._evaluate_expression(
                    expression.args[2].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            signal_length = int(
                self._evaluate_expression(
                    expression.args[3].value,
                    history_rows,
                    bar_index,
                    symbol_state,
                    portfolio,
                    env_current,
                    extra_context=extra_context,
                )
            )
            return self._macd(values, fast_length, slow_length, signal_length)

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

        if call_path == "ta.cross":
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
            return self._crossover(left, right) or self._crossunder(left, right)

        return None

    def _evaluate_function_call(
        self,
        function_name: str,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        function = self.functions[function_name]
        local_context = dict(extra_context or {})
        for param_name, arg in zip(function.params, expression.args):
            local_context[param_name] = self._evaluate_expression(
                arg.value,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )
        if function.body is not None and not function.statements:
            return self._evaluate_expression(
                function.body,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=local_context,
            )

        function_state = symbol_state.setdefault("function_persistent_values", {}).setdefault(
            function_name,
            {},
        )
        local_env = dict(env_current)
        local_env.update(local_context)
        control, value = self._execute_statements(
            function.statements,
            history_rows,
            bar_index,
            symbol_state,
            portfolio,
            local_env,
            persistent_values=function_state,
        )
        return value if control == "return" else None

    def _evaluate_strategy_statement_call(
        self,
        call_path: str,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> StrategyOrderAction | None:
        positional = [arg for arg in expression.args if arg.name is None]
        named = {arg.name: arg for arg in expression.args if arg.name is not None}

        def evaluated(arg: IRExpression | None):
            if arg is None:
                return None
            return self._evaluate_expression(
                arg,
                history_rows,
                bar_index,
                symbol_state,
                portfolio,
                env_current,
                extra_context=extra_context,
            )

        def constant_expr(value: Any) -> IRExpression | None:
            if value is None:
                return None
            return IRExpression(kind="constant", value=value)

        when_value = evaluated(named["when"].value) if "when" in named else True
        if not self._is_truthy(when_value):
            return None

        if call_path == "strategy.close_all":
            return StrategyOrderAction(
                kind="close_all",
                orderId="__close_all__",
                when=IRExpression(kind="constant", value=True),
            )

        if not positional:
            return None
        order_id = evaluated(positional[0].value)
        if not isinstance(order_id, str):
            return None

        if call_path == "strategy.cancel":
            positional_when = evaluated(positional[1].value) if len(positional) > 1 else True
            if not self._is_truthy(positional_when):
                return None
            return StrategyOrderAction(
                kind="cancel",
                orderId=order_id,
                when=IRExpression(kind="constant", value=True),
            )

        if call_path == "strategy.close":
            return StrategyOrderAction(
                kind="close",
                orderId=order_id,
                when=IRExpression(kind="constant", value=True),
            )

        if call_path == "strategy.entry":
            if len(positional) < 2:
                return None
            side_value = evaluated(positional[1].value)
            side = "long" if side_value in {"strategy.long", True, "long"} else "short"
            quantity = None
            quantity_type = None
            if len(positional) > 2:
                quantity = constant_expr(evaluated(positional[2].value))
                quantity_type = "qty"
            if "qty" in named:
                quantity = constant_expr(evaluated(named["qty"].value))
                quantity_type = "qty"
            elif "qty_percent" in named:
                quantity = constant_expr(evaluated(named["qty_percent"].value))
                quantity_type = "qty_percent"
            elif "cash" in named:
                quantity = constant_expr(evaluated(named["cash"].value))
                quantity_type = "cash"
            return StrategyOrderAction(
                kind="entry",
                orderId=order_id,
                side=side,
                when=IRExpression(kind="constant", value=True),
                quantity=quantity,
                quantityType=quantity_type,
                stop=constant_expr(evaluated(named["stop"].value)) if "stop" in named else None,
                limit=constant_expr(evaluated(named["limit"].value)) if "limit" in named else None,
            )

        from_entry_id = None
        if len(positional) > 1:
            from_entry_value = evaluated(positional[1].value)
            if isinstance(from_entry_value, str):
                from_entry_id = from_entry_value
        if "from_entry" in named:
            from_entry_value = evaluated(named["from_entry"].value)
            if isinstance(from_entry_value, str):
                from_entry_id = from_entry_value

        quantity = None
        quantity_type = None
        if "qty" in named:
            quantity = constant_expr(evaluated(named["qty"].value))
            quantity_type = "qty"
        elif "qty_percent" in named:
            quantity = constant_expr(evaluated(named["qty_percent"].value))
            quantity_type = "qty_percent"
        elif "cash" in named:
            quantity = constant_expr(evaluated(named["cash"].value))
            quantity_type = "cash"
        return StrategyOrderAction(
            kind="exit",
            orderId=order_id,
            when=IRExpression(kind="constant", value=True),
            fromEntryId=from_entry_id,
            quantity=quantity,
            quantityType=quantity_type,
            stop=constant_expr(evaluated(named["stop"].value)) if "stop" in named else None,
            limit=constant_expr(evaluated(named["limit"].value)) if "limit" in named else None,
            profit=constant_expr(evaluated(named["profit"].value)) if "profit" in named else None,
            loss=constant_expr(evaluated(named["loss"].value)) if "loss" in named else None,
        )

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
            env = self._env_for_bar(
                history_rows,
                idx,
                symbol_state,
                env_current.get("__symbol__"),
            )
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

    def _env_for_bar(
        self,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        symbol: str | None,
    ) -> dict[str, Any]:
        env = {**self.input_values, **history_rows[bar_index]}
        if bar_index < len(symbol_state["bar_values"]):
            env.update(symbol_state["bar_values"][bar_index])
        if symbol:
            env["__symbol__"] = symbol
        return env

    def _resolve_input_value(
        self,
        name: str,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        env_current: dict[str, Any],
    ) -> Any:
        default_expression = self.input_default_expressions.get(name)
        if default_expression is not None:
            return self._evaluate_expression(
                default_expression,
                history_rows,
                bar_index,
                symbol_state,
                None,
                env_current,
            )
        return self.input_values.get(name)

    def _build_order_plan(
        self,
        order: StrategyOrderAction,
        symbol: str,
        price: float,
        portfolio,
        env_current: dict[str, Any],
        override_position: float | None = None,
    ) -> dict[str, Any] | None:
        position = portfolio.positions.get(symbol)
        if override_position is not None:
            current_position = override_position
        else:
            current_position = float(position.quantity) if position else 0.0

        if order.kind == "entry":
            target_abs = self._quantity_for_order(order, price, portfolio)
            if target_abs <= 0:
                return None
            target_position = target_abs if order.side == "long" else -target_abs

            # Enforce pyramiding limit from strategy() declaration
            max_pyramiding = self.ir.meta.pyramiding
            if max_pyramiding == 0:
                # pyramiding=0: no additional entries when a position exists in the same direction
                if order.side == "long" and current_position > 0:
                    return None
                if order.side == "short" and current_position < 0:
                    return None
        elif order.kind == "cancel":
            return None
        elif order.kind in {"close", "close_all"}:
            target_position = 0.0
        else:
            if current_position == 0:
                return None
            if not self._exit_order_is_triggered(order, position, env_current):
                return None
            target_position = 0.0

        delta = int(round(target_position - current_position))
        if delta > 0:
            return {"symbol": symbol, "side": "buy", "quantity": delta, "_target": target_position}
        if delta < 0:
            return {"symbol": symbol, "side": "sell", "quantity": abs(delta), "_target": target_position}
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

    def _exit_order_is_triggered(
        self,
        order: StrategyOrderAction,
        position,
        env_current: dict[str, Any],
    ) -> bool:
        if position is None:
            return False
        if all(value is None for value in (order.stop, order.limit, order.profit, order.loss)):
            return True

        high = self._to_number(env_current.get("high"))
        low = self._to_number(env_current.get("low"))
        avg_price = self._to_number(getattr(position, "avg_entry_price", None))
        is_long = getattr(position, "quantity", 0) > 0

        stop_price = (
            self._to_number(
                self._evaluate_expression(
                    order.stop,
                    [],
                    0,
                    {
                        "bar_values": [],
                        "persistent_values": {},
                        "security_cache": {},
                        "function_persistent_values": {},
                    },
                    None,
                    env_current,
                )
            )
            if order.stop is not None
            else None
        )
        limit_price = (
            self._to_number(
                self._evaluate_expression(
                    order.limit,
                    [],
                    0,
                    {
                        "bar_values": [],
                        "persistent_values": {},
                        "security_cache": {},
                        "function_persistent_values": {},
                    },
                    None,
                    env_current,
                )
            )
            if order.limit is not None
            else None
        )

        if avg_price is not None:
            # TradingView's strategy.exit profit/loss are in ticks;
            # actual price delta = ticks * mintick
            mintick = 0.01  # US equities default
            if order.loss is not None:
                loss_ticks = self._to_number(
                    self._evaluate_expression(
                        order.loss,
                        [],
                        0,
                        {
                            "bar_values": [],
                            "persistent_values": {},
                            "security_cache": {},
                            "function_persistent_values": {},
                        },
                        None,
                        env_current,
                    )
                )
                if loss_ticks is not None:
                    loss_value = loss_ticks * mintick
                    stop_price = avg_price - loss_value if is_long else avg_price + loss_value
            if order.profit is not None:
                profit_ticks = self._to_number(
                    self._evaluate_expression(
                        order.profit,
                        [],
                        0,
                        {
                            "bar_values": [],
                            "persistent_values": {},
                            "security_cache": {},
                            "function_persistent_values": {},
                        },
                        None,
                        env_current,
                    )
                )
                if profit_ticks is not None:
                    profit_value = profit_ticks * mintick
                    limit_price = avg_price + profit_value if is_long else avg_price - profit_value

        if is_long:
            if stop_price is not None and low is not None and low <= stop_price:
                return True
            if limit_price is not None and high is not None and high >= limit_price:
                return True
        else:
            if stop_price is not None and high is not None and high >= stop_price:
                return True
            if limit_price is not None and low is not None and low <= limit_price:
                return True
        return False

    def _register_exit_order(
        self,
        order: StrategyOrderAction,
        position,
        env_current: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Pre-compute stop/limit prices at registration time.

        In TradingView, strategy.exit() parameters are evaluated once when called
        and the resulting prices persist until the position closes.
        """
        if position is None:
            return None
        avg_price = self._to_number(getattr(position, "avg_entry_price", None))
        is_long = getattr(position, "quantity", 0) > 0
        mintick = 0.01  # US equities default

        stop_price = None
        limit_price = None

        if order.stop is not None:
            stop_price = self._to_number(
                self._evaluate_expression(
                    order.stop, [], 0,
                    {
                        "bar_values": [],
                        "persistent_values": {},
                        "security_cache": {},
                        "function_persistent_values": {},
                    },
                    None, env_current,
                )
            )

        if order.limit is not None:
            limit_price = self._to_number(
                self._evaluate_expression(
                    order.limit, [], 0,
                    {
                        "bar_values": [],
                        "persistent_values": {},
                        "security_cache": {},
                        "function_persistent_values": {},
                    },
                    None, env_current,
                )
            )

        if avg_price is not None:
            if order.loss is not None:
                loss_ticks = self._to_number(
                    self._evaluate_expression(
                        order.loss, [], 0,
                        {
                            "bar_values": [],
                            "persistent_values": {},
                            "security_cache": {},
                            "function_persistent_values": {},
                        },
                        None, env_current,
                    )
                )
                if loss_ticks is not None:
                    loss_value = loss_ticks * mintick
                    stop_price = avg_price - loss_value if is_long else avg_price + loss_value
            if order.profit is not None:
                profit_ticks = self._to_number(
                    self._evaluate_expression(
                        order.profit, [], 0,
                        {
                            "bar_values": [],
                            "persistent_values": {},
                            "security_cache": {},
                            "function_persistent_values": {},
                        },
                        None, env_current,
                    )
                )
                if profit_ticks is not None:
                    profit_value = profit_ticks * mintick
                    limit_price = avg_price + profit_value if is_long else avg_price - profit_value

        return {
            "orderId": order.orderId,
            "is_long": is_long,
            "stop_price": stop_price,
            "limit_price": limit_price,
        }

    def _check_precomputed_exit(
        self,
        exit_info: dict[str, Any],
        position,
        env_current: dict[str, Any],
    ) -> bool:
        """Check if a pre-computed exit order is triggered on the current bar."""
        if position is None:
            return False
        high = self._to_number(env_current.get("high"))
        low = self._to_number(env_current.get("low"))
        stop_price = exit_info.get("stop_price")
        limit_price = exit_info.get("limit_price")
        is_long = exit_info["is_long"]

        if is_long:
            if stop_price is not None and low is not None and low <= stop_price:
                return True
            if limit_price is not None and high is not None and high >= limit_price:
                return True
        else:
            if stop_price is not None and high is not None and high >= stop_price:
                return True
            if limit_price is not None and low is not None and low <= limit_price:
                return True
        return False

    def _apply_binary(self, op: str, left: Any, right: Any) -> Any:
        left_number = self._to_number(left)
        right_number = self._to_number(right)
        if op == "+":
            if left_number is not None and right_number is not None:
                return left_number + right_number
            if isinstance(left, str) and right is not None:
                return left + str(right)
            if isinstance(right, str) and left is not None:
                return str(left) + right
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
        if op == "^":
            if left_number is None or right_number is None:
                return None
            return left_number**right_number
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

    def _rma(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        numeric_values = [self._to_number(value) for value in values]
        if any(value is None for value in numeric_values[:length]):
            return None
        rma = sum(numeric_values[:length]) / length
        for value in numeric_values[length:]:
            if value is None:
                return None
            rma = ((rma * (length - 1)) + value) / length
        return rma

    def _ema_series(self, values: list[Any], length: int) -> list[float | None]:
        if length <= 0:
            return [None] * len(values)
        numeric_values = [self._to_number(value) for value in values]
        results: list[float | None] = [None] * len(values)
        if len(values) < length or any(value is None for value in numeric_values[:length]):
            return results
        ema = sum(numeric_values[:length]) / length
        results[length - 1] = ema
        alpha = 2 / (length + 1)
        for idx in range(length, len(numeric_values)):
            value = numeric_values[idx]
            if value is None:
                return results
            ema = (value * alpha) + (ema * (1 - alpha))
            results[idx] = ema
        return results

    def _rsi(self, values: list[Any], length: int) -> float | None:
        """RSI using Wilder's smoothing (RMA), matching TradingView's ta.rsi."""
        if length <= 0 or len(values) <= length:
            return None
        numeric_values = [self._to_number(value) for value in values]
        if any(value is None for value in numeric_values):
            return None
        changes = []
        for previous, current in zip(numeric_values[:-1], numeric_values[1:]):
            changes.append(current - previous)
        if len(changes) < length:
            return None
        # Seed with SMA over first `length` changes
        gains = [max(c, 0) for c in changes[:length]]
        losses_vals = [abs(min(c, 0)) for c in changes[:length]]
        avg_gain = sum(gains) / length
        avg_loss = sum(losses_vals) / length
        # Apply Wilder's smoothing (RMA) for remaining changes
        for change in changes[length:]:
            avg_gain = ((avg_gain * (length - 1)) + max(change, 0)) / length
            avg_loss = ((avg_loss * (length - 1)) + abs(min(change, 0))) / length
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def _change(self, values: list[Any], length: int = 1) -> float | None:
        if length <= 0 or len(values) <= length:
            return None
        current = self._to_number(values[-1])
        previous = self._to_number(values[-1 - length])
        if current is None or previous is None:
            return None
        return current - previous

    def _stdev(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        mean = sum(window) / length
        variance = sum((value - mean) ** 2 for value in window) / length
        return math.sqrt(variance)

    def _highestbars(self, values: list[Any], length: int) -> int | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        max_value = max(window)
        best_index = max(idx for idx, value in enumerate(window) if value == max_value)
        return best_index - (len(window) - 1)

    def _lowestbars(self, values: list[Any], length: int) -> int | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        min_value = min(window)
        best_index = max(idx for idx, value in enumerate(window) if value == min_value)
        return best_index - (len(window) - 1)

    def _highest(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        return max(window)

    def _lowest(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        return min(window)

    def _sum(self, values: list[Any], length: int) -> float | None:
        if length <= 0 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        return sum(window)

    def _true_range(self, history_rows: list[dict[str, Any]], bar_index: int) -> float | None:
        row = history_rows[bar_index] if 0 <= bar_index < len(history_rows) else None
        if row is None:
            return None
        high = self._to_number(row.get("high"))
        low = self._to_number(row.get("low"))
        if high is None or low is None:
            return None
        if bar_index == 0:
            return high - low
        prev_close = self._to_number(history_rows[bar_index - 1].get("close"))
        if prev_close is None:
            return high - low
        return max(high - low, abs(high - prev_close), abs(low - prev_close))

    def _pivotlow(self, values: list[Any], left: int, right: int) -> float | None:
        return self._pivot(values, left, right, mode="low")

    def _pivothigh(self, values: list[Any], left: int, right: int) -> float | None:
        return self._pivot(values, left, right, mode="high")

    def _pivot(self, values: list[Any], left: int, right: int, *, mode: str) -> float | None:
        if left < 0 or right < 0:
            return None
        candidate_index = len(values) - 1 - right
        start = candidate_index - left
        end = candidate_index + right
        if start < 0 or end >= len(values):
            return None
        numeric_values = [self._to_number(value) for value in values[start : end + 1]]
        if any(value is None for value in numeric_values):
            return None
        pivot_value = numeric_values[left]
        if mode == "low":
            if all(pivot_value <= value for value in numeric_values):
                return pivot_value
            return None
        if all(pivot_value >= value for value in numeric_values):
            return pivot_value
        return None

    def _valuewhen(self, conditions: list[Any], values: list[Any], occurrence: int) -> Any:
        if occurrence < 0:
            return None
        matches = [
            value for condition, value in zip(conditions, values) if self._is_truthy(condition)
        ]
        if occurrence >= len(matches):
            return None
        return matches[-1 - occurrence]

    def _barssince(self, conditions: list[Any]) -> int | None:
        for index in range(len(conditions) - 1, -1, -1):
            if self._is_truthy(conditions[index]):
                return len(conditions) - 1 - index
        return None

    def _stoch(
        self,
        source_values: list[Any],
        high_values: list[Any],
        low_values: list[Any],
        length: int,
    ) -> float | None:
        if (
            length <= 0
            or len(source_values) < length
            or len(high_values) < length
            or len(low_values) < length
        ):
            return None
        source = self._to_number(source_values[-1])
        highs = [self._to_number(value) for value in high_values[-length:]]
        lows = [self._to_number(value) for value in low_values[-length:]]
        if source is None or any(value is None for value in highs + lows):
            return None
        highest_high = max(highs)
        lowest_low = min(lows)
        if highest_high == lowest_low:
            return 0.0
        return 100 * ((source - lowest_low) / (highest_high - lowest_low))

    def _linreg(self, values: list[Any], length: int, offset: int = 0) -> float | None:
        if length <= 1 or len(values) < length:
            return None
        window = [self._to_number(value) for value in values[-length:]]
        if any(value is None for value in window):
            return None
        xs = list(range(length))
        x_mean = sum(xs) / length
        y_mean = sum(window) / length
        denominator = sum((x - x_mean) ** 2 for x in xs)
        if denominator == 0:
            return None
        slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, window)) / denominator
        intercept = y_mean - slope * x_mean
        target_x = length - 1 - offset
        return intercept + slope * target_x

    def _supertrend(
        self,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        factor: float,
        atr_length: int,
    ) -> list[float | None]:
        if atr_length <= 0 or bar_index < 0:
            return [None, None]

        highs = [self._to_number(row.get("high")) for row in history_rows[: bar_index + 1]]
        lows = [self._to_number(row.get("low")) for row in history_rows[: bar_index + 1]]
        closes = [self._to_number(row.get("close")) for row in history_rows[: bar_index + 1]]
        if any(value is None for value in highs + lows + closes):
            return [None, None]

        tr_values = [self._true_range(history_rows, idx) for idx in range(bar_index + 1)]
        atr_series = self._rma_series(tr_values, atr_length)
        final_upper: list[float | None] = [None] * len(highs)
        final_lower: list[float | None] = [None] * len(highs)
        trend: list[float | None] = [None] * len(highs)
        direction: list[float | None] = [None] * len(highs)

        for idx in range(len(highs)):
            atr = atr_series[idx]
            if atr is None:
                continue
            hl2 = (highs[idx] + lows[idx]) / 2
            basic_upper = hl2 + factor * atr
            basic_lower = hl2 - factor * atr
            if idx == 0 or final_upper[idx - 1] is None or final_lower[idx - 1] is None:
                final_upper[idx] = basic_upper
                final_lower[idx] = basic_lower
                trend[idx] = basic_lower
                direction[idx] = 1.0
                continue

            prev_upper = final_upper[idx - 1]
            prev_lower = final_lower[idx - 1]
            prev_close = closes[idx - 1]
            prev_trend = trend[idx - 1]

            final_upper[idx] = (
                basic_upper if basic_upper < prev_upper or prev_close > prev_upper else prev_upper
            )
            final_lower[idx] = (
                basic_lower if basic_lower > prev_lower or prev_close < prev_lower else prev_lower
            )

            if prev_trend == prev_upper:
                trend[idx] = (
                    final_upper[idx] if closes[idx] <= final_upper[idx] else final_lower[idx]
                )
            else:
                trend[idx] = (
                    final_lower[idx] if closes[idx] >= final_lower[idx] else final_upper[idx]
                )
            direction[idx] = 1.0 if trend[idx] == final_lower[idx] else -1.0

        return [trend[-1], direction[-1]]

    def _macd(
        self,
        values: list[Any],
        fast_length: int,
        slow_length: int,
        signal_length: int,
    ) -> list[float | None]:
        fast_series = self._ema_series(values, fast_length)
        slow_series = self._ema_series(values, slow_length)
        macd_series: list[float | None] = []
        for fast_value, slow_value in zip(fast_series, slow_series):
            if fast_value is None or slow_value is None:
                macd_series.append(None)
            else:
                macd_series.append(fast_value - slow_value)
        valid_macd = [value for value in macd_series if value is not None]
        signal_value = self._ema(valid_macd, signal_length)
        macd_value = macd_series[-1] if macd_series else None
        histogram = (
            macd_value - signal_value
            if macd_value is not None and signal_value is not None
            else None
        )
        return [macd_value, signal_value, histogram]

    def _dmi(
        self,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        di_length: int,
        adx_smoothing: int,
    ) -> list[float | None]:
        highs = [self._to_number(row.get("high")) for row in history_rows[: bar_index + 1]]
        lows = [self._to_number(row.get("low")) for row in history_rows[: bar_index + 1]]
        closes = [self._to_number(row.get("close")) for row in history_rows[: bar_index + 1]]
        if any(value is None for value in highs + lows + closes):
            return [None, None, None]
        if len(highs) < 2:
            return [None, None, None]

        true_ranges = [None]
        plus_dm = [None]
        minus_dm = [None]
        for idx in range(1, len(highs)):
            high = highs[idx]
            low = lows[idx]
            prev_high = highs[idx - 1]
            prev_low = lows[idx - 1]
            prev_close = closes[idx - 1]
            up_move = high - prev_high
            down_move = prev_low - low
            plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0.0)
            minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0.0)
            true_ranges.append(
                max(
                    high - low,
                    abs(high - prev_close),
                    abs(low - prev_close),
                )
            )

        atr_series = self._rma_series(true_ranges, di_length)
        plus_series = self._rma_series(plus_dm, di_length)
        minus_series = self._rma_series(minus_dm, di_length)

        plus_di_series: list[float | None] = []
        minus_di_series: list[float | None] = []
        dx_series: list[float | None] = []
        for atr_value, plus_value, minus_value in zip(atr_series, plus_series, minus_series):
            if atr_value in (None, 0) or plus_value is None or minus_value is None:
                plus_di_series.append(None)
                minus_di_series.append(None)
                dx_series.append(None)
                continue
            plus_di = 100 * plus_value / atr_value
            minus_di = 100 * minus_value / atr_value
            plus_di_series.append(plus_di)
            minus_di_series.append(minus_di)
            total = plus_di + minus_di
            dx_series.append(100 * abs(plus_di - minus_di) / total if total else None)

        adx_series = self._rma_series(dx_series, adx_smoothing)
        return [plus_di_series[-1], minus_di_series[-1], adx_series[-1]]

    def _timestamp_from_call(
        self,
        expression: IRExpression,
        history_rows: list[dict[str, Any]],
        bar_index: int,
        symbol_state: dict[str, Any],
        portfolio,
        env_current: dict[str, Any],
        *,
        extra_context: dict[str, Any] | None = None,
    ) -> int | None:
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
        timezone_name = "UTC"
        if values and isinstance(values[0], str):
            timezone_name = values.pop(0)
        if len(values) < 3:
            return None
        year, month, day = [int(self._to_number(value) or 0) for value in values[:3]]
        hour = int(self._to_number(values[3]) or 0) if len(values) > 3 else 0
        minute = int(self._to_number(values[4]) or 0) if len(values) > 4 else 0
        second = int(self._to_number(values[5]) or 0) if len(values) > 5 else 0
        try:
            tz = timezone.utc if timezone_name.upper() in {"UTC", "GMT", "GMT+0"} else timezone.utc
            dt = datetime(year, month, day, hour, minute, second, tzinfo=tz)
        except ValueError:
            return None
        return int(dt.timestamp() * 1000)

    def _timestamp_to_epoch_ms(self, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        if not isinstance(value, str):
            return None
        normalized = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(normalized)
        except ValueError:
            for fmt in (
                "%Y-%m-%d",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M:%S",
            ):
                try:
                    dt = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    dt = None
            if dt is None:
                return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)

    def _request_security(
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
        symbol_value = self._evaluate_expression(
            expression.args[0].value,
            history_rows,
            bar_index,
            symbol_state,
            portfolio,
            env_current,
            extra_context=extra_context,
        )
        current_symbol = env_current.get("__symbol__")
        transform = None
        if isinstance(symbol_value, dict):
            transform = symbol_value.get("transform")
            symbol_value = symbol_value.get("symbol")
        if symbol_value not in {current_symbol, None}:
            return None

        timeframe_value = self._evaluate_expression(
            expression.args[1].value,
            history_rows,
            bar_index,
            symbol_state,
            portfolio,
            env_current,
            extra_context=extra_context,
        )
        cache_key = f"{symbol_value or current_symbol}:{timeframe_value}:{transform or 'raw'}"
        security_cache = symbol_state.setdefault("security_cache", {})
        resampled_rows = security_cache.get(cache_key)
        if resampled_rows is None:
            resampled_rows = self._resample_history(history_rows, timeframe_value)
            if transform == "heikinashi":
                resampled_rows = self._apply_heikin_ashi(resampled_rows)
            security_cache[cache_key] = resampled_rows
        if not resampled_rows:
            return None

        current_timestamp = self._timestamp_to_epoch_ms(
            history_rows[bar_index].get("timestamp") if history_rows else None
        )
        target_index = len(resampled_rows) - 1
        if current_timestamp is not None:
            for idx, row in enumerate(resampled_rows):
                row_timestamp = self._timestamp_to_epoch_ms(row.get("timestamp"))
                if row_timestamp is not None and row_timestamp > current_timestamp:
                    target_index = max(idx - 1, 0)
                    break

        security_state = {
            "bar_values": [],
            "persistent_values": {},
            "security_cache": {},
            "function_persistent_values": {},
        }
        return self._evaluate_expression(
            expression.args[2].value,
            resampled_rows,
            target_index,
            security_state,
            portfolio,
            self._env_for_bar(resampled_rows, target_index, security_state, current_symbol),
            extra_context=extra_context,
        )

    def _resample_history(
        self,
        history_rows: list[dict[str, Any]],
        timeframe: Any,
    ) -> list[dict[str, Any]]:
        minutes = self._parse_timeframe_minutes(timeframe)
        if minutes is None or not history_rows:
            return history_rows

        buckets: list[dict[str, Any]] = []
        current_bucket_start = None
        current_bucket = None
        for row in history_rows:
            ts = self._timestamp_to_epoch_ms(row.get("timestamp"))
            if ts is None:
                return history_rows
            bucket_start = (ts // (minutes * 60 * 1000)) * (minutes * 60 * 1000)
            if current_bucket_start != bucket_start:
                current_bucket_start = bucket_start
                current_bucket = dict(row)
                current_bucket["timestamp"] = datetime.fromtimestamp(
                    bucket_start / 1000,
                    tz=timezone.utc,
                ).isoformat()
                buckets.append(current_bucket)
                continue

            assert current_bucket is not None
            current_bucket["high"] = max(
                self._to_number(current_bucket.get("high")) or float("-inf"),
                self._to_number(row.get("high")) or float("-inf"),
            )
            current_bucket["low"] = min(
                self._to_number(current_bucket.get("low")) or float("inf"),
                self._to_number(row.get("low")) or float("inf"),
            )
            current_bucket["close"] = row.get("close")
            current_bucket["volume"] = (self._to_number(current_bucket.get("volume")) or 0) + (
                self._to_number(row.get("volume")) or 0
            )

        return buckets

    def _apply_heikin_ashi(self, history_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not history_rows:
            return history_rows

        transformed: list[dict[str, Any]] = []
        previous_open = None
        previous_close = None
        for row in history_rows:
            open_value = self._to_number(row.get("open"))
            high_value = self._to_number(row.get("high"))
            low_value = self._to_number(row.get("low"))
            close_value = self._to_number(row.get("close"))
            if any(value is None for value in (open_value, high_value, low_value, close_value)):
                transformed.append(dict(row))
                continue
            ha_close = (open_value + high_value + low_value + close_value) / 4
            if previous_open is None or previous_close is None:
                ha_open = (open_value + close_value) / 2
            else:
                ha_open = (previous_open + previous_close) / 2
            transformed_row = dict(row)
            transformed_row.update(
                {
                    "open": ha_open,
                    "high": max(high_value, ha_open, ha_close),
                    "low": min(low_value, ha_open, ha_close),
                    "close": ha_close,
                }
            )
            transformed.append(transformed_row)
            previous_open = ha_open
            previous_close = ha_close
        return transformed

    def _parse_timeframe_minutes(self, timeframe: Any) -> int | None:
        if isinstance(timeframe, (int, float)):
            return int(timeframe)
        if not isinstance(timeframe, str):
            return None
        normalized = timeframe.strip().upper()
        if normalized.isdigit():
            return int(normalized)
        if normalized == "D":
            return 60 * 24
        if normalized == "W":
            return 60 * 24 * 7
        if normalized.endswith("H") and normalized[:-1].isdigit():
            return int(normalized[:-1]) * 60
        return None

    def _rma_series(self, values: list[Any], length: int) -> list[float | None]:
        results: list[float | None] = [None] * len(values)
        if length <= 0 or len(values) < length:
            return results

        numeric_values = [self._to_number(value) for value in values]
        seed_window = numeric_values[:length]
        if any(value is None for value in seed_window):
            start = next(
                (
                    idx
                    for idx in range(len(numeric_values) - length + 1)
                    if all(value is not None for value in numeric_values[idx : idx + length])
                ),
                None,
            )
            if start is None:
                return results
            seed_window = numeric_values[start : start + length]
            rma = sum(seed_window) / length
            results[start + length - 1] = rma
            begin = start + length
        else:
            rma = sum(seed_window) / length
            results[length - 1] = rma
            begin = length

        for idx in range(begin, len(numeric_values)):
            value = numeric_values[idx]
            if value is None:
                continue
            rma = ((rma * (length - 1)) + value) / length
            results[idx] = rma
        return results

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
