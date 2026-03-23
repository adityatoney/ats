import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


class CheckpointManager:
    def __init__(self, db_url: str | None = None):
        # db_url kept for backward compatibility but ignored — all DB access goes through Node API
        self.api_url = NODE_SERVER_URL

    def save_checkpoint(self, run_id: str, bar_index: int, state: dict[str, Any]) -> str:
        """Save a checkpoint via the Node.js webhook endpoint."""
        response = httpx.post(
            f"{self.api_url}/api/webhooks/runtime-event",
            json={
                "runId": run_id,
                "eventType": "checkpoint.saved",
                "payload": {
                    "barIndex": bar_index,
                    "stateBlob": state,
                },
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        checkpoint_id = data.get("data", {}).get("checkpointId", "unknown")
        logger.info(f"Saved checkpoint {checkpoint_id} for run {run_id} at bar {bar_index}")
        return checkpoint_id

    def load_checkpoint(self, checkpoint_id: str) -> dict[str, Any]:
        """Load a checkpoint by ID from the Node.js API."""
        response = httpx.get(
            f"{self.api_url}/api/checkpoints/{checkpoint_id}",
            timeout=10,
        )
        response.raise_for_status()
        data = response.json().get("data")
        if not data:
            raise ValueError(f"Checkpoint not found: {checkpoint_id}")
        return data.get("stateBlob", {})

    def list_checkpoints(self, run_id: str) -> list[dict[str, Any]]:
        """List checkpoints for a run from the Node.js API."""
        response = httpx.get(
            f"{self.api_url}/api/checkpoints/run/{run_id}",
            timeout=10,
        )
        response.raise_for_status()
        checkpoints = response.json().get("data", [])
        return [
            {
                "id": cp.get("_id", cp.get("id")),
                "bar_index": cp.get("barIndex"),
                "timestamp_simulated": cp.get("timestampSimulated"),
                "created_at": cp.get("_creationTime"),
            }
            for cp in checkpoints
        ]

    def get_latest_checkpoint(self, run_id: str) -> dict[str, Any] | None:
        """Get the latest checkpoint for a run from the Node.js API."""
        response = httpx.get(
            f"{self.api_url}/api/checkpoints/run/{run_id}/latest",
            timeout=10,
        )
        response.raise_for_status()
        data = response.json().get("data")
        if not data:
            return None
        return {
            "id": data.get("_id", data.get("id")),
            "bar_index": data.get("barIndex"),
            "state": data.get("stateBlob", {}),
        }
