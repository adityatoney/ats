import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from aegis_runtime.data.data_loader import DataLoader
from aegis_runtime.tournament.coordinator import TournamentCoordinator

logger = logging.getLogger(__name__)
router = APIRouter()
data_router = APIRouter()

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


class RunConfig(BaseModel):
    runId: str
    agentId: str
    strategyMd: str
    strategyPy: str | None = None
    config: dict[str, Any]


class StartTournamentRequest(BaseModel):
    tournamentId: str
    runs: list[RunConfig]
    dataSnapshotId: str


class PrefetchDataRequest(BaseModel):
    symbols: list[str]
    startDate: str
    endDate: str
    timeframe: str = "1Day"


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


async def run_tournament_task(request: StartTournamentRequest):
    try:
        # Load data once for all agents
        config = request.runs[0].config if request.runs else {}
        symbols = config.get("symbols", ["AAPL"])
        start_date = config.get("startDate", "2022-01-01")
        end_date = config.get("endDate", "2023-01-01")
        timeframe = config.get("timeframe", "1Day")

        loader = DataLoader()
        shared_data = loader.load(symbols, start_date, end_date, timeframe)

        coordinator = TournamentCoordinator(event_callback=send_event)
        runs_config = [r.model_dump() for r in request.runs]

        await coordinator.run_tournament(
            tournament_id=request.tournamentId,
            runs_config=runs_config,
            shared_data=shared_data,
        )

    except Exception as e:
        logger.exception(f"Tournament {request.tournamentId} failed: {e}")


@router.post("/start")
async def start_tournament(request: StartTournamentRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_tournament_task, request)
    return {"status": "started", "tournamentId": request.tournamentId}


@data_router.post("/prefetch")
async def prefetch_data(request: PrefetchDataRequest):
    loader = DataLoader()
    data = loader.load(
        request.symbols,
        request.startDate,
        request.endDate,
        request.timeframe,
    )

    bar_counts = {}
    for symbol in request.symbols:
        if symbol in data:
            bar_counts[symbol] = len(data[symbol])
        else:
            bar_counts[symbol] = 0

    snapshot_id = f"{'-'.join(request.symbols)}_{request.startDate}_{request.endDate}_{request.timeframe}"

    return {
        "dataSnapshotId": snapshot_id,
        "barCounts": bar_counts,
    }
