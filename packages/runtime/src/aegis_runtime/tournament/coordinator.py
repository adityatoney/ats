import asyncio
import logging
from typing import Any

from aegis_runtime.simulator.engine import Engine, EngineConfig
from aegis_runtime.strategy.loader import StrategyLoader

logger = logging.getLogger(__name__)


class TournamentCoordinator:
    def __init__(self, event_callback):
        self.event_callback = event_callback

    async def run_tournament(
        self,
        tournament_id: str,
        runs_config: list[dict[str, Any]],
        shared_data,
    ) -> dict[str, Any]:
        """Run all tournament engines concurrently using asyncio.gather."""

        tasks = []
        for run_cfg in runs_config:
            task = self._run_single(run_cfg, shared_data)
            tasks.append(task)

        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary = {
            "tournament_id": tournament_id,
            "total": len(runs_config),
            "completed": 0,
            "failed": 0,
            "errors": [],
        }

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                summary["failed"] += 1
                summary["errors"].append({
                    "runId": runs_config[i]["runId"],
                    "error": str(result),
                })
            else:
                summary["completed"] += 1

        return summary

    async def _run_single(self, run_cfg: dict[str, Any], shared_data) -> dict[str, Any]:
        """Run a single agent's backtest within the tournament."""
        run_id = run_cfg["runId"]
        config = run_cfg["config"]

        try:
            await self.event_callback(run_id, "run.started", {})

            # Load strategy module
            strategy = StrategyLoader.load_from_python(run_cfg["strategyPy"])

            # Create engine config
            engine_config = EngineConfig(
                initial_capital=config.get("initialCapital", 100000),
                slippage_bps=config.get("slippageBps", 0),
                fee_per_share=config.get("feePerShare", 0),
                fee_percentage=config.get("feePercentage", 0),
                seed=config.get("seed", 42),
                checkpoint_interval=config.get("checkpointInterval", 50),
            )

            # Each engine gets its own copy of the shared data
            # (Polars DataFrames are immutable, but prepare_features creates a copy)
            engine = Engine(
                config=engine_config,
                data=shared_data,
                strategy=strategy,
                run_id=run_id,
                event_callback=self.event_callback,
            )

            result = await engine.run(run_id)

            await self.event_callback(run_id, "run.completed", {
                "metrics": result.metrics,
                "processedBars": result.processed_bars,
                "totalBars": result.total_bars,
            })

            return {"runId": run_id, "metrics": result.metrics}

        except Exception as e:
            logger.exception(f"Tournament run {run_id} failed")
            await self.event_callback(run_id, "run.failed", {"error": str(e)})
            raise
