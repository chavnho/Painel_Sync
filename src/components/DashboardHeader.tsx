import { Settings2 } from 'lucide-react';
import type { DashboardView } from '../types/trading';

interface DashboardHeaderProps {
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
}

const NAV_ITEMS: Array<{ id: DashboardView; label: string }> = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'charts', label: 'Gráficos' },
  { id: 'buy-sell', label: 'Compras & Vendas' },
  { id: 'operations', label: 'Operações' },
  { id: 'market-chart', label: 'Mercado' },
  { id: 'reports', label: 'Relatórios' },
];

export function DashboardHeader({ activeView, onViewChange }: DashboardHeaderProps) {
  const isConnectActive = activeView === 'connect';

  return (
    <header className="h-14 shrink-0 bg-[#11161D] border-b border-[#222B38] px-6 flex items-center justify-between gap-8">
      <button
        type="button"
        onClick={() => onViewChange('overview')}
        className="font-display text-lg font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors flex items-center gap-2"
      >
        Painel Sync
        <span className="text-[10px] font-normal text-gray-500">v0.3.5</span>
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

      <div className="shrink-0">
        <button
          type="button"
          onClick={() => onViewChange('connect')}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isConnectActive
              ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50'
              : 'bg-[#18202B] hover:bg-[#1E2836] text-gray-200 hover:text-white border-[#2E3A4B] hover:border-emerald-500/40'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isConnectActive ? 'Configuração EA' : 'Conectar MT5'}</span>
        </button>
      </div>
    </header>
  );
}