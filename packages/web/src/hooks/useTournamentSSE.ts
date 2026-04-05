import { useEffect, useRef, useState, useCallback } from 'react';

export interface TournamentSSEEvent {
  type: string;
  data: Record<string, unknown>;
  tournamentId: string;
}

export function useTournamentSSE(tournamentId: string | undefined) {
  const [latestEvent, setLatestEvent] = useState<TournamentSSEEvent | null>(null);
  const [eventVersion, setEventVersion] = useState(0);
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
        setLatestEvent({ type: eventType, data, tournamentId });
        setEventVersion((prev) => prev + 1);
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
      setLatestEvent(null);
    };
  }, [connect]);

  return { latestEvent, connected, eventVersion };
}
