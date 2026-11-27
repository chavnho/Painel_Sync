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
  ChevronLeft,
  ChevronRight,
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
import { fetchCandles, fetchManagedRobots, fetchReplayTicks, syncCandlesWithMt5, updateManagedRobotApi } from '../utils/mt5Bridge';

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
  const [loadUntilToday, setLoadUntilToday] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>('ALL');
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [candleStatus, setCandleStatus] = useState('Clique em Carregar Replay para carregar o hist\u00f3rico real.');
  const [replayBars, setReplayBars] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [isTickMode, setIsTickMode] = useState(false);
  const [loadingTicks, setLoadingTicks] = useState(false);
  const [dayTicks, setDayTicks] = useState<Array<[number, number, number]>>(new Array<[number, number, number]>());
  const [tickCursor, setTickCursor] = useState(0);
  const [jumpTime, setJumpTime] = useState('10:00');
  const [isChartMaximized, setIsChartMaximized] = useState(false);
  const [isTradesDrawerOpen, setIsTradesDrawerOpen] = useState(false);
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
    fetchManagedRobots(creds.channelId, creds.token).then((list) => { setSavedRobots(list); if (list.length > 0) { const x = list.at(0)!; setSelectedBotId((p) => { if (p && list.some((b: ManagedRobot) => b.id === p)) return p; setBotName(x.name); setSymbol(x.symbol); setTimeframe(x.timeframe); setStrategyType(x.strategyType); setRisk(x.risk); return x.id; }); } }).catch(() => {});
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
      const dObj = new Date(`${replayDate}T12:00:00Z`); dObj.setUTCDate(dObj.getUTCDate() - 4); const fStart = Number.isNaN(dObj.getTime()) ? replayDate : dObj.toISOString().slice(0, 10); const dParam = loadUntilToday ? `from:${fStart}` : replayDate; const [list, h1List, d1List] = await Promise.all([
        syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, timeframe, isWdoZones && !loadUntilToday ? { force: true, isManualRequest: true } : { force: true, isManualRequest: true, date: dParam }),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'H1', loadUntilToday ? { force: true, isManualRequest: true, date: dParam } : { force: true }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'D1', loadUntilToday ? { force: true, isManualRequest: true, date: dParam } : { force: true }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
      ]);
      if (isWdoZones) {
        setReplayMtfCandles({
          h1: Array.isArray(h1List) ? h1List : new Array<LiveCandle>(),
          d1: Array.isArray(d1List) ? d1List : new Array<LiveCandle>(),
        });
      }
      if (list && list.length > 0) {
        setCandles(list); if (loadUntilToday) { setSelectedDay('ALL'); const si = list.findIndex((x) => new Date(Number(x.time || 0) * 1000).toISOString().slice(0, 10) >= replayDate); setReplayBars(si > 0 ? si : 10); setCandleStatus('Multi-pregao pronto. Clique em 100% ou Play.'); return; }
        const dayMatches = list.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === replayDate);
        if (dayMatches.length > 0) {
          setSelectedDay(replayDate);
        } else {
          const fallbackDay = new Date(Number(list.at(-1)?.time || 0) * 1000).toISOString().slice(0, 10);
          setSelectedDay(fallbackDay);
        }
        if (strategyType === 'wdo_opening_zones') { const td = dayMatches.length > 0 ? replayDate : new Date(Number(list.at(-1)?.time || 0) * 1000).toISOString().slice(0, 10); const upTo = list.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) <= td); const fIdx = upTo.findIndex((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === td); setReplayBars(fIdx > 0 ? fIdx : 1); } else { if (isTickMode) { setTickCursor(0); } else { setReplayBars(replayInitialBar); } }
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

  const handleLoadYearCandles = async () => {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    setIsLiveMode(false);
    setIsPlaying(false);
    setIsTickMode(false);
    setLoadingCandles(true);
    setCandleStatus(`Carregando hist\u00f3rico completo desde ${yearStart.split('-').reverse().join('/')} de ${resolvedSymbol} (${timeframe}) no MT5...`);
    try {
      const isWdoZones = strategyType === 'wdo_opening_zones';
      const dObj = new Date(`${replayDate}T12:00:00Z`); dObj.setUTCDate(dObj.getUTCDate() - 4); const fStart = Number.isNaN(dObj.getTime()) ? replayDate : dObj.toISOString().slice(0, 10); const dParam = loadUntilToday ? `from:${fStart}` : replayDate; const [list, h1List, d1List] = await Promise.all([
        syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, timeframe, { force: true, isManualRequest: true, date: `from:${yearStart}` }),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'H1', { force: true, isManualRequest: true, date: `from:${yearStart}` }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
        isWdoZones ? syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, 'D1', { force: true, isManualRequest: true, date: `from:${yearStart}` }).catch(() => new Array<LiveCandle>()) : Promise.resolve(new Array<LiveCandle>()),
      ]);
      if (isWdoZones) {
        setReplayMtfCandles({
          h1: Array.isArray(h1List) ? h1List : new Array<LiveCandle>(),
          d1: Array.isArray(d1List) ? d1List : new Array<LiveCandle>(),
        });
      }
      if (list && list.length > 0) {
        setCandles(list); if (loadUntilToday) { setSelectedDay('ALL'); const si = list.findIndex((x) => new Date(Number(x.time || 0) * 1000).toISOString().slice(0, 10) >= replayDate); setReplayBars(si > 0 ? si : 10); setCandleStatus('Multi-pregao pronto. Clique em 100% ou Play.'); return; }
        setSelectedDay('ALL');
        const firstDayStr = new Date(Number(list.at(0)?.time || 0) * 1000).toISOString().slice(0, 10);
        const secondDayIdx = list.findIndex((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) > firstDayStr);
        setReplayBars(secondDayIdx > 0 ? secondDayIdx : Math.min(list.length, 10));
        const daysCount = new Set(list.map((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10))).size;
        setCandleStatus(`Ano carregado: ${list.length} velas (${daysCount} preg\u00f5es). Clique em 100% ou Play para simular.`);
      } else {
        setCandleStatus(`Nenhum candle retornado desde ${yearStart.split('-').reverse().join('/')}. Verifique o hist\u00f3rico do ativo no MT5.`);
      }
    } catch {
      setCandleStatus('Falha ao carregar hist\u00f3rico anual no MT5. Verifique se o Servi\u00e7o do MT5 est\u00e1 conectado.');
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
    return firstIdx > 0 ? firstIdx : 1;
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
    if (!isPlaying) return;
    if (isTickMode && dayTicks.length > 0) {
      if (tickCursor >= dayTicks.length) {
        setIsPlaying(false);
        return;
      }
      const step = speedMs <= 80 ? 4 : speedMs <= 200 ? 2 : 1;
      const delay = Math.max(25, Math.min(250, Math.floor(speedMs / 3)));
      const id = window.setTimeout(() => {
        setTickCursor((prev) => Math.min(dayTicks.length, prev + step));
      }, delay);
      return () => window.clearTimeout(id);
    }
    if (activeCandles.length === 0) return;
    if (replayBars >= activeCandles.length) {
      setIsPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      setReplayBars((prev) => (prev >= activeCandles.length ? activeCandles.length : prev + 1));
    }, speedMs);
    return () => window.clearTimeout(id);
  }, [isPlaying, speedMs, replayBars, activeCandles.length, isTickMode, dayTicks.length, tickCursor]);

  const tickDrivenCandles = useMemo(() => {
    if (!isTickMode || dayTicks.length === 0) return null;
    const targetDay = selectedDay !== 'ALL' ? selectedDay : replayDate;
    const prior = activeCandles.filter((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) < targetDay);
    const limit = Math.max(0, Math.min(dayTicks.length, tickCursor));
    const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M15' ? 900 : timeframe === 'H1' ? 3600 : 300;
    const built = new Array<LiveCandle>();
    let curBucket = -1;
    for (let i = 0; i < limit; i++) {
      const t = dayTicks.at(i)!;
      const sec = Math.floor(Number(t[0]) / 1000);
      const price = Number(t[1]);
      const vol = Number(t[2]) || 1;
      const b = Math.floor(sec / tfSec) * tfSec;
      if (b !== curBucket || built.length === 0) {
        curBucket = b;
        built.push({ index: prior.length + built.length, timeLabel: '', time: b, open: price, high: price, low: price, close: price, volume: vol });
      } else {
        const last = built.at(built.length - 1)!;
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        last.close = price;
        last.volume = (last.volume || 0) + vol;
      }
    }
    return prior.concat(built);
  }, [isTickMode, dayTicks, tickCursor, selectedDay, replayDate, activeCandles, timeframe]);

  const effectiveCandles = tickDrivenCandles ?? activeCandles;

  const handleJumpToTime = () => {
    const clean = jumpTime.trim();
    const parts = clean.split(':');
    const hhNum = parts.length === 2 ? Number(parts.at(0)) : NaN;
    const mmNum = parts.length === 2 ? Number(parts.at(1)) : NaN;
    if (!Number.isInteger(hhNum) || !Number.isInteger(mmNum) || hhNum < 0 || hhNum > 23 || mmNum < 0 || mmNum > 59) {
      setCandleStatus('Hor\u00e1rio inv\u00e1lido. Use HH:MM (ex: 10:15).');
      return;
    }
    const targetHHMM = `${String(hhNum).padStart(2, '0')}:${String(mmNum).padStart(2, '0')}`;
    const targetMin = hhNum * 60 + mmNum;
    const targetDay = selectedDay !== 'ALL' ? selectedDay : replayDate;
    setIsPlaying(false);

    if (isTickMode && dayTicks.length > 0) {
      let foundIdx = dayTicks.length;
      for (let i = 0; i < dayTicks.length; i++) {
        const tickRow = dayTicks.at(i);
        if (!tickRow) continue;
        const sec = Math.floor(Number(tickRow.at(0)) / 1000);
        const iso = new Date(sec * 1000).toISOString();
        const hh = Number(iso.slice(11, 13));
        const mm = Number(iso.slice(14, 16));
        if (hh * 60 + mm >= targetMin) {
          foundIdx = i;
          break;
        }
      }
      setTickCursor(foundIdx);
      setCandleStatus(`Salto Tick a Tick para ${targetHHMM} (tick ${foundIdx}/${dayTicks.length}).`);
      return;
    }

    if (activeCandles.length > 0) {
      let targetIdx = -1;
      for (let i = 0; i < activeCandles.length; i++) {
        const candleRow = activeCandles.at(i);
        const cTime = Number(candleRow?.time || 0);
        if (!cTime) continue;
        const iso = new Date(cTime * 1000).toISOString();
        const cDay = iso.slice(0, 10);
        if (selectedDay !== 'ALL' && cDay !== targetDay) continue;
        const hh = Number(iso.slice(11, 13));
        const mm = Number(iso.slice(14, 16));
        if (hh * 60 + mm <= targetMin) {
          targetIdx = i + 1;
        }
      }
      if (targetIdx < replayInitialBar) {
        const firstDayIdx = activeCandles.findIndex((c) => new Date(Number(c.time || 0) * 1000).toISOString().slice(0, 10) === targetDay);
        targetIdx = firstDayIdx >= 0 ? Math.max(replayInitialBar, firstDayIdx + 1) : replayInitialBar;
      }
      const clamped = Math.min(activeCandles.length, Math.max(1, targetIdx));
      setReplayBars(clamped);
      setCandleStatus(`Salto para ${targetHHMM} (vela ${clamped}/${activeCandles.length}).`);
    }
  };
  const effectiveReplayBars = tickDrivenCandles ? tickDrivenCandles.length : replayBars;

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
      candles: effectiveCandles,
      maxBars: effectiveReplayBars > 0 ? effectiveReplayBars : effectiveCandles.length,
      startFromBar: strategyType === 'wdo_opening_zones' && selectedDay !== 'ALL' ? Math.max(4, replayInitialBar) : undefined,
      isTickMode,
    });
  }, [effectiveCandles, effectiveReplayBars, replayInitialBar, selectedDay, isTickMode, botName, resolvedSymbol, timeframe, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, onBullishSignal, onBearishSignal, risk]);

  const wdoReplayHud = useMemo(() => {
    if (strategyType !== 'wdo_opening_zones' || activeCandles.length === 0) return null;
    const targetCount = effectiveReplayBars > 0 ? Math.min(effectiveReplayBars, effectiveCandles.length) : effectiveCandles.length;
    const vis = effectiveCandles.slice(0, targetCount);
    const chPts = Math.max(1, Number(7) || 7);
    const rsiPer = Math.max(2, Number(rsiPeriod) || 7);
    return computeWdoHudState(vis, chPts, rsiPer, replayMtfCandles.h1, replayMtfCandles.d1, true, selectedDay);
  }, [strategyType, effectiveCandles, effectiveReplayBars, rsiPeriod, replayMtfCandles, selectedDay]);

  const tickFetchAbortRef = useRef(0);

  const handleToggleTickMode = async () => {
    if (isTickMode) {
      tickFetchAbortRef.current += 1;
      setIsPlaying(false);
      if (tickDrivenCandles && tickDrivenCandles.length > 0) {
        setReplayBars(Math.min(activeCandles.length, tickDrivenCandles.length));
      }
      setIsTickMode(false);
      return;
    }
    const targetDay = selectedDay !== 'ALL' ? selectedDay : replayDate;
    if (!targetDay || !resolvedSymbol) return;
    const runId = ++tickFetchAbortRef.current;
    setIsPlaying(false);
    setLoadingTicks(true);
    const brDate = targetDay.split('-').reverse().join('/');
    setCandleStatus(`Baixando pacote 09:00-10:00 (${brDate}) de ${resolvedSymbol}...`);

    const hours = ['09', '10', '11', '12', '13', '14', '15', '16', '17'];
    let accumulated = new Array<[number, number, number]>();

    for (let idx = 0; idx < hours.length; idx++) {
      if (tickFetchAbortRef.current !== runId) return;
      const hh = hours.at(idx)!;
      const res = await fetchReplayTicks(creds.channelId, creds.token, resolvedSymbol, targetDay, false, hh, hh);
      if (tickFetchAbortRef.current !== runId) return;

      if (res.ticks.length > 0) {
        accumulated = accumulated.concat(res.ticks);
        setDayTicks(accumulated);
        if (idx === 0) {
          const curCandleTime = Number(activeCandles.at(Math.max(0, Math.min(activeCandles.length - 1, replayBars - 1)))?.time || 0);
          const curDayStr = curCandleTime > 0 ? new Date(curCandleTime * 1000).toISOString().slice(0, 10) : '';
          let startCursor = 0;
          if (curDayStr === targetDay && replayBars < activeCandles.length) {
            const foundIdx = accumulated.findIndex((tk) => Math.floor(Number(tk[0]) / 1000) >= curCandleTime);
            if (foundIdx >= 0) startCursor = foundIdx + 1;
          }
          setTickCursor(startCursor);
          setIsTickMode(true);
          setLoadingTicks(false);
        }
        setCandleStatus(`Ticks (${brDate}): ${accumulated.length.toLocaleString('pt-BR')} negócios carregados (até ${hh}:59)...`);
      } else if (idx === 0) {
        setLoadingTicks(false);
        setCandleStatus(`Sem ticks reais para ${brDate} 09:00 (compile o Painel_Sync.mq5 no MT5 e reinicie o serviço).`);
        return;
      }
    }
    if (tickFetchAbortRef.current === runId) {
      setLoadingTicks(false);
      setCandleStatus(`Pregão ${brDate} completo em ticks (${accumulated.length.toLocaleString('pt-BR')} negócios em cache).`);
    }
  };

  const handleStepNextDay = () => {
    if (activeCandles.length === 0) return;
    setIsPlaying(false);
    const curIdx = Math.max(0, Math.min(activeCandles.length - 1, replayBars - 1));
    const curDay = new Date(Number(activeCandles.at(curIdx)?.time || 0) * 1000).toISOString().slice(0, 10);
    let lastOfCurDay = curIdx;
    while (lastOfCurDay + 1 < activeCandles.length && new Date(Number(activeCandles.at(lastOfCurDay + 1)?.time || 0) * 1000).toISOString().slice(0, 10) === curDay) {
      lastOfCurDay++;
    }
    if (replayBars < lastOfCurDay + 1) {
      setReplayBars(lastOfCurDay + 1);
    } else if (lastOfCurDay + 1 < activeCandles.length) {
      setReplayBars(lastOfCurDay + 2);
    } else {
      setReplayBars(activeCandles.length);
    }
  };

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
    const targetCount = effectiveReplayBars > 0 ? Math.min(effectiveReplayBars, effectiveCandles.length) : effectiveCandles.length;
    const visibleCandles = effectiveCandles.slice(0, targetCount);
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
      const wdoLines = computeWdoOpeningOverlayLines(visibleCandles, chPts, replayMtfCandles.h1, replayMtfCandles.d1, true, selectedDay);
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
  }, [effectiveCandles, effectiveReplayBars, simResult, strategyType, replayMtfCandles, selectedDay]);

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
      <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 w-full px-4 py-2 flex flex-col gap-2 overflow-hidden">
        <div className="shrink-0 rounded-xl bg-[#0F141C] border border-[#1E2633] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <select value={selectedBotId} onChange={(e) => handleSelectSavedBot(e.target.value)} className="max-w-[240px] px-2.5 py-1 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
              {savedRobots.length === 0 && <option value="" disabled>Nenhum robô criado</option>}
              {savedRobots.map((b) => (<option key={b.id} value={b.id}>{b.name} ({b.symbol})</option>))}
            </select>
            <button type="button" onClick={() => { setEditNotice(''); setIsEditModalOpen(true); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs text-sky-300 font-medium cursor-pointer">
              <Settings2 className="w-3.5 h-3.5" /><span>Editar</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" value={replayDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReplayDate(e.target.value)} style={{ colorScheme: 'dark' }} className="bg-[#090D12] border border-[#1E2633] rounded-lg px-2 py-1 text-xs font-mono text-gray-100 cursor-pointer" />
            <label title="Baixar todos os pregões da data selecionada até hoje e rodar em modo sequencial" className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#090D12] border border-[#1E2633] hover:border-sky-500/40 text-xs text-gray-200 cursor-pointer select-none">
              <input type="checkbox" checked={loadUntilToday} onChange={(e) => setLoadUntilToday(e.target.checked)} className="rounded border-gray-600 bg-[#090D12] text-sky-500 focus:ring-0 cursor-pointer" />
              <span>Até hoje</span>
            </label>
            <button type="button" onClick={handleLoadMt5Candles} disabled={loadingCandles && !isLiveMode} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60">
              <Download className="w-3.5 h-3.5" /><span>{loadingCandles && !isLiveMode ? 'Carregando...' : 'Carregar'}</span>
            </button>
            <button type="button" onClick={() => { setIsPlaying(false); setIsLiveMode((prev) => !prev); }} className={isLiveMode ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer ring-2 ring-sky-400/50' : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-sky-300 text-xs font-semibold cursor-pointer'}>
              <Radio className={isLiveMode ? 'w-3.5 h-3.5 animate-pulse' : 'w-3.5 h-3.5'} /><span>{isLiveMode ? 'Ao Vivo ON' : 'Ao Vivo'}</span>
            </button>
          </div>
        </div>

        <div className={isChartMaximized ? 'fixed top-0 inset-x-0 bottom-[50px] z-50 bg-[#090D12] px-4 pt-2 pb-0 flex flex-col gap-1.5' : 'flex-1 min-h-0 rounded-xl bg-[#0F141C] border border-[#1E2633] p-2.5 flex flex-col gap-1.5 overflow-hidden'}>
          <div className="relative z-20 shrink-0 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs min-w-0">
              <span className="text-[11px] text-gray-400 font-semibold">{resolvedSymbol} · {timeframe} · {botName}</span>
              {simResult && (() => {
                const sum = simResult.summary;
                const gw = simResult.trades.filter((t) => t.pnlBrl > 0).reduce((a, t) => a + t.pnlBrl, 0);
                const gl = Math.abs(simResult.trades.filter((t) => t.pnlBrl < 0).reduce((a, t) => a + t.pnlBrl, 0));
                const pf = gl > 0 && sum.wins > 0 && sum.losses > 0 ? (gw / sum.wins) / (gl / sum.losses) : gw > 0 ? 99.9 : 0;
                const zm = new Map<string, { zone: string; count: number; wins: number; pnl: number }>();
                for (const t of simResult.trades) {
                  const m = /\bZ[1-5]\b/i.exec(String(t.entryReason || ''));
                  const k = m ? m.at(0)!.toUpperCase() : 'Geral';
                  const cur = zm.get(k) || { zone: k, count: 0, wins: 0, pnl: 0 };
                  cur.count += 1; if (t.pnlBrl > 0) cur.wins += 1; cur.pnl = Number((cur.pnl + t.pnlBrl).toFixed(2));
                  zm.set(k, cur);
                }
                const zs = Array.from(zm.values()).sort((a, b) => a.zone.localeCompare(b.zone));
                return (
                  <>
                    <span className="text-gray-700">|</span>
                    <span><span className="text-gray-500 text-[10px]">Líq: </span><strong className={sum.netPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatBrl(sum.netPnlBrl)}</strong> <span className="text-[10px] text-gray-500">({sum.netPoints >= 0 ? '+' : ''}{sum.netPoints.toFixed(1)}p)</span></span>
                    <span><span className="text-gray-500 text-[10px]">Acerto: </span><strong className="text-gray-100">{sum.winRatePct.toFixed(1)}%</strong> <span className="text-[10px] text-gray-500">({sum.wins}W/{sum.losses}L)</span></span>
                    <span><span className="text-gray-500 text-[10px]">PF: </span><strong className={sum.profitFactor >= 1.3 ? 'text-emerald-400' : sum.profitFactor >= 1 ? 'text-sky-400' : 'text-rose-400'}>{Number.isFinite(sum.profitFactor) ? sum.profitFactor.toFixed(2) : '∞'}</strong></span>
                    <span><span className="text-gray-500 text-[10px]">Payoff: </span><strong className="text-amber-300">{pf.toFixed(2)}x</strong></span>
                    <span><span className="text-gray-500 text-[10px]">DD: </span><strong className="text-rose-400">-{formatBrl(sum.maxDrawdownBrl)}</strong></span>
                    <span><span className="text-gray-500 text-[10px]">Pos: </span><strong className="text-gray-200">{simResult.openPosition ? `${simResult.openPosition.side} ${simResult.openPosition.volume}x` : 'Zerado'}</strong></span>
                    {zs.map((z) => (
                      <span key={z.zone} className="px-1.5 py-0.5 rounded bg-[#090D12] border border-[#1E2633] inline-flex items-center gap-1 text-[10px]">
                        <strong className="text-sky-300">{z.zone}</strong>
                        <span className="text-gray-400">{z.count}({z.count > 0 ? Math.round((z.wins / z.count) * 100) : 0}%)</span>
                        <span className={z.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{z.pnl >= 0 ? '+' : ''}{formatBrl(z.pnl)}</span>
                      </span>
                    ))}
                  </>
                );
              })()}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <button type="button" onClick={() => setIsTradesDrawerOpen((p) => !p)} className={isTradesDrawerOpen ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600/20 border border-sky-400/50 text-sky-300 text-xs font-medium cursor-pointer' : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs font-medium cursor-pointer'}>
                {isTradesDrawerOpen ? <ChevronRight className="w-3.5 h-3.5 text-sky-400" /> : <ChevronLeft className="w-3.5 h-3.5 text-sky-400" />}
                <span>Operações ({simResult?.trades.length ?? 0})</span>
              </button>
              <button type="button" onClick={() => setIsChartMaximized((p) => !p)} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs font-medium text-gray-100 cursor-pointer">
                {isChartMaximized ? <><Minimize2 className="w-3.5 h-3.5 text-sky-400" /><span>Restaurar (ESC)</span></> : <><Maximize2 className="w-3.5 h-3.5 text-sky-400" /><span>Maximizar</span></>}
              </button>
            </div>
          </div>
          <div className="relative flex-1 w-full min-h-[340px] flex overflow-hidden">
            <div className="relative flex-1 min-w-0 h-full overflow-hidden">
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
            {!isTradesDrawerOpen && (
              <button
                type="button"
                onClick={() => setIsTradesDrawerOpen(true)}
                title="Expandir barra lateral de operações simuladas"
                className="shrink-0 w-7 h-full bg-[#090D12] hover:bg-[#161C25] border-l border-[#1E2633] flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-sky-300 cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[10px] font-mono tracking-wider [writing-mode:vertical-rl] rotate-180">
                  OPS ({simResult?.trades.length ?? 0})
                </span>
              </button>
            )}
            {isTradesDrawerOpen && (
              <aside className="shrink-0 w-[480px] max-w-[55vw] h-full bg-[#0F141C] border-l border-[#1E2633] flex flex-col">
                <div className="shrink-0 px-3.5 py-2 border-b border-[#1E2633] flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-100">Operações Simuladas ({simResult?.trades.length ?? 0})</span>
                  <button type="button" onClick={() => setIsTradesDrawerOpen(false)} className="p-1 rounded hover:bg-[#1E2633] text-gray-400 hover:text-gray-200 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 font-mono text-[11px]">
                  {!simResult || simResult.trades.length === 0 ? (
                    <div className="p-6 text-center text-xs text-gray-500 font-sans">Nenhuma operação executada até este ponto do replay.</div>
                  ) : (
                    [...simResult.trades].reverse().map((t) => (
                      <div key={t.id} className="rounded-lg bg-[#090D12]/90 border border-[#1E2633] hover:border-[#2E3A4B] px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2"><span className="text-[10px] text-gray-500">#{t.id}</span><span className={`text-xs font-bold ${t.side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side} {t.volume}x</span></div>
                          <span className={`shrink-0 whitespace-nowrap text-xs font-bold ${t.pnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.pnlBrl >= 0 ? '+' : ''}{formatBrl(t.pnlBrl)} <span className="text-[10px] font-normal opacity-80">({t.points >= 0 ? '+' : ''}{t.points}p)</span></span>
                        </div>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          {t.entryReason ? <span title={t.entryReason} className="truncate px-1.5 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-500/30 text-[10px]">{t.entryReason}</span> : <span className="text-[10px] text-gray-600">-</span>}
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${t.exitReason.toLowerCase().includes('take') ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30' : t.exitReason.toLowerCase().includes('stop') ? 'bg-rose-950/50 text-rose-300 border-rose-500/30' : 'bg-[#161C25] text-gray-300 border-[#2E3A4B]'}`}>{t.exitReason}</span>
                        </div>
                        <div className="pt-1 border-t border-[#1E2633]/70 flex items-center justify-between gap-2 text-[10px] text-gray-400">
                          <span>In: <strong className="font-normal text-gray-200">{t.entryLabel} @ {t.entryPrice}</strong></span>
                          <span>Out: <strong className="font-normal text-gray-200">{t.exitLabel} @ {t.exitPrice}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
        </div>
      </div>
      <div className={isChartMaximized ? "fixed bottom-0 inset-x-0 z-50 h-[50px] bg-[#090D12]/95 backdrop-blur border-t border-[#1E2633] px-4 flex items-center justify-between gap-3 shadow-2xl overflow-hidden" : "shrink-0 z-30 w-full h-[50px] bg-[#090D12]/90 border-t border-[#1E2633] px-4 flex items-center justify-between gap-3 overflow-hidden"}>
          <div className="shrink-0 flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
            <button type="button" disabled={candles.length === 0} onClick={() => { if (!isPlaying && replayBars >= candles.length) setReplayBars(replayInitialBar); setIsPlaying((p) => !p); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
              {isPlaying ? <><Pause className="w-3.5 h-3.5" /><span>Pausar</span></> : <><Play className="w-3.5 h-3.5" /><span>Play Replay</span></>}
            </button>
            <button type="button" disabled={activeCandles.length === 0 || replayBars >= activeCandles.length} onClick={() => { setIsPlaying(false); if (isTickMode) { setTickCursor((p) => Math.min(dayTicks.length, p + 1)); } else { setReplayBars((p) => Math.min(activeCandles.length, p + 1)); } }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /><span>+1 Vela</span>
            </button>
              <button type="button" disabled={activeCandles.length === 0 || loadingTicks} onClick={handleToggleTickMode} title="Alternar entre Replay Vela a Vela e Tick a Tick Real do MT5 (CopyTicksRange)" className={isTickMode ? "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-400/60 text-amber-300 text-xs font-semibold cursor-pointer disabled:opacity-40" : "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-300 text-xs cursor-pointer disabled:opacity-40"}>
                <span>{loadingTicks ? 'Baixando Ticks...' : isTickMode ? `Tick (${tickCursor}/${dayTicks.length})` : 'Tick a Tick'}</span>
              </button>
              <button type="button" disabled={activeCandles.length === 0 || replayBars >= activeCandles.length} onClick={handleStepNextDay} title="Avançar para o fim do pregão atual ou abertura do próximo dia" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-sky-700/50 text-sky-300 text-xs font-medium cursor-pointer disabled:opacity-40">
                <FastForward className="w-3.5 h-3.5" /><span>+1 Dia</span>
              </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); if (isTickMode) { setTickCursor(0); } else { setReplayBars(replayInitialBar); } }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /><span>Zerar</span>
            </button>
            <button type="button" disabled={activeCandles.length === 0} onClick={() => { setIsPlaying(false); if (isTickMode) { setTickCursor(dayTicks.length); } else { setReplayBars(activeCandles.length); } }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-emerald-300 text-xs cursor-pointer disabled:opacity-40">
              <FastForward className="w-3.5 h-3.5" /><span>100%</span>
            </button>
            <div className="inline-flex items-center rounded-lg bg-[#090D12] border border-[#2E3A4B] overflow-hidden">
              <input
                type="time"
                value={jumpTime}
                disabled={activeCandles.length === 0}
                onChange={(e) => setJumpTime(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleJumpToTime(); } }}
                title="Pular direto para um hor\u00e1rio do preg\u00e3o (HH:MM)"
                className="px-1.5 py-1 bg-transparent text-xs font-mono text-gray-200 focus:outline-none disabled:opacity-40 [color-scheme:dark]"
              />
              <button
                type="button"
                disabled={activeCandles.length === 0}
                onClick={handleJumpToTime}
                title="Ir para o hor\u00e1rio informado"
                className="px-2 py-1.5 bg-[#161C25] hover:bg-[#1E2633] border-l border-[#2E3A4B] text-sky-300 text-xs font-semibold cursor-pointer disabled:opacity-40"
              >
                Ir
              </button>
            </div>
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
                <option value="ALL">Todos (Multi-Preg\u00e3o)</option>
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
