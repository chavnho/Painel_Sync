import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Pause, Pencil, Play, Plus, ArrowDownLeft, ArrowUpRight, CandlestickChart, Check, Copy, Eye, EyeOff, PanelRightClose, PanelRightOpen, ShieldAlert, Trash2, TrendingUp, X, XCircle } from 'lucide-react';
import type {
  ManagedRobot,
  ManagedRobotParams,
  SignalAction,
  ManagedRobotRisk,
  LiveCandle,
  ManagedStrategyType,
  DashboardView,
  Mt5SyncCredentials,
  RobotStream,
} from '../types/trading';
import {
  createManagedRobotApi,
  deleteManagedRobotApi,
  fetchManagedRobots,
  sendRemoteCommand,
  syncCandlesWithMt5,
  fetchSymbolTickSpec,
  updateManagedRobotApi,
} from '../utils/mt5Bridge';
import { runBacktestSimulation, type BacktestRunResult } from '../engine/backtestSimulator';

interface RobotBuilderViewProps {
  creds: Mt5SyncCredentials;
  mt5Robots?: RobotStream[];
  onRenameMagic?: (magicNumber: number, nextName: string) => void;
  onToggleHideMagic?: (magicNumber: number, nextHidden: boolean) => void;
  onSelectRobot?: (robotId: string | 'ALL') => void;
  onNavigate?: (view: DashboardView) => void;
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

export function RobotBuilderView({ creds, mt5Robots = [], onRenameMagic, onToggleHideMagic, onSelectRobot, onNavigate }: RobotBuilderViewProps) {
  const [editingMagic, setEditingMagic] = useState<number | null>(null);
  const [draftMagicName, setDraftMagicName] = useState('');
  const [confirmMt5Close, setConfirmMt5Close] = useState<number | null>(null);
  const [showHiddenMt5, setShowHiddenMt5] = useState(false);
  const [prodMt5Magics, setProdMt5Magics] = useState<Array<number>>(() => { try { const raw = localStorage.getItem('painel_sync_prod_mt5_' + creds.channelId); return raw ? JSON.parse(raw) : new Array<number>(); } catch { return new Array<number>(); } });
  const toggleProdMt5Magic = (magic: number) => { setProdMt5Magics((prev) => { const next = prev.includes(magic) ? prev.filter((m) => m !== magic) : [...prev, magic]; try { localStorage.setItem('painel_sync_prod_mt5_' + creds.channelId, JSON.stringify(next)); } catch {} return next; }); };
  const [isBuilderOpen, setIsBuilderOpen] = useState(true);
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
  const [previewResult, setPreviewResult] = useState<{ key: string; candlesCount: number; data: BacktestRunResult } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const currentConfigKey = JSON.stringify({ symbol: symbol.trim().toUpperCase(), timeframe, strategyType, maType, fastPeriod, slowPeriod, rsiPeriod, oversold, overbought, lookbackBars, onBullishSignal, onBearishSignal, risk });
  const handleRunBacktestPreview = async () => { const cleanSym = symbol.trim().toUpperCase() || 'WIN$'; setPreviewLoading(true); setPreviewError(null); try { const list = await syncCandlesWithMt5(creds.channelId, creds.token, cleanSym, timeframe, { force: true, isManualRequest: true, timeoutMs: 15000 }); if (!Array.isArray(list) || list.length < 15) { setPreviewError('Velas insuficientes no MT5.'); setPreviewResult(null); return; } const baseParams: ManagedRobotParams = strategyType === 'ema_cross' ? { maType, fastPeriod, slowPeriod } : strategyType === 'rsi_reversal' ? { rsiPeriod, oversold, overbought } : { lookbackBars }; const res = runBacktestSimulation({ robot: { name: name.trim() || 'Previa', symbol: cleanSym, timeframe, enabled: true, magicNumber: 9001, strategyType, params: { ...baseParams, onBullishSignal, onBearishSignal }, risk: { ...risk, volume: snapVolumeValue(risk.volume, tickSpec), stopPoints: snapRiskValue(risk.stopPoints, tickSpec), takePoints: snapRiskValue(risk.takePoints, tickSpec) } }, candles: list }); setPreviewResult({ key: currentConfigKey, candlesCount: list.length, data: res }); } catch { setPreviewError('Falha ao consultar MT5.'); } finally { setPreviewLoading(false); } };
  const [tickSpec, setTickSpec] = useState<LocalAssetSpec>(() => inferLocalTickInfo('WIN' + '$'));

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
    setIsBuilderOpen(true);
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

  const handleChangeEnvironment = async (bot: ManagedRobot, environment: 'SIMULATOR' | 'PRODUCTION') => { try { await updateManagedRobotApi(creds.channelId, creds.token, bot.id, { environment, enabled: environment === 'SIMULATOR' ? false : bot.enabled }); await loadList(); } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Erro ao mover ambiente'); } };
  const handleDuplicate = (bot: ManagedRobot) => { handleEdit(bot); setEditingId(null); setName(bot.name + ' (Copia)'); };
  const productionBots = robots.filter((b) => b.environment === 'PRODUCTION');
  const simulatorBots = robots.filter((b) => b.environment !== 'PRODUCTION');
  const managedMagics = new Set(robots.map((r) => r.magicNumber));
  const allExternalMt5Bots = mt5Robots.filter((r) => !managedMagics.has(r.magicNumber));
  const hiddenMt5Count = allExternalMt5Bots.filter((r) => Boolean(r.hidden)).length;
  const externalMt5Bots = (showHiddenMt5 ? allExternalMt5Bots : allExternalMt5Bots.filter((r) => !r.hidden)).slice().sort((a, b) => Number(prodMt5Magics.includes(b.magicNumber)) - Number(prodMt5Magics.includes(a.magicNumber)));

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
    <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden bg-[#090D12]"><div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6 space-y-6">
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-300"><ShieldAlert className="w-3.5 h-3.5 shrink-0" /><span>Novos robôs iniciam no Simulador</span></div>
        </div>

          <div className="space-y-6">{loading ? (<div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center text-xs text-gray-400">Carregando robôs...</div>) : (<><div className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-gray-200">Produção / Real ({productionBots.length})</h2></div><span className="text-[11px] text-gray-500">Aptos a enviar ordens ao MT5</span></div>{productionBots.length === 0 ? (<div className="rounded-xl bg-[#0F141C]/60 border border-dashed border-[#1E2633] p-5 text-center text-xs text-gray-500">Nenhum robô em Produção. Valide no Simulador e clique em Promover.</div>) : (<div className={`grid grid-cols-1 md:grid-cols-2 ${isBuilderOpen ? "xl:grid-cols-2" : "xl:grid-cols-3"} gap-3`}>{productionBots.map((bot) => (<div key={bot.id} className="rounded-xl bg-[#0F141C] border border-emerald-500/25 p-4 flex flex-col justify-between gap-3"><div className="space-y-2"><div className="text-sm font-semibold text-gray-100 truncate">{bot.name}</div><div className="flex flex-wrap items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase">Produção</span><span className="px-1.5 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-[10px] font-mono text-gray-400">#{bot.magicNumber}</span><span className={"px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase " + (bot.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-800 text-gray-400")}>{bot.enabled ? "Ativo" : "Pausado"}</span></div><div className="text-[11px] text-gray-400 font-mono">{bot.symbol} • {bot.timeframe} • {strategyLabel(bot.strategyType)}</div><div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]"><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">Vol </span><span className="text-gray-200">{bot.risk.volume}</span></div><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">SL </span><span className="text-rose-300">{bot.risk.stopPoints}</span></div><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">TP </span><span className="text-emerald-300">{bot.risk.takePoints}</span></div></div></div><div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#1E2633]"><button type="button" onClick={() => handleToggleEnabled(bot)} className={"inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer " + (bot.enabled ? "bg-amber-950/40 text-amber-300 border-amber-500/40" : "bg-emerald-950/50 text-emerald-300 border-emerald-500/50")}>{bot.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}<span>{bot.enabled ? "Pausar" : "Ligar"}</span></button><div className="flex items-center gap-1"><button type="button" onClick={() => handleChangeEnvironment(bot, "SIMULATOR")} title="Mover p/ Simulador" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-sky-300 cursor-pointer"><ArrowDownLeft className="w-3.5 h-3.5" /></button><button type="button" onClick={() => handleDuplicate(bot)} title="Duplicar" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-300 cursor-pointer"><Copy className="w-3.5 h-3.5" /></button><button type="button" onClick={() => handleEdit(bot)} title="Editar" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-300 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>{confirmDeleteId === bot.id ? (<button type="button" onClick={() => handleDelete(bot.id)} className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer">Confirmar</button>) : (<button type="button" onClick={() => setConfirmDeleteId(bot.id)} title="Excluir" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-400 hover:text-rose-300 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>)}</div></div></div>))}</div>)}</div><div className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-sky-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-gray-200">Simulador / Estudo ({simulatorBots.length})</h2></div><span className="text-[11px] text-gray-500">Bloqueados para envio real</span></div>{simulatorBots.length === 0 ? (<div className="rounded-xl bg-[#0F141C]/60 border border-dashed border-[#1E2633] p-5 text-center text-xs text-gray-500">Nenhum robô no Simulador. Crie um ao lado para testar.</div>) : (<div className={`grid grid-cols-1 md:grid-cols-2 ${isBuilderOpen ? "xl:grid-cols-2" : "xl:grid-cols-3"} gap-3`}>{simulatorBots.map((bot) => (<div key={bot.id} className="rounded-xl bg-[#0F141C] border border-sky-500/20 p-4 flex flex-col justify-between gap-3"><div className="space-y-2"><div className="text-sm font-semibold text-gray-100 truncate">{bot.name}</div><div className="flex flex-wrap items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-500/40 text-[10px] font-bold uppercase">Simulador</span><span className="px-1.5 py-0.5 rounded bg-[#090D12] border border-[#1E2633] text-[10px] font-mono text-gray-400">#{bot.magicNumber}</span></div><div className="text-[11px] text-gray-400 font-mono">{bot.symbol} • {bot.timeframe} • {strategyLabel(bot.strategyType)}</div><div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]"><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">Vol </span><span className="text-gray-200">{bot.risk.volume}</span></div><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">SL </span><span className="text-rose-300">{bot.risk.stopPoints}</span></div><div className="rounded bg-[#090D12] border border-[#1E2633] py-1"><span className="text-gray-500">TP </span><span className="text-emerald-300">{bot.risk.takePoints}</span></div></div></div><div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#1E2633]"><button type="button" onClick={() => handleChangeEnvironment(bot, "PRODUCTION")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 text-xs font-semibold cursor-pointer"><ArrowUpRight className="w-3.5 h-3.5" /><span>Promover</span></button><div className="flex items-center gap-1"><button type="button" onClick={() => handleDuplicate(bot)} title="Duplicar" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-300 cursor-pointer"><Copy className="w-3.5 h-3.5" /></button><button type="button" onClick={() => handleEdit(bot)} title="Editar" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-300 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>{confirmDeleteId === bot.id ? (<button type="button" onClick={() => handleDelete(bot.id)} className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer">Confirmar</button>) : (<button type="button" onClick={() => setConfirmDeleteId(bot.id)} title="Excluir" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-400 hover:text-rose-300 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>)}</div></div></div>))}</div>)}</div><div className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-gray-200">Robôs Externos do MT5 ({externalMt5Bots.length})</h2></div><div className="flex items-center gap-2">{hiddenMt5Count > 0 && (<button type="button" onClick={() => setShowHiddenMt5((v) => !v)} className={"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border cursor-pointer " + (showHiddenMt5 ? "bg-sky-500/15 border-sky-500/40 text-sky-300" : "bg-[#0F141C] border-[#1E2633] text-gray-400")}>{showHiddenMt5 ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}<span>{showHiddenMt5 ? "Ocultos visíveis" : "+" + hiddenMt5Count + " oculto(s)"}</span></button>)}<span className="text-[11px] text-gray-500">EAs nativos e ordens manuais do MetaTrader 5</span></div></div>{externalMt5Bots.length === 0 ? (<div className="rounded-xl bg-[#0F141C]/60 border border-dashed border-[#1E2633] p-5 text-center text-xs text-gray-500">Nenhum robô externo do MT5 conectado no momento.</div>) : (<div className={`grid grid-cols-1 md:grid-cols-2 ${isBuilderOpen ? "xl:grid-cols-2" : "xl:grid-cols-3"} gap-3`}>{externalMt5Bots.map((bot) => (<div key={bot.robotId} className={"rounded-xl bg-[#0F141C] border p-4 flex flex-col justify-between gap-3 transition-opacity " + (bot.hidden ? "border-gray-700/60 opacity-55" : prodMt5Magics.includes(bot.magicNumber) ? "border-emerald-500/40" : "border-amber-500/20")}><div className="space-y-2"><div className="flex items-center justify-between gap-2">{editingMagic === bot.magicNumber ? (<div className="flex items-center gap-1 flex-1"><input type="text" value={draftMagicName} onChange={(e) => setDraftMagicName(e.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-100" /><button type="button" onClick={() => { onRenameMagic?.(bot.magicNumber, draftMagicName.trim() || bot.name); setEditingMagic(null); }} className="p-1 text-emerald-400 cursor-pointer"><Check className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setEditingMagic(null)} className="p-1 text-gray-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button></div>) : (<div className="text-sm font-semibold text-gray-100 truncate">{bot.name}</div>)}<div className="flex items-center gap-1 shrink-0">{bot.hidden && <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 text-[10px] font-semibold uppercase">Oculto</span>}{prodMt5Magics.includes(bot.magicNumber) && <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase">Produção</span>}<span className="px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase">MT5</span></div></div><div className="flex items-center justify-between text-[11px] font-mono text-gray-400"><span>#{bot.magicNumber} • {bot.symbol} • {bot.timeframe || "M5"}</span><span className={"font-bold " + (bot.dailyPnlBrl > 0 ? "text-emerald-400" : bot.dailyPnlBrl < 0 ? "text-rose-400" : "text-gray-300")}>{bot.dailyPnlBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div><div>{bot.position ? (<span className={"inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold " + (bot.position.side === "COMPRA" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>{bot.position.side} {bot.position.volume}x ({bot.floatingPnlBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})</span>) : (<span className="text-[11px] font-mono text-gray-500">Zerado</span>)}</div></div><div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#1E2633]"><button type="button" onClick={() => { onSelectRobot?.(bot.robotId); onNavigate?.("charts"); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#1E2633] text-xs text-gray-200 cursor-pointer"><CandlestickChart className="w-3.5 h-3.5 text-emerald-400" /><span>Gráfico</span></button><div className="flex items-center gap-1">{bot.position && (confirmMt5Close === bot.magicNumber ? (<button type="button" onClick={async () => { setConfirmMt5Close(null); await sendRemoteCommand(creds.channelId, creds.token, { action: "CLOSE_MAGIC", magicNumber: bot.magicNumber, symbol: bot.symbol, ttlSeconds: 15 }); }} className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer">Zerar</button>) : (<button type="button" onClick={() => setConfirmMt5Close(bot.magicNumber)} title="Zerar posição" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-rose-400 cursor-pointer"><XCircle className="w-3.5 h-3.5" /></button>))}<button type="button" onClick={() => toggleProdMt5Magic(bot.magicNumber)} title="Alternar tag Produção" className={"px-2 py-1 rounded-lg border text-[10px] font-semibold cursor-pointer " + (prodMt5Magics.includes(bot.magicNumber) ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" : "bg-[#161C25] border-[#1E2633] text-gray-400 hover:text-emerald-300")}>{prodMt5Magics.includes(bot.magicNumber) ? "Produção ✓" : "+ Produção"}</button><button type="button" onClick={() => { setEditingMagic(bot.magicNumber); setDraftMagicName(bot.name); }} title="Renomear" className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-300 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button><button type="button" onClick={() => onToggleHideMagic?.(bot.magicNumber, !bot.hidden)} title={bot.hidden ? "Exibir" : "Ocultar"} className="p-1.5 rounded-lg bg-[#161C25] border border-[#1E2633] text-gray-400 hover:text-gray-200 cursor-pointer">{bot.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button></div></div></div>))}</div>)}</div></>)}</div>

      </div>
      {isBuilderOpen ? (<aside className="w-full lg:w-[410px] xl:w-[430px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#1E2633] bg-[#0F141C] overflow-y-auto p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E2633] pb-3"><button type="button" onClick={() => setIsBuilderOpen(false)} title="Retrair barra lateral" className="p-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-gray-300 hover:text-white cursor-pointer"><PanelRightClose className="w-4 h-4" /></button><div className="flex items-center gap-2">{editingId && (<button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 cursor-pointer"><X className="w-3.5 h-3.5" /> Cancelar</button>)}<h2 className="text-sm font-semibold text-gray-100">{editingId ? "Editar Robô" : "Novo Robô"}</h2></div></div>

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

                        <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60">
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Salvar no Simulador'}</span>
            </button>
          </form>

</aside>) : (<aside className="hidden lg:flex w-12 shrink-0 border-l border-[#1E2633] bg-[#0F141C] flex-col items-center py-4 gap-3"><button type="button" onClick={() => setIsBuilderOpen(true)} title="Expandir Novo Robô" className="p-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#2E3A4B] text-emerald-400 cursor-pointer"><PanelRightOpen className="w-4 h-4" /></button><button type="button" onClick={() => { resetForm(); setIsBuilderOpen(true); }} title="Criar Novo Robô" className="p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 cursor-pointer"><Plus className="w-4 h-4" /></button></aside>)}
      </div>
      <div className="shrink-0 z-30 w-full h-[50px] bg-[#090D12]/90 border-t border-[#1E2633] px-4 flex items-center justify-between gap-3 overflow-hidden"><div className="shrink-0 flex items-center gap-2 whitespace-nowrap"><button type="button" disabled={previewLoading} onClick={handleRunBacktestPreview} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"><Play className="w-3.5 h-3.5" /><span>{previewLoading ? "Simulando..." : "Rodar Backtest"}</span></button><span className="inline-flex items-center gap-1 text-xs font-mono text-gray-400"><TrendingUp className="w-3.5 h-3.5 text-sky-400" /><span>{symbol.trim().toUpperCase() || "WIN$"} • {timeframe}{previewResult ? " • " + previewResult.candlesCount + "v" : ""}</span>{previewResult && previewResult.key !== currentConfigKey && <span className="text-[10px] text-amber-400">(alterado)</span>}</span></div>{previewError ? (<span className="text-xs font-mono text-rose-400 truncate">{previewError}</span>) : previewResult ? (<div className="min-w-0 flex items-center justify-end gap-4 text-xs font-mono whitespace-nowrap"><div className="flex items-center gap-1.5"><span className="text-gray-400">Líquido:</span><span className={"font-bold " + (previewResult.data.summary.netPnlBrl >= 0 ? "text-emerald-400" : "text-rose-400")}>{previewResult.data.summary.netPnlBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({previewResult.data.summary.netPoints} pts)</span></div><div className="flex items-center gap-1.5"><span className="text-gray-400">Acerto:</span><span className="font-bold text-gray-100">{previewResult.data.summary.winRatePct}% ({previewResult.data.summary.wins}W/{previewResult.data.summary.losses}L)</span></div><div className="flex items-center gap-1.5"><span className="text-gray-400">Profit F.:</span><span className="font-bold text-sky-400">{previewResult.data.summary.profitFactor.toFixed(2)} ({previewResult.data.summary.totalTrades}t)</span></div><div className="flex items-center gap-1.5"><span className="text-gray-400">DD Máx.:</span><span className="font-bold text-rose-400">-{previewResult.data.summary.maxDrawdownBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div></div>) : (<span className="text-xs font-mono text-gray-500 truncate">Clique em Rodar Backtest para testar a configuração atual nas velas reais do MT5.</span>)}</div>
    </div>
  );
}
