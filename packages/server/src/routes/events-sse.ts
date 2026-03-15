import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eventBus, type RuntimeEvent } from '../services/event-bus';

export const sseRoutes = new Hono();

sseRoutes.get('/stream/tournament/:tournamentId', async (c) => {
  const tournamentId = c.req.param('tournamentId');

  return streamSSE(c, async (stream) => {
    const queue: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    let resolve: (() => void) | null = null;

    const handler = (event: { eventType: string; payload: Record<string, unknown> }) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const unsubscribe = eventBus.subscribeToTournament(tournamentId, handler);

    stream.onAbort(() => {
      unsubscribe();
    });

    while (true) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        await stream.writeSSE({
          event: event.eventType,
          data: JSON.stringify(event),
          id: Date.now().toString(),
        });
      }

      const waitForEvent = new Promise<void>((r) => {
        resolve = r;
      });
      const pingTimeout = new Promise<void>((r) => setTimeout(r, 15000));

      await Promise.race([waitForEvent, pingTimeout]);

      if (queue.length === 0) {
        await stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ time: Date.now() }),
        });
      }
    }
  });
});

sseRoutes.get('/stream/:runId', async (c) => {
  const runId = c.req.param('runId');

  return streamSSE(c, async (stream) => {
    // Use a queue + resolver pattern so the EventEmitter callback
    // can push events that the async streaming loop picks up.
    const queue: RuntimeEvent[] = [];
    let resolve: (() => void) | null = null;

    const handler = (event: RuntimeEvent) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const unsubscribe = eventBus.subscribeToRun(runId, handler);

    stream.onAbort(() => {
      unsubscribe();
    });

    // Main loop: drain the queue, then wait for new events or ping timeout
    while (true) {
      // Drain all queued events
      while (queue.length > 0) {
        const event = queue.shift()!;
        await stream.writeSSE({
          event: event.eventType,
          data: JSON.stringify(event),
          id: Date.now().toString(),
        });
      }

      // Wait for either a new event or 15s ping interval
      const waitForEvent = new Promise<void>((r) => {
        resolve = r;
      });
      const pingTimeout = new Promise<void>((r) => setTimeout(r, 15000));

      await Promise.race([waitForEvent, pingTimeout]);

      // If no events were queued during the wait, send a ping
      if (queue.length === 0) {
        await stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ time: Date.now() }),
        });
      }
    }
  });
});
