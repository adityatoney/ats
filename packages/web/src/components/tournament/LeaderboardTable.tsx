import { useState } from 'react';
import { Link } from 'react-router-dom';

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  runId: string;
  totalReturn: string;
  sharpeRatio: string;
  sortinoRatio: string;
  maxDrawdown: string;
  winRate: string;
  profitFactor: string;
  totalTrades: number;
  netProfit: string;
}

interface Props {
  entries: LeaderboardEntry[];
}

type SortKey = keyof LeaderboardEntry;

export function LeaderboardTable({ entries }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...entries].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    const numA = typeof aVal === 'string' ? parseFloat(aVal) : (aVal as number);
    const numB = typeof bVal === 'string' ? parseFloat(bVal) : (bVal as number);
    if (isNaN(numA) || isNaN(numB)) return 0;
    return sortAsc ? numA - numB : numB - numA;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'rank');
    }
  };

  const fmt = (val: string | number, pct = false) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '-';
    if (pct) return `${(num * 100).toFixed(2)}%`;
    return num.toFixed(4);
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase cursor-pointer hover:text-gray-200 select-none"
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800">
            <SortHeader label="#" field="rank" />
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
              Agent
            </th>
            <SortHeader label="Return" field="totalReturn" />
            <SortHeader label="Sharpe" field="sharpeRatio" />
            <SortHeader label="Sortino" field="sortinoRatio" />
            <SortHeader label="Max DD" field="maxDrawdown" />
            <SortHeader label="Win Rate" field="winRate" />
            <SortHeader label="P. Factor" field="profitFactor" />
            <SortHeader label="Trades" field="totalTrades" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => (
            <tr
              key={entry.agentId}
              className={`border-b border-gray-800/50 ${i === 0 ? 'bg-yellow-900/10' : ''}`}
            >
              <td className="px-3 py-2.5 text-sm font-mono">
                {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}
              </td>
              <td className="px-3 py-2.5">
                <Link
                  to={`/runs/${entry.runId}`}
                  className="text-sm font-medium text-blue-400 hover:text-blue-300"
                >
                  {entry.agentName}
                </Link>
              </td>
              <td
                className={`px-3 py-2.5 text-sm font-mono ${
                  parseFloat(entry.totalReturn) >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {fmt(entry.totalReturn, true)}
              </td>
              <td className="px-3 py-2.5 text-sm font-mono">{fmt(entry.sharpeRatio)}</td>
              <td className="px-3 py-2.5 text-sm font-mono">{fmt(entry.sortinoRatio)}</td>
              <td className="px-3 py-2.5 text-sm font-mono text-red-400">
                {fmt(entry.maxDrawdown, true)}
              </td>
              <td className="px-3 py-2.5 text-sm font-mono">{fmt(entry.winRate, true)}</td>
              <td className="px-3 py-2.5 text-sm font-mono">{fmt(entry.profitFactor)}</td>
              <td className="px-3 py-2.5 text-sm font-mono">{entry.totalTrades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
