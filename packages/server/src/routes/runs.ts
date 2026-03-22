import { Hono } from 'hono';
import { eq, desc, asc } from 'drizzle-orm';
import { db } from '../lib/db';
import { runs, orders, fills, portfolioSnapshots, agentEvents, checkpoints } from '@aegis/db/schema';
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
  return c.json({ data: run }, 201);
});

runRoutes.get('/:id', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  const run = await db.query.runs.findFirst({ where: eq(runs.id, id) });
  if (!run) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
  return c.json({ data: run });
});

runRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '50');

  const events = await db.query.agentEvents.findMany({
    where: eq(agentEvents.runId, id),
    orderBy: [asc(agentEvents.createdAt)],
    offset,
    limit,
  });
  return c.json({ data: events });
});

runRoutes.get('/:id/orders', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  const orderList = await db
    .select({
      id: orders.id,
      runId: orders.runId,
      symbol: orders.symbol,
      side: orders.side,
      orderType: orders.orderType,
      quantity: orders.quantity,
      limitPrice: orders.limitPrice,
      stopPrice: orders.stopPrice,
      status: orders.status,
      submittedAtSim: orders.submittedAtSim,
      filledAtSim: orders.filledAtSim,
      barIndex: orders.barIndex,
      createdAt: orders.createdAt,
      fillPrice: fills.fillPrice,
      fee: fills.fee,
      slippage: fills.slippage,
    })
    .from(orders)
    .leftJoin(fills, eq(fills.orderId, orders.id))
    .where(eq(orders.runId, id))
    .orderBy(orders.barIndex);
  return c.json({ data: orderList });
});

runRoutes.get('/:id/portfolio', agentIsolation('run'), async (c) => {
  const id = c.req.param('id');
  const snapshots = await db.query.portfolioSnapshots.findMany({
    where: eq(portfolioSnapshots.runId, id),
    orderBy: [portfolioSnapshots.barIndex],
  });
  return c.json({ data: snapshots });
});

runRoutes.get('/:id/checkpoints', async (c) => {
  const id = c.req.param('id');
  const cps = await db.query.checkpoints.findMany({
    where: eq(checkpoints.runId, id),
    orderBy: [checkpoints.barIndex],
  });
  return c.json({ data: cps });
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
  const run = await db.query.runs.findFirst({ where: eq(runs.id, id) });
  if (!run) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const { pythonClient } = await import('../lib/python-client');

  // If run is part of a tournament, include competitive context
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
