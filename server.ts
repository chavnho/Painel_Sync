import fs from "node:fs";
import { createDatabaseBackup } from "./src/db/tradesDb";
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { PendingRequest, PairingAttemptEvent, LiveSyncChannel, NormalizedCandle} from "./types";
import { persistExecutedTrades, loadPersistedTradesForAccount, setRobotHiddenPreference, loadHiddenMagicsForAccount, enqueueCommand, pollAndDispatchPendingCommands, acknowledgeCommand, listRecentCommands, listManagedRobots, createManagedRobot, updateManagedRobot, markManagedRobotSignal, updateManagedRobotDecision, deleteManagedRobot, hasActiveCommandForMagic } from "./src/db/tradesDb";
import { evaluateManagedRobot, resolveSymbolTickSpec, snapVolumeToLot } from "./src/engine/robotEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface NormalizedPosition {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: "COMPRA" | "VENDA";
  volume: number;
  entryPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  floatingPnlBrl: number;
  openTime: string;
  pointsOpen: number;
}

interface NormalizedPendingOrder {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: "COMPRA" | "VENDA";
  orderType: string;
  volume: number;
  price: number;
  sl: number;
  tp: number;
}

interface NormalizedTrade {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: "COMPRA" | "VENDA";
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

interface NormalizedRobot {
  robotId: string;
  name: string;
  magicNumber: number;
  symbol: string;
  timeframe: string;
  status: string;
  lastUpdate: string;
  position: NormalizedPosition | null;
  pendingOrders: NormalizedPendingOrder[];
  candles: NormalizedCandle[];
  candlesByTimeframe?: Record<string, NormalizedCandle[]>;
  overlays: Array<Record<string, unknown>>;
  markers: Array<Record<string, unknown>>;
  trades: NormalizedTrade[];
  historyTrades?: NormalizedTrade[];
  realizedPnlBrl: number;
  floatingPnlBrl: number;
  dailyPnlBrl: number;
}

const mt5Channels = new Map<string, LiveSyncChannel>();

const requestQueue: PendingRequest[] = [];
const MAX_CHART_CANDLES = 35000;
const SERVER_STARTED_AT = new Date().toISOString();
const chartCandlesCache = new Map<string, NormalizedCandle[]>();
const requestDateMap = new Map<string, string>();
const activeChartFocus = new Map<string, { symbol: string; timeframe: string; expiresAt: number }>();
const lastChannelSignature = new Map<string, string>();



const REQUEST_TTL_MS = 30000;

function fmtLogTs(ms = Date.now()): string {
  return new Date(ms - 3 * 3600 * 1000).toISOString().slice(11, 23);
}

function pruneExpiredRequests(now = Date.now()) {
  for (let i = requestQueue.length - 1; i >= 0; i--) {
    const r = requestQueue.at(i)!;
    if (now - r.timestamp > REQUEST_TTL_MS) {
      if (r.status === "pending" || r.status === "processing") {
        console.log(`[${fmtLogTs(now)}] [Queue TIMEOUT] ${r.id} (${r.symbol} ${r.timeframe}${r.date ? ` date=${r.date}` : ""}) expirou apos ${now - r.timestamp}ms em status=${r.status}`);
      }
      requestQueue.splice(i, 1);
    }
  }
}

function findActiveDuplicateRequest(channelId: string, symbol: string, timeframe: string, date?: string): PendingRequest | undefined {
  pruneExpiredRequests();
  return requestQueue.find(
    (r) =>
      (r.status === "pending" || r.status === "processing") &&
      r.channelId === channelId &&
      r.symbol === symbol &&
      r.timeframe === timeframe &&
      (r.date || "") === (date || "")
  );
}

function addToQueue(request: PendingRequest) {
  pruneExpiredRequests();
  requestQueue.push(request);
  requestQueue.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`[${fmtLogTs()}] [Front -> Server] ADD ${request.id} | ${request.symbol} ${request.timeframe}${request.date ? ` | date=${request.date}` : ""} | fila=${requestQueue.filter(r => r.status === "pending").length} pendentes`);
}

function getNextRequest(): PendingRequest | null {
  pruneExpiredRequests();
  const request = requestQueue.find(r => r.status === "pending");
  if (request) {
    request.status = "processing";
    const waitMs = Date.now() - request.timestamp;
    console.log(`[${fmtLogTs()}] [Server -> EX5] PICK ${request.id} | ${request.symbol} ${request.timeframe}${request.date ? ` | date=${request.date}` : ""} | wait=${waitMs}ms`);
  }
  return request || null;
}

function completeRequest(id: string, result: NormalizedCandle[]) {
  const request = requestQueue.find(r => r.id === id);
  if (request) {
    request.status = "completed";
    request.result = result;
    const totalMs = Date.now() - request.timestamp;
    const firstTs = result.at(0)?.time ? new Date(Number(result.at(0)!.time) * 1000).toISOString().slice(0, 16) : "-";
    const lastTs = result.at(-1)?.time ? new Date(Number(result.at(-1)!.time) * 1000).toISOString().slice(0, 16) : "-";
    console.log(`[${fmtLogTs()}] [EX5 -> Server] OK ${id} | ${request.symbol} ${request.timeframe} | ${result.length} velas (${firstTs} .. ${lastTs}) | total=${totalMs}ms`);
  } else {
    console.log(`[${fmtLogTs()}] [EX5 -> Server] ORPHAN ${id} | ${result.length} velas (pedido ja expirado ou inexistente)`);
  }
}

function failRequest(id: string, reason: string) {
  const request = requestQueue.find(r => r.id === id);
  if (request) {
    request.status = "failed";
    request.error = reason;
    const totalMs = Date.now() - request.timestamp;
    console.log(`[${fmtLogTs()}] [EX5 -> Server] FAIL ${id} | ${request.symbol} ${request.timeframe} | motivo="${reason}" | total=${totalMs}ms`);
  }
}
function pushPairingEvent(
  channel: LiveSyncChannel,
  evt: Omit<PairingAttemptEvent, "id" | "timestamp">
) {
  const fullEvent: PairingAttemptEvent = {
    id: `pe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...evt,
  };
  channel.pairingEvents = [fullEvent, ...channel.pairingEvents].slice(0, 30);
  const ssePayload = `event: pairing_event\ndata: ${JSON.stringify(fullEvent)}\n\n`;
  for (const client of channel.subscribers) {
    client.write(ssePayload);
  }
}


function resolveManagedSymbol(channel: LiveSyncChannel, rawSymbol: string): string {
  const sym = String(rawSymbol || "").trim().toUpperCase();
  if (!sym) return "WIN$";
  if (sym.endsWith("$") && channel.activeContracts) {
    const active = channel.activeContracts[sym.slice(0, -1)];
    if (active) return active.toUpperCase();
  }
  return sym;
}

function getWatchSymbolsForChannel(channelId: string, channel: LiveSyncChannel): Array<{ symbol: string; timeframe: string }> {
  const seen = new Set<string>();
  const list: Array<{ symbol: string; timeframe: string }> = [];
  for (const bot of listManagedRobots(channelId).filter((b) => b.enabled && b.environment === "PRODUCTION")) {
    const sym = resolveManagedSymbol(channel, bot.symbol);
    const tf = bot.timeframe.toUpperCase();
    const key = `${sym}:${tf}`;
    if (!seen.has(key)) { seen.add(key); list.push({ symbol: sym, timeframe: tf }); }
    if (bot.strategyType === "wdo_opening_zones" && !seen.has(`WDO@N:${tf}`)) { seen.add(`WDO@N:${tf}`); list.push({ symbol: "WDO@N", timeframe: tf }); }
  }
  return list;
}

function runManagedRobotsCycle(channelId: string, channel: LiveSyncChannel) {
  const activeBots = listManagedRobots(channelId).filter((b) => b.enabled && b.environment === "PRODUCTION");
  if (activeBots.length === 0) return;
  for (const bot of activeBots) {
    const resolvedSymbol = resolveManagedSymbol(channel, bot.symbol);
    const tf = bot.timeframe.toUpperCase();
    const analysisSym = bot.strategyType === "wdo_opening_zones" ? "WDO@N" : resolvedSymbol;
    const candles = chartCandlesCache.get(`${channelId}:${analysisSym}:${tf}`) || chartCandlesCache.get(`${channelId}:${resolvedSymbol}:${tf}`) || [];
    let openPosition: { side: "COMPRA" | "VENDA"; volume: number; entryPrice: number; currentPrice: number; sl: number; tp: number; floatingPnlBrl: number } | null = null;
    let dailyPnlBrl = 0;
    for (const r of channel.robots.values()) {
      if (Number(r.magicNumber) === bot.magicNumber) {
        dailyPnlBrl += Number(r.dailyPnlBrl || 0);
        if (r.position) {
          openPosition = { side: r.position.side === "VENDA" ? "VENDA" : "COMPRA", volume: Number(r.position.volume || 1), entryPrice: Number(r.position.entryPrice || 0), currentPrice: Number(r.position.currentPrice || 0), sl: Number(r.position.sl || 0), tp: Number(r.position.tp || 0), floatingPnlBrl: Number(r.position.floatingPnlBrl || 0) };
        }
      }
    }
    const brokerSpec = channel.symbolSpecs?.[resolvedSymbol] || channel.symbolSpecs?.[bot.symbol.toUpperCase()] || null;
    const evalRes = evaluateManagedRobot({ robot: bot, candles, resolvedSymbol, openPosition, dailyPnlBrl, hasPendingCommand: hasActiveCommandForMagic(channelId, bot.magicNumber), brokerSpec });
    if (evalRes.directive) {
      const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const created = enqueueCommand({ id: cmdId, channelId, magicNumber: bot.magicNumber, action: evalRes.directive.type, symbol: evalRes.directive.symbol, side: evalRes.directive.side, volume: evalRes.directive.volume, sl: evalRes.directive.sl, tp: evalRes.directive.tp, ttlSeconds: 15 });
      markManagedRobotSignal(bot.id, evalRes.directive.barTime, evalRes.decision);
      pushPairingEvent(channel, { outcome: "request", httpStatus: 201, source: "backend", category: "orders", summary: `Robo ${bot.name} (#${bot.magicNumber}): ${evalRes.directive.type}${evalRes.directive.side ? ` ${evalRes.directive.side}` : ""}`, detail: evalRes.directive.reason, requestId: created.id, symbol: evalRes.directive.symbol, magicNumber: bot.magicNumber });
      const ssePayload = `event: command_update\ndata: ${JSON.stringify(created)}\n\n`;
      for (const sub of channel.subscribers) { try { sub.write(ssePayload); } catch {} }
    } else if (bot.lastDecision !== evalRes.decision) {
      updateManagedRobotDecision(bot.id, evalRes.decision);
    }
  }
}

function normalizeCandles(raw: unknown): NormalizedCandle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_CHART_CANDLES)
    .filter(
      (c): c is Record<string, unknown> =>
        Boolean(c) &&
        typeof c === "object" &&
        Number.isFinite(Number((c as Record<string, unknown>).open)) &&
        Number.isFinite(Number((c as Record<string, unknown>).high)) &&
        Number.isFinite(Number((c as Record<string, unknown>).low)) &&
        Number.isFinite(Number((c as Record<string, unknown>).close))
    )
    .map((c, idx) => ({
      index: idx,
      time: Number.isFinite(Number(c.time)) && Number(c.time) > 0 ? Math.floor(Number(c.time)) : undefined,
      timeLabel: String(c.timeLabel ?? `#${idx + 1}`),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number.isFinite(Number(c.volume)) ? Number(c.volume) : 0,
    }));
}

function normalizeRobotPayload(
  raw: Record<string, unknown>,
  serverTimeIso: string
): NormalizedRobot | null {
  const symbol = String(raw.symbol || "WIN$N").trim();
  const timeframe = String(raw.timeframe || "M5").trim();
  const magicNumber = Number.isFinite(Number(raw.magicNumber))
    ? Number(raw.magicNumber)
    : 0;
  const robotId = String(raw.robotId || `${magicNumber}_${symbol}`);
  const robotName = String(
    raw.name || raw.botStatus || `EA_${symbol}_${magicNumber || "All"}`
  ).trim();

  const candles = normalizeCandles(raw.candles);

  let candlesByTimeframe: Record<string, NormalizedCandle[]> | undefined;
  if (raw.candlesByTimeframe && typeof raw.candlesByTimeframe === "object") {
    const map: Record<string, NormalizedCandle[]> = {};
    for (const [tfKey, tfArr] of Object.entries(
      raw.candlesByTimeframe as Record<string, unknown>
    )) {
      const normalizedTf = normalizeCandles(tfArr);
      if (normalizedTf.length > 0) {
        map[tfKey.toUpperCase()] = normalizedTf;
      }
    }
    if (Object.keys(map).length > 0) {
      candlesByTimeframe = map;
    }
  }

  let position: NormalizedPosition | null = null;
  if (raw.position && typeof raw.position === "object") {
    const pos = raw.position as Record<string, unknown>;
    if (pos.side === "COMPRA" || pos.side === "VENDA") {
      const entryPrice = Number(pos.entryPrice) || 0;
      const currentPrice =
        Number(pos.currentPrice) ||
        (candles.length > 0 ? candles[candles.length - 1].close : entryPrice);
      const pointsDiff =
        pos.side === "COMPRA" ? currentPrice - entryPrice : entryPrice - currentPrice;
      position = {
        id: String(pos.id || `pos_${robotId}`),
        robotId,
        robotName,
        magicNumber,
        symbol,
        side: pos.side,
        volume: Number(pos.volume) || 1,
        entryPrice,
        currentPrice,
        sl: Number.isFinite(Number(pos.sl)) ? Number(pos.sl) : 0,
        tp: Number.isFinite(Number(pos.tp)) ? Number(pos.tp) : 0,
        floatingPnlBrl: Number(pos.floatingPnlBrl) || 0,
        openTime: String(pos.openTime || ""),
        pointsOpen: Number.isFinite(Number(pos.pointsOpen))
          ? Number(pos.pointsOpen)
          : Number(pointsDiff.toFixed(2)),
      };
    }
  }

  const pendingOrders: NormalizedPendingOrder[] = Array.isArray(raw.pendingOrders)
    ? raw.pendingOrders
        .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === "object"))
        .map((o, idx) => ({
          id: String(o.id ?? `${robotId}_ord_${idx}`),
          robotId,
          robotName,
          magicNumber,
          symbol: String(o.symbol || symbol),
          side: o.side === "VENDA" ? ("VENDA" as const) : ("COMPRA" as const),
          orderType: String(o.orderType || "LIMIT"),
          volume: Number(o.volume) || 1,
          price: Number(o.price) || 0,
          sl: Number.isFinite(Number(o.sl)) ? Number(o.sl) : 0,
          tp: Number.isFinite(Number(o.tp)) ? Number(o.tp) : 0,
        }))
        .filter((o) => o.price > 0)
    : [];

  const todayIso = serverTimeIso.slice(0, 10);

  const normalizeTradeArray = (arr: unknown, limit: number): NormalizedTrade[] => {
    if (!Array.isArray(arr)) return [];
    return arr.slice(-limit).map((t: unknown, idx: number) => {
      const tr = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      const side: "COMPRA" | "VENDA" = tr.side === "VENDA" ? "VENDA" : "COMPRA";
      const entryPrice = Number(tr.entryPrice) || 0;
      const exitPrice = Number(tr.exitPrice) || entryPrice;
      const rawPoints = Number(tr.points);
      const computedPoints =
        side === "COMPRA" ? exitPrice - entryPrice : entryPrice - exitPrice;
      return {
        id: String(tr.id ?? `${robotId}_t_${idx}`),
        robotId,
        robotName,
        magicNumber,
        symbol: String(tr.symbol || symbol),
        side,
        entryDate: typeof tr.entryDate === "string" ? tr.entryDate : todayIso,
        exitDate: typeof tr.exitDate === "string" ? tr.exitDate : todayIso,
        entryTime: String(tr.entryTime || tr.exitTime || "--:--"),
        exitTime: String(tr.exitTime || tr.entryTime || "--:--"),
        entryPrice,
        exitPrice,
        volume: Number(tr.volume) || 1,
        points: Number.isFinite(rawPoints) ? rawPoints : Number(computedPoints.toFixed(2)),
        pnlBrl: Number(tr.pnlBrl) || 0,
        reason: String(tr.reason || "MT5"),
      };
    });
  };

  const trades = normalizeTradeArray(raw.trades, 300);
  const historyTrades = Array.isArray(raw.historyTrades)
    ? normalizeTradeArray(raw.historyTrades, 2500)
    : undefined;

  const realizedPnlBrl = Number.isFinite(Number(raw.realizedPnlBrl))
    ? Number(raw.realizedPnlBrl)
    : Number(trades.reduce((acc, t) => acc + t.pnlBrl, 0).toFixed(2));
  const floatingPnlBrl = position ? position.floatingPnlBrl : 0;
  const dailyPnlBrl = Number.isFinite(Number(raw.dailyPnlBrl))
    ? Number(raw.dailyPnlBrl)
    : Number((realizedPnlBrl + floatingPnlBrl).toFixed(2));

  const status = String(
    raw.status ||
      (position
        ? `Posicionado ${position.side}`
        : raw.botStatus || "Monitorando")
  );

  return {
    robotId,
    name: robotName,
    magicNumber,
    symbol,
    timeframe,
    status,
    lastUpdate: serverTimeIso,
    position,
    pendingOrders,
    candles,
    candlesByTimeframe,
    overlays: Array.isArray(raw.overlays) ? raw.overlays.slice(0, 16) : [],
    markers: Array.isArray(raw.markers) ? raw.markers.slice(-250) : [],
    trades,
    historyTrades,
    realizedPnlBrl,
    floatingPnlBrl,
    dailyPnlBrl,
  };
}

function mergeChannelSymbols(channel: LiveSyncChannel, incoming: unknown) {
  if (!Array.isArray(incoming)) return;
  const set = new Set(channel.symbols);
  for (const item of incoming) {
    const symbol = String(item ?? "").trim().toUpperCase();
    if (symbol) set.add(symbol);
  }
  channel.symbols = Array.from(set).sort((a, b) => a.localeCompare(b));
}

const persistedTradesCache = new Map<string, { ts: number; trades: ReturnType<typeof loadPersistedTradesForAccount>; knownIds: Set<string> }>();

function getCachedPersistedTrades(accountKey: string) {
  const now = Date.now();
  const cached = persistedTradesCache.get(accountKey);
  if (cached && now - cached.ts < 10000) {
    return cached.trades;
  }
  const trades = loadPersistedTradesForAccount(accountKey);
  persistedTradesCache.set(accountKey, {
    ts: now,
    trades,
    knownIds: new Set(trades.map((t) => String(t.id))),
  });
  return trades;
}

function syncNewTelemetryTradesToDb(accountKey: string, trades: NormalizedTrade[]) {
  if (!accountKey || !Array.isArray(trades) || trades.length === 0) return;
  let cached = persistedTradesCache.get(accountKey);
  if (!cached) {
    getCachedPersistedTrades(accountKey);
    cached = persistedTradesCache.get(accountKey)!;
  }
  const unsaved = trades.filter((t) => t.id && !cached!.knownIds.has(String(t.id)));
  if (unsaved.length === 0) return;
  persistExecutedTrades(
    accountKey,
    unsaved.map((t) => ({
      id: String(t.id),
      robotId: String(t.robotId || `${t.magicNumber}_${t.symbol}`),
      robotName: String(t.robotName || `Robo #${t.magicNumber}`),
      magicNumber: Number(t.magicNumber) || 0,
      symbol: String(t.symbol || ""),
      side: t.side === "VENDA" ? "VENDA" : "COMPRA",
      entryDate: String(t.entryDate || t.exitDate || ""),
      exitDate: String(t.exitDate || ""),
      entryTime: String(t.entryTime || t.exitTime || ""),
      exitTime: String(t.exitTime || ""),
      entryPrice: Number(t.entryPrice) || 0,
      exitPrice: Number(t.exitPrice) || 0,
      volume: Number(t.volume) || 1,
      points: Number(t.points) || 0,
      pnlBrl: Number(t.pnlBrl) || 0,
      reason: String(t.reason || "MT5"),
    }))
  );
  persistedTradesCache.delete(accountKey);
}

function buildSnapshotResponse(channelId: string, channel: LiveSyncChannel) {
  const accountKey = channel.account?.login || channelId;
  const persistedAll = getCachedPersistedTrades(accountKey);
  const hiddenMagics = new Set<number>([...loadHiddenMagicsForAccount(accountKey), ...loadHiddenMagicsForAccount(channelId)]);

  // Garante que robôs presentes no histórico SQLite (mesmo sem trades hoje) apareçam no painel
  const robotsMap = new Map(channel.robots);
  for (const pt of persistedAll) {
    const rId = `mt5_magic_${pt.magicNumber}`;
    if (!robotsMap.has(rId)) {
      robotsMap.set(rId, {
        robotId: rId,
        robotName: pt.robotName || `Robo #${pt.magicNumber}`,
        name: pt.robotName || `Robo #${pt.magicNumber}`,
        magicNumber: pt.magicNumber,
        symbol: pt.symbol,
        timeframe: "M5",
        status: "Inativo",
        lastUpdate: `${pt.exitDate} ${pt.exitTime}`,
        position: null,
        pendingOrders: [],
        candles: [],
        trades: [],
        historyTrades: [],
        realizedPnlBrl: 0,
        floatingPnlBrl: 0,
        dailyPnlBrl: 0,
      } as unknown as LiveSyncChannel["robots"] extends Map<string, infer V> ? V : never);
    }
  }

  const robots = Array.from(robotsMap.values()).map((bot) => {
    const botPersisted = persistedAll.filter(
      (t) => t.magicNumber === bot.magicNumber
    );
    const isHidden = hiddenMagics.has(bot.magicNumber);
    if (botPersisted.length === 0) return { ...bot, hidden: isHidden };
    const mergedMap = new Map<string, NormalizedTrade>();
    for (const pt of botPersisted) mergedMap.set(pt.id, pt);
    for (const ht of bot.historyTrades ?? []) mergedMap.set(ht.id, ht);
    for (const dt of bot.trades) mergedMap.set(dt.id, dt);
    return {
      ...bot,
      historyTrades: Array.from(mergedMap.values()),
      hidden: isHidden,
    };
  });
  const totalDailyPnl = robots.reduce((acc, r) => acc + r.dailyPnlBrl, 0);
  const account = channel.account
    ? {
        ...channel.account,
        dailyPnlBrl:
          channel.account.dailyPnlBrl !== 0 || robots.length === 0
            ? channel.account.dailyPnlBrl
            : Number(totalDailyPnl.toFixed(2)),
      }
    : null;

  return {
    channelId,
    account,
    robots,
    symbols: channel.symbols,
    activeContracts: channel.activeContracts,
    serverReceivedAt: new Date(channel.updatedAtMs).toISOString(),
    pairingEvents: channel.pairingEvents,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "25mb" }));

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (
        err instanceof SyntaxError &&
        "body" in err &&
        req.path.startsWith("/api/mt5-sync/")
      ) {
        const parts = req.path.split("/").filter(Boolean);
        const channelId = parts[2] || "";
        const existing = mt5Channels.get(channelId);
        if (existing) {
          pushPairingEvent(existing, {
            outcome: "error",
            httpStatus: 400,
            source: "mt5",
            summary: "JSON malformado recebido no canal",
            detail: `${err.message}. Recompile o PainelSync.mq5 atualizado caso o payload tenha sido truncado.`,
          });
        }
        res.status(400).json({ error: `Payload JSON malformado: ${err.message}` });
        return;
      }
      next(err);
    }
  );

  function getOrCreateChannel(channelId: string, token: string): LiveSyncChannel | null {
    const existing = mt5Channels.get(channelId);
    if (existing) {
      if (existing.token !== token) return null;
      return existing;
    }
    if (mt5Channels.size >= 150) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of mt5Channels.entries()) {
        if (v.subscribers.size === 0 && v.updatedAtMs < oldestTime) {
          oldestTime = v.updatedAtMs;
          oldestKey = k;
        }
      }
      if (oldestKey) mt5Channels.delete(oldestKey);
    }
    const created: LiveSyncChannel = {
      token,
      updatedAtMs: Date.now(),
      account: null,
      robots: new Map(),
      symbols: [],
    activeContracts: {},
      pairingEvents: [],
      subscribers: new Set(),
    };
    mt5Channels.set(channelId, created);
    return created;
  }

  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    if (rateLimitBuckets.size > 500) {
      for (const [k, v] of rateLimitBuckets.entries()) {
        if (v.resetAt <= now) rateLimitBuckets.delete(k);
      }
    }
    const cur = rateLimitBuckets.get(key);
    if (!cur || cur.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (cur.count >= maxRequests) return false;
    cur.count++;
    return true;
  }

  function extractSyncToken(req: express.Request): string {
    const headerToken = req.header("x-sync-token");
    if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
    const authHeader = req.header("authorization");
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      const bearer = authHeader.slice(7).trim();
      if (bearer) return bearer;
    }
    const queryToken = req.query.token;
    if (typeof queryToken === "string" && queryToken.trim()) return queryToken.trim();
    const bodyToken = req.body?.token;
    if (typeof bodyToken === "string" && bodyToken.trim()) return bodyToken.trim();
    return "";
  }

  // --- API ROUTES (Registered first) ---

  app.get("/api/mt5-sync/:channelId/probe", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const channel = mt5Channels.get(channelId);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      channelId,
      channelActive: Boolean(channel),
      subscribers: channel ? channel.subscribers.size : 0,
      serverTime: new Date().toISOString(),
    });
  });

  const ticksWaiters = new Map<string, Array<(ticks: Array<[number, number, number]>) => void>>();

  app.post("/api/mt5-sync/:channelId/ticks", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Canal ou token inválido." });
      return;
    }
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim().toUpperCase();
    const date = String(body.date || "").trim().slice(0, 10);
    const hourTag = String(body.fromHour || "ALL").trim();
    const requestId = String(body.requestId || "").trim();
    const ticks = Array.isArray(body.ticks) ? body.ticks : [];
    if (symbol && date && ticks.length > 0) {
      try {
        fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
        fs.writeFileSync(path.join(process.cwd(), "data", `ticks_${symbol.replace(/[^A-Z0-9_$@.-]/gi, "_")}_${date}_${hourTag}.json`), JSON.stringify(ticks), "utf8");
      } catch {}
    }
    if (requestId) {
      const idx = requestQueue.findIndex((r) => r.id === requestId);
      if (idx >= 0) requestQueue.splice(idx, 1);
      const waiters = ticksWaiters.get(requestId) || [];
      ticksWaiters.delete(requestId);
      for (const fn of waiters) fn(ticks);
    }
    res.json({ ok: true, count: ticks.length });
  });

  app.get("/api/mt5-sync/:channelId/ticks", async (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Canal ou token inválido." });
      return;
    }
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const date = String(req.query.date || "").trim().slice(0, 10);
    const fromHour = String(req.query.fromHour || "").trim();
    const toHour = String(req.query.toHour || "").trim();
    const hourTag = fromHour || "ALL";
    const force = String(req.query.force || "") === "true";
    if (!symbol || !date) {
      res.status(400).json({ error: "Informe symbol e date (YYYY-MM-DD)." });
      return;
    }
    const cacheFile = path.join(process.cwd(), "data", `ticks_${symbol.replace(/[^A-Z0-9_$@.-]/gi, "_")}_${date}_${hourTag}.json`);
    if (!force && fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        if (Array.isArray(cached) && cached.length > 0) {
          res.json({ ticks: cached, source: "cache" });
          return;
        }
      } catch {}
    }
    const reqId = `ticks_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    addToQueue({ id: reqId, channelId, symbol, timeframe: "TICKS", date, fromHour, toHour, timestamp: Date.now(), status: "pending" } as unknown as PendingRequest);
    const resultTicks = await new Promise<Array<[number, number, number]>>((resolve) => {
      const timer = setTimeout(() => {
        ticksWaiters.delete(reqId);
        resolve([]);
      }, 15000);
      const arr = ticksWaiters.get(reqId) || [];
      arr.push((t) => { clearTimeout(timer); resolve(t); });
      ticksWaiters.set(reqId, arr);
    });
    res.json({ ticks: resultTicks, source: resultTicks.length > 0 ? "mt5" : "empty" });
  });

  app.get("/api/mt5-sync/:channelId/candles", (req, res) => {
    //console.log(`[API Hit] Requesting candles for channel: ${req.params.channelId}`);
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const symbol = req.query.symbol ? String(req.query.symbol).trim() : "";
    const timeframe = req.query.timeframe ? String(req.query.timeframe).trim() : "";

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }

    const channel = mt5Channels.get(channelId);
    if (!channel) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    if (channel.token !== token) {
      res.status(403).json({ error: "Token não confere com o canal registrado." });
      return;
    }

    const symKey = symbol.toUpperCase();
    const tfKey = timeframe.toUpperCase();

    if (symKey && tfKey) {
      activeChartFocus.set(channelId, {
        symbol: symKey,
        timeframe: tfKey,
        expiresAt: Date.now() + 30_000,
      });
    }

    const cachedChart = chartCandlesCache.get(`${channelId}:${symKey}:${tfKey}`);

    if (cachedChart && cachedChart.length > 0) {
      res.json({
        ok: true,
        candles: cachedChart,
      });
      return;
    }

    const robot = Array.from(channel.robots.values()).find(
      (r) => r.symbol.toUpperCase() === symKey &&
      (tfKey === "" || r.timeframe.toUpperCase() === tfKey)
    );

    if (!robot) {
      res.status(404).json({ error: `Candles para ${symbol} (${timeframe}) ainda não disponíveis.` });
      return;
    }


    let candles = robot.candles;
    if (tfKey && robot.candlesByTimeframe && robot.candlesByTimeframe[tfKey]) {
      candles = robot.candlesByTimeframe[tfKey];
    }

    res.json({
      ok: true,
      candles,
    });
  });

  app.get("/api/mt5-sync/:channelId/symbols", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }

    const channel = mt5Channels.get(channelId);
    if (!channel) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    if (channel.token !== token) {
      res.status(403).json({ error: "Token não confere com o canal registrado." });
      return;
    }

    res.json({
      ok: true,
      symbols: channel.symbols,
      updatedAt: new Date(channel.updatedAtMs).toISOString(),
    });
  });

  app.post("/api/mt5-sync/:channelId", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      if (mt5Channels.get(channelId)) {
        pushPairingEvent(mt5Channels.get(channelId)!, {
          outcome: "error",
          httpStatus: 401,
          source: "unknown",
          summary: "Token ausente ou inválido na requisição",
          detail: "Confira InpSyncToken nos parâmetros do EA PainelSync.mq5 no MetaTrader 5.",
        });
      }
      res.status(401).json({ error: "Canal ou token de sincronia inválido." });
      return;
    }

    const channel = getOrCreateChannel(channelId, token);
    if (!channel) {
      if (mt5Channels.get(channelId)) {
        pushPairingEvent(mt5Channels.get(channelId)!, {
          outcome: "error",
          httpStatus: 403,
          source: "unknown",
          summary: "Token divergente rejeitado (HTTP 403)",
          detail: "O token enviado pelo conector não confere com o token ativo neste canal.",
        });
      }
      res.status(403).json({ error: "Token de sincronia não corresponde ao canal registrado." });
      return;
    }

    const body = req.body;
    //console.log("[Debug] Request Body:", JSON.stringify(body));

    if (!body || typeof body !== "object") {
      pushPairingEvent(channel, {
        outcome: "error",
        httpStatus: 400,
        source: "unknown",
        summary: "Payload JSON vazio ou inválido",
        detail: "O corpo da requisição POST não é um objeto JSON válido.",
      });
      res.status(400).json({ error: "Payload JSON inválido." });
      return;
    }

    const serverReceivedAt = new Date().toISOString();

    if (body.pingTest === true) {
      pushPairingEvent(channel, {
        outcome: "success",
        httpStatus: 200,
        source: "ping",
        summary: "Ping de pareamento aprovado (HTTP 200)",
        detail: "Canal registrado, x-sync-token validado e stream SSE entregando em tempo real.",
      });
      res.json({
        ok: true,
        pingTest: true,
        serverReceivedAt,
      });
      return;
    }

    if (body.isHistorySync === true) {
      const login = body.account?.login ? String(body.account.login) : channel.account?.login;
      const rawTrades = Array.isArray(body.trades) ? body.trades : [];
      if (login && rawTrades.length > 0) {
        const normalized = rawTrades.map((t: Record<string, unknown>) => ({
          id: String(t.id || ""),
          robotId: String(t.robotId || `${Number(t.magicNumber) || 0}_${String(t.symbol || "")}`),
          robotName: String(t.robotName || `Robo #${Number(t.magicNumber) || 0}`),
          magicNumber: Number(t.magicNumber) || 0,
          symbol: String(t.symbol || ""),
          side: (t.side === "VENDA" ? "VENDA" : "COMPRA") as "COMPRA" | "VENDA",
          entryDate: String(t.entryDate || ""),
          exitDate: String(t.exitDate || ""),
          entryTime: String(t.entryTime || ""),
          exitTime: String(t.exitTime || ""),
          entryPrice: Number(t.entryPrice) || 0,
          exitPrice: Number(t.exitPrice) || 0,
          volume: Number(t.volume) || 1,
          points: Number(t.points) || 0,
          pnlBrl: Number(t.pnlBrl) || 0,
          reason: String(t.reason || "MT5"),
        }));
        persistExecutedTrades(login, normalized);
        persistedTradesCache.delete(String(login));
      }
      channel.updatedAtMs = Date.now();
      res.json({
        ok: true,
        isHistorySync: true,
        importedCount: rawTrades.length,
        serverReceivedAt,
      });
      return;
    }

    if (body.replaceAll === true) {
      channel.robots.clear();
      channel.symbols = [];
    }

    if (body.account && typeof body.account === "object") {
      channel.account = {
        login: body.account.login ? String(body.account.login) : undefined,
        server: body.account.server ? String(body.account.server) : undefined,
        broker: body.account.broker ? String(body.account.broker) : undefined,
        mode: body.account.mode === "REAL" ? "REAL" : "DEMO",
        marginMode: String(body.account.marginMode || "").toUpperCase() === "HEDGE" ? "HEDGE" : "NETTING",
        balance: Number(body.account.balance) || 0,
        equity: Number(body.account.equity) || 0,
        margin: Number(body.account.margin) || 0,
        freeMargin: Number(body.account.freeMargin) || 0,
        dailyPnlBrl: Number(body.account.dailyPnlBrl) || 0,
      };
    }

    mergeChannelSymbols(channel, body.symbols);
    if (body.activeContracts && typeof body.activeContracts === 'object') {
      channel.activeContracts = { ...channel.activeContracts, ...(body.activeContracts as Record<string, string>) };
    }

    const hasRobotPayload =
      Array.isArray(body.robots) ||
      (typeof body.symbol === "string" && body.symbol.trim() !== "") ||
      Array.isArray(body.candles);

    if (!hasRobotPayload) {
      channel.updatedAtMs = Date.now();
      const symbolsSnapshot = buildSnapshotResponse(channelId, channel);
      const symbolsSse = `event: telemetry\ndata: ${JSON.stringify(symbolsSnapshot)}\n\n`;
      for (const client of channel.subscribers) {
        client.write(symbolsSse);
      }
      res.json({
        ok: true,
        symbolsCount: channel.symbols.length,
        serverReceivedAt,
      });
      return;
    }

    if (body.isChartRequest === true) {
      const chartCandles = normalizeCandles(body.candles);
      const chartSymbol = String(body.symbol || "").trim().toUpperCase();
      const chartTf = String(body.timeframe || "M5").trim().toUpperCase();

      //console.log(`[Gráfico] ${chartSymbol} (${chartTf}) -> ${body.isChartDelta ? "Delta (2 velas)" : `Snapshot (${chartCandles.length} velas)`}`);

      if (chartSymbol && body.isChartDelta === true) {
        const existing = chartCandlesCache.get(`${channelId}:${chartSymbol}:${chartTf}`) || [];
        if (existing.length > 0 && chartCandles.length > 0) {
          const merged = [...existing];
          for (const incoming of chartCandles.slice(-2)) {
            const idx = merged.findIndex((c) => c.time === incoming.time);
            if (idx >= 0) {
              merged[idx] = { ...incoming, index: idx };
            } else {
              merged.push({ ...incoming, index: merged.length });
            }
          }
          merged.sort((a, b) => Number(a.time ?? 0) - Number(b.time ?? 0));
          const trimmed = merged.slice(-MAX_CHART_CANDLES).map((c, i) => ({ ...c, index: i }));
          chartCandlesCache.set(`${channelId}:${chartSymbol}:${chartTf}`, trimmed);
                  }
        channel.updatedAtMs = Date.now();
        res.json({
          ok: true,
          isChartDelta: true,
          candlesCount: chartCandles.length,
          serverReceivedAt,
        });
        return;
      }

      if (chartSymbol) {
        mergeChannelSymbols(channel, [chartSymbol]);
        if (chartCandles.length > 0) {
          const prevCached = chartCandlesCache.get(`${channelId}:${chartSymbol}:${chartTf}`) || [];
          const byTime = new Map<number, NormalizedCandle>();
          for (const c of prevCached) { const t = Number(c.time ?? 0); if (t > 0) byTime.set(t, c); }
          for (const c of chartCandles) { const t = Number(c.time ?? 0); if (t > 0) byTime.set(t, c); }
          const mergedSnap = Array.from(byTime.entries()).sort((a, b) => a[0] - b[0]).slice(-MAX_CHART_CANDLES).map(([, c], i) => ({ ...c, index: i }));
          chartCandlesCache.set(`${channelId}:${chartSymbol}:${chartTf}`, mergedSnap);
                    activeChartFocus.set(channelId, {
            symbol: chartSymbol,
            timeframe: chartTf,
            expiresAt: Date.now() + 30_000,
          });
        }
      }

      if (body.requestId) {
        const requestId = String(body.requestId);
        if (chartCandles.length > 0) {
          completeRequest(requestId, chartCandles);
        } else {
          failRequest(requestId, "MT5 retornou lista de candles vazia.");
        }
      }

      channel.updatedAtMs = Date.now();
      res.json({
        ok: true,
        isChartRequest: true,
        candlesCount: chartCandles.length,
        serverReceivedAt,
      });
      return;
    }

    const incomingRobots: Array<Record<string, unknown>> = Array.isArray(body.robots)
      ? body.robots
      : (body.isManualRequest ? [] : [body as Record<string, unknown>]);

    const prevRobotsSnap = new Map(channel.robots);
    const normalizedList: NormalizedRobot[] = [];
    for (const rawBot of incomingRobots) {
      if (!rawBot || typeof rawBot !== "object") continue;
      const normalized = normalizeRobotPayload(rawBot, serverReceivedAt);
      if (normalized) {
        channel.robots.set(normalized.robotId, normalized);
        mergeChannelSymbols(channel, [normalized.symbol]);
        normalizedList.push(normalized);
      }
    }

    if (normalizedList.length > 0) {
      const acctSyncKey = channel.account?.login ? String(channel.account.login) : channelId;
      const liveTrades = normalizedList.flatMap((b) => Array.isArray(b.trades) ? b.trades : []);
      syncNewTelemetryTradesToDb(acctSyncKey, liveTrades);
    }

    if (Array.isArray(body.robots)) {
      for (const bot of normalizedList) {
        const prev = prevRobotsSnap.get(bot.robotId);
        const prevOrds = new Map<string, NormalizedPendingOrder>((prev?.pendingOrders ?? new Array<NormalizedPendingOrder>()).map((o: NormalizedPendingOrder) => [o.id, o]));
        const currOrds = new Map(bot.pendingOrders.map((o) => [o.id, o]));
        for (const [oid, ord] of currOrds) {
          if (!prevOrds.has(oid)) pushPairingEvent(channel, { outcome: 'info', httpStatus: 200, source: 'mt5', category: 'orders', symbol: bot.symbol, magicNumber: bot.magicNumber, summary: `Ordem aberta: ${ord.orderType} ${ord.volume}x ${bot.symbol} @ ${ord.price}`, detail: `Robô ${bot.name} (#${bot.magicNumber}) • SL: ${ord.sl || '—'} | TP: ${ord.tp || '—'}` });
        }
        for (const [oid, ord] of prevOrds) {
          if (!currOrds.has(oid)) pushPairingEvent(channel, { outcome: 'info', httpStatus: 200, source: 'mt5', category: 'orders', symbol: bot.symbol, magicNumber: bot.magicNumber, summary: `Ordem cancelada/removida: ${ord.orderType} ${bot.symbol} @ ${ord.price}`, detail: `Robô ${bot.name} (#${bot.magicNumber})` });
        }
        if (!prev?.position && bot.position) pushPairingEvent(channel, { outcome: 'success', httpStatus: 200, source: 'mt5', category: 'positions', symbol: bot.symbol, magicNumber: bot.magicNumber, summary: `Posição aberta: ${bot.position.side} ${bot.position.volume}x ${bot.symbol} @ ${bot.position.entryPrice}`, detail: `Robô ${bot.name} (#${bot.magicNumber}) • SL: ${bot.position.sl || '—'} | TP: ${bot.position.tp || '—'}` });
        else if (prev?.position && !bot.position) pushPairingEvent(channel, { outcome: 'info', httpStatus: 200, source: 'mt5', category: 'positions', symbol: bot.symbol, magicNumber: bot.magicNumber, summary: `Posição encerrada: ${prev.position.side} ${bot.symbol}`, detail: `Robô ${bot.name} (#${bot.magicNumber})` });
      }
      const activeIds = new Set(normalizedList.map((r) => r.robotId));
      for (const [id, prev] of prevRobotsSnap.entries()) {
        if (!activeIds.has(id)) {
          for (const ord of prev.pendingOrders) pushPairingEvent(channel, { outcome: 'info', httpStatus: 200, source: 'mt5', category: 'orders', symbol: prev.symbol, magicNumber: prev.magicNumber, summary: `Ordem cancelada: ${ord.orderType} ${prev.symbol} @ ${ord.price}`, detail: `Robô ${prev.name} (#${prev.magicNumber})` });
          if (prev.position) pushPairingEvent(channel, { outcome: 'info', httpStatus: 200, source: 'mt5', category: 'positions', symbol: prev.symbol, magicNumber: prev.magicNumber, summary: `Posição encerrada: ${prev.position.side} ${prev.symbol}`, detail: `Robô ${prev.name} (#${prev.magicNumber})` });
        }
      }
    }
    if (Array.isArray(body.robots)) {
      const activeIds = new Set(normalizedList.map((r) => r.robotId));
      for (const [id, existingBot] of channel.robots.entries()) {
        if (!activeIds.has(id) && (existingBot.position !== null || existingBot.pendingOrders.length > 0)) {
          channel.robots.set(id, {
            ...existingBot,
            status: 'idle',
            position: null,
            pendingOrders: [],
            floatingPnlBrl: 0,
            lastUpdate: serverReceivedAt,
          });
        }
      }
    }

    if (normalizedList.length === 0 && !Array.isArray(body.robots)) {
      pushPairingEvent(channel, {
        outcome: "error",
        httpStatus: 400,
        source: "unknown",
        summary: "Nenhum robô válido no payload (HTTP 400)",
        detail: "Esperado objeto de robô com símbolo/candles ou array robots[].",
      });
      res.status(400).json({ error: "Nenhum dado de robô válido encontrado no payload." });
      return;
    }

    if (body.requestId) {
      const requestId = String(body.requestId);
      const request = requestQueue.find(r => r.id === requestId);
      if (request) {
        if (normalizedList.length > 0 && normalizedList[0].candles.length > 0) {
          completeRequest(requestId, normalizedList[0].candles);
        } else {
          failRequest(requestId, "Robô retornou lista de candles vazia.");
        }
      }
    }

    channel.updatedAtMs = Date.now();
    runManagedRobotsCycle(channelId, channel);
    const snapshot = buildSnapshotResponse(channelId, channel);
    const sseData = `event: telemetry\ndata: ${JSON.stringify(snapshot)}\n\n`;

    for (const client of channel.subscribers) {
      client.write(sseData);
    }

    const totalCandles = normalizedList.reduce((acc, r) => acc + r.candles.length, 0);
    const totalTrades = normalizedList.reduce((acc, r) => acc + r.trades.length, 0);
    const firstBot = normalizedList[0];

    const currentSignature = normalizedList
      .map(
        (r) =>
          `${r.robotId}:${r.status}:${r.position ? `${r.position.id}@${r.position.sl}/${r.position.tp}` : "none"}:ord${r.pendingOrders.length}:${r.trades.length}`
      )
      .sort()
      .join("|");

    if (lastChannelSignature.get(channelId) !== currentSignature) {
      lastChannelSignature.set(channelId, currentSignature);
      pushPairingEvent(channel, {
        outcome: "success",
        httpStatus: 200,
        source: "mt5",
        category: "connection",
        summary: `Estado atualizado · ${normalizedList.length} robô(s)`,
        detail: `${normalizedList.map((r) => `${r.name} (${r.status})`).join(" · ")} · ${totalTrades} negócio(s) hoje`,
        symbol: normalizedList.length === 1 ? firstBot.symbol : `${normalizedList.length} ativos`,
        magicNumber: normalizedList.length === 1 ? firstBot.magicNumber : undefined,
        candlesCount: totalCandles,
        tradesCount: totalTrades,
      });
    }

    res.json({
      ok: true,
      serverReceivedAt,
      robotsCount: channel.robots.size,
    });
  });

  app.get("/api/mt5-sync/:channelId/stream", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }

    const channel = getOrCreateChannel(channelId, token);
    if (!channel) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    channel.subscribers.add(res);
    res.write(
      `event: ready\ndata: ${JSON.stringify({
        channelId,
        connected: true,
        serverStartedAt: SERVER_STARTED_AT,
        pairingEvents: channel.pairingEvents,
      })}\n\n`
    );
    if (channel.robots.size > 0 || channel.account) {
      const snapshot = buildSnapshotResponse(channelId, channel);
      res.write(`event: telemetry\ndata: ${JSON.stringify(snapshot)}\n\n`);
    }

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      channel.subscribers.delete(res);
    });
  });

  app.get("/api/mt5-sync/:channelId/pending", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }

    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    pruneExpiredRequests();
    const pending = requestQueue.filter(r => r.channelId === channelId && r.status === "pending");
    const responseRequests = pending.map(r => ({ ...r }));

    for (const request of pending) {
      request.status = "processing";
      pushPairingEvent(channel, {
        outcome: "request",
        httpStatus: 202,
        source: "backend",
        summary: `Processando solicitação: ${request.symbol}`,
        detail: `Enviando solicitação ID ${request.id} para o robô.`,
        requestId: request.id,
        symbol: request.symbol,
        timeframe: request.timeframe,
      });
    }

    const focus = activeChartFocus.get(channelId);
    const validFocus =
      focus && focus.expiresAt > Date.now()
        ? { symbol: focus.symbol, timeframe: focus.timeframe }
        : null;

    const pendingCommands = pollAndDispatchPendingCommands(channelId);
    for (const cmd of pendingCommands) {
      pushPairingEvent(channel, {
        outcome: "request",
        httpStatus: 202,
        source: "backend",
        summary: `Despachando comando: ${cmd.action}${cmd.magicNumber ? ` (#${cmd.magicNumber})` : ""}`,
        detail: `Comando ${cmd.id} enviado ao MT5 (expira em 15s).`,
        requestId: cmd.id,
        symbol: cmd.symbol,
        magicNumber: cmd.magicNumber,
      });
    }

    res.json({
      ok: true,
      commands: pendingCommands,
      requests: responseRequests,
      activeChart: validFocus,
      watchSymbols: getWatchSymbolsForChannel(channelId, channel),
    });
  });

  app.post("/api/mt5-sync/:channelId/request", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    if (!checkRateLimit(`req:${channelId}`, 30, 10000)) {
      res.status(429).json({ error: "Muitas solicitações de candles. Tente novamente em instantes." });
      return;
    }
    const token = extractSyncToken(req);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }

    const channel = mt5Channels.get(channelId);
    if (!channel) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    const { symbol, timeframe, date } = req.body;
    const cleanDate = typeof date === "string" && /^(from:)?\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? date.trim() : undefined;
    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Parâmetros 'symbol' e 'timeframe' são obrigatórios." });
      return;
    }

    const cleanSym = String(symbol).trim();
    const cleanTf = String(timeframe).trim();
    const existingDup = findActiveDuplicateRequest(channelId, cleanSym, cleanTf, cleanDate);
    if (existingDup) {
      console.log(`[${fmtLogTs()}] [Front -> Server] DEDUP ${existingDup.id} | ${cleanSym} ${cleanTf}${cleanDate ? ` | date=${cleanDate}` : ""} (status=${existingDup.status})`);
      res.json({
        ok: true,
        deduplicated: true,
        requestId: existingDup.id,
        message: "Solicitação idêntica já está em andamento."
      });
      return;
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newRequest: PendingRequest = {
      id: requestId,
      channelId,
      symbol: cleanSym,
      timeframe: cleanTf,
      ...(cleanDate ? { date: cleanDate } : {}),
      timestamp: Date.now(),
      status: "pending"
    };

    if (cleanDate) requestDateMap.set(requestId, cleanDate);
    addToQueue(newRequest);

    pushPairingEvent(channel, {
      outcome: "request",
      httpStatus: 202,
      source: "backend",
      summary: `Solicitação de dados: ${newRequest.symbol}`,
      detail: `Solicitação ID ${requestId} para buscar dados de ${newRequest.symbol} no timeframe ${newRequest.timeframe}.`,
      requestId,
      symbol: newRequest.symbol,
      timeframe: newRequest.timeframe
    });

    res.json({
      ok: true,
      requestId,
      message: "Solicitação adicionada à fila e enviada ao robô."
    });
  });

  app.get("/api/mt5-sync/:channelId/symbol-spec", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = channelId.length >= 4 && token.length >= 6 ? getOrCreateChannel(channelId, token) : null;
    if (!channel) { res.status(403).json({ error: "Token invalido." }); return; }
    const rawSym = String(req.query.symbol || "WIN$").trim().toUpperCase();
    const resolved = resolveManagedSymbol(channel, rawSym);
    const brokerSpec = channel.symbolSpecs?.[resolved] || channel.symbolSpecs?.[rawSym] || null;
    const spec = resolveSymbolTickSpec(resolved, 0, brokerSpec);
    res.json({ ok: true, symbol: rawSym, resolvedSymbol: resolved, ...spec, source: brokerSpec ? "mt5" : "b3_default" });
  });

  app.get("/api/mt5-sync/:channelId/managed-robots", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = channelId.length >= 4 && token.length >= 6 ? getOrCreateChannel(channelId, token) : null;
    if (!channel) { res.status(403).json({ error: "Token invalido." }); return; }
    res.json({ ok: true, robots: listManagedRobots(channelId) });
  });

  app.post("/api/mt5-sync/:channelId/managed-robots", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = channelId.length >= 4 && token.length >= 6 ? getOrCreateChannel(channelId, token) : null;
    if (!channel) { res.status(403).json({ error: "Token invalido." }); return; }
    const b = req.body || {};
    const tfRaw = String(b.timeframe || "M5").toUpperCase();
    const timeframe = (["M1", "M5", "M15", "M30", "H1"].includes(tfRaw) ? tfRaw : "M5") as "M1" | "M5" | "M15" | "M30" | "H1";
    const stRaw = String(b.strategyType || "ema_cross");
    const strategyType = (Array.of("ema_cross", "rsi_reversal", "breakout", "wdo_opening_zones").includes(stRaw) ? stRaw : "ema_cross") as "ema_cross" | "rsi_reversal" | "breakout" | "wdo_opening_zones";
    const created = createManagedRobot({
      channelId,
      name: String(b.name || "").trim() || "Robo App",
      magicNumber: Number(b.magicNumber) || undefined,
      symbol: String(b.symbol || "WIN$").trim().toUpperCase(),
      timeframe,
      enabled: b.environment === "PRODUCTION" ? Boolean(b.enabled) : false, environment: b.environment === "PRODUCTION" ? "PRODUCTION" : "SIMULATOR",
      strategyType,
      params: typeof b.params === "object" && b.params ? b.params : {},
      risk: {
        volume: snapVolumeToLot(Math.max(0, Number(b.risk?.volume) || 0), resolveSymbolTickSpec(resolveManagedSymbol(channel, String(b.symbol || 'WIN$')), 0, channel.symbolSpecs?.[resolveManagedSymbol(channel, String(b.symbol || 'WIN$'))])),
        stopPoints: Math.max(0, Number(b.risk?.stopPoints) || 0),
        takePoints: Math.max(0, Number(b.risk?.takePoints) || 0),
        startTime: String(b.risk?.startTime || "09:05"),
        endTime: String(b.risk?.endTime || "17:15"),
        closeTime: String(b.risk?.closeTime || "17:45"),
        maxDailyLossBrl: Math.max(0, Number(b.risk?.maxDailyLossBrl) || 0),
        reverseOnOpposite: b.risk?.reverseOnOpposite !== false,
      },
    });
    res.status(201).json({ ok: true, robot: created });
  });

  app.patch("/api/mt5-sync/:channelId/managed-robots/:robotId", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const robotId = String(req.params.robotId || "").trim();
    const token = extractSyncToken(req);
    const channel = channelId.length >= 4 && token.length >= 6 ? getOrCreateChannel(channelId, token) : null;
    if (!channel) { res.status(403).json({ error: "Token invalido." }); return; }
    const updated = updateManagedRobot(channelId, robotId, req.body || {});
    if (!updated) { res.status(404).json({ error: "Robo nao encontrado." }); return; }
    res.json({ ok: true, robot: updated });
  });

  app.delete("/api/mt5-sync/:channelId/managed-robots/:robotId", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const robotId = String(req.params.robotId || "").trim();
    const token = extractSyncToken(req);
    const channel = channelId.length >= 4 && token.length >= 6 ? getOrCreateChannel(channelId, token) : null;
    if (!channel) { res.status(403).json({ error: "Token invalido." }); return; }
    deleteManagedRobot(channelId, robotId);
    res.json({ ok: true });
  });

  app.get("/api/mt5-sync/:channelId/commands", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }
    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }
    res.json({ ok: true, commands: listRecentCommands(channelId) });
  });

  app.post("/api/mt5-sync/:channelId/commands", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    if (!checkRateLimit(`cmd:${channelId}`, 20, 10000)) {
      res.status(429).json({ error: "Limite de comandos por segundo excedido. Aguarde alguns segundos." });
      return;
    }
    const token = extractSyncToken(req);
    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }
    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    const validActions = ["CLOSE_MAGIC", "CANCEL_ORDERS", "CLOSE_ALL", "OPEN_ORDER", "MODIFY_SL_TP"];
    const action = String(req.body?.action || "").toUpperCase().trim();
    if (!validActions.includes(action)) {
      res.status(400).json({ error: "Ação de comando inválida." });
      return;
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = enqueueCommand({
      id: commandId,
      channelId,
      magicNumber: (req.body?.magicNumber !== undefined && req.body?.magicNumber !== null && String(req.body?.magicNumber).trim() !== "") ? Number(req.body.magicNumber) : undefined,
      action: action as "CLOSE_MAGIC" | "CANCEL_ORDERS" | "CLOSE_ALL" | "OPEN_ORDER" | "MODIFY_SL_TP",
      symbol: req.body?.symbol ? String(req.body.symbol) : undefined,
      side: req.body?.side === "COMPRA" || req.body?.side === "VENDA" ? req.body.side : undefined,
      volume: Number(req.body?.volume) || undefined,
      price: Number(req.body?.price) || undefined,
      sl: Number(req.body?.sl) || undefined,
      tp: Number(req.body?.tp) || undefined,
      ttlSeconds: Number(req.body?.ttlSeconds) || 15,
    });

    pushPairingEvent(channel, {
      outcome: "request",
      httpStatus: 201,
      source: "frontend",
      summary: `Comando criado: ${created.action}${created.magicNumber ? ` (#${created.magicNumber})` : ""}`,
      detail: `Aguardando execução imediata no MT5 (ID ${created.id}).`,
      requestId: created.id,
      symbol: created.symbol,
      magicNumber: created.magicNumber,
    });

    const ssePayload = `event: command_update\ndata: ${JSON.stringify(created)}\n\n`;
    for (const sub of channel.subscribers) {
      try { sub.write(ssePayload); } catch {}
    }

    res.status(201).json({ ok: true, command: created });
  });

  app.post("/api/mt5-sync/:channelId/commands/:commandId/ack", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const commandId = String(req.params.commandId || "").trim();
    const token = extractSyncToken(req);
    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      res.status(401).json({ error: "Canal ou token inválido." });
      return;
    }
    const channel = mt5Channels.get(channelId);
    if (!channel || channel.token !== token) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    const ok = Boolean(req.body?.ok);
    const updated = acknowledgeCommand(channelId, commandId, {
      status: ok ? "executed" : "failed",
      mt5OrderTicket: req.body?.orderTicket ? String(req.body.orderTicket) : undefined,
      mt5PositionTicket: req.body?.positionTicket ? String(req.body.positionTicket) : undefined,
      retcode: Number(req.body?.retcode) || 0,
      ackMessage: req.body?.message ? String(req.body.message) : (ok ? "Executado no MT5" : "Falha na execução"),
    });

    if (!updated) {
      res.status(404).json({ error: "Comando não encontrado." });
      return;
    }

    pushPairingEvent(channel, {
      outcome: ok ? "success" : "error",
      httpStatus: ok ? 200 : 422,
      source: "mt5",
      summary: `${ok ? "Executado" : "Falha"}: ${updated.action}${updated.magicNumber ? ` (#${updated.magicNumber})` : ""}`,
      detail: updated.ackMessage || "",
      requestId: updated.id,
      symbol: updated.symbol,
      magicNumber: updated.magicNumber,
    });

    const ssePayload = `event: command_update\ndata: ${JSON.stringify(updated)}\n\n`;
    for (const sub of channel.subscribers) {
      try { sub.write(ssePayload); } catch {}
    }

    res.json({ ok: true, command: updated });
  });

  app.delete("/api/mt5-sync/:channelId", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const channel = mt5Channels.get(channelId);
    if (!channel) {
      res.json({ ok: true });
      return;
    }
    if (channel.token !== token) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

    const robotId = typeof req.query.robotId === "string" ? req.query.robotId.trim() : "";
    if (robotId) {
      channel.robots.delete(robotId);
      channel.updatedAtMs = Date.now();
      const snapshot = buildSnapshotResponse(channelId, channel);
      const sseData = `event: telemetry\ndata: ${JSON.stringify(snapshot)}\n\n`;
      for (const client of channel.subscribers) {
        client.write(sseData);
      }
      res.json({ ok: true, robotsCount: channel.robots.size });
      return;
    }

    channel.robots.clear();
    channel.account = null;
    channel.updatedAtMs = Date.now();
    for (const client of channel.subscribers) {
      client.write(`event: cleared\ndata: {}\n\n`);
    }
        res.json({ ok: true });
  });

  app.patch("/api/mt5-sync/:channelId/robots/:magicNumber", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const magicNumber = Number(req.params.magicNumber);
    const channel = mt5Channels.get(channelId);
    const token = String(req.header("x-sync-token") || req.query.token || "").trim();
    if (!channel || !token || channel.token !== token) { res.status(401).json({ error: "Nao autorizado." }); return; }
    if (!Number.isFinite(magicNumber)) { res.status(400).json({ error: "MagicNumber invalido." }); return; }
    const hidden = Boolean(req.body?.hidden);
    const accountKey = channel.account?.login || channelId;
    setRobotHiddenPreference(accountKey, magicNumber, hidden); if (accountKey !== channelId) setRobotHiddenPreference(channelId, magicNumber, hidden);
    const snapshot = buildSnapshotResponse(channelId, channel);
    const sseData = `event: telemetry\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of channel.subscribers) client.write(sseData);
    res.json({ ok: true, magicNumber, hidden });
  });

  // --- Static Files and Vite Middleware (Last) ---

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.post("/api/db/backup", (_req, res) => {
    const result = createDatabaseBackup(7);
    if (result.ok) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  });

  // Backup seguro automatico do SQLite (VACUUM INTO) a cada 6 horas
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    const res = createDatabaseBackup(7);
    if (res.ok) {
      console.log(`[SQLite Backup] Snapshot criado: ${res.backupPath}`);
    } else {
      console.warn(`[SQLite Backup] Falha: ${res.error}`);
    }
  }, SIX_HOURS_MS);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Painel Sync MT5 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();


