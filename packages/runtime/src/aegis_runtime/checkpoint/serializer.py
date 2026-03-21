from typing import Any

import polars as pl

from aegis_runtime.simulator.engine import Engine, EngineConfig


class CheckpointCorruptError(Exception):
    pass


class EngineStateSerializer:
    @staticmethod
    def serialize(engine: Engine) -> dict[str, Any]:
        return engine.get_state()

    @staticmethod
    def deserialize(
        state: dict[str, Any],
        data: dict[str, pl.DataFrame],
        strategy: Any | None = None,
        run_id: str = "",
        event_callback: Any | None = None,
    ) -> Engine:
        if "version" not in state:
            raise CheckpointCorruptError("Missing version in checkpoint state")

        if state["version"] != 1:
            raise CheckpointCorruptError(f"Unknown checkpoint version: {state['version']}")

        if "portfolio" not in state or "bar_index" not in state:
            raise CheckpointCorruptError("Missing required fields in checkpoint state")

        config_data = state.get("config", {})
        config = EngineConfig(
            initial_capital=config_data.get("initial_capital", 100000),
            slippage_bps=config_data.get("slippage_bps", 5),
            fee_per_share=config_data.get("fee_per_share", 0.01),
            fee_percentage=config_data.get("fee_percentage", 0),
            seed=config_data.get("seed", 42),
            checkpoint_interval=config_data.get("checkpoint_interval", 50),
        )

        return Engine.from_state(
            state=state,
            config=config,
            data=data,
            strategy=strategy,
            run_id=run_id,
            event_callback=event_callback,
        )
