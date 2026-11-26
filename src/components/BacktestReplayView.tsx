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
  RotateCcw,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { runBacktestSimulation } from '../engine/backtestSimulator';
import type {
  LiveCandle,
  ManagedRobot,
  ManagedRobotParams,
  SignalAction,
  ManagedRobotRisk,
  ManagedStrategyType,
  Mt5SyncCredentials,
} from '../types/trading';
import { fetchCandles, fetchManagedRobots, syncCandlesWithMt5 } from '../utils/mt5Bridge';

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

function toChartTime(raw: unknown, fallbackSec = 0): UTCTimestamp {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(fallbackSec) as UTCTimestamp;
  return (n > 1e11 ? Math.floor(n / 1000) : Math.floor(n)) as UTCTimestamp;
}

function generateSampleCandles(symbol: string, count = 350): LiveCandle[] {
  const isWdo = /^(WDO|DOL)/i.test(symbol);
  const step = isWdo ? 0.5 : /^(WIN|IND)/i.test(symbol) ? 5 : 0.01;
  let price = isWdo ? 5800 : /^(WIN|IND)/i.test(symbol) ? 128500 : 38.5;
  const nowSec = Math.floor(Date.now() / 1000) - count * 300;
  const out: LiveCandle[] = [];
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i / 14) * step * 6 + (Math.random() - 0.5) * step * 8;
    const open = Number(price.toFixed(2));
    const close = Number((price + wave).toFixed(2));
    const high = Number((Math.max(open, close) + Math.abs(Math.random() * step * 5)).toFixed(2));
    const low = Number((Math.min(open, close) - Math.abs(Math.random() * step * 5)).toFixed(2));
    const ts = nowSec + i * 300;
    const d = new Date(ts * 1000);
    const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    out.push({ index: i, time: ts, timeLabel, open, high, low, close, volume: Math.floor(100 + Math.random() * 900) });
    price = close;
  }
  return out;
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

  const [candles, setCandles] = useState<LiveCandle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [candleStatus, setCandleStatus] = useState('Carregue velas do MT5 ou gere uma amostra para simular.');
  const [replayBars, setReplayBars] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [isChartMaximized, setIsChartMaximized] = useState(false);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const overlaySeriesRef = useRef<Array<ISeriesApi<'Line'>>>([]);

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
    setIsPlaying(false);
    setLoadingCandles(true);
    setCandleStatus(`Buscando velas de ${resolvedSymbol} (${timeframe}) no MT5...`);
    try {
      let list = await syncCandlesWithMt5(creds.channelId, creds.token, resolvedSymbol, timeframe, { force: true, isManualRequest: true });
      if (!list || list.length === 0) list = await fetchCandles(creds.channelId, creds.token, resolvedSymbol, timeframe);
      if (list && list.length > 0) {
        setCandles(list);
        setReplayBars(list.length);
        setCandleStatus(`${list.length} velas reais carregadas de ${resolvedSymbol} (${timeframe}).`);
      } else {
        setCandleStatus(`Nenhuma vela retornada pelo MT5 para ${resolvedSymbol}. Verifique se o Service está ativo ou use Amostra Sintética.`);
      }
    } catch {
      setCandleStatus('Falha ao consultar MT5. Você pode testar offline usando Amostra Sintética.');
    } finally {
      setLoadingCandles(false);
    }
  };

  const handleGenerateSample = () => {
    setIsPlaying(false);
    const sample = generateSampleCandles(symbol, 350);
    setCandles(sample);
    setReplayBars(sample.length);
    setCandleStatus(`350 velas sintéticas geradas para ${symbol.toUpperCase()} (${timeframe}).`);
  };

  useEffect(() => {
    if (!isPlaying || candles.length === 0) return;
    const id = window.setInterval(() => {
      setReplayBars((prev) => {
        if (prev >= candles.length) { setIsPlaying(false); return candles.length; }
        return prev + 1;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [isPlaying, speedMs, candles.length]);

  const simResult = useMemo(() => {
    if (candles.length < 6) return null;
    const baseParams: ManagedRobotParams = strategyType === 'ema_cross'
      ? { maType, fastPeriod, slowPeriod }
      : strategyType === 'rsi_reversal'
        ? { rsiPeriod, oversold, overbought }
        : { lookbackBars };
    const params: ManagedRobotParams = { ...baseParams, onBullishSignal, onBearishSignal };
    return runBacktestSimulation({
      robot: { name: botName, magicNumber: 9999, symbol: resolvedSymbol, timeframe, enabled: true, strategyType, params: params as Record<string, unknown>, risk },
      candles,
      maxBars: replayBars > 0 ? replayBars : candles.length,
    });
  }, [candles, replayBars, botName, resolvedSymbol, timeframe, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, onBullishSignal, onBearishSignal, risk]);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      kineticScroll: { touch: true, mouse: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      layout: { background: { type: ColorType.Solid, color: '#090D12' }, textColor: '#94A3B8' },
      grid: { vertLines: { color: '#1E2633' }, horzLines: { color: '#1E2633' } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#1E2633', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1E2633' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981', downColor: '#EF4444', borderUpColor: '#10B981', borderDownColor: '#EF4444', wickUpColor: '#10B981', wickDownColor: '#EF4444',
    });
    markersPluginRef.current = createSeriesMarkers(series, []);
    chartRef.current = chart;
    candleSeriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersPluginRef.current = null;
      priceLinesRef.current = [];
      overlaySeriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    const visibleCandles = candles.slice(0, replayBars > 0 ? replayBars : candles.length);
    const baseSec = Math.floor(Date.now() / 1000) - visibleCandles.length * 60;
    const barTimes = visibleCandles.map((c, idx) => toChartTime(c.time, baseSec + idx * 60));
    series.setData(visibleCandles.map((c, idx) => ({
      time: barTimes[idx], open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
    })));
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];
    const overlays = simResult?.overlays ?? [];
    while (overlaySeriesRef.current.length > overlays.length) {
      const removed = overlaySeriesRef.current.pop();
      if (removed) { try { chart.removeSeries(removed); } catch {} }
    }
    overlays.forEach((ov, ovIdx) => {
      let line = overlaySeriesRef.current[ovIdx];
      if (!line) {
        line = chart.addSeries(LineSeries, { color: ov.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        overlaySeriesRef.current[ovIdx] = line;
      } else {
        line.applyOptions({ color: ov.color });
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
      for (const tr of simResult.trades) {
        markers.push({ time: toChartTime(tr.entryTime), position: tr.side === 'COMPRA' ? 'belowBar' : 'aboveBar', color: tr.side === 'COMPRA' ? '#10B981' : '#EF4444', shape: tr.side === 'COMPRA' ? 'arrowUp' : 'arrowDown', text: tr.side === 'COMPRA' ? 'C' : 'V' });
        markers.push({ time: toChartTime(tr.exitTime), position: tr.side === 'COMPRA' ? 'aboveBar' : 'belowBar', color: tr.pnlBrl >= 0 ? '#38BDF8' : '#F59E0B', shape: 'circle', text: tr.exitReason === 'Take Profit' ? 'TP' : tr.exitReason === 'Stop Loss' ? 'SL' : 'X' });
      }
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      markersPluginRef.current?.setMarkers(markers);
      if (simResult.openPosition) {
        const op = simResult.openPosition;
        priceLinesRef.current.push(series.createPriceLine({ price: op.entryPrice, color: op.side === 'COMPRA' ? '#10B981' : '#EF4444', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `${op.side} ${op.volume}x` }));
        if (op.tp > 0) priceLinesRef.current.push(series.createPriceLine({ price: op.tp, color: '#38BDF8', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP' }));
        if (op.sl > 0) priceLinesRef.current.push(series.createPriceLine({ price: op.sl, color: '#F59E0B', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL' }));
      }
    } else {
      markersPluginRef.current?.setMarkers([]);
    }
  }, [candles, replayBars, simResult]);

  useEffect(() => {
    if (!isChartMaximized) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsChartMaximized(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isChartMaximized]);

  const formatBrl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 bg-[#090D12]">
      <div className="max-w-[1320px] w-full mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-gray-100">Simulador de Backtest & Replay</h1>
            <p className="text-xs text-gray-400 mt-0.5">Teste qualquer robô criado no painel sobre velas históricas reais do MT5 ou avance vela por vela no modo Replay.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleLoadMt5Candles} disabled={loadingCandles} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60">
              <Download className="w-3.5 h-3.5" /><span>{loadingCandles ? 'Carregando...' : 'Puxar Velas do MT5'}</span>
            </button>
            <button type="button" onClick={handleGenerateSample} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs font-medium cursor-pointer">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" /><span>Amostra Sintética (Offline)</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="col-span-2">
            <label className="block text-[10px] text-gray-400 mb-1">Carregar Robô Salvo</label>
            <select value={selectedBotId} onChange={(e) => handleSelectSavedBot(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100">
              <option value="">-- Configuração Manual --</option>
              {savedRobots.map((b) => (<option key={b.id} value={b.id}>{b.name} ({b.symbol} · {b.timeframe})</option>))}
            </select>
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
              <option value="breakout">Rompimento ({lookbackBars}v)</option>
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


        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs">
          <span className="text-[11px] font-semibold text-gray-300">Regra de Disparo:</span>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={candles.length === 0} onClick={() => { if (!isPlaying && replayBars >= candles.length) setReplayBars(Math.min(10, candles.length)); setIsPlaying((p) => !p); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
              {isPlaying ? <><Pause className="w-3.5 h-3.5" /><span>Pausar</span></> : <><Play className="w-3.5 h-3.5" /><span>Play Replay</span></>}
            </button>
            <button type="button" disabled={candles.length === 0 || replayBars >= candles.length} onClick={() => { setIsPlaying(false); setReplayBars((p) => Math.min(candles.length, p + 1)); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /><span>+1 Vela</span>
            </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(10); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /><span>Zerar</span>
            </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(candles.length); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-emerald-300 text-xs cursor-pointer disabled:opacity-40">
              <FastForward className="w-3.5 h-3.5" /><span>100%</span>
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
            <span>{candleStatus}</span>
            {candles.length > 0 && <span className="px-2 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-gray-200">Vela {replayBars} / {candles.length}</span>}
            <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-200">
              <option value={1200}>0.5x</option>
              <option value={600}>1x</option>
              <option value={200}>3x</option>
              <option value={60}>10x</option>
            </select>
          </div>
        </div>

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

        <div className={isChartMaximized ? 'fixed inset-0 z-50 w-screen h-screen bg-[#090D12] p-4 flex flex-col gap-2' : 'rounded-xl bg-[#0F141C] border border-[#1E2633] p-3 flex flex-col gap-2'}>
          <div className="relative z-20 shrink-0 flex items-center justify-between px-1">
            <span className="text-[11px] font-mono text-gray-400">{resolvedSymbol} · {timeframe} · {botName}</span>
            <button type="button" onClick={() => setIsChartMaximized((p) => !p)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-xs font-medium text-gray-100 cursor-pointer">
              {isChartMaximized ? <><Minimize2 className="w-3.5 h-3.5 text-sky-400" /><span>Restaurar (ESC)</span></> : <><Maximize2 className="w-3.5 h-3.5 text-sky-400" /><span>Maximizar</span></>}
            </button>
          </div>
          <div className={isChartMaximized ? 'relative flex-1 w-full min-h-0 overflow-hidden' : 'relative w-full h-[380px] overflow-hidden'}>
            <div ref={chartWrapRef} className="absolute inset-0" />
          </div>
        </div>

        {simResult && simResult.trades.length > 0 && (
          <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E2633] text-xs font-semibold text-gray-200">Operações Simuladas ({simResult.trades.length})</div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090D12] text-[10px] text-gray-400 uppercase">
                  <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Lado</th><th className="px-4 py-2">Entrada</th><th className="px-4 py-2">Saída</th><th className="px-4 py-2">Motivo</th><th className="px-4 py-2 text-right">Pts</th><th className="px-4 py-2 text-right">Resultado</th></tr>
                </thead>
                <tbody className="divide-y divide-[#1E2633]">
                  {[...simResult.trades].reverse().map((t) => (
                    <tr key={t.id} className="hover:bg-[#161C25]">
                      <td className="px-4 py-2 text-gray-500">{t.id}</td>
                      <td className={`px-4 py-2 font-semibold ${t.side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side} {t.volume}x</td>
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
  );
}
