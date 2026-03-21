import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { agents, strategyVersions, soulVersions, runs } from '@aegis/db/schema';
import { agentIsolation } from '../middleware/agent-isolation';
import { PythonRuntimeError, pythonClient } from '../lib/python-client';
import {
  compileDeterministicArtifacts,
  ensureDeterministicArtifacts,
} from '../services/strategy-artifacts';

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

  const rawLatestStrategy = await db.query.strategyVersions.findFirst({
    where: eq(strategyVersions.agentId, id),
    orderBy: [desc(strategyVersions.version)],
  });
  const latestStrategy = rawLatestStrategy
    ? await ensureDeterministicArtifacts(rawLatestStrategy)
    : null;

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

agentRoutes.post('/compile-strategy', async (c) => {
  const body = await c.req.json();
  const sourceKind = body.sourceKind as 'pine' | 'markdown_yaml' | undefined;
  const source = body.source as string | undefined;

  if (!sourceKind || !['pine', 'markdown_yaml'].includes(sourceKind)) {
    return c.json(
      { error: { message: 'sourceKind must be pine or markdown_yaml', code: 'BAD_REQUEST' } },
      400,
    );
  }

  if (!source?.trim()) {
    return c.json({ error: { message: 'source is required', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    const result = await compileDeterministicArtifacts(sourceKind, source);
    return c.json({ data: result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Deterministic strategy compilation failed';
    const diagnostics = err instanceof PythonRuntimeError ? err.diagnostics : [];
    return c.json({ error: { message, code: 'COMPILE_FAILED', diagnostics } }, 400);
  }
});

agentRoutes.put('/:id/strategy', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const sourceKind = body.sourceKind as 'pine' | 'markdown_yaml' | 'legacy_python' | undefined;

  if (!sourceKind || !['pine', 'markdown_yaml', 'legacy_python'].includes(sourceKind)) {
    return c.json(
      {
        error: {
          message: 'sourceKind must be pine, markdown_yaml, or legacy_python',
          code: 'BAD_REQUEST',
        },
      },
      400,
    );
  }

  const latestVersion = await db.query.strategyVersions.findFirst({
    where: eq(strategyVersions.agentId, id),
    orderBy: [desc(strategyVersions.version)],
  });

  const nextVersion = (latestVersion?.version || 0) + 1;
  const configJson = body.configJson || {};

  let insertValues: typeof strategyVersions.$inferInsert;

  if (sourceKind === 'pine') {
    const strategyPine = body.strategyPine as string | undefined;
    if (!strategyPine?.trim()) {
      return c.json(
        { error: { message: 'strategyPine is required for pine sourceKind', code: 'BAD_REQUEST' } },
        400,
      );
    }

    try {
      const compiled = await compileDeterministicArtifacts('pine', strategyPine);
      insertValues = {
        agentId: id,
        version: nextVersion,
        sourceKind,
        strategyMd: null,
        strategyPine: compiled.strategyPine,
        strategyPy: compiled.strategyPy,
        strategyIrJson: compiled.strategyIrJson,
        configJson,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to compile Pine strategy';
      const diagnostics = err instanceof PythonRuntimeError ? err.diagnostics : [];
      return c.json({ error: { message, code: 'COMPILE_FAILED', diagnostics } }, 400);
    }
  } else if (sourceKind === 'markdown_yaml') {
    const strategyMd = body.strategyMd as string | undefined;
    if (!strategyMd?.trim()) {
      return c.json(
        {
          error: {
            message: 'strategyMd is required for markdown_yaml sourceKind',
            code: 'BAD_REQUEST',
          },
        },
        400,
      );
    }

    try {
      const compiled = await compileDeterministicArtifacts('markdown_yaml', strategyMd);
      insertValues = {
        agentId: id,
        version: nextVersion,
        sourceKind,
        strategyMd,
        strategyPine: compiled.strategyPine,
        strategyPy: compiled.strategyPy,
        strategyIrJson: compiled.strategyIrJson,
        configJson,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to compile markdown strategy';
      const diagnostics = err instanceof PythonRuntimeError ? err.diagnostics : [];
      return c.json({ error: { message, code: 'COMPILE_FAILED', diagnostics } }, 400);
    }
  } else {
    const strategyPy = body.strategyPy as string | undefined;
    if (!strategyPy?.trim()) {
      return c.json(
        {
          error: {
            message: 'strategyPy is required for legacy_python sourceKind',
            code: 'BAD_REQUEST',
          },
        },
        400,
      );
    }

    try {
      await pythonClient.validateStrategyPython({ strategyPy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Legacy Python validation failed';
      return c.json({ error: { message, code: 'VALIDATION_FAILED' } }, 400);
    }

    insertValues = {
      agentId: id,
      version: nextVersion,
      sourceKind,
      strategyMd: body.strategyMd || null,
      strategyPine: null,
      strategyPy,
      strategyIrJson: null,
      configJson,
    };
  }

  const [sv] = await db.insert(strategyVersions).values(insertValues).returning();

  return c.json({ data: sv }, 201);
});
