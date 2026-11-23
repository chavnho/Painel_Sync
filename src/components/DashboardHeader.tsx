import { useState, useRef, useEffect } from 'react';
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

const CONN_ITEMS: Array<{ id: DashboardView; label: string }> = [
  { id: 'connect', label: 'Conectar Agora' },
  { id: 'overview', label: 'Voltar ao Painel' },
];

export function DashboardHeader({ activeView, onViewChange }: DashboardHeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-14 shrink-0 bg-[#11161D] border-b border-[#222B38] px-6 flex items-center justify-between gap-8">
      <button
        type="button"
        onClick={() => onViewChange('overview')}
        className="font-display text-lg font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors flex items-center gap-2"
      >
        Painel Sync
        <span className="text-[10px] font-normal text-gray-500">v0.3.0</span>
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

      <div className="shrink-0 relative">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropdownOpen(!isDropdownOpen);
          }}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
            isDropdownOpen 
              ? 'bg-[#1F2733] text-gray-100 border border-[#364152]' 
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {activeView === 'connect' ? 'Conexão Ativa' : 'Conectar MT5'}
          <span className="ml-1">▾</span>
        </button>
        
        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-[#11161D] border border-[#222B38] rounded-lg shadow-xl z-50 py-1">
            {CONN_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onViewChange(item.id);
                  setIsDropdownOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-[#1F2733] hover:text-white"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
