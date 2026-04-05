import { Hono } from 'hono';
import { runManager } from '../services/run-manager';
import { tournamentLiveProgress } from '../services/tournament-live-progress';
import { writeQueue } from '../services/write-queue';

export const webhookRoutes = new Hono();

// Single event endpoint (backward compat + used by Python before batch sender)
webhookRoutes.post('/runtime-event', async (c) => {
  const body = await c.req.json();
  const { runId, eventType, payload, timestampSimulated, barIndex } = body;

  // 1. Fan out to SSE immediately — before any DB write
  runManager.handleRuntimeEvent({ runId, eventType, payload, timestampSimulated, barIndex });
  void tournamentLiveProgress.handleRuntimeEvent(runId, eventType, payload || {});

  // 2. Enqueue for batched DB write (async, non-blocking)
  writeQueue.enqueue({ runId, eventType, payload: payload || {} });

  return c.json({ ok: true });
});

// Batch event endpoint — Python EventSender sends events in batches
webhookRoutes.post('/runtime-events-batch', async (c) => {
  const { events } = await c.req.json();

  // 1. Fan out each event to SSE immediately
  for (const event of events) {
    runManager.handleRuntimeEvent({
      runId: event.runId,
      eventType: event.eventType,
      payload: event.payload,
    });
    void tournamentLiveProgress.handleRuntimeEvent(event.runId, event.eventType, event.payload || {});
  }

  // 2. Enqueue all for batched DB write
  writeQueue.enqueueBatch(
    events.map((event: { runId: string; eventType: string; payload?: Record<string, unknown> }) => ({
      runId: event.runId,
      eventType: event.eventType,
      payload: event.payload || {},
    })),
  );

  return c.json({ ok: true, queued: events.length });
});
