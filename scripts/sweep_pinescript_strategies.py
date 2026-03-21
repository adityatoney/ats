#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import pathlib
import signal
import sys
from time import perf_counter
from collections import Counter, defaultdict

from aegis_runtime.strategy.pine_compiler import parse_pine_source, render_strategy_ir_to_pine
from aegis_runtime.strategy.python_renderer import render_python_from_ir
from aegis_runtime.strategy.validator import StrategyValidator

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_STRATEGY_ROOT = pathlib.Path("/tmp/pinescript-strategies/strategies")


class _SweepTimeoutError(TimeoutError):
    pass


def _compile_one(pine_file: pathlib.Path, timeout_seconds: int) -> dict[str, object]:
    def _handle_timeout(signum, frame):
        raise _SweepTimeoutError()

    start = perf_counter()
    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, _handle_timeout)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        source = pine_file.read_text()
        strategy_ir = parse_pine_source(source)
        render_strategy_ir_to_pine(strategy_ir)
        strategy_py, _ = render_python_from_ir(strategy_ir)
        StrategyValidator.validate(strategy_py)
        return {
            "status": "ok",
            "elapsedSeconds": round(perf_counter() - start, 6),
        }
    except _SweepTimeoutError:
        return {
            "status": "timeout",
            "code": "compile_timeout",
            "message": f"Timed out after {timeout_seconds}s",
        }
    except Exception as exc:
        diagnostics = getattr(exc, "diagnostics", None) or []
        diagnostic = diagnostics[0].model_dump(mode="json") if diagnostics else None
        result = {
            "status": "error",
            "message": str(exc),
            "elapsedSeconds": round(perf_counter() - start, 6),
        }
        if diagnostic is not None:
            result["diagnostic"] = diagnostic
            result["code"] = diagnostic.get("code")
        return result
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def sweep(strategy_root: pathlib.Path, timeout_seconds: int) -> dict[str, object]:
    results: list[dict[str, object]] = []
    for pine_file in sorted(strategy_root.rglob("*.pine")):
        rel_path = pine_file.relative_to(strategy_root).as_posix()
        results.append({"file": rel_path, **_compile_one(pine_file, timeout_seconds)})

    summary = Counter(item["status"] for item in results)
    by_folder: dict[str, dict[str, int]] = {}
    error_counts: dict[str, int] = {}

    folder_counts: dict[str, Counter[str]] = defaultdict(Counter)
    errors = Counter()
    for item in results:
        folder = pathlib.Path(item["file"]).parts[0] if "/" in item["file"] else "."
        folder_counts[folder][item["status"]] += 1
        if item["status"] != "ok":
            errors[str(item.get("code") or item.get("message", ""))] += 1

    for folder, counts in folder_counts.items():
        by_folder[folder] = dict(counts)
    error_counts = dict(errors.most_common())

    return {
        "summary": {
            "total": len(results),
            "ok": summary.get("ok", 0),
            "error": summary.get("error", 0),
            "timeout": summary.get("timeout", 0),
        },
        "by_folder": by_folder,
        "error_counts": error_counts,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sweep Pine strategies through the deterministic compiler")
    parser.add_argument(
        "--strategy-root",
        default=str(DEFAULT_STRATEGY_ROOT),
        help="Root directory containing Pine strategy files",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=20,
        help="Per-file timeout in seconds",
    )
    parser.add_argument(
        "--output",
        help="Optional JSON output path. Defaults to stdout only.",
    )
    args = parser.parse_args()

    strategy_root = pathlib.Path(args.strategy_root).resolve()
    if not strategy_root.exists():
        print(f"Strategy root does not exist: {strategy_root}", file=sys.stderr)
        return 1

    report = sweep(strategy_root, args.timeout_seconds)
    rendered = json.dumps(report, indent=2)
    if args.output:
        pathlib.Path(args.output).write_text(rendered + "\n")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
