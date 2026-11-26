export type DashboardView =
  | 'overview'
  | 'charts'
  | 'buy-sell'
  | 'operations'
  | 'reports'
  | 'robots'
  | 'simulator'
  | 'connect';

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
  hidden?: boolean;
}

export interface AccountSnapshot {
  login?: string;
  server?: string;
  broker?: string;
  mode: 'DEMO' | 'REAL';
  marginMode?: 'NETTING' | 'HEDGE';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  dailyPnlBrl: number;
  hidden?: boolean;
}

export interface PairingAttemptEvent {
  id: string;
  timestamp: string;
  outcome: 'success' | 'error' | 'info' | 'request';
  httpStatus: number;
  source: 'mt5' | 'ping' | 'backend' | 'frontend' | 'unknown';
  category?: 'orders' | 'positions' | 'connection' | 'server';
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
  activeContracts?: Record<string, string>;
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

export type CommandAction =
  | 'CLOSE_MAGIC'
  | 'CANCEL_ORDERS'
  | 'CLOSE_ALL'
  | 'OPEN_ORDER'
  | 'MODIFY_SL_TP';

export type CommandStatus =
  | 'pending'
  | 'dispatched'
  | 'executed'
  | 'failed'
  | 'expired';

export interface RemoteCommand {
  id: string;
  channelId: string;
  magicNumber: number;
  action: CommandAction;
  symbol?: string;
  side?: TradeSide;
  volume?: number;
  price?: number;
  sl?: number;
  tp?: number;
  status: CommandStatus;
  expiresAt: string;
  mt5OrderTicket?: string;
  mt5PositionTicket?: string;
  retcode?: number;
  ackMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type ManagedStrategyType = 'ema_cross' | 'rsi_reversal' | 'breakout';

export interface ManagedRobotParams {
  maType?: 'EMA' | 'SMA';
  fastPeriod?: number;
  slowPeriod?: number;
  rsiPeriod?: number;
  oversold?: number;
  overbought?: number;
  lookbackBars?: number;
}

export interface ManagedRobotRisk {
  volume: number;
  stopPoints: number;
  takePoints: number;
  startTime: string;
  endTime: string;
  closeTime: string;
  maxDailyLossBrl: number;
  reverseOnOpposite: boolean;
}

export interface ManagedRobot {
  id: string;
  channelId: string;
  name: string;
  magicNumber: number;
  symbol: string;
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1';
  enabled: boolean;
  strategyType: ManagedStrategyType;
  params: ManagedRobotParams;
  risk: ManagedRobotRisk;
  lastSignalBar: number;
  lastDecision: string;
  createdAt: string;
  updatedAt: string;
}
