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
  Maximize2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  DashboardView,
  LiveCandle,
  LiveMarker,
  OpenPosition,
} from '../types/trading';
import {
  loadOrCreateMt5SyncCredentials,
  syncCandlesWithMt5,
} from '../utils/mt5Bridge';
import {
  computeBollinger,
  computeEMA,
  computeRSI,
  computeVWAP,
  formatBrl,
  formatPrice,
} from '../utils/tradingMath';

interface IndependentChartViewProps {
  onNavigate: (view: DashboardView) => void;
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

function buildTimedCandles(rawCandles: LiveCandle[], tfMinutes: number): { candle: LiveCandle; utcTime: UTCTimestamp }[] {
  if (rawCandles.length === 0) return [];

  const allHaveUnix = rawCandles.every(
    (c) => typeof c.time === 'number' && Number.isFinite(c.time) && c.time > 0
  );

  if (allHaveUnix) {
    const out: { candle: LiveCandle; utcTime: UTCTimestamp }[] = [];
    let lastTs = 0;
    for (const c of rawCandles) {
      let ts = Math.floor(c.time as number);
      if (ts <= lastTs) ts = lastTs + Math.max(60, tfMinutes * 60);
      lastTs = ts;
      out.push({ candle: c, utcTime: ts as UTCTimestamp });
    }
    return out;
  }

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

  const out: { candle: LiveCandle; utcTime: UTCTimestamp }[] = [];
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

export function IndependentChartView({
  onNavigate,
}: IndependentChartViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTf, setSelectedTf] = useState<ChartTf>('M5');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [manualCandles, setManualCandles] = useState<LiveCandle[] | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState(false);
  const [subPaneMode, setSubPaneMode] = useState<'volume' | 'rsi' | 'pnl'>('volume');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loadSeqRef = useRef(0);

  const handleSymbolChange = (val: string) => {
    const upper = val.toUpperCase();
    setSearchQuery(val);
    setSelectedSymbol(upper);
    setShowSuggestions(upper !== '');
  };

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

  useEffect(() => {
    if (!selectedSymbol) {
      setManualCandles(null);
      setManualError(null);
      setIsLoading(false);
      return;
    }

    const seq = ++loadSeqRef.current;
    const controller = new AbortController();
    setManualCandles(null);
    setManualError(null);
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const { channelId, token } = loadOrCreateMt5SyncCredentials();
        const result = await syncCandlesWithMt5(
          channelId,
          token,
          selectedSymbol,
          selectedTf,
          { force: reloadToken > 0, signal: controller.signal }
        );

        if (seq !== loadSeqRef.current || controller.signal.aborted) return;

        if (result.length > 0) {
          setManualCandles(result);
        } else {
          setManualError('EA MT5 sem resposta (verifique a conexão)');
        }
      } catch (error) {
        if (seq !== loadSeqRef.current || controller.signal.aborted) return;
        console.error(error);
        setManualError('Erro ao sincronizar com o MT5');
      } finally {
        if (seq === loadSeqRef.current && !controller.signal.aborted) setIsLoading(false);
      }
    }, 700);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedSymbol, selectedTf, reloadToken]);

  const timedCandles = useMemo(
    () => buildTimedCandles(manualCandles ?? [], TF_MINUTES[selectedTf] ?? 5),
    [manualCandles, selectedTf]
  );

  const candleByTimeMap = useMemo(() => {
    const map = new Map<number, LiveCandle>();
    for (const tc of timedCandles) {
      map.set(Number(tc.utcTime), tc.candle);
    }
    return map;
  }, [timedCandles]);

  const allCloses = useMemo(() => timedCandles.map((tc) => tc.candle.close), [timedCandles]);
  const ema9 = useMemo(
    () => (showEma ? computeEMA(allCloses, 9) : []),
    [allCloses, showEma]
  );
  const ema21 = useMemo(
    () => (showEma ? computeEMA(allCloses, 21) : []),
    [allCloses, showEma]
  );
  const vwap = useMemo(
    () => (showVwap ? computeVWAP(timedCandles.map(tc => tc.candle)) : []),
    [timedCandles, showVwap]
  );
  const boll = useMemo(
    () => (showBollinger ? computeBollinger(allCloses, 20, 2) : null),
    [allCloses, showBollinger]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedSymbol) return;

    initialFitDoneRef.current = false;
    const priceFormat = getSymbolPriceFormat(selectedSymbol);

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
  }, [selectedSymbol, selectedTf]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current || timedCandles.length === 0) return;

    candleSeriesRef.current?.setData(
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
  }, [timedCandles, showEma, showVwap, showBollinger, ema9, ema21, vwap, boll]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <div className="flex items-center gap-2 bg-[#11161D] border border-[#222B38] rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-400">Ativo Independente:</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSymbolChange(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Ex: PETR4, WIN..."
                className="bg-transparent border-none focus:outline-none text-sm font-bold text-gray-100 w-32"
              />
              {isLoading && <span className="text-[10px] text-blue-400 animate-pulse">Carregando...</span>}
              {manualError && <span className="text-[10px] text-red-400">{manualError}</span>}
            </div>
            {showSuggestions && selectedSymbol !== '' && (
              <div className="absolute z-50 w-full mt-1 bg-[#11161D] border border-[#222B38] rounded-lg shadow-xl max-h-60 overflow-y-auto">
                <div className="px-3 py-2 text-xs text-gray-400">
                  Dica: Use o seletor para buscar qualquer par disponível no MetaTrader 5.
                </div>
              </div>
            )}
          </div>

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

          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            disabled={!selectedSymbol || isLoading}
            className="flex items-center gap-1.5 bg-[#11161D] hover:bg-[#1E2633] border border-[#222B38] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Solicitar candles atualizados ao MetaTrader 5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Sincronizar MT5
          </button>
        </div>

        <div className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              {manualCandles && (
                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                  <span className="font-semibold text-gray-100">
                    {selectedSymbol} · {selectedTf}
                  </span>
                  <span className="text-gray-400">{manualCandles[0]?.timeLabel}</span>
                  <span className="text-gray-400">
                    A <strong className="text-gray-200">{formatPrice(manualCandles[0]?.open, selectedSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Máx <strong className="text-emerald-400">{formatPrice(manualCandles[0]?.high, selectedSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Mín <strong className="text-red-400">{formatPrice(manualCandles[0]?.low, selectedSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    F <strong className="text-gray-100">{formatPrice(manualCandles[0]?.close, selectedSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Vol <strong className="text-gray-200">{manualCandles[0]?.volume}</strong>
                  </span>
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

          <div className="bg-[#0B0E11] p-1 relative">
            <div ref={containerRef} className="w-full h-[520px]" />
            {(!manualCandles || manualCandles.length === 0) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                <CandlestickChart className="w-7 h-7 text-gray-500" />
                <p className="text-xs text-gray-400">
                  {isLoading
                    ? `Buscando candles de ${selectedSymbol}...`
                    : manualError
                      ? `Não foi possível carregar ${selectedSymbol}: ${manualError}`
                      : `Nenhum candle disponível para ${selectedSymbol}.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
