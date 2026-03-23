import { useParams } from 'react-router-dom';
import { useRef, useEffect } from 'react';
import { Layout } from '../ui/Layout';
import { useTournament, useTournamentComparison, useTournamentLeaderboard } from '../../hooks/useTournament';
import { createChart, ColorType, type IChartApi } from 'lightweight-charts';

interface Snapshot {
  barIndex: number;
  equity: string | number;
  timestampSimulated: string | number | null;
}

interface ComparisonEntry {
  agentId: string;
  agentName: string;
  runId: string | null;
  snapshots: Snapshot[];
}

interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  totalReturn: string;
  sharpeRatio: string;
  sortinoRatio: string;
  maxDrawdown: string;
  winRate: string;
  profitFactor: string;
  netProfit: string;
  totalTrades: number;
}

const AGENT_COLORS = [
  '#2196F3', '#4CAF50', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FF5722', '#8BC34A', '#FFC107', '#607D8B',
];

export function AgentComparisonPage() {
  const { id } = useParams<{ id: string }>();
  const { data: tournament } = useTournament(id) as { data: { name: string } | undefined };
  const { data: comparison } = useTournamentComparison(id) as {
    data: ComparisonEntry[] | undefined;
  };
  const { data: leaderboard } = useTournamentLeaderboard(id) as {
    data: LeaderboardEntry[] | undefined;
  };
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !comparison?.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    comparison.forEach((agent, idx) => {
      if (!agent.snapshots.length) return;

      const series = chart.addLineSeries({
        color: AGENT_COLORS[idx % AGENT_COLORS.length],
        lineWidth: 2,
        title: agent.agentName,
      });

      const data = agent.snapshots.map((s) => {
        let time: string;
        if (s.timestampSimulated != null) {
          if (typeof s.timestampSimulated === 'number') {
            const d = new Date(s.timestampSimulated);
            time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            time = s.timestampSimulated.split('T')[0];
          }
        } else {
          // Fallback: use barIndex as fake date
          const d = new Date(2020, 0, 1 + s.barIndex);
          time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return { time, value: typeof s.equity === 'number' ? s.equity : parseFloat(s.equity) };
      });

      // Deduplicate by time
      const seen = new Set<string>();
      const deduped = data.filter((d) => {
        if (seen.has(d.time)) return false;
        seen.add(d.time);
        return true;
      });

      if (deduped.length > 0) {
        series.setData(deduped as never[]);
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [comparison]);

  const fmt = (val: string | number, pct = false) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '-';
    if (pct) return `${(num * 100).toFixed(2)}%`;
    return num.toFixed(4);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">
          Agent Comparison — {tournament?.name || 'Tournament'}
        </h1>

        {/* Equity Curve Overlay */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="text-lg font-semibold mb-3">Equity Curves</h2>
          <div ref={chartContainerRef} />
          <div className="flex flex-wrap gap-4 mt-3">
            {comparison?.map((agent, idx) => (
              <div key={agent.agentId} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: AGENT_COLORS[idx % AGENT_COLORS.length] }}
                />
                <span className="text-sm text-gray-300">{agent.agentName}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side-by-Side Metrics */}
        {leaderboard && leaderboard.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="text-lg font-semibold mb-3">Metrics Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Metric
                    </th>
                    {leaderboard.map((entry, idx) => (
                      <th
                        key={entry.agentId}
                        className="px-3 py-2 text-left text-xs font-medium uppercase"
                        style={{ color: AGENT_COLORS[idx % AGENT_COLORS.length] }}
                      >
                        {entry.agentName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Total Return', key: 'totalReturn', pct: true },
                    { label: 'Sharpe Ratio', key: 'sharpeRatio', pct: false },
                    { label: 'Sortino Ratio', key: 'sortinoRatio', pct: false },
                    { label: 'Max Drawdown', key: 'maxDrawdown', pct: true },
                    { label: 'Win Rate', key: 'winRate', pct: true },
                    { label: 'Profit Factor', key: 'profitFactor', pct: false },
                    { label: 'Net Profit', key: 'netProfit', pct: false },
                    { label: 'Total Trades', key: 'totalTrades', pct: false },
                  ].map((metric) => (
                    <tr key={metric.key} className="border-b border-gray-800/50">
                      <td className="px-3 py-2 text-sm text-gray-400">{metric.label}</td>
                      {leaderboard.map((entry) => {
                        const val = entry[metric.key as keyof LeaderboardEntry];
                        return (
                          <td key={entry.agentId} className="px-3 py-2 text-sm font-mono">
                            {metric.key === 'totalTrades'
                              ? val
                              : fmt(val as string, metric.pct)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
