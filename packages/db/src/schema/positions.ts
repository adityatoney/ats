import { pgTable, uuid, varchar, numeric, unique } from 'drizzle-orm/pg-core';
import { runs } from './runs';

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 8 }).notNull(),
    avgEntryPrice: numeric('avg_entry_price', { precision: 18, scale: 8 }).notNull(),
    currentPrice: numeric('current_price', { precision: 18, scale: 8 }).notNull(),
    unrealizedPnl: numeric('unrealized_pnl', { precision: 18, scale: 8 }).notNull(),
    realizedPnl: numeric('realized_pnl', { precision: 18, scale: 8 }).notNull(),
  },
  (t) => [unique().on(t.runId, t.symbol)],
);
