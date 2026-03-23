import { Hono } from 'hono';
import { convex, normalize, normalizeAll } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { tournamentManager } from '../services/tournament-manager';
import { deleteTournament } from '../services/delete-service';

export const tournamentRoutes = new Hono();

tournamentRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await deleteTournament(id);
    return c.json({ data: { deleted: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    const status = message.includes('not found') ? 404 : message.includes('Cannot delete') ? 409 : 500;
    return c.json({ error: { message, code: 'DELETE_FAILED' } }, status);
  }
});

tournamentRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { projectId, name, agentIds, config } = body;

  if (!projectId || !name || !agentIds?.length || !config) {
    return c.json(
      { error: { message: 'Missing required fields: projectId, name, agentIds, config', code: 'VALIDATION_ERROR' } },
      400,
    );
  }

  const tournament = await tournamentManager.createTournament(projectId, name, agentIds, config);
  return c.json({ data: tournament ? normalize(tournament) : tournament }, 201);
});

tournamentRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  const allTournaments = projectId
    ? await convex.query(api.tournaments.listByProject, { projectId: projectId as any })
    : await convex.query(api.tournaments.list, {});
  return c.json({ data: normalizeAll(allTournaments) });
});

tournamentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tournament = await convex.query(api.tournaments.get, { id: id as any });
  if (!tournament) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: id as any });

  const enrichedEntries = await Promise.all(
    entries.map(async (entry: any) => {
      const agent = await convex.query(api.agents.get, { id: entry.agentId as any });
      const run = entry.runId
        ? await convex.query(api.runs.get, { id: entry.runId as any })
        : null;
      return {
        ...normalize(entry),
        agentName: agent?.name || 'Unknown',
        run: run ? normalize(run) : null,
      };
    }),
  );

  return c.json({ data: { ...normalize(tournament), entries: enrichedEntries } });
});

tournamentRoutes.post('/:id/start', async (c) => {
  const id = c.req.param('id');
  const result = await tournamentManager.startTournament(id);
  return c.json({ data: result });
});

tournamentRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  await tournamentManager.cancelTournament(id);
  return c.json({ data: { status: 'cancelled' } });
});

tournamentRoutes.get('/:id/leaderboard', async (c) => {
  const id = c.req.param('id');
  const agentContext = c.req.query('agentContext');

  const entries = await convex.query(api.leaderboardEntries.listByTournament, { tournamentId: id as any });

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const agent = await convex.query(api.agents.get, { id: entry.agentId as any });
      return { ...normalize(entry), agentName: agent?.name || 'Unknown' };
    }),
  );

  if (agentContext) {
    return c.json({
      data: enriched.map((e: any) => ({
        rank: e.rank,
        agentId: e.agentId,
        agentName: e.agentName,
        totalReturn: e.totalReturn,
        sharpeRatio: e.sharpeRatio,
        maxDrawdown: e.maxDrawdown,
        isMe: e.agentId === agentContext,
      })),
    });
  }

  return c.json({ data: enriched });
});

tournamentRoutes.get('/:id/comparison', async (c) => {
  const id = c.req.param('id');

  const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: id as any });

  const comparison = await Promise.all(
    entries.map(async (entry: any) => {
      const agent = await convex.query(api.agents.get, { id: entry.agentId as any });
      const snapshots = entry.runId
        ? await convex.query(api.portfolioSnapshots.listByRun, { runId: entry.runId as any })
        : [];
      return {
        agentId: entry.agentId,
        agentName: agent?.name || 'Unknown',
        runId: entry.runId,
        snapshots: normalizeAll(snapshots),
      };
    }),
  );

  return c.json({ data: comparison });
});
