import { pgTable, uuid, integer, text, jsonb, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { runs } from './runs';

export const soulVersions = pgTable(
  'soul_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .references(() => agents.id)
      .notNull(),
    version: integer('version').notNull(),
    soulMd: text('soul_md').notNull(),
    soulJson: jsonb('soul_json').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    derivedFromRunId: uuid('derived_from_run_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.agentId, t.version)],
);
