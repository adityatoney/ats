import { Hono } from 'hono';
import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';

export const branchRoutes = new Hono();

branchRoutes.get('/run/:runId', async (c) => {
  const runId = c.req.param('runId');

  const branchList = await convex.query(api.branches.listByParentRun, { parentRunId: runId as any });

  const nodes = [];
  const edges = [];

  const parentRun = await convex.query(api.runs.get, { id: runId as any });
  if (parentRun) {
    nodes.push({
      id: parentRun._id,
      type: 'run',
      data: {
        label: `Run ${parentRun._id.slice(0, 8)}`,
        status: parentRun.status,
        metrics: parentRun.metricsJson,
      },
      position: { x: 0, y: 0 },
    });
  }

  for (const branch of branchList) {
    const branchRun = await convex.query(api.runs.get, { id: branch.runId as any });
    if (branchRun) {
      nodes.push({
        id: branchRun._id,
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
        id: `${runId}-${branchRun._id}`,
        source: runId,
        target: branchRun._id,
      });
    }
  }

  return c.json({ data: { nodes, edges } });
});
