import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { eventBus } from './event-bus';

interface QueuedEvent {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 200;
const AGENT_EVENTS_BATCH_SIZE = 2000; // Convex supports up to 16k writes/txn — 2000 is safe with headroom

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

  // Per-run event log — accumulated during run, bulk-written on completion
  private eventLogs = new Map<string, QueuedEvent[]>();

  enqueue(event: QueuedEvent): void {
    this.buffer.push(event);

    // Accumulate event for deferred agentEvents write (skip signal.generated)
    if (event.eventType !== 'signal.generated') {
      if (!this.eventLogs.has(event.runId)) {
        this.eventLogs.set(event.runId, []);
      }
      this.eventLogs.get(event.runId)!.push(event);
    }

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

      // Handle terminal events — tournament callbacks + deferred agentEvents bulk write
      if (results && Array.isArray(results)) {
        for (const result of results) {
          const matchingEvent = batch.find((e) => e.eventType === result.eventType);
          const runId = matchingEvent?.runId;

          if (result.tournamentId && runId) {
            const { tournamentManager } = await import('./tournament-manager');
            if (result.eventType === 'run.completed') {
              await tournamentManager.handleRunCompleted(runId, result.tournamentId);
            } else if (result.eventType === 'run.failed') {
              await tournamentManager.handleRunFailed(runId, result.tournamentId);
            }
          }

          // Bulk-write accumulated agentEvents for this run (fire-and-forget from browser perspective)
          if (runId && (result.eventType === 'run.completed' || result.eventType === 'run.failed')) {
            this.bulkWriteAgentEvents(runId);
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

  /**
   * Bulk-insert all accumulated agentEvents for a completed run.
   * Runs async — once the HTTP request reaches Convex, the transaction
   * completes server-side regardless of client/browser state.
   */
  private bulkWriteAgentEvents(runId: string): void {
    const events = this.eventLogs.get(runId);
    this.eventLogs.delete(runId);

    // Notify frontend immediately — don't make user wait for historical log writes
    eventBus.publish({ runId, eventType: 'run.saved', payload: {} });

    if (!events || events.length === 0) return;

    // Fire-and-forget: write in background, log result
    console.log(`Bulk writing ${events.length} agentEvents for run ${runId} (background)`);

    const chunks: QueuedEvent[][] = [];
    for (let i = 0; i < events.length; i += AGENT_EVENTS_BATCH_SIZE) {
      chunks.push(events.slice(i, i + AGENT_EVENTS_BATCH_SIZE));
    }

    Promise.all(
      chunks.map((chunk) =>
        convex.mutation(api.webhookHandlers.bulkInsertAgentEvents, {
          events: chunk.map((e) => ({
            runId: e.runId,
            eventType: e.eventType,
            payload: e.payload,
          })),
        })
      )
    )
      .then(() => console.log(`Saved ${events.length} agentEvents for run ${runId} (${chunks.length} chunks)`))
      .catch((err) => console.error(`Failed to bulk-write agentEvents for run ${runId}:`, err));
  }
}

export const writeQueue = new WriteQueue();
