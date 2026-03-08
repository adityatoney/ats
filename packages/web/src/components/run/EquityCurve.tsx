import { useEffect, useRef } from 'react';
import { createChart, type IChartApi } from 'lightweight-charts';

interface Props {
  snapshots: Array<Record<string, unknown>>;
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

export function EquityCurve({ snapshots }: Props) {
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
