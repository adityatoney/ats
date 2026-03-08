import { pgTable, uuid, varchar, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { runs } from './runs';

export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').default({}).notNull(),
    timestampSimulated: timestamp('timestamp_simulated'),
    barIndex: integer('bar_index'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('agent_events_run_created_idx').on(t.runId, t.createdAt)],
);
