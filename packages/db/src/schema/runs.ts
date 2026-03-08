import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { strategyVersions } from './strategy-versions';

export const runs = pgTable('runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id')
    .references(() => agents.id)
    .notNull(),
  strategyVersionId: uuid('strategy_version_id')
    .references(() => strategyVersions.id)
    .notNull(),
  branchId: uuid('branch_id'),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  runType: varchar('run_type', { length: 50 }).notNull().default('backtest'),
  configJson: jsonb('config_json').default({}).notNull(),
  metricsJson: jsonb('metrics_json'),
  totalBars: integer('total_bars').notNull().default(0),
  processedBars: integer('processed_bars').notNull().default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
