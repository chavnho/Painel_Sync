import { useEffect, useState } from 'react';
import { AlertTriangle, Palette, Radio, Settings2 } from 'lucide-react';
import { ThemeSettingsModal } from './ThemeSettingsModal';
import type { AccountSnapshot, DashboardView } from '../types/trading';

interface DashboardHeaderProps {
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  robotsCount: number;
  account: AccountSnapshot | null;
  streamStatus: 'connecting' | 'listening' | 'error';
  lastSyncAt: string | null;
}

const NAV_ITEMS: Array<{ id: DashboardView; label: string }> = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'charts', label: 'Gráficos' },
  { id: 'buy-sell', label: 'Compras & Vendas' },
  { id: 'operations', label: 'Operações' },
  { id: 'reports', label: 'Relatórios' },
];

export function DashboardHeader({
  activeView,
  onViewChange,
  robotsCount,
  account,
  streamStatus,
  lastSyncAt,
}: DashboardHeaderProps) {
  const isConnectActive = activeView === 'connect';
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [themeModalOpen, setThemeModalOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lastSyncMs = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  const delaySec = Number.isFinite(lastSyncMs) ? Math.max(0, Math.floor((nowMs - lastSyncMs) / 1000)) : null;
  const isStale = robotsCount > 0 && delaySec !== null && delaySec > 10;

  const statusText =
    robotsCount > 0
      ? isStale
        ? `Atraso MT5 (${delaySec}s)`
        : 'MT5 Conectado'
      : streamStatus === 'listening'
        ? 'Aguardando MT5'
        : streamStatus === 'error'
          ? 'Reconectando'
          : 'Conectando';

  const statusColorClass =
    robotsCount > 0
      ? isStale
        ? 'text-amber-400'
        : 'text-emerald-400'
      : streamStatus === 'error'
        ? 'text-rose-400'
        : 'text-gray-300';

  return (
    <header className="h-14 shrink-0 bg-[#0F141C] border-b border-[#1E2633] px-6 flex items-center justify-between gap-6">
      <button
        type="button"
        onClick={() => onViewChange('overview')}
        className="font-display text-lg font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors flex items-center gap-2"
      >
        Painel Sync
        <span className="text-[10px] font-normal text-gray-500">v0.7.2</span>
      </button>

      <nav aria-label="Navegação principal" className="hidden md:flex items-center gap-7">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'text-gray-100 border-emerald-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-[#334155]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 flex items-center gap-3">
        <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#090D12] border text-xs transition-colors ${isStale ? 'border-amber-500/60 bg-amber-950/20' : 'border-[#1E2633]'}`}>
          <span className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${statusColorClass}`}>
            {isStale ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-pulse" /> : <Radio className="w-3.5 h-3.5 shrink-0" />}
            <span>{statusText}</span>
          </span>
          <span className="text-gray-600">•</span>
          <span className="text-[11px] font-mono text-gray-400 tabular-nums whitespace-nowrap">
            {account
              ? `${account.broker ? account.broker.split(' ')[0] : account.server || 'MT5'} · ${account.mode}`
              : 'Canal pronto'}
            {lastSyncAt ? ` • ${new Date(lastSyncAt).toLocaleTimeString('pt-BR')}` : ''}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setThemeModalOpen(true)}
          title="Personalizar tema e fontes"
          className="inline-flex items-center justify-center p-2 rounded-lg bg-[#18202B] hover:bg-[#1E2836] text-slate-300 hover:text-white border border-[#2E3A4B] hover:border-slate-500 transition-colors cursor-pointer"
        >
          <Palette className="w-3.5 h-3.5 text-slate-300" />
        </button>

        <button
          type="button"
          onClick={() => onViewChange('connect')}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isConnectActive
              ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50'
              : 'bg-[#18202B] hover:bg-[#1E2836] text-gray-200 hover:text-white border-[#2E3A4B] hover:border-emerald-500/40'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isConnectActive ? 'Configuração EA' : 'Conectar MT5'}</span>
        </button>
      </div>
      <ThemeSettingsModal open={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
    </header>
  );
}