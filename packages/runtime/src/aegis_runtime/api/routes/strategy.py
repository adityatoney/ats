import logging
import os

from fastapi import APIRouter
from pydantic import BaseModel

from aegis_runtime.strategy.generator import StrategyGenerator

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateStrategyRequest(BaseModel):
    strategyMd: str


@router.post("/generate")
async def generate_strategy(request: GenerateStrategyRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "error": "ANTHROPIC_API_KEY not configured",
            "strategyPy": "",
            "pineScript": "",
            "valid": False,
            "errors": ["Missing API key"],
        }

    generator = StrategyGenerator(api_key)
    try:
        result = await generator.generate(request.strategyMd)
        return result
    except Exception as e:
        logger.exception("Strategy generation failed")
        return {
            "error": str(e),
            "strategyPy": "",
            "pineScript": "",
            "valid": False,
            "errors": [str(e)],
        }
