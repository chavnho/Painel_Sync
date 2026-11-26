import type { NormalizedCandle } from "../../types";
import type { LiveCandle } from "../types/trading";
import type { PersistedManagedRobot } from "../db/tradesDb";
import {
  evaluateManagedRobot,
  resolveSymbolTickSpec,
  snapVolumeToLot,
  type EngineOpenPosition,
  type EngineOverlayLine,
} from "./robotEngine";

export interface SimulatedTrade {
  id: number;
  side: "COMPRA" | "VENDA";
  volume: number;
  entryTime: number;
  entryLabel: string;
  entryPrice: number;
  exitTime: number;
  exitLabel: string;
  exitPrice: number;
  points: number;
  pnlBrl: number;
  exitReason: string;
}

export interface BacktestSummary {
  netPnlBrl: number;
  netPoints: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownBrl: number;
  bestTradeBrl: number;
  worstTradeBrl: number;
}

export interface BacktestRunResult {
  trades: SimulatedTrade[];
  equityCurve: Array<{ time: number; value: number }>;
  overlays: EngineOverlayLine[];
  openPosition: EngineOpenPosition | null;
  lastDecision: string;
  summary: BacktestSummary;
}

function getPointValueBrl(symbol: string): number {
  const u = String(symbol || "").trim().toUpperCase();
  if (u.startsWith("WIN")) return 0.2;
  if (u.startsWith("IND")) return 1.0;
  if (u.startsWith("WDO")) return 10.0;
  if (u.startsWith("DOL")) return 50.0;
  if (u.startsWith("BIT")) return 0.1;
  return 1.0;
}

function normalizeEpochSec(raw: unknown, fallbackSec: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallbackSec;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

function formatUnixBrt(tsSec: number): { dateKey: string; label: string } {
  const d = new Date(tsSec * 1000);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return {
    dateKey: `${get("day")}/${get("month")}`,
    label: `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`,
  };
}

export function toNormalizedCandles(candles: LiveCandle[]): NormalizedCandle[] {
  const baseSec = Math.floor(Date.now() / 1000) - candles.length * 60;
  return candles.map((c, idx) => {
    const ts = normalizeEpochSec(c.time, baseSec + idx * 60);
    return { index: idx, time: ts, timeLabel: formatUnixBrt(ts).label, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume || 0) };
  });
}

export function runBacktestSimulation(input: {
  robot: Omit<PersistedManagedRobot, "id" | "channelId" | "createdAt" | "updatedAt" | "lastSignalBar" | "lastDecision">;
  candles: LiveCandle[];
  maxBars?: number;
}): BacktestRunResult {
  const allNorm = toNormalizedCandles(input.candles);
  const limit = input.maxBars && input.maxBars > 0 ? Math.min(allNorm.length, Math.trunc(input.maxBars)) : allNorm.length;
  const slice = allNorm.slice(0, limit);

  const sym = input.robot.symbol.toUpperCase();
  const spec = resolveSymbolTickSpec(sym, slice.at(0)?.close || 0, null);
  const pointValue = getPointValueBrl(sym);
  const safeVol = snapVolumeToLot(Number(input.robot.risk.volume) || spec.volumeMin, spec);

  const trades: SimulatedTrade[] = new Array();
  const equityCurve: Array<{ time: number; value: number }> = new Array();
  let realizedPnlBrl = 0;
  let peakEquity = 0;
  let maxDrawdownBrl = 0;

  let currentDay = "";
  let dailyRealizedBrl = 0;
  let lastSignalBar = 0;
  let lastDecision = "Aguardando velas suficientes...";

  let pos: {
    side: "COMPRA" | "VENDA";
    volume: number;
    entryPrice: number;
    entryTime: number;
    entryLabel: string;
    sl: number;
    tp: number;
  } | null = null;

  const closePos = (exitPrice: number, exitTime: number, exitLabel: string, exitReason: string) => {
    if (!pos) return;
    const rawPts = pos.side === "COMPRA" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const points = Number(rawPts.toFixed(spec.digits));
    const pnlBrl = Number((points * pointValue * pos.volume).toFixed(2));
    realizedPnlBrl = Number((realizedPnlBrl + pnlBrl).toFixed(2));
    dailyRealizedBrl = Number((dailyRealizedBrl + pnlBrl).toFixed(2));
    if (realizedPnlBrl > peakEquity) peakEquity = realizedPnlBrl;
    const dd = peakEquity - realizedPnlBrl;
    if (dd > maxDrawdownBrl) maxDrawdownBrl = dd;

    trades.push({
      id: trades.length + 1,
      side: pos.side,
      volume: pos.volume,
      entryTime: pos.entryTime,
      entryLabel: pos.entryLabel,
      entryPrice: pos.entryPrice,
      exitTime,
      exitLabel,
      exitPrice,
      points,
      pnlBrl,
      exitReason,
    });
    pos = null;
  };

  for (let i = 4; i < slice.length; i++) {
    const windowBars = slice.slice(0, i + 1);
    const curBar = windowBars.at(-1)!;
    const barTs = Number(curBar.time) || i * 60;
    const fmt = formatUnixBrt(barTs);

    if (fmt.dateKey !== currentDay) {
      currentDay = fmt.dateKey;
      dailyRealizedBrl = 0;
    }

    if (pos) {
      if (pos.side === "COMPRA") {
        if (pos.sl > 0 && curBar.low <= pos.sl) closePos(pos.sl, barTs, fmt.label, "Stop Loss");
        else if (pos.tp > 0 && curBar.high >= pos.tp) closePos(pos.tp, barTs, fmt.label, "Take Profit");
      } else {
        if (pos.sl > 0 && curBar.high >= pos.sl) closePos(pos.sl, barTs, fmt.label, "Stop Loss");
        else if (pos.tp > 0 && curBar.low <= pos.tp) closePos(pos.tp, barTs, fmt.label, "Take Profit");
      }
    }

    const floatingPnlBrl = pos
      ? Number(((pos.side === "COMPRA" ? curBar.close - pos.entryPrice : pos.entryPrice - curBar.close) * pointValue * pos.volume).toFixed(2))
      : 0;

    const openPosView: EngineOpenPosition | null = pos
      ? { side: pos.side, volume: pos.volume, entryPrice: pos.entryPrice, currentPrice: curBar.close, sl: pos.sl, tp: pos.tp, floatingPnlBrl }
      : null;

    const evalRes = evaluateManagedRobot({
      robot: {
        id: "sim_bot",
        channelId: "sim",
        name: input.robot.name,
        magicNumber: input.robot.magicNumber,
        symbol: sym,
        timeframe: input.robot.timeframe,
        enabled: true,
        strategyType: input.robot.strategyType,
        params: input.robot.params,
        risk: { ...input.robot.risk, volume: safeVol },
        lastSignalBar,
        lastDecision,
        createdAt: "",
        updatedAt: "",
      },
      candles: windowBars,
      resolvedSymbol: sym,
      openPosition: openPosView,
      dailyPnlBrl: dailyRealizedBrl + floatingPnlBrl,
      hasPendingCommand: false,
      now: new Date((barTs + 3 * 3600) * 1000),
    });

    lastDecision = evalRes.decision;

    if (evalRes.directive) {
      if (evalRes.directive.type === "CLOSE_MAGIC" && pos) {
        closePos(curBar.close, barTs, fmt.label, evalRes.directive.reason);
      } else if (evalRes.directive.type === "OPEN_ORDER" && !pos && evalRes.directive.side) {
        lastSignalBar = evalRes.directive.barTime;
        pos = {
          side: evalRes.directive.side,
          volume: safeVol,
          entryPrice: curBar.close,
          entryTime: barTs,
          entryLabel: fmt.label,
          sl: Number(evalRes.directive.sl || 0),
          tp: Number(evalRes.directive.tp || 0),
        };
      }
    }

    const curFloating = pos
      ? (pos.side === "COMPRA" ? curBar.close - pos.entryPrice : pos.entryPrice - curBar.close) * pointValue * pos.volume
      : 0;
    equityCurve.push({ time: barTs, value: Number((realizedPnlBrl + curFloating).toFixed(2)) });
  }

  const finalEval = evaluateManagedRobot({
    robot: {
      id: "sim_bot",
      channelId: "sim",
      name: input.robot.name,
      magicNumber: input.robot.magicNumber,
      symbol: sym,
      timeframe: input.robot.timeframe,
      enabled: true,
      strategyType: input.robot.strategyType,
      params: input.robot.params,
      risk: { ...input.robot.risk, volume: safeVol },
      lastSignalBar,
      lastDecision,
      createdAt: "",
      updatedAt: "",
    },
    candles: slice,
    resolvedSymbol: sym,
    openPosition: null,
    dailyPnlBrl: dailyRealizedBrl,
    hasPendingCommand: false,
  });

  const wins = trades.filter((t) => t.pnlBrl > 0).length;
  const losses = trades.filter((t) => t.pnlBrl < 0).length;
  const grossProfit = trades.filter((t) => t.pnlBrl > 0).reduce((s, t) => s + t.pnlBrl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlBrl < 0).reduce((s, t) => s + t.pnlBrl, 0));
  const netPoints = Number(trades.reduce((s, t) => s + t.points, 0).toFixed(spec.digits));
  const bestTradeBrl = trades.length > 0 ? Math.max(...trades.map((t) => t.pnlBrl)) : 0;
  const worstTradeBrl = trades.length > 0 ? Math.min(...trades.map((t) => t.pnlBrl)) : 0;

  const finalOpenPos: EngineOpenPosition | null = pos && slice.length > 0
    ? {
        side: pos.side,
        volume: pos.volume,
        entryPrice: pos.entryPrice,
        currentPrice: slice.at(-1)!.close,
        sl: pos.sl,
        tp: pos.tp,
        floatingPnlBrl: Number(((pos.side === "COMPRA" ? slice.at(-1)!.close - pos.entryPrice : pos.entryPrice - slice.at(-1)!.close) * pointValue * pos.volume).toFixed(2)),
      }
    : null;

  return {
    trades,
    equityCurve,
    overlays: finalEval.overlays,
    openPosition: finalOpenPos,
    lastDecision,
    summary: {
      netPnlBrl: realizedPnlBrl,
      netPoints,
      totalTrades: trades.length,
      wins,
      losses,
      winRatePct: trades.length > 0 ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
      profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0,
      maxDrawdownBrl: Number(maxDrawdownBrl.toFixed(2)),
      bestTradeBrl: Number(bestTradeBrl.toFixed(2)),
      worstTradeBrl: Number(worstTradeBrl.toFixed(2)),
    },
  };
}
