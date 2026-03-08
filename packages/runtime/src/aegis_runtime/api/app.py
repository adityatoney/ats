import os

from fastapi import FastAPI

from aegis_runtime.api.routes.health import router as health_router
from aegis_runtime.api.routes.runs import router as runs_router
from aegis_runtime.api.routes.soul import router as soul_router

app = FastAPI(title="Aegis Runtime", version="0.1.0")

app.include_router(health_router)
app.include_router(runs_router, prefix="/api/runs")
app.include_router(soul_router, prefix="/api/soul")

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3001")
