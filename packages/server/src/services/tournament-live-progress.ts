import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { eventBus } from './event-bus';
import { fetchTournamentView } from './tournament-progress';

const TOURNAMENT_PROGRESS_PUBLISH_INTERVAL_MS = 100;

interface RunProgressState {
  status: string;
  processedBars: number;
  totalBars: number;
}

interface TournamentProgressPayload {
  processedBars: number;
  totalBars: number;
  completedAgents: number;
  activeAgents: number;
  agentCount: number;
  progressPercent: number;
}

interface TournamentProgressState {
  agentCount: number;
  runs: Map<string, RunProgressState>;
  lastPublishedPayload: TournamentProgressPayload | null;
  lastPublishedAt: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
}

function parseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isTerminal(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function samePayload(a: TournamentProgressPayload | null, b: TournamentProgressPayload) {
  return !!a
    && a.processedBars === b.processedBars
    && a.totalBars === b.totalBars
    && a.completedAgents === b.completedAgents
    && a.activeAgents === b.activeAgents
    && a.agentCount === b.agentCount
    && a.progressPercent === b.progressPercent;
}

function computePayload(state: TournamentProgressState): TournamentProgressPayload {
  let processedBars = 0;
  let totalBars = 0;
  let completedAgents = 0;
  let activeAgents = 0;

  for (const run of state.runs.values()) {
    const terminal = isTerminal(run.status);
    const effectiveTotalBars = run.totalBars > 0 ? run.totalBars : terminal ? run.processedBars : 0;

    if (effectiveTotalBars > 0) {
      processedBars += Math.min(run.processedBars, effectiveTotalBars);
      totalBars += effectiveTotalBars;
    }

    if (terminal) completedAgents += 1;
    if (run.status === 'running') activeAgents += 1;
  }

  const progressPercent = totalBars > 0
    ? Math.min(100, (processedBars / totalBars) * 100)
    : state.agentCount > 0
      ? Math.min(100, (completedAgents / state.agentCount) * 100)
      : 0;

  return {
    processedBars,
    totalBars,
    completedAgents,
    activeAgents,
    agentCount: state.agentCount,
    progressPercent,
  };
}

class TournamentLiveProgress {
  private tournaments = new Map<string, TournamentProgressState>();
  private runToTournament = new Map<string, string>();

  registerTournament(tournamentId: string, agentCount: number, runIds: string[]) {
    const existing = this.tournaments.get(tournamentId);
    const runs = existing?.runs ?? new Map<string, RunProgressState>();

    for (const runId of runIds) {
      this.runToTournament.set(runId, tournamentId);
      const current = runs.get(runId);
      runs.set(runId, current ?? {
        status: 'running',
        processedBars: 0,
        totalBars: 0,
      });
    }

    this.tournaments.set(tournamentId, {
      agentCount,
      runs,
      lastPublishedPayload: existing?.lastPublishedPayload ?? null,
      lastPublishedAt: existing?.lastPublishedAt ?? 0,
      pendingTimer: existing?.pendingTimer ?? null,
    });
  }

  async handleRuntimeEvent(runId: string, eventType: string, payload: Record<string, unknown>) {
    if (eventType === 'run.progress') {
      await this.handleRunProgress(runId, payload);
      return;
    }

    if (eventType === 'run.completed' || eventType === 'run.failed' || eventType === 'run.cancelled') {
      await this.handleTerminalEvent(runId, eventType, payload);
    }
  }

  async handlePersistenceTerminalResult(result: {
    runId?: string;
    tournamentId?: string;
    eventType: string;
    processedBars?: number;
    totalBars?: number;
  }) {
    if (!result.runId || !result.tournamentId) return;

    const state = await this.ensureTournamentState(result.tournamentId, result.runId);
    if (!state) return;

    const existing = state.runs.get(result.runId);
    state.runs.set(result.runId, {
      status: result.eventType === 'run.failed' ? 'failed' : 'completed',
      processedBars: result.processedBars ?? existing?.processedBars ?? 0,
      totalBars: result.totalBars ?? existing?.totalBars ?? result.processedBars ?? 0,
    });

    this.schedulePublish(result.tournamentId, true);
  }

  async publishSnapshot(tournamentId: string) {
    const state = this.tournaments.get(tournamentId);
    if (!state) return;
    this.publishIfChanged(tournamentId, state);
  }

  clearTournament(tournamentId: string) {
    const state = this.tournaments.get(tournamentId);
    if (state?.pendingTimer) {
      clearTimeout(state.pendingTimer);
    }

    if (state) {
      for (const runId of state.runs.keys()) {
        this.runToTournament.delete(runId);
      }
    }

    this.tournaments.delete(tournamentId);
  }

  private async handleRunProgress(runId: string, payload: Record<string, unknown>) {
    const tournamentId = this.runToTournament.get(runId);
    const state = tournamentId
      ? this.tournaments.get(tournamentId)
      : await this.ensureByRunId(runId);

    const resolvedTournamentId = tournamentId ?? this.runToTournament.get(runId);
    if (!state || !resolvedTournamentId) return;

    const processedBars = parseNumber(payload.processedBars ?? payload.processed_bars);
    const totalBars = parseNumber(payload.totalBars ?? payload.total_bars);
    const existing = state.runs.get(runId);

    state.runs.set(runId, {
      status: 'running',
      processedBars,
      totalBars: totalBars > 0 ? totalBars : existing?.totalBars ?? 0,
    });

    this.schedulePublish(resolvedTournamentId);
  }

  private async handleTerminalEvent(runId: string, eventType: string, payload: Record<string, unknown>) {
    const tournamentId = this.runToTournament.get(runId);
    const state = tournamentId
      ? this.tournaments.get(tournamentId)
      : await this.ensureByRunId(runId);

    const resolvedTournamentId = tournamentId ?? this.runToTournament.get(runId);
    if (!state || !resolvedTournamentId) return;

    const existing = state.runs.get(runId);
    const processedBars = parseNumber(payload.processedBars ?? payload.processed_bars) || existing?.processedBars || 0;
    const totalBars = parseNumber(payload.totalBars ?? payload.total_bars) || existing?.totalBars || processedBars;

    state.runs.set(runId, {
      status: eventType === 'run.failed' ? 'failed' : eventType === 'run.cancelled' ? 'cancelled' : 'completed',
      processedBars,
      totalBars,
    });

    this.schedulePublish(resolvedTournamentId, true);
  }

  private schedulePublish(tournamentId: string, immediate = false) {
    const state = this.tournaments.get(tournamentId);
    if (!state) return;

    if (immediate) {
      if (state.pendingTimer) {
        clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
      }
      this.publishIfChanged(tournamentId, state);
      return;
    }

    const now = Date.now();
    const elapsed = now - state.lastPublishedAt;
    if (elapsed >= TOURNAMENT_PROGRESS_PUBLISH_INTERVAL_MS) {
      this.publishIfChanged(tournamentId, state);
      return;
    }

    if (state.pendingTimer) return;

    state.pendingTimer = setTimeout(() => {
      const latest = this.tournaments.get(tournamentId);
      if (!latest) return;
      latest.pendingTimer = null;
      this.publishIfChanged(tournamentId, latest);
    }, TOURNAMENT_PROGRESS_PUBLISH_INTERVAL_MS - elapsed);
  }

  private publishIfChanged(tournamentId: string, state: TournamentProgressState) {
    const payload = computePayload(state);
    if (samePayload(state.lastPublishedPayload, payload)) return;

    state.lastPublishedPayload = payload;
    state.lastPublishedAt = Date.now();

    eventBus.publishTournament(tournamentId, {
      eventType: 'tournament.progress',
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  private async ensureByRunId(runId: string) {
    const run = await convex.query(api.runs.get, { id: runId as any });
    if (!run?.tournamentId) return null;
    return this.ensureTournamentState(run.tournamentId as string, runId);
  }

  private async ensureTournamentState(tournamentId: string, runId?: string) {
    const cached = this.tournaments.get(tournamentId);
    if (cached) {
      if (runId) this.runToTournament.set(runId, tournamentId);
      return cached;
    }

    const tournamentView = await fetchTournamentView(tournamentId);
    if (!tournamentView) return null;

    const runs = new Map<string, RunProgressState>();
    for (const entry of tournamentView.entries) {
      if (!entry.runId) continue;
      runs.set(entry.runId, {
        status: entry.status,
        processedBars: entry.run?.processedBars ?? 0,
        totalBars: entry.run?.totalBars ?? 0,
      });
      this.runToTournament.set(entry.runId, tournamentId);
    }

    const state: TournamentProgressState = {
      agentCount: tournamentView.agentCount,
      runs,
      lastPublishedPayload: null,
      lastPublishedAt: 0,
      pendingTimer: null,
    };
    this.tournaments.set(tournamentId, state);

    if (runId) this.runToTournament.set(runId, tournamentId);
    return state;
  }
}

export const tournamentLiveProgress = new TournamentLiveProgress();
