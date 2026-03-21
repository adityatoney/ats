import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aegis_runtime.strategy.diagnostics import StrategyCompileError
from aegis_runtime.strategy.loader import StrategyLoader
from aegis_runtime.strategy.markdown_compiler import compile_markdown_source
from aegis_runtime.strategy.pine_compiler import (
    parse_pine_source,
    render_strategy_ir_to_pine,
)
from aegis_runtime.strategy.python_renderer import render_python_from_ir
from aegis_runtime.strategy.reverse_renderer import render_pine_from_generated_python
from aegis_runtime.strategy.validator import StrategyValidator

logger = logging.getLogger(__name__)
router = APIRouter()


class CompileStrategyRequest(BaseModel):
    sourceKind: Literal["pine", "markdown_yaml"]
    source: str


class ReverseStrategyRequest(BaseModel):
    strategyPy: str


class ValidatePythonRequest(BaseModel):
    strategyPy: str


@router.post("/compile")
async def compile_strategy(request: CompileStrategyRequest):
    try:
        strategy_ir = (
            parse_pine_source(request.source)
            if request.sourceKind == "pine"
            else compile_markdown_source(request.source)
        )
        strategy_pine = render_strategy_ir_to_pine(strategy_ir)
        strategy_py, _ = render_python_from_ir(strategy_ir)
        StrategyValidator.validate(strategy_py)

        return {
            "strategyIrJson": strategy_ir.model_dump(mode="json"),
            "strategyPine": strategy_pine,
            "strategyPy": strategy_py,
            "diagnostics": [],
            "roundtrippable": True,
        }
    except StrategyCompileError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": str(exc),
                "diagnostics": [item.model_dump(mode="json") for item in exc.diagnostics],
            },
        ) from exc
    except Exception as exc:
        logger.exception("Deterministic strategy compilation failed")
        raise HTTPException(
            status_code=500,
            detail={"message": str(exc), "diagnostics": []},
        ) from exc


@router.post("/reverse")
async def reverse_strategy(request: ReverseStrategyRequest):
    try:
        return {
            "strategyPine": render_pine_from_generated_python(request.strategyPy),
            "roundtrippable": True,
        }
    except StrategyCompileError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": str(exc),
                "diagnostics": [item.model_dump(mode="json") for item in exc.diagnostics],
            },
        ) from exc


@router.post("/validate-python")
async def validate_python_strategy(request: ValidatePythonRequest):
    try:
        StrategyValidator.validate(request.strategyPy)
        StrategyLoader.load_from_python(request.strategyPy)
        return {"valid": True, "errors": []}
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "errors": [str(exc)]},
        ) from exc
