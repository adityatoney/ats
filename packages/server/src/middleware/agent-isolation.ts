import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { runs, agents, soulVersions, agentEvents } from '@aegis/db/schema';

/**
 * Agent isolation middleware.
 * If ?agentContext is present, restricts access to only that agent's resources.
 * If absent, full owner/admin access.
 */
export function agentIsolation(resourceType: 'agent' | 'run' | 'soul') {
  return createMiddleware(async (c, next) => {
    const agentContext = c.req.query('agentContext');
    if (!agentContext) {
      // No isolation — owner/admin access
      return next();
    }

    let resourceAgentId: string | null = null;

    if (resourceType === 'agent') {
      const id = c.req.param('id') || c.req.param('agentId');
      resourceAgentId = id || null;
    } else if (resourceType === 'run') {
      const id = c.req.param('id');
      if (id) {
        const run = await db.query.runs.findFirst({ where: eq(runs.id, id) });
        resourceAgentId = run?.agentId || null;
      }
    } else if (resourceType === 'soul') {
      const agentId = c.req.param('agentId');
      resourceAgentId = agentId || null;
    }

    if (resourceAgentId && resourceAgentId !== agentContext) {
      // Log violation attempt
      await logViolationAttempt(agentContext, resourceAgentId, resourceType, c.req.url);

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

async function logViolationAttempt(
  requestingAgent: string,
  targetAgent: string,
  resourceType: string,
  url: string,
) {
  try {
    await db.insert(agentEvents).values({
      runId: requestingAgent, // Use requesting agent as runId for logging
      eventType: 'isolation.violation_attempt',
      payload: {
        requestingAgent,
        targetAgent,
        resourceType,
        url,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Best effort logging — don't fail the request
  }
}
