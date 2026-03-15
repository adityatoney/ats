import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { projectRoutes } from './routes/projects';
import { agentRoutes } from './routes/agents';
import { runRoutes } from './routes/runs';
import { checkpointRoutes } from './routes/checkpoints';
import { branchRoutes } from './routes/branches';
import { soulRoutes } from './routes/souls';
import { sseRoutes } from './routes/events-sse';
import { webhookRoutes } from './routes/webhooks';
import { tournamentRoutes } from './routes/tournaments';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());

app.get('/health', (c) => c.json({ status: 'ok', service: 'aegis-server' }));

app.route('/api/projects', projectRoutes);
app.route('/api/agents', agentRoutes);
app.route('/api/runs', runRoutes);
app.route('/api/checkpoints', checkpointRoutes);
app.route('/api/branches', branchRoutes);
app.route('/api/souls', soulRoutes);
app.route('/api/events', sseRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/tournaments', tournamentRoutes);

const port = parseInt(process.env.PORT || '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Aegis server running on http://localhost:${info.port}`);
});

export default app;
