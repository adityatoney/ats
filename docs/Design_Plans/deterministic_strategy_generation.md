# Deterministic Strategy Pipeline With PineTS Assessed

## Summary

Default direction stays the same after checking PineTS:
- Use an open-source deterministic kernel built around a canonical `Strategy IR`.
- Make `Pine -> IR -> Pine` and `IR -> Aegis Python` deterministic.
- Keep Markdown authoring separate from the deterministic kernel.
- Keep the current Aegis runtime as executor for v1.

Updated research conclusions:
- `PyneSys/PyneComp` is deterministic, but it is hosted and closed-source, so it does not satisfy your offline/open-source requirement.
- `PyneCore` is open-source, but it is a different Python runtime model from your current 4-hook Aegis strategy interface, so it is not a drop-in replacement.
- `pynescript` is the best offline/open-source Pine front-end found. It parsed a minimal v6 strategy and one of your repo’s real Pine files, and it can unparse normalized Pine.
- `PineTS` is real and active, but it is not the right primary engine for this repo:
  - it is JavaScript/TypeScript-first, not Python-first
  - its README still marks the strategy backtesting engine as in progress
  - its own `docs/api-coverage/pinescript-v6/strategy.json` marks the `strategy.*` surface as unsupported today
  - it is `AGPL-3.0-only`, which is a meaningful licensing constraint if embedded into your product
- Result: PineTS is useful as a semantic reference or optional parity oracle, not as the core deterministic production path.

## Key Changes

### 1. Add a canonical Strategy IR
Create a typed `StrategyIR` and persist it alongside strategy versions.
Minimum fields:
- `meta`: name, long/short mode, timeframe assumptions
- `inputs`: typed params, defaults, allowed ranges/options
- `indicators`: normalized indicator definitions
- `signals`: entry/exit boolean expressions
- `orders`: entry/close/exit intent and order settings
- `risk`: drawdown/exposure/session guards
- `sizing`: fixed, percent-of-equity, cash, or formula
- `plots`: plot/shape/bgcolor metadata needed for Pine round-trip

Persist derived artifacts separately:
- `strategy_ir_json`
- `strategy_pine`
- `strategy_py`
- optional `strategy_md`

### 2. Make Pine the deterministic ingest path
Add `pine -> ir` using `pynescript`.
Pipeline:
- parse Pine AST
- lower supported constructs into `StrategyIR`
- reject unsupported constructs with source-located diagnostics
- re-render Pine from IR for normalized output

Supported subset for v1:
- `strategy(...)`
- `input.*`
- assignments, arithmetic, comparisons, booleans, ternaries
- `if` / `else`
- `var`
- common `ta.*` indicators already used by your current examples
- `strategy.entry`, `strategy.close`, `strategy.exit`
- `plot`, `plotshape`, `bgcolor`, `hline`

Out of scope for v1:
- `request.security`
- arrays/maps/matrices
- imported Pine libraries
- advanced drawing objects
- multi-symbol logic
- arbitrary unsupported built-ins

### 3. Generate Aegis Python from IR
Replace prose-to-code generation with a deterministic renderer from `StrategyIR` to your current Aegis hook interface.
Renderer outputs:
- `prepare_features()` from IR indicators
- `generate_signal()` from IR signal graph
- `size_position()` from IR sizing
- `risk_gate()` from IR risk rules

Add a generated header containing IR version/hash so artifacts are traceable.

Reverse-conversion rule:
- support `python -> pine` only for Python previously generated from IR
- hand-written arbitrary Python remains executable, but is explicitly non-roundtrippable

### 4. Treat Markdown as structured authoring, not freeform truth
Replace freeform Markdown with a strict template that maps deterministically to IR.
Authoring modes:
- `strict markdown template -> ir`
- `pine -> ir`
- optional future `assisted markdown -> ir`

The strict Markdown format should be schema-shaped, not prose-shaped.
Required sections:
- `Inputs`
- `Indicators`
- `Entry Rules`
- `Exit Rules`
- `Risk Rules`
- `Sizing`

If you later allow hosted assistance for authoring only:
- prefer `codex exec --output-schema` or the Codex SDK
- have the model emit IR only
- keep Python and Pine generation deterministic from IR

### 5. Use PineTS only as an optional secondary oracle
Do not make PineTS a required production dependency in v1.
Allowed uses:
- parity-check harness for supported Pine snippets
- JS-side semantic comparison for indicator calculations
- transpiler/reference behavior checks when expanding Pine coverage

Do not use PineTS for the core path because:
- strategy execution coverage is not mature enough yet
- it does not solve your Python runtime target
- AGPL creates adoption risk if embedded directly

## Test Plan

- Pine parser regression: parse and unparse current repo Pine fixtures including [MACrossoverStrategy.pine](/Users/devitripathy/code/tradingBot/packages/data/strategy/MACrossoverStrategy.pine).
- IR round-trip: `pine -> ir -> pine` preserves strategy semantics for supported fixtures.
- Aegis renderer: `ir -> python` passes your existing validator/loader path.
- Behavioral parity: generated Python in the current simulator matches expected orders/trades for MA crossover and one additional strategy.
- Boundary tests: unsupported Pine constructs fail with deterministic diagnostics and source locations.
- Reverse-generation tests: generated Python with embedded IR regenerates Pine identically; hand-written Python is rejected as non-roundtrippable.
- Strict Markdown parser tests: valid structured templates compile to IR; ambiguous prose fails validation without model calls.
- Optional PineTS parity tests: for a small supported subset, compare selected indicator/signal outputs against PineTS in an isolated harness, but do not gate the main system on PineTS unless its strategy support matures.

## Assumptions And Defaults

- Offline/open-source is mandatory, so PyneSys/PyneComp is excluded from the default architecture.
- `pynescript` is accepted as the Pine parser/unparser dependency, pinned behind an adapter.
- Aegis remains the execution engine for v1.
- Deterministic bidirectional conversion means `Pine/IR/generated-Python subset`, not arbitrary Python.
- PineTS is tracked as a secondary reference project, not the primary compiler/runtime.
- If PineTS matures its strategy runtime later, reevaluate it as an optional cross-check layer first, not as the canonical engine.

## References

- Current repo generation path: [generator.py](/Users/devitripathy/code/tradingBot/packages/runtime/src/aegis_runtime/strategy/generator.py)
- Current repo Pine fixture: [MACrossoverStrategy.pine](/Users/devitripathy/code/tradingBot/packages/data/strategy/MACrossoverStrategy.pine)
- `pynescript` repo: [github.com/elbakramer/pynescript](https://github.com/elbakramer/pynescript)
- `PyneCore` repo: [github.com/PyneSys/pynecore](https://github.com/PyneSys/pynecore)
- `PyneSys` site: [pynesys.io](https://pynesys.io/)
- `PineTS` repo: [github.com/QuantForgeOrg/PineTS](https://github.com/QuantForgeOrg/PineTS)
- PineTS strategy coverage doc: [github.com/QuantForgeOrg/PineTS/blob/main/docs/api-coverage/strategy.md](https://github.com/QuantForgeOrg/PineTS/blob/main/docs/api-coverage/strategy.md)
- PineTS v6 strategy coverage data: [github.com/QuantForgeOrg/PineTS/blob/main/docs/api-coverage/pinescript-v6/strategy.json](https://github.com/QuantForgeOrg/PineTS/blob/main/docs/api-coverage/pinescript-v6/strategy.json)
- PineTS transpiler entrypoint: [github.com/QuantForgeOrg/PineTS/blob/main/src/transpiler/index.ts](https://github.com/QuantForgeOrg/PineTS/blob/main/src/transpiler/index.ts)
- Codex non-interactive mode: [developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive)
- Codex SDK: [developers.openai.com/codex/sdk](https://developers.openai.com/codex/sdk)
