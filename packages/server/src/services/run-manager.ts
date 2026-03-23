import { convex } from '../lib/convex';
import { api } from '../../../../convex/_generated/api';
import { pythonClient } from '../lib/python-client';
import { eventBus } from './event-bus';
import { ensureDeterministicArtifacts } from './strategy-artifacts';

export const runManager = {
  async startBacktest(agentId: string, config: Record<string, unknown>) {
    const agent = await convex.query(api.agents.get, { id: agentId as any });
    if (!agent) throw new Error('Agent not found');

    const latestStrategy = await convex.query(api.strategyVersions.getLatestByAgent, { agentId: agentId as any });
    if (!latestStrategy) throw new Error('No strategy version found');
    const runnableStrategy = await ensureDeterministicArtifacts(latestStrategy);
    if (!runnableStrategy.strategyPy) throw new Error('Strategy Python artifact is missing');

    const run = await convex.mutation(api.runs.create, {
      pgId: '',
      agentId: agentId as any,
      strategyVersionId: runnableStrategy._id as any,
      status: 'pending',
      runType: 'backtest',
      configJson: config,
      totalBars: 0,
      processedBars: 0,
    });

    await convex.mutation(api.agents.update, {
      id: agentId as any,
      status: 'backtesting',
      updatedAt: Date.now(),
    });

    await pythonClient.startRun({
      runId: run!._id,
      agentId,
      sourceKind: runnableStrategy.sourceKind,
      strategyPy: runnableStrategy.strategyPy,
      strategyIrJson: runnableStrategy.strategyIrJson as Record<string, unknown> | null,
      config,
    });

    return run;
  },

  async pauseRun(runId: string) {
    await pythonClient.pauseRun(runId);
    await convex.mutation(api.runs.update, { id: runId as any, status: 'paused' });
  },

  async resumeRun(runId: string) {
    await pythonClient.resumeRun(runId);
    await convex.mutation(api.runs.update, { id: runId as any, status: 'running' });
  },

  async cancelRun(runId: string) {
    await pythonClient.cancelRun(runId);
    await convex.mutation(api.runs.update, { id: runId as any, status: 'cancelled' });
    const run = await convex.query(api.runs.get, { id: runId as any });
    if (run) {
      await convex.mutation(api.agents.update, {
        id: run.agentId,
        status: 'cancelled',
        updatedAt: Date.now(),
      });
    }
  },

  handleRuntimeEvent(event: {
    runId: string;
    eventType: string;
    payload: Record<string, unknown>;
    timestampSimulated?: string;
    barIndex?: number;
  }) {
    eventBus.publish(event);
  },
};
