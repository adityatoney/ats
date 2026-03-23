import { Hono } from 'hono';
import { convex, normalize, normalizeAll } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export const projectRoutes = new Hono();

projectRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const project = await convex.mutation(api.projects.create, {
    pgId: '',
    ownerId: body.ownerId as any,
    name: body.name,
    description: body.description || undefined,
  });
  return c.json({ data: project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const project = await convex.query(api.projects.get, { id: id as any });
  if (!project) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const projectAgents = await convex.query(api.agents.listByProject, { projectId: id as any });

  return c.json({ data: { ...normalize(project), agents: normalizeAll(projectAgents) } });
});

projectRoutes.post('/:pid/agents', async (c) => {
  const pid = c.req.param('pid');
  const body = await c.req.json();
  const agentId = await convex.mutation(api.agents.create, {
    pgId: '',
    projectId: pid as any,
    name: body.name,
    status: 'idle',
    updatedAt: Date.now(),
  });
  const agent = await convex.query(api.agents.get, { id: agentId as any });
  return c.json({ data: agent ? normalize(agent) : null }, 201);
});
