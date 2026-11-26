import { UI_THEME } from '../utils/themeTokens';
import { EquityBaselineChart } from './EquityBaselineChart';
import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Award,
  CandlestickChart,
  CheckCircle2,
  Check,
  Eye,
  EyeOff,
  Pencil,
  X,
  XCircle,
  Layers,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  AccountSnapshot,
  DashboardView,
  ExecutedTrade,
  Mt5SyncCredentials,
  OpenPosition,
  PairingAttemptEvent,
  RobotStream,
} from '../types/trading';
import {
  computeEquitySeries,
  computePortfolioMetrics,
  formatBrl,
  formatPrice,
} from '../utils/tradingMath';
import { LivePairingMonitor } from './LivePairingMonitor';
import { sendRemoteCommand } from '../utils/mt5Bridge';

interface OverviewViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onSelectRobot: (id: string | 'ALL') => void;
  onNavigate: (view: DashboardView) => void;
  account: AccountSnapshot | null;
  creds: Mt5SyncCredentials;
  streamStatus: 'connecting' | 'listening' | 'error';
  pairingEvents: PairingAttemptEvent[];
  lastSyncAt: string | null;
  onClearPairingLog: () => void;
  onRenameMagic?: (magicNumber: number, nextName: string) => void;
  onToggleHideMagic?: (magicNumber: number, nextHidden: boolean) => void;
}

export function OverviewView({
  robots,
  selectedRobotId,
  onSelectRobot,
  onNavigate,
  account,
  creds,
  streamStatus,
  pairingEvents,
  lastSyncAt,
  onClearPairingLog,
  onRenameMagic,
  onToggleHideMagic,
}: OverviewViewProps) {
  const [hoverEqIdx, setHoverEqIdx] = useState<number | null>(null);
  const [editingMagic, setEditingMagic] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmCloseKey, setConfirmCloseKey] = useState<string | null>(null);
  const [cmdMsg, setCmdMsg] = useState<string | null>(null);
  const handleQuickCmd = async (action: 'CLOSE_MAGIC' | 'CLOSE_ALL', magicNumber?: number, symbol?: string) => { setConfirmCloseKey(null); try { await sendRemoteCommand(creds.channelId, creds.token, { action, magicNumber, symbol, ttlSeconds: 15 }); setCmdMsg('Comando enviado ao MT5...'); } catch { setCmdMsg('Falha ao enviar comando'); } finally { window.setTimeout(() => setCmdMsg(null), 4000); } };
  const [includeHidden, setIncludeHidden] = useState(false);
  const [sortKey, setSortKey] = useState<'dailyPnl' | 'winRate'>('dailyPnl');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const visibleRobots = useMemo(() => robots.filter((r) => !r.hidden), [robots]);
  const hiddenCount = robots.length - visibleRobots.length;

  const scopedRobots = useMemo(() => {
    if (selectedRobotId !== 'ALL') return robots.filter((r) => r.robotId === selectedRobotId);
    if (!includeHidden && visibleRobots.length > 0) return visibleRobots;
    return robots;
  }, [robots, visibleRobots, selectedRobotId, includeHidden]);

  const capitalBase = account?.balance && account.balance > 0 ? account.balance : 25000;

  const metrics = useMemo(
    () => computePortfolioMetrics(scopedRobots, capitalBase),
    [scopedRobots, capitalBase]
  );

  const cumulativeStats = useMemo(() => {
    let peak = 0;
    let running = 0;
    const allHist: ExecutedTrade[] = [];
    for (const r of scopedRobots) {
      const src = Array.isArray(r.historyTrades) && r.historyTrades.length > 0 ? r.historyTrades : (r.trades ?? []);
      for (const tr of src) allHist.push(tr);
    }
    allHist.sort((a, b) => `${a.exitDate ?? ''} ${a.exitTime}`.localeCompare(`${b.exitDate ?? ''} ${b.exitTime}`));
    let histMaxDd = 0;
    for (const tr of allHist) {
      running += tr.pnlBrl;
      if (running > peak) peak = running;
      if (peak - running > histMaxDd) histMaxDd = peak - running;
    }
    const totalPnlBrl = Number((running + metrics.floatingPnlBrl).toFixed(2));
    if (totalPnlBrl > peak) peak = totalPnlBrl;
    if (peak - totalPnlBrl > histMaxDd) histMaxDd = peak - totalPnlBrl;
    const winTrades = allHist.filter((t) => t.pnlBrl > 0);
    const lossTrades = allHist.filter((t) => t.pnlBrl < 0);
    const grossWin = winTrades.reduce((s, t) => s + t.pnlBrl, 0);
    const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.pnlBrl, 0));
    const avgWinBrl = winTrades.length > 0 ? grossWin / winTrades.length : 0;
    const avgLossBrl = lossTrades.length > 0 ? grossLoss / lossTrades.length : 0;
    const expectancyBrl = allHist.length > 0 ? running / allHist.length : 0;
    const histWinRate = allHist.length > 0 ? Math.round((winTrades.length / allHist.length) * 100) : 0;
    const histProfitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;

    return {
      totalPnlBrl,
      peakPnlBrl: Number(peak.toFixed(2)),
      fromPeakBrl: Number((totalPnlBrl - peak).toFixed(2)),
      histMaxDrawdownBrl: Number(histMaxDd.toFixed(2)),
      totalHistTrades: allHist.length,
      avgWinBrl: Number(avgWinBrl.toFixed(2)),
      avgLossBrl: Number(avgLossBrl.toFixed(2)),
      expectancyBrl: Number(expectancyBrl.toFixed(2)),
      histWinRate,
      histProfitFactor: Number(histProfitFactor.toFixed(2)),
    };
  }, [scopedRobots, metrics.floatingPnlBrl]);

  const allTrades = useMemo<ExecutedTrade[]>(
    () =>
      scopedRobots
        .flatMap((r) => r.trades)
        .sort((a, b) => b.exitTime.localeCompare(a.exitTime)),
    [scopedRobots]
  );

  const openPositions = useMemo<OpenPosition[]>(
    () =>
      scopedRobots
        .map((r) => r.position)
        .filter((p): p is OpenPosition => p !== null),
    [scopedRobots]
  );

  const equitySeries = useMemo(
    () => computeEquitySeries(allTrades, metrics.floatingPnlBrl),
    [allTrades, metrics.floatingPnlBrl]
  );

  const executiveSummary = useMemo(() => {
    const sorted = [...scopedRobots].sort((a, b) => b.dailyPnlBrl - a.dailyPnlBrl);
    const bestBot = sorted.find((r) => r.dailyPnlBrl > 0) ?? null;
    const worstBot = [...scopedRobots].sort((a, b) => a.dailyPnlBrl - b.dailyPnlBrl).find((r) => r.dailyPnlBrl < 0) ?? null;
    const alerts: { level: 'danger' | 'warn' | 'info' | 'ok'; text: string }[] = [];
    if (metrics.maxDrawdownPct >= 15) alerts.push({ level: 'danger', text: `Drawdown elevado (${metrics.maxDrawdownPct.toFixed(1)}% do capital)` });
    if (metrics.maxConsecutiveLosses >= 2 && metrics.wins === 0) alerts.push({ level: 'warn', text: `${metrics.maxConsecutiveLosses} perdas consecutivas hoje (0% acerto)` });
    if (openPositions.length > 0) alerts.push({ level: 'info', text: `${openPositions.length} posição(ões) em aberto exposta(s)` });
    if (hiddenCount > 0 && !includeHidden && selectedRobotId === 'ALL') alerts.push({ level: 'info', text: `${hiddenCount} robô(s) oculto(s) fora da consolidação` });
    if (alerts.length === 0) alerts.push({ level: 'ok', text: 'Telemetria estável • Sem alertas de risco ativos' });
    return { bestBot, worstBot, alerts };
  }, [scopedRobots, metrics.maxDrawdownPct, metrics.maxConsecutiveLosses, metrics.wins, openPositions.length, hiddenCount, includeHidden, selectedRobotId]);

  const sortedRobots = useMemo(() => {
    return [...scopedRobots].sort((a, b) => {
      const aWr = (a.trades ?? []).length > 0 ? (a.trades ?? []).filter((t) => t.pnlBrl >= 0).length / (a.trades ?? []).length : -1;
      const bWr = (b.trades ?? []).length > 0 ? (b.trades ?? []).filter((t) => t.pnlBrl >= 0).length / (b.trades ?? []).length : -1;
      const diff = sortKey === 'dailyPnl' ? a.dailyPnlBrl - b.dailyPnlBrl : aWr - bWr;
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [scopedRobots, sortKey, sortDir]);

  const toggleSort = (key: 'dailyPnl' | 'winRate') => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const scopedHistoryTrades = useMemo(() => scopedRobots.flatMap((r) => (Array.isArray(r.historyTrades) && r.historyTrades.length > 0 ? r.historyTrades : (r.trades ?? []))), [scopedRobots]);

  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 bg-[#090D12]">
        <div className="max-w-4xl mx-auto">
          <LivePairingMonitor creds={creds} streamStatus={streamStatus} pairingEvents={pairingEvents} robots={robots} lastSyncAt={lastSyncAt} onClearPairingLog={onClearPairingLog} compact />
        </div>
      </div>
    );
  }

  const eqW = 780; const eqH = 210; const padL = 14; const padR = 72; const padT = 20; const padB = 20;
  const plotW = eqW - padL - padR; const plotH = eqH - padT - padB;
  let minEq = 0; let maxEq = 0; let rawPeak = 0; let rawTrough = 0;
  equitySeries.forEach((pt, i) => {
    if (pt.cumulativePnl < minEq) minEq = pt.cumulativePnl;
    if (pt.cumulativePnl > maxEq) maxEq = pt.cumulativePnl;
    if (i === 0 || pt.cumulativePnl > rawPeak) rawPeak = pt.cumulativePnl;
    if (i === 0 || pt.cumulativePnl < rawTrough) rawTrough = pt.cumulativePnl;
  });
  if (maxEq - minEq < 50) { maxEq += 50; minEq -= 50; } else { const m = (maxEq - minEq) * 0.16; maxEq += m; minEq -= m; }
  const xEq = (i: number) => equitySeries.length <= 1 ? padL + plotW / 2 : padL + (i / (equitySeries.length - 1)) * plotW;
  const yEq = (v: number) => padT + ((maxEq - v) / (maxEq - minEq)) * plotH;
  const eqLinePath = equitySeries.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xEq(i).toFixed(1)} ${yEq(pt.cumulativePnl).toFixed(1)}`).join(' ');
  const zeroY = yEq(0);
  const eqAreaPath = equitySeries.length > 1 ? `${eqLinePath} L ${xEq(equitySeries.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${xEq(0).toFixed(1)} ${zeroY.toFixed(1)} Z` : '';
  const hoveredPoint = hoverEqIdx !== null && equitySeries[hoverEqIdx] ? equitySeries[hoverEqIdx] : null;
  const activeTitle = selectedRobotId === 'ALL' ? `Carteira Ativa • ${scopedRobots.length} robô${scopedRobots.length !== 1 ? 's' : ''}` : `${scopedRobots?.[0]?.name ?? 'Robô'} • ${scopedRobots?.[0]?.symbol ?? ''}`;
  const isPos = metrics.netPnlBrl > 0; const isNeg = metrics.netPnlBrl < 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#090D12]">
      <div className="max-w-[1320px] mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-lg font-bold text-slate-100">{activeTitle}</h1>
            {selectedRobotId === 'ALL' && hiddenCount > 0 && (
              <button type="button" onClick={() => setIncludeHidden((v) => !v)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border cursor-pointer ${includeHidden ? 'bg-blue-500/15 border-blue-500/35 text-blue-300' : 'bg-[#0F141C] border-[#1E293B] text-slate-400'}`}>
                {includeHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                <span>{includeHidden ? 'Ocultos incluídos' : `+${hiddenCount} oculto(s)`}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedRobotId !== 'ALL' && <button type="button" onClick={() => onSelectRobot('ALL')} className="px-3 py-1.5 rounded-lg bg-[#0F141C] hover:bg-[#161D27] border border-[#1E293B] text-xs text-slate-300 cursor-pointer">Ver Todos</button>}
            <button type="button" onClick={() => onNavigate('charts')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F141C] hover:bg-[#161D27] border border-[#1E293B] text-xs text-slate-100 cursor-pointer"><CandlestickChart className="w-3.5 h-3.5 text-emerald-400" /><span>Gráfico</span></button>
          </div>
        </div>
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /><h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Histórico Consolidado ({cumulativeStats.totalHistTrades} operações)</h2></div>
            <button type="button" onClick={() => onNavigate('reports')} className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer">Relatório completo →</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`${UI_THEME.surfaces.card} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Saldo Acumulado</div>
              <div className={`mt-1 text-2xl font-mono font-bold tabular-nums ${cumulativeStats.totalPnlBrl > 0 ? 'text-emerald-400' : cumulativeStats.totalPnlBrl < 0 ? 'text-rose-400' : 'text-slate-100'}`}>{formatBrl(cumulativeStats.totalPnlBrl)}</div>
              <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-500">Pico: <span className="text-slate-300">{formatBrl(cumulativeStats.peakPnlBrl)}</span> • DD Máx: <span className="text-rose-400/90">{formatBrl(-cumulativeStats.histMaxDrawdownBrl, false)}</span></div>
            </div>
            <div className={`${UI_THEME.surfaces.card} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Média por Trade</div>
              <div className={`mt-1 text-2xl font-mono font-bold tabular-nums ${cumulativeStats.expectancyBrl > 0 ? 'text-emerald-400' : cumulativeStats.expectancyBrl < 0 ? 'text-rose-400' : 'text-slate-100'}`}>{formatBrl(cumulativeStats.expectancyBrl)}</div>
              <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-400">{cumulativeStats.histWinRate}% acerto • Fator {cumulativeStats.histProfitFactor.toFixed(2)}</div>
            </div>
            <div className={`${UI_THEME.surfaces.card} p-4 flex flex-col justify-between`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Gain Médio vs Loss Médio</div>
              <div className="my-2 flex items-center justify-between text-xs font-mono font-bold tabular-nums"><span className="text-emerald-400">{formatBrl(cumulativeStats.avgWinBrl, false)}</span><span className="text-rose-400">{formatBrl(-cumulativeStats.avgLossBrl, false)}</span></div>
              <div className="w-full h-2 rounded-full bg-[#090D12] border border-[#1E2633] overflow-hidden flex gap-px">{(() => { const tot = cumulativeStats.avgWinBrl + cumulativeStats.avgLossBrl; const wPct = tot > 0 ? Math.round((cumulativeStats.avgWinBrl / tot) * 100) : 50; return (<><div className="h-full bg-emerald-500/70" style={{ width: `${wPct}%` }} /><div className="h-full bg-rose-500/70" style={{ width: `${100 - wPct}%` }} /></>); })()}</div>
            </div>
          </div>
        </section>
        <section className="pt-2 border-t border-[#1E293B] space-y-3">
          <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Pregão de Hoje</h2></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`rounded-[10px] bg-[#0F141C] border border-[#1E293B] p-4 border-l-[3px] ${isPos ? 'border-l-emerald-500' : isNeg ? 'border-l-rose-500' : 'border-l-slate-600'}`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Resultado Hoje</div>
              <div className={`mt-1 text-[28px] leading-tight font-mono font-bold tabular-nums ${isPos ? 'text-emerald-400' : isNeg ? 'text-rose-400' : 'text-slate-100'}`}>{formatBrl(metrics.netPnlBrl)}</div>
              {openPositions.length > 0 && <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-400">Flutuante: <span className={metrics.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatBrl(metrics.floatingPnlBrl)}</span></div>}
            </div>
            <div className={`${UI_THEME.surfaces.card} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Drawdown Hoje</div>
              <div className={`mt-1 text-[28px] leading-tight font-mono font-bold tabular-nums ${metrics.maxDrawdownBrl > 0 ? 'text-rose-400/90' : 'text-slate-200'}`}>{formatBrl(-metrics.maxDrawdownBrl, false)}</div>
              <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-500">{metrics.totalTrades} operação(ões) encerrada(s) hoje</div>
            </div>
          </div>
          <EquityBaselineChart todayTrades={allTrades} historyTrades={scopedHistoryTrades} floatingPnlBrl={metrics.floatingPnlBrl} />
          {(() => { const appBots = sortedRobots.filter((b) => b.magicNumber >= 9001); const mt5Bots = sortedRobots.filter((b) => b.magicNumber < 9001); const renderCard = (bot: RobotStream, isApp: boolean) => { const isSel = selectedRobotId === bot.robotId; const cKey = "m_" + bot.magicNumber; return (<div key={bot.robotId} onClick={() => onSelectRobot(isSel ? "ALL" : bot.robotId)} className={`rounded-xl bg-[#0F141C] border p-4 flex flex-col justify-between gap-3 transition-colors cursor-pointer ${isSel ? "border-sky-400/70 bg-sky-950/15" : isApp ? "border-emerald-500/25 hover:border-emerald-500/50" : "border-[#1E293B] hover:border-slate-600"}`}><div className="space-y-2"><div className="flex items-start justify-between gap-2">{editingMagic === bot.magicNumber ? (<div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}><input type="text" value={draftName} onChange={(e) => setDraftName(e.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded bg-[#090D12] border border-[#1E2633] text-xs text-gray-100" /><button type="button" onClick={() => { onRenameMagic?.(bot.magicNumber, draftName.trim() || bot.name); setEditingMagic(null); }} className="p-1 text-emerald-400 cursor-pointer"><Check className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setEditingMagic(null)} className="p-1 text-gray-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button></div>) : (<div className="text-sm font-semibold text-slate-100 truncate">{bot.name}</div>)}<span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${isApp ? "bg-emerald-950/70 text-emerald-300 border border-emerald-500/40" : "bg-amber-950/60 text-amber-300 border border-amber-500/35"}`}>{isApp ? "APP" : "MT5"}</span></div><div className="flex items-center justify-between text-[11px] font-mono text-slate-400"><span>#{bot.magicNumber} • {bot.symbol} • {bot.timeframe || "M5"}</span><span className={`font-bold ${bot.dailyPnlBrl > 0 ? "text-emerald-400" : bot.dailyPnlBrl < 0 ? "text-rose-400" : "text-slate-300"}`}>{formatBrl(bot.dailyPnlBrl)}</span></div><div>{bot.position ? (<span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${bot.position.side === "COMPRA" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{bot.position.side} {bot.position.volume}x ({formatBrl(bot.floatingPnlBrl)})</span>) : (<span className="text-[11px] font-mono text-slate-500">Zerado</span>)}</div></div><div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#1E293B]" onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => { onSelectRobot(bot.robotId); onNavigate("charts"); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#161D27] hover:bg-[#1E293B] text-[11px] text-slate-200 cursor-pointer"><CandlestickChart className="w-3.5 h-3.5 text-emerald-400" /><span>Gráfico</span></button><div className="flex items-center gap-1">{bot.position && (confirmCloseKey === cKey ? (<button type="button" onClick={() => handleQuickCmd("CLOSE_MAGIC", bot.magicNumber, bot.symbol)} className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] font-bold cursor-pointer">Confirmar</button>) : (<button type="button" onClick={() => setConfirmCloseKey(cKey)} title="Zerar posição" className="p-1.5 rounded bg-[#161D27] text-rose-400 hover:bg-rose-950/40 cursor-pointer"><XCircle className="w-3.5 h-3.5" /></button>))}<button type="button" onClick={() => { setEditingMagic(bot.magicNumber); setDraftName(bot.name); }} title="Renomear" className="p-1.5 rounded bg-[#161D27] text-slate-400 hover:text-slate-200 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button><button type="button" onClick={() => onToggleHideMagic?.(bot.magicNumber, !bot.hidden)} title={bot.hidden ? "Exibir" : "Ocultar"} className="p-1.5 rounded bg-[#161D27] text-slate-400 hover:text-slate-200 cursor-pointer">{bot.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button></div></div></div>); }; return (<div className="space-y-5">{cmdMsg && <div className="px-3 py-2 rounded-lg bg-sky-950/40 border border-sky-500/30 text-xs text-sky-300 font-mono">{cmdMsg}</div>}<div className="space-y-2.5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" /><h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Robôs do App ({appBots.length})</h3></div><button type="button" onClick={() => onNavigate("robots")} className="text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer">Gerenciar Robôs →</button></div>{appBots.length === 0 ? (<div className="rounded-xl bg-[#0F141C]/60 border border-dashed border-[#1E293B] p-4 text-center text-xs text-slate-500">Nenhum robô do App ativo no pregão hoje.</div>) : (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">{appBots.map((b) => renderCard(b, true))}</div>)}</div><div className="space-y-2.5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Robôs do MT5 Externos ({mt5Bots.length})</h3></div>{openPositions.length > 0 && (confirmCloseKey === "ALL" ? (<button type="button" onClick={() => handleQuickCmd("CLOSE_ALL")} className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px] font-bold cursor-pointer">Confirmar Zerar Tudo</button>) : (<button type="button" onClick={() => setConfirmCloseKey("ALL")} className="px-2.5 py-1 rounded bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px] font-semibold cursor-pointer">Zerar Tudo (MT5)</button>))}</div>{mt5Bots.length === 0 ? (<div className="rounded-xl bg-[#0F141C]/60 border border-dashed border-[#1E293B] p-4 text-center text-xs text-slate-500">Nenhum EA externo do MT5 conectado no momento.</div>) : (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">{mt5Bots.map((b) => renderCard(b, false))}</div>)}</div></div>); })()}
        </section>
      </div>
    </div>
  );
}
