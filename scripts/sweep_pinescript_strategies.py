#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import textwrap
from collections import Counter, defaultdict


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_DIR = REPO_ROOT / "packages" / "runtime"
DEFAULT_STRATEGY_ROOT = pathlib.Path("/tmp/pinescript-strategies/strategies")

WORKER_SCRIPT = textwrap.dedent(
    """
    from pathlib import Path
    import json
    import sys

    from aegis_runtime.strategy.pine_compiler import parse_pine_source, render_strategy_ir_to_pine
    from aegis_runtime.strategy.python_renderer import render_python_from_ir
    from aegis_runtime.strategy.validator import StrategyValidator

    source = Path(sys.argv[1]).read_text()
    strategy_ir = parse_pine_source(source)
    render_strategy_ir_to_pine(strategy_ir)
    strategy_py, _ = render_python_from_ir(strategy_ir)
    StrategyValidator.validate(strategy_py)
    print(json.dumps({"status": "ok"}))
    """
).strip()


def sweep(strategy_root: pathlib.Path, timeout_seconds: int) -> dict[str, object]:
    results: list[dict[str, object]] = []
    env = {**os.environ, "PYTHONPATH": "src"}
    for pine_file in sorted(strategy_root.rglob("*.pine")):
        rel_path = pine_file.relative_to(strategy_root).as_posix()
        try:
            completed = subprocess.run(
                ["uv", "run", "--extra", "dev", "python", "-c", WORKER_SCRIPT, str(pine_file)],
                cwd=RUNTIME_DIR,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            results.append(
                {
                    "file": rel_path,
                    "status": "timeout",
                    "message": f"Timed out after {timeout_seconds}s",
                }
            )
            continue

        if completed.returncode == 0:
            results.append({"file": rel_path, "status": "ok"})
            continue

        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        message = stderr or stdout or f"Worker failed with exit code {completed.returncode}"
        results.append({"file": rel_path, "status": "error", "message": message})

    summary = Counter(item["status"] for item in results)
    by_folder: dict[str, dict[str, int]] = {}
    error_counts: dict[str, int] = {}

    folder_counts: dict[str, Counter[str]] = defaultdict(Counter)
    errors = Counter()
    for item in results:
        folder = pathlib.Path(item["file"]).parts[0] if "/" in item["file"] else "."
        folder_counts[folder][item["status"]] += 1
        if item["status"] != "ok":
            errors[str(item.get("message", ""))] += 1

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
