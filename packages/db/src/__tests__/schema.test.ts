import { describe, it, expect } from 'vitest';
import { users, projects, agents, runs } from '../schema/index';

describe('db schema', () => {
  it('exports all tables', () => {
    expect(users).toBeDefined();
    expect(projects).toBeDefined();
    expect(agents).toBeDefined();
    expect(runs).toBeDefined();
  });
});
