import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")


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
        # db_url kept for backward compatibility but ignored — all DB access goes through Node API
        self.api_url = NODE_SERVER_URL

    def build_dag(self, root_run_id: str) -> list[DAGNode]:
        """Build the branch DAG via the Node.js API."""
        response = httpx.get(
            f"{self.api_url}/api/branches/run/{root_run_id}",
            timeout=10,
        )
        if response.status_code != 200:
            return []

        data = response.json().get("data", {})
        api_nodes = data.get("nodes", [])

        nodes: list[DAGNode] = []
        # Build a set of targets to identify parent relationships
        edge_map: dict[str, str] = {}
        for edge in data.get("edges", []):
            edge_map[edge["target"]] = edge["source"]

        for api_node in api_nodes:
            node_data = api_node.get("data", {})
            nodes.append(
                DAGNode(
                    id=api_node["id"],
                    run_id=api_node["id"],
                    parent_id=edge_map.get(api_node["id"]),
                    label=node_data.get("label", ""),
                    status=node_data.get("status", "unknown"),
                    metrics=node_data.get("metrics"),
                )
            )

        return nodes

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
