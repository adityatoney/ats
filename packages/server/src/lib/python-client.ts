const PYTHON_BASE_URL = process.env.PYTHON_RUNTIME_URL || 'http://localhost:8000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${PYTHON_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Python runtime error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const pythonClient = {
  startRun(data: {
    runId: string;
    agentId: string;
    strategyMd: string;
    strategyPy: string | null;
    config: Record<string, unknown>;
  }) {
    return request('/api/runs/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  pauseRun(runId: string) {
    return request(`/api/runs/${runId}/pause`, { method: 'POST' });
  },

  resumeRun(runId: string) {
    return request(`/api/runs/${runId}/resume`, { method: 'POST' });
  },

  cancelRun(runId: string) {
    return request(`/api/runs/${runId}/cancel`, { method: 'POST' });
  },

  startBranchRun(data: {
    runId: string;
    parentCheckpointId: string;
    parentRunId: string;
    overrides: Record<string, unknown>;
    strategyMd: string;
    strategyPy: string | null;
    config: Record<string, unknown>;
  }) {
    return request('/api/runs/start-branch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateSoul(data: { runId: string; agentId: string; competitiveContext?: Record<string, unknown> }) {
    return request('/api/soul/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  prefetchData(data: {
    symbols: string[];
    startDate: string;
    endDate: string;
    timeframe: string;
  }) {
    return request('/api/data/prefetch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  startTournament(data: {
    tournamentId: string;
    runs: Array<{
      runId: string;
      agentId: string;
      strategyMd: string;
      strategyPy: string | null;
      config: Record<string, unknown>;
    }>;
    dataSnapshotId: string;
  }) {
    return request('/api/tournaments/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateStrategy(data: { strategyMd: string }) {
    return request<{ strategyPy: string; pineScript: string; valid: boolean; errors: string[] }>('/api/strategy/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  health() {
    return request<{ status: string }>('/health');
  },
};
