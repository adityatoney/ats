export interface ApiResponse<T> {
  data: T;
  error?: never;
}

export interface ApiError {
  data?: never;
  error: {
    message: string;
    code: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface CreateAgentRequest {
  name: string;
}

export type StrategySourceKind = 'pine' | 'markdown_yaml' | 'legacy_python';

export interface UpdateStrategyRequest {
  sourceKind: StrategySourceKind;
  strategyMd?: string;
  strategyPine?: string;
  strategyPy?: string;
  strategyIrJson?: Record<string, unknown>;
  configJson?: Record<string, unknown>;
}

export interface CompileStrategyRequest {
  sourceKind: 'pine' | 'markdown_yaml';
  source: string;
}

export interface CompileStrategyResponse {
  strategyIrJson: Record<string, unknown>;
  strategyPine: string;
  strategyPy: string;
  diagnostics: Array<{
    code: string;
    message: string;
    severity: 'error' | 'warning';
    span?: {
      line?: number | null;
      column?: number | null;
      endLine?: number | null;
      endColumn?: number | null;
    } | null;
  }>;
  roundtrippable: boolean;
}

export interface StrategyVersionResponse {
  id: string;
  agentId: string;
  version: number;
  sourceKind: StrategySourceKind;
  strategyMd: string | null;
  strategyPine: string | null;
  strategyPy: string | null;
  strategyIrJson: Record<string, unknown> | null;
  configJson: Record<string, unknown>;
  createdAt: string;
}

export interface StartBacktestRequest {
  symbols: string[];
  startDate: string;
  endDate: string;
  timeframe?: string;
  initialCapital?: number;
  slippageBps?: number;
  feePerShare?: number;
  feePercentage?: number;
  seed?: number;
  checkpointInterval?: number;
}

export interface ForkBranchRequest {
  changeSummary: string;
  rationale: string;
  overrides: Record<string, unknown>;
}
