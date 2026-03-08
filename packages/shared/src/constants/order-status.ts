export const OrderStatus = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  FILLED: 'filled',
  PARTIALLY_FILLED: 'partially_filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
} as const;

export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderSide = {
  BUY: 'buy',
  SELL: 'sell',
} as const;

export type OrderSideType = (typeof OrderSide)[keyof typeof OrderSide];

export const OrderType = {
  MARKET: 'market',
  LIMIT: 'limit',
  STOP: 'stop',
} as const;

export type OrderTypeValue = (typeof OrderType)[keyof typeof OrderType];
