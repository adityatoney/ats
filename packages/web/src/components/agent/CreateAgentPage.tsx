import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

const STRATEGY_MD_TEMPLATE = `# Strategy Name

## Objective
Describe the trading objective.

## Universe
AAPL, MSFT

## Entry Criteria
- When to buy

## Exit Criteria
- When to sell

## Risk Rules
- Maximum position size: 50% of portfolio per symbol
- Maximum total exposure: 100% of portfolio

## Sizing Doctrine
- Equal weight across signals
`;

const STRATEGY_PY_TEMPLATE = `import polars as pl


def prepare_features(df: pl.DataFrame) -> pl.DataFrame:
    """Add technical indicators to the dataframe."""
    return df.with_columns([
        pl.col("close").rolling_mean(20).alias("sma_20"),
        pl.col("close").rolling_mean(50).alias("sma_50"),
    ])


def generate_signal(state, portfolio):
    """Generate buy/sell signal for current bar.

    Args:
        state: MarketState with .current_bar (dict), .bar_index, .symbol, .history
        portfolio: PortfolioState with .equity, .cash, .positions (dict)

    Returns:
        dict with action/symbol/confidence/reason, or None for no signal
    """
    bar = state.current_bar
    if bar["sma_20"] is None or bar["sma_50"] is None:
        return None

    symbol = state.symbol
    has_position = symbol in portfolio.positions and portfolio.positions[symbol].quantity > 0

    # Example: buy on golden cross, sell on death cross
    if state.bar_index > 0:
        prev = state.history[state.bar_index - 1]
        if prev["sma_20"] is None or prev["sma_50"] is None:
            return None

        # Golden cross: SMA20 crosses above SMA50
        if bar["sma_20"] > bar["sma_50"] and prev["sma_20"] <= prev["sma_50"]:
            return {
                "action": "buy",
                "symbol": symbol,
                "confidence": 0.7,
                "reason": "SMA crossover bullish",
            }

        # Death cross: SMA20 crosses below SMA50
        if bar["sma_20"] < bar["sma_50"] and prev["sma_20"] >= prev["sma_50"] and has_position:
            return {
                "action": "sell",
                "symbol": symbol,
                "confidence": 0.7,
                "reason": "SMA crossover bearish",
            }

    return None


def size_position(portfolio, signal):
    """Determine position size for a signal.

    Args:
        portfolio: PortfolioState with .equity, .positions
        signal: dict with action, symbol, price, confidence

    Returns:
        dict with side and quantity
    """
    action = signal.get("action", "")
    symbol = signal.get("symbol", "")
    price = signal.get("price", 0)
    if price <= 0:
        return {"side": "", "quantity": 0}

    pos = portfolio.positions.get(symbol)
    current_qty = pos.quantity if pos else 0

    if action == "buy":
        target_qty = int(portfolio.equity * 0.5 / price)
        buy_qty = max(0, target_qty - max(0, current_qty))
        if buy_qty > 0:
            return {"side": "buy", "quantity": buy_qty}
    elif action == "sell":
        if current_qty > 0:
            return {"side": "sell", "quantity": int(current_qty)}

    return {"side": "", "quantity": 0}


def risk_gate(order, portfolio, market):
    """Gate orders based on risk rules.

    Args:
        order: dict with symbol, side, quantity
        portfolio: PortfolioState
        market: MarketState

    Returns:
        dict with approved (bool) and reason (str)
    """
    return {"approved": True, "reason": ""}
`;

export function CreateAgentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [strategyMd, setStrategyMd] = useState(STRATEGY_MD_TEMPLATE);
  const [strategyPy, setStrategyPy] = useState(STRATEGY_PY_TEMPLATE);
  const [loading, setLoading] = useState(false);
  const [pineScript, setPineScript] = useState('');
  const [generating, setGenerating] = useState(false);
  const [pineCopied, setPineCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get projectId from existing agents
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents() as Promise<Array<Record<string, unknown>>>,
  });

  const projectId = agents?.[0]?.projectId as string | undefined;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !projectId) return;

    setLoading(true);
    setError(null);

    try {
      const agent = (await api.createAgent(projectId, { name: name.trim() })) as Record<
        string,
        unknown
      >;
      const agentId = agent.id as string;

      // Create initial strategy version
      await api.updateStrategy(agentId, {
        strategyMd,
        strategyPy: strategyPy.trim() || undefined,
      });

      navigate(`/agents/${agentId}`);
    } catch (err) {
      console.error('Failed to create agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Create Agent</h1>
          <p className="text-sm text-gray-400 mt-1">
            Define a new trading agent with its strategy rules and Python implementation.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!projectId && !agents ? (
          <div className="text-gray-400">Loading project...</div>
        ) : !projectId ? (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm text-red-300">
            No project found. Please seed the database first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Agent Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Momentum Breakout"
                required
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Strategy Rules (Markdown)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Describe your trading strategy in plain language — entry/exit criteria, risk rules,
                and sizing.
              </p>
              <textarea
                value={strategyMd}
                onChange={(e) => setStrategyMd(e.target.value)}
                className="w-full h-72 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
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
                  Using AI to convert your markdown strategy into Python code...
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
                value={strategyPy}
                onChange={(e) => setStrategyPy(e.target.value)}
                className="w-full h-96 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
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

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-6 py-2.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
