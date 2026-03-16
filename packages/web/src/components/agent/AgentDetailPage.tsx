import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { useAgent } from '../../hooks/useAgent';
import { api } from '../../lib/api-client';

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, refetch } = useAgent(id);
  const [activeTab, setActiveTab] = useState<'strategy' | 'soul' | 'history'>('strategy');
  const [strategyMd, setStrategyMd] = useState('');
  const [strategyPy, setStrategyPy] = useState('');
  const [pineScript, setPineScript] = useState('');
  const [pineCopied, setPineCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // Initialize form state from latest strategy (only once)
  useEffect(() => {
    if (latestStrategy && !initialized) {
      setStrategyMd((latestStrategy.strategyMd as string) || '');
      setStrategyPy((latestStrategy.strategyPy as string) || '');
      setInitialized(true);
    }
  }, [latestStrategy, initialized]);

  const hasChanges =
    initialized &&
    latestStrategy &&
    (strategyMd !== ((latestStrategy.strategyMd as string) || '') ||
      strategyPy !== ((latestStrategy.strategyPy as string) || ''));

  const handleGenerate = async () => {
    if (!strategyMd.trim()) return;
    setGenerating(true);
    setError(null);

    try {
      const result = (await api.generateStrategy(strategyMd)) as {
        strategyPy: string;
        pineScript: string;
        valid: boolean;
        errors: string[];
      };
      if (result.strategyPy) {
        setStrategyPy(result.strategyPy);
      }
      if (result.pineScript) {
        setPineScript(result.pineScript);
        setPineCopied(false);
      }
      if (result.errors?.length) {
        setError(`Generated code has validation warnings: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('Failed to generate strategy:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate strategy');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);

    try {
      await api.updateStrategy(id, {
        strategyMd,
        strategyPy: strategyPy.trim() || undefined,
      });
      await refetch();
      // Re-sync initialized state with new latest
      setInitialized(false);
      setSaveMsg('Strategy saved as new version.');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      console.error('Failed to save strategy:', err);
      setError(err instanceof Error ? err.message : 'Failed to save strategy');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Layout><div className="text-gray-400">Loading...</div></Layout>;
  if (!agentData) return <Layout><div className="text-gray-400">Agent not found</div></Layout>;

  const activeSoul = agentData.activeSoul as Record<string, unknown> | null;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/" className="text-sm text-gray-400 hover:text-gray-300">
              &larr; Dashboard
            </Link>
            <h1 className="text-2xl font-bold mt-1">{agentData.name as string}</h1>
            {latestStrategy && (
              <p className="text-xs text-gray-500 mt-0.5">
                Strategy v{latestStrategy.version as number} &middot;{' '}
                {new Date(latestStrategy.createdAt as string).toLocaleString()}
              </p>
            )}
          </div>
          <Link
            to={`/agents/${id}/backtest`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Run Backtest
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {saveMsg && (
          <div className="bg-green-900/50 border border-green-700 rounded-lg p-3 text-sm text-green-300">
            {saveMsg}
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-800">
          {(['strategy', 'soul', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Strategy Rules (Markdown)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Describe your trading strategy in plain language — entry/exit criteria, risk rules,
                and sizing.
              </p>
              <textarea
                className="w-full h-72 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                value={strategyMd}
                onChange={(e) => setStrategyMd(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !strategyMd.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {generating ? 'Generating...' : 'Generate Python from Strategy'}
              </button>
              {generating && (
                <span className="text-xs text-gray-400">
                  Using AI to convert your markdown strategy into Python + Pine Script...
                </span>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Strategy Implementation (Python)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Implement four functions:{' '}
                <code className="text-gray-400">prepare_features</code>,{' '}
                <code className="text-gray-400">generate_signal</code>,{' '}
                <code className="text-gray-400">size_position</code>, and{' '}
                <code className="text-gray-400">risk_gate</code>.
                {' '}Or use the button above to auto-generate from your markdown.
              </p>
              <textarea
                className="w-full h-96 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                value={strategyPy}
                onChange={(e) => setStrategyPy(e.target.value)}
              />
            </div>

            {pineScript && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-300">
                    Pine Script v6 (TradingView)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(pineScript);
                      setPineCopied(true);
                      setTimeout(() => setPineCopied(false), 2000);
                    }}
                    className="px-3 py-1 bg-gray-700 text-gray-200 rounded text-xs font-medium hover:bg-gray-600 transition-colors"
                  >
                    {pineCopied ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Paste this into TradingView to validate signal logic matches the Python implementation.
                </p>
                <pre className="w-full max-h-80 overflow-auto bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono text-green-400 whitespace-pre-wrap">
                  {pineScript}
                </pre>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !strategyMd.trim()}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {saving ? 'Saving...' : 'Save Strategy'}
              </button>
              {hasChanges && (
                <span className="text-xs text-yellow-400">Unsaved changes</span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'soul' && (
          <div className="space-y-4">
            {activeSoul && (
              <div className="bg-gray-900 border border-green-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-medium">Active Soul (v{activeSoul.version as number})</h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900 text-green-300">active</span>
                </div>
                <pre className="text-sm text-gray-300 whitespace-pre-wrap">
                  {activeSoul.soulMd as string}
                </pre>
              </div>
            )}

            {soulVersions && soulVersions.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">All Versions</h3>
                {soulVersions.map((sv) => (
                  <div key={sv.id as string} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Version {sv.version as number}</span>
                      <div className="flex items-center gap-2">
                        <SoulStatusBadge status={sv.status as string} />
                        {sv.status === 'pending' && (
                          <button
                            onClick={async () => {
                              await api.approveSoul(id!, sv.id as string);
                              refetch();
                            }}
                            className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
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
              <p className="text-gray-400">No soul versions yet. Run a backtest and generate one.</p>
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
                  className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm">{(run.id as string).slice(0, 8)}</span>
                    <RunStatusBadge status={run.status as string} />
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm text-gray-400">
                    <div>
                      <span className="text-gray-500">Type:</span> {run.runType as string}
                    </div>
                    <div>
                      <span className="text-gray-500">Bars:</span> {run.processedBars as number}/{run.totalBars as number}
                    </div>
                    <div>
                      <span className="text-gray-500">Started:</span>{' '}
                      {run.startedAt ? new Date(run.startedAt as string).toLocaleString() : 'N/A'}
                    </div>
                  </div>
                  {run.metricsJson && (
                    <div className="grid grid-cols-4 gap-4 mt-2 text-sm">
                      <div>
                        <span className="text-gray-500">Return:</span>{' '}
                        <span className={(run.metricsJson as Record<string, number>).totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {((run.metricsJson as Record<string, number>).totalReturn * 100).toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Sharpe:</span>{' '}
                        {(run.metricsJson as Record<string, number>).sharpeRatio?.toFixed(2)}
                      </div>
                      <div>
                        <span className="text-gray-500">Drawdown:</span>{' '}
                        {((run.metricsJson as Record<string, number>).maxDrawdown * 100).toFixed(2)}%
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}
