import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
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
  Download,
  FastForward,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  SkipForward,
  X,
} from 'lucide-react';
import { runBacktestSimulation } from '../engine/backtestSimulator';
import { TradeLinesPrimitive, type TradeSegmentItem, type LocalLevelItem } from '../utils/tradeLinesPrimitive';
import { computeWdoOpeningOverlayLines, computeWdoHudState } from '../utils/wdoChartOverlay';
import type {
  LiveCandle,
  ManagedRobot,
  ManagedRobotParams,
  SignalAction,
  ManagedRobotRisk,
  ManagedStrategyType,
  Mt5SyncCredentials,
} from '../types/trading';
import { fetchCandles, fetchManagedRobots, syncCandlesWithMt5, updateManagedRobotApi } from '../utils/mt5Bridge';

interface BacktestReplayViewProps {
  creds: Mt5SyncCredentials;
  activeContracts?: Record<string, string>;
}

const DEFAULT_RISK: ManagedRobotRisk = {
  volume: 1,
  stopPoints: 150,
  takePoints: 300,
  startTime: '09:05',
  endTime: '17:15',
  closeTime: '17:45',
  maxDailyLossBrl: 500,
  reverseOnOpposite: true,
};

function describeNoTradingDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
  const dow = dt.getUTCDay();
  const mmdd = dateStr.slice(5);
  const holidays: Record<string, string> = {
    '01-01': 'Confraternização Universal',
    '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalho',
    '09-07': 'Independência do Brasil',
    '10-12': 'Nossa Senhora Aparecida',
    '11-02': 'Finados',
    '11-15': 'Proclamação da República',
    '11-20': 'Dia da Consciência Negra',
    '12-25': 'Natal',
  };
  if (dow === 0 || dow === 6) return 'fim de semana (B3 fechada)';
  if (holidays[mmdd]) return `feriado nacional (${holidays[mmdd]})`;
  return 'feriado ou data sem histórico disponível na corretora';
}

function toSec(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

function toChartTime(raw: unknown, fallbackSec = 0): UTCTimestamp {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(fallbackSec) as UTCTimestamp;
  return (n > 1e11 ? Math.floor(n / 1000) : Math.floor(n)) as UTCTimestamp;
}

export function BacktestReplayView({ creds, activeContracts }: BacktestReplayViewProps) {
  const [savedRobots, setSavedRobots] = useState<ManagedRobot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [botName, setBotName] = useState('Simulação EMA 9x21');
  const [symbol, setSymbol] = useState('WIN$');
  const [timeframe, setTimeframe] = useState<'M1' | 'M5' | 'M15' | 'M30' | 'H1'>('M5');
  const [strategyType, setStrategyType] = useState<ManagedStrategyType>('ema_cross');
  const [maType, setMaType] = useState<'EMA' | 'SMA'>('EMA');
  const [fastPeriod, setFastPeriod] = useState(9);
  const [slowPeriod, setSlowPeriod] = useState(21);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [oversold, setOversold] = useState(30);
  const [overbought, setOverbought] = useState(70);
  const [lookbackBars, setLookbackBars] = useState(10);
  const [onBullishSignal, setOnBullishSignal] = useState<SignalAction>('BUY');
  const [onBearishSignal, setOnBearishSignal] = useState<SignalAction>('SELL');
  const [risk, setRisk] = useState<ManagedRobotRisk>(DEFAULT_RISK);

  const [candles, setCandles] = useState<LiveCandle[]>(new Array());
  const [replayDate, setReplayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedDay, setSelectedDay] = useState<string>('ALL');
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [candleStatus, setCandleStatus] = useState('Clique em Carregar Replay para carregar o hist\u00f3rico real.');
  const [replayBars, setReplayBars] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [isChartMaximized, setIsChartMaximized] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [savingRobot, setSavingRobot] = useState(false);
  const [editNotice, setEditNotice] = useState('');

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const tradeLinesPrimitiveRef = useRef<TradeLinesPrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const overlaySeriesRef = useRef<Array<ISeriesApi<'Line'>>>([]);
  const lastRenderedCountRef = useRef<number>(0);
  const lastRenderedSeriesRef = useRef<LiveCandle[] | null>(null);

  useEffect(() => {
    fetchManagedRobots(creds.channelId, creds.token).then(setSavedRobots).catch(() => {});
  }, [creds.channelId, creds.token]);

  const handleSelectSavedBot = (id: string) => {
    setSelectedBotId(id);
    const found = savedRobots.find((b) => b.id === id);
    if (!found) return;
    setBotName(found.name);
    setSymbol(found.symbol);
    setTimeframe(found.timeframe);
    setStrategyType(found.strategyType);
    setMaType(found.params.maType === 'SMA' ? 'SMA' : 'EMA');
    setFastPeriod(Number(found.params.fastPeriod) || 9);
    setSlowPeriod(Number(found.params.slowPeriod) || 21);
    setRsiPeriod(Number(found.params.rsiPeriod) || 14);
    setOversold(Number(found.params.oversold) || 30);
    setOverbought(Number(found.params.overbought) || 70);
    setLookbackBars(Number(found.params.lookbackBars) || 10);
    setOnBullishSignal((found.params.onBullishSignal as SignalAction) || 'BUY');
    setOnBearishSignal((found.params.onBearishSignal as SignalAction) || 'SELL');
    setRisk(found.risk);
  };

  const upperSym = symbol.trim().toUpperCase();
  const mappedContract = upperSym.endsWith('$') && activeContracts ? activeContracts[upperSym.slice(0, -1)] : undefined;
  const resolvedSymbol = useMemo(() => {
    if (upperSym.endsWith('$') && mappedContract) return mappedContract.toUpperCase();
    return upperSym || 'WIN$';
  }, [upperSym, mappedContract]);

  const handleLoadMt5Candles = async () => {
    setIsLiveMode(false);
    setIsPlaying(false);
    setLoadingCandles(true);
    setCandleStatus(`Carregando pregão ${replayDate.split('-').reverse().join('/')} de ${resolvedSymbol} (${timeframe}) no MT5...`);
    try {
      const isWdoZones = strategyType === 'wdo_opening_zones';
      const [list, h1List, d1List] = await Promise.all([
        syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, timeframe, isWdoZones ? { force: true, isManualRequest: true } : { force: true, isManualRequest: true, date: replayDate }),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'H1', { force: true }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'D1', { force: true }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
      ]);
      if (isWdoZones) {
        setReplayMtfCandles({
          h1: Array.isArray(h1List) ? h1List : new Array<LiveCandle>(),
          d1: Array.isArray(d1List) ? d1List : new Array<LiveCandle>(),
        });
      }
      if (list && list.length > 0) {
        setCandles(list);
        const dayMatches = list.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === replayDate);
        if (dayMatches.length > 0) {
          setSelectedDay(replayDate);
        } else {
          const fallbackDay = new Date(Number(list.at(-1)?.time || 0) * 1000).toISOString().slice(0, 10);
          setSelectedDay(fallbackDay);
        }
        if (strategyType === 'wdo_opening_zones') { const td = dayMatches.length > 0 ? replayDate : new Date(Number(list.at(-1)?.time || 0) * 1000).toISOString().slice(0, 10); const upTo = list.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) <= td); const fIdx = upTo.findIndex((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === td); setReplayBars(fIdx >= 0 ? fIdx + 1 : 1); } else { setReplayBars(replayInitialBar); }
        setCandleStatus(`Cache pronto (${dayMatches.length || list.length} velas). Clique em Play Replay ou 100%.`);
      } else {
        const brDate = replayDate.split('-').reverse().join('/');
        const reason = describeNoTradingDay(replayDate);
        setCandles([]);
        setReplayBars(0);
        setCandleStatus(`Sem histórico de pregão para ${brDate} (${reason}). Escolha outra data no calendário.`);
      }
    } catch (err) {
      setCandleStatus('Falha ao consultar MT5. Verifique se o Serviço do MT5 está conectado.');
    } finally {
      setLoadingCandles(false);
    }
  };

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of candles) {
      const sec = Number(c.time || 0);
      if (sec > 0) set.add(new Date(sec * 1000).toISOString().slice(0, 10));
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [candles]);

  const [replayMtfCandles, setReplayMtfCandles] = useState<{ h1: Array<LiveCandle>; d1: Array<LiveCandle> }>({ h1: new Array<LiveCandle>(), d1: new Array<LiveCandle>() });

  useEffect(() => {
    if (strategyType !== 'wdo_opening_zones' || !resolvedSymbol || !creds.channelId || !creds.token) return;
    let alive = true;
    Promise.all([
      fetchCandles(creds.channelId, creds.token, resolvedSymbol, 'H1').catch(() => new Array<LiveCandle>()),
      fetchCandles(creds.channelId, creds.token, resolvedSymbol, 'D1').catch(() => new Array<LiveCandle>()),
    ]).then(([h1, d1]) => {
      if (alive) setReplayMtfCandles({ h1: Array.isArray(h1) ? h1 : new Array<LiveCandle>(), d1: Array.isArray(d1) ? d1 : new Array<LiveCandle>() });
    });
    return () => { alive = false; };
  }, [strategyType, resolvedSymbol, creds.channelId, creds.token]);

  const activeCandles = useMemo(() => {
    if (selectedDay === 'ALL' || availableDays.length === 0) return candles;
    if (strategyType === 'wdo_opening_zones') {
      const upToDay = candles.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) <= selectedDay);
      return upToDay.length > 0 ? upToDay : candles;
    }
    const filtered = candles.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === selectedDay);
    return filtered.length > 0 ? filtered : candles;
  }, [candles, selectedDay, availableDays, strategyType]);

  const replayInitialBar = useMemo(() => {
    if (strategyType !== 'wdo_opening_zones' || selectedDay === 'ALL' || activeCandles.length === 0) return 1;
    const firstIdx = activeCandles.findIndex((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === selectedDay);
    return firstIdx >= 0 ? firstIdx + 1 : 1;
  }, [strategyType, selectedDay, activeCandles]);

  useEffect(() => {
    if (!isLiveMode) return;
    let cancelled = false;
    const todayStr = new Date().toISOString().slice(0, 10);
    setReplayDate(todayStr);

    let pollTickCount = 0; const mergeBars = (prev: LiveCandle[], next: LiveCandle[]): LiveCandle[] => {
      const map = new Map<number, LiveCandle>();
      for (const c of prev) {
        const t = toSec(c.time); if (Number.isFinite(t) && t > 0) map.set(t, { ...c, time: t });
      }
      for (const c of next) {
        const t = toSec(c.time); if (Number.isFinite(t) && t > 0) map.set(t, { ...c, time: t });
      }
      return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    };

    const pollLive = async (isInitial: boolean) => {
      if (isInitial) {
        setLoadingCandles(true);
        setCandleStatus(`Conectando pregão ao vivo de ${resolvedSymbol} (${timeframe})...`);
      }
      try {
        pollTickCount += 1; const shouldResyncFull = isInitial || pollTickCount % 10 === 0; const list = shouldResyncFull
          ? await syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, timeframe, { force: true })
          : await fetchCandles(creds.channelId, creds.token, resolvedSymbol, timeframe);
        if (cancelled) return;
        if (list && list.length > 0) {
          const todayBars = list.filter((c) => new Date(toSec(c.time) * 1000).toISOString().slice(0, 10) === todayStr);
          const incoming = todayBars.length > 0 ? todayBars : list;
          setCandles((prev) => {
            const target = isInitial ? incoming : mergeBars(prev, incoming);
            const lastPrev = prev.at(-1);
            const lastNext = target.at(-1);
            if (
              !isInitial &&
              prev.length === target.length &&
              lastPrev?.time === lastNext?.time &&
              lastPrev?.close === lastNext?.close &&
              lastPrev?.high === lastNext?.high &&
              lastPrev?.low === lastNext?.low
            ) {
              return prev;
            }
            setReplayBars(target.length);
            setCandleStatus(`AO VIVO · ${resolvedSymbol} (${timeframe}) · ${target.length} velas (Paper Trading sem ordem real)`);
            return target;
          });
          setSelectedDay(todayBars.length > 0 ? todayStr : 'ALL');
        }
      } catch {
        if (!cancelled && isInitial) {
          setCandleStatus('Falha ao conectar ao vivo no MT5. Verifique se o Serviço está ativo.');
        }
      } finally {
        if (!cancelled && isInitial) setLoadingCandles(false);
      }
    };

    pollLive(true);
    const id = window.setInterval(() => { pollLive(false); }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLiveMode, creds.channelId, creds.token, resolvedSymbol, timeframe]);

  useEffect(() => {
    if (!isPlaying || activeCandles.length === 0) return;
    if (replayBars >= activeCandles.length) {
      setIsPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      setReplayBars((prev) => (prev >= activeCandles.length ? activeCandles.length : prev + 1));
    }, speedMs);
    return () => window.clearTimeout(id);
  }, [isPlaying, speedMs, replayBars, activeCandles.length]);

  const simResult = useMemo(() => {
    if (activeCandles.length < 6) return null;
    const baseParams: ManagedRobotParams = strategyType === 'ema_cross'
      ? { maType, fastPeriod, slowPeriod }
      : strategyType === 'rsi_reversal'
        ? { rsiPeriod, oversold, overbought }
        : strategyType === 'wdo_opening_zones' ? { channelPoints: 7, rsiPeriod: 7, z1RsiMin: 86, z1RsiMax: 90, z5RsiMin: 10, z5RsiMax: 16 } : { lookbackBars };
    const params: ManagedRobotParams = { ...baseParams, onBullishSignal, onBearishSignal };
    return runBacktestSimulation({
      robot: { name: botName, magicNumber: 9999, symbol: resolvedSymbol, timeframe, enabled: true, strategyType, params: params as Record<string, unknown>, risk },
      candles: activeCandles,
      maxBars: replayBars > 0 ? replayBars : activeCandles.length,
      startFromBar: strategyType === 'wdo_opening_zones' && selectedDay !== 'ALL' ? Math.max(4, replayInitialBar - 1) : undefined,
    });
  }, [activeCandles, replayBars, replayInitialBar, selectedDay, botName, resolvedSymbol, timeframe, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, onBullishSignal, onBearishSignal, risk]);

  const wdoReplayHud = useMemo(() => {
    if (strategyType !== 'wdo_opening_zones' || activeCandles.length === 0) return null;
    const targetCount = replayBars > 0 ? Math.min(replayBars, activeCandles.length) : activeCandles.length;
    const vis = activeCandles.slice(0, targetCount);
    const chPts = Math.max(1, Number(7) || 7);
    const rsiPer = Math.max(2, Number(rsiPeriod) || 7);
    return computeWdoHudState(vis, chPts, rsiPer, replayMtfCandles.h1, replayMtfCandles.d1, true);
  }, [strategyType, activeCandles, replayBars, rsiPeriod, replayMtfCandles]);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      kineticScroll: { touch: true, mouse: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      layout: { background: { type: ColorType.Solid, color: '#090D12' }, textColor: '#94A3B8' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#1E2633', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1E2633' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981', downColor: '#EF4444', borderUpColor: '#10B981', borderDownColor: '#EF4444', wickUpColor: '#10B981', wickDownColor: '#EF4444',
    });
    markersPluginRef.current = createSeriesMarkers(series, []);
    const tradeLinesPrimitive = new TradeLinesPrimitive();
    series.attachPrimitive(tradeLinesPrimitive);
    tradeLinesPrimitiveRef.current = tradeLinesPrimitive;
    chartRef.current = chart;
    candleSeriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersPluginRef.current = null;
      tradeLinesPrimitiveRef.current = null;
      priceLinesRef.current = [];
      overlaySeriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    const targetCount = replayBars > 0 ? Math.min(replayBars, activeCandles.length) : activeCandles.length;
    const visibleCandles = activeCandles.slice(0, targetCount);
    const baseSec = Math.floor(Date.now() / 1000) - activeCandles.length * 60;
    const isStepPlusOne =
      lastRenderedSeriesRef.current === activeCandles &&
      targetCount === lastRenderedCountRef.current + 1 &&
      targetCount > 1;
    const barTimes = visibleCandles.map((c, idx) => toChartTime(c.time, baseSec + idx * 60));
    if (isStepPlusOne) {
      const idx = targetCount - 1;
      const c = visibleCandles.at(idx)!;
      series.update({ time: barTimes.at(idx)!, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) });
    } else {
      series.setData(visibleCandles.map((c, idx) => ({
        time: barTimes.at(idx)!, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      })));
    }
    lastRenderedSeriesRef.current = activeCandles;
    lastRenderedCountRef.current = targetCount;
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];
    const nextLocalLevels = new Array<LocalLevelItem>();
    if (strategyType === 'wdo_opening_zones' && visibleCandles.length >= 10) {
      const chPts = Math.max(1, Number(7) || 7);
      const wdoLines = computeWdoOpeningOverlayLines(visibleCandles, chPts, replayMtfCandles.h1, replayMtfCandles.d1, true);
      const leftT = barTimes.at(Math.max(0, barTimes.length - 6));
      const rightT = barTimes.at(barTimes.length - 1);
      for (const wl of wdoLines) {
        if (wl.title.startsWith('EMA') && leftT !== undefined && rightT !== undefined) {
          nextLocalLevels.push({
            anchorLeftTime: leftT,
            anchorRightTime: rightT,
            price: wl.price,
            color: wl.color,
            label: wl.title.replace('EMA', '').replace(' H1', '').replace(' D1', '').replace(/^/, wl.title.endsWith('H1') ? 'H' : 'D') + ' - ' + wl.price.toFixed(1),
          });
        } else {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: wl.price,
              color: wl.color,
              lineWidth: wl.lineWidth,
              lineStyle: wl.lineStyle,
              axisLabelVisible: true,
              axisLabelColor: '#18181B',
              axisLabelTextColor: wl.color,
              title: wl.title,
            })
          );
        }
      }
    }
    tradeLinesPrimitiveRef.current?.setLocalLevels(nextLocalLevels);
    const overlays = strategyType === 'wdo_opening_zones' ? new Array() : (simResult?.overlays ?? []);
    while (overlaySeriesRef.current.length > overlays.length) {
      const removed = overlaySeriesRef.current.pop();
      if (removed) { try { chart.removeSeries(removed); } catch {} }
    }
    overlays.forEach((ov, ovIdx) => {
      let line = overlaySeriesRef.current[ovIdx];
      if (!line) {
        line = chart.addSeries(LineSeries, { color: ov.color, lineWidth: ov.lineWidth ?? 2, lineStyle: ov.dotted ? 1 : ov.dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false });
        overlaySeriesRef.current[ovIdx] = line;
      } else {
        line.applyOptions({ color: ov.color, lineWidth: ov.lineWidth ?? 2, lineStyle: ov.dotted ? 1 : ov.dashed ? 2 : 0 });
      }
      const pts: Array<{ time: UTCTimestamp; value: number }> = [];
      visibleCandles.forEach((_, idx) => {
        const val = ov.values.at(idx);
        if (val !== null && val !== undefined) pts.push({ time: barTimes[idx], value: val });
      });
      line.setData(pts);
    });
    if (simResult) {
      const markers: Array<SeriesMarker<Time>> = [];
      const segments: TradeSegmentItem[] = [];
      for (const tr of simResult.trades) {
        const isBuy = tr.side === 'COMPRA';
        const isWin = tr.pnlBrl >= 0;
        const entryT = toChartTime(tr.entryTime);
        const exitT = toChartTime(tr.exitTime);
        const tradeColor = isWin ? '#34D399' : '#F87171';
        const ptsLabel = `${tr.points >= 0 ? '+' : ''}${tr.points} pts`;
        markers.push({
          time: entryT,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#10B981' : '#EF4444',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: isBuy ? 'C' : 'V',
        });
        markers.push({
          time: exitT,
          position: isBuy ? 'aboveBar' : 'belowBar',
          color: tradeColor,
          shape: isBuy ? 'arrowDown' : 'arrowUp',
          text: ptsLabel,
        });
        if (tr.entryPrice > 0 && tr.exitPrice > 0) {
          segments.push({
            entryTime: entryT,
            entryPrice: tr.entryPrice,
            exitTime: exitT,
            exitPrice: tr.exitPrice,
            color: isWin ? '#A855F7' : '#7E22CE',
            dotColor: '#C084FC',
          });
        }
      }
      if (simResult.openPosition) {
        const op = simResult.openPosition;
        const isBuy = op.side === 'COMPRA';
        const activeTr = simResult.trades.at(-1);
        const openTime = activeTr ? undefined : barTimes.at(-1);
        if (openTime) {
          markers.push({
            time: openTime,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? '#10B981' : '#EF4444',
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            text: isBuy ? 'C' : 'V',
          });
        }
      }
      tradeLinesPrimitiveRef.current?.setSegments(segments);
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      markersPluginRef.current?.setMarkers(markers);
      if (simResult.openPosition) {
        const op = simResult.openPosition;
        priceLinesRef.current.push(series.createPriceLine({ price: op.entryPrice, color: op.side === 'COMPRA' ? '#10B981' : '#EF4444', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `${op.side} ${op.volume}x` }));
        if (op.tp > 0) priceLinesRef.current.push(series.createPriceLine({ price: op.tp, color: '#38BDF8', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP' }));
        if (op.sl > 0) priceLinesRef.current.push(series.createPriceLine({ price: op.sl, color: '#F59E0B', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL' }));
      }
    } else {
      tradeLinesPrimitiveRef.current?.setSegments([]);
      markersPluginRef.current?.setMarkers([]);
    }
  }, [activeCandles, replayBars, simResult, strategyType, replayMtfCandles]);

  useEffect(() => {
    if (!isChartMaximized) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsChartMaximized(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isChartMaximized]);

  const handleSaveEditedRobot = async () => {
    if (!selectedBotId) { setIsEditModalOpen(false); return; }
    setSavingRobot(true);
    setEditNotice('');
    try {
      const baseParams: ManagedRobotParams = strategyType === 'ema_cross'
        ? { maType, fastPeriod, slowPeriod }
        : strategyType === 'rsi_reversal'
          ? { rsiPeriod, oversold, overbought }
          : strategyType === 'wdo_opening_zones' ? { channelPoints: 7, rsiPeriod: 7, z1RsiMin: 86, z1RsiMax: 90, z5RsiMin: 10, z5RsiMax: 16 } : { lookbackBars };
      const params: ManagedRobotParams = { ...baseParams, onBullishSignal, onBearishSignal };
      const updated = await updateManagedRobotApi(creds.channelId, creds.token, selectedBotId, {
        name: botName.trim() || 'Robô Editado', symbol, timeframe, strategyType, params, risk,
      });
      setSavedRobots((prev) => prev.map((r) => (r.id === selectedBotId ? { ...r, ...updated } : r)));
      setIsEditModalOpen(false);
      setCandleStatus(`Robô "${botName}" atualizado e aplicado ao replay atual.`);
    } catch (err) {
      setEditNotice(err instanceof Error ? err.message : 'Falha ao salvar alterações do robô.');
    } finally {
      setSavingRobot(false);
    }
  };

  const formatBrl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden bg-[#090D12]">
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-gray-100">Simulador de Backtest & Replay</h1>
            <p className="text-xs text-gray-400 mt-0.5">Teste qualquer robô criado no painel sobre velas históricas reais do MT5 e avance vela por vela no modo Replay.</p>
          </div>
          <div className="shrink-0 flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
            <div className="flex items-center gap-2 bg-[#0F141C] border border-[#1E2633] rounded-lg px-2.5 py-1">
              <span className="text-[11px] text-gray-400">Data do Pregão:</span>
              <input
                type="date"
                value={replayDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setReplayDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
                className="bg-[#090D12] border border-[#1E2633] rounded px-2 py-1 text-xs font-mono text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
              />
            </div>
            <button type="button" onClick={handleLoadMt5Candles} disabled={loadingCandles && !isLiveMode} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60">
              <Download className="w-3.5 h-3.5" /><span>{loadingCandles && !isLiveMode ? 'Carregando...' : 'Carregar Replay'}</span>
            </button>
            <button
              type="button"
              onClick={() => { setIsPlaying(false); setIsLiveMode((prev) => !prev); }}
              className={isLiveMode
                ? 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer ring-2 ring-sky-400/50'
                : 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-sky-300 text-xs font-semibold cursor-pointer'}
            >
              <Radio className={isLiveMode ? 'w-3.5 h-3.5 animate-pulse' : 'w-3.5 h-3.5'} />
              <span>{isLiveMode ? 'Ao Vivo ON' : 'Ao Vivo (Paper)'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="col-span-2">
            <label className="block text-[10px] text-gray-400 mb-1">Carregar Robô Salvo</label>
            <div className="flex items-center gap-1.5">
              <select value={selectedBotId} onChange={(e) => handleSelectSavedBot(e.target.value)} className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
                <option value="">-- Configuração Manual --</option>
                {savedRobots.map((b) => (<option key={b.id} value={b.id}>{b.name} ({b.symbol} · {b.timeframe})</option>))}
              </select>
              <button type="button" onClick={() => { setEditNotice(''); setIsEditModalOpen(true); }} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs text-sky-300 font-medium cursor-pointer">
                <Settings2 className="w-3.5 h-3.5" /><span>Editar</span>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Ativo</label>
            <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-full px-2.5 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as 'M1' | 'M5' | 'M15' | 'M30' | 'H1')} className="w-full px-2.5 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100">
              <option value="M1">M1</option><option value="M5">M5</option><option value="M15">M15</option><option value="M30">M30</option><option value="H1">H1</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Estratégia</label>
            <select value={strategyType} onChange={(e) => setStrategyType(e.target.value as ManagedStrategyType)} className="w-full px-2.5 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
              <option value="ema_cross">Médias ({fastPeriod}x{slowPeriod})</option>
              <option value="rsi_reversal">IFR ({rsiPeriod})</option>
              <option value="breakout">Rompimento ({lookbackBars}v)</option><option value="wdo_opening_zones">Abertura WDO (5 Zonas)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-400 mb-1">SL (pts)</label>
              <input type="number" min="0" value={risk.stopPoints} onChange={(e) => setRisk({ ...risk, stopPoints: Math.max(0, Number(e.target.value) || 0) })} className="w-full px-2 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-1">TP (pts)</label>
              <input type="number" min="0" value={risk.takePoints} onChange={(e) => setRisk({ ...risk, takePoints: Math.max(0, Number(e.target.value) || 0) })} className="w-full px-2 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
            </div>
          </div>
        </div>


        {!selectedBotId && (
        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs">
          <span className="text-[11px] font-semibold text-gray-300">Regra de Disparo:</span>
{strategyType === 'wdo_opening_zones' ? (<div className='flex flex-wrap items-center gap-2 text-[11px] text-emerald-300 font-medium'><span className='px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30'>5 Zonas (Z1..Z5) • Gatilhos A/B</span><span className='text-gray-400'>Canais D-1 (±7 pts) • IFR(7) • EMAs 13/17/21 (H1/D1) • 1 op/dia</span></div>) : (<>          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">{strategyType === 'ema_cross' ? 'Cruza p/ Cima:' : strategyType === 'rsi_reversal' ? 'Sobrevenda:' : 'Rompe Máxima:'}</span>
            <select value={onBullishSignal} onChange={(e) => setOnBullishSignal(e.target.value as SignalAction)} className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
              <option value="BUY">Comprar</option><option value="SELL">Vender</option><option value="NONE">Ignorar</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">{strategyType === 'ema_cross' ? 'Cruza p/ Baixo:' : strategyType === 'rsi_reversal' ? 'Sobrecompra:' : 'Rompe Mínima:'}</span>
            <select value={onBearishSignal} onChange={(e) => setOnBearishSignal(e.target.value as SignalAction)} className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
              <option value="SELL">Vender</option><option value="BUY">Comprar</option><option value="NONE">Ignorar</option>
            </select>
          </div></>)}
        </div>
        )}


        {simResult && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3.5">
              <div className="text-[11px] text-gray-400">Resultado Líquido</div>
              <div className={`text-lg font-mono font-bold mt-1 ${simResult.summary.netPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(simResult.summary.netPnlBrl)}</div>
              <div className="text-[10px] font-mono text-gray-500">{simResult.summary.netPoints} pts</div>
            </div>
            <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3.5">
              <div className="text-[11px] text-gray-400">Taxa de Acerto</div>
              <div className="text-lg font-mono font-bold text-gray-100 mt-1">{simResult.summary.winRatePct}%</div>
              <div className="text-[10px] font-mono text-gray-500">{simResult.summary.wins}W / {simResult.summary.losses}L</div>
            </div>
            <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3.5">
              <div className="text-[11px] text-gray-400">Fator de Lucro</div>
              <div className="text-lg font-mono font-bold text-sky-400 mt-1">{simResult.summary.profitFactor.toFixed(2)}</div>
              <div className="text-[10px] font-mono text-gray-500">{simResult.summary.totalTrades} trades</div>
            </div>
            <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3.5">
              <div className="text-[11px] text-gray-400">Drawdown Máximo</div>
              <div className="text-lg font-mono font-bold text-rose-400 mt-1">-{formatBrl(simResult.summary.maxDrawdownBrl)}</div>
              <div className="text-[10px] font-mono text-gray-500">Pior trade: {formatBrl(simResult.summary.worstTradeBrl)}</div>
            </div>
            <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3.5">
              <div className="text-[11px] text-gray-400">Posição Aberta</div>
              <div className="text-sm font-mono font-semibold text-gray-100 mt-1">{simResult.openPosition ? `${simResult.openPosition.side} ${simResult.openPosition.volume}x @ ${simResult.openPosition.entryPrice}` : 'Zerado'}</div>
              <div className="text-[10px] font-mono text-gray-500 truncate">{simResult.lastDecision}</div>
            </div>
          </div>
        )}

        <div className={isChartMaximized ? 'fixed top-0 inset-x-0 bottom-[34px] z-50 bg-[#090D12] px-4 pt-3 pb-0 flex flex-col gap-2' : 'rounded-xl bg-[#0F141C] border border-[#1E2633] p-3 flex flex-col gap-2'}>
          <div className="relative z-20 shrink-0 flex items-center justify-between px-1">
            <span className="text-[11px] font-mono text-gray-400">{resolvedSymbol} · {timeframe} · {botName}</span>
            <button type="button" onClick={() => setIsChartMaximized((p) => !p)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs font-medium text-gray-100 cursor-pointer">
              {isChartMaximized ? <><Minimize2 className="w-3.5 h-3.5 text-sky-400" /><span>Restaurar (ESC)</span></> : <><Maximize2 className="w-3.5 h-3.5 text-sky-400" /><span>Maximizar</span></>}
            </button>
          </div>
          <div className={isChartMaximized ? 'relative flex-1 w-full min-h-0 overflow-hidden' : 'relative w-full h-[calc(100vh-370px)] min-h-[420px] overflow-hidden'}>
            <div ref={chartWrapRef} className="absolute inset-0" />
            {wdoReplayHud && (
              <div className="absolute bottom-8 right-20 z-20 pointer-events-none flex flex-col items-end gap-1 px-2.5 py-1.5 rounded-lg bg-[#090D12]/85 backdrop-blur border border-[#1E2633] text-[11px] font-mono shadow-lg">
                <div className="flex items-center gap-2">
                  {wdoReplayHud.zoneLabel && (
                    <span className="inline-flex items-center gap-1 text-[#60A5FA] font-semibold">
                      <span>{wdoReplayHud.zoneLabel}</span>
                      <span className="text-gray-400 font-normal">({wdoReplayHud.zoneSide})</span>
                    </span>
                  )}
                  {wdoReplayHud.zoneLabel && <span className="text-gray-600">|</span>}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-gray-400">IFR({wdoReplayHud.rsiPeriod}):</span>
                    <span className={`font-bold ${
                      wdoReplayHud.rsiVal === null ? 'text-gray-400'
                      : wdoReplayHud.rsiVal >= 86 ? 'text-rose-400'
                      : wdoReplayHud.rsiVal <= 16 ? 'text-emerald-400'
                      : 'text-gray-100'
                    }`}>
                      {wdoReplayHud.rsiVal !== null ? wdoReplayHud.rsiVal.toFixed(1) : '--'}
                    </span>
                  </span>
                </div>
                {(wdoReplayHud.d1Emas.length > 0 || wdoReplayHud.h1Emas.length > 0) && (
                  <div className="grid grid-cols-2 gap-x-3 text-[10px] leading-tight pt-1 border-t border-[#1E2633]/80 w-full">
                    <div className="flex flex-col gap-0.5">
                      {[...wdoReplayHud.d1Emas].reverse().map((e) => (
                        <div key={e.title} className="text-green-500 whitespace-nowrap">
                          D{e.title.replace('EMA', '').replace(' D1', '')} - <span className="text-gray-200">{e.price.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-0.5 text-right">
                      {[...wdoReplayHud.h1Emas].reverse().map((e) => (
                        <div key={e.title} className="text-purple-400 whitespace-nowrap">
                          H{e.title.replace('EMA', '').replace(' H1', '')} - <span className="text-gray-200">{e.price.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {wdoReplayHud.prevDayFormatted && (
                  <div className="w-full pt-1 border-t border-[#1E2633]/80 flex items-center justify-between gap-3 text-[10px] text-gray-400">
                    <span>Canal D-1: <span className="text-[#60A5FA] font-semibold">{wdoReplayHud.prevDayFormatted}</span></span>
                    <span>Pregão: <span className="text-gray-200">{wdoReplayHud.todayDayFormatted}</span></span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {simResult && simResult.trades.length > 0 && (
          <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E2633] text-xs font-semibold text-gray-200">Operações Simuladas ({simResult.trades.length})</div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090D12] text-[10px] text-gray-400 uppercase">
                  <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Lado</th><th className="px-4 py-2">Gatilho / Zona</th><th className="px-4 py-2">Entrada</th><th className="px-4 py-2">Saída</th><th className="px-4 py-2">Motivo</th><th className="px-4 py-2 text-right">Pts</th><th className="px-4 py-2 text-right">Resultado</th></tr>
                </thead>
                <tbody className="divide-y divide-[#1E2633]">
                  {[...simResult.trades].reverse().map((t) => (
                    <tr key={t.id} className="hover:bg-[#161C25]">
                      <td className="px-4 py-2 text-gray-500">{t.id}</td>
                      <td className={`px-4 py-2 font-semibold ${t.side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side} {t.volume}x</td><td className="px-4 py-2">{t.entryReason ? <span className="px-1.5 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-500/30 text-[10px]">{t.entryReason}</span> : <span className="text-gray-600">-</span>}</td>
                      <td className="px-4 py-2 text-gray-300">{t.entryLabel} @ {t.entryPrice}</td>
                      <td className="px-4 py-2 text-gray-300">{t.exitLabel} @ {t.exitPrice}</td>
                      <td className="px-4 py-2 text-gray-400">{t.exitReason}</td>
                      <td className={`px-4 py-2 text-right ${t.points >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.points}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${t.pnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(t.pnlBrl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        </div>
      </div>
      <div className={isChartMaximized ? "fixed bottom-0 inset-x-0 z-50 h-[50px] bg-[#090D12]/95 backdrop-blur border-t border-[#1E2633] px-4 flex items-center justify-between gap-3 shadow-2xl overflow-hidden" : "shrink-0 z-30 w-full h-[50px] bg-[#090D12]/90 border-t border-[#1E2633] px-4 flex items-center justify-between gap-3 overflow-hidden"}>
          <div className="shrink-0 flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
            <button type="button" disabled={candles.length === 0} onClick={() => { if (!isPlaying && replayBars >= candles.length) setReplayBars(replayInitialBar); setIsPlaying((p) => !p); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
              {isPlaying ? <><Pause className="w-3.5 h-3.5" /><span>Pausar</span></> : <><Play className="w-3.5 h-3.5" /><span>Play Replay</span></>}
            </button>
            <button type="button" disabled={activeCandles.length === 0 || replayBars >= activeCandles.length} onClick={() => { setIsPlaying(false); setReplayBars((p) => Math.min(activeCandles.length, p + 1)); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /><span>+1 Vela</span>
            </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(replayInitialBar); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /><span>Zerar</span>
            </button>
            <button type="button" disabled={activeCandles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(activeCandles.length); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-emerald-300 text-xs cursor-pointer disabled:opacity-40">
              <FastForward className="w-3.5 h-3.5" /><span>100%</span>
            </button>
          </div>
          <div className="min-w-0 flex-1 flex items-center justify-end gap-2 text-xs font-mono text-gray-400">
            <span className="truncate min-w-0" title={candleStatus}>{candleStatus}</span>
            {availableDays.length > 0 && (
              <select
                value={selectedDay}
                onChange={(e) => {
                  const nextDay = e.target.value;
                  setIsPlaying(false);
                  setSelectedDay(nextDay);
                  const count = nextDay === 'ALL' ? candles.length : candles.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === nextDay).length;
                  setReplayBars(count || 1);
                }}
                className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-sky-300"
              >
                {availableDays.map((d) => (
                  <option key={d} value={d}>Pregão {d.split('-').reverse().join('/')}</option>
                ))}
                <option value="ALL">Todos os dias ({candles.length}v)</option>
              </select>
            )}
            {activeCandles.length > 0 && <span className="px-2 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-gray-200">Vela {replayBars} / {activeCandles.length}</span>}
            <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-200">
              <option value={1200}>0.5x</option>
              <option value={600}>1x</option>
              <option value={200}>3x</option>
              <option value={60}>10x</option>
            </select>
          </div>
        </div>
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0F141C] border border-[#1E2633] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2633]">
              <div>
                <h2 className="text-sm font-bold text-gray-100">{selectedBotId ? `Editar Robô: ${botName}` : 'Editar Parâmetros da Simulação'}</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">As velas carregadas e a posição atual do Replay serão preservadas.</p>
              </div>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-[#161C25] cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2"><label className="block text-[11px] text-gray-400 mb-1">Nome</label><input type="text" value={botName} onChange={(e) => setBotName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-gray-100" /></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">Estratégia</label><select value={strategyType} onChange={(e) => setStrategyType(e.target.value as ManagedStrategyType)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-gray-100"><option value="ema_cross">Cruzamento Médias</option><option value="rsi_reversal">Reversão IFR</option><option value="breakout">Rompimento Máx/Mín</option><option value="wdo_opening_zones">Abertura WDO (5 Zonas)</option></select></div>
              </div>
              {strategyType === 'ema_cross' && (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="block text-[11px] text-gray-400 mb-1">Média</label><select value={maType} onChange={(e) => setMaType(e.target.value as 'EMA' | 'SMA')} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-gray-100"><option value="EMA">EMA</option><option value="SMA">SMA</option></select></div>
                  <div><label className="block text-[11px] text-gray-400 mb-1">Rápida</label><input type="number" min="2" value={fastPeriod} onChange={(e) => setFastPeriod(Math.max(2, Number(e.target.value) || 9))} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                  <div><label className="block text-[11px] text-gray-400 mb-1">Lenta</label><input type="number" min="3" value={slowPeriod} onChange={(e) => setSlowPeriod(Math.max(3, Number(e.target.value) || 21))} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                </div>
              )}
              {strategyType === 'rsi_reversal' && (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="block text-[11px] text-gray-400 mb-1">Período IFR</label><input type="number" min="2" value={rsiPeriod} onChange={(e) => setRsiPeriod(Math.max(2, Number(e.target.value) || 14))} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                  <div><label className="block text-[11px] text-gray-400 mb-1">Sobrevenda</label><input type="number" min="5" max="49" value={oversold} onChange={(e) => setOversold(Number(e.target.value) || 30)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                  <div><label className="block text-[11px] text-gray-400 mb-1">Sobrecompra</label><input type="number" min="51" max="95" value={overbought} onChange={(e) => setOverbought(Number(e.target.value) || 70)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                </div>
              )}
              {strategyType === 'breakout' && (
                <div><label className="block text-[11px] text-gray-400 mb-1">Candles de Lookback</label><input type="number" min="2" value={lookbackBars} onChange={(e) => setLookbackBars(Math.max(2, Number(e.target.value) || 10))} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#1E2633]">
                <div><label className="block text-[11px] text-gray-400 mb-1">Sinal Alta</label><select value={onBullishSignal} onChange={(e) => setOnBullishSignal(e.target.value as SignalAction)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-gray-100"><option value="BUY">Comprar</option><option value="SELL">Vender</option><option value="NONE">Ignorar</option></select></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">Sinal Baixa</label><select value={onBearishSignal} onChange={(e) => setOnBearishSignal(e.target.value as SignalAction)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-gray-100"><option value="SELL">Vender</option><option value="BUY">Comprar</option><option value="NONE">Ignorar</option></select></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 border-t border-[#1E2633]">
                <div><label className="block text-[11px] text-gray-400 mb-1">Contratos</label><input type="number" min="1" value={risk.volume} onChange={(e) => setRisk({ ...risk, volume: Math.max(1, Number(e.target.value) || 1) })} className="w-full px-2.5 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">SL (pts)</label><input type="number" min="0" value={risk.stopPoints} onChange={(e) => setRisk({ ...risk, stopPoints: Math.max(0, Number(e.target.value) || 0) })} className="w-full px-2.5 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">TP (pts)</label><input type="number" min="0" value={risk.takePoints} onChange={(e) => setRisk({ ...risk, takePoints: Math.max(0, Number(e.target.value) || 0) })} className="w-full px-2.5 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">Início</label><input type="time" value={risk.startTime} onChange={(e) => setRisk({ ...risk, startTime: e.target.value })} style={{ colorScheme: 'dark' }} className="w-full px-2 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
                <div><label className="block text-[11px] text-gray-400 mb-1">Fim</label><input type="time" value={risk.endTime} onChange={(e) => setRisk({ ...risk, endTime: e.target.value })} style={{ colorScheme: 'dark' }} className="w-full px-2 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] font-mono text-gray-100" /></div>
              </div>
              {editNotice && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{editNotice}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[#1E2633] bg-[#090D12]/60">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs font-medium text-gray-200 cursor-pointer">Aplicar só no Simulador</button>
              {selectedBotId && <button type="button" disabled={savingRobot} onClick={handleSaveEditedRobot} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer disabled:opacity-50">{savingRobot ? 'Salvando...' : 'Salvar no Robô'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
