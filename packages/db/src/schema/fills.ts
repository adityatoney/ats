import { pgTable, uuid, numeric, timestamp } from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { runs } from './runs';

export const fills = pgTable('fills', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .references(() => orders.id)
    .notNull(),
  runId: uuid('run_id')
    .references(() => runs.id)
    .notNull(),
  fillPrice: numeric('fill_price', { precision: 18, scale: 8 }).notNull(),
  fillQuantity: numeric('fill_quantity', { precision: 18, scale: 8 }).notNull(),
  fee: numeric('fee', { precision: 18, scale: 8 }).notNull(),
  slippage: numeric('slippage', { precision: 18, scale: 8 }).notNull(),
  filledAtSim: timestamp('filled_at_sim'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
