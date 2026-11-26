import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Download,
  FastForward,
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

function generateSampleCandles(symbol: string, count = 300): LiveCandle[] {
  const isWdo = /^(WDO|DOL)/i.test(symbol);
  const step = isWdo ? 0.5 : /^(WIN|IND)/i.test(symbol) ? 5 : 0.01;
  let price = isWdo ? 5800 : /^(WIN|IND)/i.test(symbol) ? 128500 : 38.5;
  const nowSec = Math.floor(Date.now() / 1000) - count * 300;
  const out: LiveCandle[] = new Array();
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
  const [savedRobots, setSavedRobots] = useState<ManagedRobot[]>(new Array());
  const [selectedBotId, setSelectedBotId] = useState<string>('');

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
  const [risk, setRisk] = useState<ManagedRobotRisk>(DEFAULT_RISK);

  const [candles, setCandles] = useState<LiveCandle[]>(new Array());
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [candleStatus, setCandleStatus] = useState('Carregue velas do MT5 ou gere uma amostra para simular.');

  const [replayBars, setReplayBars] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState<number>(300);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlaySeriesRef = useRef<Array<ISeriesApi<'Line'>>>(new Array());

  useEffect(() => {
    fetchManagedRobots(creds.channelId, creds.token).then((list) => setSavedRobots(list)).catch(() => {});
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
    setRisk(found.risk);
  };

  const resolveSymbol = useCallback((raw: string) => {
    const u = raw.trim().toUpperCase();
    if (u.endsWith('$') && activeContracts) {
      const active = activeContracts[u.slice(0, -1)];
      if (active) return active.toUpperCase();
    }
    return u || 'WIN$';
  }, [activeContracts]);

  const handleLoadMt5Candles = async () => {
    setIsPlaying(false);
    setLoadingCandles(true);
    const resolved = resolveSymbol(symbol);
    setCandleStatus(`Buscando velas de ${resolved} (${timeframe}) no MT5...`);
    try {
      let list = await syncCandlesWithMt5(creds.channelId, creds.token, resolved, timeframe, { force: true, isManualRequest: true });
      if (!list || list.length === 0) {
        list = await fetchCandles(creds.channelId, creds.token, resolved, timeframe);
      }
      if (list && list.length > 0) {
        setCandles(list);
        setReplayBars(list.length);
        setCandleStatus(`${list.length} velas reais carregadas de ${resolved} (${timeframe}).`);
      } else {
        setCandleStatus(`Nenhuma vela retornada pelo MT5 para ${resolved}. Verifique se o Service está ativo ou use Amostra Sintética.`);
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
        if (prev >= candles.length) {
          setIsPlaying(false);
          return candles.length;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [isPlaying, speedMs, candles.length]);

  const simResult = useMemo(() => {
    if (candles.length < 6) return null;
    const params: ManagedRobotParams =
      strategyType === 'ema_cross'
        ? { maType, fastPeriod, slowPeriod }
        : strategyType === 'rsi_reversal'
          ? { rsiPeriod, oversold, overbought }
          : { lookbackBars };
    return runBacktestSimulation({
      robot: { name: botName, magicNumber: 9999, symbol: resolveSymbol(symbol), timeframe, enabled: true, strategyType, params: params as Record<string, unknown>, risk },
      candles,
      maxBars: replayBars > 0 ? replayBars : candles.length,
    });
  }, [candles, replayBars, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, botName, resolveSymbol, symbol, timeframe, risk]);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: { background: { type: ColorType.Solid, color: '#090D12' }, textColor: '#94A3B8' },
      grid: { vertLines: { color: '#1E2633' }, horzLines: { color: '#1E2633' } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#1E2633', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1E2633' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981', downColor: '#EF4444', borderUpColor: '#10B981', borderDownColor: '#EF4444', wickUpColor: '#10B981', wickDownColor: '#EF4444',
    });
    chartRef.current = chart;
    candleSeriesRef.current = series;
    const onResize = () => { if (chartWrapRef.current) chart.applyOptions({ width: chartWrapRef.current.clientWidth }); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      overlaySeriesRef.current = new Array();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    const visibleCandles = candles.slice(0, replayBars > 0 ? replayBars : candles.length);
    series.setData(visibleCandles.map((c) => ({ time: Number(c.time) as UTCTimestamp, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) })));
    for (const s of overlaySeriesRef.current) { try { chart.removeSeries(s); } catch {} }
    overlaySeriesRef.current = new Array();
    if (simResult) {
      for (const ov of simResult.overlays) {
        const line = chart.addSeries(LineSeries, { color: ov.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        const pts: Array<{ time: UTCTimestamp; value: number }> = new Array();
        visibleCandles.forEach((c, idx) => {
          const val = ov.values.at(idx);
          if (val !== null && val !== undefined) pts.push({ time: Number(c.time) as UTCTimestamp, value: val });
        });
        line.setData(pts);
        overlaySeriesRef.current.push(line);
      }
      const markers: Array<SeriesMarker<Time>> = new Array();
      for (const tr of simResult.trades) {
        markers.push({ time: tr.entryTime as UTCTimestamp, position: tr.side === 'COMPRA' ? 'belowBar' : 'aboveBar', color: tr.side === 'COMPRA' ? '#10B981' : '#EF4444', shape: tr.side === 'COMPRA' ? 'arrowUp' : 'arrowDown', text: tr.side === 'COMPRA' ? 'C' : 'V' });
        markers.push({ time: tr.exitTime as UTCTimestamp, position: tr.side === 'COMPRA' ? 'aboveBar' : 'belowBar', color: tr.pnlBrl >= 0 ? '#38BDF8' : '#F59E0B', shape: 'circle', text: tr.exitReason === 'Take Profit' ? 'TP' : tr.exitReason === 'Stop Loss' ? 'SL' : 'X' });
      }
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      createSeriesMarkers(series, markers);
    }
  }, [candles, replayBars, simResult]);

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
              <Download className="w-3.5 h-3.5" />
              <span>{loadingCandles ? 'Carregando...' : 'Puxar Velas do MT5'}</span>
            </button>
            <button type="button" onClick={handleGenerateSample} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs font-medium cursor-pointer">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Amostra Sintética (Offline)</span>
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

        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button type="button" disabled={candles.length === 0} onClick={() => { if (replayBars >= candles.length) setReplayBars(10); setIsPlaying((p) => !p); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pausar Replay' : 'Iniciar Replay'}</span>
            </button>
            <button type="button" disabled={candles.length === 0 || replayBars >= candles.length} onClick={() => { setIsPlaying(false); setReplayBars((b) => Math.min(candles.length, (b < 10 ? 10 : b) + 1)); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /><span>+1 Vela</span>
            </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(10); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-200 text-xs cursor-pointer disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /><span>Zerar Replay</span>
            </button>
            <button type="button" disabled={candles.length === 0} onClick={() => { setIsPlaying(false); setReplayBars(candles.length); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-emerald-300 text-xs cursor-pointer disabled:opacity-40">
              <FastForward className="w-3.5 h-3.5" /><span>Fim (100%)</span>
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
            <span>{candleStatus}</span>
            {candles.length > 0 && <span className="px-2 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-gray-200">Vela {replayBars} / {candles.length}</span>}
            <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} className="px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-200">
              <option value={600}>1x</option><option value={200}>3x</option><option value={60}>10x</option>
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

        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-3">
          <div ref={chartWrapRef} className="w-full h-[360px]" />
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
