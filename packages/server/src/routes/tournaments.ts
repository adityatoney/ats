import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  tournaments,
  tournamentEntries,
  leaderboardEntries,
  runs,
  agents,
  portfolioSnapshots,
} from '@aegis/db/schema';
import { tournamentManager } from '../services/tournament-manager';
import { deleteTournament } from '../services/delete-service';

export const tournamentRoutes = new Hono();

// Delete tournament
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

// Create tournament
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
  return c.json({ data: tournament }, 201);
});

// List tournaments
tournamentRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  const allTournaments = projectId
    ? await db.query.tournaments.findMany({
        where: eq(tournaments.projectId, projectId),
        orderBy: [desc(tournaments.createdAt)],
      })
    : await db.query.tournaments.findMany({
        orderBy: [desc(tournaments.createdAt)],
      });
  return c.json({ data: allTournaments });
});

// Get tournament detail
tournamentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, id),
  });
  if (!tournament) return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);

  const entries = await db.query.tournamentEntries.findMany({
    where: eq(tournamentEntries.tournamentId, id),
  });

  // Enrich entries with agent name and run data
  const enrichedEntries = await Promise.all(
    entries.map(async (entry) => {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, entry.agentId),
      });
      const run = entry.runId
        ? await db.query.runs.findFirst({ where: eq(runs.id, entry.runId) })
        : null;
      return {
        ...entry,
        agentName: agent?.name || 'Unknown',
        run,
      };
    }),
  );

  return c.json({ data: { ...tournament, entries: enrichedEntries } });
});

// Start tournament
tournamentRoutes.post('/:id/start', async (c) => {
  const id = c.req.param('id');
  const result = await tournamentManager.startTournament(id);
  return c.json({ data: result });
});

// Cancel tournament
tournamentRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  await tournamentManager.cancelTournament(id);
  return c.json({ data: { status: 'cancelled' } });
});

// Get leaderboard
tournamentRoutes.get('/:id/leaderboard', async (c) => {
  const id = c.req.param('id');
  const agentContext = c.req.query('agentContext');

  const entries = await db.query.leaderboardEntries.findMany({
    where: eq(leaderboardEntries.tournamentId, id),
    orderBy: [leaderboardEntries.rank],
  });

  // Enrich with agent names
  const enriched = await Promise.all(
    entries.map(async (entry) => {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, entry.agentId),
      });
      return { ...entry, agentName: agent?.name || 'Unknown' };
    }),
  );

  if (agentContext) {
    // Restricted view: only show rank, name, return, Sharpe, drawdown
    return c.json({
      data: enriched.map((e) => ({
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

// Get comparison data (all agents' portfolio snapshots)
tournamentRoutes.get('/:id/comparison', async (c) => {
  const id = c.req.param('id');

  const entries = await db.query.tournamentEntries.findMany({
    where: eq(tournamentEntries.tournamentId, id),
  });

  const comparison = await Promise.all(
    entries.map(async (entry) => {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, entry.agentId),
      });
      const snapshots = entry.runId
        ? await db.query.portfolioSnapshots.findMany({
            where: eq(portfolioSnapshots.runId, entry.runId),
            orderBy: [portfolioSnapshots.barIndex],
          })
        : [];
      return {
        agentId: entry.agentId,
        agentName: agent?.name || 'Unknown',
        runId: entry.runId,
        snapshots,
      };
    }),
  );

  return c.json({ data: comparison });
});
