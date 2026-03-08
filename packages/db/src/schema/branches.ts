import { pgTable, uuid, text, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { runs } from './runs';
import { checkpoints } from './checkpoints';

export const branches = pgTable('branches', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .references(() => runs.id)
    .notNull(),
  parentCheckpointId: uuid('parent_checkpoint_id')
    .references(() => checkpoints.id)
    .notNull(),
  parentBranchId: uuid('parent_branch_id'),
  parentRunId: uuid('parent_run_id')
    .references(() => runs.id)
    .notNull(),
  changeSummary: text('change_summary').notNull(),
  rationale: text('rationale'),
  creatorType: varchar('creator_type', { length: 50 }).notNull().default('user'),
  overridesJson: jsonb('overrides_json').default({}).notNull(),
  resultDeltaJson: jsonb('result_delta_json'),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
