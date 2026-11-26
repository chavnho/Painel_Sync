import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Pause, Pencil, Play, Plus, RefreshCw, ShieldAlert, Trash2, TrendingUp, X } from 'lucide-react';
import type {
  ManagedRobot,
  ManagedRobotParams,
  SignalAction,
  ManagedRobotRisk,
  LiveCandle,
  ManagedStrategyType,
  Mt5SyncCredentials,
} from '../types/trading';
import {
  createManagedRobotApi,
  deleteManagedRobotApi,
  fetchManagedRobots,
  syncCandlesWithMt5,
  fetchSymbolTickSpec,
  updateManagedRobotApi,
} from '../utils/mt5Bridge';
import { runBacktestSimulation } from '../engine/backtestSimulator';

interface RobotBuilderViewProps {
  creds: Mt5SyncCredentials;
}


interface LocalAssetSpec {
  tickSize: number;
  digits: number;
  isTickCountUnit: boolean;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

function inferLocalTickInfo(sym: string): LocalAssetSpec {
  const u = String(sym || '').trim().toUpperCase();
  const lot = /^(IND|DOL)/.test(u)
    ? { volumeMin: 5, volumeMax: 10000, volumeStep: 5 }
    : /^(WIN|WDO|BIT|CCM|BGI|ICF)/.test(u)
      ? { volumeMin: 1, volumeMax: 10000, volumeStep: 1 }
      : /^[A-Z]{4}(3|4|5|6|11)F$/.test(u)
        ? { volumeMin: 1, volumeMax: 99, volumeStep: 1 }
        : /^[A-Z]{4}(3|4|5|6|11)$/.test(u)
          ? { volumeMin: 100, volumeMax: 1000000, volumeStep: 100 }
          : { volumeMin: 1, volumeMax: 100000, volumeStep: 1 };

  if (/^(WIN|IND)/.test(u)) return { tickSize: 5, digits: 0, isTickCountUnit: false, ...lot };
  if (/^(WDO|DOL)/.test(u)) return { tickSize: 0.5, digits: 1, isTickCountUnit: false, ...lot };
  if (/^BIT/.test(u)) return { tickSize: 20, digits: 0, isTickCountUnit: false, ...lot };
  if (/^(BGI|ICF)/.test(u)) return { tickSize: 0.05, digits: 2, isTickCountUnit: true, ...lot };
  return { tickSize: 0.01, digits: 2, isTickCountUnit: true, ...lot };
}

function snapVolumeValue(val: number, spec: Pick<LocalAssetSpec, 'volumeMin' | 'volumeMax' | 'volumeStep'>): number {
  const step = spec.volumeStep > 0 ? spec.volumeStep : 1;
  const min = spec.volumeMin > 0 ? spec.volumeMin : step;
  const max = spec.volumeMax >= min ? spec.volumeMax : 1000000;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return min;
  const steps = Math.max(0, Math.round((n - min) / step));
  const snapped = Math.min(max, Math.max(min, min + steps * step));
  const dec = step < 1 ? Math.max(1, String(step).split('.').at(1)?.length || 2) : 0;
  return Number(snapped.toFixed(dec));
}

function snapRiskValue(val: number, spec: LocalAssetSpec): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (spec.isTickCountUnit) return Math.max(1, Math.round(n));
  const snapped = Math.round(n / spec.tickSize) * spec.tickSize;
  return Number(Math.max(spec.tickSize, snapped).toFixed(spec.digits));
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

export function RobotBuilderView({ creds }: RobotBuilderViewProps) {
  const [robots, setRobots] = useState<ManagedRobot[]>(new Array());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [name, setName] = useState('Cruzamento EMA 9x21');
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
  const [previewCandles, setPreviewCandles] = useState<Array<LiveCandle>>(() => new Array<LiveCandle>());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  useEffect(() => { const cleanSym = symbol.trim().toUpperCase(); if (!cleanSym) { setPreviewCandles(new Array<LiveCandle>()); return; } let cancelled = false; const controller = new AbortController(); const timer = window.setTimeout(async () => { setPreviewLoading(true); try { const list = await syncCandlesWithMt5(creds.channelId, creds.token, cleanSym, timeframe, { force: previewNonce > 0, signal: controller.signal, timeoutMs: 12000 }); if (!cancelled) setPreviewCandles(Array.isArray(list) ? list : new Array<LiveCandle>()); } catch { if (!cancelled) setPreviewCandles(new Array<LiveCandle>()); } finally { if (!cancelled) setPreviewLoading(false); } }, 350); return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); }; }, [symbol, timeframe, creds.channelId, creds.token, previewNonce]);
  const [tickSpec, setTickSpec] = useState<LocalAssetSpec>(() => inferLocalTickInfo('WIN' + '$'));
  const backtestPreview = useMemo(() => { if (previewCandles.length < 15) return null; const baseParams: ManagedRobotParams = strategyType === 'ema_cross' ? { maType, fastPeriod, slowPeriod } : strategyType === 'rsi_reversal' ? { rsiPeriod, oversold, overbought } : { lookbackBars }; return runBacktestSimulation({ robot: { name: name.trim() || 'Previa', symbol: symbol.trim().toUpperCase() || 'WIN$', timeframe, enabled: true, magicNumber: 9001, strategyType, params: { ...baseParams, onBullishSignal, onBearishSignal }, risk: { ...risk, volume: snapVolumeValue(risk.volume, tickSpec), stopPoints: snapRiskValue(risk.stopPoints, tickSpec), takePoints: snapRiskValue(risk.takePoints, tickSpec) } }, candles: previewCandles }); }, [previewCandles, name, symbol, timeframe, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, onBullishSignal, onBearishSignal, risk, tickSpec]);

  useEffect(() => {
    const local = inferLocalTickInfo(symbol);
    setTickSpec(local);
    setRisk((r) => ({ ...r, volume: snapVolumeValue(r.volume, local) }));
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const remote = await fetchSymbolTickSpec(creds.channelId, creds.token, symbol);
      if (!cancelled && remote && remote.tickSize > 0) {
        const nextSpec: LocalAssetSpec = {
          tickSize: remote.tickSize,
          digits: remote.digits,
          isTickCountUnit: remote.isTickCountUnit,
          volumeMin: remote.volumeMin || local.volumeMin,
          volumeMax: remote.volumeMax || local.volumeMax,
          volumeStep: remote.volumeStep || local.volumeStep,
        };
        setTickSpec(nextSpec);
        setRisk((r) => ({ ...r, volume: snapVolumeValue(r.volume, nextSpec) }));
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [symbol, creds.channelId, creds.token]);

  const loadList = useCallback(async () => {
    try {
      const list = await fetchManagedRobots(creds.channelId, creds.token);
      setRobots(list);
    } finally {
      setLoading(false);
    }
  }, [creds.channelId, creds.token]);

  useEffect(() => {
    loadList();
    const id = window.setInterval(loadList, 3000);
    return () => window.clearInterval(id);
  }, [loadList]);

  const resetForm = () => {
    setEditingId(null);
    setName('Cruzamento EMA 9x21');
    setSymbol('WIN$');
    setTimeframe('M5');
    setStrategyType('ema_cross');
    setMaType('EMA');
    setFastPeriod(9);
    setSlowPeriod(21);
    setRsiPeriod(14);
    setOversold(30);
    setOverbought(70);
    setLookbackBars(10);
    setOnBullishSignal('BUY');
    setOnBearishSignal('SELL');
    setRisk(DEFAULT_RISK);
    setErrorMsg(null);
  };

  const handleEdit = (bot: ManagedRobot) => {
    setEditingId(bot.id);
    setName(bot.name);
    setSymbol(bot.symbol);
    setTimeframe(bot.timeframe);
    setStrategyType(bot.strategyType);
    setMaType(bot.params.maType === 'SMA' ? 'SMA' : 'EMA');
    setFastPeriod(Number(bot.params.fastPeriod) || 9);
    setSlowPeriod(Number(bot.params.slowPeriod) || 21);
    setRsiPeriod(Number(bot.params.rsiPeriod) || 14);
    setOversold(Number(bot.params.oversold) || 30);
    setOverbought(Number(bot.params.overbought) || 70);
    setLookbackBars(Number(bot.params.lookbackBars) || 10);
    setOnBullishSignal((bot.params.onBullishSignal as SignalAction) || 'BUY');
    setOnBearishSignal((bot.params.onBearishSignal as SignalAction) || 'SELL');
    setRisk(bot.risk);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const normalizedRisk: ManagedRobotRisk = {
        ...risk,
        volume: snapVolumeValue(risk.volume, tickSpec),
        stopPoints: snapRiskValue(risk.stopPoints, tickSpec),
        takePoints: snapRiskValue(risk.takePoints, tickSpec),
      };
      setRisk(normalizedRisk);
      const baseParams: ManagedRobotParams =
        strategyType === 'ema_cross'
          ? { maType, fastPeriod, slowPeriod }
          : strategyType === 'rsi_reversal'
            ? { rsiPeriod, oversold, overbought }
            : { lookbackBars };
      const params: ManagedRobotParams = { ...baseParams, onBullishSignal, onBearishSignal };

      if (editingId) {
        await updateManagedRobotApi(creds.channelId, creds.token, editingId, {
          name,
          symbol,
          timeframe,
          strategyType,
          params,
          risk: normalizedRisk,
        });
      } else {
        await createManagedRobotApi(creds.channelId, creds.token, {
          name,
          symbol,
          timeframe,
          enabled: false,
          strategyType,
          params,
          risk: normalizedRisk,
        });
      }
      resetForm();
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar robo');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (bot: ManagedRobot) => {
    try {
      await updateManagedRobotApi(creds.channelId, creds.token, bot.id, { enabled: !bot.enabled });
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao alterar status');
    }
  };

  const handleDelete = async (robotId: string) => {
    try {
      await deleteManagedRobotApi(creds.channelId, creds.token, robotId);
      setConfirmDeleteId(null);
      if (editingId === robotId) resetForm();
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao excluir robo');
    }
  };

  const strategyLabel = (st: ManagedStrategyType) =>
    st === 'ema_cross' ? 'Cruzamento de Médias' : st === 'rsi_reversal' ? 'Reversão IFR (RSI)' : 'Rompimento de Canal';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 bg-[#090D12]">
      <div className="max-w-[1320px] w-full mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-gray-100 flex items-center gap-2">
              <Bot className="w-5 h-5 text-emerald-400" />
              <span>Robôs Gerenciados pelo App</span>
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Crie estratégias no painel e envie ordens automaticamente pelo Serviço do MetaTrader 5 sem compilar EAs externos.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-300">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Novos robôs iniciam pausados por segurança</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form onSubmit={handleSubmit} className="lg:col-span-5 rounded-xl bg-[#0F141C] border border-[#1E2633] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E2633] pb-3">
              <h2 className="text-sm font-semibold text-gray-100">{editingId ? 'Editar Robô' : 'Novo Robô'}</h2>
              {editingId && (
                <button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 cursor-pointer">
                  <X className="w-3.5 h-3.5" /> Cancelar edição
                </button>
              )}
            </div>

            {errorMsg && <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300">{errorMsg}</div>}

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Nome do Robô</label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100 focus:outline-none focus:border-emerald-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Ativo (ex: WIN$, WDO$)</label>
                  <input type="text" required value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Timeframe</label>
                  <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as 'M1' | 'M5' | 'M15' | 'M30' | 'H1')} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100 focus:outline-none focus:border-emerald-500">
                    <option value="M1">M1 (1 min)</option>
                    <option value="M5">M5 (5 min)</option>
                    <option value="M15">M15 (15 min)</option>
                    <option value="M30">M30 (30 min)</option>
                    <option value="H1">H1 (1 hora)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Estratégia</label>
                <select value={strategyType} onChange={(e) => setStrategyType(e.target.value as ManagedStrategyType)} className="w-full px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] text-xs text-gray-100 focus:outline-none focus:border-emerald-500">
                  <option value="ema_cross">Cruzamento de Médias (EMA / SMA)</option>
                  <option value="rsi_reversal">Reversão por IFR / RSI</option>
                  <option value="breakout">Rompimento de Máxima / Mínima</option>
                </select>
              </div>

              {strategyType === 'ema_cross' && (
                <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg bg-[#090D12] border border-[#1E2633]">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Tipo</label>
                    <select value={maType} onChange={(e) => setMaType(e.target.value as 'EMA' | 'SMA')} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs text-gray-100">
                      <option value="EMA">EMA</option>
                      <option value="SMA">SMA</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Média Rápida</label>
                    <input type="number" min={2} max={200} value={fastPeriod} onChange={(e) => setFastPeriod(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Média Lenta</label>
                    <input type="number" min={3} max={400} value={slowPeriod} onChange={(e) => setSlowPeriod(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                </div>
              )}

              {strategyType === 'rsi_reversal' && (
                <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg bg-[#090D12] border border-[#1E2633]">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Período IFR</label>
                    <input type="number" min={2} max={100} value={rsiPeriod} onChange={(e) => setRsiPeriod(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Sobrevenda</label>
                    <input type="number" min={5} max={49} value={oversold} onChange={(e) => setOversold(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Sobrecompra</label>
                    <input type="number" min={51} max={95} value={overbought} onChange={(e) => setOverbought(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                </div>
              )}

              {strategyType === 'breakout' && (
                <div className="p-3 rounded-lg bg-[#090D12] border border-[#1E2633]">
                  <label className="block text-[10px] text-gray-400 mb-1">Candles anteriores (Lookback)</label>
                  <input type="number" min={2} max={200} value={lookbackBars} onChange={(e) => setLookbackBars(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs font-mono text-gray-100" />
                </div>
              )}


              <div className="grid grid-cols-2 gap-2.5 p-3 rounded-lg bg-[#090D12] border border-[#1E2633]">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">
                    {strategyType === 'ema_cross' ? 'Cruza para Cima' : strategyType === 'rsi_reversal' ? 'Sai de Sobrevenda' : 'Rompe Máxima'}
                  </label>
                  <select value={onBullishSignal} onChange={(e) => setOnBullishSignal(e.target.value as SignalAction)} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs text-gray-100">
                    <option value="BUY">Comprar</option>
                    <option value="SELL">Vender (Reversão)</option>
                    <option value="NONE">Ignorar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">
                    {strategyType === 'ema_cross' ? 'Cruza para Baixo' : strategyType === 'rsi_reversal' ? 'Sai de Sobrecompra' : 'Rompe Mínima'}
                  </label>
                  <select value={onBearishSignal} onChange={(e) => setOnBearishSignal(e.target.value as SignalAction)} className="w-full px-2 py-1.5 rounded bg-[#0F141C] border border-[#1E2633] text-xs text-gray-100">
                    <option value="SELL">Vender</option>
                    <option value="BUY">Comprar (Reversão)</option>
                    <option value="NONE">Ignorar</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-[#1E2633] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-gray-300">Gestão de Risco & Horários</span>
                  <span className="px-2 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-[10px] font-mono text-sky-300">
                    {tickSpec.isTickCountUnit
                      ? `Tick: R$ ${tickSpec.tickSize.toFixed(tickSpec.digits)} (em ticks)`
                      : `Tick: ${tickSpec.tickSize} pt${tickSpec.tickSize > 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Volume (lote {tickSpec.volumeStep})</label>
                    <input
                      type="number"
                      step={tickSpec.volumeStep}
                      min={tickSpec.volumeMin}
                      max={tickSpec.volumeMax}
                      value={risk.volume}
                      onChange={(e) => setRisk({ ...risk, volume: Math.max(0, Number(e.target.value) || 0) })}
                      onBlur={() => setRisk((r) => ({ ...r, volume: snapVolumeValue(r.volume, tickSpec) }))}
                      className="w-full px-2.5 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">
                      Stop Loss ({tickSpec.isTickCountUnit ? `ticks = R$ ${(risk.stopPoints * tickSpec.tickSize).toFixed(2)}` : 'pts'})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step={tickSpec.isTickCountUnit ? 1 : tickSpec.tickSize}
                      value={risk.stopPoints}
                      onChange={(e) => setRisk({ ...risk, stopPoints: Math.max(0, Number(e.target.value) || 0) })}
                      onBlur={() => setRisk((r) => ({ ...r, stopPoints: snapRiskValue(r.stopPoints, tickSpec) }))}
                      className="w-full px-2.5 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">
                      Take Profit ({tickSpec.isTickCountUnit ? `ticks = R$ ${(risk.takePoints * tickSpec.tickSize).toFixed(2)}` : 'pts'})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step={tickSpec.isTickCountUnit ? 1 : tickSpec.tickSize}
                      value={risk.takePoints}
                      onChange={(e) => setRisk({ ...risk, takePoints: Math.max(0, Number(e.target.value) || 0) })}
                      onBlur={() => setRisk((r) => ({ ...r, takePoints: snapRiskValue(r.takePoints, tickSpec) }))}
                      className="w-full px-2.5 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Início</label>
                    <input type="time" value={risk.startTime} onChange={(e) => setRisk({ ...risk, startTime: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Fim Entradas</label>
                    <input type="time" value={risk.endTime} onChange={(e) => setRisk({ ...risk, endTime: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Zeragem Dia</label>
                    <input type="time" value={risk.closeTime} onChange={(e) => setRisk({ ...risk, closeTime: e.target.value })} className="w-full px-2 py-1.5 rounded bg-[#090D12] border border-[#1E2633] text-xs font-mono text-gray-100" />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-[#090D12] border border-[#1E2633] p-3 space-y-2.5"><div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-200"><TrendingUp className="w-3.5 h-3.5 text-sky-400" /><span>Prévia de Backtest ({previewCandles.length} velas {timeframe})</span></span><button type="button" disabled={previewLoading} onClick={() => setPreviewNonce((n) => n + 1)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-[10px] text-sky-300 cursor-pointer disabled:opacity-50"><RefreshCw className={previewLoading ? "w-3 h-3 animate-spin" : "w-3 h-3"} /><span>{previewLoading ? "Buscando..." : "Atualizar"}</span></button></div>{backtestPreview ? (<div className="grid grid-cols-4 gap-2 text-center font-mono"><div className="rounded bg-[#0F141C] border border-[#1E2633] p-2"><div className="text-[9px] text-gray-400 uppercase">Líquido</div><div className={"text-xs font-bold mt-0.5 " + (backtestPreview.summary.netPnlBrl >= 0 ? "text-emerald-400" : "text-rose-400")}>{backtestPreview.summary.netPnlBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div><div className="text-[9px] text-gray-500">{backtestPreview.summary.netPoints} pts</div></div><div className="rounded bg-[#0F141C] border border-[#1E2633] p-2"><div className="text-[9px] text-gray-400 uppercase">Acerto</div><div className="text-xs font-bold text-gray-100 mt-0.5">{backtestPreview.summary.winRatePct}%</div><div className="text-[9px] text-gray-500">{backtestPreview.summary.wins}W/{backtestPreview.summary.losses}L</div></div><div className="rounded bg-[#0F141C] border border-[#1E2633] p-2"><div className="text-[9px] text-gray-400 uppercase">Profit F.</div><div className="text-xs font-bold text-sky-400 mt-0.5">{backtestPreview.summary.profitFactor.toFixed(2)}</div><div className="text-[9px] text-gray-500">{backtestPreview.summary.totalTrades} trades</div></div><div className="rounded bg-[#0F141C] border border-[#1E2633] p-2"><div className="text-[9px] text-gray-400 uppercase">Drawdown</div><div className="text-xs font-bold text-rose-400 mt-0.5">-{backtestPreview.summary.maxDrawdownBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div><div className="text-[9px] text-gray-500">máx.</div></div></div>) : (<div className="text-[11px] text-gray-500 text-center py-1.5">{previewLoading ? "Carregando histórico real do MT5 para simular..." : "Aguardando velas do ativo no MT5 para calcular prévia."}</div>)}</div>
            <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60">
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Criar Robô (Pausado)'}</span>
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {loading ? (
              <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center text-xs text-gray-400">
                Carregando robôs gerenciados...
              </div>
            ) : robots.length === 0 ? (
              <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center space-y-2">
                <div className="text-sm font-medium text-gray-200">Nenhum robô criado no painel ainda</div>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  Configure uma estratégia ao lado. Assim que você clicar em Ligar, o servidor avaliará os candles e enviará as ordens pelo Serviço do MT5.
                </p>
              </div>
            ) : (
              robots.map((bot) => (
                <div key={bot.id} className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-100">{bot.name}</span>
                        <span className="px-2 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-[10px] font-mono text-gray-400">
                          Magic #{bot.magicNumber}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${bot.enabled ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40' : 'bg-gray-800/70 text-gray-400 border border-gray-700'}`}>
                          {bot.enabled ? 'Ativo' : 'Pausado'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 font-mono mt-1">
                        {bot.symbol} · {bot.timeframe} · {strategyLabel(bot.strategyType)} · Vol {bot.risk.volume} · SL {bot.risk.stopPoints} / TP {bot.risk.takePoints} pts
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleEnabled(bot)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${bot.enabled ? 'bg-amber-950/40 hover:bg-amber-950/70 text-amber-300 border-amber-500/40' : 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-500/50'}`}
                      >
                        {bot.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        <span>{bot.enabled ? 'Pausar' : 'Ligar'}</span>
                      </button>

                      <button type="button" onClick={() => handleEdit(bot)} title="Editar" className="p-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#1E2633] text-gray-300 cursor-pointer">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {confirmDeleteId === bot.id ? (
                        <button type="button" onClick={() => handleDelete(bot.id)} className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer">
                          Confirmar
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(bot.id)} title="Excluir" className="p-2 rounded-lg bg-[#161C25] hover:bg-rose-950/50 border border-[#1E2633] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] flex items-center justify-between gap-2 text-[11px] font-mono text-gray-300">
                    <span className="inline-flex items-center gap-1.5 truncate">
                      <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${bot.enabled ? 'text-emerald-400' : 'text-gray-500'}`} />
                      <span className="truncate">{bot.lastDecision || 'Aguardando próximo ciclo de candles...'}</span>
                    </span>
                    <span className="text-gray-500 shrink-0">{bot.risk.startTime}–{bot.risk.endTime}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
