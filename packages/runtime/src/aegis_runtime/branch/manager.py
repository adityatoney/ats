import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


class BranchManager:
    def __init__(self, db_url: str | None = None):
        # db_url kept for backward compatibility but ignored — all DB access goes through Node API
        self.api_url = NODE_SERVER_URL

    def fork(
        self,
        parent_checkpoint_id: str,
        parent_run_id: str,
        change_summary: str,
        rationale: str,
        overrides: dict[str, Any],
        creator_type: str = "user",
    ) -> tuple[str, str]:
        """Create a branch via the Node.js API."""
        response = httpx.post(
            f"{self.api_url}/api/checkpoints/{parent_checkpoint_id}/branch",
            json={
                "changeSummary": change_summary,
                "rationale": rationale,
                "overrides": overrides,
                "creatorType": creator_type,
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json().get("data", {})

        branch = data.get("branch", {})
        run = data.get("run", {})

        branch_id = branch.get("_id", branch.get("id", ""))
        new_run_id = run.get("_id", run.get("id", ""))

        return branch_id, new_run_id
