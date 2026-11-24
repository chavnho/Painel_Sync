export interface RobotColorTheme {
  id: string;
  hex: string;
  dot: string;
  border: string;
  badge: string;
}

export const ROBOT_COLORS: readonly RobotColorTheme[] = [
  {
    id: 'sky',
    hex: '#38BDF8',
    dot: 'bg-sky-400',
    border: 'border-l-sky-400',
    badge: 'bg-sky-950/60 text-sky-300 border-sky-800/50',
  },
  {
    id: 'emerald',
    hex: '#34D399',
    dot: 'bg-emerald-400',
    border: 'border-l-emerald-400',
    badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50',
  },
  {
    id: 'amber',
    hex: '#FBBF24',
    dot: 'bg-amber-400',
    border: 'border-l-amber-400',
    badge: 'bg-amber-950/60 text-amber-300 border-amber-800/50',
  },
  {
    id: 'purple',
    hex: '#C084FC',
    dot: 'bg-purple-400',
    border: 'border-l-purple-400',
    badge: 'bg-purple-950/60 text-purple-300 border-purple-800/50',
  },
  {
    id: 'rose',
    hex: '#FB7185',
    dot: 'bg-rose-400',
    border: 'border-l-rose-400',
    badge: 'bg-rose-950/60 text-rose-300 border-rose-800/50',
  },
  {
    id: 'cyan',
    hex: '#22D3EE',
    dot: 'bg-cyan-400',
    border: 'border-l-cyan-400',
    badge: 'bg-cyan-950/60 text-cyan-300 border-cyan-800/50',
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
  if (value < 0) return 'text-red-400';
  return 'text-gray-400';
}

export function getSideTextClass(side: 'COMPRA' | 'VENDA'): string {
  return side === 'COMPRA' ? 'text-emerald-400' : 'text-red-400';
}