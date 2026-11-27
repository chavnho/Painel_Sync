import { LineStyle } from 'lightweight-charts';
import type { LiveCandle } from '../types/trading';

export interface WdoOverlayLineItem { price: number; color: string; lineStyle: LineStyle; lineWidth: 1 | 2 | 3 | 4; title: string; }
export interface WdoHudState { rsiPeriod: number; rsiVal: number | null; zoneLabel: string; zoneSide: string; h1Emas: Array<WdoOverlayLineItem>; d1Emas: Array<WdoOverlayLineItem>; prevDayFormatted: string; todayDayFormatted: string; }

export function resolveWdoSessionKeys(days: Array<string>, isReplay = false) {
  const lastCandleDayKey = days.at(days.length - 1)!;
  if (isReplay) return { d1Key: days.at(days.length - 2)!, todayKey: lastCandleDayKey, hasTodaySession: true };
  const nowBrtKey = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const hasTodaySession = lastCandleDayKey >= nowBrtKey;
  return { d1Key: hasTodaySession ? days.at(days.length - 2)! : lastCandleDayKey, todayKey: hasTodaySession ? lastCandleDayKey : nowBrtKey, hasTodaySession };
}

export function computeWdoOpeningOverlayLines(candles: Array<LiveCandle>, chPts = 7, h1Candles: Array<LiveCandle> = new Array<LiveCandle>(), d1Candles: Array<LiveCandle> = new Array<LiveCandle>(), isReplay = false): Array<WdoOverlayLineItem> {
  const empty = new Array<WdoOverlayLineItem>();
  if (!Array.isArray(candles) || candles.length < 10) return empty;
  const daysMap = new Map<string, Array<LiveCandle>>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles.at(i)!;
    const ts = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
    const dk = new Date(ts * 1000).toISOString().slice(0, 10);
    const arr = daysMap.get(dk) ?? new Array<LiveCandle>(); arr.push(c); daysMap.set(dk, arr);
  }
  const days = Array.from(daysMap.keys()).sort();
  if (days.length < 2) return empty;
  const { d1Key, todayKey } = resolveWdoSessionKeys(days, isReplay);
  const todayBars = daysMap.get(todayKey) ?? new Array<LiveCandle>();
  const prevBars = daysMap.get(d1Key)!;
  const prevHigh = Math.max(...prevBars.map((b) => b.high));
  const prevLow = Math.min(...prevBars.map((b) => b.low));
  const lines: Array<WdoOverlayLineItem> = [
    { price: prevHigh, color: '#2563EB', lineStyle: LineStyle.Solid, lineWidth: 2, title: 'Max D-1' },
    { price: Number((prevHigh - chPts).toFixed(2)), color: '#2563EB', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'Max-' + chPts },
    { price: Number((prevLow + chPts).toFixed(2)), color: '#2563EB', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'Min+' + chPts },
    { price: prevLow, color: '#2563EB', lineStyle: LineStyle.Solid, lineWidth: 2, title: 'Min D-1' },
  ];
  const firstTodayTs = Number(todayBars.at(0)?.time || 0);
  const prior = firstTodayTs > 0 ? candles.filter((c) => Number(c.time || 0) < firstTodayTs) : candles.slice(0, Math.max(0, candles.length - todayBars.length));
  const aggCloses = (sec: number): Array<number> => {
    const out = new Array<number>(); let cur = -1;
    for (let i = 0; i < prior.length; i++) {
      const c = prior.at(i)!;
      const t = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
      const b = Math.floor(t / sec);
      if (b !== cur || out.length === 0) { cur = b; out.push(c.close); } else { out.splice(out.length - 1, 1, c.close); }
    }
    return out;
  };
  const calcEmaVal = (closes: Array<number>, period: number): number | null => {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes.at(i)! * k + ema * (1 - k);
    return Number(ema.toFixed(2));
  };
  const h1Prior = h1Candles.length > 0 ? h1Candles.filter((c) => firstTodayTs <= 0 || Number(c.time || 0) < firstTodayTs).map((c) => c.close) : aggCloses(3600);
  const d1Prior = d1Candles.length > 0 ? d1Candles.filter((c) => new Date((Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || 0)) * 1000).toISOString().slice(0, 10) < todayKey).map((c) => c.close) : aggCloses(86400);
  for (const p of Array.of(13, 17, 21)) {
    const eh = calcEmaVal(h1Prior, p); if (eh != null) lines.push({ price: eh, color: '#C084FC', lineStyle: LineStyle.Dotted, lineWidth: 2, title: 'EMA' + p + ' H1' });
    const ed = calcEmaVal(d1Prior, p); if (ed != null) lines.push({ price: ed, color: '#22C55E', lineStyle: LineStyle.Dotted, lineWidth: 2, title: 'EMA' + p + ' D1' });
  }
  return lines;
}

export function computeWdoHudState(candles: Array<LiveCandle>, chPts = 7, rsiPeriod = 7, h1Candles: Array<LiveCandle> = new Array<LiveCandle>(), d1Candles: Array<LiveCandle> = new Array<LiveCandle>(), isReplay = false): WdoHudState | null {
  if (!Array.isArray(candles) || candles.length < 10) return null;
  const closes = candles.map((c) => c.close);
  let rsiVal: number | null = null;
  if (closes.length > rsiPeriod) {
    let g = 0, l = 0;
    for (let i = 1; i <= rsiPeriod; i++) { const d = closes.at(i)! - closes.at(i - 1)!; if (d >= 0) g += d; else l += -d; }
    let ag = g / rsiPeriod, al = l / rsiPeriod;
    for (let i = rsiPeriod + 1; i < closes.length; i++) { const d = closes.at(i)! - closes.at(i - 1)!; ag = (ag * (rsiPeriod - 1) + (d > 0 ? d : 0)) / rsiPeriod; al = (al * (rsiPeriod - 1) + (d < 0 ? -d : 0)) / rsiPeriod; }
    rsiVal = Number((al === 0 ? 100 : 100 - 100 / (1 + ag / al)).toFixed(1));
  }
  const daysMap = new Map<string, Array<LiveCandle>>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles.at(i)!;
    const ts = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
    const dk = new Date(ts * 1000).toISOString().slice(0, 10);
    const arr = daysMap.get(dk) ?? new Array<LiveCandle>(); arr.push(c); daysMap.set(dk, arr);
  }
  const days = Array.from(daysMap.keys()).sort();
  let zoneLabel = '', zoneSide = '', prevDayFormatted = '', todayDayFormatted = '';
  if (days.length >= 2) {
    const { d1Key, todayKey } = resolveWdoSessionKeys(days, isReplay);
    todayDayFormatted = todayKey.split('-').reverse().join('/'); prevDayFormatted = d1Key.split('-').reverse().join('/');
    const todayBars = daysMap.get(todayKey); const prevBars = daysMap.get(d1Key)!;
    const prevHigh = Math.max(...prevBars.map((b) => b.high)); const prevLow = Math.min(...prevBars.map((b) => b.low));
    if (todayBars && todayBars.length > 0) {
      const openP = todayBars.at(0)!.open;
      if (openP > prevHigh) { zoneLabel = 'Z1'; zoneSide = 'Venda'; }
      else if (openP >= prevHigh - chPts) { zoneLabel = 'Z2'; zoneSide = 'Venda'; }
      else if (openP > prevLow + chPts) { zoneLabel = 'Z3'; zoneSide = 'Compra/Venda'; }
      else if (openP >= prevLow) { zoneLabel = 'Z4'; zoneSide = 'Compra'; }
      else { zoneLabel = 'Z5'; zoneSide = 'Compra'; }
    } else { zoneLabel = 'Pré-abertura'; zoneSide = 'Aguardando 09:00'; }
  }
  const emaLines = computeWdoOpeningOverlayLines(candles, chPts, h1Candles, d1Candles, isReplay).filter((l) => l.title.startsWith('EMA'));
  return { rsiPeriod, rsiVal, zoneLabel, zoneSide, h1Emas: emaLines.filter((l) => l.title.endsWith('H1')), d1Emas: emaLines.filter((l) => l.title.endsWith('D1')), prevDayFormatted, todayDayFormatted };
}