export interface NormalizedCandle {
  index: number;
  time?: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AccountSnapshot {
  login?: string;
  server?: string;
  broker?: string;
  mode: "DEMO" | "REAL";
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  dailyPnlBrl: number;
}

export interface PendingRequest {
  id: string;
  channelId: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  status: "pending" | "processing" | "completed" | "failed";
  result?: NormalizedCandle[];
  error?: string;
}

export interface PairingAttemptEvent {
  id: string;
  timestamp: string;
  outcome: "success" | "error" | "request" | "info";
  httpStatus: number;
  source: string;
  summary: string;
  detail: string;
  requestId?: string;
  symbol?: string;
  timeframe?: string;
  candlesCount?: number;
  tradesCount?: number;
  magicNumber?: number;
}

export interface LiveSyncChannel {
  token: string;
  updatedAtMs: number;
  account: any;
  robots: Map<string, any>;
  pairingEvents: PairingAttemptEvent[];
  subscribers: Set<any>;
}

export const mt5Channels = new Map<string, LiveSyncChannel>();
