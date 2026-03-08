export const RunStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type RunStatusType = (typeof RunStatus)[keyof typeof RunStatus];

export const AgentStatus = {
  IDLE: 'idle',
  BACKTESTING: 'backtesting',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type AgentStatusType = (typeof AgentStatus)[keyof typeof AgentStatus];
