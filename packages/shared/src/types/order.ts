import type { OrderStatusType, OrderSideType, OrderTypeValue } from '../constants/order-status';

export interface Order {
  id: string;
  runId: string;
  symbol: string;
  side: OrderSideType;
  orderType: OrderTypeValue;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  status: OrderStatusType;
  submittedAtSim: string;
  filledAtSim: string | null;
  barIndex: number;
  createdAt: string;
}

export interface Fill {
  id: string;
  orderId: string;
  runId: string;
  fillPrice: number;
  fillQuantity: number;
  fee: number;
  slippage: number;
  filledAtSim: string;
}
