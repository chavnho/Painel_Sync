import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { PendingRequest, PairingAttemptEvent, LiveSyncChannel, NormalizedCandle} from "./types";

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

export const mt5Channels = new Map<string, LiveSyncChannel>();

const requestQueue: PendingRequest[] = [];
const chartCandlesCache = new Map<string, NormalizedCandle[]>();
const activeChartFocus = new Map<string, { symbol: string; timeframe: string; expiresAt: number }>();
const lastChannelSignature = new Map<string, string>();



function addToQueue(request: PendingRequest) {
  requestQueue.push(request);
  requestQueue.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`[Queue] Pedido adicionado: ${request.id} para ${request.symbol}`);
}

function getNextRequest(): PendingRequest | null {
  const request = requestQueue.find(r => r.status === "pending");
  if (request) {
    request.status = "processing";
  }
  return request || null;
}

function completeRequest(id: string, result: NormalizedCandle[]) {
  const request = requestQueue.find(r => r.id === id);
  if (request) {
    request.status = "completed";
    request.result = result;
    console.log(`[Queue] Pedido concluído: ${id}`);
  }
}

function failRequest(id: string, reason: string) {
  const request = requestQueue.find(r => r.id === id);
  if (request) {
    request.status = "failed";
    request.error = reason;
    console.log(`[Queue] Pedido falhou: ${id} - ${reason}`);
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

function processQueue() {
  const request = getNextRequest();
  if (request) {
    const channel = mt5Channels.get(request.channelId);
    if (channel) {
      pushPairingEvent(channel, {
        outcome: "request",
        httpStatus: 202,
        source: "backend",
        summary: `Processando solicitação: ${request.symbol}`,
        detail: `Enviando solicitação ID ${request.id} para o robô.`,
        requestId: request.id,
        symbol: request.symbol,
        timeframe: request.timeframe
      });
    }
  }
}

function normalizeCandles(raw: unknown): NormalizedCandle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-240)
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

function buildSnapshotResponse(channelId: string, channel: LiveSyncChannel) {
  const robots = Array.from(channel.robots.values());
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
    serverReceivedAt: new Date(channel.updatedAtMs).toISOString(),
    pairingEvents: channel.pairingEvents,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "3mb" }));

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
      pairingEvents: [],
      subscribers: new Set(),
    };
    mt5Channels.set(channelId, created);
    return created;
  }

  function extractSyncToken(req: express.Request): string {
    const headerToken = req.header("x-sync-token");
    if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
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
        expiresAt: Date.now() + 15_000,
      });
    }

    const cachedChart =
      chartCandlesCache.get(`${channelId}:${symKey}:${tfKey}`) ||
      chartCandlesCache.get(`${channelId}:${symKey}:`);

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
    if (timeframe && robot.candlesByTimeframe) {
      const tfKey = timeframe.toUpperCase();
      if (robot.candlesByTimeframe[tfKey]) {
        candles = robot.candlesByTimeframe[tfKey];
      }
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
          for (const incoming of chartCandles) {
            const idx = merged.findIndex((c) => c.time === incoming.time);
            if (idx >= 0) {
              merged[idx] = { ...incoming, index: idx };
            } else {
              merged.push({ ...incoming, index: merged.length });
            }
          }
          const trimmed = merged.slice(-240).map((c, i) => ({ ...c, index: i }));
          chartCandlesCache.set(`${channelId}:${chartSymbol}:${chartTf}`, trimmed);
          chartCandlesCache.set(`${channelId}:${chartSymbol}:`, trimmed);
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
          chartCandlesCache.set(`${channelId}:${chartSymbol}:${chartTf}`, chartCandles);
          chartCandlesCache.set(`${channelId}:${chartSymbol}:`, chartCandles);
          activeChartFocus.set(channelId, {
            symbol: chartSymbol,
            timeframe: chartTf,
            expiresAt: Date.now() + 15_000,
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
    if (!channel) {
      res.status(403).json({ error: "Token inválido para este canal." });
      return;
    }

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

    res.json({
      ok: true,
      requests: responseRequests,
      activeChart: validFocus,
    });
  });

  app.post("/api/mt5-sync/:channelId/request", (req, res) => {
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

    const { symbol, timeframe } = req.body;
    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Parâmetros 'symbol' e 'timeframe' são obrigatórios." });
      return;
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newRequest: PendingRequest = {
      id: requestId,
      channelId,
      symbol: String(symbol).trim(),
      timeframe: String(timeframe).trim(),
      timestamp: Date.now(),
      status: "pending"
    };

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Painel Sync MT5 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();


