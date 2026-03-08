import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../lib/db';
import { soulVersions } from '@aegis/db/schema';

export const soulRoutes = new Hono();

soulRoutes.get('/agent/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const activeSoul = await db.query.soulVersions.findFirst({
    where: and(eq(soulVersions.agentId, agentId), eq(soulVersions.status, 'active')),
    orderBy: [desc(soulVersions.version)],
  });
  if (!activeSoul)
    return c.json({ error: { message: 'No active soul', code: 'NOT_FOUND' } }, 404);
  return c.json({ data: activeSoul });
});

soulRoutes.get('/agent/:agentId/versions', async (c) => {
  const agentId = c.req.param('agentId');
  const versions = await db.query.soulVersions.findMany({
    where: eq(soulVersions.agentId, agentId),
    orderBy: [desc(soulVersions.version)],
  });
  return c.json({ data: versions });
});

soulRoutes.post('/agent/:agentId/:vid/approve', async (c) => {
  const agentId = c.req.param('agentId');
  const vid = c.req.param('vid');

  // Supersede current active soul
  const currentActive = await db.query.soulVersions.findFirst({
    where: and(eq(soulVersions.agentId, agentId), eq(soulVersions.status, 'active')),
  });
  if (currentActive) {
    await db
      .update(soulVersions)
      .set({ status: 'superseded' })
      .where(eq(soulVersions.id, currentActive.id));
  }

  // Activate the new one
  await db.update(soulVersions).set({ status: 'active' }).where(eq(soulVersions.id, vid));

  return c.json({ data: { status: 'active' } });
});
