import { createMiddleware } from 'hono/factory';
import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export function agentIsolation(resourceType: 'agent' | 'run' | 'soul') {
  return createMiddleware(async (c, next) => {
    const agentContext = c.req.query('agentContext');
    if (!agentContext) {
      return next();
    }

    let resourceAgentId: string | null = null;

    if (resourceType === 'agent') {
      const id = c.req.param('id') || c.req.param('agentId');
      resourceAgentId = id || null;
    } else if (resourceType === 'run') {
      const id = c.req.param('id');
      if (id) {
        const run = await convex.query(api.runs.get, { id: id as any });
        resourceAgentId = run?.agentId || null;
      }
    } else if (resourceType === 'soul') {
      const agentId = c.req.param('agentId');
      resourceAgentId = agentId || null;
    }

    if (resourceAgentId && resourceAgentId !== agentContext) {
      // Log violation attempt
      try {
        await convex.mutation(api.webhookHandlers.logAgentEvent, {
          runId: agentContext as any,
          eventType: 'isolation.violation_attempt',
          payload: {
            requestingAgent: agentContext,
            targetAgent: resourceAgentId,
            resourceType,
            url: c.req.url,
            timestamp: new Date().toISOString(),
          },
        });
      } catch {
        // Best effort logging
      }

      return c.json(
        {
          error: {
            message: 'Access denied: resource belongs to another agent',
            code: 'ISOLATION_VIOLATION',
          },
        },
        403,
      );
    }

    return next();
  });
}
