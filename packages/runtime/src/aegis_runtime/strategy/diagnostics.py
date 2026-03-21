from __future__ import annotations

import re
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


_PARSE_LINE_RE = re.compile(r"line (?P<line>\d+)")


def timeout_error(message: str = "Deterministic Pine compilation timed out") -> StrategyCompileError:
    return StrategyCompileError(
        message,
        diagnostics=[
            StrategyDiagnostic(
                code="compile_timeout",
                message=message,
            )
        ],
    )


def parse_error(message: str) -> StrategyCompileError:
    lines = message.splitlines()
    span = None
    match = _PARSE_LINE_RE.search(message)
    if match:
        line = int(match.group("line"))
        column = None
        for index, value in enumerate(lines):
            if value.strip() == "^" and index > 0:
                column = max(value.find("^"), 0)
                break
        span = SourceSpan(line=line, column=column)

    return StrategyCompileError(
        f"Failed to parse Pine source: {message}",
        diagnostics=[
            StrategyDiagnostic(
                code="parse_error",
                message=f"Failed to parse Pine source: {message}",
                span=span,
            )
        ],
    )
