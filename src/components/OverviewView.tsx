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
        </section>
      </div>
    </div>
  );
}
