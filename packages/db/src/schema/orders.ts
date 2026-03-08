import { pgTable, uuid, varchar, numeric, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { runs } from './runs';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => runs.id)
      .notNull(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    side: varchar('side', { length: 10 }).notNull(),
    orderType: varchar('order_type', { length: 20 }).notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 8 }).notNull(),
    limitPrice: numeric('limit_price', { precision: 18, scale: 8 }),
    stopPrice: numeric('stop_price', { precision: 18, scale: 8 }),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    submittedAtSim: timestamp('submitted_at_sim'),
    filledAtSim: timestamp('filled_at_sim'),
    barIndex: integer('bar_index').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('orders_run_idx').on(t.runId)],
);
