import { getRobotColorTheme, UI_THEME } from '../utils/themeTokens';
import { useMemo, useState } from 'react';
import { Download, Search, TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardView, OpenPosition, RobotStream } from '../types/trading';
import { exportTradesCsv, formatBrl, formatPrice } from '../utils/tradingMath';

interface TradesLedgerViewProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  magicColors?: Record<number, number>;
  onNavigate: (view: DashboardView) => void;
}

export function TradesLedgerView({
  robots,
  selectedRobotId,
  magicColors = {},
  onNavigate,
}: TradesLedgerViewProps) {
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
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

  const availableYears = useMemo(() => {
    const years = new Set<string>([String(new Date().getFullYear())]);
    for (const r of scopedRobots) {
      for (const tr of [...(r.historyTrades ?? new Array()), ...r.trades]) {
        const y = (tr.exitDate || '').slice(0, 4);
        if (/^\d{4}$/.test(y)) years.add(y);
      }
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [scopedRobots]);

  const handleSelectMonthPreset = (yearStr: string, monthStr: string) => {
    setSelectedYear(yearStr);
    setSelectedMonth(monthStr);
    if (monthStr === 'ALL') {
      setStartDate('');
      setEndDate('');
      return;
    }
    const y = Number(yearStr);
    const m = Number(monthStr);
    const lastDay = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    const dd = String(lastDay).padStart(2, '0');
    setStartDate(`${y}-${mm}-01`);
    setEndDate(`${y}-${mm}-${dd}`);
  };

  const filteredTrades = useMemo(() => {
    const query = search.trim().toLowerCase();
    const dedup = new Map<string, (typeof scopedRobots)[number]['trades'][number]>();
    for (const r of scopedRobots) {
      const source =
        r.historyTrades && r.historyTrades.length > 0
          ? [...r.historyTrades, ...r.trades]
          : r.trades;
      for (const tr of source) {
        dedup.set(`${tr.robotId}_${tr.id}`, tr);
      }
    }

    return Array.from(dedup.values())
      .filter((t) => {
        const normDate = (t.exitDate || '').replace(/\./g, '-').slice(0, 10);
        if (startDate && normDate && normDate < startDate) return false;
        if (endDate && normDate && normDate > endDate) return false;
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
  }, [scopedRobots, search, startDate, endDate, sideFilter, resultFilter]);

  const totalFilteredPnl = useMemo(
    () => filteredTrades.reduce((acc, t) => acc + t.pnlBrl, 0),
    [filteredTrades]
  );

  if (robots.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto rounded-xl bg-[#0F141C] border border-[#1E2633] p-8 text-center space-y-3">
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-6 py-5">
      <div className="max-w-[1320px] w-full mx-auto flex-1 flex flex-col min-h-0 gap-5">
        {/* Posições Abertas */}
        <section className="shrink-0 rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
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
                    : 'text-rose-400'
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
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#090D12] text-[11px] text-gray-400 border-b border-[#1E2633]">
                  <tr>
                    <th className="px-3.5 py-2 font-medium">Robô / Magic</th>
                    <th className="px-3.5 py-2 font-medium">Ativo</th>
                    <th className="px-3.5 py-2 font-medium">Lado</th>
                    <th className="px-3.5 py-2 font-medium text-right">Volume</th>
                    <th className="px-3.5 py-2 font-medium text-right">Entrada</th>
                    <th className="px-3.5 py-2 font-medium text-right">Atual</th>
                    <th className="px-3.5 py-2 font-medium text-right">Stop Loss</th>
                    <th className="px-3.5 py-2 font-medium text-right">Take Profit</th>
                    <th className="px-3.5 py-2 font-medium text-right">Pontos</th>
                    <th className="px-3.5 py-2 font-medium text-right">Flutuante (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1B222D] font-mono tabular-nums">
                  {openPositions.map((pos) => (
                    <tr key={pos.id} className="hover:bg-[#131922]">
                      <td className="px-4 py-3 font-sans">
                        <div className="flex items-center gap-1.5 font-semibold text-gray-100"><span className={`w-2 h-2 rounded-full shrink-0 ${getRobotColorTheme(pos.magicNumber, magicColors).dot}`} /><span>{pos.robotName}</span></div>
                        <div className="text-[11px] font-mono text-gray-500">
                          #{pos.magicNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-200 font-semibold">{pos.symbol}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 font-sans font-semibold ${
                            pos.side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400'
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
                      <td className="px-4 py-3 text-right text-rose-300">
                        {pos.sl > 0 ? formatPrice(pos.sl, pos.symbol) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-300">
                        {pos.tp > 0 ? formatPrice(pos.tp, pos.symbol) : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right ${
                          pos.pointsOpen >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.pointsOpen > 0 ? `+${pos.pointsOpen}` : pos.pointsOpen}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          pos.floatingPnlBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'
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
        <section className="flex-1 flex flex-col min-h-0 rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold text-gray-100">
                  Histórico de Execuções ({filteredTrades.length})
                </h2>
                <p className="text-xs font-mono tabular-nums text-gray-400">
                  Resultado filtrado:{' '}
                  <strong className={totalFilteredPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {formatBrl(totalFilteredPnl)}
                  </strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar ativo, robô, ticket..."
                    className="bg-[#090D12] border border-[#1E2633] focus:border-emerald-500 focus:outline-none rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 w-52"
                  />
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

            <div className="flex flex-wrap lg:flex-nowrap items-center justify-center gap-2">

              <div className="flex flex-wrap items-center gap-1.5 bg-[#090D12] border border-[#1E2633] rounded-lg px-2 py-1">
                <select
                  aria-label="Ano"
                  value={selectedYear}
                  onChange={(e) => handleSelectMonthPreset(e.target.value, selectedMonth)}
                  className="bg-transparent text-xs text-gray-200 font-medium focus:outline-none cursor-pointer pr-1"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr} className="bg-[#0F141C] text-gray-100">
                      {yr}
                    </option>
                  ))}
                </select>

                <span className="text-gray-700">|</span>

                <select
                  aria-label="Mês"
                  value={selectedMonth}
                  onChange={(e) => handleSelectMonthPreset(selectedYear, e.target.value)}
                  className="bg-transparent text-xs text-gray-200 font-medium focus:outline-none cursor-pointer pr-1"
                >
                  <option value="ALL" className="bg-[#0F141C]">Todos os meses</option>
                  <option value="1" className="bg-[#0F141C]">Janeiro</option>
                  <option value="2" className="bg-[#0F141C]">Fevereiro</option>
                  <option value="3" className="bg-[#0F141C]">Março</option>
                  <option value="4" className="bg-[#0F141C]">Abril</option>
                  <option value="5" className="bg-[#0F141C]">Maio</option>
                  <option value="6" className="bg-[#0F141C]">Junho</option>
                  <option value="7" className="bg-[#0F141C]">Julho</option>
                  <option value="8" className="bg-[#0F141C]">Agosto</option>
                  <option value="9" className="bg-[#0F141C]">Setembro</option>
                  <option value="10" className="bg-[#0F141C]">Outubro</option>
                  <option value="11" className="bg-[#0F141C]">Novembro</option>
                  <option value="12" className="bg-[#0F141C]">Dezembro</option>
                </select>

                <span className="text-gray-700">|</span>

                <label className="flex items-center gap-1 text-[11px] text-gray-400">
                  <span>De</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setSelectedMonth('ALL');
                    }}
                    className="bg-[#0F141C] border border-[#1E2633] rounded px-1.5 py-0.5 text-xs text-gray-200 focus:border-emerald-500 focus:outline-none [color-scheme:dark]"
                  />
                </label>

                <label className="flex items-center gap-1 text-[11px] text-gray-400">
                  <span>Até</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setSelectedMonth('ALL');
                    }}
                    className="bg-[#0F141C] border border-[#1E2633] rounded px-1.5 py-0.5 text-xs text-gray-200 focus:border-emerald-500 focus:outline-none [color-scheme:dark]"
                  />
                </label>

                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => handleSelectMonthPreset(selectedYear, 'ALL')}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
              </div>

              <div className="flex items-center bg-[#090D12] border border-[#1E2633] rounded-lg p-0.5">
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

              <div className="flex items-center bg-[#090D12] border border-[#1E2633] rounded-lg p-0.5">
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
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              Nenhuma operação encontrada com os filtros aplicados.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className={UI_THEME.typography.tableHeader}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Ticket</th>
                    <th className="px-4 py-3 font-semibold">Robô</th>
                    <th className="px-4 py-3 font-semibold">Ativo</th>
                    <th className="px-4 py-3 font-semibold">Lado</th>
                    <th className="px-4 py-3 font-semibold">Entrada</th>
                    <th className="px-4 py-3 font-semibold">Saída</th>
                    <th className="px-4 py-3 font-semibold">Motivo</th>
                    <th className="px-4 py-3 font-semibold text-right">Vol</th>
                    <th className="px-4 py-3 font-semibold text-right">Pontos</th>
                    <th className="px-4 py-3 font-semibold text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody className={UI_THEME.typography.tableBody}>
                  {filteredTrades.map((tr, idx) => (
                    <tr key={`${tr.robotId}_${tr.id}`} className={`${UI_THEME.surfaces.zebraRow} whitespace-nowrap`}>
                      <td className="px-3.5 py-2 text-slate-400">#{tr.id}</td>
                      <td className="px-3.5 py-2 font-sans text-slate-300"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full shrink-0 ${getRobotColorTheme(tr.magicNumber, magicColors).dot}`} /><span>{tr.robotName}</span></div></td>
                      <td className="px-3.5 py-2 text-slate-300">{tr.symbol}</td>
                      <td className="px-3.5 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-semibold border ${
                            tr.side === 'COMPRA'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
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
                      <td className="px-3.5 py-2">
                        <span className="text-slate-500">{tr.entryDate ? `${tr.entryDate.slice(5)} ` : ''}{tr.entryTime}</span>
                        <span className="text-slate-600 mx-1.5">•</span>
                        <span className="text-slate-300">{formatPrice(tr.entryPrice, tr.symbol)}</span>
                      </td>
                      <td className="px-3.5 py-2">
                        <span className="text-slate-500">{tr.exitDate ? `${tr.exitDate.slice(5)} ` : ''}{tr.exitTime}</span>
                        <span className="text-slate-600 mx-1.5">•</span>
                        <span className="text-slate-300">{formatPrice(tr.exitPrice, tr.symbol)}</span>
                      </td>
                      <td className="px-3.5 py-2 font-sans">
                        <span className="inline-block px-2 py-0.5 rounded bg-[#141B25] border border-[#1E2633] text-[11px] text-slate-300">
                          {tr.reason}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 text-right text-slate-300">{tr.volume}</td>
                      <td
                        className={`px-3.5 py-2 text-right font-medium ${
                          tr.points >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {tr.points > 0 ? `+${tr.points}` : tr.points}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-bold ${
                            tr.pnlBrl >= 0
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {formatBrl(tr.pnlBrl)}
                        </span>
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
