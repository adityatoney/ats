import type { AgentStatusType } from '../constants/run-status';

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  status: AgentStatusType;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyVersion {
  id: string;
  agentId: string;
  version: number;
  strategyMd: string;
  strategyPy: string | null;
  configJson: Record<string, unknown>;
  createdAt: string;
}
