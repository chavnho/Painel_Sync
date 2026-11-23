import { useMemo, useState } from 'react';
import { Download, Search, TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardView, OpenPosition, RobotStream } from '../types/trading';
import { exportTradesCsv, formatBrl, formatPrice } from '../utils/tradingMath';

interface TradesLedgerViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onNavigate: (view: DashboardView) => void;
}

export function TradesLedgerView({
  robots,
  selectedRobotId,
  onNavigate,
}: TradesLedgerViewProps) {
  const [search, setSearch] = useState('');
  const [rangeFilter, setRangeFilter] = useState<'recent' | '7d' | '30d'>('7d');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'COMPRA' | 'VENDA'>('ALL');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'GAIN' | 'LOSS'>('ALL');

  const scopedRobots = useMemo(
    () =>
      selectedRobotId === 'ALL'
        ? robots
        : robots.filter((r) => r.robotId === selectedRobotId),
    [robots, selectedRobotId]
  );

  const openPositions = useMemo<OpenPosition[]>(
    () =>
      scopedRobots
        .map((r) => r.position)
        .filter((p): p is OpenPosition => p !== null),
    [scopedRobots]
  );

  const filteredTrades = useMemo(() => {
    const query = search.trim().toLowerCase();
    const cutoffMs =
      rangeFilter === '7d'
        ? Date.now() - 7 * 86400_000
        : rangeFilter === '30d'
          ? Date.now() - 30 * 86400_000
          : 0;

    const dedup = new Map<string, (typeof scopedRobots)[number]['trades'][number]>();
    for (const r of scopedRobots) {
      const source =
        rangeFilter === 'recent'
          ? r.trades
          : r.historyTrades && r.historyTrades.length > 0
            ? [...r.historyTrades, ...r.trades]
            : r.trades;
      for (const tr of source) {
        dedup.set(`${tr.robotId}_${tr.id}`, tr);
      }
    }

    return Array.from(dedup.values())
      .filter((t) => {
        if (cutoffMs > 0 && t.exitDate) {
          const parsed = Date.parse(`${t.exitDate}T00:00:00`);
          if (Number.isFinite(parsed) && parsed < cutoffMs - 86400_000) return false;
        }
        if (sideFilter !== 'ALL' && t.side !== sideFilter) return false;
        if (resultFilter === 'GAIN' && t.pnlBrl < 0) return false;
        if (resultFilter === 'LOSS' && t.pnlBrl >= 0) return false;
        if (!query) return true;
        return (
          t.symbol.toLowerCase().includes(query) ||
          t.robotName.toLowerCase().includes(query) ||
          String(t.id).toLowerCase().includes(query) ||
          t.reason.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const keyA = `${a.exitDate || ''} ${a.exitTime}`;
        const keyB = `${b.exitDate || ''} ${b.exitTime}`;
        return keyB.localeCompare(keyA);
      });
  }, [scopedRobots, search, rangeFilter, sideFilter, resultFilter]);

  const totalFilteredPnl = useMemo(
    () => filteredTrades.reduce((acc, t) => acc + t.pnlBrl, 0),
    [filteredTrades]
  );

  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#11161D] border border-[#222B38] p-8 text-center space-y-3">
          <h2 className="font-display text-base font-semibold text-gray-100">
            Nenhuma operação registrada
          </h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            Conecte seu MetaTrader 5 para acompanhar posições abertas e o livro completo de compras e vendas em tempo real.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Posições Abertas */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">
              Posições em Aberto ({openPositions.length})
            </h2>
            <span className="text-xs font-mono tabular-nums text-gray-400">
              Flutuante total:{' '}
              <strong
                className={
                  openPositions.reduce((a, p) => a + p.floatingPnlBrl, 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }
              >
                {formatBrl(openPositions.reduce((a, p) => a + p.floatingPnlBrl, 0))}
              </strong>
            </span>
          </div>

          {openPositions.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-400">
              Todos os robôs selecionados estão zerados (Flat) no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#0E1319] text-[11px] text-gray-400 border-b border-[#1E2633]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Robô / Magic</th>
                    <th className="px-4 py-2.5 font-medium">Ativo</th>
                    <th className="px-4 py-2.5 font-medium">Lado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Volume</th>
                    <th className="px-4 py-2.5 font-medium text-right">Entrada</th>
                    <th className="px-4 py-2.5 font-medium text-right">Atual</th>
                    <th className="px-4 py-2.5 font-medium text-right">Stop Loss</th>
                    <th className="px-4 py-2.5 font-medium text-right">Take Profit</th>
                    <th className="px-4 py-2.5 font-medium text-right">Pontos</th>
                    <th className="px-4 py-2.5 font-medium text-right">Flutuante (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1B222D] font-mono tabular-nums">
                  {openPositions.map((pos) => (
                    <tr key={pos.id} className="hover:bg-[#171E27]">
                      <td className="px-4 py-3 font-sans">
                        <div className="font-semibold text-gray-100">{pos.robotName}</div>
                        <div className="text-[11px] font-mono text-gray-500">
                          #{pos.magicNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-200 font-semibold">{pos.symbol}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 font-sans font-semibold ${
                            pos.side === 'COMPRA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {pos.side === 'COMPRA' ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5" />
                          )}
                          <span>{pos.side}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-200">{pos.volume}</td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {formatPrice(pos.entryPrice, pos.symbol)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-100">
                        {formatPrice(pos.currentPrice, pos.symbol)}
                      </td>
                      <td className="px-4 py-3 text-right text-red-300">
                        {pos.sl > 0 ? formatPrice(pos.sl, pos.symbol) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-300">
                        {pos.tp > 0 ? formatPrice(pos.tp, pos.symbol) : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right ${
                          pos.pointsOpen >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pos.pointsOpen > 0 ? `+${pos.pointsOpen}` : pos.pointsOpen}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          pos.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(pos.floatingPnlBrl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Livro Completo de Compras e Vendas */}
        <section className="rounded-xl bg-[#11161D] border border-[#222B38] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                Histórico de Execuções ({filteredTrades.length})
              </h2>
              <p className="text-xs font-mono tabular-nums text-gray-400">
                Resultado filtrado:{' '}
                <strong className={totalFilteredPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatBrl(totalFilteredPnl)}
                </strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar ativo, robô, ticket..."
                  className="bg-[#0B0E11] border border-[#222B38] focus:border-emerald-500 focus:outline-none rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 w-48"
                />
              </div>

              <div className="flex items-center bg-[#0B0E11] border border-[#222B38] rounded-lg p-0.5">
                {(
                  [
                    { id: 'recent', label: 'Recentes' },
                    { id: '7d', label: '7 dias' },
                    { id: '30d', label: '30 dias' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRangeFilter(item.id)}
                    className={`px-2.5 py-1 text-xs rounded font-medium cursor-pointer transition-colors whitespace-nowrap ${
                      rangeFilter === item.id
                        ? 'bg-[#1F2937] text-gray-100'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-[#0B0E11] border border-[#222B38] rounded-lg p-0.5">
                {(
                  [
                    { id: 'ALL', label: 'Todos' },
                    { id: 'COMPRA', label: 'Compras' },
                    { id: 'VENDA', label: 'Vendas' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSideFilter(item.id)}
                    className={`px-2.5 py-1 text-xs rounded font-medium cursor-pointer transition-colors ${
                      sideFilter === item.id
                        ? 'bg-[#1F2937] text-gray-100'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-[#0B0E11] border border-[#222B38] rounded-lg p-0.5">
                {(
                  [
                    { id: 'ALL', label: 'Tudo' },
                    { id: 'GAIN', label: 'Gains' },
                    { id: 'LOSS', label: 'Losses' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setResultFilter(item.id)}
                    className={`px-2.5 py-1 text-xs rounded font-medium cursor-pointer transition-colors ${
                      resultFilter === item.id
                        ? 'bg-[#1F2937] text-gray-100'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => exportTradesCsv(filteredTrades)}
                disabled={filteredTrades.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A222D] hover:bg-[#232D3B] border border-[#2C3747] text-xs font-medium text-gray-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              Nenhuma operação encontrada com os filtros aplicados.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#0E1319] text-[11px] text-gray-400 border-b border-[#1E2633] sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Ticket</th>
                    <th className="px-4 py-2.5 font-medium">Robô</th>
                    <th className="px-4 py-2.5 font-medium">Ativo</th>
                    <th className="px-4 py-2.5 font-medium">Lado</th>
                    <th className="px-4 py-2.5 font-medium">Entrada</th>
                    <th className="px-4 py-2.5 font-medium">Saída</th>
                    <th className="px-4 py-2.5 font-medium">Motivo</th>
                    <th className="px-4 py-2.5 font-medium text-right">Vol</th>
                    <th className="px-4 py-2.5 font-medium text-right">Pontos</th>
                    <th className="px-4 py-2.5 font-medium text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1B222D] font-mono tabular-nums">
                  {filteredTrades.map((tr) => (
                    <tr key={tr.id} className="hover:bg-[#171E27]">
                      <td className="px-4 py-2.5 text-gray-500">#{tr.id}</td>
                      <td className="px-4 py-2.5 font-sans text-gray-200">{tr.robotName}</td>
                      <td className="px-4 py-2.5 text-gray-200 font-semibold">{tr.symbol}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 font-sans font-semibold ${
                            tr.side === 'COMPRA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {tr.side === 'COMPRA' ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          <span>{tr.side}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-300">
                        {tr.entryDate ? `${tr.entryDate.slice(5)} ` : ''}
                        {tr.entryTime} · {formatPrice(tr.entryPrice, tr.symbol)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-300">
                        {tr.exitDate ? `${tr.exitDate.slice(5)} ` : ''}
                        {tr.exitTime} · {formatPrice(tr.exitPrice, tr.symbol)}
                      </td>
                      <td className="px-4 py-2.5 font-sans text-gray-400">{tr.reason}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">{tr.volume}</td>
                      <td
                        className={`px-4 py-2.5 text-right ${
                          tr.points >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {tr.points > 0 ? `+${tr.points}` : tr.points}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-bold ${
                          tr.pnlBrl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBrl(tr.pnlBrl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
