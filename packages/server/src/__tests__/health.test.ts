import { describe, it, expect } from 'vitest';
import { getTournamentRecency } from '../routes/tournaments';
import { deriveTournamentState, normalizeEntryStatus } from '../services/tournament-progress';

describe('tournament route helpers', () => {
  it('prefers completedAt over older timestamps when sorting by recency', () => {
    const olderCompleted = { completedAt: 100, startedAt: 50, _creationTime: 10 };
    const newerStarted = { startedAt: 200, _creationTime: 20 };

    expect(getTournamentRecency(newerStarted)).toBeGreaterThan(getTournamentRecency(olderCompleted));
  });

  it('uses terminal run status over stale entry status', () => {
    expect(normalizeEntryStatus('running', 'completed')).toBe('completed');
    expect(normalizeEntryStatus('running', 'failed')).toBe('failed');
    expect(normalizeEntryStatus('running', 'cancelled')).toBe('cancelled');
    expect(normalizeEntryStatus('running', 'running')).toBe('running');
  });

  it('derives completion and 100 percent progress from terminal entries with missing total bars', () => {
    const state = deriveTournamentState(
      { status: 'in_progress', agentCount: 3 },
      [
        {
          id: 'e1',
          agentId: 'a1',
          agentName: 'One',
          runId: 'r1',
          status: 'completed',
          finalRank: null,
          run: { id: 'r1', status: 'completed', processedBars: 4024, totalBars: 0, metricsJson: null },
        },
        {
          id: 'e2',
          agentId: 'a2',
          agentName: 'Two',
          runId: 'r2',
          status: 'completed',
          finalRank: null,
          run: { id: 'r2', status: 'completed', processedBars: 4024, totalBars: 0, metricsJson: null },
        },
        {
          id: 'e3',
          agentId: 'a3',
          agentName: 'Three',
          runId: 'r3',
          status: 'completed',
          finalRank: null,
          run: { id: 'r3', status: 'completed', processedBars: 4024, totalBars: 0, metricsJson: null },
        },
      ],
    );

    expect(state.status).toBe('completed');
    expect(state.completedCount).toBe(3);
    expect(state.progressPercent).toBe(100);
    expect(state.progressSummary.totalBars).toBe(4024 * 3);
  });
});
