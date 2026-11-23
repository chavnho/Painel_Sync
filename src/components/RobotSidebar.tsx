import { Radio, Trash2 } from 'lucide-react';
import type { AccountSnapshot, DashboardView, RobotStream } from '../types/trading';
import { formatBrl } from '../utils/tradingMath';

interface RobotSidebarProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onSelectRobot: (robotId: string | 'ALL') => void;
  account: AccountSnapshot | null;
  streamStatus: 'connecting' | 'listening' | 'error';
  lastSyncAt: string | null;
  onClearSession: () => void;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
}

export function RobotSidebar({
  robots,
  selectedRobotId,
  onSelectRobot,
  account,
  streamStatus,
  lastSyncAt,
  onClearSession,
  activeView,
  onViewChange,
}: RobotSidebarProps) {
  const totalDailyPnl = robots.reduce((acc, r) => acc + r.dailyPnlBrl, 0);
  const totalTrades = robots.reduce((acc, r) => acc + r.trades.length, 0);
  const totalOpen = robots.filter((r) => r.position !== null).length;

  return (
    <aside className="w-64 lg:w-72 shrink-0 bg-[#11161D] border-r border-[#222B38] flex flex-col h-full select-none">
      {/* Navegação mobile compacta */}
      <div className="md:hidden px-3 py-2 border-b border-[#222B38] flex items-center gap-1 overflow-x-auto">
        {(
          [
            { id: 'overview', label: 'Geral' },
            { id: 'charts', label: 'Gráficos' },
            { id: 'buy-sell', label: 'C & V' },
            { id: 'operations', label: 'Ordens' },
            { id: 'reports', label: 'Relatórios' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onViewChange(tab.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === tab.id
                ? 'bg-[#1D2531] text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Estado da Conexão MT5 */}
      <div className="px-4 py-3.5 border-b border-[#222B38] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-gray-400">Conexão Terminal</span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              robots.length > 0
                ? 'text-emerald-400'
                : streamStatus === 'error'
                  ? 'text-red-400'
                  : 'text-gray-300'
            }`}
          >
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>
              {robots.length > 0
                ? 'MT5 Conectado'
                : streamStatus === 'listening'
                  ? 'Aguardando MT5'
                  : streamStatus === 'error'
                    ? 'Reconectando'
                    : 'Conectando'}
            </span>
          </span>
        </div>

        <div className="text-[11px] font-mono text-gray-500 tabular-nums truncate">
          {account
            ? `${account.broker || account.server || 'MetaTrader 5'} · ${account.mode}`
            : 'Canal pronto para WebRequest (MT5)'}
          {lastSyncAt
            ? ` · ${new Date(lastSyncAt).toLocaleTimeString('pt-BR')}`
            : ''}
        </div>
      </div>

      {/* Resumo da Carteira / Seletor "Todos os Robôs" */}
      <div className="p-3 border-b border-[#222B38]">
        <button
          type="button"
          onClick={() => onSelectRobot('ALL')}
          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
            selectedRobotId === 'ALL'
              ? 'bg-[#18202B] border-[#334155]'
              : 'bg-transparent border-transparent hover:bg-[#161C25]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-100 truncate">
              Todos os Robôs ({robots.length})
            </span>
            <span
              className={`text-xs font-mono font-semibold tabular-nums whitespace-nowrap ${
                totalDailyPnl > 0
                  ? 'text-emerald-400'
                  : totalDailyPnl < 0
                    ? 'text-red-400'
                    : 'text-gray-300'
              }`}
            >
              {formatBrl(totalDailyPnl)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-gray-400 font-mono tabular-nums">
            {totalOpen} posicionados · {totalTrades} negócios hoje
          </div>
        </button>
      </div>

      {/* Lista de Robôs MT5 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        <div className="px-2 pb-1 flex items-center justify-between text-xs font-medium text-gray-400">
          <span>Robôs Monitorados</span>
          <span className="font-mono tabular-nums text-gray-500">{robots.length}</span>
        </div>

        {robots.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-gray-400 leading-relaxed">
              Nenhum robô enviando dados no momento.
            </p>
          </div>
        ) : (
          robots.map((bot) => {
            const selected = selectedRobotId === bot.robotId;
            const wins = bot.trades.filter((t) => t.pnlBrl >= 0).length;
            const winRate =
              bot.trades.length > 0 ? Math.round((wins / bot.trades.length) * 100) : 0;

            return (
              <button
                key={bot.robotId}
                type="button"
                onClick={() => onSelectRobot(bot.robotId)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[#18202B] border-[#334155]'
                    : 'bg-transparent border-transparent hover:bg-[#161C25]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-100 truncate">
                    {bot.name}
                  </span>
                  <span
                    className={`text-xs font-mono font-semibold tabular-nums shrink-0 ${
                      bot.dailyPnlBrl > 0
                        ? 'text-emerald-400'
                        : bot.dailyPnlBrl < 0
                          ? 'text-red-400'
                          : 'text-gray-300'
                    }`}
                  >
                    {formatBrl(bot.dailyPnlBrl)}
                  </span>
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400 font-mono tabular-nums">
                  <span>
                    {bot.symbol} · {bot.timeframe} · #{bot.magicNumber}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span
                    className={
                      bot.position?.side === 'COMPRA'
                        ? 'text-emerald-400 font-medium'
                        : bot.position?.side === 'VENDA'
                          ? 'text-red-400 font-medium'
                          : 'text-gray-500'
                    }
                  >
                    {bot.position
                      ? `${bot.position.side} ${bot.position.volume}x`
                      : 'Zerado (Flat)'}
                  </span>
                  <span className="font-mono tabular-nums text-gray-400">
                    {bot.trades.length} ops · {winRate}%
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Rodapé com Saldo da Conta e Ações MT5 */}
      <div className="p-4 border-t border-[#222B38] bg-[#0E1319] space-y-3">
        {account && (
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between text-gray-400">
              <span>Saldo da Conta</span>
              <span className="font-mono tabular-nums text-gray-200 font-medium">
                {formatBrl(account.balance, false)}
              </span>
            </div>
            <div className="flex items-center justify-between text-gray-400">
              <span>Patrimônio Líq.</span>
              <span className="font-mono tabular-nums text-gray-100 font-semibold">
                {formatBrl(account.equity, false)}
              </span>
            </div>
          </div>
        )}

        {robots.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClearSession}
              title="Limpar dados recebidos no painel"
              aria-label="Limpar sessão atual"
              className="p-2 rounded-lg bg-[#1A222D] hover:bg-[#2A191E] border border-[#2C3747] hover:border-red-500/40 text-gray-400 hover:text-red-300 transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
