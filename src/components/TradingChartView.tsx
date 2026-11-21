import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  CandlestickChart,
  ChevronRight,
  Layers,
  Maximize2,
  TrendingDown,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  DashboardView,
  ExecutedTrade,
  LiveCandle,
  LiveMarker,
  OpenPosition,
  RobotStream,
} from '../types/trading';
import { aggregateCandles } from '../utils/mt5Bridge';
import {
  computeBollinger,
  computeEMA,
  computeRSI,
  computeVWAP,
  formatBrl,
  formatPrice,
} from '../utils/tradingMath';

interface TradingChartViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onNavigate: (view: DashboardView) => void;
}

interface UnifiedMarker extends LiveMarker {
  robotName: string;
}

interface TimedCandle {
  candle: LiveCandle;
  utcTime: UTCTimestamp;
}

const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1'] as const;
type ChartTf = (typeof TIMEFRAMES)[number];

const TF_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
};

function getSymbolPriceFormat(symbol: string): {
  type: 'price';
  precision: number;
  minMove: number;
} {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('WIN') || upper.startsWith('IND') || upper.startsWith('BIT')) {
    return { type: 'price', precision: 0, minMove: 5 };
  }
  if (upper.startsWith('WDO') || upper.startsWith('DOL')) {
    return { type: 'price', precision: 1, minMove: 0.5 };
  }
  return { type: 'price', precision: 2, minMove: 0.01 };
}

function parseHhMm(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(label.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/**
 * Converte candles em timestamps UTC estritamente crescentes para o Lightweight Charts.
 * Usa `c.time` (Unix epoch em segundos enviado pelo PainelSync.mq5) quando disponível,
 * ou reconstrói deterministicamente a partir de `timeLabel` ("HH:MM") mantendo compatibilidade.
 */
function buildTimedCandles(rawCandles: LiveCandle[], tfMinutes: number): TimedCandle[] {
  if (rawCandles.length === 0) return [];

  const allHaveUnix = rawCandles.every(
    (c) => typeof c.time === 'number' && Number.isFinite(c.time) && c.time > 0
  );

  if (allHaveUnix) {
    const out: TimedCandle[] = [];
    let lastTs = 0;
    for (const c of rawCandles) {
      let ts = Math.floor(c.time as number);
      if (ts <= lastTs) ts = lastTs + Math.max(60, tfMinutes * 60);
      lastTs = ts;
      out.push({ candle: c, utcTime: ts as UTCTimestamp });
    }
    return out;
  }

  // Fallback determinístico quando o EA antigo envia apenas "HH:MM"
  const dayOffsets: number[] = [];
  let curDayOffset = 0;
  let prevMins = -1;
  for (let i = 0; i < rawCandles.length; i++) {
    const mins = parseHhMm(rawCandles[i].timeLabel);
    if (mins !== null) {
      if (prevMins >= 0 && mins <= prevMins) {
        curDayOffset += 1;
      }
      prevMins = mins;
    }
    dayOffsets.push(curDayOffset);
  }

  const maxDayOffset = dayOffsets[dayOffsets.length - 1] ?? 0;
  const now = new Date();
  const todayMidnightUtcSec = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
  );

  const out: TimedCandle[] = [];
  let lastTs = 0;
  for (let i = 0; i < rawCandles.length; i++) {
    const c = rawCandles[i];
    const mins = parseHhMm(c.timeLabel);
    const relativeDays = dayOffsets[i] - maxDayOffset;
    let ts =
      mins !== null
        ? todayMidnightUtcSec + relativeDays * 86400 + mins * 60
        : todayMidnightUtcSec + i * Math.max(60, tfMinutes * 60);
    if (ts <= lastTs) {
      ts = lastTs + Math.max(60, tfMinutes * 60);
    }
    lastTs = ts;
    out.push({ candle: c, utcTime: ts as UTCTimestamp });
  }
  return out;
}

export function TradingChartView({
  robots,
  selectedRobotId,
  onNavigate,
}: TradingChartViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTf, setSelectedTf] = useState<ChartTf>('M5');
  const [showEma, setShowEma] = useState<boolean>(true);
  const [showVwap, setShowVwap] = useState<boolean>(true);
  const [showBollinger, setShowBollinger] = useState<boolean>(false);
  const [showMarkers, setShowMarkers] = useState<boolean>(true);
  const [subPaneMode, setSubPaneMode] = useState<'volume' | 'rsi' | 'pnl'>('volume');
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema9SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const subSeriesRef = useRef<ISeriesApi<'Histogram' | 'Line' | 'Area'> | null>(null);
  const subPriceLinesRef = useRef<IPriceLine[]>([]);
  const initialFitDoneRef = useRef<boolean>(false);

  const availableSymbols = useMemo(
    () => Array.from(new Set(robots.map((r) => r.symbol))),
    [robots]
  );

  // Ao selecionar um robô na barra lateral, foca o gráfico único do ativo correspondente
  useEffect(() => {
    if (selectedRobotId !== 'ALL') {
      const found = robots.find((r) => r.robotId === selectedRobotId);
      if (found) {
        setSelectedSymbol(found.symbol);
      }
    }
  }, [selectedRobotId, robots]);

  const activeSymbol = useMemo(() => {
    if (availableSymbols.length === 0) return '';
    if (selectedSymbol && availableSymbols.includes(selectedSymbol)) {
      return selectedSymbol;
    }
    if (selectedRobotId !== 'ALL') {
      const found = robots.find((r) => r.robotId === selectedRobotId);
      if (found) return found.symbol;
    }
    return availableSymbols[0];
  }, [availableSymbols, selectedSymbol, selectedRobotId, robots]);

  // Todos os robôs que operam o ativo ativo compartilham este mesmo gráfico
  const symbolRobots = useMemo(
    () => (activeSymbol ? robots.filter((r) => r.symbol === activeSymbol) : []),
    [robots, activeSymbol]
  );

  // Sincroniza timeframe inicial quando troca de ativo
  useEffect(() => {
    if (!activeSymbol || symbolRobots.length === 0) return;
    const upper = symbolRobots[0].timeframe.toUpperCase() as ChartTf;
    if (TIMEFRAMES.includes(upper)) {
      setSelectedTf(upper);
    } else {
      setSelectedTf('M5');
    }
    setHoveredTime(null);
    initialFitDoneRef.current = false;
  }, [activeSymbol]);

  // Seleciona a melhor série mestre de candles para o ativo + timeframe escolhido
  const { allCandles, masterRobot, isNativeTf } = useMemo<{
    allCandles: LiveCandle[];
    masterRobot: RobotStream | null;
    isNativeTf: boolean;
  }>(() => {
    if (symbolRobots.length === 0) {
      return { allCandles: [], masterRobot: null, isNativeTf: true };
    }
    const tfKey = selectedTf.toUpperCase();
    let bestNative: { candles: LiveCandle[]; robot: RobotStream } | null = null;
    let bestFallback: { candles: LiveCandle[]; robot: RobotStream } | null = null;

    for (const r of symbolRobots) {
      const map = r.candlesByTimeframe;
      if (map && Array.isArray(map[tfKey]) && map[tfKey].length > 0) {
        if (!bestNative || map[tfKey].length > bestNative.candles.length) {
          bestNative = { candles: map[tfKey], robot: r };
        }
        continue;
      }

      if (r.timeframe.toUpperCase() === tfKey && r.candles.length > 0) {
        if (!bestNative || r.candles.length > bestNative.candles.length) {
          bestNative = { candles: r.candles, robot: r };
        }
        continue;
      }

      const baseMin = TF_MINUTES[r.timeframe.toUpperCase()] ?? 5;
      const targetMin = TF_MINUTES[tfKey] ?? 5;
      if (targetMin > baseMin && targetMin % baseMin === 0 && r.candles.length > 0) {
        const agg = aggregateCandles(r.candles, targetMin / baseMin);
        if (!bestNative || agg.length > bestNative.candles.length) {
          bestNative = { candles: agg, robot: r };
        }
        continue;
      }

      if (
        r.candles.length > 0 &&
        (!bestFallback || r.candles.length > bestFallback.candles.length)
      ) {
        bestFallback = { candles: r.candles, robot: r };
      }
    }

    if (bestNative) {
      return {
        allCandles: bestNative.candles,
        masterRobot: bestNative.robot,
        isNativeTf: true,
      };
    }
    if (bestFallback) {
      return {
        allCandles: bestFallback.candles,
        masterRobot: bestFallback.robot,
        isNativeTf: false,
      };
    }
    return { allCandles: [], masterRobot: symbolRobots[0], isNativeTf: false };
  }, [symbolRobots, selectedTf]);

  const timedCandles = useMemo(
    () => buildTimedCandles(allCandles, TF_MINUTES[selectedTf] ?? 5),
    [allCandles, selectedTf]
  );

  const candleByTimeMap = useMemo(() => {
    const map = new Map<number, LiveCandle>();
    for (const tc of timedCandles) {
      map.set(Number(tc.utcTime), tc.candle);
    }
    return map;
  }, [timedCandles]);

  // Indicadores calculados sobre todos os candles disponíveis
  const allCloses = useMemo(() => allCandles.map((c) => c.close), [allCandles]);
  const ema9 = useMemo(
    () => (showEma ? computeEMA(allCloses, 9) : []),
    [allCloses, showEma]
  );
  const ema21 = useMemo(
    () => (showEma ? computeEMA(allCloses, 21) : []),
    [allCloses, showEma]
  );
  const vwap = useMemo(
    () => (showVwap ? computeVWAP(allCandles) : []),
    [allCandles, showVwap]
  );
  const boll = useMemo(
    () => (showBollinger ? computeBollinger(allCloses, 20, 2) : null),
    [allCloses, showBollinger]
  );
  const rsi14 = useMemo(() => computeRSI(allCloses, 14), [allCloses]);

  // Consolida operações e posições de todos os robôs que operam o ativo ativo
  const symbolTrades = useMemo<ExecutedTrade[]>(() => {
    const dedup = new Map<string, ExecutedTrade>();
    for (const r of symbolRobots) {
      for (const tr of r.trades) {
        dedup.set(`${tr.robotId}_${tr.id}`, tr);
      }
    }
    return Array.from(dedup.values()).sort((a, b) =>
      `${a.exitDate || ''} ${a.exitTime}`.localeCompare(
        `${b.exitDate || ''} ${b.exitTime}`
      )
    );
  }, [symbolRobots]);

  const openPositions = useMemo<OpenPosition[]>(
    () =>
      symbolRobots
        .map((r) => r.position)
        .filter((p): p is OpenPosition => p !== null),
    [symbolRobots]
  );

  const totalSymbolDailyPnl = useMemo(
    () => Number(symbolRobots.reduce((acc, r) => acc + r.dailyPnlBrl, 0).toFixed(2)),
    [symbolRobots]
  );

  // Consolida marcadores de compra, venda e saída de todos os robôs do ativo
  const unifiedMarkers = useMemo<UnifiedMarker[]>(() => {
    if (!showMarkers || timedCandles.length === 0) return [];
    const tfUpper = selectedTf.toUpperCase();
    const result: UnifiedMarker[] = [];

    for (const r of symbolRobots) {
      if (r.timeframe.toUpperCase() !== tfUpper) continue;
      for (const m of r.markers) {
        let mappedIdx = m.candleIndex;
        if (r.candles.length !== timedCandles.length) {
          const targetLabel = r.candles[m.candleIndex]?.timeLabel;
          let foundIdx = -1;
          if (targetLabel) {
            for (let k = timedCandles.length - 1; k >= 0; k--) {
              if (timedCandles[k].candle.timeLabel === targetLabel) {
                foundIdx = k;
                break;
              }
            }
          }
          mappedIdx =
            foundIdx >= 0
              ? foundIdx
              : m.candleIndex + (timedCandles.length - r.candles.length);
        }
        if (mappedIdx >= 0 && mappedIdx < timedCandles.length) {
          result.push({
            ...m,
            candleIndex: mappedIdx,
            robotName: r.name,
            label: symbolRobots.length > 1 ? `${m.label} · ${r.name}` : m.label,
          });
        }
      }
    }
    return result;
  }, [showMarkers, timedCandles, selectedTf, symbolRobots]);

  const pnlCurve = useMemo(() => {
    if (symbolRobots.length === 0 || allCandles.length === 0) return [];
    let running = 0;
    let tIdx = 0;
    return allCandles.map((c, idx) => {
      while (tIdx < symbolTrades.length && symbolTrades[tIdx].exitTime <= c.timeLabel) {
        running += symbolTrades[tIdx].pnlBrl;
        tIdx++;
      }
      if (idx === allCandles.length - 1) {
        return totalSymbolDailyPnl;
      }
      return Number(running.toFixed(2));
    });
  }, [symbolRobots.length, allCandles, symbolTrades, totalSymbolDailyPnl]);

  // 1. Inicializa e destrói o gráfico TradingView Lightweight Charts por ativo/timeframe
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeSymbol) return;

    initialFitDoneRef.current = false;
    const priceFormat = getSymbolPriceFormat(activeSymbol);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E11' },
        textColor: '#9CA3AF',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
        panes: {
          separatorColor: '#1E2633',
          separatorHoverColor: '#334155',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: '#131922' },
        horzLines: { color: '#131922' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#475569',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1E293B',
        },
        horzLine: {
          color: '#475569',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1E293B',
        },
      },
      rightPriceScale: {
        borderColor: '#1E2633',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#1E2633',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 3,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#10B981',
        downColor: '#EF4444',
        borderUpColor: '#10B981',
        borderDownColor: '#EF4444',
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
        priceFormat,
      },
      0
    );

    const ema9Series = chart.addSeries(
      LineSeries,
      {
        color: '#38BDF8',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      },
      0
    );

    const ema21Series = chart.addSeries(
      LineSeries,
      {
        color: '#F59E0B',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      },
      0
    );

    const vwapSeries = chart.addSeries(
      LineSeries,
      {
        color: '#C084FC',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      },
      0
    );

    const bbUpSeries = chart.addSeries(
      LineSeries,
      {
        color: '#64748B',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      },
      0
    );

    const bbLowSeries = chart.addSeries(
      LineSeries,
      {
        color: '#64748B',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      },
      0
    );

    const markersPlugin = createSeriesMarkers(candleSeries, []);

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || param.time === undefined || typeof param.time !== 'number') {
        setHoveredTime(null);
        return;
      }
      setHoveredTime(param.time);
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      const pos = chart.timeScale().scrollPosition();
      setIsScrolledAway(pos < -2);
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ema9SeriesRef.current = ema9Series;
    ema21SeriesRef.current = ema21Series;
    vwapSeriesRef.current = vwapSeries;
    bbUpSeriesRef.current = bbUpSeries;
    bbLowSeriesRef.current = bbLowSeries;
    markersPluginRef.current = markersPlugin;
    subSeriesRef.current = null;
    priceLinesRef.current = [];
    subPriceLinesRef.current = [];

    return () => {
      markersPlugin.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ema9SeriesRef.current = null;
      ema21SeriesRef.current = null;
      vwapSeriesRef.current = null;
      bbUpSeriesRef.current = null;
      bbLowSeriesRef.current = null;
      markersPluginRef.current = null;
      subSeriesRef.current = null;
      priceLinesRef.current = [];
      subPriceLinesRef.current = [];
    };
  }, [activeSymbol, selectedTf]);

  // 2. Gerencia a série do sub-painel inferior (Volume / IFR 14 / P&L Dia)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (subSeriesRef.current) {
      for (const pl of subPriceLinesRef.current) {
        subSeriesRef.current.removePriceLine(pl);
      }
      subPriceLinesRef.current = [];
      chart.removeSeries(subSeriesRef.current);
      subSeriesRef.current = null;
    }

    if (subPaneMode === 'volume') {
      subSeriesRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          priceScaleId: 'right',
          lastValueVisible: false,
        },
        1
      );
    } else if (subPaneMode === 'rsi') {
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#38BDF8',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
          lastValueVisible: true,
        },
        1
      );
      subPriceLinesRef.current = [
        rsiSeries.createPriceLine({
          price: 70,
          color: '#475569',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '70',
        }),
        rsiSeries.createPriceLine({
          price: 30,
          color: '#475569',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '30',
        }),
      ];
      subSeriesRef.current = rsiSeries;
    } else {
      const pnlSeries = chart.addSeries(
        AreaSeries,
        {
          lineColor: totalSymbolDailyPnl >= 0 ? '#10B981' : '#EF4444',
          topColor:
            totalSymbolDailyPnl >= 0
              ? 'rgba(16, 185, 129, 0.28)'
              : 'rgba(239, 68, 68, 0.05)',
          bottomColor:
            totalSymbolDailyPnl >= 0
              ? 'rgba(16, 185, 129, 0.02)'
              : 'rgba(239, 68, 68, 0.28)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
          lastValueVisible: true,
        },
        1
      );
      subPriceLinesRef.current = [
        pnlSeries.createPriceLine({
          price: 0,
          color: '#334155',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        }),
      ];
      subSeriesRef.current = pnlSeries;
    }

    const panes = chart.panes();
    if (panes.length >= 2) {
      panes[0].setStretchFactor(0.76);
      panes[1].setStretchFactor(0.24);
    }
  }, [subPaneMode, activeSymbol, selectedTf]);

  // 3. Atualiza os dados em tempo real (candles, indicadores, marcadores, posições e sub-painel)
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || timedCandles.length === 0) return;

    candleSeries.setData(
      timedCandles.map((tc) => ({
        time: tc.utcTime,
        open: tc.candle.open,
        high: tc.candle.high,
        low: tc.candle.low,
        close: tc.candle.close,
      }))
    );

    ema9SeriesRef.current?.setData(
      showEma
        ? timedCandles
            .map((tc, i) =>
              ema9[i] !== null && ema9[i] !== undefined
                ? { time: tc.utcTime, value: ema9[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        : []
    );

    ema21SeriesRef.current?.setData(
      showEma
        ? timedCandles
            .map((tc, i) =>
              ema21[i] !== null && ema21[i] !== undefined
                ? { time: tc.utcTime, value: ema21[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        : []
    );

    vwapSeriesRef.current?.setData(
      showVwap
        ? timedCandles
            .map((tc, i) =>
              vwap[i] !== null && vwap[i] !== undefined
                ? { time: tc.utcTime, value: vwap[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        : []
    );

    bbUpSeriesRef.current?.setData(
      showBollinger && boll
        ? timedCandles
            .map((tc, i) =>
              boll.upper[i] !== null && boll.upper[i] !== undefined
                ? { time: tc.utcTime, value: boll.upper[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        : []
    );

    bbLowSeriesRef.current?.setData(
      showBollinger && boll
        ? timedCandles
            .map((tc, i) =>
              boll.lower[i] !== null && boll.lower[i] !== undefined
                ? { time: tc.utcTime, value: boll.lower[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        : []
    );

    // Marcadores consolidados de todos os robôs no ativo (ordenados por timestamp)
    if (markersPluginRef.current) {
      const seriesMarkers: SeriesMarker<Time>[] = unifiedMarkers
        .map((m) => {
          const tc = timedCandles[m.candleIndex];
          if (!tc) return null;
          if (m.type === 'buy') {
            return {
              time: tc.utcTime,
              position: 'belowBar' as const,
              shape: 'arrowUp' as const,
              color: '#10B981',
              text: symbolRobots.length > 1 ? `C (${m.robotName})` : 'Compra',
            };
          }
          if (m.type === 'sell') {
            return {
              time: tc.utcTime,
              position: 'aboveBar' as const,
              shape: 'arrowDown' as const,
              color: '#EF4444',
              text: symbolRobots.length > 1 ? `V (${m.robotName})` : 'Venda',
            };
          }
          return {
            time: tc.utcTime,
            position: 'inBar' as const,
            shape: 'circle' as const,
            color: '#F59E0B',
            text: symbolRobots.length > 1 ? `S (${m.robotName})` : 'Saída',
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => Number(a.time) - Number(b.time));

      markersPluginRef.current.setMarkers(seriesMarkers);
    }

    // Linhas de preço para todas as posições abertas no ativo (Entrada, SL, TP)
    for (const pl of priceLinesRef.current) {
      candleSeries.removePriceLine(pl);
    }
    const nextPriceLines: IPriceLine[] = [];
    for (const pos of openPositions) {
      const prefix = openPositions.length > 1 ? `${pos.robotName} ` : '';
      if (pos.entryPrice > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.entryPrice,
            color: '#38BDF8',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${prefix}${pos.side} ${pos.volume}x`,
          })
        );
      }
      if (pos.sl > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.sl,
            color: '#EF4444',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${prefix}SL`,
          })
        );
      }
      if (pos.tp > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.tp,
            color: '#10B981',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${prefix}TP`,
          })
        );
      }
    }
    priceLinesRef.current = nextPriceLines;

    // Atualiza dados do sub-painel (Volume / IFR 14 / P&L Dia)
    if (subSeriesRef.current) {
      if (subPaneMode === 'volume') {
        (subSeriesRef.current as ISeriesApi<'Histogram'>).setData(
          timedCandles.map((tc) => ({
            time: tc.utcTime,
            value: tc.candle.volume,
            color:
              tc.candle.close >= tc.candle.open
                ? 'rgba(16, 185, 129, 0.5)'
                : 'rgba(239, 68, 68, 0.5)',
          }))
        );
      } else if (subPaneMode === 'rsi') {
        (subSeriesRef.current as ISeriesApi<'Line'>).setData(
          timedCandles
            .map((tc, i) =>
              rsi14[i] !== null && rsi14[i] !== undefined
                ? { time: tc.utcTime, value: rsi14[i] as number }
                : null
            )
            .filter((d): d is { time: UTCTimestamp; value: number } => d !== null)
        );
      } else {
        const area = subSeriesRef.current as ISeriesApi<'Area'>;
        area.applyOptions({
          lineColor: totalSymbolDailyPnl >= 0 ? '#10B981' : '#EF4444',
          topColor:
            totalSymbolDailyPnl >= 0
              ? 'rgba(16, 185, 129, 0.28)'
              : 'rgba(239, 68, 68, 0.05)',
          bottomColor:
            totalSymbolDailyPnl >= 0
              ? 'rgba(16, 185, 129, 0.02)'
              : 'rgba(239, 68, 68, 0.28)',
        });
        area.setData(
          timedCandles.map((tc, i) => ({
            time: tc.utcTime,
            value: pnlCurve[i] ?? 0,
          }))
        );
      }
    }

    // Na primeira carga do ativo/timeframe, mostra os últimos ~70 candles confortavelmente
    if (!initialFitDoneRef.current) {
      const total = timedCandles.length;
      if (total > 75) {
        chart.timeScale().setVisibleLogicalRange({
          from: total - 70,
          to: total + 4,
        });
      } else {
        chart.timeScale().fitContent();
      }
      initialFitDoneRef.current = true;
    }
  }, [
    timedCandles,
    showEma,
    showVwap,
    showBollinger,
    ema9,
    ema21,
    vwap,
    boll,
    unifiedMarkers,
    openPositions,
    subPaneMode,
    rsi14,
    pnlCurve,
    totalSymbolDailyPnl,
    symbolRobots.length,
  ]);

  const handleZoom = (direction: 'in' | 'out') => {
    const chart = chartRef.current;
    if (!chart) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    const delta = span * 0.22;
    const nextSpan =
      direction === 'in' ? Math.max(10, span - delta) : Math.min(300, span + delta);
    chart.timeScale().setVisibleLogicalRange({
      from: range.to - nextSpan,
      to: range.to,
    });
  };

  const handleFitContent = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
  };

  const handleScrollLive = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().scrollToRealTime();
  };

  const activeCandle = useMemo(() => {
    if (hoveredTime !== null) {
      const found = candleByTimeMap.get(hoveredTime);
      if (found) return found;
    }
    return allCandles.length > 0 ? allCandles[allCandles.length - 1] : null;
  }, [hoveredTime, candleByTimeMap, allCandles]);

  const hoveredMarkers = useMemo(() => {
    if (hoveredTime === null) return [];
    return unifiedMarkers.filter((m) => {
      const tc = timedCandles[m.candleIndex];
      return tc && Number(tc.utcTime) === hoveredTime;
    });
  }, [hoveredTime, unifiedMarkers, timedCandles]);

  if (!activeSymbol || symbolRobots.length === 0 || allCandles.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#11161D] border border-[#222B38] p-8 text-center space-y-3">
          <CandlestickChart className="w-7 h-7 text-gray-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-gray-100">
            Nenhum gráfico disponível ainda
          </h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            Conecte seu MetaTrader 5 para visualizar o gráfico único por ativo no padrão TradingView com candles interativos, timeframes, zoom e marcações de todos os robôs em tempo real.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('connect')}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            Conectar MetaTrader 5
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Barra Superior de Controles do Gráfico Único por Ativo */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Selecionar ativo do gráfico"
              value={activeSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-[#11161D] border border-[#263040] focus:border-emerald-500 focus:outline-none rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-100 cursor-pointer"
            >
              {availableSymbols.map((sym) => {
                const count = robots.filter((r) => r.symbol === sym).length;
                return (
                  <option key={sym} value={sym}>
                    {sym} ({count} {count === 1 ? 'robô' : 'robôs'})
                  </option>
                );
              })}
            </select>

            {/* Seletor de Tempo Gráfico (M1 / M5 / M15 / H1) */}
            <div
              role="group"
              aria-label="Tempo gráfico"
              className="flex items-center bg-[#11161D] border border-[#222B38] rounded-lg p-0.5"
            >
              {TIMEFRAMES.map((tf) => {
                const active = selectedTf === tf;
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setSelectedTf(tf)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#1F2937] text-gray-100'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>

            <div className="text-xs text-gray-400 hidden sm:block truncate max-w-md">
              <span className="text-gray-500">Consolidando:</span>{' '}
              <span className="text-gray-300">
                {symbolRobots.map((r) => r.name).join(' · ')}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Toggles de Indicadores */}
            <div className="flex items-center bg-[#11161D] border border-[#222B38] rounded-lg p-0.5 gap-0.5">
              {[
                { label: 'EMAs 9/21', active: showEma, toggle: () => setShowEma((v) => !v) },
                { label: 'VWAP', active: showVwap, toggle: () => setShowVwap((v) => !v) },
                { label: 'Bollinger', active: showBollinger, toggle: () => setShowBollinger((v) => !v) },
                { label: 'Sinais C/V', active: showMarkers, toggle: () => setShowMarkers((v) => !v) },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={btn.toggle}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    btn.active
                      ? 'bg-[#1F2937] text-gray-100'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Controles de Zoom e Ajuste */}
            <div className="flex items-center bg-[#11161D] border border-[#222B38] rounded-lg p-0.5">
              <button
                type="button"
                title="Aproximar (Zoom In)"
                aria-label="Aproximar gráfico"
                onClick={() => handleZoom('in')}
                className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-[#1F2937] cursor-pointer transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Ajustar tudo na tela"
                aria-label="Ajustar gráfico"
                onClick={handleFitContent}
                className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-[#1F2937] cursor-pointer transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Afastar (Zoom Out)"
                aria-label="Afastar gráfico"
                onClick={() => handleZoom('out')}
                className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-[#1F2937] cursor-pointer transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {isScrolledAway && (
              <button
                type="button"
                onClick={handleScrollLive}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ao Vivo</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Painel do Gráfico Principal (TradingView Lightweight Charts) */}
        <div className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          {/* Barra OHLC & Seletor de Sub-painel */}
          <div className="px-4 py-2.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              {activeCandle && (
                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                  <span className="font-semibold text-gray-100">
                    {activeSymbol} · {selectedTf}
                  </span>
                  <span className="text-gray-400">{activeCandle.timeLabel}</span>
                  <span className="text-gray-400">
                    A <strong className="text-gray-200">{formatPrice(activeCandle.open, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Máx <strong className="text-emerald-400">{formatPrice(activeCandle.high, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Mín <strong className="text-red-400">{formatPrice(activeCandle.low, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    F <strong className="text-gray-100">{formatPrice(activeCandle.close, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Vol <strong className="text-gray-200">{activeCandle.volume}</strong>
                  </span>
                  {!isNativeTf && masterRobot && (
                    <span className="font-sans text-amber-400">
                      · Base {masterRobot.timeframe}
                    </span>
                  )}
                  {hoveredMarkers.map((m, idx) => (
                    <span
                      key={idx}
                      className={`font-sans font-semibold ${
                        m.type === 'buy'
                          ? 'text-emerald-400'
                          : m.type === 'sell'
                            ? 'text-red-400'
                            : 'text-amber-300'
                      }`}
                    >
                      · {m.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center bg-[#0B0E11] border border-[#222B38] rounded-md p-0.5">
              {(
                [
                  { id: 'volume', label: 'Volume' },
                  { id: 'pnl', label: 'P&L Dia (R$)' },
                  { id: 'rsi', label: 'IFR (14)' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubPaneMode(tab.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    subPaneMode === tab.id
                      ? 'bg-[#1F2937] text-gray-100'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Container HTML5 Canvas do Lightweight Charts (Pane 0: Preço + Overlays, Pane 1: Sub-painel) */}
          <div className="bg-[#0B0E11] p-1">
            <div ref={containerRef} className="w-full h-[520px]" />
          </div>
        </div>

        {/* Faixa de Posições Abertas e Últimas Execuções do Ativo */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl bg-[#11161D] border border-[#222B38] p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>
                Posições em {activeSymbol} ({openPositions.length})
              </span>
              <Layers className="w-3.5 h-3.5 text-gray-500" />
            </div>
            {openPositions.length > 0 ? (
              <div className="space-y-2.5">
                {openPositions.map((pos) => (
                  <div
                    key={pos.id}
                    className="space-y-1 border-t border-[#1E2633] pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-mono font-bold ${
                          pos.side === 'COMPRA' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pos.side} {pos.volume}x @ {formatPrice(pos.entryPrice, pos.symbol)}
                      </span>
                      <span
                        className={`text-xs font-mono font-bold tabular-nums ${
                          pos.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(pos.floatingPnlBrl)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-gray-400">
                      {pos.robotName} · SL:{' '}
                      {pos.sl > 0 ? formatPrice(pos.sl, pos.symbol) : '—'} · TP:{' '}
                      {pos.tp > 0 ? formatPrice(pos.tp, pos.symbol) : '—'} ·{' '}
                      {pos.openTime || '—'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm font-mono text-gray-400">
                Zerado (aguardando próximo sinal)
              </div>
            )}
          </div>

          <div className="lg:col-span-2 rounded-xl bg-[#11161D] border border-[#222B38] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">
                Últimas Execuções em {activeSymbol}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('operations')}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                Ver todas ({symbolTrades.length})
              </button>
            </div>
            {symbolTrades.length === 0 ? (
              <div className="text-xs text-gray-500">Nenhuma execução fechada registrada.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {symbolTrades
                  .slice(-4)
                  .reverse()
                  .map((tr) => (
                    <div
                      key={`${tr.robotId}_${tr.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E2633] text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {tr.side === 'COMPRA' ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="font-mono text-gray-200 truncate">
                          {tr.side} · {tr.exitTime}
                          {symbolRobots.length > 1 ? ` · ${tr.robotName}` : ''}
                        </span>
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 ${
                          tr.pnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(tr.pnlBrl)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
