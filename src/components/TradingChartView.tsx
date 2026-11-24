import { INITIAL_CHART_VIEW_BARS, MAX_CHART_CANDLES } from '../utils/themeTokens';
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
  PendingOrder,
  RobotStream,
} from '../types/trading';
import {
  aggregateCandles,
  fetchCandles,
  loadOrCreateMt5SyncCredentials,
  syncCandlesWithMt5,
} from '../utils/mt5Bridge';
import { formatBrl, formatPrice } from '../utils/tradingMath';

interface TradingChartViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
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
  magicColors = {},
  onNavigate,
}: TradingChartViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTf, setSelectedTf] = useState<ChartTf>('M5');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [manualCandles, setManualCandles] = useState<LiveCandle[] | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState(false);
  const [subPaneMode, setSubPaneMode] = useState<'volume' | 'rsi' | 'pnl'>('volume');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const previousSymbolRef = useRef<string>('');

  useEffect(() => {
    if (selectedRobotId !== 'ALL') {
      const found = robots.find((r) => r.robotId === selectedRobotId);
      const nextSym = found?.symbol?.toUpperCase();
      if (nextSym && nextSym !== previousSymbolRef.current) {
        setSelectedSymbol(nextSym);
        setSearchQuery(nextSym);
        previousSymbolRef.current = nextSym;
        setManualCandles(null);
        setManualError(null);
      }
    } else if (!previousSymbolRef.current && robots.length > 0 && robots[0].symbol) {
      const firstSym = robots[0].symbol.toUpperCase();
      setSelectedSymbol(firstSym);
      setSearchQuery(firstSym);
      previousSymbolRef.current = firstSym;
    }
  }, [selectedRobotId,
  magicColors = {}, robots]);

    const handleSymbolChange = async (val: string) => {
      const upper = val.toUpperCase();
      setSearchQuery(val);
      setSelectedSymbol(upper);

      if (upper === previousSymbolRef.current) {
        setShowSuggestions(false);
        return;
      }

      previousSymbolRef.current = upper;
      setManualCandles(null);
      setManualError(null);

      if (upper === '') {
        setShowSuggestions(false);
        return;
      }

      setShowSuggestions(true);
      setIsLoading(true);
      try {
        const { channelId, token } = loadOrCreateMt5SyncCredentials();
        
        // Verifica se já temos dados suficientes na telemetria para evitar fetch desnecessário
        const hasTelemetry = symbolRobots.some(r => r.symbol === upper && (r.candlesByTimeframe?.[selectedTf.toUpperCase()]?.length ?? 0) > 0);
        
        if (!hasTelemetry) {
          const result = await fetchCandles(
            channelId,
            token,
            upper,
            selectedTf
          );

          if (result && result.length > 0) {
            setManualCandles(result);
          } else {
            setManualError('Dados não encontrados');
          }
        }
      } catch (error) {
        console.error(error);
        const hasTelemetry = symbolRobots.some(r => r.symbol === upper && (r.candlesByTimeframe?.[selectedTf.toUpperCase()]?.length ?? 0) > 0);
        if (!hasTelemetry) {
          setManualError('Erro ao carregar dados');
        }
      } finally {
        setIsLoading(false);
      }
    };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradeSegmentSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const subSeriesRef = useRef<ISeriesApi<'Histogram' | 'Line' | 'Area'> | null>(null);
  const subPriceLinesRef = useRef<IPriceLine[]>([]);
  const initialFitDoneRef = useRef<boolean>(false);

  const availableSymbols = useMemo(
    () => Array.from(new Set(robots.map((r) => r.symbol))),
    [robots]
  );

  const filteredSymbols = useMemo(() => {
    const query = searchQuery.toUpperCase();
    return availableSymbols.filter(s => s.toUpperCase().includes(query));
  }, [searchQuery, availableSymbols]);

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
  magicColors = {}, robots]);

  // Se um robô específico estiver selecionado, mostra apenas ele; se for 'ALL', consolida os do ativo
   const symbolRobots = useMemo(() => {
     if (!activeSymbol) return [];
     if (selectedRobotId !== 'ALL') {
       const single = robots.find((r) => r.robotId === selectedRobotId);
       return single ? [single] : [];
     }
     return robots.filter((r) => isSameUnderlyingSymbol(r.symbol, activeSymbol));
   }, [robots, activeSymbol, selectedRobotId]);


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
        const result = isFirstLoad
          ? await syncCandlesWithMt5(
              channelId,
              token,
              activeSymbol,
              selectedTf,
              {
                force: false,
                timeoutMs: 8000,
                intervalMs: 800,
                signal: controller.signal,
              }
            )
          : await fetchCandles(
              channelId,
              token,
              activeSymbol,
              `${selectedTf}`
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
    const interval = setInterval(() => {
      loadLiveCandles(false);
    }, 2000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [activeSymbol, selectedTf]);


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
      tradeSegmentSeriesRef.current = [];
    };
  }, [activeSymbol, selectedTf]);

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

            for (const seg of tradeSegmentSeriesRef.current) {
        try {
          chart.removeSeries(seg);
        } catch {
          // ignora
        }
      }
      tradeSegmentSeriesRef.current = [];

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

        const closedTrades = symbolRobots
          .flatMap((r) => r.trades.map((t) => ({ ...t, robotName: r.name })))
          .slice(-30);

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

          if (
            Number(entryCandle.utcTime) < Number(exitCandle.utcTime) &&
            tr.entryPrice > 0 &&
            tr.exitPrice > 0
          ) {
            const segSeries = chart.addSeries(
              LineSeries,
              {
                color: tradeColor,
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
              },
              0
            );
            segSeries.setData([
              { time: entryCandle.utcTime, value: tr.entryPrice },
              { time: exitCandle.utcTime, value: tr.exitPrice },
            ]);
            tradeSegmentSeriesRef.current.push(segSeries);
          }
        }
      }

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
  }, [
    timedCandles,
    showMarkers,
    symbolRobots,
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
        <div className="max-w-2xl mx-auto rounded-xl bg-[#11161D] border border-[#222B38] p-8 text-center space-y-3">
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
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMarkers((v) => !v)}
              title="Exibir ou ocultar setas e linhas tracejadas dos trades"
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                showMarkers
                  ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                  : 'bg-[#11161D] border-[#222B38] text-gray-400 hover:text-gray-200'
              }`}
            >
              Trades
            </button>
          </div>

          {openPositions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              {openPositions.map((pos) => (
                <span
                  key={pos.id}
                  className={`px-2.5 py-1 rounded-lg border ${
                    pos.side === 'COMPRA'
                      ? 'bg-amber-950/40 border-amber-700/50 text-amber-300'
                      : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                  }`}
                >
                  {pos.side} {pos.volume}x · {formatBrl(pos.floatingPnlBrl)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
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
                </>
              ) : (
                <span className="text-gray-500">Carregando cotação...</span>
              )}
            </div>

            {symbolRobots.length > 0 && (
              <div className="ml-auto text-xs font-medium text-gray-300 truncate">
                {symbolRobots.map((r) => r.name).join(' · ')}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 bg-[#0B0E11] relative">
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
