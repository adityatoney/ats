from __future__ import annotations

import base64
import json
import re

from aegis_runtime.strategy.diagnostics import StrategyCompileError
from aegis_runtime.strategy.ir import StrategyIR
from aegis_runtime.strategy.pine_compiler import render_strategy_ir_to_pine

_PAYLOAD_RE = re.compile(r"^# strategy_ir_base64:\s*(?P<payload>[A-Za-z0-9+/=]+)\s*$", re.MULTILINE)


def extract_ir_from_generated_python(source: str) -> StrategyIR:
    match = _PAYLOAD_RE.search(source)
    if not match:
        raise StrategyCompileError(
            "Python source is not round-trippable because it does not contain "
            "deterministic IR metadata"
        )

    payload = match.group("payload")
    try:
        decoded = base64.b64decode(payload).decode("utf-8")
        data = json.loads(decoded)
    except Exception as exc:
        raise StrategyCompileError(
            "Failed to decode deterministic strategy metadata from Python source"
        ) from exc

    return StrategyIR.model_validate(data)


def render_pine_from_generated_python(source: str) -> str:
    strategy_ir = extract_ir_from_generated_python(source)
    return render_strategy_ir_to_pine(strategy_ir)
