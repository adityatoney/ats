from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SourceSpan(BaseModel):
    line: int | None = None
    column: int | None = None
    endLine: int | None = None
    endColumn: int | None = None


class StrategyDiagnostic(BaseModel):
    code: str
    message: str
    severity: Literal["error", "warning"] = "error"
    span: SourceSpan | None = None


class StrategyCompileError(Exception):
    def __init__(self, message: str, diagnostics: list[StrategyDiagnostic] | None = None):
        super().__init__(message)
        self.diagnostics = diagnostics or [
            StrategyDiagnostic(code="compile_error", message=message)
        ]


def span_from_node(node) -> SourceSpan | None:
    line = getattr(node, "lineno", None)
    column = getattr(node, "col_offset", None)
    end_line = getattr(node, "end_lineno", None)
    end_column = getattr(node, "end_col_offset", None)
    if line is None and column is None and end_line is None and end_column is None:
        return None
    return SourceSpan(
        line=line,
        column=column,
        endLine=end_line,
        endColumn=end_column,
    )


def compile_error(code: str, message: str, node=None) -> StrategyCompileError:
    return StrategyCompileError(
        message,
        diagnostics=[
            StrategyDiagnostic(
                code=code,
                message=message,
                span=span_from_node(node),
            )
        ],
    )
