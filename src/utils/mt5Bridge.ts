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

export async function fetchCandles(channelId: string, token: string, symbol: string, timeframe: string): Promise<LiveCandle[]> {
  const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/candles?symbol=${symbol}&timeframe=${timeframe}`;
  console.log(`Fetching candles from: ${url}`);

  const response = await fetch(url, {
    headers: {
      "x-sync-token": token,
    },
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
  signal?: AbortSignal
): Promise<LiveCandle[] | null> {
  try {
    const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
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
  signal?: AbortSignal
): Promise<void> {
  const url = `${API_BASE_URL}/api/mt5-sync/${channelId}/request`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-token": token,
    },
    body: JSON.stringify({ symbol, timeframe, isManualRequest }),
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
  options: { timeoutMs?: number; intervalMs?: number; force?: boolean; signal?: AbortSignal; isManualRequest?: boolean } = {}
): Promise<LiveCandle[]> {
 const { timeoutMs = 15000, intervalMs = 1000, force = false, signal, isManualRequest } = options;

  if (signal?.aborted) return [];

  if (!force) {
    const cached = await tryFetchCandles(channelId, token, symbol, timeframe, signal);
    if (cached && cached.length > 0) return cached;
  }

 await requestCandlesFromMt5(channelId, token, symbol, timeframe, isManualRequest, signal);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return [];
    await delay(intervalMs);
    if (signal?.aborted) return [];
    const candles = await tryFetchCandles(channelId, token, symbol, timeframe, signal);
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
  `//------------------------------------------------------------------------\\
//|                                              PainelSync.mq5            |
//|                                  Copyright © 2024, Painel Sync Team    |
//|                                             https://painelsync.com     |
//+-----------------------------------------------------------------------\\
\\
#property copyright "Copyright © 2024, Painel Sync Team"
#property link      "https://painelsync.com"
#property version   "1.00"
#property strict
#include <indicators.mqh>
#include <array.mqh>
#include <String.mqh>

//--- Inputs
input int      InpMagicNumber = ${magicNumber};
input string   InpRobotName   = "${robotName}";

//--- Global Variables
string   g_endpointUrl = "${endpointUrl}";
string   g_token       = "${token}";
string   g_channelId   = "";
string   g_jsonPayload = "";

//+-----------------------------------------------------------------\\
//| Expert initialization function                                  \\
//+-----------------------------------------------------------------\\
int OnInit()
{
   Print("PainelSync: Iniciando...");
   return(INIT_SUCCEEDED);
}

//+-----------------------------------------------------------------\\
//| Expert deinitialization function                                 |
//+-----------------------------------------------------------------\\
void OnDeinit(const int reason)
{
   Print("PainelSync: Finalizado.");
}

//+-----------------------------------------------------------------\\
//| Expert tick function                                             |
//+-----------------------------------------------------------------\\
void OnTick()
{
   // Esta função é apenas para monitoramento visual. 
   // A lógica de envio de dados ocorre via WebRequest (implementado internamente)
   if (Symbol() == "") return;
   SendSyncData();
}

//+-----------------------------------------------------------------\\
//| Custom function to send data (Placeholder for actual WebRequest logic)     |
//+-----------------------------------------------------------------\\
void SendSyncData()
{
   string symbol = Symbol();
   int period = Period();
   MqlRates rates[100];
   int total = CopyRates(symbol, period, 0, 100, rates);
   if (total <= 0)
   {
      Print("PainelSync: CopyRates falhou para ", symbol, " ", period);
      return;
   }

   string payload = BuildPayload(symbol, period, rates, total);
   if (payload == "")
      return;

   SendToServer(payload);
}

//+-----------------------------------------------------------------\\
//| Envia o payload JSON gerado para o backend via WebRequest        |
//+-----------------------------------------------------------------\\
void SendToServer(string jsonPayload)
{
   string url = g_endpointUrl + "/api/mt5-sync/" + g_channelId;
   string request =
      "POST " + url + " HTTP/1.1\\r\\n" +
      "Host: " + String(g_endpointUrl) + "\\r\\n" +
      "Content-Type: application/json\\r\\n" +
      "X-Sync-Token: " + g_token + "\\r\\n" +
      "Content-Length: " + IntegerToString(StringToInteger(jsonPayload.Length())) + "\\r\\n" +
      "\\r\\n" + jsonPayload;

   int result = WebRequestSend(request, 0, 0, g_token);
   if (result == 1)
   {
      Print("PainelSync: Payload enviado ao servidor.");
   }
   else if (result == 2)
   {
      Print("PainelSync: WebRequest não concluído (resultado 2).");
   }
   else
   {
      Print("PainelSync: Erro ao enviar payload (resultado ", result, ").");
   }
}

//+-----------------------------------------------------------------\\
//| WebRequestReceive - recebe resposta do servidor e imprime JSON   |
//+-----------------------------------------------------------------\\
void WebRequestReceive(int handle, long code, long code2, long code3)
{
   if (handle < 0) return;
   if (code == 0 && code2 == 0 && code3 == 0)
   {
      long len = WebRequestReceiveString(handle);
      if (len > 0)
      {
         Print("PainelSync: Resposta do servidor:");
         Print(StringToText(WebRequestReceiveString(handle), 0, len));
      }
   }
   WebRequestDestroy(handle);
}

//+-----------------------------------------------------------------\\
//| WebRequestRequestSend - envia o payload JSON ao servidor         |
//+-----------------------------------------------------------------\\
int WebRequestRequestSend(int handle, long code, long code2, long code3)
{
   string payload = g_jsonPayload;
   if (payload == "")
      return 1;

   int result = WebRequestSend(
      "POST " + g_endpointUrl + "/api/mt5-sync/" + g_channelId + " HTTP/1.1\\r\\n" +
      "Host: " + String(g_endpointUrl) + "\\r\\n" +
      "Content-Type: application/json\\r\\n" +
      "X-Sync-Token: " + g_token + "\\r\\n" +
      "Content-Length: " + IntegerToString(StringToInteger(payload.Length())) + "\\r\\n" +
      "\\r\\n" + payload,
      0,
      0,
      g_token
   );

   if (result == 1)
   {
      Print("PainelSync: Payload enviado ao servidor.");
   }
   else if (result == 2)
   {
      Print("PainelSync: WebRequest não concluído (resultado 2).");
   }
   else
   {
      Print("PainelSync: Erro ao enviar payload (resultado ", result, ").");
   }
   return result;
}

//+-----------------------------------------------------------------\\
//| Build JSON payload with candles, positions and pnl               |
//+-----------------------------------------------------------------\\
string BuildPayload(string symbol, int period, MqlRates rates[], int total)
{
   ArraySetAsSeries(rates, 0);

   string json = "";
   json += "{";
   json += "\"symbol\":\"" + symbol + "\"";
   json += ",\"timeframe\":'" + IntegerToString(period) + "'";
   json += ",\"candles\":";

   for (int i = 0; i < total; i++)
   {
      json += (i > 0 ? "," : "");
      json += "{";
      json += "\"time\":[" + LongToString(rates[i].time) + ",\"timeLabel\":\"" + String(rates[i].timeLabel) + "\"]";
      json += ",\"open\":[" + DoubleToString(rates[i].open) + "]";
      json += ",\"high\":[" + DoubleToString(rates[i].high) + "]";
      json += ",\"low\":[" + DoubleToString(rates[i].low) + "]";
      json += ",\"close\":[" + DoubleToString(rates[i].close) + "]";
      json += ",\"volume\":[" + LongToString(rates[i].volume) + "]";
      json += "}";
   }

   json += "}";
   json += ",\"positions\":[]";
   json += ",\"pnl\":0";
   json += "}";

   return json;
}
`
  ].join('\n');
}
