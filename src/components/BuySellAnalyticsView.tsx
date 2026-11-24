import { getPnlTextClass, getRobotColorTheme } from '../utils/themeTokens';
import { useMemo } from 'react';
import { PeriodFilterBar, usePeriodFilter } from './PeriodFilterBar';
import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardView, RobotStream } from '../types/trading';
import {
  computeHourlyBreakdown,
  computePortfolioMetrics,
  formatBrl,
  getMergedRobotHistory,
} from '../utils/tradingMath';

interface BuySellAnalyticsViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onNavigate: (view: DashboardView) => void;
  magicColors?: Record<number, number>;
}

export function BuySellAnalyticsView({
  robots,
  selectedRobotId,
  magicColors = {},
}: BuySellAnalyticsViewProps) {
  const scopedRobots = useMemo(
    () =>
      selectedRobotId === 'ALL'
        ? robots
        : robots.filter((r) => r.robotId === selectedRobotId),
    [robots, selectedRobotId]
  );

  const periodFilter = usePeriodFilter(scopedRobots);

  const filteredRobots = useMemo(
    () =>
      scopedRobots.map((r) => {
        const merged = getMergedRobotHistory(r).filter((t) => periodFilter.matchesDate(t.exitDate));
        const realized = Number(merged.reduce((acc, t) => acc + t.pnlBrl, 0).toFixed(2));
        return { ...r, trades: merged, realizedPnlBrl: realized };
      }),
    [scopedRobots, periodFilter.startDate, periodFilter.endDate]
  );

  const allTrades = useMemo(
    () => filteredRobots.flatMap((r) => r.trades),
    [filteredRobots]
  );

  const metrics = useMemo(
    () => computePortfolioMetrics(filteredRobots),
    [filteredRobots]
  );

  const hourly = useMemo(
    () => computeHourlyBreakdown(allTrades),
    [allTrades]
  );

  const bySymbol = useMemo(() => {
    const map = new Map<
      string,
      { symbol: string; buyPnl: number; sellPnl: number; buys: number; sells: number; net: number }
    >();
    for (const tr of allTrades) {
      const cur = map.get(tr.symbol) ?? {
        symbol: tr.symbol,
        buyPnl: 0,
        sellPnl: 0,
        buys: 0,
        sells: 0,
        net: 0,
      };
      if (tr.side === 'COMPRA') {
        cur.buys++;
        cur.buyPnl += tr.pnlBrl;
      } else {
        cur.sells++;
        cur.sellPnl += tr.pnlBrl;
      }
      cur.net += tr.pnlBrl;
      map.set(tr.symbol, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [allTrades]);

  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#11161D] border border-[#222B38] p-8 text-center space-y-3">
          <BarChart3 className="w-7 h-7 text-gray-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-gray-100">
            Sem operações para analisar compras e vendas
          </h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            Conecte seu MetaTrader 5 para comparar o desempenho entre operações de compra e venda.
          </p>
        </div>
      </div>
    );
  }

  const maxAbsHour = Math.max(
    50,
    ...hourly.map((h) => Math.abs(h.netPnl))
  );

  const barW = 860;
  const barH = 210;
  const padL = 20;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const plotW = barW - padL - padR;
  const plotH = barH - padT - padB;
  const zeroY = padT + plotH / 2;

  const totalBuySellCount = Math.max(1, metrics.buys.count + metrics.sells.count);
  const buySharePct = Math.round((metrics.buys.count / totalBuySellCount) * 100);
  const sellSharePct = 100 - buySharePct;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h1 className="font-display text-xl font-bold text-gray-100">
              Análise de Compras vs Vendas
            </h1>
            <p className="text-xs text-gray-400">
              Comparativo completo entre operações compradas (Long) e vendidas (Short)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodFilterBar filter={periodFilter} />
          {selectedRobotId !== 'ALL' && scopedRobots.length === 1 ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#11161D] border border-[#222B38] text-xs">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getRobotColorTheme(scopedRobots[0].magicNumber, magicColors).dot}`} />
              <span className="font-semibold text-gray-100">{scopedRobots[0].name}</span>
              <span className="font-mono text-gray-400">#{scopedRobots[0].magicNumber} · {scopedRobots[0].symbol}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#11161D] border border-[#222B38] text-xs text-gray-300">
              Todos os Robôs ({scopedRobots.length})
            </div>
          )}
          </div>
        </div>

        {/* Proporção Compra / Venda */}
        <div className="rounded-xl bg-[#11161D] border border-[#222B38] p-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className={metrics.buys.count > 0 ? "text-emerald-400 font-semibold" : "text-gray-400"}>
              Compras: {metrics.buys.count} operações ({buySharePct}%)
            </span>
            <span className={metrics.sells.count > 0 ? "text-red-400 font-semibold" : "text-gray-400"}>
              Vendas: {metrics.sells.count} operações ({sellSharePct}%)
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[#1C2430] overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${buySharePct}%` }}
            />
            <div
              className="h-full bg-red-500 transition-all"
              style={{ width: `${sellSharePct}%` }}
            />
          </div>
        </div>

        {/* Comparativo Lado a Lado: Compras x Vendas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bloco Compras */}
          <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-gray-100">
                  Operações de Compra (Long)
                </h2>
              </div>
              <span
                className={`text-sm font-mono font-bold tabular-nums ${
                  getPnlTextClass(metrics.buys.netPnlBrl)
                }`}
              >
                {formatBrl(metrics.buys.netPnlBrl)}
              </span>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-gray-400">Total / Acerto</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.buys.count} ops ({metrics.buys.winRatePct}%)
                </div>
              </div>
              <div>
                <div className="text-gray-400">Fator de Lucro</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.buys.profitFactor.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Payoff Médio</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.buys.payoffRatio.toFixed(2)}x
                </div>
              </div>
              <div>
                <div className="text-gray-400">Ganho Médio</div>
                <div className={`mt-1 font-mono font-semibold tabular-nums ${getPnlTextClass(metrics.buys.avgWinBrl)}`}>
                  {formatBrl(metrics.buys.avgWinBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Perda Média</div>
                <div className={`mt-1 font-mono font-semibold tabular-nums ${getPnlTextClass(-metrics.buys.avgLossBrl)}`}>
                  {formatBrl(-metrics.buys.avgLossBrl, false)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Média de Pontos</div>
                <div className="mt-1 font-mono font-semibold tabular-nums text-gray-200">
                  {metrics.buys.avgPoints > 0 ? `+${metrics.buys.avgPoints}` : metrics.buys.avgPoints} pts
                </div>
              </div>
              <div>
                <div className="text-gray-400">Melhor Compra</div>
                <div className={`mt-1 font-mono tabular-nums ${getPnlTextClass(metrics.buys.bestTradeBrl)}`}>
                  {formatBrl(metrics.buys.bestTradeBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Pior Compra</div>
                <div className={`mt-1 font-mono tabular-nums ${getPnlTextClass(metrics.buys.worstTradeBrl)}`}>
                  {formatBrl(metrics.buys.worstTradeBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Volume Comprado</div>
                <div className="mt-1 font-mono tabular-nums text-gray-200">
                  {metrics.buys.totalVolume}
                </div>
              </div>
            </div>
          </section>

          {/* Bloco Vendas */}
          <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-semibold text-gray-100">
                  Operações de Venda (Short)
                </h2>
              </div>
              <span
                className={`text-sm font-mono font-bold tabular-nums ${
                  getPnlTextClass(metrics.sells.netPnlBrl)
                }`}
              >
                {formatBrl(metrics.sells.netPnlBrl)}
              </span>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-gray-400">Total / Acerto</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.sells.count} ops ({metrics.sells.winRatePct}%)
                </div>
              </div>
              <div>
                <div className="text-gray-400">Fator de Lucro</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.sells.profitFactor.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Payoff Médio</div>
                <div className="mt-1 font-mono font-bold tabular-nums text-gray-100 text-sm">
                  {metrics.sells.payoffRatio.toFixed(2)}x
                </div>
              </div>
              <div>
                <div className="text-gray-400">Ganho Médio</div>
                <div className={`mt-1 font-mono font-semibold tabular-nums ${getPnlTextClass(metrics.buys.avgWinBrl)}`}>
                  {formatBrl(metrics.sells.avgWinBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Perda Média</div>
                <div className={`mt-1 font-mono font-semibold tabular-nums ${getPnlTextClass(-metrics.buys.avgLossBrl)}`}>
                  {formatBrl(-metrics.sells.avgLossBrl, false)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Média de Pontos</div>
                <div className="mt-1 font-mono font-semibold tabular-nums text-gray-200">
                  {metrics.sells.avgPoints > 0 ? `+${metrics.sells.avgPoints}` : metrics.sells.avgPoints} pts
                </div>
              </div>
              <div>
                <div className="text-gray-400">Melhor Venda</div>
                <div className={`mt-1 font-mono tabular-nums ${getPnlTextClass(metrics.buys.bestTradeBrl)}`}>
                  {formatBrl(metrics.sells.bestTradeBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Pior Venda</div>
                <div className={`mt-1 font-mono tabular-nums ${getPnlTextClass(metrics.buys.worstTradeBrl)}`}>
                  {formatBrl(metrics.sells.worstTradeBrl)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">Volume Vendido</div>
                <div className="mt-1 font-mono tabular-nums text-gray-200">
                  {metrics.sells.totalVolume}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Desempenho por Horário do Pregão */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                Resultado Líquido por Horário do Pregão
              </h2>
              <p className="text-xs text-gray-400">
                Distribuição horária de lucro/prejuízo e quantidade de compras e vendas
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#0B0E11]">
            <svg viewBox={`0 0 ${barW} ${barH}`} className="w-full h-auto block select-none">
              <line
                x1={padL}
                x2={barW - padR}
                y1={zeroY}
                y2={zeroY}
                stroke="#334155"
                strokeWidth={1}
              />

              {hourly.map((bucket, idx) => {
                const slotW = plotW / Math.max(1, hourly.length);
                const cx = padL + (idx + 0.5) * slotW;
                const w = Math.min(36, slotW * 0.52);
                const barLen = (Math.abs(bucket.netPnl) / maxAbsHour) * (plotH / 2 - 14);
                const isPos = bucket.netPnl >= 0;
                const y = isPos ? zeroY - barLen : zeroY;

                return (
                  <g key={bucket.hour}>
                    <rect
                      x={cx - w / 2}
                      y={y}
                      width={w}
                      height={Math.max(2, barLen)}
                      rx={2}
                      fill={bucket.netPnl === 0 ? '#334155' : isPos ? '#10B981' : '#EF4444'}
                      opacity={bucket.netPnl === 0 ? 0.35 : 0.85}
                    />
                    {bucket.netPnl !== 0 && (
                      <text
                        x={cx}
                        y={isPos ? y - 6 : y + barLen + 12}
                        textAnchor="middle"
                        fill={isPos ? '#34D399' : '#F87171'}
                        fontSize="9.5"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {bucket.netPnl >= 0
                          ? `+${bucket.netPnl.toFixed(0)}`
                          : bucket.netPnl.toFixed(0)}
                      </text>
                    )}
                    <text
                      x={cx}
                      y={barH - 8}
                      textAnchor="middle"
                      fill="#9CA3AF"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {bucket.hour} ({bucket.buyCount}C/{bucket.sellCount}V)
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Tabela de Resultado por Ativo */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633]">
            <h2 className="text-sm font-semibold text-gray-100">
              Compras & Vendas por Ativo
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#0E1319] text-[11px] text-gray-400 border-b border-[#1E2633]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Ativo</th>
                  <th className="px-4 py-2.5 font-medium text-right">Qtd Compras</th>
                  <th className="px-4 py-2.5 font-medium text-right">Resultado Compras</th>
                  <th className="px-4 py-2.5 font-medium text-right">Qtd Vendas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Resultado Vendas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Saldo Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1B222D] font-mono tabular-nums">
                {bySymbol.map((row) => (
                  <tr key={row.symbol} className="hover:bg-[#171E27]">
                    <td className="px-4 py-3 font-semibold text-gray-100">{row.symbol}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{row.buys}</td>
                    <td
                      className={`px-4 py-3 text-right ${
                        getPnlTextClass(row.buyPnl)
                      }`}
                    >
                      {formatBrl(row.buyPnl)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{row.sells}</td>
                    <td
                      className={`px-4 py-3 text-right ${
                        getPnlTextClass(row.sellPnl)
                      }`}
                    >
                      {formatBrl(row.sellPnl)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-bold ${
                        getPnlTextClass(row.net)
                      }`}
                    >
                      {formatBrl(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
