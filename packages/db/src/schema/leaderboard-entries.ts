import {
  pgTable,
  uuid,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { tournaments } from './tournaments';
import { agents } from './agents';
import { runs } from './runs';

export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tournamentId: uuid('tournament_id')
      .references(() => tournaments.id)
      .notNull(),
    agentId: uuid('agent_id')
      .references(() => agents.id)
      .notNull(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    rank: integer('rank').notNull(),
    totalReturn: numeric('total_return', { precision: 18, scale: 8 }),
    sharpeRatio: numeric('sharpe_ratio', { precision: 18, scale: 8 }),
    sortinoRatio: numeric('sortino_ratio', { precision: 18, scale: 8 }),
    maxDrawdown: numeric('max_drawdown', { precision: 18, scale: 8 }),
    winRate: numeric('win_rate', { precision: 18, scale: 8 }),
    profitFactor: numeric('profit_factor', { precision: 18, scale: 8 }),
    netProfit: numeric('net_profit', { precision: 18, scale: 8 }),
    totalTrades: integer('total_trades'),
    metricsJson: jsonb('metrics_json').default({}).notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (table) => [unique('leaderboard_tournament_agent_unique').on(table.tournamentId, table.agentId)],
);
