import json
import logging
from typing import Any

from aegis_runtime.db.connection import get_connection

logger = logging.getLogger(__name__)


class RunRepository:
    @staticmethod
    def get_run(run_id: str) -> dict[str, Any] | None:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM runs WHERE id = %s", (run_id,))
                row = cur.fetchone()
                if not row:
                    return None
                cols = [desc[0] for desc in cur.description]
                return dict(zip(cols, row))

    @staticmethod
    def update_run(run_id: str, **kwargs):
        if not kwargs:
            return
        with get_connection() as conn:
            with conn.cursor() as cur:
                sets = ", ".join(f"{k} = %s" for k in kwargs)
                values = list(kwargs.values()) + [run_id]
                cur.execute(f"UPDATE runs SET {sets} WHERE id = %s", values)
                conn.commit()


class OrderRepository:
    @staticmethod
    def insert_order(run_id: str, order: dict[str, Any]) -> str:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO orders (id, run_id, symbol, side, order_type, quantity,
                                        limit_price, stop_price, status, bar_index, created_at)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    RETURNING id
                    """,
                    (
                        run_id,
                        order["symbol"],
                        order["side"],
                        order["order_type"],
                        order["quantity"],
                        order.get("limit_price"),
                        order.get("stop_price"),
                        order.get("status", "pending"),
                        order["bar_index"],
                    ),
                )
                result = cur.fetchone()
                conn.commit()
                return str(result[0])


class PortfolioSnapshotRepository:
    @staticmethod
    def insert_snapshot(run_id: str, snapshot: dict[str, Any]):
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO portfolio_snapshots (
                        id, run_id, bar_index, cash, equity,
                        positions_json, drawdown, high_water_mark,
                        created_at)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::jsonb, %s, %s, NOW())
                    """,
                    (
                        run_id,
                        snapshot["bar_index"],
                        snapshot["cash"],
                        snapshot["equity"],
                        json.dumps(snapshot.get("positions_json", {})),
                        snapshot["drawdown"],
                        snapshot["high_water_mark"],
                    ),
                )
                conn.commit()
