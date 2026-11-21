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

export async function fetchManualCandles(channelId: string, token: string, symbol: string, timeframe: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/api/mt5-sync/${channelId}/candles?symbol=${symbol}&timeframe=${timeframe}`, {
    headers: {
      "x-sync-token": token,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch candles for ${symbol}: ${response.statusText}`);
  }
  return response.json();
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

export function buildPainelSyncMql5({
  endpointUrl,
  token,
  magicNumber,
  robotName,
}: {
  endpointUrl: string;
  token: string;
  magicNumber: number;
  robotName: string;
}): string {
  return [
    `//+-----------------------------------------------------------------\\
//|                                              PainelSync.mq5                |
//|                                  Copyright © 2024, Painel Sync Team        |
//|                                             https://painelsync.com           |
//+-----------------------------------------------------------------\\
\\
#property copyright "Copyright © 2024, Painel Sync Team"
#property link      "https://painelsync.com"
#property version   "1.00"
#property strict

//--- Inputs
input int      InpMagicNumber = ${magicNumber};
input string   InpRobotName   = "${robotName}";

//--- Global Variables
string   g_endpointUrl = "${endpointUrl}";
string   g_token       = "${token}";

//+-----------------------------------------------------------------\\
//| Expert initialization function                                            |
//+-----------------------------------------------------------------\\
int OnInit()
{
   Print("PainelSync: Iniciando...");
   return(INIT_SUCCEEDED);
}

//+-----------------------------------------------------------------\\
//| Expert deinitialization function                                          |
//+-----------------------------------------------------------------\\
void OnDeinit(const int reason)
{
   Print("PainelSync: Finalizado.");
}

//+-----------------------------------------------------------------\\
//| Expert tick function                                                      |
//+-----------------------------------------------------------------\\
void OnTick()
{
   // Esta função é apenas para monitoramento visual. 
   // A lógica de envio de dados ocorre via WebRequest (implementado internamente)
}

//+-----------------------------------------------------------------\\
//| Custom function to send data (Placeholder for actual WebRequest logic)  |
//+-----------------------------------------------------------------\\
void SendSyncData()
{
   // Aqui entraria a lógica de WebRequest para enviar posições e lucro atual
   // para o endpoint: ${endpointUrl}
   // Usando o token: ${token}
}
`
  ].join('\n');
}
