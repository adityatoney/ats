import logging
import os
from typing import Any

import psycopg

logger = logging.getLogger(__name__)


class CheckpointManager:
    def __init__(self, db_url: str | None = None):
        self.db_url = db_url or os.getenv(
            "DATABASE_URL", "postgresql://aegis:aegis_dev@localhost:5432/aegis_trader"
        )

    def save_checkpoint(self, run_id: str, bar_index: int, state: dict[str, Any]) -> str:
        import json

        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO checkpoints (id, run_id, bar_index, state_blob, created_at)
                    VALUES (gen_random_uuid(), %s, %s, %s::jsonb, NOW())
                    RETURNING id
                    """,
                    (run_id, bar_index, json.dumps(state)),
                )
                result = cur.fetchone()
                conn.commit()
                checkpoint_id = str(result[0])
                logger.info(f"Saved checkpoint {checkpoint_id} for run {run_id} at bar {bar_index}")
                return checkpoint_id

    def load_checkpoint(self, checkpoint_id: str) -> dict[str, Any]:
        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT state_blob FROM checkpoints WHERE id = %s",
                    (checkpoint_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise ValueError(f"Checkpoint not found: {checkpoint_id}")
                return row[0]

    def list_checkpoints(self, run_id: str) -> list[dict[str, Any]]:
        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, bar_index, timestamp_simulated, created_at
                    FROM checkpoints
                    WHERE run_id = %s
                    ORDER BY bar_index
                    """,
                    (run_id,),
                )
                return [
                    {
                        "id": str(row[0]),
                        "bar_index": row[1],
                        "timestamp_simulated": str(row[2]) if row[2] else None,
                        "created_at": str(row[3]),
                    }
                    for row in cur.fetchall()
                ]

    def get_latest_checkpoint(self, run_id: str) -> dict[str, Any] | None:
        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, bar_index, state_blob
                    FROM checkpoints
                    WHERE run_id = %s
                    ORDER BY bar_index DESC
                    LIMIT 1
                    """,
                    (run_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": str(row[0]),
                    "bar_index": row[1],
                    "state": row[2],
                }
