import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, ColorType, CrosshairMode, LineStyle, createChart, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { ExecutedTrade } from '../types/trading';
import { formatBrl } from '../utils/tradingMath';

interface EquityBaselineChartProps {
  todayTrades: ExecutedTrade[];
  historyTrades: ExecutedTrade[];
  floatingPnlBrl: number;
}

function parseTradeTimestamp(tr: ExecutedTrade, idx: number, fallbackDayIso: string, useEntry = false): UTCTimestamp {
  const rawDate = ((useEntry ? tr.entryDate : tr.exitDate) || tr.exitDate || tr.entryDate || '').trim();
  const rawTime = ((useEntry ? tr.entryTime : tr.exitTime) || tr.exitTime || tr.entryTime || '09:00:00').trim();
  let isoDate = fallbackDayIso;

  const ymd = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(rawDate);
  const dmy = /^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/.exec(rawDate);
  const dm = /^(\d{2})[.\-/](\d{2})$/.exec(rawDate);

  if (ymd) isoDate = `${ymd.at(1)}-${ymd.at(2)}-${ymd.at(3)}`;
  else if (dmy) isoDate = `${dmy.at(3)}-${dmy.at(2)}-${dmy.at(1)}`;
  else if (dm) isoDate = `${fallbackDayIso.slice(0, 4)}-${dm.at(2)}-${dm.at(1)}`;

  const timePart = rawTime.length === 5 ? `${rawTime}:00` : rawTime.length >= 8 ? rawTime.slice(0, 8) : '09:00:00';
  const parsed = Date.parse(`${isoDate}T${timePart}Z`);
  const baseSec = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.parse(`${fallbackDayIso}T09:00:00Z`) / 1000);
  return (baseSec + idx) as UTCTimestamp;
}

export function EquityBaselineChart({ todayTrades, historyTrades, floatingPnlBrl }: EquityBaselineChartProps) {
  const [mode, setMode] = useState<'today' | 'history'>('today');
  const [hoverInfo, setHoverInfo] = useState<{ val: number; label: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const labelMapRef = useRef<Map<number, string>>(new Map());
  const modeRef = useRef<'today' | 'history'>(mode);
  const tzOffsetSec = new Date().getTimezoneOffset() * 60;
  const sessionStartSecRef = useRef<number>(Math.floor((Date.now() / 1000 - tzOffsetSec) / 60) * 60);
  const fallbackDayIsoRef = useRef<string>(new Date(Date.now() - tzOffsetSec * 1000).toISOString().slice(0, 10));

  modeRef.current = mode;

  const points = useMemo(() => {
    const src = mode === 'today' ? [...todayTrades] : [...historyTrades];
    src.sort((a, b) => `${a.exitDate ?? ''} ${a.exitTime}`.localeCompare(`${b.exitDate ?? ''} ${b.exitTime}`));
    let acc = 0;
    let lastTs = 0;
    const list: { time: UTCTimestamp; value: number; label: string }[] = [];

    if (src.length > 0) {
      const first = src.at(0)!;
      const firstExitTs = parseTradeTimestamp(first, 0, fallbackDayIsoRef.current, false) as number;
      const rawEntryTs = parseTradeTimestamp(first, 0, fallbackDayIsoRef.current, true) as number;
      const startTs = rawEntryTs < firstExitTs ? rawEntryTs : firstExitTs - 60;
      const startLbl = first.entryTime ? `Início (${first.entryTime.slice(0, 5)})` : 'Início';
      list.push({ time: startTs as UTCTimestamp, value: 0, label: startLbl });
      lastTs = startTs;
    }

    src.forEach((tr, i) => {
      acc = Number((acc + tr.pnlBrl).toFixed(2));
      let ts = parseTradeTimestamp(tr, i, fallbackDayIsoRef.current, false) as number;
      if (ts <= lastTs) ts = lastTs + 60;
      lastTs = ts;
      const lbl = tr.exitDate ? `${tr.exitDate} ${tr.exitTime}` : `${tr.exitTime} (#${i + 1})`;
      list.push({ time: ts as UTCTimestamp, value: acc, label: lbl });
    });

    if (floatingPnlBrl !== 0 || list.length === 0) {
      if (list.length === 0) {
        const baseTs = sessionStartSecRef.current - 60;
        list.push({ time: baseTs as UTCTimestamp, value: 0, label: 'Início' });
        lastTs = baseTs;
      }
      const openTs = (lastTs > 0 ? lastTs + 60 : sessionStartSecRef.current) as UTCTimestamp;
      list.push({ time: openTs, value: Number((acc + floatingPnlBrl).toFixed(2)), label: 'Posição Aberta' });
    }
    return list;
  }, [mode, todayTrades, historyTrades, floatingPnlBrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: Math.max(el.clientWidth, 300),
      height: 230,
      layout: { background: { type: ColorType.Solid, color: '#090D12' }, textColor: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      localization: {
        locale: 'pt-BR',
        timeFormatter: (t: number) => {
          const s = labelMapRef.current.get(t);
          if (s) return s;
          const d = new Date(t * 1000);
          return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
        },
      },
      grid: { vertLines: { color: '#141B24' }, horzLines: { color: '#141B24' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E293B', scaleMargins: { top: 0.14, bottom: 0.14 } },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: number) => {
          const s = labelMapRef.current.get(t) ?? '';
          if (!s) return '';
          if (modeRef.current === 'today') {
            const m = s.match(/(\d{2}:\d{2})/);
            return m ? m.at(1) ?? '' : s.slice(0, 5);
          }
          const d = s.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
          if (d) return `${d.at(3)}/${d.at(2)}`;
          const d2 = s.match(/(\d{2})[.\-/](\d{2})/);
          return d2 ? `${d2.at(1)}/${d2.at(2)}` : s.slice(0, 5);
        },
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
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    series.createPriceLine({ price: 0, color: '#475569', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setHoverInfo(null); return; }
      const d = param.seriesData.get(series) as { value?: number } | undefined;
      if (d && typeof d.value === 'number') setHoverInfo({ val: d.value, label: labelMapRef.current.get(param.time as number) ?? '' });
      else setHoverInfo(null);
    });

    const applyChartTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue('--color-canvas').trim() || '#090D12';
      const txt = cs.getPropertyValue('--color-text-secondary').trim() || '#94A3B8';
      const brd = cs.getPropertyValue('--color-border-subtle').trim() || '#1E293B';
      const prof = cs.getPropertyValue('--color-profit').trim() || '#10B981';
      const loss = cs.getPropertyValue('--color-loss').trim() || '#F43F5E';
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: bg }, textColor: txt },
        rightPriceScale: { borderColor: brd },
        timeScale: { borderColor: brd },
      });
      series.applyOptions({ topLineColor: prof, bottomLineColor: loss });
    };
    applyChartTheme();
    window.addEventListener('painel-theme-change', applyChartTheme);
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current && containerRef.current.clientWidth > 0) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        chartRef.current.timeScale().fitContent();
      }
    });
    ro.observe(el);
    return () => {
      window.removeEventListener('painel-theme-change', applyChartTheme);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    labelMapRef.current = new Map<number, string>(points.map((pt) => [pt.time as number, pt.label]));
    chart.applyOptions({ timeScale: { timeVisible: mode === 'today' } });
    series.setData(points.map((pt) => ({ time: pt.time as Time, value: pt.value })));
    chart.timeScale().fitContent();
  }, [points, mode]);

  const lastVal = points.length > 0 ? points[points.length - 1].value : 0;
  return (
    <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-100">Curva de Resultado</span>
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
