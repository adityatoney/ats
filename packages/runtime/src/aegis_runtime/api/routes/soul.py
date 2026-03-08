import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from aegis_runtime.soul.generator import SoulGenerator

logger = logging.getLogger(__name__)
router = APIRouter()

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


class GenerateSoulRequest(BaseModel):
    runId: str
    agentId: str


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
                timeout=30.0,
            )
    except Exception as e:
        logger.error(f"Failed to send event {event_type} for run {run_id}: {e}")


async def generate_soul_task(request: GenerateSoulRequest):
    try:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        generator = SoulGenerator(api_key)

        # Fetch run data from Node
        async with httpx.AsyncClient() as client:
            run_resp = await client.get(
                f"{NODE_SERVER_URL}/api/runs/{request.runId}",
                timeout=10.0,
            )
            run_data = run_resp.json().get("data", {})

            orders_resp = await client.get(
                f"{NODE_SERVER_URL}/api/runs/{request.runId}/orders",
                timeout=10.0,
            )
            orders_data = orders_resp.json().get("data", [])

            portfolio_resp = await client.get(
                f"{NODE_SERVER_URL}/api/runs/{request.runId}/portfolio",
                timeout=10.0,
            )
            portfolio_data = portfolio_resp.json().get("data", [])

        run_summary = {
            "runId": request.runId,
            "metrics": run_data.get("metricsJson", {}),
            "config": run_data.get("configJson", {}),
            "totalTrades": len(orders_data),
            "orders": orders_data[:20],
            "portfolioSnapshots": portfolio_data[-10:] if portfolio_data else [],
        }

        artifacts = await generator.generate(run_summary)

        await send_event(request.runId, "soul.generated", {
            "soulMd": artifacts.soul_md,
            "soulJson": artifacts.soul_json,
        })

    except Exception as e:
        logger.exception(f"Soul generation failed for run {request.runId}")
        await send_event(request.runId, "run.failed", {
            "error": f"Soul generation failed: {e}",
        })


@router.post("/generate")
async def generate_soul(request: GenerateSoulRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(generate_soul_task, request)
    return {"status": "generating", "runId": request.runId}
