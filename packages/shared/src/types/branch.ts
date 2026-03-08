export interface Branch {
  id: string;
  runId: string;
  parentCheckpointId: string;
  parentBranchId: string | null;
  parentRunId: string;
  changeSummary: string;
  rationale: string;
  creatorType: 'user' | 'agent';
  overridesJson: Record<string, unknown>;
  resultDeltaJson: ResultDelta | null;
  status: string;
  createdAt: string;
}

export interface ResultDelta {
  totalReturnDelta: number;
  sharpeDelta: number;
  maxDrawdownDelta: number;
  winRateDelta: number;
  profitFactorDelta: number;
}

export interface DAGNode {
  id: string;
  runId: string;
  parentId: string | null;
  label: string;
  status: string;
  metrics: Record<string, number> | null;
}
