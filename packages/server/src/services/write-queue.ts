import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

interface QueuedEvent {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 200;

const PRIORITY_EVENTS = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'checkpoint.saved',
  'soul.generated',
  'branch.completed',
]);

class WriteQueue {
  private buffer: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  enqueue(event: QueuedEvent): void {
    this.buffer.push(event);

    if (PRIORITY_EVENTS.has(event.eventType)) {
      this.flush();
      return;
    }

    if (this.buffer.length >= MAX_BATCH_SIZE) {
      this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0 || this.flushing) return;

    this.flushing = true;
    const batch = this.buffer.splice(0, MAX_BATCH_SIZE);

    try {
      const results = await convex.mutation(
        api.webhookHandlers.processBatch,
        {
          events: batch.map((e) => ({
            runId: e.runId,
            eventType: e.eventType,
            payload: e.payload,
          })),
        }
      );

      // Handle tournament callbacks for terminal events
      if (results && Array.isArray(results)) {
        for (const result of results) {
          if (result.tournamentId) {
            const { tournamentManager } = await import('./tournament-manager');
            if (result.eventType === 'run.completed') {
              await tournamentManager.handleRunCompleted(
                // Find the matching runId from the batch
                batch.find((e) => e.eventType === 'run.completed')!.runId,
                result.tournamentId
              );
            } else if (result.eventType === 'run.failed') {
              await tournamentManager.handleRunFailed(
                batch.find((e) => e.eventType === 'run.failed')!.runId,
                result.tournamentId
              );
            }
          }
        }
      }
    } catch (err) {
      console.error(`Batch write failed (${batch.length} events):`, err);
      // Re-enqueue at front for retry
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
      // Flush again if more events queued during this flush
      if (this.buffer.length > 0) {
        this.flush();
      }
    }
  }
}

export const writeQueue = new WriteQueue();
