import { TradeLinesPrimitive, type TradeSegmentItem } from '../utils/tradeLinesPrimitive';
import { INITIAL_CHART_VIEW_BARS, MAX_CHART_CANDLES, getRobotColorTheme } from '../utils/themeTokens';
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
  Bot,
  CandlestickChart,
  ChevronRight,
  Layers,
  Maximize2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  DashboardView,
  ExecutedTrade,
  LiveCandle,
  ManagedRobot,
  LiveMarker,
  OpenPosition,
  PendingOrder,
  RobotStream,
} from '../types/trading';
import {
  aggregateCandles,
  fetchCandles,
  fetchSymbols,
  loadOrCreateMt5SyncCredentials,
  syncCandlesWithMt5,
} from '../utils/mt5Bridge';
import { SymbolAutocomplete } from './SymbolAutocomplete';
import { formatBrl, formatPrice } from '../utils/tradingMath';

interface TradingChartViewProps {
  robots: RobotStream[];
  managedRobots?: ManagedRobot[];
  activeContracts?: Record<string, string>;
  selectedRobotId: string | 'ALL';
  onSelectRobot?: (robotId: string | 'ALL') => void;
  magicColors?: Record<number, number>;
  onNavigate: (view: DashboardView) => void;
}

interface UnifiedMarker extends LiveMarker {
  robotName: string;
}

interface TimedCandle {
  candle: LiveCandle;
  utcTime: UTCTimestamp;
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

function toMt5Timeframe(tf: ChartTf): string {
  if (tf === 'D') return 'D1';
  if (tf === 'W') return 'W1';
  if (tf === 'M') return 'MN1';
  return tf;
}

function isSameUnderlyingSymbol(symA: string, symB: string): boolean {
  const a = symA.trim().toUpperCase();
  const b = symB.trim().toUpperCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const prefixes = ['WIN', 'IND', 'WDO', 'DOL', 'BIT', 'CCM', 'BGI', 'ICF'];
  for (const p of prefixes) {
    if (a.startsWith(p) && b.startsWith(p)) {
      if (a.includes('$') || b.includes('$')) return true;
    }
  }
  return false;
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

/**
 * Converte candles em timestamps UTC estritamente crescentes para o Lightweight Charts.
 * Usa `c.time` (Unix epoch em segundos enviado pelo PainelSync.mq5) quando disponível,
 * ou reconstrói deterministicamente a partir de `timeLabel` ("HH:MM") mantendo compatibilidade.
 */
function buildTimedCandles(rawCandles: LiveCandle[], tfMinutes: number): TimedCandle[] {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) return [];
  const validCandles = rawCandles.filter((c) => c && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && c.high > 0 && c.low > 0);
  if (validCandles.length === 0) return [];

  const allHaveUnix = validCandles.every(
    (c) => typeof c.time === 'number' && Number.isFinite(c.time) && c.time > 0
  );

  if (allHaveUnix) {
    const out: TimedCandle[] = [];
    let lastTs = 0;
    for (const c of validCandles) {
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
  for (let i = 0; i < validCandles.length; i++) {
    const mins = parseHhMm(validCandles[i].timeLabel);
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
  for (let i = 0; i < validCandles.length; i++) {
    const c = validCandles[i];
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
    // ignora falha de storage
  }
}

function computeWdoOpeningOverlayLines(
  candles: Array<LiveCandle>,
  chPts = 7,
  h1Candles: Array<LiveCandle> = new Array<LiveCandle>(),
  d1Candles: Array<LiveCandle> = new Array<LiveCandle>()
): Array<{ price: number; color: string; lineStyle: LineStyle; lineWidth?: number; title: string }> {
  const empty = new Array<{ price: number; color: string; lineStyle: LineStyle; lineWidth?: number; title: string }>();
  if (!Array.isArray(candles) || candles.length < 10) return empty;
  const daysMap = new Map<string, Array<LiveCandle>>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles.at(i)!;
    const ts = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
    const dk = new Date(ts * 1000).toISOString().slice(0, 10);
    const arr = daysMap.get(dk) ?? new Array<LiveCandle>();
    arr.push(c);
    daysMap.set(dk, arr);
  }
  const days = Array.from(daysMap.keys()).sort();
  if (days.length < 2) return empty;
  const todayKey = days.at(days.length - 1)!;
  const todayBars = daysMap.get(todayKey)!;
  const prevBars = daysMap.get(days.at(days.length - 2)!)!;
  const prevHigh = Math.max(...prevBars.map((b) => b.high));
  const prevLow = Math.min(...prevBars.map((b) => b.low));
  const upLow = Number((prevHigh - chPts).toFixed(2));
  const dnHigh = Number((prevLow + chPts).toFixed(2));

  const lines: Array<{ price: number; color: string; lineStyle: LineStyle; lineWidth?: number; title: string }> = [
    { price: prevHigh, color: '#38BDF8', lineStyle: LineStyle.Solid, lineWidth: 2, title: 'Max D-1' },
    { price: upLow, color: '#38BDF8', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'Max-' + chPts },
    { price: dnHigh, color: '#38BDF8', lineStyle: LineStyle.Solid, lineWidth: 2, title: 'Min+' + chPts },
    { price: prevLow, color: '#38BDF8', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'Min D-1' },
  ];

  const firstTodayTs = Number(todayBars.at(0)?.time || 0);
  const prior = firstTodayTs > 0 ? candles.filter((c) => Number(c.time || 0) < firstTodayTs) : candles.slice(0, Math.max(0, candles.length - todayBars.length));
  const aggCloses = (sec: number): Array<number> => {
    const out = new Array<number>();
    let cur = -1;
    for (let i = 0; i < prior.length; i++) {
      const c = prior.at(i)!;
      const t = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || i * 300);
      const b = Math.floor(t / sec);
      if (b !== cur || out.length === 0) { cur = b; out.push(c.close); }
      else { out.splice(out.length - 1, 1, c.close); }
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

  const h1PriorCloses = h1Candles.length > 0
    ? h1Candles.filter((c) => firstTodayTs <= 0 || Number(c.time || 0) < firstTodayTs).map((c) => c.close)
    : aggCloses(3600);

  const d1PriorCloses = d1Candles.length > 0
    ? d1Candles.filter((c) => {
        const ts = Number(c.time) > 1e11 ? Math.floor(Number(c.time) / 1000) : Math.floor(Number(c.time) || 0);
        const dk = new Date(ts * 1000).toISOString().slice(0, 10);
        return dk < todayKey;
      }).map((c) => c.close)
    : aggCloses(86400);

  for (const p of Array.of(13, 17, 21)) {
    const eh = calcEmaVal(h1PriorCloses, p);
    if (eh != null) lines.push({ price: eh, color: '#7C3AED', lineStyle: LineStyle.Dotted, lineWidth: 2, title: 'EMA' + p + ' H1' });
    const ed = calcEmaVal(d1PriorCloses, p);
    if (ed != null) lines.push({ price: ed, color: '#F472B6', lineStyle: LineStyle.Dotted, lineWidth: 2, title: 'EMA' + p + ' D1' });
  }
  return lines;
}
export function TradingChartView({
  robots,
  managedRobots = [],
  activeContracts = {},
  selectedRobotId,
  onSelectRobot,
  magicColors = {},
  onNavigate,
}: TradingChartViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTf, setSelectedTf] = useState<ChartTf>('M5');
  const [isFollowingRobot, setIsFollowingRobot] = useState<boolean>(true);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const forceRefreshRef = useRef<boolean>(false);
  const [marketSymbols, setMarketSymbols] = useState<string[]>(() => {
    const { channelId } = loadOrCreateMt5SyncCredentials();
    return readCachedSymbols(channelId);
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [manualCandles, setManualCandles] = useState<LiveCandle[] | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState(false);
    const [subPaneMode, setSubPaneMode] = useState<'volume' | 'rsi' | 'pnl'>('volume');
  const [wdoMtfCandles, setWdoMtfCandles] = useState<{ h1: Array<LiveCandle>; d1: Array<LiveCandle> }>({ h1: new Array<LiveCandle>(), d1: new Array<LiveCandle>() });
  const previousSymbolRef = useRef<string>('');
  const lastFollowedBotKeyRef = useRef<string>('');

  const resolveCurrentSymbol = (rawSym?: string): string => {
    const up = (rawSym || '').toUpperCase().trim();
    if (!up) return '';
    const m = /^(WDO|WIN|IND|DOL|BIT)[FGHJKMNQUVXZ]\d{2}$/.exec(up);
    const root = m?.at(1);
    if (root && activeContracts[root]) return activeContracts[root].toUpperCase();
    return up;
  };

  useEffect(() => {
    let active = true;
    const { channelId, token } = loadOrCreateMt5SyncCredentials();
    fetchSymbols(channelId, token)
      .then((list) => {
        if (!active || !Array.isArray(list) || list.length === 0) return;
        setMarketSymbols(list);
        writeCachedSymbols(channelId, list);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [reloadToken]);

  const targetRobot = useMemo(() => {
    if (selectedRobotId !== 'ALL') {
      return robots.find((r) => r.robotId === selectedRobotId) ?? null;
    }
    return robots[0] ?? null;
  }, [robots, selectedRobotId]);

  useEffect(() => {
    setIsFollowingRobot(true);
  }, [selectedRobotId]);

  // Acompanha ativo (e timeframe inicial ao trocar de robo) enquanto isFollowingRobot estiver ativo
  useEffect(() => {
    if (!isFollowingRobot) {
      lastFollowedBotKeyRef.current = '';
      return;
    }
    if (targetRobot && targetRobot.symbol) {
      const nextSym = resolveCurrentSymbol(targetRobot.symbol);
      const botKey = `${targetRobot.robotId}:${nextSym}`;
      const isNewBotOrSymbol = lastFollowedBotKeyRef.current !== botKey;

      if (nextSym && nextSym !== previousSymbolRef.current) {
        setSelectedSymbol(nextSym);
        previousSymbolRef.current = nextSym;
        setManualCandles(null);
        setManualError(null);
        initialFitDoneRef.current = false;
      }

      if (isNewBotOrSymbol) {
        lastFollowedBotKeyRef.current = botKey;
        const upperTf = (targetRobot.timeframe || 'M5').toUpperCase() as ChartTf;
        if (TIMEFRAMES.includes(upperTf)) {
          setSelectedTf(upperTf);
          setManualCandles(null);
        }
      }
    } else if (!previousSymbolRef.current && marketSymbols.length > 0) {
      const first = marketSymbols[0].toUpperCase();
      setSelectedSymbol(first);
      previousSymbolRef.current = first;
    }
  }, [isFollowingRobot, targetRobot, activeContracts, marketSymbols]);

  const handleSelectSymbol = (rawVal: string) => {
    const upper = rawVal.toUpperCase().trim();
    if (!upper) return;
    setIsFollowingRobot(false);
    setSelectedSymbol(upper);
    if (upper !== previousSymbolRef.current) {
      previousSymbolRef.current = upper;
      setManualCandles(null);
      setManualError(null);
      setHoveredTime(null);
      initialFitDoneRef.current = false;
    }
  };

  const handleResumeFollowing = () => {
    lastFollowedBotKeyRef.current = '';
    setIsFollowingRobot(true);
    if (targetRobot && targetRobot.symbol) {
      const nextSym = resolveCurrentSymbol(targetRobot.symbol);
      setSelectedSymbol(nextSym);
      previousSymbolRef.current = nextSym;
      setManualCandles(null);
      setManualError(null);
      setHoveredTime(null);
      initialFitDoneRef.current = false;
      const upperTf = (targetRobot.timeframe || 'M5').toUpperCase() as ChartTf;
      if (TIMEFRAMES.includes(upperTf)) setSelectedTf(upperTf);
    }
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradeLinesPrimitiveRef = useRef<TradeLinesPrimitive | null>(null);
  const subSeriesRef = useRef<ISeriesApi<'Histogram' | 'Line' | 'Area'> | null>(null);
  const subPriceLinesRef = useRef<IPriceLine[]>([]);
  const initialFitDoneRef = useRef<boolean>(false);

  const availableSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const r of robots) {
      if (r.symbol) set.add(resolveCurrentSymbol(r.symbol));
    }
    for (const s of marketSymbols) {
      if (s) set.add(s.toUpperCase());
    }
    return Array.from(set);
  }, [robots, marketSymbols, activeContracts]);

  // Ao digitar um ativo, ele assume o foco. Se for um robô selecionado, ele também define.
  const activeSymbol = useMemo(() => {
    if (selectedSymbol) return selectedSymbol;
    if (selectedRobotId !== 'ALL') {
      const found = robots.find((r) => r.robotId === selectedRobotId);
      if (found) return found.symbol;
    }
    if (availableSymbols.length > 0) return availableSymbols[0];
    return '';
  }, [availableSymbols, selectedSymbol, selectedRobotId,
  robots]);

  // Se um robô específico estiver selecionado, mostra apenas ele; se for 'ALL', consolida os do ativo
   const symbolRobots = useMemo(() => {
     if (!activeSymbol) return [];
     if (selectedRobotId !== 'ALL') {
       const single = robots.find((r) => r.robotId === selectedRobotId);
       return single ? [single] : [];
     }
     return robots.filter((r) => isSameUnderlyingSymbol(r.symbol, activeSymbol));
   }, [robots, activeSymbol, selectedRobotId]);


  
 
    const isSelectedWdoZones = useMemo(() => {
    if (!targetRobot) return false;
    const m = managedRobots.find((b) => b.magicNumber === targetRobot.magicNumber);
    return m?.strategyType === 'wdo_opening_zones';
  }, [targetRobot, managedRobots]);

  useEffect(() => {
    if (!isSelectedWdoZones || !activeSymbol) {
      setWdoMtfCandles({ h1: new Array<LiveCandle>(), d1: new Array<LiveCandle>() });
      return;
    }
    let active = true;
    const { channelId, token } = loadOrCreateMt5SyncCredentials();
    Promise.all([
      syncCandlesWithMt5(channelId, token, activeSymbol, 'H1', { force: false, timeoutMs: 12000 }).catch(() => new Array<LiveCandle>()),
      syncCandlesWithMt5(channelId, token, activeSymbol, 'D1', { force: false, timeoutMs: 12000 }).catch(() => new Array<LiveCandle>()),
    ]).then(([h1, d1]) => {
      if (!active) return;
      setWdoMtfCandles({
        h1: Array.isArray(h1) ? h1 : new Array<LiveCandle>(),
        d1: Array.isArray(d1) ? d1 : new Array<LiveCandle>(),
      });
    });
    return () => { active = false; };
  }, [isSelectedWdoZones, activeSymbol, reloadToken]);
  const symbolRobotsRef = useRef(symbolRobots);
  symbolRobotsRef.current = symbolRobots;

  // 1ª carga: Snapshot (150 velas se ainda não estiver em cache)
  // Ciclos seguintes (a cada 2s): lê direto da RAM do servidor com focus=1 (sem criar pedidos na fila)
  useEffect(() => {
    if (!activeSymbol) return;
    const controller = new AbortController();

    const loadLiveCandles = async (isFirstLoad: boolean) => {
      if (isFirstLoad) {
        setIsLoading(true);
        setManualError(null);
      }
      try {
        const { channelId, token } = loadOrCreateMt5SyncCredentials();
        const mt5Tf = toMt5Timeframe(selectedTf);
        const result = isFirstLoad
          ? await syncCandlesWithMt5(
              channelId,
              token,
              activeSymbol,
              mt5Tf,
              {
                force: forceRefreshRef.current || !symbolRobotsRef.current.some((r) => (r.timeframe || '').toUpperCase() === selectedTf.toUpperCase() || (r.candlesByTimeframe?.[selectedTf.toUpperCase()]?.length ?? 0) > 0),
                timeoutMs: 8000,
                intervalMs: 800,
                signal: controller.signal,
              }
            )
          : await fetchCandles(
              channelId,
              token,
              activeSymbol,
              mt5Tf
            );

        if (!controller.signal.aborted) {
          if (result && result.length > 0) {
            setManualCandles((prev) => {
              if (
                prev &&
                prev.length === result.length &&
                prev[prev.length - 1]?.time === result[result.length - 1]?.time &&
                prev[prev.length - 1]?.close === result[result.length - 1]?.close &&
                prev[prev.length - 1]?.high === result[result.length - 1]?.high &&
                prev[prev.length - 1]?.low === result[result.length - 1]?.low &&
                prev[prev.length - 1]?.volume === result[result.length - 1]?.volume
              ) {
                return prev;
              }
              return result;
            });
            setManualError(null);
          } else if (isFirstLoad) {
            setManualError('Aguardando resposta do MetaTrader 5...');
          }
        }
      } catch (err) {
        if (!controller.signal.aborted && isFirstLoad) {
          console.error('[TradingChartView] Falha ao sincronizar candles:', err);
          setManualError('Erro ao solicitar velas ao MT5');
        }
      } finally {
        if (!controller.signal.aborted && isFirstLoad) {
          setIsLoading(false);
        }
      }
    };

    loadLiveCandles(true);
    forceRefreshRef.current = false;
    const interval = setInterval(() => {
      loadLiveCandles(false);
    }, 2000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [activeSymbol, selectedTf, reloadToken]);


  // Seleciona a melhor série mestre de candles para o ativo + timeframe escolhido
  const { allCandles, masterRobot, isNativeTf } = useMemo<{
    allCandles: LiveCandle[];
    masterRobot: RobotStream | null;
    isNativeTf: boolean;
  }>(() => {
    if (manualCandles && manualCandles.length > 0) {
      return { allCandles: manualCandles, masterRobot: null, isNativeTf: true };
    }
    if (symbolRobots.length === 0) {
      return { allCandles: [], masterRobot: null, isNativeTf: true };
    }
    const tfKey = toMt5Timeframe(selectedTf).toUpperCase();
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

      const rTf = (r.timeframe || 'M5').toUpperCase();
      const rCandles = Array.isArray(r.candles) ? r.candles : [];
      if (rTf === tfKey && rCandles.length > 0) {
        if (!bestNative || rCandles.length > bestNative.candles.length) {
          bestNative = { candles: rCandles, robot: r };
        }
        continue;
      }

      const baseMin = TF_MINUTES[rTf] ?? 5;
      const targetMin = TF_MINUTES[tfKey] ?? 5;
      if (targetMin > baseMin && targetMin % baseMin === 0 && rCandles.length > 0) {
        const agg = aggregateCandles(rCandles, targetMin / baseMin);
        if (!bestNative || agg.length > bestNative.candles.length) {
          bestNative = { candles: agg, robot: r };
        }
        continue;
      }

      if (
        rCandles.length > 0 && (!bestFallback || rCandles.length > bestFallback.candles.length)
      ) {
        bestFallback = { candles: rCandles, robot: r };
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
  }, [symbolRobots, selectedTf, manualCandles]);

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

  // Consolida operações e posições de todos os robôs que operam o ativo ativo
  const symbolTrades = useMemo<ExecutedTrade[]>(() => {
    const dedup = new Map<string, ExecutedTrade>();
    for (const r of symbolRobots) {
      for (const tr of (r.trades ?? [])) {
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

  const pendingOrders = useMemo<PendingOrder[]>(
    () =>
      symbolRobots.flatMap((r) =>
        (r.pendingOrders ?? []).map((o) => ({ ...o, robotName: o.robotName || r.name }))
      ),
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
      if ((r.timeframe || 'M5').toUpperCase() !== tfUpper) continue;
      const rCandles = Array.isArray(r.candles) ? r.candles : [];
      const rMarkers = Array.isArray(r.markers) ? r.markers : [];
      for (const m of rMarkers) {
        let mappedIdx = m.candleIndex;
        if (rCandles.length !== timedCandles.length) {
          const targetLabel = rCandles[m.candleIndex]?.timeLabel;
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
              : m.candleIndex + (timedCandles.length - rCandles.length);
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
      const candleHm = (c.timeLabel.split(" ").pop() || c.timeLabel).slice(0, 5);
      while (tIdx < symbolTrades.length && (symbolTrades[tIdx].exitTime || "").slice(0, 5) <= candleHm) {
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
        vertLines: { visible: false },
        horzLines: { visible: false },
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

const markersPlugin = createSeriesMarkers(candleSeries, []);
    const tradeLinesPrimitive = new TradeLinesPrimitive();
    candleSeries.attachPrimitive(tradeLinesPrimitive);
    tradeLinesPrimitiveRef.current = tradeLinesPrimitive;

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
    markersPluginRef.current = markersPlugin;
    subSeriesRef.current = null;
    priceLinesRef.current = [];
    subPriceLinesRef.current = [];

    return () => {
      markersPlugin.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersPluginRef.current = null;
      subSeriesRef.current = null;
      priceLinesRef.current = [];
      subPriceLinesRef.current = [];
      tradeLinesPrimitiveRef.current = null;
    };
  }, [activeSymbol, selectedTf]);

  // 3. Atualiza os dados em tempo real (candles, indicadores, marcadores, posições e sub-painel)
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || timedCandles.length === 0) return;

    try {
    candleSeries.setData(
      timedCandles.map((tc) => ({
        time: tc.utcTime,
        open: tc.candle.open,
        high: tc.candle.high,
        low: tc.candle.low,
        close: tc.candle.close,
      }))
    );

// Marcadores consolidados de todos os robôs no ativo (ordenados por timestamp)
    // Marcadores consolidados de todos os robôs no ativo + posição aberta em tempo real
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
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // Adiciona seta automática na vela de entrada de cada posição aberta
      for (const pos of openPositions) {
        if (!pos.openTime || timedCandles.length === 0) continue;

        // Converte "YYYY.MM.DD HH:MM" (horário do servidor MT5) para epoch UTC
        const match = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(pos.openTime.trim());
        let targetCandle = timedCandles[timedCandles.length - 1];

        if (match) {
          const openEpochSec = Math.floor(
            Date.UTC(
              Number(match[1]),
              Number(match[2]) - 1,
              Number(match[3]),
              Number(match[4]),
              Number(match[5])
            ) / 1000
          );

          // Encontra a vela cujo timestamp é menor ou igual ao horário de abertura
          for (let i = timedCandles.length - 1; i >= 0; i--) {
            if (Number(timedCandles[i].utcTime) <= openEpochSec) {
              targetCandle = timedCandles[i];
              break;
            }
          }
        }

        const isBuy = pos.side === 'COMPRA';
        seriesMarkers.push({
          time: targetCandle.utcTime,
          position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
          shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
          color: isBuy ? '#10B981' : '#EF4444',
          text: `${isBuy ? 'C' : 'V'} ${pos.volume}x @ ${formatPrice(pos.entryPrice, activeSymbol)}`,
        });
      }
      const nextSegments: TradeSegmentItem[] = [];

      if (showMarkers && timedCandles.length > 0) {
        const firstCandleSec = Number(timedCandles[0].utcTime);
        const lastCandleSec = Number(timedCandles[timedCandles.length - 1].utcTime);

        const parseTradeEpochSec = (dateStr?: string, timeStr?: string): number | null => {
          const raw = `${dateStr ?? ''} ${timeStr ?? ''}`.trim();
          const full = /(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
          if (full) {
            return Math.floor(
              Date.UTC(
                Number(full.at(1)),
                Number(full.at(2)) - 1,
                Number(full.at(3)),
                Number(full.at(4)),
                Number(full.at(5)),
                Number(full.at(6) ?? 0)
              ) / 1000
            );
          }
          const hhmm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((timeStr ?? '').trim());
          if (hhmm) {
            const lastDate = new Date(lastCandleSec * 1000);
            return Math.floor(
              Date.UTC(
                lastDate.getUTCFullYear(),
                lastDate.getUTCMonth(),
                lastDate.getUTCDate(),
                Number(hhmm.at(1)),
                Number(hhmm.at(2)),
                Number(hhmm.at(3) ?? 0)
              ) / 1000
            );
          }
          return null;
        };

        const findNearestCandle = (epochSec: number) => {
          for (let i = timedCandles.length - 1; i >= 0; i--) {
            if (Number(timedCandles[i].utcTime) <= epochSec) {
              return timedCandles[i];
            }
          }
          return timedCandles[0];
        };

        const dedupTrades = new Map<string, ExecutedTrade & { robotName: string }>();
        for (const r of symbolRobots) {
          for (const t of [...(r.historyTrades ?? []), ...r.trades]) {
            dedupTrades.set(`${r.magicNumber}_${t.id}`, {
              ...t,
              magicNumber: r.magicNumber,
              robotName: r.name,
            });
          }
        }
        const closedTrades = Array.from(dedupTrades.values()).slice(-40);

        for (const tr of closedTrades) {
          const entrySec = parseTradeEpochSec(tr.entryDate, tr.entryTime);
          const exitSec = parseTradeEpochSec(tr.exitDate || tr.entryDate, tr.exitTime);
          if (entrySec === null || exitSec === null) continue;
          if (exitSec < firstCandleSec - 86400 || entrySec > lastCandleSec + 86400) continue;

          const entryCandle = findNearestCandle(entrySec);
          const exitCandle = findNearestCandle(exitSec);
          const isBuy = tr.side === 'COMPRA';
          const isWin = tr.pnlBrl >= 0;
          const tradeColor = isWin ? '#10B981' : '#EF4444';
          const botTag = symbolRobots.length > 1 ? ` (${tr.robotName})` : '';

          seriesMarkers.push({
            time: entryCandle.utcTime,
            position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
            shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
            color: isBuy ? '#10B981' : '#EF4444',
            text: `${isBuy ? 'C' : 'V'}${botTag}`,
          });

          const pnlLabel = `${tr.pnlBrl >= 0 ? '+' : ''}R${Math.round(tr.pnlBrl)}`;
          seriesMarkers.push({
            time: exitCandle.utcTime,
            position: isBuy ? ('aboveBar' as const) : ('belowBar' as const),
            shape: isBuy ? ('arrowDown' as const) : ('arrowUp' as const),
            color: tradeColor,
            text: pnlLabel,
          });

          if (tr.entryPrice > 0 && tr.exitPrice > 0) {
            const lineHex = isWin ? '#A855F7' : '#7E22CE';
            nextSegments.push({
              entryTime: entryCandle.utcTime,
              entryPrice: tr.entryPrice,
              exitTime: exitCandle.utcTime,
              exitPrice: tr.exitPrice,
              color: lineHex,
              dotColor: getRobotColorTheme(tr.magicNumber, magicColors).hex,
            });
          }
        }
      }

      tradeLinesPrimitiveRef.current?.setSegments(nextSegments);
      seriesMarkers.sort((a, b) => Number(a.time) - Number(b.time));
      markersPluginRef.current.setMarkers(seriesMarkers);
    }

    // Linhas de preço para todas as posições abertas no ativo (Entrada, SL, TP)
    for (const pl of priceLinesRef.current) {
      candleSeries.removePriceLine(pl);
    }
    const nextPriceLines: IPriceLine[] = [];
    const getPointValueBrl = (sym: string) => {
      const u = sym.toUpperCase();
      if (u.startsWith('WIN') || u.startsWith('IND')) return 0.2;
      if (u.startsWith('WDO') || u.startsWith('DOL')) return 10.0;
      if (u.startsWith('BIT')) return 0.01;
      return 1.0;
    };

    const BUY_LINE  = '#B45309';
    const BUY_TEXT  = '#FBBF24';
    const SELL_LINE = '#047857';
    const SELL_TEXT = '#34D399';
    const LABEL_BG  = '#18181B';

    for (const pos of openPositions) {
      const prefix = openPositions.length > 1 ? `${pos.robotName} ` : '';
      const ptVal = getPointValueBrl(pos.symbol);
      const isBuy = pos.side === 'COMPRA';

      const posLine  = isBuy ? BUY_LINE : SELL_LINE;
      const posText  = isBuy ? BUY_TEXT : SELL_TEXT;
      const exitLine = isBuy ? SELL_LINE : BUY_LINE;
      const exitText = isBuy ? SELL_TEXT : BUY_TEXT;

      if (pos.entryPrice > 0) {
        const ptsSign = pos.pointsOpen >= 0 ? '+' : '';
        const brlSign = pos.floatingPnlBrl >= 0 ? '+' : '-';
        const brlAbs = Math.abs(pos.floatingPnlBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.entryPrice,
            color: posLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: posText,
            title: `${prefix}${isBuy ? 'Comprado' : 'Vendido'} ${pos.volume} · ${ptsSign}${pos.pointsOpen.toFixed(1)} pts (${brlSign}R$ ${brlAbs})`,
          })
        );
      }
      if (pos.sl > 0) {
        const slPts = isBuy ? (pos.sl - pos.entryPrice) : (pos.entryPrice - pos.sl);
        const slBrl = slPts * ptVal * pos.volume;
        const slSign = slBrl >= 0 ? '+' : '-';
        const slAbs = Math.abs(slBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.sl,
            color: exitLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: exitText,
            title: `${prefix}SL · ${slPts >= 0 ? '+' : ''}${slPts.toFixed(1)} pts (${slSign}R$ ${slAbs})`,
          })
        );
      }
      if (pos.tp > 0) {
        const tpPts = isBuy ? (pos.tp - pos.entryPrice) : (pos.entryPrice - pos.tp);
        const tpBrl = tpPts * ptVal * pos.volume;
        const tpSign = tpBrl >= 0 ? '+' : '-';
        const tpAbs = Math.abs(tpBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: pos.tp,
            color: exitLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: exitText,
            title: `${prefix}TP · ${tpPts >= 0 ? '+' : ''}${tpPts.toFixed(1)} pts (${tpSign}R$ ${tpAbs})`,
          })
        );
      }
    }

    for (const ord of pendingOrders) {
      const prefix = symbolRobots.length > 1 ? `${ord.robotName || `Robô #${ord.magicNumber}`} ` : '';
      const isBuyOrd = ord.side === 'COMPRA';
      const ordLine  = isBuyOrd ? BUY_LINE : SELL_LINE;
      const ordText  = isBuyOrd ? BUY_TEXT : SELL_TEXT;
      const exitLine = isBuyOrd ? SELL_LINE : BUY_LINE;
      const exitText = isBuyOrd ? SELL_TEXT : BUY_TEXT;

      if (ord.price > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: ord.price,
            color: ordLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: ordText,
            title: `${prefix}${ord.orderType} ${ord.volume}x`,
          })
        );
      }
      if (ord.sl > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: ord.sl,
            color: exitLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: exitText,
            title: `${prefix}SL Ordem`,
          })
        );
      }
      if (ord.tp > 0) {
        nextPriceLines.push(
          candleSeries.createPriceLine({
            price: ord.tp,
            color: exitLine,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            axisLabelColor: LABEL_BG,
            axisLabelTextColor: exitText,
            title: `${prefix}TP Ordem`,
          })
        );
      }
    }
          const selectedAppBot = targetRobot ? managedRobots.find((m) => m.magicNumber === targetRobot.magicNumber) : null;
      if (selectedAppBot && selectedAppBot.strategyType === 'wdo_opening_zones') {
        const chPts = Math.max(1, Number(selectedAppBot.params?.channelPoints) || 7);
        const wdoLines = computeWdoOpeningOverlayLines(timedCandles.map((tc) => tc.candle), chPts, wdoMtfCandles.h1, wdoMtfCandles.d1);
        for (const wl of wdoLines) {
          nextPriceLines.push(
            candleSeries.createPriceLine({
              price: wl.price,
              color: wl.color,
              lineWidth: (wl.lineWidth ?? 1) as 1 | 2 | 3 | 4,
              lineStyle: wl.lineStyle,
              axisLabelVisible: true,
              axisLabelColor: '#18181B',
              axisLabelTextColor: wl.color,
              title: wl.title,
            })
          );
        }
      }
      priceLinesRef.current = nextPriceLines;

    // Na primeira carga do ativo/timeframe, mostra os últimos ~70 candles confortavelmente
    if (!initialFitDoneRef.current) {
      const total = timedCandles.length;
      if (total > 300) {
        const viewWindow = selectedTf === 'D' ? 365 : (selectedTf === 'W' ? MAX_CHART_CANDLES : INITIAL_CHART_VIEW_BARS);
        chart.timeScale().setVisibleLogicalRange({
          from: total - viewWindow,
          to: total,
        });
      } else {
        chart.timeScale().fitContent();
      }
      initialFitDoneRef.current = true;
    }
    } catch (err) {
      console.error('[TradingChartView] Erro ao atualizar gráfico:', err);
    }
  }, [
    activeSymbol,
    selectedTf,
    timedCandles,
    showMarkers,
    symbolRobots,
    magicColors,
    unifiedMarkers,
    openPositions,
    pendingOrders,
    subPaneMode,
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
      direction === 'in' ? Math.max(10, span - delta) : Math.min(MAX_CHART_CANDLES, span + delta);
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
    if (allCandles.length === 0) return null;
    if (hoveredTime !== null) {
      const hovered = candleByTimeMap.get(hoveredTime);
      if (hovered) return hovered;
    }
    return allCandles[allCandles.length - 1];
  }, [allCandles, hoveredTime, candleByTimeMap]);


  const hoveredMarkers = useMemo(() => {
    if (hoveredTime === null) return [];
    return unifiedMarkers.filter((m) => {
      const tc = timedCandles[m.candleIndex];
      return tc && Number(tc.utcTime) === hoveredTime;
    });
  }, [hoveredTime, unifiedMarkers, timedCandles]);

  if (!activeSymbol) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center space-y-3">
          <CandlestickChart className="w-7 h-7 text-gray-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-gray-100">
            Nenhum gráfico disponível ainda
          </h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            Conecte seu MetaTrader 5 para visualizar o gráfico único por ativo no padrão TradingView com candles interativos, timeframes, zoom e marcações de todos os robôs em tempo real.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-6 py-4 gap-3 overflow-hidden">
      <div className="w-full flex-1 flex flex-col min-h-0 gap-3">
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F141C] border border-[#1E2633]"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedRobotId === "ALL" ? "#10B981" : getRobotColorTheme(robots.find((r) => r.robotId === selectedRobotId)?.magicNumber ?? 0, magicColors).hex }} /><select value={selectedRobotId} onChange={(e) => { const nextId = e.target.value; setSelectedSymbol(""); onSelectRobot?.(nextId); }} aria-label="Filtrar robô no gráfico" className="bg-transparent text-xs font-medium text-gray-100 focus:outline-none cursor-pointer max-w-[200px]"><option value="ALL" className="bg-[#0F141C] text-gray-100">Todos os Robôs ({robots.filter((r) => !r.hidden).length})</option>{robots.filter((r) => !r.hidden).map((r) => (<option key={r.robotId} value={r.robotId} className="bg-[#0F141C] text-gray-100">{r.name} (#{r.magicNumber})</option>))}</select></div>
          <SymbolAutocomplete
            symbols={availableSymbols}
            selectedSymbol={activeSymbol}
            onSelect={handleSelectSymbol}
            placeholder="Pesquisar ativo (ex: WIN, WDO, PETR4)..."
          />

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
                  onClick={() => {
                    if (selectedTf === tf) return;
                    setSelectedTf(tf);
                    setManualCandles(null);
                    setManualError(null);
                    setHoveredTime(null);
                    initialFitDoneRef.current = false;
                  }}
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

          {robots.length > 0 && (
            isFollowingRobot ? (
              <button
                type="button"
                onClick={() => setIsFollowingRobot(false)}
                title="Acompanhando automaticamente o robô selecionado. Clique para pausar ou pesquise qualquer ativo."
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/50 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-950/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Seguindo Robô{targetRobot ? `: ${targetRobot.name}` : ''}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleResumeFollowing}
                title="Voltar a acompanhar o ativo e timeframe do robô selecionado"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-950/50 border border-amber-600/60 text-amber-300 hover:bg-amber-950/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Bot className="w-3.5 h-3.5" />
                Voltar ao robô{targetRobot ? ` (${targetRobot.name})` : ''}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => { forceRefreshRef.current = true; setReloadToken((n) => n + 1); }}
            disabled={!activeSymbol || isLoading}
            className="flex items-center gap-1.5 bg-[#0F141C] hover:bg-[#1E2633] border border-[#1E2633] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            title="Solicitar candles atualizados ao MetaTrader 5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Sincronizar MT5
          </button>

          {isLoading && (
            <span className="text-[11px] text-blue-400 animate-pulse">Sincronizando...</span>
          )}
          {manualError && <span className="text-[11px] text-rose-400">{manualError}</span>}
        </div>
        <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="shrink-0 px-4 py-2.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3 text-xs min-h-[38px]">
            <div className="flex flex-wrap items-center gap-3 min-w-0 font-mono tabular-nums text-[11px]">
              <span className="font-semibold text-gray-100">
                {activeSymbol} · {selectedTf}
              </span>
              {activeCandle ? (
                <>
                  <span className="text-gray-400">{activeCandle.timeLabel}</span>
                  <span className="text-gray-400">
                    A <strong className="text-gray-200">{formatPrice(activeCandle.open, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Máx <strong className="text-emerald-400">{formatPrice(activeCandle.high, activeSymbol)}</strong>
                  </span>
                  <span className="text-gray-400">
                    Mín <strong className="text-rose-400">{formatPrice(activeCandle.low, activeSymbol)}</strong>
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
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      · {m.label}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-gray-500">{isLoading ? 'Carregando cotação...' : 'Sem cotação'}</span>
              )}
            </div>

                        <div className="ml-auto flex flex-wrap items-center gap-2">
              {openPositions.map((pos) => (
                <span
                  key={pos.id}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                    pos.side === 'COMPRA'
                      ? 'bg-amber-950/40 border-amber-700/50 text-amber-300'
                      : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                  }`}
                >
                  {pos.side} {pos.volume}x · {formatBrl(pos.floatingPnlBrl)}
                </span>
              ))}

              {symbolRobots.length > 0 && (
                <span className="text-xs font-medium text-gray-300 truncate">
                  {symbolRobots.map((r) => r.name).join(' · ')}
                </span>
              )}

              <button
                type="button"
                onClick={() => setShowMarkers((v) => !v)}
                title="Exibir ou ocultar setas e linhas tracejadas dos trades"
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer shrink-0 ${
                  showMarkers
                    ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                    : 'bg-[#090D12] border-[#1E2633] text-gray-400 hover:text-gray-200'
                }`}
              >
                Trades
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-[#090D12] relative">
            <div ref={containerRef} className="w-full h-full" />
            {allCandles.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                <CandlestickChart className="w-7 h-7 text-gray-500" />
                <p className="text-xs text-gray-400">
                  {isLoading
                    ? `Buscando candles de ${activeSymbol}...`
                    : manualError
                      ? `Não foi possível carregar ${activeSymbol}: ${manualError}`
                      : `Nenhum candle disponível para ${activeSymbol}.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
