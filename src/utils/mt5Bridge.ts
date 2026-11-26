import type {
  LiveCandle,
  Mt5SyncCredentials,
} from '../types/trading';

const STORAGE_KEY = 'painel_sync_mt5_credentials_v2';

export const API_BASE_URL = String(
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

function randomId(prefix: string, length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = prefix;
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function loadOrCreateMt5SyncCredentials(): Mt5SyncCredentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Mt5SyncCredentials>;
      if (parsed.channelId && parsed.token) {
        return { channelId: parsed.channelId, token: parsed.token };
      }
    }
  } catch {
    // ignora storage inválido
  }
  return regenerateMt5SyncCredentials();
}

export function regenerateMt5SyncCredentials(): Mt5SyncCredentials {
  const creds: Mt5SyncCredentials = {
    channelId: randomId('ps_', 10),
    token: randomId('tk_', 18),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // ignora erro de storage
  }
  return creds;
}

export async function fetchCandles(channelId: string, token: string, symbol: string, timeframe: string, signal?: AbortSignal, date?: string): Promise<LiveCandle[]> {
  const dateParam = date ? `&date=${encodeURIComponent(date)}` : "";
  const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}${dateParam}`;
  //console.log(`Fetching candles from: ${url}`);

  const response = await fetch(url, {
    headers: {
      "x-sync-token": token,
    },
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Failed to fetch candles for ${symbol}. Status: ${response.status} ${response.statusText}`);
    console.error(`Response body: ${errorBody}`);
    throw new Error(`Failed to fetch candles for ${symbol}: ${response.statusText}`);
  }

  try {
    const data = await response.json();
    return Array.isArray(data.candles) ? data.candles : [];
  } catch (e) {
    console.error("Failed to parse JSON response from candles endpoint.");
    throw new Error("Invalid JSON response from server");
  }
}

export async function fetchSymbols(
  channelId: string,
  token: string,
  signal?: AbortSignal
): Promise<string[]> {
  const url = `${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/symbols`;
  const response = await fetch(url, {
    headers: { "x-sync-token": token },
    signal,
  });
  if (!response.ok) return [];
  try {
    const data = await response.json();
    return Array.isArray(data.symbols)
      ? data.symbols.map((s: unknown) => String(s)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryFetchCandles(
  channelId: string,
  token: string,
  symbol: string,
  timeframe: string,
  signal?: AbortSignal,
  date?: string
): Promise<LiveCandle[] | null> {
  try {
    const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
    const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}${dateParam}`;
    const response = await fetch(url, { headers: { "x-sync-token": token }, signal });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data.candles) ? data.candles : [];
  } catch {
    return null;
  }
}

export async function requestCandlesFromMt5(
  channelId: string,
  token: string,
  symbol: string,
  timeframe: string,
  isManualRequest?: boolean,
  signal?: AbortSignal,
  date?: string
): Promise<void> {
  const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/request`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-token": token,
    },
    body: JSON.stringify({ symbol, timeframe, isManualRequest, ...(date ? { date } : {}) }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ao solicitar candles (${response.status}): ${body}`);
  }
}

export async function syncCandlesWithMt5(
  channelId: string,
  token: string,
  symbol: string,
  timeframe: string,
  options: { timeoutMs?: number; intervalMs?: number; force?: boolean; signal?: AbortSignal; isManualRequest?: boolean; date?: string } = {}
): Promise<LiveCandle[]> {
  const { timeoutMs = 15000, intervalMs = 1000, force = false, signal, isManualRequest, date } = options;

  if (signal?.aborted) return [];

  if (!force) {
    const cached = await tryFetchCandles(channelId, token, symbol, timeframe, signal, date);
    if (cached && cached.length > 0) return cached;
  }

  await requestCandlesFromMt5(channelId, token, symbol, timeframe, isManualRequest, signal, date);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return [];
    await delay(intervalMs);
    if (signal?.aborted) return [];
    const candles = await tryFetchCandles(channelId, token, symbol, timeframe, signal, date);
    if (candles && candles.length > 0) return candles;
  }

  return [];
}

export function aggregateCandles(m1Candles: LiveCandle[], factor: number): LiveCandle[] {
  if (factor <= 1) return m1Candles;
  const out: LiveCandle[] = [];
  for (let i = 0; i < m1Candles.length; i += factor) {
    const slice = m1Candles.slice(i, i + factor);
    if (slice.length === 0) continue;
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      vol += c.volume;
    }
    out.push({
      index: out.length,
      time: slice[0].time,
      timeLabel: slice[0].timeLabel,
      open: slice[0].open,
      high,
      low,
      close: slice[slice.length - 1].close,
      volume: vol,
    });
  }
  return out;
}

export function buildPainelSyncMql5({ endpointUrl, token, channelId = '', mode = 'ea' }: { endpointUrl: string; token: string; channelId?: string; mode?: 'ea' | 'service'; magicNumber?: number; robotName?: string }): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out = "////////////////////////////////////////////////////////////////////////////////////////////////////////////\n////////////////////////////////////////////////////////////////////////////////////////////////////////////\n\n//+------------------------------------------------------------------+\n//|                                                  Painel_Sync.mq5 |\n//|                               Copyright (c) 2026, Painel Sync    |\n//+------------------------------------------------------------------+\n#property copyright \"Painel Sync\"\n#property version   \"2.00\"\n\ninput group \"=== 1. Conexao e Autenticacao ===\"\n"
    .replace(/(input\s+string\s+InpEndpointUrl\s*=\s*")[^"]*(")/, (_m, s, e) => s + esc(endpointUrl) + e)
    .replace(/(input\s+string\s+InpToken\s*=\s*")[^"]*(")/, (_m, s, e) => s + esc(token) + e)
    .replace(/(input\s+string\s+InpChannelId\s*=\s*")[^"]*(")/, (_m, s, e) => s + esc(channelId) + e);
  if (mode === 'service') {
    const serviceLifecycle = `void OnStart()
{
   Print("PainelSync Service v2.0: Iniciando monitoramento em segundo plano no canal ", InpChannelId, "...");

   g_lastSymbolsReport = TimeCurrent();
   SendSymbolsReport();
   if(InpHistoryBackfillDays > 0)
      SyncHistoricalTrades(InpHistoryBackfillDays);
   SendAccountAndRobotsTelemetry();

   while(!IsStopped())
   {
      int waitMs = MathMax(1, InpSyncIntervalSec) * 1000;
      for(int elapsed = 0; elapsed < waitMs && !IsStopped(); elapsed += 200)
         Sleep(200);
      if(IsStopped()) break;

      if(!g_historySynced && InpHistoryBackfillDays > 0 && TimeCurrent() - g_lastHistoryRetry >= 30) { g_lastHistoryRetry = TimeCurrent(); SyncHistoricalTrades(InpHistoryBackfillDays); }\n      LogAccountStateChanges();\n      FetchPendingRequest();
      SendAccountAndRobotsTelemetry();

      if(TimeCurrent() - g_lastSymbolsReport >= 60)
      {
         g_lastSymbolsReport = TimeCurrent();
         SendSymbolsReport();
      }
   }
   CleanupTempSymbols("", 0);
   Print("PainelSync Service: Monitoramento encerrado.");
}`;
    const startMarker = '// <EA_LIFECYCLE_START>';
    const endMarker = '// <EA_LIFECYCLE_END>';
    const sIdx = out.indexOf(startMarker);
    const eIdx = out.indexOf(endMarker);
    const withServiceProp = out.replace('#property version   "2.00"', '#property version   "2.00"\n#property service');
    if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
      const sAdj = withServiceProp.indexOf(startMarker);
      const eAdj = withServiceProp.indexOf(endMarker) + endMarker.length;
      return withServiceProp.slice(0, sAdj) + serviceLifecycle + withServiceProp.slice(eAdj);
    }
    return withServiceProp;
  }
  return out;
}

export async function sendRemoteCommand(
  channelId: string,
  token: string,
  payload: {
    action: "CLOSE_MAGIC" | "CANCEL_ORDERS" | "CLOSE_ALL" | "OPEN_ORDER" | "MODIFY_SL_TP";
    magicNumber?: number;
    symbol?: string;
    side?: "COMPRA" | "VENDA";
    volume?: number;
    price?: number;
    sl?: number;
    tp?: number;
    ttlSeconds?: number;
  }
) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-token": token,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Falha ao enviar comando ao MT5");
  }
  return data.command;
}

export async function fetchRecentCommands(channelId: string, token: string) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/commands`, {
    headers: { "x-sync-token": token },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.commands) ? data.commands : [];
}

export async function fetchManagedRobots(channelId: string, token: string) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/managed-robots`, {
    headers: { "x-sync-token": token },
  });
  if (!res.ok) return new Array();
  const data = await res.json();
  return Array.isArray(data?.robots) ? data.robots : new Array();
}

export async function createManagedRobotApi(channelId: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/managed-robots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sync-token": token },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Falha ao criar robo");
  return data.robot;
}

export async function updateManagedRobotApi(channelId: string, token: string, robotId: string, patch: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/managed-robots/${encodeURIComponent(robotId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-sync-token": token },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Falha ao atualizar robo");
  return data.robot;
}

export async function deleteManagedRobotApi(channelId: string, token: string, robotId: string) {
  const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/managed-robots/${encodeURIComponent(robotId)}`, {
    method: "DELETE",
    headers: { "x-sync-token": token },
  });
  if (!res.ok) throw new Error("Falha ao remover robo");
}

export interface SymbolTickSpecInfo {
  symbol: string;
  resolvedSymbol: string;
  tickSize: number;
  digits: number;
  isTickCountUnit: boolean;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  source: 'mt5' | 'b3_default';
}

export async function fetchSymbolTickSpec(channelId: string, token: string, symbol: string): Promise<SymbolTickSpecInfo | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(channelId)}/symbol-spec?symbol=${encodeURIComponent(symbol)}`, {
      headers: { "x-sync-token": token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}
