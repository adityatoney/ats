import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  agentEvents,
  runs,
  agents,
  soulVersions,
  branches,
  orders,
  fills,
  portfolioSnapshots,
  checkpoints,
} from '@aegis/db/schema';
import { runManager } from '../services/run-manager';

export const webhookRoutes = new Hono();

webhookRoutes.post('/runtime-event', async (c) => {
  const body = await c.req.json();
  const { runId, eventType, payload, timestampSimulated, barIndex } = body;

  // Store event in agent_events
  await db.insert(agentEvents).values({
    runId,
    eventType,
    payload: payload || {},
    timestampSimulated: timestampSimulated || null,
    barIndex: barIndex ?? null,
  });

  // Persist to dedicated tables based on event type
  if (eventType === 'order.submitted') {
    await db.insert(orders).values({
      runId,
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.order_type,
      quantity: String(payload.quantity),
      status: 'pending',
      barIndex: payload.bar_index ?? 0,
      submittedAtSim: payload.timestamp ? new Date(payload.timestamp) : null,
    });
  } else if (eventType === 'order.filled') {
    // Try to find and update the matching pending order
    const pendingOrder = await db.query.orders.findFirst({
      where: and(
        eq(orders.runId, runId),
        eq(orders.symbol, payload.symbol),
        eq(orders.side, payload.side),
        eq(orders.status, 'pending'),
      ),
    });

    if (pendingOrder) {
      const filledAtSim = payload.timestamp ? new Date(payload.timestamp) : null;
      await db
        .update(orders)
        .set({ status: 'filled', barIndex: payload.bar_index ?? pendingOrder.barIndex, filledAtSim })
        .where(eq(orders.id, pendingOrder.id));

      await db.insert(fills).values({
        orderId: pendingOrder.id,
        runId,
        fillPrice: String(payload.fill_price),
        fillQuantity: String(payload.quantity),
        fee: String(payload.fee ?? 0),
        slippage: String(payload.slippage ?? 0),
        filledAtSim,
      });
    } else {
      // No matching pending order found — insert as filled directly
      const filledAt = payload.timestamp ? new Date(payload.timestamp) : null;
      const [newOrder] = await db
        .insert(orders)
        .values({
          runId,
          symbol: payload.symbol,
          side: payload.side,
          orderType: payload.order_type,
          quantity: String(payload.quantity),
          status: 'filled',
          barIndex: payload.bar_index ?? 0,
          submittedAtSim: filledAt,
          filledAtSim: filledAt,
        })
        .returning();

      await db.insert(fills).values({
        orderId: newOrder.id,
        runId,
        fillPrice: String(payload.fill_price),
        fillQuantity: String(payload.quantity),
        fee: String(payload.fee ?? 0),
        slippage: String(payload.slippage ?? 0),
        filledAtSim: filledAt,
      });
    }
  } else if (eventType === 'run.progress') {
    // Persist portfolio snapshot (sent every 5 bars)
    if (payload.barIndex !== undefined) {
      await db.insert(portfolioSnapshots).values({
        runId,
        barIndex: payload.barIndex,
        timestampSimulated: payload.timestampSimulated ? new Date(payload.timestampSimulated) : null,
        cash: String(payload.cash ?? 0),
        equity: String(payload.equity ?? 0),
        positionsJson: payload.positionsJson ?? {},
        drawdown: String(payload.drawdown ?? 0),
        highWaterMark: String(payload.highWaterMark ?? 0),
      });
    }

    await db
      .update(runs)
      .set({
        status: 'running',
        processedBars: payload.processedBars || 0,
        totalBars: payload.totalBars || 0,
      })
      .where(eq(runs.id, runId));
  } else if (eventType === 'checkpoint.saved') {
    await db.insert(checkpoints).values({
      runId,
      barIndex: payload.barIndex ?? 0,
      stateBlob: payload.state ?? {},
    });
  } else if (eventType === 'run.completed') {
    await db
      .update(runs)
      .set({
        status: 'completed',
        metricsJson: payload.metrics || null,
        processedBars: payload.processedBars || 0,
        completedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (run) {
      await db.update(agents).set({ status: 'idle' }).where(eq(agents.id, run.agentId));
    }
  } else if (eventType === 'run.failed') {
    await db
      .update(runs)
      .set({
        status: 'failed',
        errorMessage: payload.error || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (run) {
      await db.update(agents).set({ status: 'idle' }).where(eq(agents.id, run.agentId));
    }
  } else if (eventType === 'soul.generated') {
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (run && payload.soulMd && payload.soulJson) {
      const latestSoul = await db.query.soulVersions.findFirst({
        where: eq(soulVersions.agentId, run.agentId),
        orderBy: (sv, { desc }) => [desc(sv.version)],
      });
      await db.insert(soulVersions).values({
        agentId: run.agentId,
        version: (latestSoul?.version || 0) + 1,
        soulMd: payload.soulMd,
        soulJson: payload.soulJson,
        status: 'pending',
        derivedFromRunId: runId,
      });
    }
  } else if (eventType === 'branch.completed' && payload.resultDelta) {
    await db
      .update(branches)
      .set({
        resultDeltaJson: payload.resultDelta,
        status: 'completed',
      })
      .where(eq(branches.runId, runId));
  }

  // Fan out to SSE
  runManager.handleRuntimeEvent({ runId, eventType, payload, timestampSimulated, barIndex });

  return c.json({ ok: true });
});
