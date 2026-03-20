# Repo-Specific Implementation Plan For The Deterministic Strategy Pipeline

## Summary

Implement the deterministic pipeline as a server-owned compile flow, not a runtime-owned flow.

Chosen defaults:
- Canonical deterministic inputs: `Pine` and `Markdown + YAML blocks`
- Canonical internal form: `StrategyIR`
- Executable artifact: generated Aegis `strategyPy`
- Runtime executes only generated or legacy `strategyPy`; it no longer depends on `strategyMd`
- UI default: deterministic mode with Pine as the primary authoring tab
- Compatibility: explicit `legacy_python` mode remains for hand-written Python, marked non-roundtrippable
- Backfill: lazy, by filling missing derived fields on read/edit/run

This keeps the current simulator/backtester in place while removing Anthropic from the main strategy path.

## Implementation Changes

### 1. Persistence and types

Update [strategy-versions.ts](/Users/devitripathy/code/tradingBot/packages/db/src/schema/strategy-versions.ts) so each strategy version can store both source and derived artifacts.

Schema changes:
- Keep existing `strategy_py` as the executable Python artifact
- Change `strategy_md` from required to nullable
- Add `strategy_pine text`
- Add `strategy_ir_json jsonb`
- Add `source_kind text not null`
  Allowed values:
  - `pine`
  - `markdown_yaml`
  - `legacy_python`
- Keep `config_json` as-is

Semantic rules:
- `pine` and `markdown_yaml` rows are deterministic and must have `strategy_ir_json`, `strategy_pine`, and generated `strategy_py`
- `legacy_python` rows may omit `strategy_ir_json` and `strategy_pine`
- `legacy_python` rows are explicitly non-roundtrippable
- Lazy backfill updates missing derived columns in-place on existing versions only when the source can be deterministically compiled

Shared API/type updates in [api.ts](/Users/devitripathy/code/tradingBot/packages/shared/src/types/api.ts):
- Replace the current `UpdateStrategyRequest` shape with:
  - `sourceKind: 'pine' | 'markdown_yaml' | 'legacy_python'`
  - `strategyMd?: string`
  - `strategyPine?: string`
  - `strategyPy?: string`
  - `strategyIrJson?: Record<string, unknown>`
  - `configJson?: Record<string, unknown>`
- Add `CompileStrategyRequest`
  - `sourceKind: 'pine' | 'markdown_yaml'`
  - `source: string`
- Add `CompileStrategyResponse`
  - `strategyIrJson`
  - `strategyPine`
  - `strategyPy`
  - `diagnostics`
  - `roundtrippable`
- Add a typed `StrategyVersion` response model including `sourceKind`

### 2. Compiler pipeline in the Python runtime

Add a deterministic compiler stack under `packages/runtime/src/aegis_runtime/strategy/`:

New modules:
- `ir.py`
  - Pydantic models for `StrategyIR`
- `pine_compiler.py`
  - parse Pine with pinned `pynescript==0.3.0`
  - lower supported AST subset into `StrategyIR`
  - re-render normalized Pine from IR
- `markdown_compiler.py`
  - parse strict Markdown with fixed headings and fenced YAML blocks
- `python_renderer.py`
  - render Aegis hook-based Python from `StrategyIR`
- `reverse_renderer.py`
  - extract embedded IR blob from generated Python and re-render Pine
- `diagnostics.py`
  - typed compile errors with source span, code, and message

Dependency change in [pyproject.toml](/Users/devitripathy/code/tradingBot/packages/runtime/pyproject.toml):
- add `pynescript==0.3.0`
- do not add PineTS
- keep Anthropic only for deprecated legacy route if retained temporarily

Deterministic Markdown format:
- exact required headings:
  - `## Inputs`
  - `## Indicators`
  - `## Entry Rules`
  - `## Exit Rules`
  - `## Risk Rules`
  - `## Sizing`
- each heading contains exactly one fenced YAML block
- parser ignores surrounding prose and only reads those blocks
- any missing heading or invalid YAML is a hard compile error

`StrategyIR` minimum shape:
- `meta`
  - `name`
  - `scriptVersion`
  - `direction`
  - `overlay`
  - `initialCapital`
  - `defaultQtyType`
  - `defaultQtyValue`
- `inputs[]`
- `indicators[]`
- `signals`
  - `entry`
  - `exit`
- `orders`
  - `entryActions[]`
  - `exitActions[]`
- `risk`
  - list of gate expressions
- `sizing`
- `plots[]`

Supported Pine subset for v1:
- `strategy(...)`
- `input.int`, `input.float`, `input.string`, `input.bool`
- assignments, `var`, reassignments, ternaries
- boolean and arithmetic expressions
- `if` / `else`
- `ta.sma`, `ta.ema`, `ta.rsi`, `ta.crossover`, `ta.crossunder`
- `math.max`, `math.min`
- `strategy.entry`, `strategy.close`, `strategy.exit`
- `plot`, `plotshape`, `bgcolor`, `hline`

Hard rejects for v1:
- `request.security`
- arrays, matrices, maps
- imports/libraries
- loops
- switches
- multi-symbol references
- unsupported built-ins or unsupported `ta.*`

Python renderer behavior:
- output only the current Aegis hook interface:
  - `prepare_features`
  - `generate_signal`
  - `size_position`
  - `risk_gate`
- embed a header comment with:
  - `generated_by: aegis_ir_v1`
  - `strategy_ir_sha256`
  - base64 JSON IR payload
- generated Python is the only Python eligible for deterministic reverse conversion

### 3. API and runtime migration

Server routes in [agents.ts](/Users/devitripathy/code/tradingBot/packages/server/src/routes/agents.ts):
- add `POST /agents/compile-strategy`
  - deterministic compile only
  - accepts Pine or Markdown YAML source
  - returns IR, normalized Pine, generated Python, diagnostics
- keep `PUT /agents/:id/strategy`
  - server validates and persists artifacts
  - for deterministic modes, the server recomputes `strategy_ir_json`, `strategy_pine`, and `strategy_py` from the submitted source instead of trusting client-generated artifacts
  - for `legacy_python`, server stores submitted `strategyPy` after existing validator checks
- deprecate `POST /agents/generate-strategy`
  - remove it from the main UI
  - keep it only as a hidden temporary legacy route if you want one release of compatibility
  - otherwise remove it entirely once the deterministic UI ships

Run payload simplification:
- update [python-client.ts](/Users/devitripathy/code/tradingBot/packages/server/src/lib/python-client.ts) and runtime run routes so runtime receives:
  - `strategyPy`
  - `sourceKind`
  - optional `strategyIrJson`
  - `config`
- remove `strategyMd` from start-run, branch-run, and tournament-run payloads

Runtime routes:
- remove mandatory markdown parsing from `runs.py` and `tournaments.py`
- stop building `parsed_strategy` from `strategyMd`
- remove `parsed_strategy` from `Engine` constructor and call sites because the simulator does not use it

Server services:
- `run-manager` and `tournament-manager` load stored `strategyPy` and `sourceKind`
- before starting a run, if a deterministic row is missing `strategy_ir_json` or `strategy_pine`, perform lazy backfill compile and persist the missing fields
- legacy rows run unchanged

### 4. UI behavior

Update the create/edit strategy UI so deterministic mode is the default.

Behavior:
- authoring mode selector:
  - `Deterministic`
  - `Legacy Python`
- in deterministic mode:
  - source tabs:
    - `Pine`
    - `Markdown (YAML)`
  - `Python` panel is read-only and displays generated code
  - `Pine` panel is editable if Pine is the selected source tab
  - `Markdown (YAML)` panel is editable if Markdown is the selected source tab
  - `Compile Strategy` replaces `Generate Python`
- in legacy mode:
  - editable Python textarea remains
  - show badge `Non-roundtrippable`
  - do not show deterministic compile controls

Defaults:
- new agents open on deterministic Pine tab with a Pine sample
- strict Markdown is secondary, not the default
- existing versions with only `strategyMd` + hand-written `strategyPy` open in legacy mode until converted

### 5. PineTS usage boundary

Do not ship PineTS as a dependency in runtime, server, or web production code.

Allowed use only:
- optional dev-only parity fixtures or research harness
- documentation/reference while expanding Pine support

Do not use PineTS for:
- server compilation
- runtime execution
- persisted artifacts
- user-facing deterministic guarantees

## Test Plan

### Compiler and IR tests
- Parse and lower [MACrossoverStrategy.pine](/Users/devitripathy/code/tradingBot/packages/data/strategy/MACrossoverStrategy.pine) into `StrategyIR`
- Parse and lower [250CrossoverStrategy.pine](/Users/devitripathy/code/tradingBot/packages/data/strategy/50/250CrossoverStrategy.pine) into `StrategyIR`
- `pine -> ir -> pine` round-trip produces normalized Pine with equivalent structure
- strict Markdown YAML parser accepts valid documents and rejects missing headings or invalid YAML with source-located diagnostics
- unsupported Pine constructs fail with deterministic error codes and spans

### Python renderer tests
- `ir -> python` passes the existing `StrategyValidator`
- `ir -> python` loads successfully through `StrategyLoader`
- generated Python contains embedded IR metadata
- `generated python -> pine` succeeds and matches the normalized Pine renderer
- hand-written legacy Python fails reverse generation with a clear non-roundtrippable error

### Integration tests
- `POST /agents/compile-strategy` returns IR, Pine, Python, diagnostics
- `PUT /agents/:id/strategy` persists deterministic rows with all derived fields
- lazy backfill populates missing deterministic columns on read/run without changing version numbering
- `run-manager` starts a run using only stored `strategyPy`
- runtime `runs.py` and tournament routes work without `strategyMd`

### Behavioral parity tests
- generated Python from the MA crossover IR produces stable order sequences and metrics in the current simulator
- add one second deterministic fixture and compare fills/orders/metrics against goldens
- legacy Python strategies continue to execute unchanged

## Assumptions And Defaults

- `pynescript==0.3.0` is the pinned parser version for v1
- use the installed package, not a source checkout, to avoid local ANTLR/runtime mismatch issues
- deterministic support is limited to the explicitly listed Pine subset
- runtime ownership remains with Aegis; no PyneCore runtime migration is part of this implementation
- Anthropic is removed from the default strategy authoring path
- if the deprecated AI route is retained briefly, it is hidden from the main UI and marked legacy
- lazy backfill updates missing derived columns on the existing version row without creating a new version, because the semantic source does not change
