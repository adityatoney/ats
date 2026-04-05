// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TournamentDetailPage } from '../components/tournament/TournamentDetailPage';

vi.mock('../hooks/useTournament', () => ({
  useTournament: vi.fn(),
  useTournamentLeaderboard: vi.fn(),
}));

vi.mock('../hooks/useTournamentSSE', () => ({
  useTournamentSSE: vi.fn(() => ({ latestEvent: null, connected: false, eventVersion: 0 })),
}));

import { useTournament, useTournamentLeaderboard } from '../hooks/useTournament';

const mockedUseTournament = vi.mocked(useTournament);
const mockedUseTournamentLeaderboard = vi.mocked(useTournamentLeaderboard);

describe('TournamentDetailPage', () => {
  it('shows tournament progress after completion and prefers terminal run status over stale entry status', () => {
    mockedUseTournament.mockReturnValue({
      data: {
        id: 't1',
        name: 'Testing..',
        status: 'completed',
        agentCount: 5,
        completedCount: 5,
        configJson: {
          symbols: ['AAPL'],
          startDate: '2010-01-01',
          endDate: '2026-01-01',
        },
        startedAt: null,
        completedAt: null,
        createdAt: '2026-04-04T00:00:00.000Z',
        entries: [
          {
            id: 'entry-1',
            agentId: 'agent-1',
            agentName: 'Mean Reverter',
            runId: 'run-1',
            status: 'running',
            finalRank: null,
            run: {
              id: 'run-1',
              status: 'completed',
              processedBars: 4024,
              totalBars: 4024,
              metricsJson: {
                totalReturn: 0.3035,
              },
            },
          },
        ],
      },
      isLoading: false,
    } as never);

    mockedUseTournamentLeaderboard.mockReturnValue({
      data: [],
    } as never);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tournaments/t1']}>
          <Routes>
            <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Tournament Progress')).toBeInTheDocument();
    expect(screen.getByText('5 / 5 agents completed')).toBeInTheDocument();
    expect(screen.getByText('Mean Reverter')).toBeInTheDocument();
    expect(screen.getAllByText('completed')).toHaveLength(2);
    expect(screen.getByText('4024/4024 bars')).toBeInTheDocument();
  });
});
