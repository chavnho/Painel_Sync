export type DashboardView =
  | 'overview'
  | 'charts'
  | 'buy-sell'
  | 'operations'
  | 'reports'
  | 'connect'
  | 'market-chart';

export type TradeSide = 'COMPRA' | 'VENDA';

export interface Mt5SyncCredentials {
  channelId: string;
  token: string;
}

export interface LiveCandle {
  index: number;
  time?: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveOverlay {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  values: Array<number | null>;
}

export interface LiveMarker {
  candleIndex: number;
  price: number;
  type: 'buy' | 'sell' | 'exit';
  label: string;
}

export interface OpenPosition {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: TradeSide;
  volume: number;
  entryPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  floatingPnlBrl: number;
  openTime: string;
  pointsOpen: number;
}

export interface PendingOrder {
  id: string;
  robotId: string;
  robotName?: string;
  magicNumber: number;
  symbol: string;
  side: TradeSide;
  orderType: string;
  volume: number;
  price: number;
  sl: number;
  tp: number;
}

export interface ExecutedTrade {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: TradeSide;
  entryDate?: string;
  exitDate?: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  points: number;
  pnlBrl: number;
  reason: string;
}

export interface RobotStream {
  robotId: string;
  name: string;
  magicNumber: number;
  symbol: string;
  timeframe: string;
  status: string;
  lastUpdate: string;
  position: OpenPosition | null;
  pendingOrders?: PendingOrder[];
  candles: LiveCandle[];
  candlesByTimeframe?: Record<string, LiveCandle[]>;
  overlays: LiveOverlay[];
  markers: LiveMarker[];
  trades: ExecutedTrade[];
  historyTrades?: ExecutedTrade[];
  realizedPnlBrl: number;
  floatingPnlBrl: number;
  dailyPnlBrl: number;
}

export interface AccountSnapshot {
  login?: string;
  server?: string;
  broker?: string;
  mode: 'DEMO' | 'REAL';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  dailyPnlBrl: number;
}

export interface PairingAttemptEvent {
  id: string;
  timestamp: string;
  outcome: 'success' | 'error' | 'info';
  httpStatus: number;
  source: 'mt5' | 'ping' | 'unknown';
  summary: string;
  detail: string;
  symbol?: string;
  magicNumber?: number;
  candlesCount?: number;
  tradesCount?: number;
}

export interface DashboardTelemetry {
  channelId: string;
  account: AccountSnapshot | null;
  robots: RobotStream[];
  serverReceivedAt: string;
  pairingEvents?: PairingAttemptEvent[];
}

export interface SideStats {
  count: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnlBrl: number;
  grossProfitBrl: number;
  grossLossBrl: number;
  profitFactor: number;
  avgWinBrl: number;
  avgLossBrl: number;
  payoffRatio: number;
  totalVolume: number;
  avgPoints: number;
  bestTradeBrl: number;
  worstTradeBrl: number;
}

export interface PortfolioMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  realizedPnlBrl: number;
  floatingPnlBrl: number;
  netPnlBrl: number;
  grossProfitBrl: number;
  grossLossBrl: number;
  profitFactor: number;
  payoffRatio: number;
  maxDrawdownBrl: number;
  maxDrawdownPct: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  totalVolume: number;
  buys: SideStats;
  sells: SideStats;
}


