import { EventEmitter } from 'events';

export interface RuntimeEvent {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestampSimulated?: string;
  barIndex?: number;
}

const BUFFER_TTL_MS = 5 * 60 * 1000; // Keep events for 5 minutes

class EventBus extends EventEmitter {
  private eventBuffers = new Map<string, RuntimeEvent[]>();
  private bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

  publish(event: RuntimeEvent) {
    // Buffer events per run for late subscribers (SSE replay)
    if (!this.eventBuffers.has(event.runId)) {
      this.eventBuffers.set(event.runId, []);
    }
    this.eventBuffers.get(event.runId)!.push(event);

    // Reset cleanup timer on each event
    if (this.bufferTimers.has(event.runId)) {
      clearTimeout(this.bufferTimers.get(event.runId)!);
    }
    // Clean up buffer after TTL (from last event)
    if (
      event.eventType === 'run.completed' ||
      event.eventType === 'run.failed' ||
      event.eventType === 'run.cancelled'
    ) {
      this.bufferTimers.set(
        event.runId,
        setTimeout(() => {
          this.eventBuffers.delete(event.runId);
          this.bufferTimers.delete(event.runId);
        }, BUFFER_TTL_MS),
      );
    }

    this.emit(`run:${event.runId}`, event);
    this.emit('*', event);
  }

  subscribeToRun(runId: string, handler: (event: RuntimeEvent) => void) {
    // Replay buffered events for late subscribers
    const buffered = this.eventBuffers.get(runId) || [];
    for (const event of buffered) {
      handler(event);
    }

    this.on(`run:${runId}`, handler);
    return () => this.off(`run:${runId}`, handler);
  }

  publishTournament(
    tournamentId: string,
    event: { eventType: string; payload: Record<string, unknown> },
  ) {
    const fullEvent = { tournamentId, ...event };
    this.emit(`tournament:${tournamentId}`, fullEvent);
    this.emit('tournament:*', fullEvent);
  }

  subscribeToTournament(
    tournamentId: string,
    handler: (event: { tournamentId: string; eventType: string; payload: Record<string, unknown> }) => void,
  ) {
    this.on(`tournament:${tournamentId}`, handler);
    return () => this.off(`tournament:${tournamentId}`, handler);
  }
}

export const eventBus = new EventBus();
