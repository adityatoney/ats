import { api } from '../../../../convex/_generated/api';
import { convex, normalize } from '../lib/convex';

export interface TournamentRunSummary {
  id: string;
  status: string;
  processedBars: number;
  totalBars: number;
  metricsJson: Record<string, number> | null;
}

export interface TournamentEntrySummary {
  id: string;
  agentId: string;
  agentName: string;
  runId: string | null;
  status: string;
  finalRank: number | null;
  run: TournamentRunSummary | null;
}

export interface TournamentProgressSummary {
  processedBars: number;
  totalBars: number;
  completedAgents: number;
  activeAgents: number;
}

export interface DerivedTournamentState {
  status: string;
  completedCount: number;
  progressPercent: number;
  progressSummary: TournamentProgressSummary;
}

function isTerminalStatus(status: string | null | undefined) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function normalizeEntryStatus(entryStatus: string, runStatus?: string | null) {
  if (isTerminalStatus(runStatus)) {
    return runStatus!;
  }
  return entryStatus;
}

export function deriveTournamentState(
  tournament: Record<string, unknown>,
  entries: TournamentEntrySummary[],
): DerivedTournamentState {
  const agentCount = typeof tournament.agentCount === 'number' ? tournament.agentCount : entries.length;

  const normalizedEntries = entries.map((entry) => {
    const status = normalizeEntryStatus(entry.status, entry.run?.status);
    const processedBars = entry.run?.processedBars ?? 0;
    const effectiveTotalBars = (entry.run?.totalBars ?? 0) > 0
      ? entry.run!.totalBars
      : isTerminalStatus(status)
        ? processedBars
        : 0;

    return {
      ...entry,
      status,
      effectiveProcessedBars: processedBars,
      effectiveTotalBars,
    };
  });

  const terminalEntries = normalizedEntries.filter((entry) => isTerminalStatus(entry.status));
  const completedEntries = normalizedEntries.filter((entry) => entry.status === 'completed');
  const failedEntries = normalizedEntries.filter((entry) => entry.status === 'failed' || entry.status === 'cancelled');
  const activeEntries = normalizedEntries.filter((entry) => entry.status === 'running');

  const progressSummary = normalizedEntries.reduce<TournamentProgressSummary>(
    (acc, entry) => {
      if (entry.effectiveTotalBars > 0) {
        acc.processedBars += Math.min(entry.effectiveProcessedBars, entry.effectiveTotalBars);
        acc.totalBars += entry.effectiveTotalBars;
      }
      return acc;
    },
    {
      processedBars: 0,
      totalBars: 0,
      completedAgents: terminalEntries.length,
      activeAgents: activeEntries.length,
    },
  );

  let status = (tournament.status as string) || 'pending';
  if (agentCount > 0 && terminalEntries.length >= agentCount) {
    status =
      completedEntries.length === 0 && failedEntries.length > 0
        ? 'failed'
        : failedEntries.length > 0
          ? 'partially_failed'
          : 'completed';
  } else if (
    normalizedEntries.some((entry) => entry.status === 'running') ||
    normalizedEntries.some((entry) => entry.run?.status === 'running')
  ) {
    status = 'in_progress';
  } else if (status !== 'cancelled' && normalizedEntries.some((entry) => isTerminalStatus(entry.status))) {
    status = 'in_progress';
  }

  const progressPercent = progressSummary.totalBars > 0
    ? Math.min(100, (progressSummary.processedBars / progressSummary.totalBars) * 100)
    : terminalEntries.length >= agentCount && agentCount > 0
      ? 100
      : agentCount > 0
        ? Math.min(100, (terminalEntries.length / agentCount) * 100)
        : 0;

  return {
    status,
    completedCount: terminalEntries.length,
    progressPercent,
    progressSummary,
  };
}

export async function fetchTournamentView(tournamentId: string) {
  const tournament = await convex.query(api.tournaments.get, { id: tournamentId as any });
  if (!tournament) return null;

  const entries = await convex.query(api.tournamentEntries.listByTournament, { tournamentId: tournamentId as any });

  const enrichedEntries = await Promise.all(
    entries.map(async (entry: any) => {
      const agent = await convex.query(api.agents.get, { id: entry.agentId as any });
      const run = entry.runId
        ? await convex.query(api.runs.get, { id: entry.runId as any })
        : null;
      const normalizedRun = run ? normalize(run) : null;

      return {
        ...normalize(entry),
        status: normalizeEntryStatus(entry.status, normalizedRun?.status as string | null | undefined),
        agentName: agent?.name || 'Unknown',
        run: normalizedRun
          ? {
              ...normalizedRun,
              processedBars: normalizedRun.processedBars ?? 0,
              totalBars: normalizedRun.totalBars ?? 0,
              metricsJson: (normalizedRun.metricsJson as Record<string, number> | null | undefined) ?? null,
            }
          : null,
      } as TournamentEntrySummary;
    }),
  );

  const normalizedTournament = normalize(tournament);
  const derived = deriveTournamentState(normalizedTournament, enrichedEntries);

  return {
    ...normalizedTournament,
    ...derived,
    entries: enrichedEntries,
  };
}
