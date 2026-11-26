import { useState } from 'react';
import { AlertOctagon, Check, Eye, EyeOff, Loader2, Pencil, Radio, X, XCircle } from 'lucide-react';
import type { AccountSnapshot, DashboardView, RemoteCommand, RobotStream } from '../types/trading';
import { formatBrl } from '../utils/tradingMath';
import { loadOrCreateMt5SyncCredentials, sendRemoteCommand } from '../utils/mt5Bridge';
import { getRobotColorTheme } from '../utils/themeTokens';

interface RobotSidebarProps {
  robots: RobotStream[];
  selectedRobotId: string | 'ALL';
  onSelectRobot: (robotId: string | 'ALL') => void;
  onRenameMagic: (magicNumber: number, nextName: string) => void;
  onToggleHideMagic: (magicNumber: number, nextHidden: boolean) => void;
  magicColors: Record<number, number>;
  onCycleMagicColor: (magicNumber: number, fallbackIdx: number) => void;
  account: AccountSnapshot | null;
  streamStatus: 'connecting' | 'listening' | 'error';
  lastSyncAt: string | null;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  lastCommandUpdate?: RemoteCommand | null;
}

export function RobotSidebar({
  robots,
  selectedRobotId,
  onSelectRobot,
  onRenameMagic,
  onToggleHideMagic,
  magicColors,
  onCycleMagicColor,
  account,
  streamStatus,
  lastSyncAt,
  activeView,
  onViewChange,
  lastCommandUpdate,
}: RobotSidebarProps) {
  const [editingMagic, setEditingMagic] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [cmdFeedback, setCmdFeedback] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  const triggerArmConfirm = (key: string) => {
    setConfirmKey(key);
    setTimeout(() => { setConfirmKey((prev) => (prev === key ? null : prev)); }, 4000);
  };

  const executeAction = async (
    key: string,
    action: 'CLOSE_MAGIC' | 'CANCEL_ORDERS' | 'CLOSE_ALL',
    magicNumber?: number,
    symbol?: string
  ) => {
    setConfirmKey(null);
    setBusyKey(key);
    setCmdFeedback(null);
    try {
      const { channelId, token } = loadOrCreateMt5SyncCredentials();
      await sendRemoteCommand(channelId, token, { action, magicNumber, symbol, ttlSeconds: 15 });
      setCmdFeedback({ key, ok: true, text: 'Enviado ao MT5...' });
    } catch (err) {
      setCmdFeedback({ key, ok: false, text: err instanceof Error ? err.message : 'Falha ao enviar' });
    } finally {
      setBusyKey(null);
      setTimeout(() => { setCmdFeedback((prev) => (prev?.key === key ? null : prev)); }, 4500);
    }
  };
  const unhidden = robots.filter((r) => !r.hidden);
  const hiddenCount = robots.length - unhidden.length;
  const activePool = unhidden.length > 0 ? unhidden : robots;
  const visibleRobots = showHidden ? robots : unhidden;
  const totalDailyPnl = activePool.reduce((acc, r) => acc + r.dailyPnlBrl, 0);
  const totalTrades = activePool.reduce((acc, r) => acc + (r.trades?.length ?? 0), 0);
  const totalOpen = activePool.filter((r) => r.position !== null).length;
  const totalPendingOrders = activePool.reduce((acc, r) => acc + (r.pendingOrders?.length ?? 0), 0);

  return (
    <aside className="w-64 lg:w-72 shrink-0 bg-[#0F141C] border-r border-[#1E293B] flex flex-col h-full select-none">
      {/* Navegação mobile compacta */}
      <div className="md:hidden px-3 py-2 border-b border-[#1E293B] flex items-center gap-1 overflow-x-auto">
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

      {/* Resumo da Carteira / Seletor "Todos os Robôs" */}
      <div className="p-3 border-b border-[#1E293B]">
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
              Carteira Ativa ({activePool.length})
            </span>
            <span
              className={`text-xs font-mono font-semibold tabular-nums whitespace-nowrap ${
                totalDailyPnl > 0
                  ? 'text-emerald-400'
                  : totalDailyPnl < 0
                    ? 'text-rose-400'
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

        {(totalOpen > 0 || totalPendingOrders > 0) && (
          <div className="mt-2">
            {confirmKey === 'PANIC_ALL' ? (
              <button
                type="button"
                onClick={() => executeAction('PANIC_ALL', 'CLOSE_ALL')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer animate-pulse"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                Confirmar Zerar Tudo ({totalOpen} pos / {totalPendingOrders} ord)?
              </button>
            ) : (
              <button
                type="button"
                disabled={busyKey === 'PANIC_ALL'}
                onClick={() => triggerArmConfirm('PANIC_ALL')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-950/40 hover:bg-rose-950/70 border border-rose-800/60 text-rose-300 transition-colors cursor-pointer disabled:opacity-50"
              >
                {busyKey === 'PANIC_ALL' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertOctagon className="w-3.5 h-3.5" />}
                Zerar Tudo (Emergência)
              </button>
            )}
            {cmdFeedback?.key === 'PANIC_ALL' && (
              <div className={`mt-1 text-center text-[11px] font-mono ${cmdFeedback.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{cmdFeedback.text}</div>
            )}
          </div>
        )}

        {lastCommandUpdate && (lastCommandUpdate.status === 'executed' || lastCommandUpdate.status === 'failed') && (
          <div className={`mt-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono leading-snug ${lastCommandUpdate.status === 'executed' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'}`}>
            <span className="font-semibold">{lastCommandUpdate.status === 'executed' ? 'MT5 OK:' : 'MT5 Erro:'}</span> {lastCommandUpdate.ackMessage || lastCommandUpdate.action}
          </div>
        )}
      </div>

      {/* Lista de Robôs MT5 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        <div className="px-2 pb-1 flex items-center justify-between gap-2 text-xs font-medium text-gray-400">
          <span className="whitespace-nowrap truncate">Robôs ({visibleRobots.length})</span>
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-400 hover:text-gray-200 cursor-pointer whitespace-nowrap shrink-0"
              title={showHidden ? 'Esconder robôs ocultos' : 'Mostrar robôs ocultos'}
            >
              {showHidden ? <EyeOff className="w-3 h-3 shrink-0" /> : <Eye className="w-3 h-3 shrink-0" />}
              <span>{showHidden ? 'Ocultar' : `Ocultos (${hiddenCount})`}</span>
            </button>
          ) : (
            <span className="font-mono tabular-nums text-gray-500 shrink-0">{visibleRobots.length}</span>
          )}
        </div>

        {visibleRobots.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-gray-400 leading-relaxed">
              Nenhum robô enviando dados no momento.
            </p>
          </div>
        ) : (
          visibleRobots.map((bot, idx) => { const colorTheme = getRobotColorTheme(bot.magicNumber, magicColors);
            const selected = selectedRobotId === bot.robotId;
            const wins = (bot.trades ?? []).filter((t) => t.pnlBrl >= 0).length;
            const winRate =
              (bot.trades ?? []).length > 0 ? Math.round((wins / (bot.trades ?? []).length) * 100) : 0;

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
                        className="w-full bg-[#090D12] border border-[#334155] rounded px-1.5 py-0.5 text-xs font-semibold text-gray-100 focus:outline-none focus:border-emerald-500"
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
                          onClick={(e) => { e.stopPropagation(); onCycleMagicColor(bot.magicNumber, idx); }}
                          title="Clique para alterar a cor"
                          style={{ backgroundColor: colorTheme.hex }} className="w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-gray-100 truncate">
                          {bot.name.replace(new RegExp(`\\s*#${bot.magicNumber}$`), '')}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMagic(bot.magicNumber);
                            setDraftName(bot.name);
                          }}
                          title="Renomear robô" className="p-0.5 text-slate-500 hover:text-slate-200 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleHideMagic(bot.magicNumber, !bot.hidden);
                          }}
                          title={bot.hidden ? 'Mostrar robô na lista' : 'Ocultar robô da lista'}
                          className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                            bot.hidden
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-gray-500 hover:text-gray-200 opacity-0 group-hover:opacity-100 focus:opacity-100'
                          }`}
                        >
                          {bot.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        </button>
                      </div>
                      <span
                        className={`text-xs font-mono font-semibold tabular-nums shrink-0 ${
                          bot.dailyPnlBrl > 0
                            ? 'text-emerald-400'
                            : bot.dailyPnlBrl < 0
                              ? 'text-rose-400'
                              : 'text-gray-300'
                        }`}
                      >
                        {formatBrl(bot.dailyPnlBrl)}
                      </span>
                    </>
                  )}
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-slate-400 truncate">#{bot.magicNumber} • {bot.symbol} • {bot.timeframe || 'M5'}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {bot.position ? (
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${bot.position.side === 'COMPRA' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}`}>
                        {bot.position.side === 'COMPRA' ? 'BUY' : 'SELL'} {bot.position.volume}x
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#161D27] text-slate-400 border border-[#1E293B]">FLAT</span>
                    )}
                    <span className="text-slate-500">{(bot.trades ?? []).length}op</span>
                  </div>
                </div>

                {(bot.position !== null || (bot.pendingOrders?.length ?? 0) > 0) && (
                  <div className="mt-2 pt-2 border-t border-[#1E2633]/80 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {bot.position !== null && (() => {
                      const k = `CLOSE_${bot.magicNumber}`;
                      const armed = confirmKey === k;
                      const busy = busyKey === k;
                      return (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => armed ? executeAction(k, 'CLOSE_MAGIC', bot.magicNumber, bot.symbol) : triggerArmConfirm(k)}
                          className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${armed ? 'bg-rose-600 text-white animate-pulse' : 'bg-rose-950/45 hover:bg-rose-950/75 border border-rose-800/50 text-rose-300'}`}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                          <span>{armed ? 'Confirmar Zerar?' : 'Zerar'}</span>
                        </button>
                      );
                    })()}
                    {(bot.pendingOrders?.length ?? 0) > 0 && (() => {
                      const k = `CANCEL_${bot.magicNumber}`;
                      const armed = confirmKey === k;
                      const busy = busyKey === k;
                      const count = bot.pendingOrders?.length ?? 0;
                      return (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => armed ? executeAction(k, 'CANCEL_ORDERS', bot.magicNumber, bot.symbol) : triggerArmConfirm(k)}
                          className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${armed ? 'bg-amber-600 text-white animate-pulse' : 'bg-amber-950/45 hover:bg-amber-950/75 border border-amber-800/50 text-amber-300'}`}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                          <span>{armed ? 'Confirmar?' : `Cancelar (${count})`}</span>
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé com Margem Disponível MT5 */}
      {account && (
        <div className="p-4 border-t border-[#1E2633] bg-[#090D12]/60">
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
