import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type SeriesMarker, type Time } from 'lightweight-charts';

interface Props {
  snapshots: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
}

type EquityMarker = {
  time: Time;
  position: 'belowBar' | 'aboveBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown';
  text: string;
};

function parseDate(ts: string): { year: number; month: number; day: number } | null {
  const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: parseInt(match[1]), month: parseInt(match[2]), day: parseInt(match[3]) };
}

function toDateStr(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

// Consistent symbol color palette
const SYMBOL_COLORS: Record<string, { line: string; buy: string; sell: string }> = {};
const COLOR_PALETTE = [
  { line: '#3B82F6', buy: '#22d3ee', sell: '#f472b6' },   // blue / cyan / pink
  { line: '#F59E0B', buy: '#34d399', sell: '#fb923c' },   // amber / emerald / orange
  { line: '#8B5CF6', buy: '#a3e635', sell: '#f87171' },   // violet / lime / red
  { line: '#EC4899', buy: '#2dd4bf', sell: '#fbbf24' },   // pink / teal / yellow
  { line: '#10B981', buy: '#60a5fa', sell: '#e879f9' },   // emerald / blue / fuchsia
];

function getSymbolColors(symbol: string, index: number) {
  if (!SYMBOL_COLORS[symbol]) {
    SYMBOL_COLORS[symbol] = COLOR_PALETTE[index % COLOR_PALETTE.length];
  }
  return SYMBOL_COLORS[symbol];
}

/** Extract unique symbols from snapshots positionsJson */
function extractSymbols(snapshots: Array<Record<string, unknown>>): string[] {
  const symbols = new Set<string>();
  for (const s of snapshots) {
    const positions = s.positionsJson as Record<string, unknown> | null;
    if (positions) {
      for (const sym of Object.keys(positions)) {
        symbols.add(sym);
      }
    }
  }
  return Array.from(symbols).sort();
}

/** Convert a timestamp (string ISO date, or number Unix ms) to yyyy-mm-dd */
function timestampToDateStr(ts: unknown): string | null {
  if (typeof ts === 'string') {
    const date = parseDate(ts);
    return date ? toDateStr(date) : null;
  }
  if (typeof ts === 'number' && ts > 0) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Build the equity data series */
function buildEquityData(snapshots: Array<Record<string, unknown>>): Array<{ time: string; value: number }> {
  const hasTimestamps = snapshots.some(
    (s) => s.timestampSimulated != null && timestampToDateStr(s.timestampSimulated) !== null,
  );

  const raw = snapshots.map((s) => {
    const equity = Number(s.equity) || 0;
    if (hasTimestamps && s.timestampSimulated != null) {
      const dateStr = timestampToDateStr(s.timestampSimulated);
      if (dateStr) return { time: dateStr, value: equity };
    }
    // Fallback: use barIndex as a fake date (2020-01-01 + barIndex days)
    const barIdx = (s.barIndex as number) ?? 0;
    const fakeDate = new Date(2020, 0, 1 + barIdx);
    return { time: `${fakeDate.getFullYear()}-${String(fakeDate.getMonth() + 1).padStart(2, '0')}-${String(fakeDate.getDate()).padStart(2, '0')}`, value: equity };
  });

  // Deduplicate
  const deduped: Array<{ time: string; value: number }> = [];
  const seen = new Map<string, number>();
  for (const point of raw) {
    const idx = seen.get(point.time);
    if (idx !== undefined) {
      deduped[idx] = point;
    } else {
      seen.set(point.time, deduped.length);
      deduped.push(point);
    }
  }
  return deduped;
}

/** Extract time from order's filledAtSim or submittedAtSim timestamp */
function getOrderTime(order: Record<string, unknown>): string | null {
  const ts = order.filledAtSim ?? order.submittedAtSim;
  if (ts == null) return null;
  return timestampToDateStr(ts);
}

export function EquityCurve({ snapshots, orders }: Props) {
  const symbols = extractSymbols(snapshots);
  const isMultiSymbol = symbols.length > 1;

  const [visibleSymbols, setVisibleSymbols] = useState<Set<string>>(new Set(symbols));

  // Reset visible symbols when symbols change
  useEffect(() => {
    setVisibleSymbols(new Set(symbols));
  }, [symbols.join(',')]);

  const toggleSymbol = (sym: string) => {
    setVisibleSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) {
        if (next.size > 1) next.delete(sym);
      } else {
        next.add(sym);
      }
      return next;
    });
  };

  if (snapshots.length === 0) {
    return <div className="text-gray-400">No portfolio data yet.</div>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Portfolio Equity</h3>
        {isMultiSymbol && (
          <div className="flex items-center gap-2">
            {symbols.map((sym, i) => {
              const colors = getSymbolColors(sym, i);
              const active = visibleSymbols.has(sym);
              return (
                <button
                  key={sym}
                  onClick={() => toggleSymbol(sym)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-all ${
                    active
                      ? 'bg-gray-800 text-gray-100'
                      : 'bg-gray-900 text-gray-500 opacity-50'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: active ? colors.line : '#4B5563' }}
                  />
                  {sym}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <EquityChart snapshots={snapshots} orders={orders} symbols={symbols} visibleSymbols={visibleSymbols} />
    </div>
  );
}

/** Main equity curve chart */
function EquityChart({
  snapshots,
  orders,
  symbols,
  visibleSymbols,
}: {
  snapshots: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  symbols: string[];
  visibleSymbols: Set<string>;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartRef.current || snapshots.length === 0) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
    }

    const chart = createChart(chartRef.current, {
      layout: { background: { color: '#111827' }, textColor: '#9CA3AF' },
      grid: { vertLines: { color: '#1F2937' }, horzLines: { color: '#1F2937' } },
      width: chartRef.current.clientWidth,
      height: 400,
      timeScale: { timeVisible: false, borderColor: '#374151' },
      rightPriceScale: { borderColor: '#374151' },
      localization: { priceFormatter: formatCurrency },
    });
    chartInstanceRef.current = chart;

    const equityData = buildEquityData(snapshots);
    const lineSeries = chart.addLineSeries({ color: '#3B82F6', lineWidth: 2 });
    lineSeries.setData(equityData as Array<{ time: string; value: number }>);

    // Build markers for visible symbols, using order's own filledAtSim timestamp
    if (orders && orders.length > 0) {
      const markers = orders
        .filter((o) => visibleSymbols.has(o.symbol as string))
        .map((order) => {
          const side = order.side as string;
          const sym = order.symbol as string;
          const time = getOrderTime(order);
          if (!time) return null;

          const symIdx = symbols.indexOf(sym);
          const colors = getSymbolColors(sym, symIdx);

          return {
            time: time as Time,
            position: side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
            color: side === 'buy' ? colors.buy : colors.sell,
            shape: side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
            text: `${side === 'buy' ? 'B' : 'S'} ${sym}`,
          };
        })
        .filter((marker): marker is EquityMarker => marker !== null)
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

      lineSeries.setMarkers(markers as SeriesMarker<Time>[]);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartInstanceRef.current = null;
    };
  }, [snapshots, orders, symbols, visibleSymbols]);

  return <div ref={chartRef} />;
}
