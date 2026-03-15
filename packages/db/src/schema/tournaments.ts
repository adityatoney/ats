import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const tournaments = pgTable('tournaments', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  configJson: jsonb('config_json').default({}).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  dataSnapshotId: varchar('data_snapshot_id', { length: 255 }),
  agentCount: integer('agent_count').notNull().default(0),
  completedCount: integer('completed_count').notNull().default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
