import asyncio
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

logger = logging.getLogger(__name__)
router = APIRouter()

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")

# In-memory engine registry for pause/cancel signaling
engine_registry: dict[str, Engine] = {}

# Terminal events that must be flushed immediately
_TERMINAL_EVENTS = {"run.completed", "run.failed", "run.cancelled"}


class EventSender:
    """Batches runtime events and sends them to the Node server in bulk.

    Non-terminal events are queued and flushed in batches (up to 50 events
    or every 100ms). Terminal events trigger an immediate flush and block
    until delivery is confirmed.
    """

    def __init__(self, node_url: str):
        self._node_url = node_url
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task[None] | None = None
        self._drain_event = asyncio.Event()

    async def _ensure_started(self):
        if self._task is None or self._task.done():
            self._client = httpx.AsyncClient(timeout=10.0)
            self._task = asyncio.create_task(self._flush_loop())

    async def send(self, run_id: str, event_type: str, payload: dict[str, Any]):
        """Enqueue an event. Non-blocking for normal events, blocks for terminal events."""
        await self._ensure_started()
        self._queue.put_nowait({
            "runId": run_id,
            "eventType": event_type,
            "payload": payload,
        })

        if event_type in _TERMINAL_EVENTS:
            await self.flush()

    async def flush(self):
        """Drain the queue and send all remaining events."""
        await self._ensure_started()
        # Give the flush loop a moment to pick up events
        await asyncio.sleep(0)
        # Drain anything still in the queue
        batch: list[dict[str, Any]] = []
        while not self._queue.empty():
            try:
                batch.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        if batch:
            await self._send_batch(batch)

    async def _flush_loop(self):
        while True:
            batch: list[dict[str, Any]] = []
            try:
                # Wait for at least one event
                first = await asyncio.wait_for(self._queue.get(), timeout=0.1)
                batch.append(first)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                return

            # Drain up to 49 more events without waiting
            while len(batch) < 50:
                try:
                    batch.append(self._queue.get_nowait())
                except asyncio.QueueEmpty:
                    break

            await self._send_batch(batch)

    async def _send_batch(self, batch: list[dict[str, Any]]):
        if not batch:
            return
        try:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=10.0)
            await self._client.post(
                f"{self._node_url}/api/webhooks/runtime-events-batch",
                json={"events": batch},
            )
        except Exception as e:
            logger.error(f"Batch send failed ({len(batch)} events): {e}")


# Module-level singleton
event_sender = EventSender(NODE_SERVER_URL)


class StartRunRequest(BaseModel):
    runId: str
    agentId: str
    sourceKind: str
    strategyPy: str
    strategyIrJson: dict[str, Any] | None = None
    config: dict[str, Any]


class StartBranchRequest(BaseModel):
    runId: str
    parentCheckpointId: str
    parentRunId: str
    overrides: dict[str, Any]
    sourceKind: str
    strategyPy: str
    strategyIrJson: dict[str, Any] | None = None
    config: dict[str, Any]


async def run_backtest(request: StartRunRequest):
    run_id = request.runId
    config = request.config

    try:
        await event_sender.send(run_id, "run.started", {})

        # Load strategy module
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
            run_id=run_id,
            event_callback=event_sender.send,
        )
        engine_registry[run_id] = engine

        result = await engine.run(run_id)

        await event_sender.send(run_id, "run.completed", {
            "metrics": result.metrics,
            "processedBars": result.processed_bars,
            "totalBars": result.total_bars,
        })

    except Exception as e:
        logger.exception(f"Run {run_id} failed")
        await event_sender.send(run_id, "run.failed", {"error": str(e)})
    finally:
        engine_registry.pop(run_id, None)
        await event_sender.flush()


async def run_branch(request: StartBranchRequest):
    run_id = request.runId

    try:
        await event_sender.send(run_id, "run.started", {})

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
            run_id=run_id,
            event_callback=event_sender.send,
        )

        if request.overrides:
            engine.apply_overrides(request.overrides)

        engine_registry[run_id] = engine
        result = await engine.run(run_id, from_bar=state["bar_index"] + 1)

        # Compute delta
        from aegis_runtime.branch.delta import DeltaComputer

        delta = await DeltaComputer.compute_delta(request.parentRunId, run_id)

        await event_sender.send(run_id, "run.completed", {
            "metrics": result.metrics,
            "processedBars": result.processed_bars,
            "totalBars": result.total_bars,
        })

        await event_sender.send(run_id, "branch.completed", {
            "resultDelta": delta,
        })

    except Exception as e:
        logger.exception(f"Branch run {run_id} failed")
        await event_sender.send(run_id, "run.failed", {"error": str(e)})
    finally:
        engine_registry.pop(run_id, None)
        await event_sender.flush()


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
