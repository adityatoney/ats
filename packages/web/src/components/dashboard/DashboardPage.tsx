import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

export function DashboardPage() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents() as Promise<Array<Record<string, unknown>>>,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>

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
