import { useEffect, useState } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';

export interface CustomThemeConfig {
  presetId: string;
  canvas: string;
  surface: string;
  surfaceElevated: string;
  surfaceSubtle: string;
  borderSubtle: string;
  textPrimary: string;
  profit: string;
  loss: string;
  fontScale: 'compact' | 'default' | 'large';
}

const STORAGE_KEY = 'painel_sync_theme_v1';

export const DEFAULT_THEME_CONFIG: CustomThemeConfig = {
  presetId: 'institutional',
  canvas: '#090D12',
  surface: '#0F141C',
  surfaceElevated: '#161E2B',
  surfaceSubtle: '#0B0F16',
  borderSubtle: '#1E2633',
  textPrimary: '#CBD5E1',
  profit: '#10B981',
  loss: '#F43F5E',
  fontScale: 'default',
};

const PRESETS = [
  { id: 'institutional', name: 'Institucional', cfg: { canvas: '#090D12', surface: '#0F141C', surfaceElevated: '#161E2B', surfaceSubtle: '#0B0F16', borderSubtle: '#1E2633', textPrimary: '#CBD5E1', profit: '#10B981', loss: '#F43F5E' } },
  { id: 'oled', name: 'Obsidiana OLED', cfg: { canvas: '#040608', surface: '#0A0D12', surfaceElevated: '#121822', surfaceSubtle: '#07090D', borderSubtle: '#18202C', textPrimary: '#CBD5E1', profit: '#10B981', loss: '#F43F5E' } },
  { id: 'navy', name: 'Azul Ardósia', cfg: { canvas: '#0A101D', surface: '#101829', surfaceElevated: '#18233A', surfaceSubtle: '#0D1423', borderSubtle: '#1E2B45', textPrimary: '#D1D9E6', profit: '#34D399', loss: '#FB7185' } },
  { id: 'graphite', name: 'Grafite Suave', cfg: { canvas: '#101216', surface: '#171A20', surfaceElevated: '#20242C', surfaceSubtle: '#13161B', borderSubtle: '#262B35', textPrimary: '#D4D4D8', profit: '#10B981', loss: '#F43F5E' } },
] as const;

const SCALES = {
  compact: { page: '1.125rem', section: '0.8125rem', kpi: '1.35rem', table: '0.6875rem', micro: '0.625rem' },
  default: { page: '1.25rem', section: '0.875rem', kpi: '1.5rem', table: '0.75rem', micro: '0.6875rem' },
  large: { page: '1.375rem', section: '0.9375rem', kpi: '1.65rem', table: '0.8125rem', micro: '0.75rem' },
} as const;

export function applyThemeToDom(cfg: CustomThemeConfig): void {
  const r = document.documentElement.style;
  r.setProperty('--color-canvas', cfg.canvas);
  r.setProperty('--color-surface', cfg.surface);
  r.setProperty('--color-surface-elevated', cfg.surfaceElevated);
  r.setProperty('--color-surface-subtle', cfg.surfaceSubtle);
  r.setProperty('--color-border-subtle', cfg.borderSubtle);
  r.setProperty('--color-text-primary', cfg.textPrimary);
  r.setProperty('--color-profit', cfg.profit);
  r.setProperty('--color-loss', cfg.loss);
  const fs = SCALES[cfg.fontScale] ?? SCALES.default;
  r.setProperty('--fs-page-title', fs.page);
  r.setProperty('--fs-section-title', fs.section);
  r.setProperty('--fs-kpi-lg', fs.kpi);
  r.setProperty('--fs-table', fs.table);
  r.setProperty('--fs-micro', fs.micro);
}

export function loadSavedTheme(): CustomThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_THEME_CONFIG, ...JSON.parse(raw) } : DEFAULT_THEME_CONFIG;
  } catch {
    return DEFAULT_THEME_CONFIG;
  }
}

export function initSavedTheme(): void {
  applyThemeToDom(loadSavedTheme());
}

export function ThemeSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<CustomThemeConfig>(() => loadSavedTheme());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const update = (next: CustomThemeConfig) => {
    setCfg(next);
    applyThemeToDom(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-[#0F141C] border border-[#1E2633] shadow-2xl overflow-hidden text-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-[#1E2633] flex items-center justify-between">
          <div className="flex items-center gap-2"><Palette className="w-4 h-4 text-emerald-400" /><h2 className="text-sm font-semibold text-slate-100">Aparência & Tema</h2></div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#1E2633] text-slate-400 hover:text-slate-200 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Temas Predefinidos</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => update({ ...cfg, ...p.cfg, presetId: p.id })} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left cursor-pointer ${cfg.presetId === p.id ? 'bg-[#161E2B] border-emerald-500/60 text-slate-100' : 'bg-[#090D12] border-[#1E2633] text-slate-300 hover:border-slate-600'}`}>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-white/15" style={{ backgroundColor: p.cfg.surface }} /><span className="font-medium">{p.name}</span></span>
                  {cfg.presetId === p.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Tamanho das Fontes</div>
            <div className="grid grid-cols-3 gap-1.5 bg-[#090D12] p-1 rounded-lg border border-[#1E2633]">
              {([{ id: 'compact', label: 'Compacta' }, { id: 'default', label: 'Padrão' }, { id: 'large', label: 'Ampliada' }] as const).map((s) => (
                <button key={s.id} type="button" onClick={() => update({ ...cfg, fontScale: s.id })} className={`py-1.5 px-2 rounded text-[11px] font-medium cursor-pointer ${cfg.fontScale === s.id ? 'bg-[#1F2937] text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Cores Personalizadas</div>
            <div className="grid grid-cols-2 gap-2">
              {([{ key: 'canvas', label: 'Fundo' }, { key: 'surface', label: 'Cards' }, { key: 'textPrimary', label: 'Texto' }, { key: 'borderSubtle', label: 'Bordas' }, { key: 'profit', label: 'Ganho' }, { key: 'loss', label: 'Perda' }] as const).map((it) => (
                <label key={it.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#090D12] border border-[#1E2633] cursor-pointer hover:border-slate-600">
                  <span className="text-slate-300">{it.label}</span>
                  <span className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-500 uppercase">{cfg[it.key]}</span><input type="color" value={cfg[it.key]} onChange={(e) => update({ ...cfg, presetId: 'custom', [it.key]: e.target.value })} className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0" /></span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 bg-[#090D12] border-t border-[#1E2633] flex items-center justify-between">
          <button type="button" onClick={() => update(DEFAULT_THEME_CONFIG)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161D27] hover:bg-[#1E2633] border border-[#1E2633] text-xs text-slate-300 cursor-pointer"><RotateCcw className="w-3.5 h-3.5" /><span>Restaurar Padrão</span></button>
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer">Concluir</button>
        </div>
      </div>
    </div>
  );
}
