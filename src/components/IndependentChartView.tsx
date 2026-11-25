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
  fetchSymbols,
  loadOrCreateMt5SyncCredentials,
  syncCandlesWithMt5,
} from '../utils/mt5Bridge';
import { SymbolAutocomplete } from './SymbolAutocomplete';
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

const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'D', 'W', 'M'] as const;
type ChartTf = (typeof TIMEFRAMES)[number];
const TF_MINUTES: Record<string, number> = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'H1': 60,
  'D': 1440,
  'W': 10080,
  'M': 43200,
};

const SYMBOLS_CACHE_PREFIX = 'painel_sync_symbols_v1_';

function readCachedSymbols(channelId: string): string[] {
  try {
    const raw = localStorage.getItem(`${SYMBOLS_CACHE_PREFIX}${channelId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { symbols?: unknown };
    return Array.isArray(parsed.symbols)
      ? parsed.symbols.map((s) => String(s)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeCachedSymbols(channelId: string, symbols: string[]) {
  try {
    localStorage.setItem(
      `${SYMBOLS_CACHE_PREFIX}${channelId}`,
      JSON.stringify({ symbols, savedAt: Date.now() })
    );
  } catch {
    // ignora falha de quota/storage
  }
}

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
  const [showEma, setShowEma] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState(false);
  const [subPaneMode, setSubPaneMode] = useState<'volume' | 'rsi' | 'pnl'>('volume');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const loadSeqRef = useRef(0);

  const handleSelectSymbol = (symbol: string) => {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return;
    setSelectedSymbol(upper);
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const { channelId, token } = loadOrCreateMt5SyncCredentials();

    const cached = readCachedSymbols(channelId);
    if (cached.length > 0) setSymbols(cached);

    const loadSymbols = async () => {
      try {
        const list = await fetchSymbols(channelId, token, controller.signal);
        if (!cancelled && list.length > 0) {
          setSymbols(list);
          writeCachedSymbols(channelId, list);
        }
      } catch {
        // ignora falha momentânea; mantém cache/última lista
      }
    };

    loadSymbols();
    const intervalId = window.setInterval(loadSymbols, 30000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, []);

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

    (async () => {
      try {
        const { channelId, token } = loadOrCreateMt5SyncCredentials();
        const result = await syncCandlesWithMt5(
          channelId,
          token,
          selectedSymbol,
          selectedTf,
          { force: reloadToken > 0, signal: controller.signal, isManualRequest: true }
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
    })();

    return () => {
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
        background: { type: ColorType.Solid, color: '#090D12' },
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
      if (total > 300) {
        const viewWindow = selectedTf === 'D' ? 365 : (selectedTf === 'W' ? 1000 : 300);
        chart.timeScale().setVisibleLogicalRange({
          from: total - viewWindow,
          to: total,
        });
      } else {
        chart.timeScale().fitContent();
      }
      initialFitDoneRef.current = true;
    }
  }, [timedCandles, showEma, showVwap, showBollinger, ema9, ema21, vwap, boll]);

  return (
    <div className="flex-1 flex flex-col min-h-0 px-6 py-4 gap-3 overflow-hidden">
      <div className="w-full flex-1 flex flex-col min-h-0 gap-3">
        <div className="shrink-0 flex flex-wrap items-center gap-3">
          <SymbolAutocomplete
            symbols={symbols}
            selectedSymbol={selectedSymbol}
            onSelect={handleSelectSymbol}
            placeholder="Selecione um ativo..."
          />
          {isLoading && (
            <span className="text-[10px] text-blue-400 animate-pulse">Carregando...</span>
          )}
          {manualError && <span className="text-[10px] text-rose-400">{manualError}</span>}

          <div
            role="group"
            aria-label="Tempo gráfico"
            className="flex items-center bg-[#0F141C] border border-[#1E2633] rounded-lg p-0.5"
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
            className="flex items-center gap-1.5 bg-[#0F141C] hover:bg-[#1E2633] border border-[#1E2633] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Solicitar candles atualizados ao MetaTrader 5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Sincronizar MT5
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="shrink-0 px-4 py-2.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3 text-xs min-h-[38px]">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              {(() => {
                const c = (hoveredTime !== null ? candleByTimeMap.get(hoveredTime) : null)
                  ?? manualCandles?.[manualCandles.length - 1];
                if (!c) {
                  return (
                    <span className="font-semibold text-gray-100 font-mono text-[11px]">
                      {selectedSymbol ? `${selectedSymbol} · ${selectedTf}` : 'Mercado'}
                    </span>
                  );
                }
                return (
                  <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                    <span className="font-semibold text-gray-100">
                      {selectedSymbol} · {selectedTf}
                    </span>
                    <span className="text-gray-400">{c.timeLabel}</span>
                    <span className="text-gray-400">
                      A <strong className="text-gray-200">{formatPrice(c.open, selectedSymbol)}</strong>
                    </span>
                    <span className="text-gray-400">
                      Máx <strong className="text-emerald-400">{formatPrice(c.high, selectedSymbol)}</strong>
                    </span>
                    <span className="text-gray-400">
                      Mín <strong className="text-rose-400">{formatPrice(c.low, selectedSymbol)}</strong>
                    </span>
                    <span className="text-gray-400">
                      F <strong className="text-gray-100">{formatPrice(c.close, selectedSymbol)}</strong>
                    </span>
                    <span className="text-gray-400">
                      Vol <strong className="text-gray-200">{c.volume}</strong>
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="flex-1 min-h-[420px] bg-[#090D12] p-1 relative">
            <div ref={containerRef} className="w-full h-full" />
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
