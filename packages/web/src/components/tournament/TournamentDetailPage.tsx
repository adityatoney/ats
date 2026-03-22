import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../ui/Layout';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { api } from '../../lib/api-client';
import { useTournament, useTournamentLeaderboard } from '../../hooks/useTournament';
import { useTournamentSSE } from '../../hooks/useTournamentSSE';
import { LeaderboardTable } from './LeaderboardTable';
import { useEffect, useState } from 'react';

interface TournamentEntry {
  id: string;
  agentId: string;
  agentName: string;
  runId: string | null;
  status: string;
  finalRank: number | null;
  run: {
    id: string;
    status: string;
    processedBars: number;
    totalBars: number;
    metricsJson: Record<string, number> | null;
  } | null;
}

interface TournamentData {
  id: string;
  name: string;
  status: string;
  agentCount: number;
  completedCount: number;
  configJson: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  entries: TournamentEntry[];
}

export function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: tournament, isLoading } = useTournament(id) as {
    data: TournamentData | undefined;
    isLoading: boolean;
  };
  const { data: leaderboard } = useTournamentLeaderboard(id);
  const { events } = useTournamentSSE(
    tournament?.status === 'in_progress' ? id : undefined,
  );

  // Invalidate queries on SSE events
  useEffect(() => {
    if (events.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament-leaderboard', id] });
    }
  }, [events.length, id, queryClient]);

  const startMutation = useMutation({
    mutationFn: () => api.startTournament(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tournament', id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelTournament(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tournament', id] }),
  });

  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTournament(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      navigate('/tournaments');
    },
    onError: (err) => {
      setShowDeleteConfirm(false);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete tournament');
    },
  });

  const canDelete = tournament?.status && tournament.status !== 'in_progress';

  if (isLoading) {
    return (
      <Layout>
        <div className="text-gray-400">Loading...</div>
      </Layout>
    );
  }

  if (!tournament) {
    return (
      <Layout>
        <div className="text-red-400">Tournament not found</div>
      </Layout>
    );
  }

  const config = tournament.configJson;
  const isActive = tournament.status === 'in_progress';
  const isCompleted = ['completed', 'partially_failed'].includes(tournament.status);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{tournament.name}</h1>
            <p className="text-sm text-gray-400 mt-1">
              {tournament.agentCount} agents ·{' '}
              {(config.symbols as string[])?.join(', ')} ·{' '}
              {config.startDate as string} to {config.endDate as string}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={tournament.status} />
            {tournament.status === 'pending' && (
              <button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {startMutation.isPending ? 'Starting...' : 'Start Tournament'}
              </button>
            )}
            {isActive && (
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            {isCompleted && (
              <Link
                to={`/tournaments/${id}/compare`}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Compare Agents
              </Link>
            )}
            {canDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          title="Delete Tournament"
          message="This will permanently delete this tournament and its leaderboard. Individual agent runs will be preserved. This cannot be undone."
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
          isLoading={deleteMutation.isPending}
        />

        {deleteError && (
          <div className="rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-300">
            {deleteError}
          </div>
        )}

        {/* Progress */}
        {isActive && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Tournament Progress</span>
              <span className="text-sm text-gray-400">
                {tournament.completedCount} / {tournament.agentCount} agents completed
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{
                  width: `${(tournament.completedCount / tournament.agentCount) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Agent Cards */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Agents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tournament.entries?.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{entry.agentName}</span>
                  <EntryStatusBadge status={entry.status} />
                </div>
                {entry.run && (
                  <div className="space-y-1">
                    {entry.run.totalBars > 0 && (
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all"
                          style={{
                            width: `${(entry.run.processedBars / entry.run.totalBars) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-400">
                      {entry.run.processedBars}/{entry.run.totalBars} bars
                    </p>
                    {entry.run.metricsJson && (
                      <p className="text-xs text-gray-300">
                        Return:{' '}
                        <span
                          className={
                            entry.run.metricsJson.totalReturn >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }
                        >
                          {(entry.run.metricsJson.totalReturn * 100).toFixed(2)}%
                        </span>
                      </p>
                    )}
                    <Link
                      to={`/runs/${entry.runId}`}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View Run →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard */}
        {isCompleted && (leaderboard as unknown[])?.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Leaderboard</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <LeaderboardTable entries={leaderboard as never[]} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-700 text-gray-300',
    in_progress: 'bg-blue-900 text-blue-300',
    completed: 'bg-green-900 text-green-300',
    partially_failed: 'bg-yellow-900 text-yellow-300',
    failed: 'bg-red-900 text-red-300',
    cancelled: 'bg-gray-700 text-gray-400',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function EntryStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900 text-blue-300',
    completed: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}
    >
      {status}
    </span>
  );
}
