import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { tournaments } from './tournaments';
import { agents } from './agents';
import { runs } from './runs';

export const tournamentEntries = pgTable(
  'tournament_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tournamentId: uuid('tournament_id')
      .references(() => tournaments.id)
      .notNull(),
    agentId: uuid('agent_id')
      .references(() => agents.id)
      .notNull(),
    runId: uuid('run_id').references(() => runs.id),
    finalRank: integer('final_rank'),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('tournament_agent_unique').on(table.tournamentId, table.agentId)],
);
