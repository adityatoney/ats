import logging
import os
from dataclasses import dataclass
from typing import Any

import psycopg

logger = logging.getLogger(__name__)


@dataclass
class DAGNode:
    id: str
    run_id: str
    parent_id: str | None
    label: str
    status: str
    metrics: dict[str, Any] | None = None


class BranchDAG:
    def __init__(self, db_url: str | None = None):
        self.db_url = db_url or os.getenv(
            "DATABASE_URL", "postgresql://aegis:aegis_dev@localhost:5432/aegis_trader"
        )

    def build_dag(self, root_run_id: str) -> list[DAGNode]:
        nodes: list[DAGNode] = []

        with psycopg.connect(self.db_url) as conn:
            with conn.cursor() as cur:
                # Get root run
                cur.execute(
                    "SELECT id, status, metrics_json FROM runs WHERE id = %s",
                    (root_run_id,),
                )
                root = cur.fetchone()
                if not root:
                    return []

                nodes.append(
                    DAGNode(
                        id=root_run_id,
                        run_id=root_run_id,
                        parent_id=None,
                        label="Root Run",
                        status=root[1],
                        metrics=root[2],
                    )
                )

                # Get all branches from this root
                self._collect_children(cur, root_run_id, nodes)

        return nodes

    def _collect_children(self, cur, parent_run_id: str, nodes: list[DAGNode]):
        cur.execute(
            """
            SELECT b.id, b.run_id, b.change_summary, r.status, r.metrics_json
            FROM branches b
            JOIN runs r ON r.id = b.run_id
            WHERE b.parent_run_id = %s
            """,
            (parent_run_id,),
        )
        for row in cur.fetchall():
            branch_id, run_id, summary, status, metrics = row
            nodes.append(
                DAGNode(
                    id=str(run_id),
                    run_id=str(run_id),
                    parent_id=parent_run_id,
                    label=summary or f"Branch {str(branch_id)[:8]}",
                    status=status,
                    metrics=metrics,
                )
            )
            self._collect_children(cur, str(run_id), nodes)

    def to_adjacency_list(self, nodes: list[DAGNode]) -> dict[str, Any]:
        node_list = []
        edge_list = []

        for node in nodes:
            node_list.append({
                "id": node.id,
                "data": {
                    "label": node.label,
                    "status": node.status,
                    "metrics": node.metrics,
                },
                "position": {"x": 0, "y": 0},
            })
            if node.parent_id:
                edge_list.append({
                    "id": f"{node.parent_id}-{node.id}",
                    "source": node.parent_id,
                    "target": node.id,
                })

        return {"nodes": node_list, "edges": edge_list}
