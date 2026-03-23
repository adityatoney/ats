import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

interface Tournament {
  id: string;
  name: string;
  status: string;
  agentCount: number;
  completedCount: number;
  createdAt: string;
}

export function TournamentListPage() {
  const { data: tournaments, isLoading } = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api.listTournaments() as Promise<Tournament[]>,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <Link
            to="/tournaments/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            New Tournament
          </Link>
        </div>

        {isLoading ? (
          <div className="text-gray-400">Loading...</div>
        ) : !tournaments?.length ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
            <p className="text-gray-400 mb-4">No tournaments yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="block rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{t.name}</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {t.agentCount} agents · Created{' '}
                      {new Date((t._creationTime ?? t.createdAt) as number | string).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.status === 'in_progress' && (
                      <span className="text-sm text-gray-400">
                        {t.completedCount}/{t.agentCount}
                      </span>
                    )}
                    <TournamentStatusBadge status={t.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function TournamentStatusBadge({ status }: { status: string }) {
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
