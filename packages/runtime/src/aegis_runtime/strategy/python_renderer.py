from __future__ import annotations

import base64
import hashlib
import json

from aegis_runtime.strategy.ir import StrategyIR


def render_python_from_ir(strategy_ir: StrategyIR) -> tuple[str, str]:
    canonical_json = json.dumps(
        strategy_ir.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    payload = base64.b64encode(canonical_json.encode("utf-8")).decode("utf-8")
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    source = f"""# generated_by: aegis_ir_v1
# strategy_ir_sha256: {digest}
# strategy_ir_base64: {payload}

import base64
import json

from aegis_runtime.strategy.runtime_support import DeterministicStrategyRuntime

_STRATEGY_IR_JSON = base64.b64decode("{payload}").decode("utf-8")
STRATEGY_IR = json.loads(_STRATEGY_IR_JSON)
_RUNTIME = DeterministicStrategyRuntime(STRATEGY_IR)


def prepare_features(df):
    return _RUNTIME.prepare_features(df)


def generate_signal(state, portfolio):
    return _RUNTIME.generate_signal(state, portfolio)


def size_position(portfolio, signal):
    return _RUNTIME.size_position(portfolio, signal)


def risk_gate(order, portfolio, market):
    return _RUNTIME.risk_gate(order, portfolio, market)


def get_runtime_state():
    return _RUNTIME.export_state()


def set_runtime_state(state):
    _RUNTIME.import_state(state)
"""

    return source, digest
