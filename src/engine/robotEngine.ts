import { evaluateWdoOpeningZones } from "./wdoOpeningEngine";
import type { NormalizedCandle } from "../../types";
import type { PersistedManagedRobot } from "../db/tradesDb";

export interface EngineOpenPosition {
  side: "COMPRA" | "VENDA";
  volume: number;
  entryPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  floatingPnlBrl: number;
}

export interface EngineOrderDirective {
  type: "OPEN_ORDER" | "CLOSE_MAGIC";
  symbol: string;
  magicNumber: number;
  side?: "COMPRA" | "VENDA";
  volume?: number;
  sl?: number;
  tp?: number;
  barTime: number;
  reason: string;
}

export interface EngineOverlayLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  dotted?: boolean;
  lineWidth?: 1 | 2 | 3 | 4;
  values: Array<number | null>;
}

export interface EngineEvaluationResult {
  decision: string;
  directive: EngineOrderDirective | null;
  overlays: EngineOverlayLine[];
}

function calcSmaSeries(closes: number[], period: number): Array<number | null> {
  const p = Math.max(1, Math.trunc(period));
  const out: Array<number | null> = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes.at(i)!;
    if (i >= p) sum -= closes.at(i - p)!;
    if (i >= p - 1) out.splice(i, 1, Number((sum / p).toFixed(4)));
  }
  return out;
}

function calcEmaSeries(closes: number[], period: number): Array<number | null> {
  const p = Math.max(1, Math.trunc(period));
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < p) return out;
  const k = 2 / (p + 1);
  let seed = 0;
  for (let i = 0; i < p; i++) seed += closes.at(i)!;
  let ema = seed / p;
  out.splice(p - 1, 1, Number(ema.toFixed(4)));
  for (let i = p; i < closes.length; i++) {
    ema = closes.at(i)! * k + ema * (1 - k);
    out.splice(i, 1, Number(ema.toFixed(4)));
  }
  return out;
}

function calcRsiSeries(closes: number[], period: number): Array<number | null> {
  const p = Math.max(2, Math.trunc(period));
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= p) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= p; i++) {
    const diff = closes.at(i)! - closes.at(i - 1)!;
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / p;
  let avgLoss = lossSum / p;
  out.splice(p, 1, Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
  for (let i = p + 1; i < closes.length; i++) {
    const diff = closes.at(i)! - closes.at(i - 1)!;
    avgGain = (avgGain * (p - 1) + (diff > 0 ? diff : 0)) / p;
    avgLoss = (avgLoss * (p - 1) + (diff < 0 ? -diff : 0)) / p;
    out.splice(i, 1, Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
  }
  return out;
}

function getBrtHHMM(now = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

export interface SymbolTickSpec {
  tickSize: number;
  digits: number;
  isTickCountUnit: boolean;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

function inferDefaultLotSpec(u: string): { volumeMin: number; volumeMax: number; volumeStep: number } {
  if (/^(IND|DOL)/.test(u)) return { volumeMin: 5, volumeMax: 10000, volumeStep: 5 };
  if (/^(WIN|WDO|BIT|CCM|BGI|ICF)/.test(u)) return { volumeMin: 1, volumeMax: 10000, volumeStep: 1 };
  if (/^[A-Z]{4}(3|4|5|6|11)F$/.test(u)) return { volumeMin: 1, volumeMax: 99, volumeStep: 1 };
  if (/^[A-Z]{4}(3|4|5|6|11)$/.test(u)) return { volumeMin: 100, volumeMax: 1000000, volumeStep: 100 };
  return { volumeMin: 1, volumeMax: 100000, volumeStep: 1 };
}

export function resolveSymbolTickSpec(
  symbol: string,
  refPrice = 0,
  brokerSpec?: { tickSize?: number; digits?: number; volumeMin?: number; volumeMax?: number; volumeStep?: number } | null
): SymbolTickSpec {
  const u = String(symbol || "").trim().toUpperCase();
  const defLot = inferDefaultLotSpec(u);
  const volumeMin = brokerSpec && Number(brokerSpec.volumeMin) > 0 ? Number(brokerSpec.volumeMin) : defLot.volumeMin;
  const volumeMax = brokerSpec && Number(brokerSpec.volumeMax) > 0 ? Number(brokerSpec.volumeMax) : defLot.volumeMax;
  const volumeStep = brokerSpec && Number(brokerSpec.volumeStep) > 0 ? Number(brokerSpec.volumeStep) : defLot.volumeStep;

  if (brokerSpec && Number(brokerSpec.tickSize) > 0) {
    const tickSize = Number(brokerSpec.tickSize);
    const digits = Number.isInteger(brokerSpec.digits) && Number(brokerSpec.digits) >= 0
      ? Number(brokerSpec.digits)
      : tickSize >= 1 ? 0 : tickSize >= 0.1 ? 1 : 2;
    return { tickSize, digits, isTickCountUnit: tickSize < 0.5, volumeMin, volumeMax, volumeStep };
  }
  if (/^(WIN|IND)/.test(u)) return { tickSize: 5, digits: 0, isTickCountUnit: false, volumeMin, volumeMax, volumeStep };
  if (/^(WDO|DOL)/.test(u)) return { tickSize: 0.5, digits: 1, isTickCountUnit: false, volumeMin, volumeMax, volumeStep };
  if (/^BIT/.test(u)) return { tickSize: 20, digits: 0, isTickCountUnit: false, volumeMin, volumeMax, volumeStep };
  if (/^CCM/.test(u)) return { tickSize: 0.01, digits: 2, isTickCountUnit: true, volumeMin, volumeMax, volumeStep };
  if (/^(BGI|ICF)/.test(u)) return { tickSize: 0.05, digits: 2, isTickCountUnit: true, volumeMin, volumeMax, volumeStep };
  if (refPrice > 0 && refPrice < 500) return { tickSize: 0.01, digits: 2, isTickCountUnit: true, volumeMin, volumeMax, volumeStep };
  return { tickSize: 0.01, digits: 2, isTickCountUnit: true, volumeMin, volumeMax, volumeStep };
}

export function snapVolumeToLot(rawVolume: number, spec: Pick<SymbolTickSpec, "volumeMin" | "volumeMax" | "volumeStep">): number {
  const step = spec.volumeStep > 0 ? spec.volumeStep : 1;
  const min = spec.volumeMin > 0 ? spec.volumeMin : step;
  const max = spec.volumeMax >= min ? spec.volumeMax : 1000000;
  const v = Number.isFinite(rawVolume) && rawVolume > 0 ? rawVolume : min;
  const steps = Math.max(1, Math.round((v - min) / step));
  const snapped = Math.min(max, Math.max(min, min + steps * step));
  const decimals = step < 1 ? Math.max(1, String(step).split(".")[1]?.length || 2) : 0;
  return Number(snapped.toFixed(decimals));
}

export function snapPriceToTick(rawPrice: number, tickSize: number, digits: number): number {
  const step = tickSize > 0 ? tickSize : 0.01;
  const snapped = Math.round(rawPrice / step) * step;
  return Number(snapped.toFixed(Math.max(0, digits)));
}

function buildSlTp(
  symbol: string,
  side: "COMPRA" | "VENDA",
  refPrice: number,
  stopPoints: number,
  takePoints: number,
  brokerSpec?: { tickSize?: number; digits?: number } | null
): { sl?: number; tp?: number } {
  const spec = resolveSymbolTickSpec(symbol, refPrice, brokerSpec);
  const rawSlDist = stopPoints > 0 ? (spec.isTickCountUnit ? stopPoints * spec.tickSize : stopPoints) : 0;
  const rawTpDist = takePoints > 0 ? (spec.isTickCountUnit ? takePoints * spec.tickSize : takePoints) : 0;
  const slDist = rawSlDist > 0 ? Math.max(spec.tickSize, Math.round(rawSlDist / spec.tickSize) * spec.tickSize) : 0;
  const tpDist = rawTpDist > 0 ? Math.max(spec.tickSize, Math.round(rawTpDist / spec.tickSize) * spec.tickSize) : 0;

  if (side === "COMPRA") {
    return {
      sl: slDist > 0 ? snapPriceToTick(refPrice - slDist, spec.tickSize, spec.digits) : undefined,
      tp: tpDist > 0 ? snapPriceToTick(refPrice + tpDist, spec.tickSize, spec.digits) : undefined,
    };
  }
  return {
    sl: slDist > 0 ? snapPriceToTick(refPrice + slDist, spec.tickSize, spec.digits) : undefined,
    tp: tpDist > 0 ? snapPriceToTick(refPrice - tpDist, spec.tickSize, spec.digits) : undefined,
  };
}

export function evaluateManagedRobot(input: {
  robot: PersistedManagedRobot;
  candles: NormalizedCandle[];
  resolvedSymbol: string;
  openPosition: EngineOpenPosition | null;
  dailyPnlBrl: number;
  hasPendingCommand: boolean;
  brokerSpec?: { tickSize?: number; digits?: number; volumeMin?: number; volumeMax?: number; volumeStep?: number } | null;
  now?: Date;
  overrideHHMM?: string;
}): EngineEvaluationResult {
  const { robot, candles, resolvedSymbol, openPosition, dailyPnlBrl, hasPendingCommand } = input;
  const hhmm = input.overrideHHMM || getBrtHHMM(input.now ?? new Date());
  if (robot.strategyType === "wdo_opening_zones") { return evaluateWdoOpeningZones({ ...input, hhmm }); }

  if (!Array.isArray(candles) || candles.length < 5) {
    return { decision: `Aguardando historico de candles (${candles?.length ?? 0} velas)`, directive: null, overlays: [] };
  }

  const closed = candles.slice(0, -1);
  const lastClosed = closed.at(-1)!;
  const prevClosed = closed.at(-2)!;
  const formingCandle = candles.at(-1)!;
  const lastBarTime = Number(lastClosed.time || lastClosed.index || 0);
  const refPrice = formingCandle.close || lastClosed.close;

  const overlays: EngineOverlayLine[] = [];
  let rawTrigger: "BULLISH" | "BEARISH" | null = null;
  let signalDetail = "";

  if (robot.strategyType === "ema_cross") {
    const maType = String(robot.params.maType || "EMA").toUpperCase() === "SMA" ? "SMA" : "EMA";
    const fastP = Math.max(2, Number(robot.params.fastPeriod) || 9);
    const slowP = Math.max(fastP + 1, Number(robot.params.slowPeriod) || 21);
    const closes = candles.map((c) => c.close);
    const fastSeries = maType === "SMA" ? calcSmaSeries(closes, fastP) : calcEmaSeries(closes, fastP);
    const slowSeries = maType === "SMA" ? calcSmaSeries(closes, slowP) : calcEmaSeries(closes, slowP);
    overlays.push(
      { id: `${robot.id}_fast`, label: `${maType} ${fastP}`, color: "#38BDF8", values: fastSeries },
      { id: `${robot.id}_slow`, label: `${maType} ${slowP}`, color: "#F59E0B", values: slowSeries }
    );
    const fPrev = fastSeries.at(closed.length - 2);
    const sPrev = slowSeries.at(closed.length - 2);
    const fLast = fastSeries.at(closed.length - 1);
    const sLast = slowSeries.at(closed.length - 1);
    if (fPrev != null && sPrev != null && fLast != null && sLast != null) {
      if (fPrev <= sPrev && fLast > sLast) { rawTrigger = "BULLISH"; signalDetail = `Cruzamento alta ${maType}(${fastP}=${fLast.toFixed(1)}) > ${maType}(${slowP}=${sLast.toFixed(1)})`; }
      else if (fPrev >= sPrev && fLast < sLast) { rawTrigger = "BEARISH"; signalDetail = `Cruzamento baixa ${maType}(${fastP}=${fLast.toFixed(1)}) < ${maType}(${slowP}=${sLast.toFixed(1)})`; }
      else { signalDetail = `Sem cruzamento (${maType}${fastP}=${fLast.toFixed(1)} | ${maType}${slowP}=${sLast.toFixed(1)})`; }
    } else {
      signalDetail = `Calculando medias (${closed.length}/${slowP} velas)`;
    }
  } else if (robot.strategyType === "rsi_reversal") {
    const rsiP = Math.max(2, Number(robot.params.rsiPeriod) || 14);
    const oversold = Number(robot.params.oversold) || 30;
    const overbought = Number(robot.params.overbought) || 70;
    const rsiSeries = calcRsiSeries(candles.map((c) => c.close), rsiP);
    const rPrev = rsiSeries.at(closed.length - 2);
    const rLast = rsiSeries.at(closed.length - 1);
    if (rPrev != null && rLast != null) {
      if (rPrev < oversold && rLast >= oversold) { rawTrigger = "BULLISH"; signalDetail = `IFR(${rsiP}) saiu de sobrevenda (${rPrev.toFixed(1)} -> ${rLast.toFixed(1)})`; }
      else if (rPrev > overbought && rLast <= overbought) { rawTrigger = "BEARISH"; signalDetail = `IFR(${rsiP}) saiu de sobrecompra (${rPrev.toFixed(1)} -> ${rLast.toFixed(1)})`; }
      else { signalDetail = `IFR(${rsiP}) neutro em ${rLast.toFixed(1)} (faixa ${oversold}-${overbought})`; }
    } else {
      signalDetail = `Calculando IFR(${rsiP})`;
    }
  } else if (robot.strategyType === "breakout") {
    const lookback = Math.max(2, Number(robot.params.lookbackBars) || 10);
    const upperSeries: Array<number | null> = new Array(candles.length).fill(null);
    const lowerSeries: Array<number | null> = new Array(candles.length).fill(null);
    for (let idx = lookback; idx < candles.length; idx++) {
      const sliceWin = candles.slice(idx - lookback, idx);
      upperSeries[idx] = Math.max(...sliceWin.map((b) => b.high));
      lowerSeries[idx] = Math.min(...sliceWin.map((b) => b.low));
    }
    overlays.push(
      { id: `${robot.id}_ch_high`, label: `Canal Sup (${lookback}v)`, color: "#38BDF8", dashed: true, values: upperSeries },
      { id: `${robot.id}_ch_low`, label: `Canal Inf (${lookback}v)`, color: "#F59E0B", dashed: true, values: lowerSeries }
    );
    if (closed.length > lookback + 1) {
      const win = closed.slice(-(lookback + 1), -1);
      const highest = Math.max(...win.map((b) => b.high));
      const lowest = Math.min(...win.map((b) => b.low));
      if (prevClosed.close <= highest && lastClosed.close > highest) { rawTrigger = "BULLISH"; signalDetail = `Rompimento maxima ${lookback} velas (${lastClosed.close} > ${highest})`; }
      else if (prevClosed.close >= lowest && lastClosed.close < lowest) { rawTrigger = "BEARISH"; signalDetail = `Rompimento minima ${lookback} velas (${lastClosed.close} < ${lowest})`; }
      else { signalDetail = `Dentro do canal ${lookback}v [${lowest} .. ${highest}]`; }
    } else {
      signalDetail = `Aguardando ${lookback + 2} velas para canal`;
    }
  }

  if (hasPendingCommand) return { decision: "Comando em execucao no MT5 · aguardando ACK", directive: null, overlays };

  if (robot.risk.closeTime && hhmm >= robot.risk.closeTime && openPosition) {
    return { decision: `Zeragem por horario (${hhmm} >= ${robot.risk.closeTime})`, overlays, directive: { type: "CLOSE_MAGIC", symbol: resolvedSymbol, magicNumber: robot.magicNumber, barTime: lastBarTime, reason: `Zeragem compulsoria ${robot.risk.closeTime}` } };
  }
  if (robot.risk.maxDailyLossBrl > 0 && dailyPnlBrl <= -Math.abs(robot.risk.maxDailyLossBrl) && openPosition) {
    return { decision: `Stop diario atingido (R$ ${dailyPnlBrl.toFixed(2)})`, overlays, directive: { type: "CLOSE_MAGIC", symbol: resolvedSymbol, magicNumber: robot.magicNumber, barTime: lastBarTime, reason: `Stop diario R$ ${dailyPnlBrl.toFixed(2)}` } };
  }
  if ((robot.risk.startTime && hhmm < robot.risk.startTime) || (robot.risk.endTime && hhmm > robot.risk.endTime)) {
    return { decision: `Fora da janela operacional (${hhmm} | ${robot.risk.startTime}-${robot.risk.endTime})`, directive: null, overlays };
  }
  if (robot.risk.maxDailyLossBrl > 0 && dailyPnlBrl <= -Math.abs(robot.risk.maxDailyLossBrl)) {
    return { decision: `Bloqueado: limite de perda diaria atingido (R$ ${dailyPnlBrl.toFixed(2)})`, directive: null, overlays };
  }
  const mapAction = (act: unknown, def: "BUY" | "SELL"): "COMPRA" | "VENDA" | null => {
    const v = String(act || def).toUpperCase();
    if (v === "BUY" || v === "COMPRA") return "COMPRA";
    if (v === "SELL" || v === "VENDA") return "VENDA";
    return null;
  };
  const rawSignal: "COMPRA" | "VENDA" | null =
    rawTrigger === "BULLISH"
      ? mapAction(robot.params.onBullishSignal, "BUY")
      : rawTrigger === "BEARISH"
        ? mapAction(robot.params.onBearishSignal, "SELL")
        : null;

  if (rawTrigger && !rawSignal) {
    return { decision: `[${hhmm}] ${signalDetail} (gatilho configurado como Ignorar)`, directive: null, overlays };
  }
  if (!rawSignal) return { decision: `[${hhmm}] ${signalDetail}`, directive: null, overlays };
  if (lastBarTime > 0 && robot.lastSignalBar === lastBarTime) return { decision: `[${hhmm}] Sinal ${rawSignal} ja executado neste candle`, directive: null, overlays };
  if (openPosition && openPosition.side === rawSignal) return { decision: `[${hhmm}] Posicionado em ${rawSignal} · mantendo`, directive: null, overlays };

  if (openPosition && openPosition.side !== rawSignal) {
    if (robot.risk.reverseOnOpposite) {
      return { decision: `[${hhmm}] Reversao (${openPosition.side} -> ${rawSignal}): encerrando posicao atual`, overlays, directive: { type: "CLOSE_MAGIC", symbol: resolvedSymbol, magicNumber: robot.magicNumber, barTime: lastBarTime, reason: `Reversao de sinal: ${signalDetail}` } };
    }
    return { decision: `[${hhmm}] Sinal ${rawSignal} ignorado (ja posicionado em ${openPosition.side})`, directive: null, overlays };
  }

  const spec = resolveSymbolTickSpec(resolvedSymbol, refPrice, input.brokerSpec);
  const safeVolume = snapVolumeToLot(Number(robot.risk.volume) || spec.volumeMin, spec);
  const { sl, tp } = buildSlTp(resolvedSymbol, rawSignal, refPrice, robot.risk.stopPoints, robot.risk.takePoints, input.brokerSpec);
  return {
    decision: `[${hhmm}] ORDEM ${rawSignal}: ${signalDetail}`,
    overlays,
    directive: { type: "OPEN_ORDER", symbol: resolvedSymbol, magicNumber: robot.magicNumber, side: rawSignal, volume: safeVolume, sl, tp, barTime: lastBarTime, reason: signalDetail },
  };
}
