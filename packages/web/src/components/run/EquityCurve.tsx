import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type SeriesMarker, type Time } from 'lightweight-charts';

interface Props {
  snapshots: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
}

function parseDate(ts: string): { year: number; month: number; day: number } | null {
  const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: parseInt(match[1]), month: parseInt(match[2]), day: parseInt(match[3]) };
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function EquityCurve({ snapshots, orders }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartRef.current || snapshots.length === 0) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
    }

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      width: chartRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: false,
        borderColor: '#374151',
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      localization: {
        priceFormatter: formatCurrency,
      },
    });

    chartInstanceRef.current = chart;

    const lineSeries = chart.addLineSeries({
      color: '#3B82F6',
      lineWidth: 2,
    });

    // Check if snapshots have real timestamps
    const hasTimestamps = snapshots.some(
      (s) => s.timestampSimulated && typeof s.timestampSimulated === 'string',
    );

    const data = snapshots
      .map((s) => {
        const equity = Number(s.equity) || 0;

        if (hasTimestamps && s.timestampSimulated) {
          const date = parseDate(s.timestampSimulated as string);
          if (date) {
            return { time: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`, value: equity };
          }
        }

        // Fallback: use bar index as sequential number
        return { time: ((s.barIndex as number) + 1) as unknown as string, value: equity };
      })
      // Deduplicate by time (keep last value for each date)
      .reduce(
        (acc, point) => {
          const existing = acc.findIndex((p) => p.time === point.time);
          if (existing >= 0) {
            acc[existing] = point;
          } else {
            acc.push(point);
          }
          return acc;
        },
        [] as Array<{ time: string; value: number }>,
      );

    lineSeries.setData(data as Array<{ time: string; value: number }>);

    // Build markers for buy/sell orders on the equity curve
    if (orders && orders.length > 0) {
      // Build sorted array of [barIndex, time] from snapshots for nearest-match lookup
      const snapshotBars: Array<{ bar: number; time: string }> = [];
      for (const s of snapshots) {
        const barIdx = s.barIndex as number;
        if (hasTimestamps && s.timestampSimulated) {
          const date = parseDate(s.timestampSimulated as string);
          if (date) {
            snapshotBars.push({
              bar: barIdx,
              time: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
            });
          }
        } else {
          snapshotBars.push({ bar: barIdx, time: String(barIdx + 1) });
        }
      }
      snapshotBars.sort((a, b) => a.bar - b.bar);

      // Find the nearest snapshot time for a given barIndex
      function findNearestTime(barIdx: number): string | null {
        if (snapshotBars.length === 0) return null;
        let lo = 0, hi = snapshotBars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (snapshotBars[mid].bar < barIdx) lo = mid + 1;
          else hi = mid;
        }
        // lo is the first bar >= barIdx; check lo and lo-1 for nearest
        if (lo > 0 && Math.abs(snapshotBars[lo - 1].bar - barIdx) <= Math.abs(snapshotBars[lo].bar - barIdx)) {
          return snapshotBars[lo - 1].time;
        }
        return snapshotBars[lo].time;
      }

      const markers: SeriesMarker<Time>[] = orders
        .map((order) => {
          const barIdx = order.barIndex as number;
          const side = order.side as string;
          const time = findNearestTime(barIdx);
          if (!time) return null;

          return {
            time: time as Time,
            position: side === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
            color: side === 'buy' ? '#22c55e' : '#ef4444',
            shape: side === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,
            text: side === 'buy' ? 'B' : 'S',
          };
        })
        .filter((m): m is SeriesMarker<Time> => m !== null)
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

      lineSeries.setMarkers(markers);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartInstanceRef.current = null;
    };
  }, [snapshots]);

  if (snapshots.length === 0) {
    return <div className="text-gray-400">No portfolio data yet.</div>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Equity Curve</h3>
      <div ref={chartRef} />
    </div>
  );
}
