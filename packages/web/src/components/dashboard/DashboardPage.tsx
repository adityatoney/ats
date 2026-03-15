import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

export function DashboardPage() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents() as Promise<Array<Record<string, unknown>>>,
  });

  const { data: tournaments, isLoading: tournamentsLoading } = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api.listTournaments() as Promise<Array<Record<string, unknown>>>,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex gap-2">
            <Link
              to="/agents/new"
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors"
            >
              New Agent
            </Link>
            <Link
              to="/tournaments/new"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              New Tournament
            </Link>
          </div>
        </div>

        {/* Recent Tournaments */}
        {!tournamentsLoading && tournaments && tournaments.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Recent Tournaments</h2>
              <Link to="/tournaments" className="text-sm text-blue-400 hover:text-blue-300">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {tournaments.slice(0, 3).map((t) => (
                <Link
                  key={t.id as string}
                  to={`/tournaments/${t.id}`}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-sm">{t.name as string}</h3>
                    <TournamentStatusBadge status={t.status as string} />
                  </div>
                  <p className="text-xs text-gray-400">
                    {t.agentCount as number} agents · {new Date(t.createdAt as string).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Agents section header */}
        <h2 className="text-lg font-semibold">Agents</h2>

        {isLoading ? (
          <div className="text-gray-400">Loading...</div>
        ) : !agents?.length ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
            <p className="text-gray-400 mb-4">No agents yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <Link
                key={agent.id as string}
                to={`/agents/${agent.id}`}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{agent.name as string}</h3>
                  <StatusBadge status={agent.status as string} />
                </div>
                <p className="text-sm text-gray-400">
                  Created: {new Date(agent.createdAt as string).toLocaleDateString()}
                </p>
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-gray-700 text-gray-300',
    backtesting: 'bg-blue-900 text-blue-300',
    paused: 'bg-yellow-900 text-yellow-300',
    completed: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
    cancelled: 'bg-gray-700 text-gray-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.idle}`}>
      {status}
    </span>
  );
}
