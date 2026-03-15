import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { agents, strategyVersions, soulVersions, runs } from '@aegis/db/schema';
import { agentIsolation } from '../middleware/agent-isolation';

export const agentRoutes = new Hono();

agentRoutes.get('/', async (c) => {
  const allAgents = await db.query.agents.findMany({
    orderBy: [desc(agents.createdAt)],
  });
  return c.json({ data: allAgents });
});

agentRoutes.get('/:id', agentIsolation('agent'), async (c) => {
  const id = c.req.param('id');
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, id),
  });
  if (!agent) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const latestStrategy = await db.query.strategyVersions.findFirst({
    where: eq(strategyVersions.agentId, id),
    orderBy: [desc(strategyVersions.version)],
  });

  const activeSoul = await db.query.soulVersions.findFirst({
    where: eq(soulVersions.agentId, id),
    orderBy: [desc(soulVersions.version)],
  });

  return c.json({
    data: {
      ...agent,
      latestStrategy: latestStrategy || null,
      activeSoul: activeSoul?.status === 'active' ? activeSoul : null,
    },
  });
});

agentRoutes.get('/:id/runs', agentIsolation('agent'), async (c) => {
  const id = c.req.param('id');
  const agentRuns = await db.query.runs.findMany({
    where: eq(runs.agentId, id),
    orderBy: [desc(runs.createdAt)],
  });
  return c.json({ data: agentRuns });
});

agentRoutes.put('/:id/strategy', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const latestVersion = await db.query.strategyVersions.findFirst({
    where: eq(strategyVersions.agentId, id),
    orderBy: [desc(strategyVersions.version)],
  });

  const nextVersion = (latestVersion?.version || 0) + 1;

  const [sv] = await db
    .insert(strategyVersions)
    .values({
      agentId: id,
      version: nextVersion,
      strategyMd: body.strategyMd,
      strategyPy: body.strategyPy || null,
      configJson: body.configJson || {},
    })
    .returning();

  return c.json({ data: sv }, 201);
});
