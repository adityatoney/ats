import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../ui/Layout';
import { api } from '../../lib/api-client';

interface Agent {
  id: string;
  name: string;
  status: string;
}

export function CreateTournamentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [symbols, setSymbols] = useState('SPY,QQQ,AAPL');
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2023-01-01');
  const [timeframe, setTimeframe] = useState('1Day');
  const [initialCapital, setInitialCapital] = useState(100000);

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents() as Promise<Agent[]>,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createTournament>[0]) =>
      api.createTournament(data) as Promise<{ id: string }>,
    onSuccess: (data) => {
      navigate(`/tournaments/${data.id}`);
    },
  });

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || selectedAgents.length < 2) return;

    // Get projectId from first agent (they should all be in the same project)
    const firstAgent = agents?.find((a) => a.id === selectedAgents[0]);
    if (!firstAgent) return;

    createMutation.mutate({
      projectId: (firstAgent as unknown as Record<string, unknown>).projectId as string,
      name,
      agentIds: selectedAgents,
      config: {
        symbols: symbols.split(',').map((s) => s.trim()),
        startDate,
        endDate,
        timeframe,
        initialCapital,
      },
    });
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Create Tournament</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Tournament Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="Q1 2020-2023 Strategy Showdown"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Select Agents (min 2)
            </label>
            <div className="space-y-2">
              {agents?.map((agent) => (
                <label
                  key={agent.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedAgents.includes(agent.id)
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.includes(agent.id)}
                    onChange={() => toggleAgent(agent.id)}
                    className="rounded border-gray-600"
                  />
                  <span className="font-medium">{agent.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Symbols (comma-separated)
              </label>
              <input
                type="text"
                value={symbols}
                onChange={(e) => setSymbols(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Timeframe
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="1Day">Daily</option>
                <option value="1Hour">Hourly</option>
                <option value="1Min">1 Minute</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Initial Capital ($)
              </label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!name || selectedAgents.length < 2 || createMutation.isPending}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Tournament'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
