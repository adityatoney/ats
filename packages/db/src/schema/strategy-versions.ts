import { pgTable, uuid, integer, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const strategyVersions = pgTable(
  'strategy_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .references(() => agents.id)
      .notNull(),
    version: integer('version').notNull(),
    strategyMd: text('strategy_md').notNull(),
    strategyPy: text('strategy_py'),
    configJson: jsonb('config_json').default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.agentId, t.version)],
);
