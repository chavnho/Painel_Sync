import { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  PlugZap,
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

  const scopedRobots = useMemo(
    () =>
      selectedRobotId === 'ALL'
        ? robots
        : robots.filter((r) => r.robotId === selectedRobotId),
    [robots, selectedRobotId]
  );

  const metrics = useMemo(
    () => computePortfolioMetrics(scopedRobots, account?.balance || 25000),
    [scopedRobots, account?.balance]
  );

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

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('connect')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors cursor-pointer"
              >
                <PlugZap className="w-4 h-4 shrink-0" />
                <span>Conectar MetaTrader 5</span>
              </button>
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
            onOpenConnect={() => onNavigate('connect')}
          />
        </div>
      </div>
    );
  }

  // Geometria SVG da Curva de Capital
  const eqW = 860;
  const eqH = 220;
  const padL = 16;
  const padR = 76;
  const padT = 16;
  const padB = 26;
  const plotW = eqW - padL - padR;
  const plotH = eqH - padT - padB;

  let minEq = 0;
  let maxEq = 0;
  for (const pt of equitySeries) {
    if (pt.cumulativePnl < minEq) minEq = pt.cumulativePnl;
    if (pt.cumulativePnl > maxEq) maxEq = pt.cumulativePnl;
  }
  if (maxEq - minEq < 50) {
    maxEq += 50;
    minEq -= 50;
  } else {
    const margin = (maxEq - minEq) * 0.12;
    maxEq += margin;
    minEq -= margin;
  }

  const xEq = (idx: number) =>
    equitySeries.length <= 1
      ? padL + plotW / 2
      : padL + (idx / (equitySeries.length - 1)) * plotW;

  const yEq = (val: number) =>
    padT + ((maxEq - val) / (maxEq - minEq)) * plotH;

  const eqLinePath = equitySeries
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xEq(i).toFixed(1)} ${yEq(pt.cumulativePnl).toFixed(1)}`)
    .join(' ');

  const zeroY = yEq(0);
  const eqAreaPath =
    equitySeries.length > 1
      ? `${eqLinePath} L ${xEq(equitySeries.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${xEq(0).toFixed(1)} ${zeroY.toFixed(1)} Z`
      : '';

  const hoveredPoint =
    hoverEqIdx !== null && equitySeries[hoverEqIdx] ? equitySeries[hoverEqIdx] : null;

  const activeTitle =
    selectedRobotId === 'ALL'
      ? `Carteira Consolidada · ${robots.length} robôs ativos`
      : `${scopedRobots[0]?.name ?? 'Robô'} · ${scopedRobots[0]?.symbol ?? ''}`;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Cabeçalho de Contexto */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="font-display text-xl font-bold text-gray-100">
              {activeTitle}
            </h1>
            <div className="text-xs text-gray-400">
              <span>Telemetria MT5 em Tempo Real</span>
              <span className="mx-2 text-gray-600">·</span>
              <span>{openPositions.length} posições em aberto</span>
              <span className="mx-2 text-gray-600">·</span>
              <span>{metrics.totalTrades} negócios encerrados hoje</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedRobotId !== 'ALL' && (
              <button
                type="button"
                onClick={() => onSelectRobot('ALL')}
                className="px-3 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#263040] text-xs font-medium text-gray-200 transition-colors cursor-pointer"
              >
                Ver Todos os Robôs
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('charts')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#263040] text-xs font-medium text-gray-100 transition-colors cursor-pointer"
            >
              <CandlestickChart className="w-3.5 h-3.5 text-emerald-400" />
              <span>Abrir Gráfico Candlestick</span>
            </button>
          </div>
        </div>

        {/* Faixa de KPIs Principais */}
        <div className="grid grid-cols-2 lg:grid-cols-5 bg-[#11161D] border border-[#222B38] rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-[#222B38]">
          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Resultado Líquido (Dia)</div>
            <div
              className={`text-xl font-mono font-bold tabular-nums ${
                metrics.netPnlBrl > 0
                  ? 'text-emerald-400'
                  : metrics.netPnlBrl < 0
                    ? 'text-red-400'
                    : 'text-gray-200'
              }`}
            >
              {formatBrl(metrics.netPnlBrl)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">
              Realizado {formatBrl(metrics.realizedPnlBrl)} · Flut. {formatBrl(metrics.floatingPnlBrl)}
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Compras vs Vendas</div>
            <div className="flex items-baseline gap-3 font-mono tabular-nums">
              <span className="text-sm font-bold text-emerald-400">
                C: {formatBrl(metrics.buys.netPnlBrl)}
              </span>
              <span className="text-sm font-bold text-red-400">
                V: {formatBrl(metrics.sells.netPnlBrl)}
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">
              {metrics.buys.count} compras ({metrics.buys.winRatePct}%) · {metrics.sells.count} vendas ({metrics.sells.winRatePct}%)
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Taxa de Acerto</div>
            <div className="text-xl font-mono font-bold tabular-nums text-gray-100">
              {metrics.winRatePct}%
            </div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">
              {metrics.wins} gains · {metrics.losses} losses
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Fator de Lucro / Payoff</div>
            <div className="text-xl font-mono font-bold tabular-nums text-gray-100">
              {metrics.profitFactor.toFixed(2)}
              <span className="text-xs font-normal text-gray-400 ml-2">
                ({metrics.payoffRatio.toFixed(2)}x)
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">
              Seq. Máx: {metrics.maxConsecutiveWins}W / {metrics.maxConsecutiveLosses}L
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-gray-400">Drawdown Máx Intraday</div>
            <div className="text-xl font-mono font-bold tabular-nums text-amber-400">
              {formatBrl(-metrics.maxDrawdownBrl, false)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-gray-500">
              {metrics.maxDrawdownPct.toFixed(2)}% sobre o capital
            </div>
          </div>
        </div>

        {/* Gráfico Principal: Curva de Patrimônio Intraday */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                Curva de Resultado Acumulado (R$)
              </h2>
              <p className="text-xs text-gray-400">
                Evolução cronológica das operações fechadas e resultado flutuante atual
              </p>
            </div>
            {hoveredPoint ? (
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                <span className="text-gray-400">{hoveredPoint.label}</span>
                {hoveredPoint.symbol && (
                  <span className="text-gray-300">{hoveredPoint.symbol}</span>
                )}
                <span
                  className={
                    hoveredPoint.cumulativePnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'
                  }
                >
                  Acumulado: {formatBrl(hoveredPoint.cumulativePnl)}
                </span>
                <span className="text-amber-400">
                  DD: {formatBrl(hoveredPoint.drawdown)}
                </span>
              </div>
            ) : (
              <div className="text-xs font-mono tabular-nums text-gray-400">
                Volume total negociado: {metrics.totalVolume} contratos/ações
              </div>
            )}
          </div>

          <div className="p-3 bg-[#0B0E11]">
            <svg
              viewBox={`0 0 ${eqW} ${eqH}`}
              className="w-full h-auto block select-none"
              onMouseLeave={() => setHoverEqIdx(null)}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                const y = padT + r * plotH;
                const price = maxEq - r * (maxEq - minEq);
                return (
                  <g key={r}>
                    <line
                      x1={padL}
                      x2={eqW - padR}
                      y1={y}
                      y2={y}
                      stroke="#18202B"
                      strokeWidth={1}
                    />
                    <text
                      x={eqW - padR + 8}
                      y={y + 4}
                      fill="#6B7280"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {price >= 0 ? `+${price.toFixed(0)}` : price.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Linha Zero */}
              <line
                x1={padL}
                x2={eqW - padR}
                y1={zeroY}
                y2={zeroY}
                stroke="#334155"
                strokeDasharray="4 4"
                strokeWidth={1}
              />

              {eqAreaPath && (
                <path
                  d={eqAreaPath}
                  fill={metrics.netPnlBrl >= 0 ? '#10B981' : '#EF4444'}
                  opacity={0.12}
                />
              )}

              {eqLinePath && (
                <path
                  d={eqLinePath}
                  fill="none"
                  stroke={metrics.netPnlBrl >= 0 ? '#10B981' : '#EF4444'}
                  strokeWidth={2}
                />
              )}

              {hoverEqIdx !== null && equitySeries[hoverEqIdx] && (
                <line
                  x1={xEq(hoverEqIdx)}
                  x2={xEq(hoverEqIdx)}
                  y1={padT}
                  y2={eqH - padB}
                  stroke="#475569"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}

              {equitySeries.map((pt, idx) => {
                const cx = xEq(idx);
                const cy = yEq(pt.cumulativePnl);
                const bandW = plotW / Math.max(1, equitySeries.length);
                return (
                  <g
                    key={idx}
                    onMouseEnter={() => setHoverEqIdx(idx)}
                    className="cursor-crosshair"
                  >
                    <rect
                      x={cx - bandW / 2}
                      y={padT}
                      width={bandW}
                      height={plotH}
                      fill="transparent"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={hoverEqIdx === idx ? 4.5 : 2.5}
                      fill={
                        pt.side === 'COMPRA'
                          ? '#10B981'
                          : pt.side === 'VENDA'
                            ? '#EF4444'
                            : '#94A3B8'
                      }
                      stroke="#0B0E11"
                      strokeWidth={1}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Tabela de Robôs (Fleet Status) */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">
              Desempenho por Robô ({scopedRobots.length})
            </h2>
            <span className="text-xs text-gray-400">
              Clique em um robô para filtrar gráficos e operações
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#0E1319] text-[11px] text-gray-400 border-b border-[#1E2633]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Robô / Magic</th>
                  <th className="px-4 py-2.5 font-medium">Ativo · TF</th>
                  <th className="px-4 py-2.5 font-medium">Posição Atual</th>
                  <th className="px-4 py-2.5 font-medium text-right">Flutuante</th>
                  <th className="px-4 py-2.5 font-medium text-right">Realizado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Resultado Dia</th>
                  <th className="px-4 py-2.5 font-medium text-right">Compras / Vendas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Acerto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1B222D]">
                {scopedRobots.map((bot) => {
                  const buyCount = bot.trades.filter((t) => t.side === 'COMPRA').length;
                  const sellCount = bot.trades.filter((t) => t.side === 'VENDA').length;
                  const wins = bot.trades.filter((t) => t.pnlBrl >= 0).length;
                  const winRate =
                    bot.trades.length > 0 ? Math.round((wins / bot.trades.length) * 100) : 0;

                  return (
                    <tr
                      key={bot.robotId}
                      onClick={() => onSelectRobot(bot.robotId)}
                      className="hover:bg-[#171E27] transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-100">{bot.name}</div>
                        <div className="text-[11px] font-mono text-gray-500">
                          Magic #{bot.magicNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-200">
                        {bot.symbol} · {bot.timeframe}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {bot.position ? (
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              bot.position.side === 'COMPRA'
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {bot.position.side === 'COMPRA' ? (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDownRight className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {bot.position.side} {bot.position.volume} @{' '}
                              {formatPrice(bot.position.entryPrice, bot.symbol)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-500">Zerado</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${
                          bot.floatingPnlBrl > 0
                            ? 'text-emerald-400'
                            : bot.floatingPnlBrl < 0
                              ? 'text-red-400'
                              : 'text-gray-500'
                        }`}
                      >
                        {bot.position ? formatBrl(bot.floatingPnlBrl) : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${
                          bot.realizedPnlBrl >= 0 ? 'text-gray-200' : 'text-red-300'
                        }`}
                      >
                        {formatBrl(bot.realizedPnlBrl)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${
                          bot.dailyPnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(bot.dailyPnlBrl)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-300">
                        <span className="text-emerald-400">{buyCount}C</span>
                        <span className="mx-1 text-gray-600">/</span>
                        <span className="text-red-400">{sellCount}V</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-200">
                        {winRate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Grid Inferior: Posições Abertas + Últimas Compras e Vendas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Posições Abertas */}
          <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-100">
                Posições Abertas ({openPositions.length})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('operations')}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                Ver livro completo
              </button>
            </div>

            {openPositions.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                Nenhuma posição aberta no momento para os robôs selecionados.
              </div>
            ) : (
              <div className="divide-y divide-[#1B222D]">
                {openPositions.map((pos) => (
                  <div
                    key={pos.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[#161C25] transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold ${
                            pos.side === 'COMPRA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {pos.side} {pos.volume}x {pos.symbol}
                        </span>
                        <span className="text-xs text-gray-500 truncate">
                          · {pos.robotName}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-gray-400">
                        Entrada {formatPrice(pos.entryPrice, pos.symbol)} · Atual{' '}
                        {formatPrice(pos.currentPrice, pos.symbol)} · SL{' '}
                        {pos.sl > 0 ? formatPrice(pos.sl, pos.symbol) : '—'} · TP{' '}
                        {pos.tp > 0 ? formatPrice(pos.tp, pos.symbol) : '—'}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-sm font-mono font-bold tabular-nums ${
                          pos.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(pos.floatingPnlBrl)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-gray-500">
                        {pos.pointsOpen > 0 ? `+${pos.pointsOpen}` : pos.pointsOpen} pts
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Últimas Operações Executadas */}
          <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-100">
                Últimas Compras & Vendas ({allTrades.length})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('buy-sell')}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                Análise C & V
              </button>
            </div>

            {allTrades.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                Nenhuma operação encerrada registrada hoje.
              </div>
            ) : (
              <div className="divide-y divide-[#1B222D]">
                {allTrades.slice(0, 6).map((tr) => (
                  <div
                    key={tr.id}
                    className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#161C25] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {tr.side === 'COMPRA' ? (
                        <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-gray-100 truncate">
                          {tr.side} {tr.volume}x {tr.symbol}{' '}
                          <span className="text-gray-500 font-normal">· {tr.robotName}</span>
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-gray-400">
                          {tr.entryTime} → {tr.exitTime} · {formatPrice(tr.entryPrice, tr.symbol)} →{' '}
                          {formatPrice(tr.exitPrice, tr.symbol)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-mono font-bold tabular-nums ${
                          tr.pnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(tr.pnlBrl)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-gray-500">
                        {tr.points > 0 ? `+${tr.points}` : tr.points} pts
                      </div>
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
