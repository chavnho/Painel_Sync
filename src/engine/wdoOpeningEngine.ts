import type { NormalizedCandle } from "../../types";
import type { PersistedManagedRobot } from "../db/tradesDb";
import type { EngineEvaluationResult, EngineOpenPosition, EngineOverlayLine } from "./robotEngine";
import { resolveSymbolTickSpec, snapPriceToTick, snapVolumeToLot } from "./robotEngine";

function calcEma(closes: Array<number>, period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes.at(i)! * k + ema * (1 - k);
  return Number(ema.toFixed(4));
}

function calcRsi(closes: Array<number>, period: number): number | null {
  if (closes.length <= period) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes.at(i)! - closes.at(i - 1)!;
    if (d >= 0) g += d; else l += -d;
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes.at(i)! - closes.at(i - 1)!;
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return Number((al === 0 ? 100 : 100 - 100 / (1 + ag / al)).toFixed(2));
}

function aggregateBucket(candles: Array<NormalizedCandle>, sec: number): Array<NormalizedCandle> {
  const out = new Array<NormalizedCandle>();
  let cur = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles.at(i)!;
    const t = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
    const b = Math.floor(t / sec);
    if (b !== cur || out.length === 0) {
      cur = b;
      out.push({ index: out.length, timeLabel: "", time: b * sec, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
    } else {
      const last = out.at(-1)!;
      if (c.high > last.high) last.high = c.high;
      if (c.low < last.low) last.low = c.low;
      last.close = c.close;
    }
  }
  return out;
}
export function evaluateWdoOpeningZones(input: {
  robot: PersistedManagedRobot;
  candles: Array<NormalizedCandle>;
  resolvedSymbol: string;
  openPosition: EngineOpenPosition | null;
  dailyPnlBrl: number;
  hasPendingCommand: boolean;
  brokerSpec?: { tickSize?: number; digits?: number; volumeMin?: number; volumeMax?: number; volumeStep?: number } | null;
  hhmm: string;
}): EngineEvaluationResult {
  const { robot, candles, resolvedSymbol, openPosition, dailyPnlBrl, hasPendingCommand, hhmm } = input;
  const spec = resolveSymbolTickSpec(resolvedSymbol, candles.at(-1)?.close ?? 5000, input.brokerSpec);
  const tick = spec.tickSize > 0 ? spec.tickSize : 0.5;
  const chPts = Math.max(1, Number(robot.params.channelPoints) || 7);
  const rsiP = Math.max(2, Number(robot.params.rsiPeriod) || 7);
  const z1Min = Number(robot.params.z1RsiMin) || 86, z1Max = Number(robot.params.z1RsiMax) || 90;
  const z5Min = Number(robot.params.z5RsiMin) || 10, z5Max = Number(robot.params.z5RsiMax) || 16;

  const daysMap = new Map<string, Array<{ idx: number; c: NormalizedCandle }>>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles.at(i)!;
    const ts = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
    const dk = new Date(ts * 1000).toISOString().slice(0, 10);
    const arr = daysMap.get(dk) ?? new Array<{ idx: number; c: NormalizedCandle }>();
    arr.push({ idx: i, c });
    daysMap.set(dk, arr);
  }
  const days = Array.from(daysMap.keys()).sort();
  if (days.length < 2) return { decision: `${hhmm} Aguardando pregao anterior (D-1)`, directive: null, overlays: new Array<EngineOverlayLine>() };

  const todayBars = daysMap.get(days.at(-1)!)!;
  const prevBars = daysMap.get(days.at(-2)!)!;
  const prevHigh = Math.max(...prevBars.map((b) => b.c.high));
  const prevLow = Math.min(...prevBars.map((b) => b.c.low));
  const upLow = Number((prevHigh - chPts).toFixed(spec.digits));
  const dnHigh = Number((prevLow + chPts).toFixed(spec.digits));
  const startIdx = todayBars.at(0)!.idx;

  const overlays = Array.of<EngineOverlayLine>(
    { id: `${robot.id}_max`, label: `Max D-1 (${prevHigh})`, color: "#F43F5E", dashed: false, lineWidth: 1, values: candles.map((_, i) => (i >= startIdx ? prevHigh : null)) },
    { id: `${robot.id}_max7`, label: `Max-${chPts} (${upLow})`, color: "#FB923C", dotted: true, lineWidth: 1, values: candles.map((_, i) => (i >= startIdx ? upLow : null)) },
    { id: `${robot.id}_min7`, label: `Min+${chPts} (${dnHigh})`, color: "#38BDF8", dotted: true, lineWidth: 1, values: candles.map((_, i) => (i >= startIdx ? dnHigh : null)) },
    { id: `${robot.id}_min`, label: `Min D-1 (${prevLow})`, color: "#10B981", dashed: false, lineWidth: 1, values: candles.map((_, i) => (i >= startIdx ? prevLow : null)) }
  );

  const closeTime = robot.risk.closeTime || "17:50";
  const lastBarTime = Number(todayBars.at(-1)!.c.time || todayBars.at(-1)!.idx);
  if (hasPendingCommand) return { decision: `${hhmm} Aguardando ACK MT5`, directive: null, overlays };
  if (closeTime && hhmm >= closeTime && openPosition) return { decision: `${hhmm} Zeragem daytrade (${closeTime})`, overlays, directive: { type: "CLOSE_MAGIC", symbol: resolvedSymbol, magicNumber: robot.magicNumber, barTime: lastBarTime, reason: `Zeragem ${closeTime}` } };
  if (robot.risk.maxDailyLossBrl > 0 && dailyPnlBrl <= -Math.abs(robot.risk.maxDailyLossBrl) && openPosition) return { decision: `${hhmm} Stop diario`, overlays, directive: { type: "CLOSE_MAGIC", symbol: resolvedSymbol, magicNumber: robot.magicNumber, barTime: lastBarTime, reason: "Stop diario" } };
  if (closeTime && hhmm >= closeTime) return { decision: `${hhmm} Fora do horario (>= ${closeTime})`, directive: null, overlays };

  const prior = candles.slice(0, startIdx);
  const h1C = aggregateBucket(prior, 3600).map((b) => b.close);
  const d1C = aggregateBucket(prior, 86400).map((b) => b.close);
  const emas = new Array<{ label: string; val: number }>();
  for (const p of Array.of(13, 17, 21)) {
    const eh = calcEma(h1C, p); if (eh != null) emas.push({ label: `EMA${p} H1`, val: eh });
    const ed = calcEma(d1C, p); if (ed != null) emas.push({ label: `EMA${p} D1`, val: ed });
  }

  const openPrice = todayBars.at(0)!.c.open;
  const zone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5" = openPrice > prevHigh ? "Z1" : openPrice >= upLow ? "Z2" : openPrice > dnHigh ? "Z3" : openPrice >= prevLow ? "Z4" : "Z5";
  let trigIdx = -1, trigSide: "COMPRA" | "VENDA" | null = null, trigPrice = openPrice, trigTag = "", note = `${zone} (${openPrice})`;
  const priorCloses = prior.map((c) => c.close);

  for (let i = 0; i < todayBars.length; i++) {
    const bar = todayBars.at(i)!.c;
    if (i === 0) {
      if (zone === "Z1") {
        const rO = calcRsi(priorCloses.concat(bar.open), rsiP);
        if (rO != null && rO >= z1Max) { note = `Z1: 1A invalidada (IFR ${rO.toFixed(1)} >= ${z1Max}), aguardando 1B`; }
        else {
          const rH = calcRsi(priorCloses.concat(bar.high), rsiP), rC = calcRsi(priorCloses.concat(bar.close), rsiP);
          if (rO != null && rO >= z1Min && rO < z1Max) { trigIdx = 0; trigSide = "VENDA"; trigPrice = bar.open; trigTag = `1A (IFR ${rO.toFixed(1)})`; break; }
          if ((rH != null && rH >= z1Min && rH < z1Max) || (rC != null && rC >= z1Min && rC < z1Max)) { trigIdx = 0; trigSide = "VENDA"; trigPrice = bar.close; trigTag = `1A (IFR ${z1Min}-${z1Max})`; break; }
          note = `Z1: monitorando 1A (IFR ${rC?.toFixed(1) ?? "--"})`;
        }
      } else if (zone === "Z2") {
        const uB = Number((prevHigh + tick).toFixed(spec.digits)), dB = Number((upLow - tick).toFixed(spec.digits));
        if (bar.high >= uB || bar.low <= dB) { trigIdx = 0; trigSide = "VENDA"; trigPrice = bar.high >= uB ? uB : dB; trigTag = "2A (borda canal Max)"; break; }
        note = `Z2: monitorando 2A (${dB}..${uB})`;
      } else if (zone === "Z3") {
        const abv = emas.filter((e) => e.val > openPrice).sort((a, b) => a.val - b.val).at(0);
        const blw = emas.filter((e) => e.val < openPrice).sort((a, b) => b.val - a.val).at(0);
        const hU = abv ? bar.high >= abv.val : false, hD = blw ? bar.low <= blw.val : false;
        if (hU && !hD) { trigIdx = 0; trigSide = "VENDA"; trigPrice = abv!.val; trigTag = `3A (${abv!.label}=${abv!.val})`; break; }
        if (hD && !hU) { trigIdx = 0; trigSide = "COMPRA"; trigPrice = blw!.val; trigTag = `3A (${blw!.label}=${blw!.val})`; break; }
        if (hU && hD) {
          if (bar.close >= openPrice) { trigIdx = 0; trigSide = "VENDA"; trigPrice = abv!.val; trigTag = `3A (${abv!.label})`; }
          else { trigIdx = 0; trigSide = "COMPRA"; trigPrice = blw!.val; trigTag = `3A (${blw!.label})`; }
          break;
        }
        note = `Z3: 3A (Cima:${abv ? abv.label : "-"} | Baixo:${blw ? blw.label : "-"})`;
      } else if (zone === "Z4") {
        const uB = Number((dnHigh + tick).toFixed(spec.digits)), dB = Number((prevLow - tick).toFixed(spec.digits));
        if (bar.high >= uB || bar.low <= dB) { trigIdx = 0; trigSide = "COMPRA"; trigPrice = bar.high >= uB ? uB : dB; trigTag = "4A (borda canal Min)"; break; }
        note = `Z4: monitorando 4A (${dB}..${uB})`;
      } else {
        const rO = calcRsi(priorCloses.concat(bar.open), rsiP);
        if (rO != null && rO <= z5Min) { note = `Z5: 5A invalidada (IFR ${rO.toFixed(1)} <= ${z5Min}), aguardando 5B`; }
        else {
          const rL = calcRsi(priorCloses.concat(bar.low), rsiP), rC = calcRsi(priorCloses.concat(bar.close), rsiP);
          if (rO != null && rO > z5Min && rO <= z5Max) { trigIdx = 0; trigSide = "COMPRA"; trigPrice = bar.open; trigTag = `5A (IFR ${rO.toFixed(1)})`; break; }
          if ((rL != null && rL > z5Min && rL <= z5Max) || (rC != null && rC > z5Min && rC <= z5Max)) { trigIdx = 0; trigSide = "COMPRA"; trigPrice = bar.close; trigTag = `5A (IFR ${z5Min}-${z5Max})`; break; }
          note = `Z5: monitorando 5A (IFR ${rC?.toFixed(1) ?? "--"})`;
        }
      }
    }
    else {
      const pB = todayBars.at(i - 1)!.c;
      if (zone === "Z1" || zone === "Z2") {
        if (bar.high >= pB.high || bar.low <= pB.low) { trigIdx = i; trigSide = "VENDA"; trigPrice = bar.high >= pB.high ? pB.high : pB.low; trigTag = `${zone === "Z1" ? "1B" : "2B"} (rompeu vela ant.)`; break; }
        note = `${zone}: aguardando ${zone === "Z1" ? "1B" : "2B"} (${pB.low}..${pB.high})`;
      } else if (zone === "Z3") {
        if (bar.low <= pB.low) { trigIdx = i; trigSide = "COMPRA"; trigPrice = pB.low; trigTag = `3B (rompeu Min ${pB.low})`; break; }
        if (bar.high >= pB.high) { trigIdx = i; trigSide = "VENDA"; trigPrice = pB.high; trigTag = `3B (rompeu Max ${pB.high})`; break; }
        note = `Z3: aguardando 3B (${pB.low}..${pB.high})`;
      } else {
        if (bar.high >= pB.high || bar.low <= pB.low) { trigIdx = i; trigSide = "COMPRA"; trigPrice = bar.high >= pB.high ? pB.high : pB.low; trigTag = `${zone === "Z4" ? "4B" : "5B"} (rompeu vela ant.)`; break; }
        note = `${zone}: aguardando ${zone === "Z4" ? "4B" : "5B"} (${pB.low}..${pB.high})`;
      }
    }
  }

  if (openPosition) return { decision: `${hhmm} Posicionado ${openPosition.side} (${zone}) | ${trigTag || note}`, directive: null, overlays };
  if (trigIdx >= 0 && trigIdx < todayBars.length - 1) return { decision: `${hhmm} Operacao unica do dia ja consumida (${trigTag})`, directive: null, overlays };
  if (trigIdx === todayBars.length - 1 && trigSide) {
    if (lastBarTime > 0 && robot.lastSignalBar === lastBarTime) return { decision: `${hhmm} Ordem ${trigTag} ja enviada neste candle`, directive: null, overlays };
    const safeVol = snapVolumeToLot(Number(robot.risk.volume) || spec.volumeMin, spec);
    const slPts = Number(robot.risk.stopPoints) > 0 ? Number(robot.risk.stopPoints) : 10;
    const tpPts = Number(robot.risk.takePoints) > 0 ? Number(robot.risk.takePoints) : 6;
    const sl = trigSide === "COMPRA" ? snapPriceToTick(trigPrice - slPts, spec.tickSize, spec.digits) : snapPriceToTick(trigPrice + slPts, spec.tickSize, spec.digits);
    const tp = trigSide === "COMPRA" ? snapPriceToTick(trigPrice + tpPts, spec.tickSize, spec.digits) : snapPriceToTick(trigPrice - tpPts, spec.tickSize, spec.digits);
    return { decision: `${hhmm} ORDEM ${trigSide} ${trigTag} @ ${trigPrice}`, overlays, directive: { type: "OPEN_ORDER", symbol: resolvedSymbol, magicNumber: robot.magicNumber, side: trigSide, volume: safeVol, entryPrice: trigPrice, sl, tp, barTime: lastBarTime, reason: trigTag } };
  }
  return { decision: `${hhmm} ${note}`, directive: null, overlays };
}
