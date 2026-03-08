import types
from typing import Any

from aegis_runtime.strategy.validator import StrategyValidator


class StrategyLoadError(Exception):
    pass


class StrategyModuleAdapter:
    def __init__(self, module: types.ModuleType):
        self._module = module

    def prepare_features(self, df: Any) -> Any:
        if hasattr(self._module, "prepare_features"):
            return self._module.prepare_features(df)
        return df

    def generate_signal(self, state: Any, portfolio: Any) -> Any:
        if not hasattr(self._module, "generate_signal"):
            raise StrategyLoadError("Strategy must define generate_signal()")
        return self._module.generate_signal(state, portfolio)

    def size_position(self, portfolio: Any, signal: Any) -> Any:
        if hasattr(self._module, "size_position"):
            return self._module.size_position(portfolio, signal)
        return {"quantity": 0}

    def risk_gate(self, order: Any, portfolio: Any, market: Any) -> Any:
        if hasattr(self._module, "risk_gate"):
            return self._module.risk_gate(order, portfolio, market)
        return {"approved": True, "reason": ""}


class StrategyLoader:
    @staticmethod
    def load_from_python(source: str) -> StrategyModuleAdapter:
        # Validate first
        StrategyValidator.validate(source)

        # Create isolated module
        module = types.ModuleType("strategy_module")
        module.__dict__["__builtins__"] = __builtins__

        try:
            exec(source, module.__dict__)
        except Exception as e:
            raise StrategyLoadError(f"Failed to execute strategy code: {e}")

        # Verify required function exists
        if not hasattr(module, "generate_signal"):
            raise StrategyLoadError(
                "Strategy must define generate_signal(state, portfolio)"
            )

        return StrategyModuleAdapter(module)
