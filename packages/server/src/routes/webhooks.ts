import { Hono } from 'hono';
import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { runManager } from '../services/run-manager';

export const webhookRoutes = new Hono();

webhookRoutes.post('/runtime-event', async (c) => {
  const body = await c.req.json();
  const { runId, eventType, payload, timestampSimulated, barIndex } = body;

  // Log event
  await convex.mutation(api.webhookHandlers.logAgentEvent, {
    runId: runId as any,
    eventType,
    payload: payload || {},
    timestampSimulated: timestampSimulated ? new Date(timestampSimulated).getTime() : undefined,
    barIndex: barIndex ?? undefined,
  });

  // Persist to dedicated tables based on event type
  if (eventType === 'order.submitted') {
    await convex.mutation(api.webhookHandlers.handleOrderSubmitted, {
      runId: runId as any,
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.order_type,
      quantity: payload.quantity,
      barIndex: payload.bar_index ?? 0,
      submittedAtSim: payload.timestamp ? new Date(payload.timestamp).getTime() : undefined,
    });
  } else if (eventType === 'order.filled') {
    await convex.mutation(api.webhookHandlers.handleOrderFilled, {
      runId: runId as any,
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.order_type,
      quantity: payload.quantity,
      fillPrice: payload.fill_price,
      fee: payload.fee ?? 0,
      slippage: payload.slippage ?? 0,
      barIndex: payload.bar_index ?? 0,
      filledAtSim: payload.timestamp ? new Date(payload.timestamp).getTime() : undefined,
    });
  } else if (eventType === 'run.progress') {
    await convex.mutation(api.webhookHandlers.handleRunProgress, {
      runId: runId as any,
      barIndex: payload.barIndex,
      timestampSimulated: payload.timestampSimulated ? new Date(payload.timestampSimulated).getTime() : undefined,
      cash: payload.cash ?? 0,
      equity: payload.equity ?? 0,
      positionsJson: payload.positionsJson ?? {},
      drawdown: payload.drawdown ?? 0,
      highWaterMark: payload.highWaterMark ?? 0,
      processedBars: payload.processedBars || 0,
      totalBars: payload.totalBars || 0,
    });
  } else if (eventType === 'checkpoint.saved') {
    await convex.mutation(api.webhookHandlers.handleCheckpointSaved, {
      runId: runId as any,
      barIndex: payload.barIndex ?? 0,
      state: payload.state ?? {},
    });
  } else if (eventType === 'run.completed') {
    const result = await convex.mutation(api.webhookHandlers.handleRunCompleted, {
      runId: runId as any,
      metrics: payload.metrics || undefined,
      processedBars: payload.processedBars || 0,
    });

    // Tournament handling
    if (result?.tournamentId) {
      const { tournamentManager } = await import('../services/tournament-manager');
      await tournamentManager.handleRunCompleted(runId, result.tournamentId);
    }
  } else if (eventType === 'run.failed') {
    const result = await convex.mutation(api.webhookHandlers.handleRunFailed, {
      runId: runId as any,
      error: payload.error || 'Unknown error',
    });

    // Tournament handling
    if (result?.tournamentId) {
      const { tournamentManager } = await import('../services/tournament-manager');
      await tournamentManager.handleRunFailed(runId, result.tournamentId);
    }
  } else if (eventType === 'soul.generated') {
    if (payload.soulMd && payload.soulJson) {
      await convex.mutation(api.webhookHandlers.handleSoulGenerated, {
        runId: runId as any,
        soulMd: payload.soulMd,
        soulJson: payload.soulJson,
      });
    }
  } else if (eventType === 'branch.completed' && payload.resultDelta) {
    await convex.mutation(api.webhookHandlers.handleBranchCompleted, {
      runId: runId as any,
      resultDelta: payload.resultDelta,
    });
  }

  // Fan out to SSE
  runManager.handleRuntimeEvent({ runId, eventType, payload, timestampSimulated, barIndex });

  return c.json({ ok: true });
});
