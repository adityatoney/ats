import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:3001")


class RunRepository:
    @staticmethod
    def get_run(run_id: str) -> dict[str, Any] | None:
        """Fetch a run by ID from the Node.js API."""
        try:
            response = httpx.get(f"{NODE_API_URL}/api/runs/{run_id}", timeout=10)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()
            result = data.get("data")
            if result:
                # Map Convex _id to id for backward compatibility
                result["id"] = result.get("_id", result.get("id"))
            return result
        except httpx.HTTPError as e:
            logger.error(f"Failed to fetch run {run_id}: {e}")
            return None

    @staticmethod
    def update_run(run_id: str, **kwargs: Any) -> None:
        """Update a run via the Node.js API."""
        if not kwargs:
            return
        try:
            response = httpx.patch(
                f"{NODE_API_URL}/api/runs/{run_id}",
                json=kwargs,
                timeout=10,
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.error(f"Failed to update run {run_id}: {e}")
            raise


class OrderRepository:
    @staticmethod
    def insert_order(run_id: str, order: dict[str, Any]) -> str:
        """Insert an order via the webhook endpoint.

        Note: Orders are now primarily inserted via the webhook
        'order.submitted' event. This method sends that event.
        """
        try:
            response = httpx.post(
                f"{NODE_API_URL}/api/webhooks/runtime-event",
                json={
                    "runId": run_id,
                    "eventType": "order.submitted",
                    "payload": {
                        "symbol": order["symbol"],
                        "side": order["side"],
                        "order_type": order["order_type"],
                        "quantity": order["quantity"],
                        "bar_index": order["bar_index"],
                        "limit_price": order.get("limit_price"),
                        "stop_price": order.get("stop_price"),
                    },
                },
                timeout=10,
            )
            response.raise_for_status()
            # Return a placeholder ID since Convex IDs are generated server-side
            return "pending"
        except httpx.HTTPError as e:
            logger.error(f"Failed to insert order for run {run_id}: {e}")
            raise


class PortfolioSnapshotRepository:
    @staticmethod
    def insert_snapshot(run_id: str, snapshot: dict[str, Any]) -> None:
        """Insert a portfolio snapshot via the webhook endpoint.

        Note: Snapshots are now primarily inserted via the webhook
        'run.progress' event. This method sends that event.
        """
        try:
            response = httpx.post(
                f"{NODE_API_URL}/api/webhooks/runtime-event",
                json={
                    "runId": run_id,
                    "eventType": "run.progress",
                    "payload": {
                        "barIndex": snapshot["bar_index"],
                        "cash": snapshot["cash"],
                        "equity": snapshot["equity"],
                        "positionsJson": snapshot.get("positions_json", {}),
                        "drawdown": snapshot["drawdown"],
                        "highWaterMark": snapshot["high_water_mark"],
                    },
                },
                timeout=10,
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.error(f"Failed to insert snapshot for run {run_id}: {e}")
            raise
