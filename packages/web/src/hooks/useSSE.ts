import { useEffect, useRef, useState, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  runId: string;
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

    es.addEventListener('run.progress', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'run.progress', data, runId }]);
    });

    es.addEventListener('run.completed', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'run.completed', data, runId }]);
    });

    es.addEventListener('run.failed', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'run.failed', data, runId }]);
    });

    es.addEventListener('order.submitted', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'order.submitted', data, runId }]);
    });

    es.addEventListener('order.filled', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'order.filled', data, runId }]);
    });

    es.addEventListener('signal.generated', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'signal.generated', data, runId }]);
    });

    es.addEventListener('checkpoint.saved', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'checkpoint.saved', data, runId }]);
    });

    es.addEventListener('soul.generated', (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'soul.generated', data, runId }]);
    });

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
