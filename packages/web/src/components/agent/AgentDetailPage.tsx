import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { useAgent } from '../../hooks/useAgent';
import { ApiError, api } from '../../lib/api-client';

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

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, refetch } = useAgent(id);
  const [activeTab, setActiveTab] = useState<'strategy' | 'soul' | 'history'>('strategy');
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>('deterministic');
  const [sourceTab, setSourceTab] = useState<DeterministicSource>('pine');
  const [strategyMd, setStrategyMd] = useState('');
  const [strategyPine, setStrategyPine] = useState('');
  const [strategyPy, setStrategyPy] = useState('');
  const [strategyIrJson, setStrategyIrJson] = useState<Record<string, unknown> | null>(null);
  const [legacyPy, setLegacyPy] = useState('');
  const [pineCopied, setPineCopied] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [initialized, setInitialized] = useState(false);

  const agentData = agent as Record<string, unknown> | undefined;

  const { data: agentRuns } = useQuery({
    queryKey: ['agent-runs', id],
    queryFn: () => api.getAgentRuns(id!) as Promise<Array<Record<string, unknown>>>,
    enabled: !!id && activeTab === 'history',
  });

  const { data: soulVersions } = useQuery({
    queryKey: ['soul-versions', id],
    queryFn: () => api.getSoulVersions(id!) as Promise<Array<Record<string, unknown>>>,
    enabled: !!id && activeTab === 'soul',
  });

  const latestStrategy = agentData?.latestStrategy as Record<string, unknown> | null;

  useEffect(() => {
    if (latestStrategy && !initialized) {
      const rawSourceKind =
        (latestStrategy.sourceKind as string | undefined) ||
        ((latestStrategy.strategyPy as string | null) ? 'legacy_python' : 'markdown_yaml');

      const resolvedMode: AuthoringMode =
        rawSourceKind === 'legacy_python' ? 'legacy' : 'deterministic';
      const resolvedSource: DeterministicSource =
        rawSourceKind === 'pine' ? 'pine' : 'markdown_yaml';

      setAuthoringMode(resolvedMode);
      setSourceTab(resolvedSource);
      setStrategyMd((latestStrategy.strategyMd as string) || '');
      setStrategyPine((latestStrategy.strategyPine as string) || '');
      setStrategyPy((latestStrategy.strategyPy as string) || '');
      setStrategyIrJson((latestStrategy.strategyIrJson as Record<string, unknown>) || null);
      setLegacyPy((latestStrategy.strategyPy as string) || '');
      setInitialized(true);
    }
  }, [latestStrategy, initialized]);

  const latestSourceKind = (latestStrategy?.sourceKind as string | undefined) || 'legacy_python';
  const latestMode: AuthoringMode =
    latestSourceKind === 'legacy_python' ? 'legacy' : 'deterministic';
  const latestSourceTab: DeterministicSource =
    latestSourceKind === 'pine' ? 'pine' : 'markdown_yaml';

  const hasChanges =
    initialized &&
    latestStrategy &&
    (authoringMode !== latestMode ||
      sourceTab !== latestSourceTab ||
      strategyMd !== ((latestStrategy.strategyMd as string) || '') ||
      strategyPine !== ((latestStrategy.strategyPine as string) || '') ||
      (authoringMode === 'legacy'
        ? legacyPy !== ((latestStrategy.strategyPy as string) || '')
        : strategyPy !== ((latestStrategy.strategyPy as string) || '')));

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

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    setDiagnostics([]);

    try {
      if (authoringMode === 'deterministic') {
        const compiled = await compileCurrentStrategy();
        if (!compiled) {
          setSaving(false);
          return;
        }

        await api.updateStrategy(id, {
          sourceKind: sourceTab,
          strategyMd: sourceTab === 'markdown_yaml' ? strategyMd : undefined,
          strategyPine: compiled.strategyPine,
          strategyPy: compiled.strategyPy,
          strategyIrJson: compiled.strategyIrJson,
        });
      } else {
        await api.updateStrategy(id, {
          sourceKind: 'legacy_python',
          strategyMd: strategyMd.trim() || undefined,
          strategyPine: strategyPine.trim() || undefined,
          strategyPy: legacyPy.trim(),
        });
      }

      await refetch();
      setInitialized(false);
      setSaveMsg('Strategy saved as new version.');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save strategy');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading)
    return (
      <Layout>
        <div className="text-gray-400">Loading...</div>
      </Layout>
    );
  if (!agentData)
    return (
      <Layout>
        <div className="text-gray-400">Agent not found</div>
      </Layout>
    );

  const activeSoul = agentData.activeSoul as Record<string, unknown> | null;
  const deterministicSource = sourceTab === 'pine' ? strategyPine : strategyMd;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/" className="text-sm text-gray-400 hover:text-gray-300">
              &larr; Dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-bold">{agentData.name as string}</h1>
            {latestStrategy && (
              <p className="mt-0.5 text-xs text-gray-500">
                Strategy v{latestStrategy.version as number} &middot;{' '}
                {new Date(latestStrategy.createdAt as string).toLocaleString()}
              </p>
            )}
          </div>
          <Link
            to={`/agents/${id}/backtest`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
          >
            Run Backtest
          </Link>
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
        {saveMsg && (
          <div className="rounded-lg border border-green-700 bg-green-900/50 p-3 text-sm text-green-300">
            {saveMsg}
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-800">
          {(['strategy', 'soul', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'strategy' && (
          <div className="space-y-5">
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
                  <textarea
                    className="h-80 w-full rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                    value={deterministicSource}
                    onChange={(e) => {
                      if (sourceTab === 'pine') {
                        setStrategyPine(e.target.value);
                      } else {
                        setStrategyMd(e.target.value);
                      }
                    }}
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
                    Deterministic compile on the server. Python is derived and read-only.
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
                    className="h-80 w-full rounded-lg border border-gray-700 bg-gray-950 p-3 font-mono text-sm text-gray-200 focus:outline-none"
                    value={strategyPy}
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
                    className="h-72 w-full rounded-lg border border-gray-700 bg-gray-950 p-3 font-mono text-sm text-green-400 focus:outline-none"
                    value={strategyPine}
                    onChange={(e) => setStrategyPine(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-yellow-900 px-2 py-0.5 text-xs font-medium text-yellow-300">
                    Non-roundtrippable
                  </span>
                  <span className="text-xs text-gray-400">
                    Legacy Python skips canonical IR generation.
                  </span>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    Legacy Python Strategy
                  </label>
                  <textarea
                    className="h-[32rem] w-full rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                    value={legacyPy}
                    onChange={(e) => setLegacyPy(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={
                  saving ||
                  (authoringMode === 'deterministic'
                    ? !deterministicSource.trim()
                    : !legacyPy.trim())
                }
                className="rounded-lg bg-green-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Strategy'}
              </button>
              {hasChanges && <span className="text-xs text-yellow-400">Unsaved changes</span>}
              {strategyIrJson && authoringMode === 'deterministic' && (
                <span className="text-xs text-gray-400">
                  IR available for deterministic export.
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'soul' && (
          <div className="space-y-4">
            {activeSoul && (
              <div className="rounded-lg border border-green-700/50 bg-gray-900 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="font-medium">Active Soul (v{activeSoul.version as number})</h3>
                  <span className="rounded-full bg-green-900 px-2 py-0.5 text-xs font-medium text-green-300">
                    active
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-gray-300">
                  {activeSoul.soulMd as string}
                </pre>
              </div>
            )}

            {soulVersions && soulVersions.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">All Versions</h3>
                {soulVersions.map((sv) => (
                  <div
                    key={sv.id as string}
                    className="rounded-lg border border-gray-800 bg-gray-900 p-3"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium">Version {sv.version as number}</span>
                      <div className="flex items-center gap-2">
                        <SoulStatusBadge status={sv.status as string} />
                        {sv.status === 'pending' && (
                          <button
                            onClick={async () => {
                              await api.approveSoul(id!, sv.id as string);
                              refetch();
                            }}
                            className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Created: {new Date(sv.createdAt as string).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : !activeSoul ? (
              <p className="text-gray-400">
                No soul versions yet. Run a backtest and generate one.
              </p>
            ) : null}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            {!agentRuns || agentRuns.length === 0 ? (
              <p className="text-gray-400">No runs yet. Start a backtest to see run history.</p>
            ) : (
              agentRuns.map((run) => (
                <Link
                  key={run.id as string}
                  to={`/runs/${run.id}`}
                  className="block rounded-lg border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-600"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm">{(run.id as string).slice(0, 8)}</span>
                    <RunStatusBadge status={run.status as string} />
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm text-gray-400">
                    <div>
                      <span className="text-gray-500">Type:</span> {run.runType as string}
                    </div>
                    <div>
                      <span className="text-gray-500">Bars:</span> {run.processedBars as number}/
                      {run.totalBars as number}
                    </div>
                    <div>
                      <span className="text-gray-500">Started:</span>{' '}
                      {run.startedAt ? new Date(run.startedAt as string).toLocaleString() : 'N/A'}
                    </div>
                  </div>
                  {Boolean(run.metricsJson) && (
                    <div className="mt-2 grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Return:</span>{' '}
                        <span
                          className={
                            (run.metricsJson as Record<string, number>).totalReturn >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }
                        >
                          {((run.metricsJson as Record<string, number>).totalReturn * 100).toFixed(
                            2,
                          )}
                          %
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Sharpe:</span>{' '}
                        {(run.metricsJson as Record<string, number>).sharpeRatio?.toFixed(2)}
                      </div>
                      <div>
                        <span className="text-gray-500">Drawdown:</span>{' '}
                        {((run.metricsJson as Record<string, number>).maxDrawdown * 100).toFixed(2)}
                        %
                      </div>
                      <div>
                        <span className="text-gray-500">Trades:</span>{' '}
                        {(run.metricsJson as Record<string, number>).totalTrades}
                      </div>
                    </div>
                  )}
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900 text-blue-300',
    paused: 'bg-yellow-900 text-yellow-300',
    completed: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
    cancelled: 'bg-gray-700 text-gray-400',
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || colors.pending}`}
    >
      {status}
    </span>
  );
}

function SoulStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-900 text-yellow-300',
    active: 'bg-green-900 text-green-300',
    rejected: 'bg-red-900 text-red-300',
    superseded: 'bg-gray-700 text-gray-400',
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || colors.pending}`}
    >
      {status}
    </span>
  );
}
