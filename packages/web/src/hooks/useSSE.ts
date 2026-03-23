import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_EVENTS = 500;

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  runId: string;
}

function appendEvent(prev: SSEEvent[], event: SSEEvent): SSEEvent[] {
  const next = [...prev, event];
  return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
}

export function useSSE(runId: string | undefined) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  // Monotonically increasing counter — not affected by array cap
  const [totalReceived, setTotalReceived] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!runId) return;

    const es = new EventSource(`/api/events/stream/${runId}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    const eventTypes = [
      'run.started', 'run.progress', 'run.completed', 'run.failed', 'run.paused',
      'run.saved',
      'order.submitted', 'order.filled',
      'signal.generated', 'checkpoint.saved', 'soul.generated',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        const parsed = JSON.parse(e.data);
        // SSE sends { runId, eventType, payload } — extract payload as data
        const data = parsed.payload || parsed;
        setTotalReceived((n) => n + 1);
        setEvents((prev) => appendEvent(prev, { type, data, runId }));
      });
    }

    es.onerror = () => {
      setConnected(false);
    };

    return es;
  }, [runId]);

  useEffect(() => {
    const es = connect();
    return () => {
      es?.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { events, connected, totalReceived, clearEvents: () => setEvents([]) };
}
