import logging
import os

import psycopg

logger = logging.getLogger(__name__)


class DeltaComputer:
    @staticmethod
    async def compute_delta(parent_run_id: str, branch_run_id: str) -> dict[str, float]:
        db_url = os.getenv(
            "DATABASE_URL", "postgresql://aegis:aegis_dev@localhost:5432/aegis_trader"
        )

        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT metrics_json FROM runs WHERE id = %s",
                    (parent_run_id,),
                )
                parent_row = cur.fetchone()

                cur.execute(
                    "SELECT metrics_json FROM runs WHERE id = %s",
                    (branch_run_id,),
                )
                branch_row = cur.fetchone()

        parent_metrics = parent_row[0] if parent_row and parent_row[0] else {}
        branch_metrics = branch_row[0] if branch_row and branch_row[0] else {}

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
