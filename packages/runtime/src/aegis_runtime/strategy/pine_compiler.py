from __future__ import annotations

import re
from collections import OrderedDict

from aegis_runtime.strategy.diagnostics import StrategyCompileError, compile_error
from aegis_runtime.strategy.ir import (
    IRCallArg,
    IRExpression,
    StrategyCalculation,
    StrategyInput,
    StrategyIR,
    StrategyMeta,
    StrategyOrderAction,
    StrategyPlot,
)

_SCRIPT_VERSION_RE = re.compile(r"//@version=(\d+)")
_SUPPORTED_EXPR_CALLS = {
    "ta.sma",
    "ta.ema",
    "ta.rsi",
    "ta.rma",
    "ta.change",
    "ta.dmi",
    "ta.macd",
    "ta.stdev",
    "ta.highestbars",
    "ta.lowestbars",
    "ta.crossover",
    "ta.crossunder",
    "math.max",
    "math.min",
    "nz",
    "color.new",
}
_SUPPORTED_STRATEGY_CALLS = {"strategy.entry", "strategy.close", "strategy.exit"}
_SUPPORTED_PLOT_CALLS = {"plot", "plotshape", "bgcolor", "hline"}
_PASSTHROUGH_CALLS = {"alertcondition", "fill", "table.new", "table.cell", "str.tostring"}
_PASSTHROUGH_ROOTS = {"table", "alertcondition", "barstate", "str", "position"}
_CALL_ALIASES = {
    "sma": "ta.sma",
    "ema": "ta.ema",
    "rsi": "ta.rsi",
    "rma": "ta.rma",
    "change": "ta.change",
    "dmi": "ta.dmi",
    "macd": "ta.macd",
    "stdev": "ta.stdev",
    "highestbars": "ta.highestbars",
    "lowestbars": "ta.lowestbars",
    "security": "request.security",
    "crossover": "ta.crossover",
    "crossunder": "ta.crossunder",
    "max": "math.max",
    "min": "math.min",
}
_INPUT_TYPE_ALIASES = {
    "input.integer": "int",
    "input.int": "int",
    "input.float": "float",
    "input.string": "string",
    "input.bool": "bool",
    "input.source": "source",
    "input.time": "time",
    "input.timeframe": "timeframe",
    "input.resolution": "timeframe",
}
_COMPARISON_MAP = {
    "Eq": "==",
    "NotEq": "!=",
    "Gt": ">",
    "GtE": ">=",
    "Lt": "<",
    "LtE": "<=",
}
_BOOL_MAP = {"And": "and", "Or": "or"}
_BINARY_MAP = {
    "Add": "+",
    "Sub": "-",
    "Mult": "*",
    "Div": "/",
    "Mod": "%",
    "Pow": "^",
}
_UNARY_MAP = {"Not": "not", "USub": "-", "UAdd": "+"}


def _load_pynescript():
    try:
        from pynescript.ast import (
            Assign,
            Attribute,
            BinOp,
            BoolOp,
            Call,
            Compare,
            Conditional,
            Constant,
            Expr,
            Name,
            ReAssign,
            Subscript,
            Tuple,
            UnaryOp,
            parse,
            unparse,
        )
    except ImportError as exc:
        raise StrategyCompileError(
            "pynescript is required for deterministic Pine compilation"
        ) from exc

    return {
        "Assign": Assign,
        "Attribute": Attribute,
        "BinOp": BinOp,
        "BoolOp": BoolOp,
        "Call": Call,
        "Compare": Compare,
        "Conditional": Conditional,
        "Constant": Constant,
        "Expr": Expr,
        "Name": Name,
        "ReAssign": ReAssign,
        "Subscript": Subscript,
        "Tuple": Tuple,
        "UnaryOp": UnaryOp,
        "parse": parse,
        "unparse": unparse,
    }


def parse_pine_source(source: str) -> StrategyIR:
    api = _load_pynescript()
    parse = api["parse"]
    try:
        module = parse(source)
    except Exception as exc:
        raise StrategyCompileError(f"Failed to parse Pine source: {exc}") from exc

    compiler = _PineLowerer(source=source, api=api)
    return compiler.lower(module)


def parse_pine_expression(expression: str) -> IRExpression:
    api = _load_pynescript()
    parse = api["parse"]
    try:
        module = parse(f"tmp_expr = {expression}")
    except Exception as exc:
        raise StrategyCompileError(f"Failed to parse Pine expression: {exc}") from exc

    assign = module.body[0]
    value = getattr(assign, "value", None)
    if value is None:
        raise StrategyCompileError("Failed to parse Pine expression")

    compiler = _PineLowerer(source=expression, api=api)
    return compiler.lower_expression(value)


class _PineLowerer:
    def __init__(self, source: str, api: dict[str, object]):
        self.source = source
        self.api = api
        self.unparse = api["unparse"]
        self.version = self._extract_version(source)
        self.meta: StrategyMeta | None = None
        self.inputs: list[StrategyInput] = []
        self.calculations: list[StrategyCalculation] = []
        self.orders: list[StrategyOrderAction] = []
        self.plots: list[StrategyPlot] = []
        self.passthrough: list[str] = []
        self.literal_bindings: dict[str, object] = {}
        self._active_input_replacements: dict[int, str] = {}

    def lower(self, module) -> StrategyIR:
        for statement in module.body:
            self.lower_statement(statement)

        if self.meta is None:
            raise StrategyCompileError("Pine strategy() declaration is required")

        entry_order_sides = {
            order.orderId: order.side
            for order in self.orders
            if order.kind == "entry" and order.side
        }
        for order in self.orders:
            if order.kind in {"close", "exit"} and order.side is None:
                order.side = entry_order_sides.get(order.orderId)

        directions = {order.side for order in self.orders if order.side}
        if directions == {"long"}:
            self.meta.direction = "long"
        elif directions == {"short"}:
            self.meta.direction = "short"
        elif directions:
            self.meta.direction = "both"

        entry_signals = _unique_expressions(
            [order.when for order in self.orders if order.kind == "entry"]
        )
        exit_signals = _unique_expressions(
            [order.when for order in self.orders if order.kind in {"close", "exit"}]
        )

        return StrategyIR(
            meta=self.meta,
            inputs=self.inputs,
            indicators=self.calculations,
            signals={
                "entry": entry_signals,
                "exit": exit_signals,
            },
            orders=self.orders,
            plots=self.plots,
            passthroughPine=self.passthrough,
        )

    def lower_statement(self, statement) -> None:
        Expr = self.api["Expr"]
        Assign = self.api["Assign"]
        ReAssign = self.api["ReAssign"]

        if isinstance(statement, Expr):
            self._lower_expr_statement(statement.value, statement)
            return

        if isinstance(statement, Assign):
            self._lower_assign(statement)
            return

        if isinstance(statement, ReAssign):
            self.calculations.append(
                StrategyCalculation(
                    name=self._require_name(statement.target, statement),
                    expression=self.lower_expression(statement.value),
                    kind="reassign",
                )
            )
            return

        raise compile_error(
            "unsupported_statement",
            f"Unsupported Pine statement: {type(statement).__name__}",
            statement,
        )

    def _lower_expr_statement(self, expr, statement) -> None:
        Call = self.api["Call"]

        if isinstance(expr, Call):
            call_path = self._normalize_call_path(self._call_path(expr.func))
            if call_path == "strategy":
                self.meta = self._lower_strategy_call(expr)
                return
            if call_path in _SUPPORTED_PLOT_CALLS:
                self.plots.append(
                    StrategyPlot(
                        kind=call_path,
                        call=self.lower_expression(expr),
                    )
                )
                return
            if call_path in _PASSTHROUGH_CALLS:
                self.passthrough.append(self.unparse(statement).strip())
                return
            if call_path in _SUPPORTED_STRATEGY_CALLS:
                self._append_order(expr, self._true_expression())
                return

        if type(expr).__name__ == "If":
            if self._is_passthrough_if(expr):
                self.passthrough.append(self.unparse(statement).strip())
                return
            self._lower_conditional_orders(expr)
            return

        raise compile_error(
            "unsupported_expression_statement",
            f"Unsupported Pine expression statement: {type(expr).__name__}",
            statement,
        )

    def _lower_assign(self, statement) -> None:
        Call = self.api["Call"]

        if type(statement.target).__name__ == "Tuple":
            self._lower_tuple_assign(statement)
            return

        assignment_name = self._require_name(statement.target, statement)

        if isinstance(statement.value, Call):
            call_path = self._normalize_call_path(self._call_path(statement.value.func))
            if self._is_supported_input_call(call_path):
                self.inputs.append(self._lower_input(statement))
                return
            if call_path == "table.new":
                self.passthrough.append(self.unparse(statement).strip())
                return

        previous_replacements = self._active_input_replacements
        self._active_input_replacements = {}
        self._hoist_embedded_inputs(statement.value, assignment_name)

        try:
            kind = (
                "persistent_assign"
                if type(getattr(statement, "mode", None)).__name__ == "Var"
                else "assign"
            )
            type_hint = None
            if getattr(statement, "type", None) is not None:
                type_hint = self.unparse(statement.type).strip()

            calculation = StrategyCalculation(
                name=assignment_name,
                expression=self.lower_expression(statement.value),
                kind=kind,
                typeHint=type_hint,
            )
            self.calculations.append(calculation)

            literal_value = self._try_literal_value(statement.value)
            if literal_value is not None:
                self.literal_bindings[calculation.name] = literal_value
        finally:
            self._active_input_replacements = previous_replacements

    def _lower_tuple_assign(self, statement) -> None:
        target_names = [
            self._require_name(element, statement)
            for element in getattr(statement.target, "elts", [])
        ]
        value_expr = self.lower_expression(statement.value)
        for index, name in enumerate(target_names):
            self.calculations.append(
                StrategyCalculation(
                    name=name,
                    expression=IRExpression(
                        kind="subscript",
                        base=value_expr,
                        index=IRExpression(kind="constant", value=index),
                    ),
                )
            )

    def _is_supported_input_call(self, call_path: str) -> bool:
        return call_path == "input" or call_path.startswith("input.")

    def _hoist_embedded_inputs(self, node, assignment_name: str) -> None:
        if type(node).__name__ == "Call":
            call_path = self._normalize_call_path(self._call_path(node.func))
            if self._is_supported_input_call(call_path):
                synthetic_name = self._next_synthetic_input_name(assignment_name)
                self.inputs.append(self._lower_input_from_call(synthetic_name, node, node))
                self._active_input_replacements[id(node)] = synthetic_name
                return

        for value in vars(node).values():
            if isinstance(value, list):
                for item in value:
                    if hasattr(item, "__dict__"):
                        self._hoist_embedded_inputs(item, assignment_name)
            elif hasattr(value, "__dict__"):
                self._hoist_embedded_inputs(value, assignment_name)

    def _next_synthetic_input_name(self, assignment_name: str) -> str:
        suffix = len(
            [
                item
                for item in self.inputs
                if item.name == f"{assignment_name}__input"
                or item.name.startswith(f"{assignment_name}__input_")
            ]
        )
        if suffix == 0:
            return f"{assignment_name}__input"
        return f"{assignment_name}__input_{suffix + 1}"

    def _lower_strategy_call(self, call) -> StrategyMeta:
        args = list(getattr(call, "args", []))
        if not args:
            raise compile_error("missing_strategy_name", "strategy() name is required", call)

        title_arg = args[0]
        title = self._literal_value(title_arg.value, call)
        if not isinstance(title, str):
            raise compile_error("invalid_strategy_name", "strategy() title must be a string", call)

        named_args = {arg.name: arg.value for arg in args[1:] if arg.name}
        overlay = bool(self._optional_literal(named_args.pop("overlay", None), False))
        initial_capital = float(
            self._optional_literal(named_args.pop("initial_capital", None), 100000.0)
        )

        default_qty_type_expr = named_args.pop("default_qty_type", None)
        default_qty_type = "percent_of_equity"
        if default_qty_type_expr is not None:
            qty_type_path = self._expression_path(default_qty_type_expr)
            if not qty_type_path.startswith("strategy."):
                raise compile_error(
                    "unsupported_qty_type",
                    f"Unsupported default_qty_type: {qty_type_path}",
                    default_qty_type_expr,
                )
            default_qty_type = qty_type_path.removeprefix("strategy.")

        default_qty_value = float(
            self._optional_literal(named_args.pop("default_qty_value", None), 100.0)
        )

        additional_args = OrderedDict()
        for arg_name, arg_value in named_args.items():
            additional_args[arg_name] = self.lower_expression(arg_value)

        return StrategyMeta(
            name=title,
            scriptVersion=self.version,
            overlay=overlay,
            initialCapital=initial_capital,
            defaultQtyType=default_qty_type,
            defaultQtyValue=default_qty_value,
            additionalArgs=additional_args,
        )

    def _lower_input(self, statement) -> StrategyInput:
        name = self._require_name(statement.target, statement)
        call = statement.value
        return self._lower_input_from_call(name, call, statement)

    def _lower_input_from_call(self, name: str, call, error_node) -> StrategyInput:
        call_path = self._normalize_call_path(self._call_path(call.func))
        positional_args = [arg for arg in call.args if arg.name is None]
        named_args = {arg.name: arg.value for arg in call.args if arg.name is not None}

        input_type = self._resolve_input_type(call_path, positional_args, named_args, error_node)
        default_node = named_args.get("defval")
        if default_node is None and positional_args:
            default_node = positional_args[0].value
        if default_node is None:
            raise compile_error(
                "invalid_input",
                f"Input {name} is missing a default value",
                error_node,
            )

        default, default_expression = self._resolve_input_default(
            default_node,
            input_type,
            error_node,
        )
        title = None
        options = []
        title_node = named_args.get("title")
        if title_node is None and len(positional_args) > 1:
            title_node = positional_args[1].value
        if title_node is not None:
            title_value = self._try_literal_value(title_node)
            if isinstance(title_value, str):
                title = title_value

        options_node = named_args.get("options")
        if options_node is not None:
            options_value = self._literal_value(options_node, error_node)
            if isinstance(options_value, list):
                options = options_value

        return StrategyInput(
            name=name,
            type=input_type,
            default=default,
            defaultExpression=default_expression,
            title=title,
            options=options,
        )

    def _resolve_input_type(self, call_path, positional_args, named_args, statement) -> str:
        if call_path != "input":
            resolved = _INPUT_TYPE_ALIASES.get(call_path)
            if resolved:
                return resolved

        type_node = named_args.get("type")
        if type_node is not None:
            type_path = self._expression_path(type_node)
            resolved = _INPUT_TYPE_ALIASES.get(type_path)
            if resolved:
                return resolved
            raise compile_error(
                "unsupported_input_type",
                f"Unsupported input type: {type_path}",
                type_node,
            )

        defval_node = named_args.get("defval")
        if defval_node is None and positional_args:
            defval_node = positional_args[0].value

        inferred_type = self._infer_input_type(defval_node)
        if inferred_type:
            return inferred_type

        raise compile_error(
            "unsupported_input_type",
            f"Could not infer input type for {self._require_name(statement.target, statement)}",
            statement,
        )

    def _infer_input_type(self, node) -> str | None:
        if node is None:
            return None

        literal = self._try_literal_value(node)
        if isinstance(literal, bool):
            return "bool"
        if isinstance(literal, int) and not isinstance(literal, bool):
            return "int"
        if isinstance(literal, float):
            return "float"
        if isinstance(literal, str):
            return "string"

        node_type = type(node).__name__
        if node_type in {"Name", "Attribute", "Subscript"}:
            return "source"
        if (
            node_type == "Call"
            and self._normalize_call_path(self._call_path(node.func)) == "timestamp"
        ):
            return "time"
        return None

    def _resolve_input_default(
        self,
        node,
        input_type: str,
        error_node,
    ) -> tuple[object, IRExpression | None]:
        literal = self._try_literal_value(node)
        if literal is not None:
            return literal, None

        expression = self.lower_expression(node)
        if input_type == "source":
            return self._expression_path(node), expression
        if input_type in {"time", "timeframe"}:
            return render_expression(expression), expression
        raise compile_error("expected_literal", "Expected a literal value", error_node)

    def _lower_conditional_orders(
        self,
        if_node,
        inherited_when: IRExpression | None = None,
    ) -> None:
        active_when = self.lower_expression(if_node.test)
        if inherited_when is not None:
            active_when = IRExpression(
                kind="bool",
                op="and",
                values=[inherited_when, active_when],
            )

        for child in if_node.body:
            self._lower_conditional_child(child, active_when)

        if getattr(if_node, "orelse", None):
            negated = IRExpression(
                kind="unary",
                op="not",
                operand=self.lower_expression(if_node.test),
            )
            else_when = negated if inherited_when is None else IRExpression(
                kind="bool",
                op="and",
                values=[inherited_when, negated],
            )
            for child in if_node.orelse:
                self._lower_conditional_child(child, else_when)

    def _lower_conditional_child(self, child, when: IRExpression) -> None:
        Expr = self.api["Expr"]
        Call = self.api["Call"]

        if isinstance(child, Expr):
            if (
                isinstance(child.value, Call)
                and self._normalize_call_path(self._call_path(child.value.func))
                in _SUPPORTED_STRATEGY_CALLS
            ):
                self._append_order(child.value, when)
                return
            if type(child.value).__name__ == "If":
                self._lower_conditional_orders(child.value, when)
                return

        raise compile_error(
            "unsupported_if_body",
            "Only strategy.entry/close/exit calls are supported inside executable Pine if blocks",
            child,
        )

    def _append_order(self, call, when: IRExpression) -> None:
        call_path = self._normalize_call_path(self._call_path(call.func))
        args = list(call.args)
        if not args:
            raise compile_error(
                "invalid_order",
                f"{call_path} requires an order id argument",
                call,
            )

        order_id = self._literal_value(args[0].value, call)
        if not isinstance(order_id, str):
            raise compile_error("invalid_order_id", "Order id must be a string", call)

        order_when = when
        if call_path == "strategy.entry":
            if len(args) < 2:
                raise compile_error(
                    "invalid_strategy_entry",
                    "strategy.entry() requires a side argument",
                    call,
                )
            side = self._resolve_entry_side(args[1].value)
            quantity = None
            quantity_type = None
            for arg in args[2:]:
                if arg.name == "qty":
                    quantity = self.lower_expression(arg.value)
                    quantity_type = "qty"
                elif arg.name == "qty_percent":
                    quantity = self.lower_expression(arg.value)
                    quantity_type = "qty_percent"
                elif arg.name == "cash":
                    quantity = self.lower_expression(arg.value)
                    quantity_type = "cash"
                elif arg.name == "when":
                    order_when = self._combine_conditions(
                        order_when,
                        self.lower_expression(arg.value),
                    )
                elif arg.name is not None:
                    raise compile_error(
                        "unsupported_strategy_entry_arg",
                        f"Unsupported strategy.entry() argument: {arg.name}",
                        arg.value,
                    )

            self.orders.append(
                StrategyOrderAction(
                    kind="entry",
                    orderId=order_id,
                    side=side,
                    when=order_when,
                    quantity=quantity,
                    quantityType=quantity_type,
                )
            )
            return

        if call_path == "strategy.close":
            for arg in args[1:]:
                if arg.name == "when":
                    order_when = self._combine_conditions(
                        order_when,
                        self.lower_expression(arg.value),
                    )
                elif arg.name == "comment":
                    continue
                elif arg.name is not None:
                    raise compile_error(
                        "unsupported_strategy_close_arg",
                        f"Unsupported strategy.close() argument: {arg.name}",
                        arg.value,
                    )
            self.orders.append(
                StrategyOrderAction(
                    kind="close",
                    orderId=order_id,
                    when=order_when,
                )
            )
            return

        if call_path == "strategy.exit":
            quantity = None
            quantity_type = None
            for arg in args[1:]:
                if arg.name == "qty":
                    quantity = self.lower_expression(arg.value)
                    quantity_type = "qty"
                elif arg.name == "when":
                    order_when = self._combine_conditions(
                        order_when,
                        self.lower_expression(arg.value),
                    )
                elif arg.name in {"comment", "from_entry"}:
                    continue
                elif arg.name is not None:
                    raise compile_error(
                        "unsupported_strategy_exit_arg",
                        f"Unsupported strategy.exit() argument: {arg.name}",
                        arg.value,
                    )
            self.orders.append(
                StrategyOrderAction(
                    kind="exit",
                    orderId=order_id,
                    when=order_when,
                    quantity=quantity,
                    quantityType=quantity_type,
                )
            )
            return

        raise compile_error("unsupported_order_call", f"Unsupported order call: {call_path}", call)

    def lower_expression(self, node) -> IRExpression:
        Name = self.api["Name"]
        Constant = self.api["Constant"]
        Attribute = self.api["Attribute"]
        Call = self.api["Call"]
        BinOp = self.api["BinOp"]
        BoolOp = self.api["BoolOp"]
        Compare = self.api["Compare"]
        Conditional = self.api["Conditional"]
        Subscript = self.api["Subscript"]
        Tuple = self.api["Tuple"]
        UnaryOp = self.api["UnaryOp"]

        if isinstance(node, Constant):
            return IRExpression(kind="constant", value=node.value)

        if isinstance(node, Name):
            return IRExpression(kind="name", name=node.id)

        if isinstance(node, Attribute):
            return IRExpression(
                kind="attribute",
                base=self.lower_expression(node.value),
                attr=node.attr,
            )

        if isinstance(node, Subscript):
            return IRExpression(
                kind="subscript",
                base=self.lower_expression(node.value),
                index=self.lower_expression(node.slice),
            )

        if isinstance(node, Call):
            if id(node) in self._active_input_replacements:
                return IRExpression(
                    kind="name",
                    name=self._active_input_replacements[id(node)],
                )
            call_path = self._normalize_call_path(self._call_path(node.func))
            if call_path.startswith("request."):
                raise compile_error(
                    "unsupported_request_security",
                    "request.* functions are not supported in the deterministic compiler",
                    node,
                )
            if (
                call_path not in _SUPPORTED_EXPR_CALLS
                and call_path not in _SUPPORTED_PLOT_CALLS
                and call_path not in _PASSTHROUGH_CALLS
            ):
                raise compile_error(
                    "unsupported_call",
                    f"Unsupported Pine function: {call_path}",
                    node,
                )
            return IRExpression(
                kind="call",
                callee=self._path_expression(call_path),
                args=[
                    IRCallArg(
                        name=arg.name,
                        value=self.lower_expression(arg.value),
                    )
                    for arg in node.args
                ],
            )

        if isinstance(node, BinOp):
            op_name = type(node.op).__name__
            if op_name not in _BINARY_MAP:
                raise compile_error(
                    "unsupported_binary_operator",
                    f"Unsupported binary operator: {op_name}",
                    node,
                )
            return IRExpression(
                kind="binary",
                op=_BINARY_MAP[op_name],
                left=self.lower_expression(node.left),
                right=self.lower_expression(node.right),
            )

        if isinstance(node, BoolOp):
            op_name = type(node.op).__name__
            if op_name not in _BOOL_MAP:
                raise compile_error(
                    "unsupported_boolean_operator",
                    f"Unsupported boolean operator: {op_name}",
                    node,
                )
            return IRExpression(
                kind="bool",
                op=_BOOL_MAP[op_name],
                values=[self.lower_expression(value) for value in node.values],
            )

        if isinstance(node, Compare):
            ops = []
            for op in node.ops:
                op_name = type(op).__name__
                if op_name not in _COMPARISON_MAP:
                    raise compile_error(
                        "unsupported_comparison_operator",
                        f"Unsupported comparison operator: {op_name}",
                        node,
                    )
                ops.append(_COMPARISON_MAP[op_name])
            return IRExpression(
                kind="comparison",
                left=self.lower_expression(node.left),
                ops=ops,
                comparators=[self.lower_expression(comp) for comp in node.comparators],
            )

        if isinstance(node, Conditional):
            return IRExpression(
                kind="ternary",
                test=self.lower_expression(node.test),
                body=self.lower_expression(node.body),
                orelse=self.lower_expression(node.orelse),
            )

        if isinstance(node, Tuple) or type(node).__name__ == "List":
            return IRExpression(
                kind="tuple",
                elements=[self.lower_expression(element) for element in node.elts],
            )

        if isinstance(node, UnaryOp):
            op_name = type(node.op).__name__
            if op_name not in _UNARY_MAP:
                raise compile_error(
                    "unsupported_unary_operator",
                    f"Unsupported unary operator: {op_name}",
                    node,
                )
            return IRExpression(
                kind="unary",
                op=_UNARY_MAP[op_name],
                operand=self.lower_expression(node.operand),
            )

        raise compile_error(
            "unsupported_expression",
            f"Unsupported Pine expression: {type(node).__name__}",
            node,
        )

    def _expression_path(self, node) -> str:
        if type(node).__name__ == "Name":
            return node.id
        if type(node).__name__ == "Attribute":
            return f"{self._expression_path(node.value)}.{node.attr}"
        return self.unparse(node).strip()

    def _call_path(self, func) -> str:
        return self._expression_path(func)

    def _literal_value(self, node, error_node=None):
        expr = self.lower_expression(node)
        if expr.kind == "constant":
            return expr.value
        if expr.kind == "name" and expr.name in self.literal_bindings:
            return self.literal_bindings[expr.name]
        if expr.kind == "tuple":
            return [self._literal_from_ir(item, error_node or node) for item in expr.elements]
        raise compile_error(
            "expected_literal",
            "Expected a literal value",
            error_node or node,
        )

    def _literal_from_ir(self, expr: IRExpression, error_node=None):
        if expr.kind == "constant":
            return expr.value
        if expr.kind == "name" and expr.name in self.literal_bindings:
            return self.literal_bindings[expr.name]
        if expr.kind == "tuple":
            return [self._literal_from_ir(item, error_node) for item in expr.elements]
        raise compile_error("expected_literal", "Expected a literal value", error_node)

    def _try_literal_value(self, node):
        try:
            return self._literal_value(node)
        except StrategyCompileError:
            return None

    def _optional_literal(self, node, default):
        if node is None:
            return default
        return self._literal_value(node)

    def _require_name(self, node, error_node=None) -> str:
        if type(node).__name__ != "Name":
            raise compile_error("expected_name", "Expected a variable name", error_node or node)
        return node.id

    def _resolve_entry_side(self, node) -> str:
        if type(node).__name__ == "Constant":
            if node.value is True:
                return "long"
            if node.value is False:
                return "short"
        path = self._expression_path(node)
        if path == "strategy.long":
            return "long"
        if path == "strategy.short":
            return "short"
        raise compile_error("unsupported_entry_side", f"Unsupported entry side: {path}", node)

    def _extract_version(self, source: str) -> int:
        match = _SCRIPT_VERSION_RE.search(source)
        return int(match.group(1)) if match else 5

    def _true_expression(self) -> IRExpression:
        return IRExpression(kind="constant", value=True)

    def _combine_conditions(
        self,
        inherited: IRExpression | None,
        extra: IRExpression | None,
    ) -> IRExpression:
        if inherited is None:
            return extra or self._true_expression()
        if extra is None:
            return inherited
        return IRExpression(kind="bool", op="and", values=[inherited, extra])

    def _is_passthrough_if(self, if_node) -> bool:
        rendered = self.unparse(if_node).strip()
        return "table.cell(" in rendered or "barstate." in rendered

    def _normalize_call_path(self, call_path: str) -> str:
        return _CALL_ALIASES.get(call_path, call_path)

    def _path_expression(self, call_path: str) -> IRExpression:
        parts = call_path.split(".")
        expression = IRExpression(kind="name", name=parts[0])
        for part in parts[1:]:
            expression = IRExpression(kind="attribute", base=expression, attr=part)
        return expression


def render_strategy_ir_to_pine(strategy_ir: StrategyIR) -> str:
    lines: list[str] = [f"//@version={strategy_ir.meta.scriptVersion}"]
    lines.append(_render_strategy_call(strategy_ir.meta))

    if strategy_ir.inputs:
        lines.append("")
        for input_def in strategy_ir.inputs:
            lines.append(_render_input(input_def))

    if strategy_ir.indicators:
        lines.append("")
        for calculation in strategy_ir.indicators:
            lines.append(_render_calculation(calculation))

    if strategy_ir.orders:
        lines.append("")
        for order in strategy_ir.orders:
            risk_gates = strategy_ir.risk.gates if order.kind == "entry" else []
            lines.extend(_render_order(order, risk_gates))

    if strategy_ir.plots:
        lines.append("")
        for plot in strategy_ir.plots:
            lines.append(render_expression(plot.call))

    if strategy_ir.passthroughPine:
        lines.append("")
        lines.extend(strategy_ir.passthroughPine)

    return "\n".join(lines).rstrip() + "\n"


def render_expression(expression: IRExpression) -> str:
    if expression.kind == "constant":
        return _render_constant(expression.value)

    if expression.kind == "name":
        return expression.name or ""

    if expression.kind == "attribute":
        return f"{render_expression(expression.base)}.{expression.attr}"

    if expression.kind == "subscript":
        return f"{render_expression(expression.base)}[{render_expression(expression.index)}]"

    if expression.kind == "call":
        args = []
        for arg in expression.args:
            rendered = render_expression(arg.value)
            if arg.name:
                rendered = f"{arg.name}={rendered}"
            args.append(rendered)
        return f"{render_expression(expression.callee)}({', '.join(args)})"

    if expression.kind == "binary":
        return f"{_wrap(expression.left)} {expression.op} {_wrap(expression.right)}"

    if expression.kind == "comparison":
        parts = [render_expression(expression.left)]
        for op, comparator in zip(expression.ops, expression.comparators):
            parts.append(op)
            parts.append(render_expression(comparator))
        return " ".join(parts)

    if expression.kind == "bool":
        separator = f" {expression.op} "
        return separator.join(_wrap(value) for value in expression.values)

    if expression.kind == "ternary":
        return (
            f"{render_expression(expression.test)} ? "
            f"{render_expression(expression.body)} : {render_expression(expression.orelse)}"
        )

    if expression.kind == "tuple":
        return "[" + ", ".join(render_expression(element) for element in expression.elements) + "]"

    if expression.kind == "unary":
        operand = render_expression(expression.operand)
        if expression.op == "not":
            return f"not {operand}"
        return f"{expression.op}{operand}"

    raise ValueError(f"Unsupported IR expression kind: {expression.kind}")


def _render_strategy_call(meta: StrategyMeta) -> str:
    args = [render_expression(IRExpression(kind="constant", value=meta.name))]
    args.append(f"overlay={_render_constant(meta.overlay)}")
    args.append(f"initial_capital={_render_constant(meta.initialCapital)}")
    args.append(f"default_qty_type=strategy.{meta.defaultQtyType}")
    args.append(f"default_qty_value={_render_constant(meta.defaultQtyValue)}")
    for key, value in sorted(meta.additionalArgs.items()):
        args.append(f"{key}={render_expression(value)}")
    return f"strategy({', '.join(args)})"


def _render_input(input_def: StrategyInput) -> str:
    default_value = (
        render_expression(input_def.defaultExpression)
        if input_def.defaultExpression is not None
        else _render_constant(input_def.default)
    )
    args = [default_value]
    if input_def.title:
        args.append(_render_constant(input_def.title))
    if input_def.options:
        args.append(f"options={_render_constant(input_def.options)}")
    return f"{input_def.name} = input.{input_def.type}({', '.join(args)})"


def _render_calculation(calculation: StrategyCalculation) -> str:
    expression = render_expression(calculation.expression)
    if calculation.kind == "persistent_assign":
        type_hint = f"{calculation.typeHint} " if calculation.typeHint else ""
        return f"var {type_hint}{calculation.name} = {expression}"
    if calculation.kind == "reassign":
        return f"{calculation.name} := {expression}"
    return f"{calculation.name} = {expression}"


def _render_order(order: StrategyOrderAction, risk_gates: list[IRExpression]) -> list[str]:
    when = order.when
    if risk_gates:
        when = IRExpression(kind="bool", op="and", values=[when, *risk_gates])
    call = _render_order_call(order)
    if _is_true_constant(when):
        return [call]
    return [f"if {render_expression(when)}", f"    {call}"]


def _render_order_call(order: StrategyOrderAction) -> str:
    if order.kind == "entry":
        args = [
            _render_constant(order.orderId),
            f"strategy.{order.side}",
        ]
        if order.quantity is not None and order.quantityType is not None:
            args.append(f"{order.quantityType}={render_expression(order.quantity)}")
        return f"strategy.entry({', '.join(args)})"

    if order.kind == "close":
        return f"strategy.close({_render_constant(order.orderId)})"

    args = [_render_constant(order.orderId)]
    if order.quantity is not None and order.quantityType is not None:
        args.append(f"{order.quantityType}={render_expression(order.quantity)}")
    return f"strategy.exit({', '.join(args)})"


def _render_constant(value) -> str:
    if value is None:
        return "na"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(value, list):
        return "[" + ", ".join(_render_constant(item) for item in value) + "]"
    if isinstance(value, float):
        return format(value, "g")
    return str(value)


def _wrap(expression: IRExpression) -> str:
    if expression.kind in {"constant", "name", "attribute", "subscript", "call"}:
        return render_expression(expression)
    return f"({render_expression(expression)})"


def _is_true_constant(expression: IRExpression) -> bool:
    return expression.kind == "constant" and expression.value is True


def _unique_expressions(expressions: list[IRExpression]) -> list[IRExpression]:
    unique: OrderedDict[str, IRExpression] = OrderedDict()
    for expression in expressions:
        unique.setdefault(render_expression(expression), expression)
    return list(unique.values())
