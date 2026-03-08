import { pgTable, uuid, integer, timestamp, numeric, jsonb, index } from 'drizzle-orm/pg-core';
import { runs } from './runs';

export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    barIndex: integer('bar_index').notNull(),
    timestampSimulated: timestamp('timestamp_simulated'),
    cash: numeric('cash', { precision: 18, scale: 8 }).notNull(),
    equity: numeric('equity', { precision: 18, scale: 8 }).notNull(),
    positionsJson: jsonb('positions_json').default({}).notNull(),
    drawdown: numeric('drawdown', { precision: 18, scale: 8 }).notNull(),
    highWaterMark: numeric('high_water_mark', { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('portfolio_snapshots_run_bar_idx').on(t.runId, t.barIndex)],
);
