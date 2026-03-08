import type { RunStatusType } from '../constants/run-status';

export interface RunConfig {
  symbols: string[];
  startDate: string;
  endDate: string;
  timeframe: string;
  initialCapital: number;
  slippageBps: number;
  feePerShare: number;
  feePercentage: number;
  seed: number;
  checkpointInterval: number;
}

export interface RunMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeReturn: number;
}

export interface Run {
  id: string;
  agentId: string;
  strategyVersionId: string;
  branchId: string | null;
  status: RunStatusType;
  runType: 'backtest' | 'branch';
  configJson: RunConfig;
  metricsJson: RunMetrics | null;
  totalBars: number;
  processedBars: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}
