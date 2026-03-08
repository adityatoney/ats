export interface Position {
  id: string;
  runId: string;
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface PortfolioSnapshot {
  id: string;
  runId: string;
  barIndex: number;
  timestampSimulated: string;
  cash: number;
  equity: number;
  positionsJson: Record<string, unknown>;
  drawdown: number;
  highWaterMark: number;
}
