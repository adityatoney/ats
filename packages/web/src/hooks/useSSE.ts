import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_SSE_EVENTS = 200;

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  runId: string;
}

function appendEvent(prev: SSEEvent[], event: SSEEvent): SSEEvent[] {
  const next = [...prev, event];
  return next.length > MAX_SSE_EVENTS ? next.slice(-MAX_SSE_EVENTS) : next;
}

export function useSSE(runId: string | undefined) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!runId) return;

    const es = new EventSource(`/api/events/stream/${runId}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    const eventTypes = [
      'run.progress', 'run.completed', 'run.failed',
      'order.submitted', 'order.filled', 'signal.generated',
      'checkpoint.saved', 'soul.generated',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e) => {
        const data = JSON.parse(e.data);
        setEvents((prev) => appendEvent(prev, { type: eventType, data, runId }));
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

  return { events, connected, clearEvents: () => setEvents([]) };
}
