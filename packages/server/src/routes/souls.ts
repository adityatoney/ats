import { Hono } from 'hono';
import { convex, normalize, normalizeAll } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { agentIsolation } from '../middleware/agent-isolation';

export const soulRoutes = new Hono();

soulRoutes.get('/agent/:agentId', agentIsolation('soul'), async (c) => {
  const agentId = c.req.param('agentId');
  const activeSoul = await convex.query(api.soulVersions.getActiveByAgent, { agentId: agentId as any });
  if (!activeSoul)
    return c.json({ error: { message: 'No active soul', code: 'NOT_FOUND' } }, 404);
  return c.json({ data: normalize(activeSoul) });
});

soulRoutes.get('/agent/:agentId/versions', agentIsolation('soul'), async (c) => {
  const agentId = c.req.param('agentId');
  const versions = await convex.query(api.soulVersions.listByAgent, { agentId: agentId as any });
  return c.json({ data: normalizeAll(versions) });
});

soulRoutes.post('/agent/:agentId/:vid/approve', async (c) => {
  const agentId = c.req.param('agentId');
  const vid = c.req.param('vid');

  // Supersede current active soul
  const currentActive = await convex.query(api.soulVersions.getActiveByAgent, { agentId: agentId as any });
  if (currentActive) {
    await convex.mutation(api.soulVersions.update, { id: currentActive._id, status: 'superseded' });
  }

  // Activate the new one
  await convex.mutation(api.soulVersions.update, { id: vid as any, status: 'active' });

  return c.json({ data: { status: 'active' } });
});
