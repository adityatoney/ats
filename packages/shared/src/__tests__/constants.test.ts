import { describe, it, expect } from 'vitest';
import { EventTypes, RunStatus, OrderStatus } from '../index';

describe('shared constants', () => {
  it('has all event types', () => {
    expect(EventTypes.RUN_STARTED).toBe('run.started');
    expect(EventTypes.RUN_COMPLETED).toBe('run.completed');
    expect(EventTypes.ORDER_FILLED).toBe('order.filled');
  });

  it('has all run statuses', () => {
    expect(RunStatus.PENDING).toBe('pending');
    expect(RunStatus.RUNNING).toBe('running');
    expect(RunStatus.COMPLETED).toBe('completed');
  });

  it('has all order statuses', () => {
    expect(OrderStatus.PENDING).toBe('pending');
    expect(OrderStatus.FILLED).toBe('filled');
  });
});
