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
  Eye,
  EyeOff,
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
}: OverviewViewProps) {
  const [hoverEqIdx, setHoverEqIdx] = useState<number | null>(null);
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
    for (const tr of allHist) {
      running += tr.pnlBrl;
      if (running > peak) peak = running;
    }
    const totalPnlBrl = Number((running + metrics.floatingPnlBrl).toFixed(2));
    if (totalPnlBrl > peak) peak = totalPnlBrl;
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

  // Estado vazio inicial antes de conectar MT5
  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="rounded-xl bg-[#11161D] border border-[#222B38] p-7 space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold text-gray-100 text-balance">
                Monitoramento em Tempo Real para Robôs do MetaTrader 5
              </h1>
              <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
                Acompanhe todos os seus Expert Advisors em um só lugar: posições abertas, compras e vendas executadas, gráficos candlestick com marcações de entrada/saída, fator de lucro e drawdown intraday.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#1E2633]">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-200">Multi-Robô MT5</div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Separe cada robô automaticamente por Magic Number e ativo (WIN, WDO, Ações ou Cripto).
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-200">Compras & Vendas</div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Compare desempenho em operações compradas vs vendidas, payoff e horários mais lucrativos.
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-200">100% Somente Leitura</div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Nenhuma ordem é enviada pelo navegador. Seus robôs continuam executando localmente no MT5.
                </p>
              </div>
            </div>
          </div>

          <LivePairingMonitor
            creds={creds}
            streamStatus={streamStatus}
            pairingEvents={pairingEvents}
            robots={robots}
            lastSyncAt={lastSyncAt}
            onClearPairingLog={onClearPairingLog}
            compact
          />
        </div>
      </div>
    );
  }

  const eqW = 780; const eqH = 220; const padL = 14; const padR = 76; const padT = 24; const padB = 26;
  const plotW = eqW - padL - padR; const plotH = eqH - padT - padB;
  let minEq = 0; let maxEq = 0; let peakIdx = 0; let troughIdx = 0; let rawPeak = 0; let rawTrough = 0;
  equitySeries.forEach((pt, i) => {
    if (pt.cumulativePnl < minEq) minEq = pt.cumulativePnl;
    if (pt.cumulativePnl > maxEq) maxEq = pt.cumulativePnl;
    if (i === 0 || pt.cumulativePnl > rawPeak) { rawPeak = pt.cumulativePnl; peakIdx = i; }
    if (i === 0 || pt.cumulativePnl < rawTrough) { rawTrough = pt.cumulativePnl; troughIdx = i; }
  });
  if (maxEq - minEq < 50) { maxEq += 50; minEq -= 50; }
  else { const m = (maxEq - minEq) * 0.16; maxEq += m; minEq -= m; }

  const xEq = (i: number) => equitySeries.length <= 1 ? padL + plotW / 2 : padL + (i / (equitySeries.length - 1)) * plotW;
  const yEq = (v: number) => padT + ((maxEq - v) / (maxEq - minEq)) * plotH;
  const eqLinePath = equitySeries.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xEq(i).toFixed(1)} ${yEq(pt.cumulativePnl).toFixed(1)}`).join(' ');
  const zeroY = yEq(0);
  const eqAreaPath = equitySeries.length > 1 ? `${eqLinePath} L ${xEq(equitySeries.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${xEq(0).toFixed(1)} ${zeroY.toFixed(1)} Z` : '';
  const hoveredPoint = hoverEqIdx !== null && equitySeries[hoverEqIdx] ? equitySeries[hoverEqIdx] : null;
  const activeTitle = selectedRobotId === 'ALL' ? `Carteira Consolidada • ${scopedRobots.length} robô${scopedRobots.length !== 1 ? 's' : ''}` : `${scopedRobots[0]?.name ?? 'Robô'} • ${scopedRobots[0]?.symbol ?? ''}`;
  const dayReturnPct = capitalBase > 0 ? (metrics.netPnlBrl / capitalBase) * 100 : 0;
  const isPos = metrics.netPnlBrl > 0; const isNeg = metrics.netPnlBrl < 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#090D12]">
      <div className="max-w-[1440px] mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-lg font-bold text-slate-100 tracking-tight">{activeTitle}</h1>
              {selectedRobotId === 'ALL' && hiddenCount > 0 && (
                <button type="button" onClick={() => setIncludeHidden((v) => !v)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border cursor-pointer ${includeHidden ? 'bg-blue-500/15 border-blue-500/35 text-blue-300' : 'bg-[#0F141C] border-[#1E293B] text-slate-400 hover:text-slate-200'}`}>
                  {includeHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span>{includeHidden ? `Incluindo ${hiddenCount} oculto(s)` : `+${hiddenCount} oculto(s)`}</span>
                </button>
              )}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span>Telemetria MT5 em Tempo Real</span><span>•</span>
              <span className="font-mono tabular-nums">{openPositions.length} posições em aberto</span><span>•</span>
              <span className="font-mono tabular-nums">{metrics.totalTrades} negócios hoje</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedRobotId !== 'ALL' && <button type="button" onClick={() => onSelectRobot('ALL')} className="px-3 py-1.5 rounded-lg bg-[#0F141C] hover:bg-[#161D27] border border-[#1E293B] text-xs font-medium text-slate-200 cursor-pointer">Ver Carteira</button>}
            <button type="button" onClick={() => onNavigate('charts')} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0F141C] hover:bg-[#161D27] border border-[#1E293B] hover:border-[#334155] text-xs font-medium text-slate-100 cursor-pointer">
              <CandlestickChart className="w-3.5 h-3.5 text-emerald-400" /><span>Abrir Gráfico Candlestick</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`relative overflow-hidden rounded-[10px] bg-[#0F141C] border border-[#1E293B] p-4 border-l-[3px] ${isPos ? 'border-l-emerald-500' : isNeg ? 'border-l-rose-500' : 'border-l-slate-600'}`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Resultado Líquido (Dia)</span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold tabular-nums ${isPos ? 'bg-emerald-500/15 text-emerald-400' : isNeg ? 'bg-rose-500/15 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>{dayReturnPct >= 0 ? '+' : ''}{dayReturnPct.toFixed(2)}%</span>
              </div>
              <div className={`text-[28px] leading-tight font-mono font-bold tabular-nums tracking-tight ${isPos ? 'text-emerald-400' : isNeg ? 'text-rose-400' : 'text-slate-100'}`}>{formatBrl(metrics.netPnlBrl)}</div>
              <div className="pt-1 border-t border-[#1E293B]/70 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                <span>Realizado: <strong className="text-slate-200">{formatBrl(metrics.realizedPnlBrl)}</strong></span>
                <span>Flutuante: <strong className={metrics.floatingPnlBrl > 0 ? 'text-emerald-400' : metrics.floatingPnlBrl < 0 ? 'text-rose-400' : 'text-slate-300'}>{formatBrl(metrics.floatingPnlBrl)}</strong></span>
              </div>
            </div>
          </div>

          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Resultado Acumulado</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[#161D27] text-slate-400 border border-[#1E293B]">{cumulativeStats.totalHistTrades} ops</span>
            </div>
            <div className={`text-[26px] leading-tight font-mono font-bold tabular-nums tracking-tight ${cumulativeStats.totalPnlBrl > 0 ? 'text-emerald-400' : cumulativeStats.totalPnlBrl < 0 ? 'text-rose-400' : 'text-slate-100'}`}>{formatBrl(cumulativeStats.totalPnlBrl)}</div>
            <div className="pt-1 border-t border-[#1E293B]/70 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
              <span>Pico Máx: <strong className="text-slate-200">{formatBrl(cumulativeStats.peakPnlBrl)}</strong></span>
              <span>Do topo: <strong className={cumulativeStats.fromPeakBrl < 0 ? 'text-amber-400' : 'text-emerald-400'}>{formatBrl(cumulativeStats.fromPeakBrl)}</strong></span>
            </div>
          </div>

          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Drawdown Máx (Dia)</span>
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold tabular-nums ${metrics.maxDrawdownPct >= 15 ? 'bg-rose-500/15 text-rose-400' : metrics.maxDrawdownBrl > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>{metrics.maxDrawdownPct.toFixed(2)}% cap.</span>
            </div>
            <div className={`text-[26px] leading-tight font-mono font-bold tabular-nums tracking-tight ${metrics.maxDrawdownPct >= 15 ? 'text-rose-400' : metrics.maxDrawdownBrl > 0 ? 'text-amber-400' : 'text-slate-200'}`}>{formatBrl(-metrics.maxDrawdownBrl, false)}</div>
            <div className="pt-1.5 space-y-1">
              <div className="w-full h-1.5 rounded-full bg-[#161D27] overflow-hidden"><div className={`h-full rounded-full ${metrics.maxDrawdownPct >= 15 ? 'bg-rose-500' : metrics.maxDrawdownBrl > 0 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.max(metrics.maxDrawdownBrl > 0 ? 6 : 0, metrics.maxDrawdownPct * 4))}%` }} /></div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500"><span>Capital ref.: {formatBrl(capitalBase, false)}</span><span>{metrics.maxDrawdownBrl === 0 ? 'Sem rebaixamento' : 'Risco intraday'}</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] px-4 py-3 flex items-center justify-between">
            <div><div className="text-[11px] text-slate-400">Robôs Monitorados</div><div className="text-base font-mono font-bold tabular-nums text-slate-100 mt-0.5">{scopedRobots.length} <span className="text-xs font-normal text-slate-500">/ {robots.length} total</span></div></div>
            <div className="w-8 h-8 rounded-lg bg-[#161D27] border border-[#1E293B] flex items-center justify-center text-blue-400"><Layers className="w-4 h-4" /></div>
          </div>
          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] px-4 py-3 flex items-center justify-between">
            <div><div className="text-[11px] text-slate-400">Posições Abertas</div><div className="text-base font-mono font-bold tabular-nums text-slate-100 mt-0.5 flex items-center gap-2"><span>{openPositions.length}</span>{openPositions.length > 0 ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">ATIVAS</span> : <span className="text-xs font-normal text-slate-500">Flat</span>}</div></div>
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${openPositions.length > 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-[#161D27] border-[#1E293B] text-slate-400'}`}><Activity className="w-4 h-4" /></div>
          </div>
          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between"><span className="text-[11px] text-slate-400">Taxa de Acerto</span><span className="text-[11px] font-mono tabular-nums text-slate-400"><span className="text-emerald-400">{metrics.wins}G</span> / <span className="text-rose-400">{metrics.losses}L</span></span></div>
            <div className="flex items-center gap-3"><span className="text-base font-mono font-bold tabular-nums text-slate-100">{metrics.winRatePct}%</span><div className="flex-1 h-1.5 rounded-full bg-[#161D27] overflow-hidden flex">{metrics.totalTrades > 0 && (<><div className="h-full bg-emerald-500" style={{ width: `${metrics.winRatePct}%` }} /><div className="h-full bg-rose-500" style={{ width: `${100 - metrics.winRatePct}%` }} /></>)}</div></div>
          </div>
          <div className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] px-4 py-3 flex items-center justify-between">
            <div><div className="text-[11px] text-slate-400">Fator de Lucro / Payoff</div><div className="text-base font-mono font-bold tabular-nums text-slate-100 mt-0.5">{metrics.profitFactor.toFixed(2)} <span className="text-xs font-normal text-slate-400">({metrics.payoffRatio.toFixed(2)}x)</span></div></div>
            <div className="text-right text-[11px] font-mono tabular-nums text-slate-500"><div>Seq. Máx</div><div className="text-slate-300">{metrics.maxConsecutiveWins}W/{metrics.maxConsecutiveLosses}L</div></div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <section className="lg:col-span-8 rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Curva de Resultado Intraday (R$)</h2>
                <p className="text-[11px] text-slate-400">Evolução cronológica com destaque para máximas, mínimas e ponto zero</p>
              </div>
              {hoveredPoint ? (
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums bg-[#161D27] px-2.5 py-1 rounded-md border border-[#1E293B]">
                  <span className="text-slate-400">{hoveredPoint.label}</span>
                  <span className={hoveredPoint.cumulativePnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{formatBrl(hoveredPoint.cumulativePnl)}</span>
                  <span className="text-amber-400">DD {formatBrl(hoveredPoint.drawdown)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                  <span className="text-emerald-400">Pico: {formatBrl(rawPeak)}</span>
                  <span className="text-rose-400">Mín: {formatBrl(rawTrough)}</span>
                  <span className="text-slate-400">Vol: {metrics.totalVolume} cts</span>
                </div>
              )}
            </div>
            <div className="p-3 bg-[#090D12] flex-1 flex items-center">
              <svg viewBox={`0 0 ${eqW} ${eqH}`} className="w-full h-auto block select-none" onMouseLeave={() => setHoverEqIdx(null)}>
                <defs>
                  <linearGradient id="eqGradPos" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity="0.28" /><stop offset="100%" stopColor="#10B981" stopOpacity="0" /></linearGradient>
                  <linearGradient id="eqGradNeg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F43F5E" stopOpacity="0.02" /><stop offset="100%" stopColor="#F43F5E" stopOpacity="0.28" /></linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                  const y = padT + r * plotH; const price = maxEq - r * (maxEq - minEq);
                  return (<g key={r}><line x1={padL} x2={eqW - padR} y1={y} y2={y} stroke="#161E29" strokeWidth={1} /><text x={eqW - padR + 8} y={y + 3.5} fill="#64748B" fontSize="10" fontFamily="JetBrains Mono, monospace">{price >= 0 ? `+${price.toFixed(0)}` : price.toFixed(0)}</text></g>);
                })}
                <line x1={padL} x2={eqW - padR} y1={zeroY} y2={zeroY} stroke="#475569" strokeDasharray="4 4" strokeWidth={1} />
                <rect x={eqW - padR + 4} y={zeroY - 8} width={54} height={16} rx={3} fill="#1E293B" />
                <text x={eqW - padR + 8} y={zeroY + 3.5} fill="#CBD5E1" fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono, monospace">R$ 0</text>
                {eqAreaPath && <path d={eqAreaPath} fill={metrics.netPnlBrl >= 0 ? 'url(#eqGradPos)' : 'url(#eqGradNeg)'} />}
                {eqLinePath && <path d={eqLinePath} fill="none" stroke={metrics.netPnlBrl >= 0 ? '#10B981' : '#F43F5E'} strokeWidth={2.25} strokeLinejoin="round" />}
                {equitySeries.length > 1 && rawPeak > 0 && (<g><circle cx={xEq(peakIdx)} cy={yEq(rawPeak)} r={4} fill="#10B981" stroke="#090D12" strokeWidth={1.5} /><text x={Math.min(eqW - padR - 50, Math.max(padL + 4, xEq(peakIdx) - 18))} y={Math.max(padT + 10, yEq(rawPeak) - 8)} fill="#34D399" fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono, monospace">▲ {formatBrl(rawPeak, false)}</text></g>)}
                {equitySeries.length > 1 && rawTrough < 0 && (<g><circle cx={xEq(troughIdx)} cy={yEq(rawTrough)} r={4} fill="#F43F5E" stroke="#090D12" strokeWidth={1.5} /><text x={Math.min(eqW - padR - 72, Math.max(padL + 4, xEq(troughIdx) - 24))} y={Math.min(eqH - 8, yEq(rawTrough) + 15)} fill="#FB7185" fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono, monospace">▼ {formatBrl(rawTrough, false)}</text></g>)}
                {hoverEqIdx !== null && equitySeries[hoverEqIdx] && <line x1={xEq(hoverEqIdx)} x2={xEq(hoverEqIdx)} y1={padT} y2={eqH - padB} stroke="#64748B" strokeDasharray="3 3" strokeWidth={1} />}
                {equitySeries.map((pt, idx) => {
                  const cx = xEq(idx); const cy = yEq(pt.cumulativePnl); const bandW = plotW / Math.max(1, equitySeries.length);
                  return (<g key={idx} onMouseEnter={() => setHoverEqIdx(idx)} className="cursor-crosshair"><rect x={cx - bandW / 2} y={padT} width={bandW} height={plotH} fill="transparent" /><circle cx={cx} cy={cy} r={hoverEqIdx === idx ? 4.5 : 2.5} fill={pt.side === 'COMPRA' ? '#10B981' : pt.side === 'VENDA' ? '#F43F5E' : '#94A3B8'} stroke="#090D12" strokeWidth={1} /></g>);
                })}
              </svg>
            </div>
          </section>

          <aside className="lg:col-span-4 rounded-[10px] bg-[#0F141C] border border-[#1E293B] p-4 flex flex-col justify-between gap-3.5">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
                <h2 className="text-sm font-semibold text-slate-100">Qualidade Operacional</h2>
                <span className="text-[11px] font-mono text-slate-400">Histórico ({cumulativeStats.totalHistTrades} ops)</span>
              </div>

              <div className="rounded-lg bg-[#161D27]/70 border border-[#1E293B] p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Expectativa / Trade</div>
                  <div className="text-[11px] text-slate-500">Média por operação encerrada</div>
                </div>
                <span className={`text-sm font-mono font-bold tabular-nums ${cumulativeStats.expectancyBrl > 0 ? 'text-emerald-400' : cumulativeStats.expectancyBrl < 0 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {formatBrl(cumulativeStats.expectancyBrl)}
                </span>
              </div>

              <div className="rounded-lg bg-[#161D27]/70 border border-[#1E293B] p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-emerald-400 font-semibold">Gain Médio: {formatBrl(cumulativeStats.avgWinBrl, false)}</span>
                  <span className="text-rose-400 font-semibold">Loss Médio: {formatBrl(-cumulativeStats.avgLossBrl, false)}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#090D12] overflow-hidden flex">
                  {(() => {
                    const tot = cumulativeStats.avgWinBrl + cumulativeStats.avgLossBrl;
                    const wPct = tot > 0 ? Math.round((cumulativeStats.avgWinBrl / tot) * 100) : 50;
                    return (<><div className="h-full bg-emerald-500" style={{ width: `${wPct}%` }} /><div className="h-full bg-rose-500" style={{ width: `${100 - wPct}%` }} /></>);
                  })()}
                </div>
              </div>

              <div className="rounded-lg bg-[#161D27]/70 border border-[#1E293B] px-3 py-2 flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="text-slate-400">Consistência Histórica</span>
                <span className="text-slate-200 font-semibold">{cumulativeStats.histWinRate}% acerto • PF {cumulativeStats.histProfitFactor.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status & Alertas</div>
              <div className="space-y-1.5">
                {executiveSummary.alerts.map((al, i) => (
                  <div key={i} className={`px-2.5 py-1.5 rounded-md text-[11px] flex items-center gap-2 border-l-2 ${al.level === 'danger' ? 'bg-rose-950/40 border-rose-500 text-rose-200' : al.level === 'warn' ? 'bg-amber-950/40 border-amber-500 text-amber-200' : al.level === 'info' ? 'bg-blue-950/40 border-blue-500 text-blue-200' : 'bg-emerald-950/30 border-emerald-500 text-emerald-200'}`}>
                    {al.level === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                    <span>{al.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
        <section className="rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-100">Desempenho por Robô ({sortedRobots.length})</h2><span className="text-[11px] text-slate-500 hidden sm:inline">• Clique na linha para filtrar</span></div>
            <div className="flex items-center gap-2 text-[11px]">
              <button type="button" onClick={() => toggleSort('dailyPnl')} className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${sortKey === 'dailyPnl' ? 'bg-[#161D27] border-[#334155] text-slate-100' : 'border-transparent text-slate-400'}`}><span>Resultado</span><ArrowUpDown className="w-3 h-3" /></button>
              <button type="button" onClick={() => toggleSort('winRate')} className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${sortKey === 'winRate' ? 'bg-[#161D27] border-[#334155] text-slate-100' : 'border-transparent text-slate-400'}`}><span>Acerto</span><ArrowUpDown className="w-3 h-3" /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#161D27]/70 text-[11px] uppercase tracking-wider text-slate-400 border-b border-[#1E293B]">
                <tr><th className="px-4 py-2.5 font-medium">Robô</th><th className="px-4 py-2.5 font-medium">Ativo • TF</th><th className="px-4 py-2.5 font-medium">Posição Atual</th><th className="px-4 py-2.5 font-medium text-right">Flutuante</th><th className="px-4 py-2.5 font-medium text-right">Resultado Dia</th><th className="px-4 py-2.5 font-medium text-right">Gráfico</th></tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]/60">
                {sortedRobots.map((bot) => {
                  const buyCount = (bot.trades ?? []).filter((t) => t.side === 'COMPRA').length;
                  const sellCount = (bot.trades ?? []).filter((t) => t.side === 'VENDA').length;
                  const wins = (bot.trades ?? []).filter((t) => t.pnlBrl >= 0).length;
                  const winRate = (bot.trades ?? []).length > 0 ? Math.round((wins / (bot.trades ?? []).length) * 100) : 0;
                  const isSel = selectedRobotId === bot.robotId;
                  return (
                    <tr key={bot.robotId} onClick={() => onSelectRobot(isSel ? 'ALL' : bot.robotId)} className={`transition-colors cursor-pointer ${isSel ? 'bg-blue-500/10' : 'hover:bg-[#161D27]/80'}`}>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`w-1 h-7 rounded-full shrink-0 ${bot.position ? (bot.position.side === 'COMPRA' ? 'bg-emerald-400' : 'bg-rose-400') : bot.dailyPnlBrl > 0 ? 'bg-emerald-500/70' : bot.dailyPnlBrl < 0 ? 'bg-rose-500/70' : 'bg-slate-700'}`} /><div><div className="font-semibold text-slate-100">{bot.name}</div><div className="text-[11px] font-mono text-slate-500">Magic #{bot.magicNumber}</div></div></div></td>
                      <td className="px-4 py-3 font-mono text-slate-200">{bot.symbol} <span className="text-slate-500">• {bot.timeframe || 'M5'}</span></td>
                      <td className="px-4 py-3 font-mono tabular-nums">{bot.position ? (<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${bot.position.side === 'COMPRA' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}`}>{bot.position.side === 'COMPRA' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}<span>{bot.position.side} {bot.position.volume}x @ {formatPrice(bot.position.entryPrice, bot.symbol)}</span></span>) : (<span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-[#161D27] text-slate-400 border border-[#1E293B]">FLAT</span>)}</td>
                      <td className={`px-4 py-3 text-right font-mono tabular-nums ${bot.floatingPnlBrl > 0 ? 'text-emerald-400 font-semibold' : bot.floatingPnlBrl < 0 ? 'text-rose-400 font-semibold' : 'text-slate-500'}`}>{bot.position ? formatBrl(bot.floatingPnlBrl) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${bot.dailyPnlBrl > 0 ? 'text-emerald-400' : bot.dailyPnlBrl < 0 ? 'text-rose-400' : 'text-slate-300'}`}>{formatBrl(bot.dailyPnlBrl)}</td>
                      
                      
                      <td className="px-4 py-3 text-right"><button type="button" onClick={(e) => { e.stopPropagation(); onSelectRobot(bot.robotId); onNavigate('charts'); }} className="inline-flex items-center px-2 py-1 rounded-md bg-[#161D27] hover:bg-[#1E293B] border border-[#1E293B] text-slate-300 hover:text-emerald-400 cursor-pointer"><CandlestickChart className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <section className="lg:col-span-5 rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-100">Posições Abertas ({openPositions.length})</h2><button type="button" onClick={() => onNavigate('operations')} className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer">Livro completo →</button></div>
            {openPositions.length === 0 ? (<div className="px-4 py-3.5 flex items-center gap-2 text-xs text-slate-400"><CheckCircle2 className="w-4 h-4 text-emerald-500/80 shrink-0" /><span>Nenhuma posição em aberto no momento.</span></div>) : (
              <div className="divide-y divide-[#1E293B]/60">
                {openPositions.map((pos) => (
                  <div key={pos.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#161D27]/70">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2"><span className={`text-xs font-semibold ${pos.side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400'}`}>{pos.side} {pos.volume}x {pos.symbol}</span><span className="text-xs text-slate-500 truncate">• {pos.robotName}</span></div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400">Entrada {formatPrice(pos.entryPrice, pos.symbol)} • Atual {formatPrice(pos.currentPrice, pos.symbol)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-mono font-bold tabular-nums ${pos.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(pos.floatingPnlBrl)}</div>
                      <div className="text-[11px] font-mono text-slate-500">{pos.pointsOpen > 0 ? `+${pos.pointsOpen}` : pos.pointsOpen} pts</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="lg:col-span-7 rounded-[10px] bg-[#0F141C] border border-[#1E293B] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-100">Últimas Compras & Vendas ({allTrades.length})</h2><button type="button" onClick={() => onNavigate('buy-sell')} className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer">Análise C & V →</button></div>
            {allTrades.length === 0 ? (<div className="p-5 text-center text-xs text-slate-400">Nenhuma operação encerrada registrada hoje.</div>) : (
              <div className="divide-y divide-[#1E293B]/60">
                {allTrades.slice(0, 6).map((tr) => (
                  <div key={tr.id} className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-[#161D27]/70">
                    <div className="flex items-center gap-3 min-w-0">
                      {tr.side === 'COMPRA' ? <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" /> : <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-100 truncate">{tr.side} {tr.volume}x {tr.symbol} <span className="text-slate-500 font-normal">• {tr.robotName}</span></div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">{tr.entryTime} → {tr.exitTime} • {formatPrice(tr.entryPrice, tr.symbol)} → {formatPrice(tr.exitPrice, tr.symbol)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-xs font-mono font-bold tabular-nums ${tr.pnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(tr.pnlBrl)}</div>
                      <div className="text-[11px] font-mono text-slate-500">{tr.points > 0 ? `+${tr.points}` : tr.points} pts</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
