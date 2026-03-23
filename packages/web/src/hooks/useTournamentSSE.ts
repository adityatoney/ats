import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_SSE_EVENTS = 200;

export interface TournamentSSEEvent {
  type: string;
  data: Record<string, unknown>;
  tournamentId: string;
}

export function useTournamentSSE(tournamentId: string | undefined) {
  const [events, setEvents] = useState<TournamentSSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!tournamentId) return;

    const es = new EventSource(`/api/events/stream/tournament/${tournamentId}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    const eventTypes = [
      'tournament.started',
      'tournament.progress',
      'tournament.completed',
      'tournament.failed',
      'tournament.cancelled',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e) => {
        const data = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, { type: eventType, data, tournamentId }];
          return next.length > MAX_SSE_EVENTS ? next.slice(-MAX_SSE_EVENTS) : next;
        });
      });
    }

    es.onerror = () => {
      setConnected(false);
    };

    return es;
  }, [tournamentId]);

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
