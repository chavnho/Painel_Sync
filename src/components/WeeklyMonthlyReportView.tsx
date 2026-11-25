import { getRobotColorTheme, UI_THEME } from '../utils/themeTokens';
import { useMemo, useState } from 'react';
import { PeriodFilterBar, usePeriodFilter } from './PeriodFilterBar';
import { CalendarRange, Download } from 'lucide-react';
import type { DashboardView, RobotStream } from '../types/trading';
import { computeRobotHistoricalReport, exportReportCsv, formatBrl } from '../utils/tradingMath';

interface WeeklyMonthlyReportViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  magicColors?: Record<number, number>;
  onSelectRobot: (robotId: string | 'ALL') => void;
  onNavigate: (view: DashboardView) => void;
}
function profitFactorStatus(pf: number, totalTrades: number) {
  if (totalTrades === 0) return { label: 'Sem dados', colorClass: 'text-gray-500' };
  if (pf >= 1.5) return { label: 'Saudável', colorClass: 'text-emerald-400' };
  if (pf >= 1.0) return { label: 'Neutro', colorClass: 'text-amber-400' };
  return { label: 'Negativo', colorClass: 'text-rose-400' };
}
export function WeeklyMonthlyReportView({ robots, selectedRobotId, magicColors = {}, onSelectRobot }: WeeklyMonthlyReportViewProps) {
  const [hoverDayIdx, setHoverDayIdx] = useState<number | null>(null);
  const periodFilter = usePeriodFilter(robots);
  const scopedRobots = useMemo(() => (selectedRobotId === 'ALL' ? robots : robots.filter((r) => r.robotId === selectedRobotId)), [robots, selectedRobotId]);
  const report = useMemo(() => computeRobotHistoricalReport(scopedRobots, 'monthly_30', { startDate: periodFilter.startDate, endDate: periodFilter.endDate }), [scopedRobots, periodFilter.startDate, periodFilter.endDate]);
  const activeLabel = periodFilter.periodSummaryLabel;
  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10 bg-[#090D12]">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center space-y-3">
          <CalendarRange className="w-7 h-7 text-gray-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-gray-100">Sem histórico disponível para relatório</h2>
          <p className="text-xs text-gray-400 leading-relaxed">Conecte seu MetaTrader 5 para analisar a taxa de acerto e o fator de lucro de cada robô.</p>
        </div>
      </div>
    );
  }
  const { consolidated, dailySeries } = report;
  const pfState = profitFactorStatus(consolidated.profitFactor, consolidated.totalTrades);
  const chartW = 920, chartH = 220, padL = 20, padR = 20, padT = 20, padB = 32;
  const plotW = chartW - padL - padR, plotH = chartH - padT - padB, zeroY = padT + plotH / 2;
  const maxAbsDay = Math.max(50, ...dailySeries.map((d) => Math.abs(d.netPnlBrl)));
  const hoveredDay = hoverDayIdx !== null && dailySeries[hoverDayIdx] ? dailySeries[hoverDayIdx] : null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 bg-[#090D12]">
      <div className="max-w-[1320px] mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h1 className={UI_THEME.typography.pageTitle}>Relatório Histórico Consolidado</h1>
            <p className="text-xs text-gray-400">
              {activeLabel} • {selectedRobotId === 'ALL' ? `${robots.length} robôs consolidados` : scopedRobots[0]?.name} • {dailySeries.length} pregões com negócios
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodFilterBar filter={periodFilter} onManualDateChange={() => setHoverDayIdx(null)} />
            {selectedRobotId !== 'ALL' && (
              <button type="button" onClick={() => onSelectRobot('ALL')} className="h-8 px-3 rounded-lg bg-[#161D27] hover:bg-[#1E2633] border border-[#1E2633] text-xs font-medium text-gray-200 transition-colors cursor-pointer flex items-center">Consolidar Todos</button>
            )}
            <button type="button" onClick={() => exportReportCsv([...report.rows, report.consolidated], activeLabel)} className="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-[#161D27] hover:bg-[#1E2633] border border-[#1E2633] text-xs font-medium text-gray-100 transition-colors cursor-pointer">
              <Download className="w-3.5 h-3.5 text-emerald-400" /><span>Exportar CSV</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 bg-[#0F141C] border border-[#1E2633] rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-[#1E2633]">
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Resultado do Período</div>
            <div className={`text-xl font-mono font-bold tabular-nums ${consolidated.netPnlBrl > 0 ? 'text-emerald-400' : consolidated.netPnlBrl < 0 ? 'text-rose-400' : 'text-gray-200'}`}>{formatBrl(consolidated.netPnlBrl)}</div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">Média {formatBrl(consolidated.avgTradeBrl)} / op</div>
          </div>
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Taxa de Acerto (Win Rate)</div>
            <div className="text-xl font-mono font-bold tabular-nums text-gray-100">{consolidated.winRatePct}%</div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">{consolidated.wins} gains • {consolidated.losses} losses ({consolidated.totalTrades} ops)</div>
          </div>
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Fator de Lucro (Profit Factor)</div>
            <div className={`text-xl font-mono font-bold tabular-nums ${pfState.colorClass}`}>{consolidated.profitFactor.toFixed(2)}<span className="ml-2 text-xs font-sans font-medium">• {pfState.label}</span></div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">Payoff {consolidated.payoffRatio.toFixed(2)}x</div>
          </div>
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Lucro Bruto / Prejuízo Bruto</div>
            <div className="text-sm font-mono font-semibold tabular-nums text-emerald-400 pt-0.5">+{formatBrl(consolidated.grossProfitBrl, false)}</div>
            <div className="text-[11px] font-mono tabular-nums text-rose-400">-{formatBrl(consolidated.grossLossBrl, false)}</div>
          </div>
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Drawdown Máximo</div>
            <div className="text-xl font-mono font-bold tabular-nums text-rose-400/90">{formatBrl(-consolidated.maxDrawdownBrl, false)}</div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">Compras {consolidated.buyWinRatePct}% • Vendas {consolidated.sellWinRatePct}%</div>
          </div>
        </div>
        <section className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Desempenho Diário no Período ({activeLabel})</h2>
              <p className="text-xs text-gray-400">Resultado líquido por pregão e taxa de acerto diária</p>
            </div>
            {hoveredDay ? (
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                <span className="text-gray-300 font-semibold">{hoveredDay.dateLabel}</span>
                <span className="text-gray-400">{hoveredDay.tradesCount} ops ({hoveredDay.winRatePct}% acerto)</span>
                <span className={hoveredDay.netPnlBrl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>{formatBrl(hoveredDay.netPnlBrl)}</span>
              </div>
            ) : (<span className="text-xs text-gray-500">Passe o mouse nas barras para ver o detalhe do pregão</span>)}
          </div>
          <div className="p-4 bg-[#090D12]">
            {dailySeries.length === 0 ? (<div className="py-10 text-center text-xs text-gray-500">Nenhuma operação histórica registrada dentro do período selecionado.</div>) : (
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto block select-none" onMouseLeave={() => setHoverDayIdx(null)}>
                <line x1={padL} x2={chartW - padR} y1={zeroY} y2={zeroY} stroke="#334155" strokeWidth={1} />
                {dailySeries.map((day, idx) => {
                  const slotW = plotW / Math.max(1, dailySeries.length), cx = padL + (idx + 0.5) * slotW, barWidth = Math.max(6, Math.min(28, slotW * 0.62));
                  const barLen = (Math.abs(day.netPnlBrl) / maxAbsDay) * (plotH / 2 - 14), isPos = day.netPnlBrl >= 0, y = isPos ? zeroY - barLen : zeroY, labelStep = Math.max(1, Math.ceil(dailySeries.length / 10));
                  return (
                    <g key={day.dateIso} onMouseEnter={() => setHoverDayIdx(idx)} className="cursor-crosshair">
                      <rect x={cx - slotW / 2} y={padT} width={slotW} height={plotH} fill={hoverDayIdx === idx ? '#161D27' : 'transparent'} />
                      <rect x={cx - barWidth / 2} y={y} width={barWidth} height={Math.max(2, barLen)} rx={2} fill={isPos ? '#10B981' : '#F43F5E'} opacity={hoverDayIdx === idx ? 0.95 : 0.72} />
                      {(idx % labelStep === 0 || idx === dailySeries.length - 1) && (<text x={cx} y={chartH - 8} textAnchor="middle" fill="#9CA3AF" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{day.dateLabel}</text>)}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </section>
        <section className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-sm font-semibold text-gray-100">Consolidado por Robô • Taxa de Acerto & Fator de Lucro</h2><p className="text-xs text-gray-400">Clique em qualquer robô para filtrar o gráfico diário e os KPIs acima</p></div>
            <span className="text-xs font-mono text-gray-500">{report.rows.length} robôs no período</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className={UI_THEME.typography.tableHeader}>
                <tr><th className="px-4 py-2.5 font-medium">Robô / Magic</th><th className="px-4 py-2.5 font-medium">Ativo</th><th className="px-4 py-2.5 font-medium text-right">Ops (G / L)</th><th className="px-4 py-2.5 font-medium">Taxa de Acerto (Win Rate)</th><th className="px-4 py-2.5 font-medium text-right">Fator de Lucro</th><th className="px-4 py-2.5 font-medium text-right">Payoff</th><th className="px-4 py-2.5 font-medium text-right">Lucro Bruto</th><th className="px-4 py-2.5 font-medium text-right">Prejuízo Bruto</th><th className="px-4 py-2.5 font-medium text-right">DD Máx</th><th className="px-4 py-2.5 font-medium text-right">Resultado Líq.</th></tr>
              </thead>
              <tbody className={UI_THEME.typography.tableBody}>
                {report.rows.map((row) => {
                  const status = profitFactorStatus(row.profitFactor, row.totalTrades), isSelected = selectedRobotId === row.robotId;
                  return (
                    <tr key={row.robotId} onClick={() => onSelectRobot(isSelected ? 'ALL' : row.robotId)} className={`transition-colors cursor-pointer ${isSelected ? 'bg-[#161D27]' : 'hover:bg-[#131922]'}`}>
                      <td className="px-4 py-3 font-sans"><div className="flex items-center gap-1.5 font-semibold text-gray-100"><span className={`w-2 h-2 rounded-full shrink-0 ${getRobotColorTheme(row.magicNumber, magicColors).dot}`} /><span>{row.robotName}</span></div><div className="text-[11px] font-mono text-gray-500">Magic #{row.magicNumber}</div></td>
                      <td className="px-4 py-3 text-gray-200 font-semibold">{row.symbol}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{row.totalTrades} <span className="text-[11px] text-gray-500">({row.wins}/{row.losses})</span></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2.5 min-w-[140px]"><div className="flex-1 h-1.5 rounded-full bg-[#090D12] border border-[#1E2633] overflow-hidden"><div className={`h-full rounded-full ${row.winRatePct >= 55 ? 'bg-emerald-500/75' : row.winRatePct >= 45 ? 'bg-amber-400/75' : 'bg-rose-500/75'}`} style={{ width: `${Math.min(100, row.winRatePct)}%` }} /></div><span className="w-10 text-right font-semibold text-gray-100">{row.winRatePct}%</span></div></td>
                      <td className={`px-4 py-3 text-right font-bold ${status.colorClass}`}>{row.profitFactor.toFixed(2)} <span className="text-[10px] font-sans font-normal text-gray-400">({status.label})</span></td>
                      <td className="px-4 py-3 text-right text-gray-300">{row.payoffRatio.toFixed(2)}x</td>
                      <td className="px-4 py-3 text-right text-emerald-400">+{formatBrl(row.grossProfitBrl, false)}</td>
                      <td className="px-4 py-3 text-right text-rose-400">-{formatBrl(row.grossLossBrl, false)}</td>
                      <td className="px-4 py-3 text-right text-rose-400/90">{formatBrl(-row.maxDrawdownBrl, false)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${row.netPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(row.netPnlBrl)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#090D12] border-t border-[#1E2633] font-mono tabular-nums text-xs">
                <tr>
                  <td className="px-4 py-3 font-sans font-bold text-gray-100">Total Consolidado ({report.rows.length} robôs)</td>
                  <td className="px-4 py-3 text-gray-400">—</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-200">{consolidated.totalTrades} <span className="text-[11px] text-gray-500">({consolidated.wins}/{consolidated.losses})</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-100">{consolidated.winRatePct}%</td>
                  <td className={`px-4 py-3 text-right font-bold ${pfState.colorClass}`}>{consolidated.profitFactor.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-200">{consolidated.payoffRatio.toFixed(2)}x</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-400">+{formatBrl(consolidated.grossProfitBrl, false)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-rose-400">-{formatBrl(consolidated.grossLossBrl, false)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-rose-400/90">{formatBrl(-consolidated.maxDrawdownBrl, false)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${consolidated.netPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatBrl(consolidated.netPnlBrl)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
