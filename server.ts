import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface NormalizedCandle {
  index: number;
  time?: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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

interface PairingAttemptEvent {
  id: string;
  timestamp: string;
  outcome: "success" | "error" | "info";
  httpStatus: number;
  source: "mt5" | "ping" | "unknown";
  summary: string;
  detail: string;
  symbol?: string;
  magicNumber?: number;
  candlesCount?: number;
  tradesCount?: number;
}

interface LiveSyncChannel {
  token: string;
  updatedAtMs: number;
  account: AccountSnapshot | null;
  robots: Map<string, NormalizedRobot>;
  pairingEvents: PairingAttemptEvent[];
  subscribers: Set<express.Response>;
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
    serverReceivedAt: new Date(channel.updatedAtMs).toISOString(),
    pairingEvents: channel.pairingEvents,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "3mb" }));

  const mt5Channels = new Map<string, LiveSyncChannel>();

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

  // Captura erros de JSON malformado enviados pelo MT5 ou scripts externos
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

  // Probe público para o navegador testar alcance externo sem cookies
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

  // Recebe telemetria de 1 ou múltiplos robôs MT5 (MQL5 EA)
  app.post("/api/mt5-sync/:channelId", (req, res) => {
    const channelId = String(req.params.channelId || "").trim();
    const token = extractSyncToken(req);
    const existingChannel = mt5Channels.get(channelId);

    if (!channelId || channelId.length < 4 || !token || token.length < 6) {
      if (existingChannel) {
        pushPairingEvent(existingChannel, {
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
      if (existingChannel) {
        pushPairingEvent(existingChannel, {
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

    // Ping de diagnóstico para validar canal + token + SSE sem alterar os robôs ativos
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
    }

    if (body.account && typeof body.account === "object") {
      channel.account = {
        login: body.account.login ? String(body.account.login) : undefined,
        server: body.account.server ? String(body.account.server) : undefined,
        broker: body.account.broker ? String(body.account.broker) : undefined,
        mode: body.account.mode === "REAL" ? "REAL" : "DEMO",
        balance: Number(body.account.balance) || 0,
        equity: Number(body.account.equity) || 0,
        margin: Number(body.account.margin) || 0,
        freeMargin: Number(body.account.freeMargin) || 0,
        dailyPnlBrl: Number(body.account.dailyPnlBrl) || 0,
      };
    }

    const incomingRobots: Array<Record<string, unknown>> = Array.isArray(body.robots)
      ? body.robots
      : [body as Record<string, unknown>];

    const normalizedList: NormalizedRobot[] = [];
    for (const rawBot of incomingRobots) {
      if (!rawBot || typeof rawBot !== "object") continue;
      const normalized = normalizeRobotPayload(rawBot, serverReceivedAt);
      if (normalized) {
        channel.robots.set(normalized.robotId, normalized);
        normalizedList.push(normalized);
      }
    }

    if (normalizedList.length === 0) {
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

    channel.updatedAtMs = Date.now();
    const snapshot = buildSnapshotResponse(channelId, channel);
    const sseData = `event: telemetry\ndata: ${JSON.stringify(snapshot)}\n\n`;

    for (const client of channel.subscribers) {
      client.write(sseData);
    }

    const totalCandles = normalizedList.reduce((acc, r) => acc + r.candles.length, 0);
    const totalTrades = normalizedList.reduce((acc, r) => acc + r.trades.length, 0);
    const firstBot = normalizedList[0];

    pushPairingEvent(channel, {
      outcome: "success",
      httpStatus: 200,
      source: "mt5",
      summary: `EA MT5 sincronizado · ${firstBot.symbol}`,
      detail: `${normalizedList.length} robô(s) · ${totalCandles} candles · ${totalTrades} negócios recentes`,
      symbol: normalizedList.length === 1 ? firstBot.symbol : `${normalizedList.length} ativos`,
      magicNumber: normalizedList.length === 1 ? firstBot.magicNumber : undefined,
      candlesCount: totalCandles,
      tradesCount: totalTrades,
    });

    res.json({
      ok: true,
      serverReceivedAt,
      robotsCount: channel.robots.size,
    });
  });

  // Stream SSE em tempo real para o painel
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

  // Endpoint para buscar candles de qualquer símbolo manualmente
  app.get("/api/mt5-sync/:channelId/candles", (req, res) => {
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

    const symbol = req.query.symbol;
    const timeframe = req.query.timeframe;

    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Parâmetros 'symbol' e 'timeframe' são obrigatórios." });
      return;
    }

    // Aqui, em um ambiente real, o backend enviaria um comando para o EA MT5
    // para buscar os candles e retorná-los. 
    // Como o EA atual só envia dados passivamente, para esta fase do projeto,
    // simularemos a resposta ou usaremos o cache se disponível.
    pushPairingEvent(channel, {
      outcome: "info",
      httpStatus: 200,
      source: "ping",
      summary: `Consulta de candles solicitada: ${symbol}`,
      detail: `Solicitando dados para o símbolo ${symbol} no timeframe ${timeframe}.`,
    });

    res.json({
      ok: true,
      message: "Dados mockados para teste.",
      symbol,
      timeframe,
      candles: Array.from({ length: 200 }, (_, i) => {
        const time = Date.now() - (200 - i) * 60000;
        const open = 100 + Math.random() * 10;
        const close = open + (Math.random() - 0.5) * 2;
        return {
          index: i,
          time: time,
          timeLabel: new Date(time).toISOString().split('T')[1].split('.')[0].replace(':', ''),
          open: parseFloat(open.toFixed(2)),
          high: parseFloat((Math.max(open, close) + Math.random()).toFixed(2)),
          low: parseFloat((Math.min(open, close) - Math.random()).toFixed(2)),
          close: parseFloat(close.toFixed(2)),
          volume: Math.floor(Math.random() * 1000),
        };
      }),
    });
  });

  // Limpa canal ou remove um robô específico
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
