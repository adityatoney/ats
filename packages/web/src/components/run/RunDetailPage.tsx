import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useRun, useRunOrders, useRunPortfolio } from '../../hooks/useRun';
import { useSSE } from '../../hooks/useSSE';
import { api } from '../../lib/api-client';
import { EquityCurve } from './EquityCurve';
import { TradeLedger } from './TradeLedger';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: run, isLoading, refetch } = useRun(id);
  const { data: orders } = useRunOrders(id);
  const { data: portfolio } = useRunPortfolio(id);
  const { events: sseEvents, connected, totalReceived } = useSSE(id);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'events' | 'branches'>(
    'overview',
  );
  const prevTotalReceived = useRef(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Live progress from SSE — avoids DB refetch for progress bar
  const [liveProgress, setLiveProgress] = useState<{
    processedBars: number;
    totalBars: number;
  } | null>(null);

  // Live snapshots from SSE — feeds chart in real-time without waiting for DB
  const liveSnapshotsRef = useRef<Map<number, Record<string, unknown>>>(new Map());
  const [liveSnapshotVersion, setLiveSnapshotVersion] = useState(0);
  const chartRenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live orders from SSE — markers appear immediately
  const liveOrdersRef = useRef<Array<Record<string, unknown>>>([]);

  // Live metrics from SSE run.completed — show immediately without waiting for DB
  const [liveMetrics, setLiveMetrics] = useState<Record<string, number> | null>(null);

  // Throttled invalidation refs
  const lastInvalidateTime = useRef(0);
  const pendingInvalidations = useRef({ run: false, orders: false, portfolio: false });
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushInvalidations = useCallback(() => {
    const p = pendingInvalidations.current;
    if (p.run) queryClient.invalidateQueries({ queryKey: ['run', id] });
    if (p.orders) queryClient.invalidateQueries({ queryKey: ['run-orders', id] });
    if (p.portfolio) queryClient.invalidateQueries({ queryKey: ['run-portfolio', id] });
    pendingInvalidations.current = { run: false, orders: false, portfolio: false };
    lastInvalidateTime.current = Date.now();
    if (throttleTimer.current) {
      clearTimeout(throttleTimer.current);
      throttleTimer.current = null;
    }
  }, [queryClient, id]);

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteRun(id!),
    onSuccess: () => {
      const agentId = (run as Record<string, unknown>)?.agentId as string | undefined;
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      if (agentId) {
        queryClient.invalidateQueries({ queryKey: ['agent-runs', agentId] });
        navigate(`/agents/${agentId}`);
      } else {
        navigate('/');
      }
    },
    onError: (err) => {
      setShowDeleteConfirm(false);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete run');
    },
  });

  // SSE-driven query invalidation — throttled to at most 1/sec
  useEffect(() => {
    if (totalReceived <= prevTotalReceived.current) return;
    // Compute how many new events arrived; pull from the tail of the (capped) array
    const numNew = Math.min(totalReceived - prevTotalReceived.current, sseEvents.length);
    const newEvents = sseEvents.slice(sseEvents.length - numNew);
    prevTotalReceived.current = totalReceived;

    for (const event of newEvents) {
      // Terminal events: invalidate everything immediately, no throttle
      if (event.type === 'run.completed' || event.type === 'run.failed') {
        // Show metrics immediately from SSE — don't wait for DB
        const data = event.data as Record<string, unknown>;
        if (data.metrics) {
          setLiveMetrics(data.metrics as Record<string, number>);
        }
        setLiveProgress(null);
        liveSnapshotsRef.current.clear();
        liveOrdersRef.current = [];
        if (chartRenderTimer.current) {
          clearTimeout(chartRenderTimer.current);
          chartRenderTimer.current = null;
        }
        setLiveSnapshotVersion((v) => v + 1);
        queryClient.invalidateQueries({ queryKey: ['run', id] });
        queryClient.invalidateQueries({ queryKey: ['run-orders', id] });
        queryClient.invalidateQueries({ queryKey: ['run-portfolio', id] });
        pendingInvalidations.current = { run: false, orders: false, portfolio: false };
        return;
      }

      if (event.type === 'run.started') {
        pendingInvalidations.current.run = true;
      }

      if (event.type === 'run.progress') {
        const data = event.data as Record<string, unknown>;
        // Update progress bar directly from SSE (lightweight — always immediate)
        setLiveProgress({
          processedBars: (data.processedBars as number) ?? 0,
          totalBars: (data.totalBars as number) ?? 0,
        });
        // Accumulate snapshot — chart render is throttled below
        const barIndex = data.barIndex as number | undefined;
        if (barIndex !== undefined) {
          liveSnapshotsRef.current.set(barIndex, {
            barIndex,
            timestampSimulated: data.timestampSimulated,
            cash: data.cash ?? 0,
            equity: data.equity ?? 0,
            positionsJson: data.positionsJson ?? {},
            drawdown: data.drawdown ?? 0,
            highWaterMark: data.highWaterMark ?? 0,
          });
        }
        pendingInvalidations.current.portfolio = true;
      }

      if (event.type === 'run.paused') {
        pendingInvalidations.current.run = true;
      }

      if (event.type === 'order.filled') {
        // Accumulate live order for immediate marker rendering
        const data = event.data as Record<string, unknown>;
        liveOrdersRef.current.push({
          symbol: data.symbol,
          side: data.side,
          orderType: data.order_type,
          quantity: data.quantity,
          status: 'filled',
          fillPrice: data.fill_price,
          filledAtSim: data.timestamp ? new Date(data.timestamp as string).getTime() : undefined,
          submittedAtSim: data.timestamp ? new Date(data.timestamp as string).getTime() : undefined,
        });
        pendingInvalidations.current.orders = true;
      }

      if (event.type === 'order.submitted') {
        pendingInvalidations.current.orders = true;
      }
    }

    // Throttle chart re-renders to ~10fps (100ms) — batch multiple SSE events
    if (!chartRenderTimer.current && liveSnapshotsRef.current.size > 0) {
      chartRenderTimer.current = setTimeout(() => {
        chartRenderTimer.current = null;
        setLiveSnapshotVersion((v) => v + 1);
      }, 100);
    }

    // Throttle: flush at most once per second
    const now = Date.now();
    const elapsed = now - lastInvalidateTime.current;
    if (elapsed >= 1000) {
      flushInvalidations();
    } else if (!throttleTimer.current) {
      throttleTimer.current = setTimeout(flushInvalidations, 1000 - elapsed);
    }
  }, [totalReceived, sseEvents, id, queryClient, flushInvalidations]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
      if (chartRenderTimer.current) clearTimeout(chartRenderTimer.current);
    };
  }, []);

  // Load historical events from DB
  const { data: dbEvents } = useQuery({
    queryKey: ['run-events', id],
    queryFn: () => api.getRunEvents(id!, 0, 500) as Promise<Array<Record<string, unknown>>>,
    enabled: !!id && activeTab === 'events',
  });

  // Load branch DAG
  const { data: branchDAG } = useQuery({
    queryKey: ['branch-dag', id],
    queryFn: () => api.getBranchDAG(id!) as Promise<Record<string, unknown>>,
    enabled: !!id && activeTab === 'branches',
  });

  // Load checkpoints for branching
  const { data: checkpointList } = useQuery({
    queryKey: ['run-checkpoints', id],
    queryFn: () => api.getRunCheckpoints(id!) as Promise<Array<Record<string, unknown>>>,
    enabled: !!id && activeTab === 'branches',
  });

  // Merge DB portfolio with live SSE snapshots for real-time chart
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void liveSnapshotVersion; // dependency — triggers re-render when chart timer fires
  const mergedSnapshots = (() => {
    const dbSnaps = (portfolio as Array<Record<string, unknown>>) || [];
    if (liveSnapshotsRef.current.size === 0) return dbSnaps;
    // Fast path: find max barIndex in DB, take only live snapshots beyond it
    const maxDbBar = dbSnaps.length > 0
      ? Math.max(...dbSnaps.map((s) => (s.barIndex as number) ?? 0))
      : -1;
    const liveOnly: Record<string, unknown>[] = [];
    for (const snap of liveSnapshotsRef.current.values()) {
      if ((snap.barIndex as number) > maxDbBar) liveOnly.push(snap);
    }
    if (liveOnly.length === 0) return dbSnaps;
    // Live snapshots are inserted in order, just sort the tail
    liveOnly.sort((a, b) => (a.barIndex as number) - (b.barIndex as number));
    return [...dbSnaps, ...liveOnly];
  })();

  // Merge DB orders with live SSE orders for immediate markers
  const mergedOrders = (() => {
    const dbOrders = (orders as Array<Record<string, unknown>>) || [];
    if (liveOrdersRef.current.length === 0) return dbOrders;
    // Find max filledAtSim in DB orders to avoid duplicates
    const dbTimestamps = new Set(
      dbOrders.map((o) => `${o.symbol}-${o.side}-${o.filledAtSim}`),
    );
    const liveOnly = liveOrdersRef.current.filter(
      (o) => !dbTimestamps.has(`${o.symbol}-${o.side}-${o.filledAtSim}`),
    );
    if (liveOnly.length === 0) return dbOrders;
    return [...dbOrders, ...liveOnly];
  })();

  const runData = run as Record<string, unknown> | undefined;
  // Use live metrics (from SSE) if available, fall back to DB
  const metrics = liveMetrics ?? (runData?.metricsJson as Record<string, number> | null);

  if (isLoading)
    return (
      <Layout>
        <div className="text-gray-400">Loading...</div>
      </Layout>
    );
  if (!runData)
    return (
      <Layout>
        <div className="text-gray-400">Run not found</div>
      </Layout>
    );

  const status = runData.status as string;
  // Use live SSE progress if available, fall back to DB data
  const processedBars = liveProgress?.processedBars ?? ((runData.processedBars as number) || 0);
  const totalBars = liveProgress?.totalBars ?? ((runData.totalBars as number) || 0);
  const progress = totalBars > 0 ? (processedBars / totalBars) * 100 : 0;

  // Merge SSE events with DB events for the events tab
  const allEvents =
    dbEvents && dbEvents.length > 0
      ? dbEvents.map((e) => ({
          type: e.eventType as string,
          data: e.payload as Record<string, unknown>,
          time: (e._creationTime ? new Date(e._creationTime as number).toISOString() : e.createdAt) as string,
        }))
      : sseEvents.map((e) => ({
          type: e.type,
          data: e.data,
          time: new Date().toISOString(),
        }));

  const dagNodes = (branchDAG as Record<string, unknown[]> | undefined)?.nodes || [];
  const dagEdges = (branchDAG as Record<string, unknown[]> | undefined)?.edges || [];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/" className="text-sm text-gray-400 hover:text-gray-300">
              &larr; Dashboard
            </Link>
            <h1 className="text-2xl font-bold mt-1">Run {(runData.id as string).slice(0, 8)}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Status: <span className="text-gray-300">{status}</span>
              {Boolean(runData.configJson) && (
                <>
                  {' | '}
                  Symbols:{' '}
                  <span className="text-gray-300">
                    {((runData.configJson as Record<string, unknown>).symbols as string[])?.join(
                      ', ',
                    )}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-500'}`}
            />
            <RunControls status={status} runId={id!} onAction={refetch} />
            {['completed', 'failed', 'cancelled'].includes(status) && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          title="Delete Run"
          message="This will permanently delete this run and all its trade history, snapshots, and events. This cannot be undone."
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
          isLoading={deleteMutation.isPending}
        />

        {deleteError && (
          <div className="rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-300">
            {deleteError}
          </div>
        )}

        {/* Progress */}
        {(status === 'running' || status === 'pending') && (
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">
                {status === 'pending' ? 'Pending...' : 'Running...'}
              </span>
              <span className="text-gray-300">
                {processedBars} / {totalBars} bars
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Metrics */}
        {metrics && <MetricsScorecard metrics={metrics} />}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800">
          {(['overview', 'trades', 'events', 'branches'] as const).map((tab) => (
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

        {activeTab === 'overview' && (
          <EquityCurve
            snapshots={mergedSnapshots}
            orders={mergedOrders}
          />
        )}
        {activeTab === 'trades' && (
          <TradeLedger orders={(orders as Array<Record<string, unknown>>) || []} />
        )}
        {activeTab === 'events' && (
          <div className="space-y-2">
            {allEvents.length === 0 ? (
              <p className="text-gray-400">No events yet.</p>
            ) : (
              allEvents
                .slice()
                .reverse()
                .slice(0, 100)
                .map((event, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-blue-400 font-mono">{event.type}</span>
                      {event.time && (
                        <span className="text-xs text-gray-600">
                          {new Date(event.time).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    <pre className="text-gray-400 mt-1 text-xs overflow-x-auto">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </div>
                ))
            )}
          </div>
        )}
        {activeTab === 'branches' && (
          <BranchesTab
            runId={id!}
            nodes={dagNodes as Array<Record<string, unknown>>}
            edges={dagEdges as Array<Record<string, unknown>>}
            checkpoints={(checkpointList as Array<Record<string, unknown>>) || []}
          />
        )}
      </div>
    </Layout>
  );
}

function MetricsScorecard({ metrics }: { metrics: Record<string, number> }) {
  const fmt = (v: number, decimals = 2) => v.toFixed(decimals);
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const fmtDollar = (v: number) => {
    const sign = v >= 0 ? '' : '-';
    return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const profitColor = (v: number) => (v >= 0 ? 'text-green-400' : 'text-red-400');

  return (
    <div className="space-y-4">
      {/* P&L Overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Profit & Loss
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Net P&L"
            value={fmtDollar(metrics.netProfit)}
            color={profitColor(metrics.netProfit)}
          />
          <MetricCard
            label="Net Profit"
            value={fmtPct(metrics.totalReturn)}
            color={profitColor(metrics.totalReturn)}
          />
          <MetricCard label="Gross Profit" value={fmtDollar(metrics.grossProfit)} color="text-green-400" />
          <MetricCard label="Gross Loss" value={fmtDollar(metrics.grossLoss)} color="text-red-400" />
        </div>
      </div>

      {/* Performance */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Performance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Annualized Return" value={fmtPct(metrics.annualizedReturn)} color={profitColor(metrics.annualizedReturn)} />
          <MetricCard label="Buy & Hold Return" value={fmtPct(metrics.buyHoldReturn)} color={profitColor(metrics.buyHoldReturn)} />
          <MetricCard
            label="Max Drawdown"
            value={`${fmtPct(metrics.maxDrawdown)} (${fmtDollar(metrics.maxDrawdownDollars)})`}
            color="text-red-400"
          />
          <MetricCard label="Profit Factor" value={fmt(metrics.profitFactor, 3)} />
        </div>
      </div>

      {/* Risk */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Risk Ratios
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Sharpe Ratio" value={fmt(metrics.sharpeRatio, 4)} />
          <MetricCard label="Sortino Ratio" value={fmt(metrics.sortinoRatio ?? 0, 4)} />
          <MetricCard label="Win Rate" value={fmtPct(metrics.winRate)} />
          <MetricCard label="Avg Trade Return" value={fmtPct(metrics.avgTradeReturn)} />
        </div>
      </div>

      {/* Trade Statistics */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Trade Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Closed Trades" value={String(metrics.totalTrades)} />
          <MetricCard label="Winning Trades" value={String(metrics.numWinningTrades ?? 0)} color="text-green-400" />
          <MetricCard label="Losing Trades" value={String(metrics.numLosingTrades ?? 0)} color="text-red-400" />
          <MetricCard label="Avg Bars in Trades" value={fmt(metrics.avgBarsInTrades ?? 0, 1)} />
          <MetricCard label="Avg Win" value={fmtDollar(metrics.avgWin ?? 0)} color="text-green-400" />
          <MetricCard label="Avg Loss" value={fmtDollar(metrics.avgLoss ?? 0)} color="text-red-400" />
          <MetricCard label="Largest Win" value={fmtDollar(metrics.largestWin ?? 0)} color="text-green-400" />
          <MetricCard label="Largest Loss" value={fmtDollar(metrics.largestLoss ?? 0)} color="text-red-400" />
        </div>
      </div>

      {/* Position & Costs */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Position & Costs
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Max Contracts Held" value={fmt(metrics.maxContractsHeld ?? 0, 0)} />
          <MetricCard label="Open P&L" value={fmtDollar(metrics.openPL ?? 0)} color={profitColor(metrics.openPL ?? 0)} />
          <MetricCard label="Commission Paid" value={fmtDollar(metrics.totalCommission ?? 0)} />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-950/50 border border-gray-800/50 rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${color || 'text-gray-100'}`}>{value}</div>
    </div>
  );
}

function RunControls({
  status,
  runId,
  onAction,
}: {
  status: string;
  runId: string;
  onAction: () => void;
}) {
  return (
    <div className="flex gap-2">
      {status === 'running' && (
        <button
          onClick={async () => {
            await api.pauseRun(runId);
            onAction();
          }}
          className="px-3 py-1 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700"
        >
          Pause
        </button>
      )}
      {status === 'paused' && (
        <button
          onClick={async () => {
            await api.resumeRun(runId);
            onAction();
          }}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
        >
          Resume
        </button>
      )}
      {(status === 'running' || status === 'paused') && (
        <button
          onClick={async () => {
            await api.cancelRun(runId);
            onAction();
          }}
          className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          Cancel
        </button>
      )}
      {status === 'completed' && (
        <button
          onClick={async () => {
            await api.generateSoul(runId);
          }}
          className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
        >
          Generate Soul
        </button>
      )}
    </div>
  );
}

function BranchesTab({
  runId,
  nodes,
  edges,
  checkpoints,
}: {
  runId: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  checkpoints: Array<Record<string, unknown>>;
}) {
  const [forking, setForking] = useState(false);
  const [forkCheckpointId, setForkCheckpointId] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [rationale, setRationale] = useState('');
  const [overrides, setOverrides] = useState('{}');

  const handleFork = async () => {
    if (!forkCheckpointId || !changeSummary) return;
    setForking(true);
    try {
      await api.forkBranch(forkCheckpointId, {
        changeSummary,
        rationale,
        overrides: JSON.parse(overrides),
      });
      window.location.reload();
    } catch (err) {
      console.error('Fork failed:', err);
    } finally {
      setForking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Branch DAG */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Branch Tree</h3>
        {nodes.length === 0 ? (
          <p className="text-gray-400 text-sm">No branches yet.</p>
        ) : (
          <div className="space-y-2">
            {nodes.map((node) => {
              const data = node.data as Record<string, unknown>;
              const nodeMetrics = data.metrics as Record<string, number> | null;
              const delta = data.delta as Record<string, number> | null;
              const isRoot = !edges.some(
                (e) => (e as Record<string, unknown>).target === node.id,
              );

              return (
                <div
                  key={node.id as string}
                  className={`border rounded-lg p-3 ${isRoot ? 'border-blue-700 bg-blue-900/20' : 'border-gray-700 bg-gray-800/50 ml-8'}`}
                >
                  <div className="flex items-center justify-between">
                    <Link
                      to={`/runs/${node.id}`}
                      className="text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                      {data.label as string}
                    </Link>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        data.status === 'completed'
                          ? 'bg-green-900 text-green-300'
                          : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {data.status as string}
                    </span>
                  </div>
                  {nodeMetrics && (
                    <div className="flex gap-4 mt-1 text-xs text-gray-400">
                      <span>
                        Return: {((nodeMetrics.totalReturn || 0) * 100).toFixed(2)}%
                      </span>
                      <span>Sharpe: {(nodeMetrics.sharpeRatio || 0).toFixed(2)}</span>
                    </div>
                  )}
                  {delta && (
                    <div className="flex gap-4 mt-1 text-xs">
                      <span
                        className={
                          (delta.total_return_delta || 0) >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        }
                      >
                        Delta: {((delta.total_return_delta || 0) * 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fork from checkpoint */}
      {checkpoints.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Fork Branch</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Checkpoint</label>
              <select
                value={forkCheckpointId}
                onChange={(e) => setForkCheckpointId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              >
                <option value="">Select checkpoint...</option>
                {checkpoints.map((cp) => (
                  <option key={cp.id as string} value={cp.id as string}>
                    Bar {cp.barIndex as number}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Change Summary</label>
              <input
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="e.g., Increase entry threshold"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rationale</label>
              <input
                type="text"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why this change?"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Strategy Overrides (JSON)
              </label>
              <textarea
                value={overrides}
                onChange={(e) => setOverrides(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono h-20"
              />
            </div>
            <button
              onClick={handleFork}
              disabled={forking || !forkCheckpointId || !changeSummary}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {forking ? 'Forking...' : 'Fork Branch'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
