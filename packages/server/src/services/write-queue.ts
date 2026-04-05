import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { eventBus } from './event-bus';
import { tournamentLiveProgress } from './tournament-live-progress';

interface QueuedEvent {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 50;
const MAX_PAYLOAD_BYTES = 30_000; // ~30 KB per event payload max
const AGENT_EVENTS_BATCH_SIZE = 2000; // Convex supports up to 16k writes/txn — 2000 is safe with headroom

const PRIORITY_EVENTS = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'checkpoint.saved',
  'soul.generated',
  'branch.completed',
]);

/**
 * Estimate JSON byte size of an event payload (approximate, avoids full serialization).
 */
function estimateEventSize(event: QueuedEvent): number {
  // Quick estimate: JSON.stringify the payload
  try {
    return JSON.stringify(event.payload).length;
  } catch {
    return 1000; // fallback
  }
}

/**
 * Truncate checkpoint state blobs that are individually too large.
 */
function sanitizePayload(event: QueuedEvent): QueuedEvent {
  if (event.eventType === 'checkpoint.saved' && event.payload.state) {
    const stateStr = JSON.stringify(event.payload.state);
    if (stateStr.length > MAX_PAYLOAD_BYTES) {
      return { ...event, payload: { ...event.payload, state: { __truncated: true, originalSize: stateStr.length } } };
    }
  }
  return event;
}

class WriteQueue {
  private buffer: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  // Per-run event log — accumulated during run, bulk-written on completion
  private eventLogs = new Map<string, QueuedEvent[]>();

  enqueue(event: QueuedEvent): void {
    const shouldFlushNow = this.pushEvent(event);
    this.scheduleFlush(shouldFlushNow);
  }

  enqueueBatch(events: QueuedEvent[]): void {
    let shouldFlushNow = false;
    for (const event of events) {
      shouldFlushNow = this.pushEvent(event) || shouldFlushNow;
    }
    this.scheduleFlush(shouldFlushNow);
  }

  private pushEvent(event: QueuedEvent): boolean {
    this.buffer.push(event);

    // Accumulate event for deferred agentEvents write (skip signal.generated)
    if (event.eventType !== 'signal.generated') {
      if (!this.eventLogs.has(event.runId)) {
        this.eventLogs.set(event.runId, []);
      }
      this.eventLogs.get(event.runId)!.push(event);
    }

    return PRIORITY_EVENTS.has(event.eventType) || this.buffer.length >= MAX_BATCH_SIZE;
  }

  private scheduleFlush(shouldFlushNow: boolean): void {
    if (shouldFlushNow) {
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

    // Build a batch that fits under Convex's 1 MiB arg limit.
    // Use 900 KB as threshold to leave headroom for JSON overhead.
    const MAX_BATCH_BYTES = 900_000;
    const batch: QueuedEvent[] = [];
    let batchBytes = 0;
    while (this.buffer.length > 0 && batch.length < MAX_BATCH_SIZE) {
      const event = sanitizePayload(this.buffer[0]);
      const eventSize = estimateEventSize(event);
      if (batch.length > 0 && batchBytes + eventSize > MAX_BATCH_BYTES) {
        break; // Adding this event would exceed the limit
      }
      this.buffer.shift();
      batch.push(event);
      batchBytes += eventSize;
    }

    try {
      const results = await convex.mutation(
        api.webhookHandlers.processBatch,
        {
          events: batch.map((e) => {
            const safe = sanitizePayload(e);
            return {
              runId: safe.runId,
              eventType: safe.eventType,
              payload: safe.payload,
            };
          }),
        }
      );

      // Handle terminal events — tournament callbacks + deferred agentEvents bulk write
      if (results && Array.isArray(results)) {
        const tournamentIdsToFinalize = new Set<string>();
        const terminalRunIds = new Set<string>();

        for (const result of results) {
          if (result.runId && (result.eventType === 'run.completed' || result.eventType === 'run.failed')) {
            terminalRunIds.add(result.runId);
          }

          if (result.tournamentIdToFinalize) {
            tournamentIdsToFinalize.add(result.tournamentIdToFinalize);
          } else if (
            result.tournamentId &&
            (result.eventType === 'run.completed' || result.eventType === 'run.failed')
          ) {
            await tournamentLiveProgress.handlePersistenceTerminalResult(result);
          }
        }

        if (tournamentIdsToFinalize.size > 0) {
          const { tournamentManager } = await import('./tournament-manager');
          for (const tournamentId of tournamentIdsToFinalize) {
            await tournamentManager.finalizeTournament(tournamentId);
          }
        }

        for (const runId of terminalRunIds) {
          this.bulkWriteAgentEvents(runId);
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

    (async () => {
      for (const chunk of chunks) {
        await convex.mutation(api.webhookHandlers.bulkInsertAgentEvents, {
          events: chunk.map((e) => ({
            runId: e.runId,
            eventType: e.eventType,
            payload: e.payload,
          })),
        });
      }
    })()
      .then(() => console.log(`Saved ${events.length} agentEvents for run ${runId} (${chunks.length} chunks)`))
      .catch((err) => console.error(`Failed to bulk-write agentEvents for run ${runId}:`, err));
  }
}

export const writeQueue = new WriteQueue();
