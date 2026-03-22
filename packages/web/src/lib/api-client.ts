const BASE_URL = '/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  diagnostics: Array<Record<string, unknown>>;

  constructor(
    message: string,
    status: number,
    code?: string,
    diagnostics: Array<Record<string, unknown>> = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    let parsedError:
      | {
          message?: string;
          code?: string;
          diagnostics?: Array<Record<string, unknown>>;
        }
      | undefined;
    try {
      const json = JSON.parse(body) as {
        error?: {
          message?: string;
          code?: string;
          diagnostics?: Array<Record<string, unknown>>;
        };
      };
      parsedError = json.error;
    } catch {
      parsedError = undefined;
    }
    throw new ApiError(
      parsedError?.message || `API error ${res.status}: ${body}`,
      res.status,
      parsedError?.code,
      parsedError?.diagnostics || [],
    );
  }

  const json = await res.json();
  return json.data;
}

export const api = {
  // Projects
  getProject: (id: string) => request(`/projects/${id}`),
  createProject: (data: { name: string; description?: string; ownerId: string }) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),

  // Agents
  listAgents: () => request(`/agents`),
  getAgent: (id: string) => request(`/agents/${id}`),
  getAgentRuns: (id: string) => request(`/agents/${id}/runs`),
  createAgent: (projectId: string, data: { name: string }) =>
    request(`/projects/${projectId}/agents`, { method: 'POST', body: JSON.stringify(data) }),
  updateStrategy: (
    agentId: string,
    data: {
      sourceKind: 'pine' | 'markdown_yaml' | 'legacy_python';
      strategyMd?: string;
      strategyPine?: string;
      strategyPy?: string;
      strategyIrJson?: Record<string, unknown>;
      configJson?: Record<string, unknown>;
    },
  ) => request(`/agents/${agentId}/strategy`, { method: 'PUT', body: JSON.stringify(data) }),
  compileStrategy: (data: { sourceKind: 'pine' | 'markdown_yaml'; source: string }) =>
    request<{
      strategyIrJson: Record<string, unknown>;
      strategyPine: string;
      strategyPy: string;
      diagnostics: Array<Record<string, unknown>>;
      roundtrippable: boolean;
    }>(`/agents/compile-strategy`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Runs
  startBacktest: (data: {
    agentId: string;
    symbols: string[];
    startDate: string;
    endDate: string;
    timeframe?: string;
    initialCapital?: number;
    slippageBps?: number;
    feePerShare?: number;
    seed?: number;
    checkpointInterval?: number;
  }) => request('/runs', { method: 'POST', body: JSON.stringify(data) }),
  getRun: (id: string) => request(`/runs/${id}`),
  getRunEvents: (id: string, offset = 0, limit = 50) =>
    request(`/runs/${id}/events?offset=${offset}&limit=${limit}`),
  getRunOrders: (id: string) => request(`/runs/${id}/orders`),
  getRunPortfolio: (id: string) => request(`/runs/${id}/portfolio`),
  getRunCheckpoints: (id: string) => request(`/runs/${id}/checkpoints`),
  pauseRun: (id: string) => request(`/runs/${id}/pause`, { method: 'POST' }),
  resumeRun: (id: string) => request(`/runs/${id}/resume`, { method: 'POST' }),
  cancelRun: (id: string) => request(`/runs/${id}/cancel`, { method: 'POST' }),

  // Branches
  forkBranch: (
    checkpointId: string,
    data: { changeSummary: string; rationale: string; overrides: Record<string, unknown> },
  ) =>
    request(`/checkpoints/${checkpointId}/branch`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getBranchDAG: (runId: string) => request(`/branches/run/${runId}`),

  // Soul
  getActiveSoul: (agentId: string) => request(`/souls/agent/${agentId}`),
  getSoulVersions: (agentId: string) => request(`/souls/agent/${agentId}/versions`),
  approveSoul: (agentId: string, versionId: string) =>
    request(`/souls/agent/${agentId}/${versionId}/approve`, { method: 'POST' }),
  generateSoul: (runId: string) => request(`/runs/${runId}/generate-soul`, { method: 'POST' }),

  // Tournaments
  listTournaments: (projectId?: string) =>
    request(`/tournaments${projectId ? `?projectId=${projectId}` : ''}`),
  createTournament: (data: {
    projectId: string;
    name: string;
    agentIds: string[];
    config: Record<string, unknown>;
  }) => request('/tournaments', { method: 'POST', body: JSON.stringify(data) }),
  getTournament: (id: string) => request(`/tournaments/${id}`),
  startTournament: (id: string) => request(`/tournaments/${id}/start`, { method: 'POST' }),
  cancelTournament: (id: string) => request(`/tournaments/${id}/cancel`, { method: 'POST' }),
  getTournamentLeaderboard: (id: string) => request(`/tournaments/${id}/leaderboard`),
  getTournamentComparison: (id: string) => request(`/tournaments/${id}/comparison`),

  // Delete
  deleteAgent: (id: string) => request(`/agents/${id}`, { method: 'DELETE' }),
  deleteTournament: (id: string) => request(`/tournaments/${id}`, { method: 'DELETE' }),
  deleteRun: (id: string) => request(`/runs/${id}`, { method: 'DELETE' }),
};
