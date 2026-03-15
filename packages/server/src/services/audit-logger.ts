import { db } from '../lib/db';
import { agentEvents } from '@aegis/db/schema';

export const auditLogger = {
  async logIsolationViolation(data: {
    requestingAgent: string;
    targetAgent: string;
    resourceType: string;
    url: string;
  }) {
    try {
      await db.insert(agentEvents).values({
        runId: data.requestingAgent,
        eventType: 'isolation.violation_attempt',
        payload: {
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Best effort
    }
  },
};
