import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { ApiError, api } from '../../lib/api-client';

const PINE_TEMPLATE = `//@version=5
strategy("MA Crossover - Deterministic", overlay=true, initial_capital=100000, default_qty_type=strategy.percent_of_equity, default_qty_value=50)

fast_length = input.int(20, "Fast SMA Length")
slow_length = input.int(50, "Slow SMA Length")

sma_fast = ta.sma(close, fast_length)
sma_slow = ta.sma(close, slow_length)

bull_cross = ta.crossover(sma_fast, sma_slow)
bear_cross = ta.crossunder(sma_fast, sma_slow)

if bull_cross
    strategy.entry("Long", strategy.long)

if bear_cross
    strategy.close("Long")

plot(sma_fast, "Fast SMA", color=color.blue, linewidth=2)
plot(sma_slow, "Slow SMA", color=color.orange, linewidth=2)
plotshape(bull_cross, "Buy Signal", shape.triangleup, location.belowbar, color.green, size=size.small)
plotshape(bear_cross, "Sell Signal", shape.triangledown, location.abovebar, color.red, size=size.small)
`;

const MARKDOWN_TEMPLATE = `## Inputs
\`\`\`yaml
meta:
  name: MA Crossover - Markdown
  scriptVersion: 5
  direction: long
  overlay: true
  initialCapital: 100000
  defaultQtyType: percent_of_equity
  defaultQtyValue: 50
parameters:
  - name: fast_length
    type: int
    default: 20
    title: Fast SMA Length
  - name: slow_length
    type: int
    default: 50
    title: Slow SMA Length
\`\`\`

## Indicators
\`\`\`yaml
calculations:
  - name: sma_fast
    expression: ta.sma(close, fast_length)
  - name: sma_slow
    expression: ta.sma(close, slow_length)
  - name: bull_cross
    expression: ta.crossover(sma_fast, sma_slow)
  - name: bear_cross
    expression: ta.crossunder(sma_fast, sma_slow)
\`\`\`

## Entry Rules
\`\`\`yaml
- id: Long
  kind: entry
  side: long
  when: bull_cross
\`\`\`

## Exit Rules
\`\`\`yaml
- id: Long
  kind: close
  when: bear_cross
\`\`\`

## Risk Rules
\`\`\`yaml
gates: []
\`\`\`

## Sizing
\`\`\`yaml
mode: strategy_default
\`\`\`
`;

const LEGACY_PY_TEMPLATE = `import polars as pl


def prepare_features(df: pl.DataFrame) -> pl.DataFrame:
    return df


def generate_signal(state, portfolio):
    return None


def size_position(portfolio, signal):
    return {"side": "", "quantity": 0}


def risk_gate(order, portfolio, market):
    return {"approved": True, "reason": ""}
`;

type AuthoringMode = 'deterministic' | 'legacy';
type DeterministicSource = 'pine' | 'markdown_yaml';

type CompileResult = {
  strategyIrJson: Record<string, unknown>;
  strategyPine: string;
  strategyPy: string;
  diagnostics: Array<Record<string, unknown>>;
  roundtrippable: boolean;
};

type Diagnostic = {
  code?: string;
  message?: string;
  span?: {
    line?: number | null;
    column?: number | null;
  } | null;
};

export function CreateAgentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>('deterministic');
  const [sourceTab, setSourceTab] = useState<DeterministicSource>('pine');
  const [strategyMd, setStrategyMd] = useState(MARKDOWN_TEMPLATE);
  const [strategyPine, setStrategyPine] = useState(PINE_TEMPLATE);
  const [strategyPy, setStrategyPy] = useState('');
  const [strategyIrJson, setStrategyIrJson] = useState<Record<string, unknown> | null>(null);
  const [legacyPy, setLegacyPy] = useState(LEGACY_PY_TEMPLATE);
  const [loading, setLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [pineCopied, setPineCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents() as Promise<Array<Record<string, unknown>>>,
  });

  const projectId = agents?.[0]?.projectId as string | undefined;

  const compileCurrentStrategy = async () => {
    const sourceKind = sourceTab;
    const source = sourceKind === 'pine' ? strategyPine : strategyMd;
    if (!source.trim()) return null;

    setCompiling(true);
    setError(null);
    setDiagnostics([]);
    try {
      const compiled = (await api.compileStrategy({ sourceKind, source })) as CompileResult;
      setStrategyIrJson(compiled.strategyIrJson);
      setStrategyPine(compiled.strategyPine);
      setStrategyPy(compiled.strategyPy);
      setPineCopied(false);
      setDiagnostics(compiled.diagnostics as Diagnostic[]);
      return compiled;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile strategy');
      setDiagnostics(err instanceof ApiError ? (err.diagnostics as Diagnostic[]) : []);
      return null;
    } finally {
      setCompiling(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !projectId) return;

    setLoading(true);
    setError(null);
    setDiagnostics([]);

    try {
      const agent = (await api.createAgent(projectId, { name: name.trim() })) as Record<
        string,
        unknown
      >;
      const agentId = agent.id as string;

      if (authoringMode === 'deterministic') {
        const compiled = await compileCurrentStrategy();
        if (!compiled) {
          setLoading(false);
          return;
        }

        await api.updateStrategy(agentId, {
          sourceKind: sourceTab,
          strategyMd: sourceTab === 'markdown_yaml' ? strategyMd : undefined,
          strategyPine: compiled.strategyPine,
          strategyPy: compiled.strategyPy,
          strategyIrJson: compiled.strategyIrJson,
        });
      } else {
        await api.updateStrategy(agentId, {
          sourceKind: 'legacy_python',
          strategyMd: strategyMd.trim() || undefined,
          strategyPine: strategyPine.trim() || undefined,
          strategyPy: legacyPy.trim(),
        });
      }

      navigate(`/agents/${agentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  const deterministicSource = sourceTab === 'pine' ? strategyPine : strategyMd;

  return (
    <Layout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Create Agent</h1>
          <p className="mt-1 text-sm text-gray-400">
            Deterministic mode compiles Pine or strict Markdown YAML into canonical IR and generated
            Python. Legacy Python remains available for manual strategies.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {diagnostics.length > 0 && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-sm text-amber-200">
            <div className="mb-2 font-medium">Compiler Diagnostics</div>
            <div className="space-y-2">
              {diagnostics.map((diagnostic, index) => {
                const line = diagnostic.span?.line;
                const column = diagnostic.span?.column;
                const location =
                  line != null ? `line ${line}${column != null ? `, column ${column}` : ''}` : null;
                return (
                  <div
                    key={`${diagnostic.code || 'diag'}-${index}`}
                    className="rounded border border-amber-800/60 bg-amber-950/30 p-2"
                  >
                    <div className="font-mono text-xs text-amber-300">
                      {diagnostic.code || 'compile_error'}
                      {location ? ` • ${location}` : ''}
                    </div>
                    <div>{diagnostic.message || 'Unknown compiler error'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!projectId && !agents ? (
          <div className="text-gray-400">Loading project...</div>
        ) : !projectId ? (
          <div className="rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-300">
            No project found. Please seed the database first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">Agent Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Momentum Breakout"
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Authoring Mode</label>
              <div className="flex gap-2">
                {(
                  [
                    ['deterministic', 'Deterministic'],
                    ['legacy', 'Legacy Python'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAuthoringMode(value)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      authoringMode === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {authoringMode === 'deterministic' ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Source Format</label>
                  <div className="flex gap-2">
                    {(
                      [
                        ['pine', 'Pine'],
                        ['markdown_yaml', 'Markdown (YAML)'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSourceTab(value)}
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          sourceTab === value
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    {sourceTab === 'pine' ? 'Pine Strategy Source' : 'Strict Markdown YAML Source'}
                  </label>
                  <p className="mb-2 text-xs text-gray-500">
                    {sourceTab === 'pine'
                      ? 'Pine is the primary deterministic source. Saving will normalize it through the compiler.'
                      : 'Markdown mode requires the exact YAML-backed headings defined in the template.'}
                  </p>
                  <textarea
                    value={deterministicSource}
                    onChange={(e) => {
                      if (sourceTab === 'pine') {
                        setStrategyPine(e.target.value);
                      } else {
                        setStrategyMd(e.target.value);
                      }
                    }}
                    className="h-96 w-full rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={compileCurrentStrategy}
                    disabled={compiling || !deterministicSource.trim()}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {compiling ? 'Compiling...' : 'Compile Strategy'}
                  </button>
                  <span className="text-xs text-gray-400">
                    Server-owned compile: source -&gt; IR -&gt; normalized Pine -&gt; generated
                    Python.
                  </span>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">
                      Generated Python (Read-only)
                    </label>
                    <span className="rounded-full bg-blue-900 px-2 py-0.5 text-xs text-blue-300">
                      Round-trippable
                    </span>
                  </div>
                  <textarea
                    readOnly
                    value={strategyPy}
                    className="h-80 w-full rounded-lg border border-gray-700 bg-gray-950 p-3 font-mono text-sm text-gray-200 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">
                      Normalized Pine Output
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(strategyPine);
                        setPineCopied(true);
                        setTimeout(() => setPineCopied(false), 2000);
                      }}
                      disabled={!strategyPine.trim()}
                      className="rounded bg-gray-700 px-3 py-1 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:opacity-50"
                    >
                      {pineCopied ? 'Copied!' : 'Copy Pine'}
                    </button>
                  </div>
                  <textarea
                    readOnly={sourceTab !== 'pine'}
                    value={strategyPine}
                    onChange={(e) => setStrategyPine(e.target.value)}
                    className="h-80 w-full rounded-lg border border-gray-700 bg-gray-950 p-3 font-mono text-sm text-green-400 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-yellow-900 px-2 py-0.5 text-xs font-medium text-yellow-300">
                    Non-roundtrippable
                  </span>
                  <span className="text-xs text-gray-400">
                    Legacy mode stores Python directly and skips deterministic compilation.
                  </span>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    Legacy Python Strategy
                  </label>
                  <textarea
                    value={legacyPy}
                    onChange={(e) => setLegacyPy(e.target.value)}
                    className="h-[32rem] w-full rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={
                  loading ||
                  !name.trim() ||
                  (authoringMode === 'deterministic'
                    ? !deterministicSource.trim()
                    : !legacyPy.trim())
                }
                className="rounded-lg bg-green-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Create Agent'}
              </button>
              {strategyIrJson && authoringMode === 'deterministic' && (
                <span className="text-xs text-gray-400">IR compiled and ready to persist.</span>
              )}
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
