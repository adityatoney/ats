const BASE_URL = '/api';

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
    throw new Error(`API error ${res.status}: ${body}`);
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
    data: { strategyMd: string; strategyPy?: string; configJson?: Record<string, unknown> },
  ) => request(`/agents/${agentId}/strategy`, { method: 'PUT', body: JSON.stringify(data) }),

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
  generateSoul: (runId: string) =>
    request(`/runs/${runId}/generate-soul`, { method: 'POST' }),
};
