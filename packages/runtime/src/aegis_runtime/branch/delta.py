import logging
import os

import httpx

logger = logging.getLogger(__name__)

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


class DeltaComputer:
    @staticmethod
    async def compute_delta(parent_run_id: str, branch_run_id: str) -> dict[str, float]:
        """Compute the delta between two runs' metrics via the Node.js API."""
        async with httpx.AsyncClient(timeout=10) as client:
            parent_resp = await client.get(f"{NODE_SERVER_URL}/api/runs/{parent_run_id}")
            branch_resp = await client.get(f"{NODE_SERVER_URL}/api/runs/{branch_run_id}")

        parent_metrics = {}
        branch_metrics = {}

        if parent_resp.status_code == 200:
            parent_data = parent_resp.json().get("data", {})
            parent_metrics = parent_data.get("metricsJson") or {}

        if branch_resp.status_code == 200:
            branch_data = branch_resp.json().get("data", {})
            branch_metrics = branch_data.get("metricsJson") or {}

        def delta(key: str) -> float:
            return round(
                float(branch_metrics.get(key, 0)) - float(parent_metrics.get(key, 0)), 8
            )

        return {
            "totalReturnDelta": delta("totalReturn"),
            "sharpeDelta": delta("sharpeRatio"),
            "maxDrawdownDelta": delta("maxDrawdown"),
            "winRateDelta": delta("winRate"),
            "profitFactorDelta": delta("profitFactor"),
        }
