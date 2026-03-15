import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from aegis_runtime.checkpoint.manager import CheckpointManager
from aegis_runtime.data.data_loader import DataLoader
from aegis_runtime.simulator.engine import Engine, EngineConfig
from aegis_runtime.strategy.loader import StrategyLoader
from aegis_runtime.strategy.parser import StrategyMarkdownParser

logger = logging.getLogger(__name__)
router = APIRouter()

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")

# In-memory engine registry for pause/cancel signaling
engine_registry: dict[str, Engine] = {}


class StartRunRequest(BaseModel):
    runId: str
    agentId: str
    strategyMd: str
    strategyPy: str | None = None
    config: dict[str, Any]


class StartBranchRequest(BaseModel):
    runId: str
    parentCheckpointId: str
    parentRunId: str
    overrides: dict[str, Any]
    strategyMd: str
    strategyPy: str | None = None
    config: dict[str, Any]


async def send_event(run_id: str, event_type: str, payload: dict[str, Any]):
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{NODE_SERVER_URL}/api/webhooks/runtime-event",
                json={
                    "runId": run_id,
                    "eventType": event_type,
                    "payload": payload,
                },
                timeout=10.0,
            )
    except Exception as e:
        logger.error(f"Failed to send event {event_type} for run {run_id}: {e}")


async def run_backtest(request: StartRunRequest):
    run_id = request.runId
    config = request.config

    try:
        await send_event(run_id, "run.started", {})

        # Parse strategy
        parsed = StrategyMarkdownParser.parse(request.strategyMd)

        # Load strategy module
        strategy = None
        if request.strategyPy:
            strategy = StrategyLoader.load_from_python(request.strategyPy)

        # Load market data
        symbols = config.get("symbols", ["AAPL"])
        start_date = config.get("startDate", "2022-01-01")
        end_date = config.get("endDate", "2023-01-01")
        timeframe = config.get("timeframe", "1Day")

        loader = DataLoader()
        data = loader.load(symbols, start_date, end_date, timeframe)

        # Create engine
        engine_config = EngineConfig(
            initial_capital=config.get("initialCapital", 100000),
            slippage_bps=config.get("slippageBps", 0),
            fee_per_share=config.get("feePerShare", 0),
            fee_percentage=config.get("feePercentage", 0),
            seed=config.get("seed", 42),
            checkpoint_interval=config.get("checkpointInterval", 50),
        )

        engine = Engine(
            config=engine_config,
            data=data,
            strategy=strategy,
            parsed_strategy=parsed,
            run_id=run_id,
            event_callback=send_event,
        )
        engine_registry[run_id] = engine

        result = await engine.run(run_id)

        await send_event(run_id, "run.completed", {
            "metrics": result.metrics,
            "processedBars": result.processed_bars,
            "totalBars": result.total_bars,
        })

    except Exception as e:
        logger.exception(f"Run {run_id} failed")
        await send_event(run_id, "run.failed", {"error": str(e)})
    finally:
        engine_registry.pop(run_id, None)


async def run_branch(request: StartBranchRequest):
    run_id = request.runId

    try:
        await send_event(run_id, "run.started", {})

        parsed = StrategyMarkdownParser.parse(request.strategyMd)
        strategy = None
        if request.strategyPy:
            strategy = StrategyLoader.load_from_python(request.strategyPy)

        config = request.config
        symbols = config.get("symbols", ["AAPL"])
        start_date = config.get("startDate", "2022-01-01")
        end_date = config.get("endDate", "2023-01-01")
        timeframe = config.get("timeframe", "1Day")

        loader = DataLoader()
        data = loader.load(symbols, start_date, end_date, timeframe)

        # Load checkpoint
        checkpoint_mgr = CheckpointManager()
        state = checkpoint_mgr.load_checkpoint(request.parentCheckpointId)

        engine_config = EngineConfig(
            initial_capital=config.get("initialCapital", 100000),
            slippage_bps=config.get("slippageBps", 0),
            fee_per_share=config.get("feePerShare", 0),
            fee_percentage=config.get("feePercentage", 0),
            seed=config.get("seed", 42),
            checkpoint_interval=config.get("checkpointInterval", 50),
        )

        engine = Engine.from_state(
            state=state,
            config=engine_config,
            data=data,
            strategy=strategy,
            parsed_strategy=parsed,
            run_id=run_id,
            event_callback=send_event,
        )

        if request.overrides:
            engine.apply_overrides(request.overrides)

        engine_registry[run_id] = engine
        result = await engine.run(run_id, from_bar=state["bar_index"] + 1)

        # Compute delta
        from aegis_runtime.branch.delta import DeltaComputer

        delta = await DeltaComputer.compute_delta(request.parentRunId, run_id)

        await send_event(run_id, "run.completed", {
            "metrics": result.metrics,
            "processedBars": result.processed_bars,
            "totalBars": result.total_bars,
        })

        await send_event(run_id, "branch.completed", {
            "resultDelta": delta,
        })

    except Exception as e:
        logger.exception(f"Branch run {run_id} failed")
        await send_event(run_id, "run.failed", {"error": str(e)})
    finally:
        engine_registry.pop(run_id, None)


@router.post("/start")
async def start_run(request: StartRunRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_backtest, request)
    return {"status": "started", "runId": request.runId}


@router.post("/{run_id}/pause")
async def pause_run(run_id: str):
    engine = engine_registry.get(run_id)
    if not engine:
        return {"status": "not_found"}
    engine.pause()
    return {"status": "paused"}


@router.post("/{run_id}/resume")
async def resume_run(run_id: str, background_tasks: BackgroundTasks):
    engine = engine_registry.get(run_id)
    if engine:
        background_tasks.add_task(engine.resume_run)
        return {"status": "resuming"}
    return {"status": "not_found"}


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str):
    engine = engine_registry.get(run_id)
    if not engine:
        return {"status": "not_found"}
    engine.cancel()
    return {"status": "cancelled"}


@router.post("/start-branch")
async def start_branch_run(request: StartBranchRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_branch, request)
    return {"status": "started", "runId": request.runId}
