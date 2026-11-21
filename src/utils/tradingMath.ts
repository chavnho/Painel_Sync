import type {
  ExecutedTrade,
  LiveCandle,
  PortfolioMetrics,
  RobotStream,
  SideStats,
} from '../types/trading';

export function formatBrl(val: number, showPlus = true): string {
  const rounded = Math.abs(val) < 0.005 ? 0 : val;
  const sign = rounded > 0 ? (showPlus ? '+' : '') : rounded < 0 ? '-' : '';
  return `${sign}R$ ${Math.abs(rounded).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getPriceDigits(symbol?: string): number {
  const upper = (symbol || '').toUpperCase();
  if (
    upper.startsWith('WIN') ||
    upper.startsWith('IND') ||
    upper.startsWith('BIT') ||
    upper.startsWith('IBOV')
  ) {
    return 0;
  }
  if (upper.startsWith('WDO') || upper.startsWith('DOL')) {
    return 2;
  }
  if (/^[A-Z]{6}$/.test(upper)) {
    return upper.includes('JPY') ? 3 : 5;
  }
  return 2;
}

export function formatPrice(val: number, symbol?: string): string {
  const digits = getPriceDigits(symbol);
  return val.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function computeSideStats(trades: ExecutedTrade[]): SideStats {
  if (trades.length === 0) {
    return {
      count: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      netPnlBrl: 0,
      grossProfitBrl: 0,
      grossLossBrl: 0,
      profitFactor: 0,
      avgWinBrl: 0,
      avgLossBrl: 0,
      payoffRatio: 0,
      totalVolume: 0,
      avgPoints: 0,
      bestTradeBrl: 0,
      worstTradeBrl: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let grossProfitBrl = 0;
  let grossLossBrl = 0;
  let netPnlBrl = 0;
  let totalVolume = 0;
  let totalPoints = 0;
  let bestTradeBrl = -Infinity;
  let worstTradeBrl = Infinity;

  for (const t of trades) {
    netPnlBrl += t.pnlBrl;
    totalVolume += t.volume;
    totalPoints += t.points;
    if (t.pnlBrl > bestTradeBrl) bestTradeBrl = t.pnlBrl;
    if (t.pnlBrl < worstTradeBrl) worstTradeBrl = t.pnlBrl;
    if (t.pnlBrl >= 0) {
      wins++;
      grossProfitBrl += t.pnlBrl;
    } else {
      losses++;
      grossLossBrl += Math.abs(t.pnlBrl);
    }
  }

  const avgWinBrl = wins > 0 ? grossProfitBrl / wins : 0;
  const avgLossBrl = losses > 0 ? grossLossBrl / losses : 0;
  const profitFactor =
    grossLossBrl > 0 ? grossProfitBrl / grossLossBrl : grossProfitBrl > 0 ? 9.99 : 0;
  const payoffRatio = avgLossBrl > 0 ? avgWinBrl / avgLossBrl : avgWinBrl > 0 ? 9.99 : 0;

  return {
    count: trades.length,
    wins,
    losses,
    winRatePct: Math.round((wins / trades.length) * 100),
    netPnlBrl: Number(netPnlBrl.toFixed(2)),
    grossProfitBrl: Number(grossProfitBrl.toFixed(2)),
    grossLossBrl: Number(grossLossBrl.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgWinBrl: Number(avgWinBrl.toFixed(2)),
    avgLossBrl: Number(avgLossBrl.toFixed(2)),
    payoffRatio: Number(payoffRatio.toFixed(2)),
    totalVolume: Number(totalVolume.toFixed(2)),
    avgPoints: Number((totalPoints / trades.length).toFixed(1)),
    bestTradeBrl: bestTradeBrl === -Infinity ? 0 : Number(bestTradeBrl.toFixed(2)),
    worstTradeBrl: worstTradeBrl === Infinity ? 0 : Number(worstTradeBrl.toFixed(2)),
  };
}

export function computePortfolioMetrics(
  robots: RobotStream[],
  referenceCapital = 25000
): PortfolioMetrics {
  const allTrades = robots
    .flatMap((r) => r.trades)
    .sort((a, b) => a.exitTime.localeCompare(b.exitTime));

  const buyTrades = allTrades.filter((t) => t.side === 'COMPRA');
  const sellTrades = allTrades.filter((t) => t.side === 'VENDA');

  const overall = computeSideStats(allTrades);
  const buys = computeSideStats(buyTrades);
  const sells = computeSideStats(sellTrades);

  const floatingPnlBrl = robots.reduce(
    (acc, r) => acc + (r.position ? r.position.floatingPnlBrl : 0),
    0
  );
  const realizedPnlBrl = robots.reduce((acc, r) => acc + r.realizedPnlBrl, 0);
  const netPnlBrl = Number((realizedPnlBrl + floatingPnlBrl).toFixed(2));

  let peak = 0;
  let running = 0;
  let maxDrawdownBrl = 0;
  let curWinStreak = 0;
  let curLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  for (const t of allTrades) {
    running += t.pnlBrl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdownBrl) maxDrawdownBrl = dd;

    if (t.pnlBrl >= 0) {
      curWinStreak++;
      curLossStreak = 0;
      if (curWinStreak > maxConsecutiveWins) maxConsecutiveWins = curWinStreak;
    } else {
      curLossStreak++;
      curWinStreak = 0;
      if (curLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = curLossStreak;
    }
  }

  const finalRunning = running + floatingPnlBrl;
  if (finalRunning > peak) peak = finalRunning;
  const finalDd = peak - finalRunning;
  if (finalDd > maxDrawdownBrl) maxDrawdownBrl = finalDd;

  const baseCap = referenceCapital > 0 ? referenceCapital : 25000;
  const maxDrawdownPct = Number(((maxDrawdownBrl / baseCap) * 100).toFixed(2));

  return {
    totalTrades: overall.count,
    wins: overall.wins,
    losses: overall.losses,
    winRatePct: overall.winRatePct,
    realizedPnlBrl: Number(realizedPnlBrl.toFixed(2)),
    floatingPnlBrl: Number(floatingPnlBrl.toFixed(2)),
    netPnlBrl,
    grossProfitBrl: overall.grossProfitBrl,
    grossLossBrl: overall.grossLossBrl,
    profitFactor: overall.profitFactor,
    payoffRatio: overall.payoffRatio,
    maxDrawdownBrl: Number(maxDrawdownBrl.toFixed(2)),
    maxDrawdownPct,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    totalVolume: overall.totalVolume,
    buys,
    sells,
  };
}

export interface EquityPoint {
  index: number;
  label: string;
  cumulativePnl: number;
  drawdown: number;
  tradePnl: number;
  side?: 'COMPRA' | 'VENDA';
  symbol?: string;
}

export function computeEquitySeries(
  trades: ExecutedTrade[],
  floatingPnlBrl = 0
): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  const points: EquityPoint[] = [
    {
      index: 0,
      label: 'Abertura',
      cumulativePnl: 0,
      drawdown: 0,
      tradePnl: 0,
    },
  ];

  let running = 0;
  let peak = 0;

  sorted.forEach((t, idx) => {
    running = Number((running + t.pnlBrl).toFixed(2));
    if (running > peak) peak = running;
    const dd = Number((running - peak).toFixed(2));
    points.push({
      index: idx + 1,
      label: t.exitTime,
      cumulativePnl: running,
      drawdown: dd,
      tradePnl: t.pnlBrl,
      side: t.side,
      symbol: t.symbol,
    });
  });

  if (Math.abs(floatingPnlBrl) > 0.01) {
    const liveVal = Number((running + floatingPnlBrl).toFixed(2));
    if (liveVal > peak) peak = liveVal;
    points.push({
      index: points.length,
      label: 'Em aberto',
      cumulativePnl: liveVal,
      drawdown: Number((liveVal - peak).toFixed(2)),
      tradePnl: floatingPnlBrl,
    });
  }

  return points;
}

export interface HourlyBucket {
  hour: string;
  buyCount: number;
  sellCount: number;
  buyPnl: number;
  sellPnl: number;
  netPnl: number;
}

export function computeHourlyBreakdown(trades: ExecutedTrade[]): HourlyBucket[] {
  const map = new Map<string, HourlyBucket>();
  for (let h = 9; h <= 18; h++) {
    const key = `${String(h).padStart(2, '0')}h`;
    map.set(key, {
      hour: key,
      buyCount: 0,
      sellCount: 0,
      buyPnl: 0,
      sellPnl: 0,
      netPnl: 0,
    });
  }

  for (const t of trades) {
    const match = t.exitTime.match(/^(\d{2})/);
    const hourKey = match ? `${match[1]}h` : '09h';
    if (!map.has(hourKey)) {
      map.set(hourKey, {
        hour: hourKey,
        buyCount: 0,
        sellCount: 0,
        buyPnl: 0,
        sellPnl: 0,
        netPnl: 0,
      });
    }
    const bucket = map.get(hourKey)!;
    if (t.side === 'COMPRA') {
      bucket.buyCount++;
      bucket.buyPnl = Number((bucket.buyPnl + t.pnlBrl).toFixed(2));
    } else {
      bucket.sellCount++;
      bucket.sellPnl = Number((bucket.sellPnl + t.pnlBrl).toFixed(2));
    }
    bucket.netPnl = Number((bucket.netPnl + t.pnlBrl).toFixed(2));
  }

  return Array.from(map.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

export function computeEMA(values: number[], period: number): Array<number | null> {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: Array<number | null> = new Array(values.length).fill(null);
  let ema: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      ema = sum / period;
      out[i] = ema;
    } else if (ema !== null) {
      ema = values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export function computeVWAP(candles: LiveCandle[]): Array<number | null> {
  let cumPV = 0;
  let cumV = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;
    cumPV += typical * vol;
    cumV += vol;
    return cumV > 0 ? cumPV / cumV : typical;
  });
}

export function computeBollinger(
  values: number[],
  period = 20,
  mult = 2
): { upper: Array<number | null>; middle: Array<number | null>; lower: Array<number | null> } {
  const upper: Array<number | null> = new Array(values.length).fill(null);
  const middle: Array<number | null> = new Array(values.length).fill(null);
  const lower: Array<number | null> = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - mean;
      sq += diff * diff;
    }
    const std = Math.sqrt(sq / period);
    middle[i] = mean;
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }

  return { upper, middle, lower };
}

export function computeRSI(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

export function exportTradesCsv(trades: ExecutedTrade[], filename = 'painel-sync-operacoes.csv') {
  const header = [
    'Ticket',
    'Robo',
    'MagicNumber',
    'Ativo',
    'Lado',
    'HoraEntrada',
    'HoraSaida',
    'PrecoEntrada',
    'PrecoSaida',
    'Volume',
    'Pontos',
    'ResultadoBRL',
    'Motivo',
  ].join(';');

  const rows = trades.map((t) =>
    [
      t.id,
      `"${t.robotName.replace(/"/g, '""')}"`,
      t.magicNumber,
      t.symbol,
      t.side,
      t.entryTime,
      t.exitTime,
      t.entryPrice.toString().replace('.', ','),
      t.exitPrice.toString().replace('.', ','),
      t.volume.toString().replace('.', ','),
      t.points.toString().replace('.', ','),
      t.pnlBrl.toFixed(2).replace('.', ','),
      `"${t.reason.replace(/"/g, '""')}"`,
    ].join(';')
  );

  const csvContent = '\uFEFF' + [header, ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type ReportPeriod = 'weekly' | 'monthly_30' | 'current_month';

export interface RobotHistoricalRow {
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  payoffRatio: number;
  grossProfitBrl: number;
  grossLossBrl: number;
  netPnlBrl: number;
  maxDrawdownBrl: number;
  avgTradeBrl: number;
  buyCount: number;
  sellCount: number;
  buyWinRatePct: number;
  sellWinRatePct: number;
}

export interface DailyHistoryBucket {
  dateIso: string;
  dateLabel: string;
  tradesCount: number;
  wins: number;
  winRatePct: number;
  netPnlBrl: number;
}

export function getMergedRobotHistory(robot: RobotStream): ExecutedTrade[] {
  const todayIso = new Date().toISOString().slice(0, 10);
  const map = new Map<string, ExecutedTrade>();
  for (const t of robot.historyTrades ?? []) {
    map.set(String(t.id), { ...t, exitDate: t.exitDate || todayIso });
  }
  for (const t of robot.trades ?? []) {
    map.set(String(t.id), { ...t, exitDate: t.exitDate || todayIso });
  }
  return Array.from(map.values()).sort((a, b) => {
    const da = `${a.exitDate || todayIso} ${a.exitTime}`;
    const db = `${b.exitDate || todayIso} ${b.exitTime}`;
    return da.localeCompare(db);
  });
}

export function filterTradesByPeriod(
  trades: ExecutedTrade[],
  period: ReportPeriod
): ExecutedTrade[] {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  if (period === 'current_month') {
    const monthPrefix = todayIso.slice(0, 7);
    return trades.filter((t) => (t.exitDate || todayIso).startsWith(monthPrefix));
  }

  const daysBack = period === 'weekly' ? 6 : 29;
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - daysBack);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  return trades.filter((t) => (t.exitDate || todayIso) >= cutoffIso);
}

export function computeRobotHistoricalReport(
  robots: RobotStream[],
  period: ReportPeriod
): {
  rows: RobotHistoricalRow[];
  consolidated: RobotHistoricalRow;
  dailySeries: DailyHistoryBucket[];
} {
  const todayIso = new Date().toISOString().slice(0, 10);

  const buildRow = (
    robotId: string,
    robotName: string,
    magicNumber: number,
    symbol: string,
    trades: ExecutedTrade[]
  ): RobotHistoricalRow => {
    const stats = computeSideStats(trades);
    const buys = computeSideStats(trades.filter((t) => t.side === 'COMPRA'));
    const sells = computeSideStats(trades.filter((t) => t.side === 'VENDA'));

    let running = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      running += t.pnlBrl;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      robotId,
      robotName,
      magicNumber,
      symbol,
      totalTrades: stats.count,
      wins: stats.wins,
      losses: stats.losses,
      winRatePct: stats.winRatePct,
      profitFactor: stats.profitFactor,
      payoffRatio: stats.payoffRatio,
      grossProfitBrl: stats.grossProfitBrl,
      grossLossBrl: stats.grossLossBrl,
      netPnlBrl: stats.netPnlBrl,
      maxDrawdownBrl: Number(maxDd.toFixed(2)),
      avgTradeBrl:
        stats.count > 0 ? Number((stats.netPnlBrl / stats.count).toFixed(2)) : 0,
      buyCount: buys.count,
      sellCount: sells.count,
      buyWinRatePct: buys.winRatePct,
      sellWinRatePct: sells.winRatePct,
    };
  };

  const allScopedTrades: ExecutedTrade[] = [];
  const rows: RobotHistoricalRow[] = robots.map((bot) => {
    const merged = getMergedRobotHistory(bot);
    const periodTrades = filterTradesByPeriod(merged, period);
    allScopedTrades.push(...periodTrades);
    return buildRow(bot.robotId, bot.name, bot.magicNumber, bot.symbol, periodTrades);
  });

  allScopedTrades.sort((a, b) => {
    const da = `${a.exitDate || todayIso} ${a.exitTime}`;
    const db = `${b.exitDate || todayIso} ${b.exitTime}`;
    return da.localeCompare(db);
  });

  const consolidated = buildRow(
    'CONSOLIDATED',
    'Carteira Consolidada',
    0,
    `${robots.length} robôs`,
    allScopedTrades
  );

  // Agrupamento diário para o gráfico de barras histórico
  const dayMap = new Map<string, { trades: number; wins: number; net: number }>();
  for (const t of allScopedTrades) {
    const d = t.exitDate || todayIso;
    const cur = dayMap.get(d) ?? { trades: 0, wins: 0, net: 0 };
    cur.trades++;
    if (t.pnlBrl >= 0) cur.wins++;
    cur.net += t.pnlBrl;
    dayMap.set(d, cur);
  }

  const dailySeries: DailyHistoryBucket[] = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateIso, info]) => {
      const parts = dateIso.split('-');
      const dateLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateIso;
      return {
        dateIso,
        dateLabel,
        tradesCount: info.trades,
        wins: info.wins,
        winRatePct: info.trades > 0 ? Math.round((info.wins / info.trades) * 100) : 0,
        netPnlBrl: Number(info.net.toFixed(2)),
      };
    });

  return {
    rows: rows.sort((a, b) => b.netPnlBrl - a.netPnlBrl),
    consolidated,
    dailySeries,
  };
}

export function exportReportCsv(rows: RobotHistoricalRow[], periodLabel: string) {
  const header = [
    'Periodo',
    'Robo',
    'MagicNumber',
    'Ativo',
    'Operacoes',
    'Gains',
    'Losses',
    'WinRatePct',
    'ProfitFactor',
    'Payoff',
    'LucroBrutoBRL',
    'PrejuizoBrutoBRL',
    'DrawdownMaxBRL',
    'ResultadoLiquidoBRL',
  ].join(';');

  const lines = rows.map((r) =>
    [
      `"${periodLabel}"`,
      `"${r.robotName.replace(/"/g, '""')}"`,
      r.magicNumber,
      r.symbol,
      r.totalTrades,
      r.wins,
      r.losses,
      `${r.winRatePct}%`,
      r.profitFactor.toFixed(2).replace('.', ','),
      r.payoffRatio.toFixed(2).replace('.', ','),
      r.grossProfitBrl.toFixed(2).replace('.', ','),
      r.grossLossBrl.toFixed(2).replace('.', ','),
      r.maxDrawdownBrl.toFixed(2).replace('.', ','),
      r.netPnlBrl.toFixed(2).replace('.', ','),
    ].join(';')
  );

  const csvContent = '\uFEFF' + [header, ...lines].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `painel-sync-relatorio-${periodLabel.toLowerCase().replace(/\s+/g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
