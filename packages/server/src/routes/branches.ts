import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { branches, runs } from '@aegis/db/schema';

export const branchRoutes = new Hono();

branchRoutes.get('/run/:runId', async (c) => {
  const runId = c.req.param('runId');

  const branchList = await db.query.branches.findMany({
    where: eq(branches.parentRunId, runId),
  });

  const nodes = [];
  const edges = [];

  const parentRun = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (parentRun) {
    nodes.push({
      id: parentRun.id,
      type: 'run',
      data: {
        label: `Run ${parentRun.id.slice(0, 8)}`,
        status: parentRun.status,
        metrics: parentRun.metricsJson,
      },
      position: { x: 0, y: 0 },
    });
  }

  for (const branch of branchList) {
    const branchRun = await db.query.runs.findFirst({ where: eq(runs.id, branch.runId) });
    if (branchRun) {
      nodes.push({
        id: branchRun.id,
        type: 'run',
        data: {
          label: branch.changeSummary,
          status: branchRun.status,
          metrics: branchRun.metricsJson,
          delta: branch.resultDeltaJson,
        },
        position: { x: 0, y: 0 },
      });
      edges.push({
        id: `${runId}-${branchRun.id}`,
        source: runId,
        target: branchRun.id,
      });
    }
  }

  return c.json({ data: { nodes, edges } });
});
