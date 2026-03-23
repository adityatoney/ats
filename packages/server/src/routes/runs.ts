import { Hono } from 'hono';
import { convex, normalize, normalizeAll } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { runManager } from '../services/run-manager';
import { agentIsolation } from '../middleware/agent-isolation';
import { deleteRun } from '../services/delete-service';

export const runRoutes = new Hono();

runRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await deleteRun(id);
    return c.json({ data: { deleted: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    const status = message.includes('not found') ? 404 : message.includes('Cannot delete') ? 409 : 500;
    return c.json({ error: { message, code: 'DELETE_FAILED' } }, status);
  }
});

runRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const run = await runManager.startBacktest(body.agentId, {
    symbols: body.symbols,
    startDate: body.startDate,
    endDate: body.endDate,
    timeframe: body.timeframe || '1Day',
    initialCapital: body.initialCapital || 100000,
    slippageBps: body.slippageBps ?? 0,
    feePerShare: body.feePerShare ?? 0,
    feePercentage: body.feePercentage ?? 0,
    seed: body.seed || 42,
    checkpointInterval: body.checkpointInterval || 50,
  });
  return c.json({ data: run ? normalize(run) : run }, 201);
});

runRoutes.get('/:id', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  const run = await convex.query(api.runs.get, { id: id as any });
  if (!run) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
  return c.json({ data: normalize(run) });
});

runRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '50');

  const events = await convex.query(api.agentEvents.listByRunPaginated, {
    runId: id as any,
    offset,
    limit,
  });
  return c.json({ data: normalizeAll(events) });
});

runRoutes.get('/:id/orders', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  // Fetch orders and fills separately, then merge (replaces LEFT JOIN)
  const orderList = await convex.query(api.orders.listByRun, { runId: id as any });
  const fillsList = await convex.query(api.fills.listByRun, { runId: id as any });

  // Create a map of orderId → fill
  const fillByOrder = new Map<string, any>();
  for (const fill of fillsList) {
    fillByOrder.set(fill.orderId, fill);
  }

  // Merge orders with their fills
  const merged = orderList.map((order) => {
    const fill = fillByOrder.get(order._id);
    return {
      ...order,
      id: order._id,
      fillPrice: fill?.fillPrice ?? null,
      fee: fill?.fee ?? null,
      slippage: fill?.slippage ?? null,
    };
  });

  return c.json({ data: merged });
});

runRoutes.get('/:id/portfolio', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  const maxPoints = parseInt(c.req.query('maxPoints') || '500');
  const snapshots = await convex.query(api.portfolioSnapshots.listByRun, { runId: id as any });

  // Downsample if we have more points than requested
  let sampled = snapshots;
  if (snapshots.length > maxPoints && maxPoints > 2) {
    const step = (snapshots.length - 1) / (maxPoints - 1);
    sampled = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      sampled.push(snapshots[Math.round(i * step)]);
    }
    sampled.push(snapshots[snapshots.length - 1]); // always include last
  }

  // Strip positionsJson to reduce payload size (only needed for positions table, not chart)
  const slim = normalizeAll(sampled).map(({ positionsJson, ...rest }) => rest);
  return c.json({ data: slim });
});

runRoutes.get('/:id/checkpoints', async (c) => {
  const id = c.req.param('id');
  const cps = await convex.query(api.checkpoints.listByRun, { runId: id as any });
  return c.json({ data: normalizeAll(cps) });
});

runRoutes.post('/:id/pause', async (c) => {
  const id = c.req.param('id');
  await runManager.pauseRun(id);
  return c.json({ data: { status: 'paused' } });
});

runRoutes.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  await runManager.resumeRun(id);
  return c.json({ data: { status: 'running' } });
});

runRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  await runManager.cancelRun(id);
  return c.json({ data: { status: 'cancelled' } });
});

runRoutes.post('/:id/generate-soul', async (c) => {
  const id = c.req.param('id');
  const run = await convex.query(api.runs.get, { id: id as any });
  if (!run) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const { pythonClient } = await import('../lib/python-client');

  let competitiveContext: Record<string, unknown> | undefined;
  if (run.tournamentId) {
    const { leaderboardService } = await import('../services/leaderboard-service');
    const standing = await leaderboardService.getAgentStanding(run.tournamentId, run.agentId);
    if (standing) {
      competitiveContext = standing;
    }
  }

  await pythonClient.generateSoul({ runId: id, agentId: run.agentId, competitiveContext });
  return c.json({ data: { status: 'generating' } });
});

// PATCH endpoint for Python runtime to update run
runRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  await convex.mutation(api.runs.update, { id: id as any, ...body });
  const updated = await convex.query(api.runs.get, { id: id as any });
  return c.json({ data: updated ? normalize(updated) : updated });
});
