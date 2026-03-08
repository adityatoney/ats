import logging
import os
from typing import Any

import psycopg

logger = logging.getLogger(__name__)


class BranchManager:
    def __init__(self, db_url: str | None = None):
        self.db_url = db_url or os.getenv(
            "DATABASE_URL", "postgresql://aegis:aegis_dev@localhost:5432/aegis_trader"
        )

    def fork(
        self,
        parent_checkpoint_id: str,
        parent_run_id: str,
        change_summary: str,
        rationale: str,
        overrides: dict[str, Any],
        creator_type: str = "user",
    ) -> tuple[str, str]:
        import json

        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                # Get parent run info
                cur.execute(
                    "SELECT agent_id, strategy_version_id, config_json FROM runs WHERE id = %s",
                    (parent_run_id,),
                )
                parent = cur.fetchone()
                if not parent:
                    raise ValueError(f"Parent run not found: {parent_run_id}")

                agent_id, strategy_version_id, config_json = parent

                # Create new run
                cur.execute(
                    """
                    INSERT INTO runs (id, agent_id, strategy_version_id,
                        status, run_type, config_json,
                        total_bars, processed_bars, created_at)
                    VALUES (gen_random_uuid(), %s, %s, 'pending', 'branch', %s::jsonb, 0, 0, NOW())
                    RETURNING id
                    """,
                    (agent_id, strategy_version_id, json.dumps(config_json)),
                )
                new_run_id = str(cur.fetchone()[0])

                # Create branch record
                cur.execute(
                    """
                    INSERT INTO branches (id, run_id, parent_checkpoint_id, parent_run_id,
                                          change_summary, rationale, creator_type, overrides_json,
                                          status, created_at)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s::jsonb, 'pending', NOW())
                    RETURNING id
                    """,
                    (
                        new_run_id,
                        parent_checkpoint_id,
                        parent_run_id,
                        change_summary,
                        rationale,
                        creator_type,
                        json.dumps(overrides),
                    ),
                )
                branch_id = str(cur.fetchone()[0])

                # Link run to branch
                cur.execute(
                    "UPDATE runs SET branch_id = %s WHERE id = %s",
                    (branch_id, new_run_id),
                )

                conn.commit()
                return branch_id, new_run_id
