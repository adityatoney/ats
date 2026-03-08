export const EventTypes = {
  RUN_STARTED: 'run.started',
  RUN_COMPLETED: 'run.completed',
  RUN_FAILED: 'run.failed',
  RUN_PAUSED: 'run.paused',
  RUN_RESUMED: 'run.resumed',
  RUN_CANCELLED: 'run.cancelled',
  RUN_PROGRESS: 'run.progress',
  ORDER_SUBMITTED: 'order.submitted',
  ORDER_FILLED: 'order.filled',
  ORDER_CANCELLED: 'order.cancelled',
  CHECKPOINT_SAVED: 'checkpoint.saved',
  SIGNAL_GENERATED: 'signal.generated',
  PORTFOLIO_UPDATED: 'portfolio.updated',
  SOUL_GENERATED: 'soul.generated',
  BRANCH_CREATED: 'branch.created',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
