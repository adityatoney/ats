import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export const auditLogger = {
  async logIsolationViolation(data: {
    requestingAgent: string;
    targetAgent: string;
    resourceType: string;
    url: string;
  }) {
    try {
      await convex.mutation(api.webhookHandlers.logAgentEvent, {
        runId: data.requestingAgent as any,
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
