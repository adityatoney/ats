import { pgTable, uuid, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { runs } from './runs';

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    barIndex: integer('bar_index').notNull(),
    timestampSimulated: timestamp('timestamp_simulated'),
    stateBlob: jsonb('state_blob').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('checkpoints_run_bar_idx').on(t.runId, t.barIndex)],
);
