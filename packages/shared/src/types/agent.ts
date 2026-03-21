import type { AgentStatusType } from '../constants/run-status';
import type { StrategySourceKind } from './api';

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
  sourceKind: StrategySourceKind;
  strategyMd: string | null;
  strategyPine: string | null;
  strategyPy: string | null;
  strategyIrJson: Record<string, unknown> | null;
  configJson: Record<string, unknown>;
  createdAt: string;
}
