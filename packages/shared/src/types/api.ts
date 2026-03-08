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

export interface UpdateStrategyRequest {
  strategyMd: string;
  strategyPy?: string;
  configJson?: Record<string, unknown>;
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
