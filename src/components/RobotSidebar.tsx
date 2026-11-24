import { useState } from 'react';
import { Check, Pencil, Radio, X } from 'lucide-react';
import type { AccountSnapshot, DashboardView, RobotStream } from '../types/trading';
import { formatBrl } from '../utils/tradingMath';

interface RobotSidebarProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onSelectRobot: (robotId: string | 'ALL') => void;
  onRenameMagic: (magicNumber: number, nextName: string) => void;
  account: AccountSnapshot | null;
  streamStatus: 'connecting' | 'listening' | 'error';
  lastSyncAt: string | null;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
}

const ROBOT_COLORS = [
  { dot: 'bg-sky-400', border: 'border-l-sky-400' },
  { dot: 'bg-emerald-400', border: 'border-l-emerald-400' },
  { dot: 'bg-amber-400', border: 'border-l-amber-400' },
  { dot: 'bg-purple-400', border: 'border-l-purple-400' },
  { dot: 'bg-rose-400', border: 'border-l-rose-400' },
  { dot: 'bg-cyan-400', border: 'border-l-cyan-400' },
] as const;

export function RobotSidebar({
  robots,
  selectedRobotId,
  onSelectRobot,
  onRenameMagic,
  account,
  streamStatus,
  lastSyncAt,
  activeView,
  onViewChange,
}: RobotSidebarProps) {
  const [editingMagic, setEditingMagic] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [magicColors, setMagicColors] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem('painel_sync_magic_colors_v1') || '{}'); } catch { return {}; }
  });
  const cycleMagicColor = (magic: number, fallbackIdx: number) => {
    setMagicColors((prev) => {
      const next = { ...prev, [magic]: ((prev[magic] ?? fallbackIdx) + 1) % ROBOT_COLORS.length };
      try { localStorage.setItem('painel_sync_magic_colors_v1', JSON.stringify(next)); } catch {}
      return next;
    });
  };
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
            ? `${(account.broker ? account.broker.split(' ')[0] : account.server || 'MT5')} · ${account.mode}`
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
          robots.map((bot, idx) => { const colorTheme = ROBOT_COLORS[(magicColors[bot.magicNumber] ?? idx) % ROBOT_COLORS.length];
            const selected = selectedRobotId === bot.robotId;
            const wins = bot.trades.filter((t) => t.pnlBrl >= 0).length;
            const winRate =
              bot.trades.length > 0 ? Math.round((wins / bot.trades.length) * 100) : 0;

            const isEditing = editingMagic === bot.magicNumber;

            return (
              <div
                key={bot.robotId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isEditing) onSelectRobot(bot.robotId);
                }}
                onKeyDown={(e) => {
                  if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectRobot(bot.robotId);
                  }
                }}
                className={`group w-full text-left px-3 py-2.5 rounded-lg border border-l-2 transition-colors cursor-pointer ${selected ? `bg-[#18202B] border-[#334155] ${colorTheme.border}` : `bg-[#141A23]/60 border-[#1E2633] ${colorTheme.border} hover:bg-[#171E29]`}`}
              >
                <div className="flex items-center justify-between gap-2">
                  {isEditing ? (
                    <div
                      className="flex-1 flex items-center gap-1 min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            onRenameMagic(bot.magicNumber, draftName);
                            setEditingMagic(null);
                          } else if (e.key === 'Escape') {
                            setEditingMagic(null);
                          }
                        }}
                        placeholder={`Robô #${bot.magicNumber}`}
                        autoFocus
                        className="w-full bg-[#0B0E11] border border-[#334155] rounded px-1.5 py-0.5 text-xs font-semibold text-gray-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onRenameMagic(bot.magicNumber, draftName);
                          setEditingMagic(null);
                        }}
                        title="Salvar nome"
                        className="p-1 text-emerald-400 hover:bg-[#1E2633] rounded cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMagic(null)}
                        title="Cancelar"
                        className="p-1 text-gray-400 hover:bg-[#1E2633] rounded cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); cycleMagicColor(bot.magicNumber, idx); }}
                          title="Clique para alterar a cor"
                          className={`w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer ${colorTheme.dot}`}
                        />
                        <span className="text-xs font-semibold text-gray-100 truncate">
                          {bot.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMagic(bot.magicNumber);
                            setDraftName(bot.name);
                          }}
                          title="Renomear robô"
                          className="p-0.5 text-gray-500 hover:text-gray-200 rounded transition-colors cursor-pointer shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
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
                    </>
                  )}
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
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé com Margem Disponível MT5 */}
      {account && (
        <div className="p-4 border-t border-[#222B38] bg-[#0E1319]">
          <div className="space-y-1 text-xs">
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between text-gray-400">
              <span>Margem Disponível</span>
              <span className="font-mono tabular-nums text-gray-100 font-semibold">
                {formatBrl(account.freeMargin ?? account.equity ?? account.balance, false)}
              </span>
            </div>
          </div>
                  </div>
        </div>
      )}
    </aside>
  );
}
