import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { checkpoints, runs, branches, strategyVersions } from '@aegis/db/schema';
import { pythonClient } from '../lib/python-client';

export const checkpointRoutes = new Hono();

checkpointRoutes.post('/:id/branch', async (c) => {
  const checkpointId = c.req.param('id');
  const body = await c.req.json();

  const checkpoint = await db.query.checkpoints.findFirst({
    where: eq(checkpoints.id, checkpointId),
  });
  if (!checkpoint)
    return c.json({ error: { message: 'Checkpoint not found', code: 'NOT_FOUND' } }, 404);

  const parentRun = await db.query.runs.findFirst({
    where: eq(runs.id, checkpoint.runId),
  });
  if (!parentRun)
    return c.json({ error: { message: 'Parent run not found', code: 'NOT_FOUND' } }, 404);

  const strategy = await db.query.strategyVersions.findFirst({
    where: eq(strategyVersions.id, parentRun.strategyVersionId),
  });

  const [newRun] = await db
    .insert(runs)
    .values({
      agentId: parentRun.agentId,
      strategyVersionId: parentRun.strategyVersionId,
      status: 'pending',
      runType: 'branch',
      configJson: parentRun.configJson,
      totalBars: parentRun.totalBars,
      processedBars: 0,
    })
    .returning();

  const [branch] = await db
    .insert(branches)
    .values({
      runId: newRun.id,
      parentCheckpointId: checkpointId,
      parentRunId: checkpoint.runId,
      changeSummary: body.changeSummary,
      rationale: body.rationale,
      creatorType: body.creatorType || 'user',
      overridesJson: body.overrides || {},
      status: 'pending',
    })
    .returning();

  await db.update(runs).set({ branchId: branch.id }).where(eq(runs.id, newRun.id));

  await pythonClient.startBranchRun({
    runId: newRun.id,
    parentCheckpointId: checkpointId,
    parentRunId: checkpoint.runId,
    overrides: body.overrides || {},
    strategyMd: strategy!.strategyMd,
    strategyPy: strategy!.strategyPy,
    config: parentRun.configJson as Record<string, unknown>,
  });

  return c.json({ data: { branch, run: newRun } }, 201);
});
