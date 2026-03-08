import type { EventType } from '../constants/event-types';

export interface AgentEvent {
  id: string;
  runId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  timestampSimulated: string | null;
  barIndex: number | null;
  createdAt: string;
}

export interface SSEEvent {
  type: EventType;
  data: Record<string, unknown>;
  runId: string;
  timestamp: string;
}
