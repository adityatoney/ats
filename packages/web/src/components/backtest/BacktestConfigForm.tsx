import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

export function BacktestConfigForm() {
  const { id: agentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const [config, setConfig] = useState({
    symbols: 'AAPL',
    startDate: '2006-05-01',
    endDate: today,
    timeframe: '1Day',
    initialCapital: 100000,
    slippageBps: 5,
    feePerShare: 0.01,
    feePercentage: 0,
    seed: 42,
    checkpointInterval: 50,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const run = (await api.startBacktest({
        agentId: agentId!,
        symbols: config.symbols.split(',').map((s) => s.trim()),
        startDate: config.startDate,
        endDate: config.endDate,
        timeframe: config.timeframe,
        initialCapital: config.initialCapital,
        slippageBps: config.slippageBps,
        feePerShare: config.feePerShare,
        seed: config.seed,
        checkpointInterval: config.checkpointInterval,
      })) as Record<string, unknown>;
      navigate(`/runs/${run.id}`);
    } catch (err) {
      console.error('Failed to start backtest:', err);
      setError(err instanceof Error ? err.message : 'Failed to start backtest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <div>
          <Link to={`/agents/${agentId}`} className="text-sm text-gray-400 hover:text-gray-300">
            &larr; Back to Agent
          </Link>
          <h1 className="text-2xl font-bold mt-1">Configure Backtest</h1>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Symbols (comma-separated)">
            <input
              type="text"
              value={config.symbols}
              onChange={(e) => setConfig({ ...config, symbols: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date">
              <input
                type="date"
                value={config.startDate}
                onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="End Date">
              <input
                type="date"
                value={config.endDate}
                onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Timeframe">
              <select
                value={config.timeframe}
                onChange={(e) => setConfig({ ...config, timeframe: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="1Day">1 Day</option>
                <option value="1Hour">1 Hour</option>
                <option value="15Min">15 Min</option>
                <option value="5Min">5 Min</option>
                <option value="1Min">1 Min</option>
              </select>
            </Field>
            <Field label="Initial Capital ($)">
              <input
                type="number"
                value={config.initialCapital}
                onChange={(e) =>
                  setConfig({ ...config, initialCapital: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Slippage (bps)">
              <input
                type="number"
                value={config.slippageBps}
                onChange={(e) =>
                  setConfig({ ...config, slippageBps: parseFloat(e.target.value) || 0 })
                }
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="Fee/Share ($)">
              <input
                type="number"
                step="0.001"
                value={config.feePerShare}
                onChange={(e) =>
                  setConfig({ ...config, feePerShare: parseFloat(e.target.value) || 0 })
                }
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="Seed">
              <input
                type="number"
                value={config.seed}
                onChange={(e) => setConfig({ ...config, seed: parseInt(e.target.value) || 0 })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>

          <Field label="Checkpoint Interval (bars)">
            <input
              type="number"
              value={config.checkpointInterval}
              onChange={(e) =>
                setConfig({ ...config, checkpointInterval: parseInt(e.target.value) || 50 })
              }
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Starting...' : 'Start Backtest'}
          </button>
        </form>
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
