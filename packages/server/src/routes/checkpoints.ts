import { Hono } from 'hono';
import { convex, normalize, normalizeAll } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { pythonClient } from '../lib/python-client';
import { ensureDeterministicArtifacts } from '../services/strategy-artifacts';

export const checkpointRoutes = new Hono();

// GET /api/checkpoints/:id — fetch single checkpoint
checkpointRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const checkpoint = await convex.query(api.checkpoints.get, { id: id as any });
    if (!checkpoint) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
    return c.json({ data: normalize(checkpoint) });
  } catch {
    return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
  }
});

// GET /api/checkpoints/run/:runId — list checkpoints for a run
checkpointRoutes.get('/run/:runId', async (c) => {
  const runId = c.req.param('runId');
  const checkpoints = await convex.query(api.checkpoints.listByRun, { runId: runId as any });
  return c.json({ data: normalizeAll(checkpoints) });
});

// GET /api/checkpoints/run/:runId/latest — get latest checkpoint for a run
checkpointRoutes.get('/run/:runId/latest', async (c) => {
  const runId = c.req.param('runId');
  const checkpoints = await convex.query(api.checkpoints.listByRun, { runId: runId as any });
  if (checkpoints.length === 0) return c.json({ data: null });
  // listByRun is indexed by barIndex, last one is latest
  return c.json({ data: normalize(checkpoints[checkpoints.length - 1]) });
});

checkpointRoutes.post('/:id/branch', async (c) => {
  const checkpointId = c.req.param('id');
  const body = await c.req.json();

  const checkpoint = await convex.query(api.checkpoints.get, { id: checkpointId as any });
  if (!checkpoint)
    return c.json({ error: { message: 'Checkpoint not found', code: 'NOT_FOUND' } }, 404);

  const parentRun = await convex.query(api.runs.get, { id: checkpoint.runId as any });
  if (!parentRun)
    return c.json({ error: { message: 'Parent run not found', code: 'NOT_FOUND' } }, 404);

  const strategy = await convex.query(api.strategyVersions.get, { id: parentRun.strategyVersionId as any });
  if (!strategy) {
    return c.json({ error: { message: 'Strategy not found', code: 'NOT_FOUND' } }, 404);
  }
  const runnableStrategy = await ensureDeterministicArtifacts(strategy);
  if (!runnableStrategy.strategyPy) {
    return c.json(
      { error: { message: 'Strategy Python artifact is missing', code: 'BAD_REQUEST' } },
      400,
    );
  }

  const newRun = await convex.mutation(api.runs.create, {
    pgId: '',
    agentId: parentRun.agentId as any,
    strategyVersionId: parentRun.strategyVersionId as any,
    status: 'pending',
    runType: 'branch',
    configJson: parentRun.configJson,
    totalBars: parentRun.totalBars,
    processedBars: 0,
  });

  const branch = await convex.mutation(api.branches.create, {
    pgId: '',
    runId: newRun!._id,
    parentCheckpointId: checkpointId as any,
    parentRunId: checkpoint.runId as any,
    changeSummary: body.changeSummary,
    rationale: body.rationale,
    creatorType: body.creatorType || 'user',
    overridesJson: body.overrides || {},
    status: 'pending',
  });

  await convex.mutation(api.runs.update, { id: newRun!._id, branchId: branch!._id });

  await pythonClient.startBranchRun({
    runId: newRun!._id,
    parentCheckpointId: checkpointId as any,
    parentRunId: checkpoint.runId as any,
    overrides: body.overrides || {},
    sourceKind: runnableStrategy.sourceKind,
    strategyPy: runnableStrategy.strategyPy,
    strategyIrJson: runnableStrategy.strategyIrJson as Record<string, unknown> | null,
    config: parentRun.configJson as Record<string, unknown>,
  });

  return c.json({ data: { branch: branch ? normalize(branch) : branch, run: newRun ? normalize(newRun) : newRun } }, 201);
});
