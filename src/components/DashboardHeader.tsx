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
  { id: 'reports', label: 'Relatórios' },
];

export function DashboardHeader({ activeView, onViewChange }: DashboardHeaderProps) {
  return (
    <header className="h-14 shrink-0 bg-[#11161D] border-b border-[#222B38] px-6 flex items-center justify-between gap-8">
      {/* Zona 1: Wordmark em linha única */}
      <button
        type="button"
        onClick={() => onViewChange('overview')}
        className="font-display text-lg font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors"
      >
        Painel Sync
      </button>

      {/* Zona 2: Links de navegação limpos */}
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

      {/* Zona 3: Ação principal única */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => onViewChange('connect')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
            activeView === 'connect'
              ? 'bg-[#1F2733] text-gray-100 border border-[#364152]'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          Conectar MT5
        </button>
      </div>
    </header>
  );
}
