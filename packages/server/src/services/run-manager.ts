import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { runs, strategyVersions, agents } from '@aegis/db/schema';
import { pythonClient } from '../lib/python-client';
import { eventBus } from './event-bus';

export const runManager = {
  async startBacktest(agentId: string, config: Record<string, unknown>) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    if (!agent) throw new Error('Agent not found');

    const latestStrategy = await db.query.strategyVersions.findFirst({
      where: eq(strategyVersions.agentId, agentId),
      orderBy: (sv, { desc }) => [desc(sv.version)],
    });
    if (!latestStrategy) throw new Error('No strategy version found');

    const [run] = await db
      .insert(runs)
      .values({
        agentId,
        strategyVersionId: latestStrategy.id,
        status: 'pending',
        runType: 'backtest',
        configJson: config,
        totalBars: 0,
        processedBars: 0,
      })
      .returning();

    await db.update(agents).set({ status: 'backtesting' }).where(eq(agents.id, agentId));

    await pythonClient.startRun({
      runId: run.id,
      agentId,
      strategyMd: latestStrategy.strategyMd,
      strategyPy: latestStrategy.strategyPy,
      config,
    });

    return run;
  },

  async pauseRun(runId: string) {
    await pythonClient.pauseRun(runId);
    await db.update(runs).set({ status: 'paused' }).where(eq(runs.id, runId));
  },

  async resumeRun(runId: string) {
    await pythonClient.resumeRun(runId);
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId));
  },

  async cancelRun(runId: string) {
    await pythonClient.cancelRun(runId);
    await db.update(runs).set({ status: 'cancelled' }).where(eq(runs.id, runId));
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (run) {
      await db.update(agents).set({ status: 'cancelled' }).where(eq(agents.id, run.agentId));
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
