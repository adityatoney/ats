import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { projects, agents } from '@aegis/db/schema';

export const projectRoutes = new Hono();

projectRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const [project] = await db
    .insert(projects)
    .values({
      name: body.name,
      description: body.description || null,
      ownerId: body.ownerId,
    })
    .returning();
  return c.json({ data: project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });
  if (!project) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const projectAgents = await db.query.agents.findMany({
    where: eq(agents.projectId, id),
  });

  return c.json({ data: { ...project, agents: projectAgents } });
});

projectRoutes.post('/:pid/agents', async (c) => {
  const pid = c.req.param('pid');
  const body = await c.req.json();
  const [agent] = await db
    .insert(agents)
    .values({
      projectId: pid,
      name: body.name,
      status: 'idle',
    })
    .returning();
  return c.json({ data: agent }, 201);
});
