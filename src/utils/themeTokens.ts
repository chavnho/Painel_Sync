export interface RobotColorTheme {
  id: string;
  hex: string;
  dot: string;
  border: string;
  badge: string;
}

export const ROBOT_COLORS: readonly RobotColorTheme[] = [
  {
    id: 'blue',
    hex: '#3B82F6',
    dot: 'bg-blue-500',
    border: 'border-l-blue-500',
    badge: 'bg-blue-950/60 text-blue-300 border-blue-800/50',
  },
  {
    id: 'emerald',
    hex: '#10B981',
    dot: 'bg-emerald-500',
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50',
  },
  {
    id: 'yellow',
    hex: '#FACC15',
    dot: 'bg-yellow-400',
    border: 'border-l-yellow-400',
    badge: 'bg-yellow-950/60 text-yellow-300 border-yellow-800/50',
  },
  {
    id: 'purple',
    hex: '#A855F7',
    dot: 'bg-purple-500',
    border: 'border-l-purple-500',
    badge: 'bg-purple-950/60 text-purple-300 border-purple-800/50',
  },
  {
    id: 'red',
    hex: '#EF4444',
    dot: 'bg-red-500',
    border: 'border-l-red-500',
    badge: 'bg-red-950/60 text-red-300 border-red-800/50',
  },
  {
    id: 'orange',
    hex: '#F97316',
    dot: 'bg-orange-500',
    border: 'border-l-orange-500',
    badge: 'bg-orange-950/60 text-orange-300 border-orange-800/50',
  },
  {
    id: 'cyan',
    hex: '#06B6D4',
    dot: 'bg-cyan-500',
    border: 'border-l-cyan-500',
    badge: 'bg-cyan-950/60 text-cyan-300 border-cyan-800/50',
  },
  {
    id: 'pink',
    hex: '#EC4899',
    dot: 'bg-pink-500',
    border: 'border-l-pink-500',
    badge: 'bg-pink-950/60 text-pink-300 border-pink-800/50',
  },
] as const;

export const MAGIC_COLORS_STORAGE_KEY = 'painel_sync_magic_colors_v1';

export function loadMagicColorMap(): Record<number, number> {
  try {
    const raw = localStorage.getItem(MAGIC_COLORS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMagicColorMap(map: Record<number, number>): void {
  try {
    localStorage.setItem(MAGIC_COLORS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignora erro de armazenamento
  }
}

export function getDefaultMagicColorIndex(magicNumber: number): number {
  const n = Math.abs(Math.trunc(Number(magicNumber) || 0));
  return n % ROBOT_COLORS.length;
}

export function getRobotColorTheme(
  magicNumber: number,
  colorMap: Record<number, number>,
  fallbackIndex?: number
): RobotColorTheme {
  const baseIdx = fallbackIndex ?? getDefaultMagicColorIndex(magicNumber);
  const idx = (colorMap[magicNumber] ?? baseIdx) % ROBOT_COLORS.length;
  return ROBOT_COLORS[Math.abs(idx)];
}

export function getPnlTextClass(value: number): string {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-rose-400';
  return 'text-gray-400';
}

export function getSideTextClass(side: 'COMPRA' | 'VENDA'): string {
  return side === 'COMPRA' ? 'text-emerald-400' : 'text-rose-400';
}

export const MAX_CHART_CANDLES = 1000;
export const INITIAL_CHART_VIEW_BARS = 300;

export const UI_THEME = {
  surfaces: {
    canvas: 'bg-[var(--color-canvas)]',
    card: 'bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl',
    zebraRow: 'odd:bg-transparent even:bg-[var(--color-surface-subtle)]/70 hover:bg-[var(--color-surface-elevated)] transition-colors',
  },
  typography: {
    pageTitle: 'font-display text-[length:var(--fs-page-title)] font-bold text-slate-200',
    sectionTitle: 'text-[length:var(--fs-section-title)] font-semibold text-slate-200',
    kpiValue: 'text-[length:var(--fs-kpi-lg)] font-mono font-bold tabular-nums',
    tableHeader: 'bg-[var(--color-canvas)] text-[10px] uppercase tracking-wider text-slate-400 border-b border-[var(--color-border-subtle)] sticky top-0 z-10',
    tableBody: 'divide-y divide-[var(--color-border-subtle)]/80 font-mono tabular-nums text-[length:var(--fs-table)] text-slate-300',
    microMuted: 'text-[length:var(--fs-micro)] text-slate-400',
  },
  semantic: {
    profitText: 'text-emerald-400',
    lossText: 'text-rose-400',
    profitBadge: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
    lossBadge: 'bg-rose-500/10 text-rose-400 border border-rose-500/25',
  },
} as const;
