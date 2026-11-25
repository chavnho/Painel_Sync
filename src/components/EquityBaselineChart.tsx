import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, ColorType, CrosshairMode, LineStyle, createChart, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { ExecutedTrade } from '../types/trading';
import { formatBrl } from '../utils/tradingMath';

interface EquityBaselineChartProps {
  todayTrades: ExecutedTrade[];
  historyTrades: ExecutedTrade[];
  floatingPnlBrl: number;
}

function parseTradeTimestamp(tr: ExecutedTrade, idx: number): UTCTimestamp {
  const rawDate = (tr.exitDate || '').trim();
  const rawTime = (tr.exitTime || '09:00:00').trim();
  let isoDate = '2026-01-01';
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) isoDate = rawDate;
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
    const [dd, mm, yyyy] = rawDate.split('/');
    isoDate = `${yyyy}-${mm}-${dd}`;
  } else if (/^\d{2}\/\d{2}$/.test(rawDate)) {
    const [dd, mm] = rawDate.split('/');
    isoDate = `2026-${mm}-${dd}`;
  }
  const timePart = rawTime.length === 5 ? `${rawTime}:00` : rawTime.length >= 8 ? rawTime.slice(0, 8) : '09:00:00';
  const parsed = Date.parse(`${isoDate}T${timePart}Z`);
  const baseSec = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 1767258000;
  return (baseSec + idx) as UTCTimestamp;
}

export function EquityBaselineChart({ todayTrades, historyTrades, floatingPnlBrl }: EquityBaselineChartProps) {
  const [mode, setMode] = useState<'today' | 'history'>('today');
  const [hoverInfo, setHoverInfo] = useState<{ val: number; label: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const points = useMemo(() => {
    const src = mode === 'today' ? [...todayTrades] : [...historyTrades];
    src.sort((a, b) => `${a.exitDate ?? ''} ${a.exitTime}`.localeCompare(`${b.exitDate ?? ''} ${b.exitTime}`));
    let acc = 0;
    let lastTs = 0;
    const list: { time: UTCTimestamp; value: number; label: string }[] = [];
    src.forEach((tr, i) => {
      acc = Number((acc + tr.pnlBrl).toFixed(2));
      let ts = parseTradeTimestamp(tr, i) as number;
      if (ts <= lastTs) ts = lastTs + 60;
      lastTs = ts;
      const lbl = tr.exitDate ? `${tr.exitDate} ${tr.exitTime}` : `${tr.exitTime} (#${i + 1})`;
      list.push({ time: ts as UTCTimestamp, value: acc, label: lbl });
    });
    if (floatingPnlBrl !== 0 || list.length === 0) {
      const openTs = (lastTs > 0 ? lastTs + 60 : 1767258000) as UTCTimestamp;
      list.push({ time: openTs, value: Number((acc + floatingPnlBrl).toFixed(2)), label: 'Posição Aberta' });
    }
    return list;
  }, [mode, todayTrades, historyTrades, floatingPnlBrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const labelMap = new Map<number, string>(points.map((pt) => [pt.time as number, pt.label]));
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 230,
      layout: { background: { type: ColorType.Solid, color: '#090D12' }, textColor: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: '#141B24' }, horzLines: { color: '#141B24' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E293B', scaleMargins: { top: 0.14, bottom: 0.14 } },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: mode === 'today',
        secondsVisible: false,
        tickMarkFormatter: (t: number) => { const s = labelMap.get(t) ?? ''; if (!s) return ''; if (mode === 'today') { const m = s.match(/(\d{2}:\d{2})/); return m ? m[1] : s.slice(0, 5); } const d = s.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/); if (d) return `${d[3]}/${d[2]}`; const d2 = s.match(/(\d{2})[.\-/](\d{2})/); return d2 ? `${d2[1]}/${d2[2]}` : s.slice(0, 5); },
      },
    });
    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#10B981',
      topFillColor1: 'rgba(16, 185, 129, 0.28)',
      topFillColor2: 'rgba(16, 185, 129, 0.02)',
      bottomLineColor: '#F43F5E',
      bottomFillColor1: 'rgba(244, 63, 94, 0.02)',
      bottomFillColor2: 'rgba(244, 63, 94, 0.28)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    series.createPriceLine({ price: 0, color: '#475569', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    series.setData(points.map((pt) => ({ time: pt.time as Time, value: pt.value })));
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setHoverInfo(null); return; }
      const d = param.seriesData.get(series) as { value?: number } | undefined;
      if (d && typeof d.value === 'number') setHoverInfo({ val: d.value, label: labelMap.get(param.time as number) ?? '' });
      else setHoverInfo(null);
    });
    const ro = new ResizeObserver(() => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [points, mode]);

  const lastVal = points.length > 0 ? points[points.length - 1].value : 0;
  return (
    <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-100">Curva de Resultado (TradingView)</span>
          <div className="inline-flex rounded-md bg-[#090D12] p-0.5 border border-[#1E293B] text-[11px]">
            <button type="button" onClick={() => setMode('today')} className={`px-2 py-0.5 rounded cursor-pointer ${mode === 'today' ? 'bg-[#1E293B] text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'}`}>Hoje</button>
            <button type="button" onClick={() => setMode('history')} className={`px-2 py-0.5 rounded cursor-pointer ${mode === 'history' ? 'bg-[#1E293B] text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'}`}>Histórico</button>
          </div>
        </div>
        <span className="font-mono tabular-nums text-slate-300">
          {hoverInfo ? `${hoverInfo.label} • ` : 'Atual: '}
          <strong className={(hoverInfo ? hoverInfo.val : lastVal) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatBrl(hoverInfo ? hoverInfo.val : lastVal)}</strong>
        </span>
      </div>
      <div ref={containerRef} className="w-full h-[230px]" />
    </div>
  );
}
