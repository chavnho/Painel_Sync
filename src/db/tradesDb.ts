import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => Array<Record<string, unknown>>;
    };
  };
};

export interface PersistedTradeRecord {
  id: string;
  robotId: string;
  robotName: string;
  magicNumber: number;
  symbol: string;
  side: "COMPRA" | "VENDA";
  entryDate: string;
  exitDate: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  points: number;
  pnlBrl: number;
  reason: string;
}

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "painel_sync.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS executed_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_login TEXT NOT NULL,
    deal_ticket TEXT NOT NULL,
    robot_id TEXT NOT NULL,
    robot_name TEXT NOT NULL,
    magic_number INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    exit_date TEXT NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    volume REAL NOT NULL,
    points REAL NOT NULL,
    pnl_brl REAL NOT NULL,
    reason TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(account_login, deal_ticket)
  );
  CREATE INDEX IF NOT EXISTS idx_trades_account_magic
    ON executed_trades (account_login, magic_number, exit_date, exit_time);
  CREATE TABLE IF NOT EXISTS robot_preferences (
    account_login TEXT NOT NULL,
    magic_number INTEGER NOT NULL,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_login, magic_number)
  );
  CREATE TABLE IF NOT EXISTS command_queue (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    magic_number INTEGER NOT NULL DEFAULT 0,
    action TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT '',
    volume REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    sl REAL NOT NULL DEFAULT 0,
    tp REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    mt5_order_ticket TEXT NOT NULL DEFAULT '',
    mt5_position_ticket TEXT NOT NULL DEFAULT '',
    retcode INTEGER NOT NULL DEFAULT 0,
    ack_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cmd_channel_status
    ON command_queue (channel_id, status, created_at DESC);
`);

const upsertStmt = db.prepare(`
  INSERT INTO executed_trades (
    account_login, deal_ticket, robot_id, robot_name, magic_number, symbol,
    side, entry_date, exit_date, entry_time, exit_time,
    entry_price, exit_price, volume, points, pnl_brl, reason, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_login, deal_ticket) DO UPDATE SET
    robot_name = excluded.robot_name,
    entry_date = excluded.entry_date,
    exit_date = excluded.exit_date,
    entry_time = excluded.entry_time,
    exit_time = excluded.exit_time,
    entry_price = excluded.entry_price,
    exit_price = excluded.exit_price,
    volume = excluded.volume,
    points = excluded.points,
    pnl_brl = excluded.pnl_brl,
    reason = excluded.reason,
    updated_at = excluded.updated_at
`);

const selectByAccountStmt = db.prepare(`
  SELECT
    deal_ticket AS id,
    robot_id AS robotId,
    robot_name AS robotName,
    magic_number AS magicNumber,
    symbol,
    side,
    entry_date AS entryDate,
    exit_date AS exitDate,
    entry_time AS entryTime,
    exit_time AS exitTime,
    entry_price AS entryPrice,
    exit_price AS exitPrice,
    volume,
    points,
    pnl_brl AS pnlBrl,
    reason
  FROM executed_trades
  WHERE account_login = ?
  ORDER BY exit_date DESC, exit_time DESC, id DESC
  LIMIT 3000
`);

export function persistExecutedTrades(
  accountLogin: string,
  trades: PersistedTradeRecord[]
): void {
  if (!accountLogin || trades.length === 0) return;
  const nowIso = new Date().toISOString();
  for (const t of trades) {
    if (!t.id) continue;
    upsertStmt.run(
      accountLogin,
      String(t.id),
      String(t.robotId || `${t.magicNumber}_${t.symbol}`),
      String(t.robotName || `Robo #${t.magicNumber}`),
      Number(t.magicNumber) || 0,
      String(t.symbol || ""),
      t.side === "VENDA" ? "VENDA" : "COMPRA",
      String(t.entryDate || ""),
      String(t.exitDate || ""),
      String(t.entryTime || ""),
      String(t.exitTime || ""),
      Number(t.entryPrice) || 0,
      Number(t.exitPrice) || 0,
      Number(t.volume) || 1,
      Number(t.points) || 0,
      Number(t.pnlBrl) || 0,
      String(t.reason || "MT5"),
      nowIso
    );
  }
}

export function loadPersistedTradesForAccount(
  accountLogin: string
): PersistedTradeRecord[] {
  if (!accountLogin) return [];
  const rows = selectByAccountStmt.all(accountLogin).reverse();
  return rows.map((r) => ({
    id: String(r.id),
    robotId: String(r.robotId),
    robotName: String(r.robotName),
    magicNumber: Number(r.magicNumber) || 0,
    symbol: String(r.symbol),
    side: r.side === "VENDA" ? "VENDA" : "COMPRA",
    entryDate: String(r.entryDate),
    exitDate: String(r.exitDate),
    entryTime: String(r.entryTime),
    exitTime: String(r.exitTime),
    entryPrice: Number(r.entryPrice) || 0,
    exitPrice: Number(r.exitPrice) || 0,
    volume: Number(r.volume) || 1,
    points: Number(r.points) || 0,
    pnlBrl: Number(r.pnlBrl) || 0,
    reason: String(r.reason || "MT5"),
  }));
}

export function createDatabaseBackup(keepLatest = 7): { ok: boolean; backupPath?: string; error?: string } {
  try {
    const backupsDir = path.join(dataDir, "backups");
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetFile = path.join(backupsDir, `painel_sync_${stamp}.db`);
    const escapedPath = targetFile.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);

    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith("painel_sync_") && f.endsWith(".db"))
      .sort();
    while (files.length > keepLatest) {
      const oldest = files.shift();
      if (oldest) {
        try {
          fs.unlinkSync(path.join(backupsDir, oldest));
        } catch {
          // ignora falha ao remover backup antigo
        }
      }
    }
    return { ok: true, backupPath: targetFile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const upsertHiddenStmt = db.prepare(`
  INSERT INTO robot_preferences (account_login, magic_number, is_hidden, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(account_login, magic_number) DO UPDATE SET
    is_hidden = excluded.is_hidden,
    updated_at = excluded.updated_at
`);
const selectHiddenStmt = db.prepare(`SELECT magic_number AS m FROM robot_preferences WHERE account_login = ? AND is_hidden = 1`);

export function setRobotHiddenPreference(accountLogin: string, magicNumber: number, hidden: boolean): void {
  if (!accountLogin || !Number.isFinite(magicNumber)) return;
  upsertHiddenStmt.run(String(accountLogin), Math.trunc(magicNumber), hidden ? 1 : 0, new Date().toISOString());
}

export function loadHiddenMagicsForAccount(accountLogin: string): Set<number> {
  const out = new Set<number>();
  if (!accountLogin) return out;
  for (const r of selectHiddenStmt.all(String(accountLogin))) {
    const n = Number(r.m);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

export interface PersistedCommandRecord {
  id: string;
  channelId: string;
  magicNumber?: number;
  action: "CLOSE_MAGIC" | "CANCEL_ORDERS" | "CLOSE_ALL" | "OPEN_ORDER" | "MODIFY_SL_TP";
  symbol?: string;
  side?: "COMPRA" | "VENDA";
  volume?: number;
  price?: number;
  sl?: number;
  tp?: number;
  status: "pending" | "dispatched" | "executed" | "failed" | "expired";
  expiresAt: string;
  mt5OrderTicket?: string;
  mt5PositionTicket?: string;
  retcode?: number;
  ackMessage?: string;
  createdAt: string;
  updatedAt: string;
}

const insertCmdStmt = db.prepare(`
  INSERT INTO command_queue (
    id, channel_id, magic_number, action, symbol, side, volume, price, sl, tp,
    status, expires_at, mt5_order_ticket, mt5_position_ticket, retcode, ack_message, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, '', ?, ?)
`);

const expireOldCmdsStmt = db.prepare(`
  UPDATE command_queue
  SET status = 'expired', ack_message = 'Tempo limite de 15s excedido (MT5 offline)', updated_at = ?
  WHERE channel_id = ? AND status IN ('pending', 'dispatched') AND expires_at < ?
`);

const selectPendingCmdsStmt = db.prepare(`
  SELECT * FROM command_queue
  WHERE channel_id = ? AND status = 'pending' AND expires_at >= ?
  ORDER BY created_at ASC
  LIMIT 20
`);

const markCmdDispatchedStmt = db.prepare(`
  UPDATE command_queue SET status = 'dispatched', updated_at = ? WHERE id = ? AND status = 'pending'
`);

const ackCmdStmt = db.prepare(`
  UPDATE command_queue
  SET status = ?, mt5_order_ticket = ?, mt5_position_ticket = ?, retcode = ?, ack_message = ?, updated_at = ?
  WHERE id = ? AND channel_id = ?
`);

const selectRecentCmdsStmt = db.prepare(`
  SELECT * FROM command_queue
  WHERE channel_id = ?
  ORDER BY created_at DESC
  LIMIT 40
`);

const pruneOldCmdsStmt = db.prepare(`DELETE FROM command_queue WHERE status IN ('executed', 'failed', 'expired') AND updated_at < ?`);
const selectCmdByIdStmt = db.prepare(`SELECT * FROM command_queue WHERE id = ?`);

function mapCommandRow(r: Record<string, unknown>): PersistedCommandRecord {
  const sideRaw = String(r.side || "");
  return {
    id: String(r.id),
    channelId: String(r.channel_id),
    magicNumber: (r.magic_number !== null && r.magic_number !== undefined && Number(r.magic_number) >= 0) ? Number(r.magic_number) : undefined,
    action: String(r.action) as PersistedCommandRecord["action"],
    symbol: r.symbol ? String(r.symbol) : undefined,
    side: sideRaw === "COMPRA" || sideRaw === "VENDA" ? sideRaw : undefined,
    volume: Number(r.volume) || undefined,
    price: Number(r.price) || undefined,
    sl: Number(r.sl) || undefined,
    tp: Number(r.tp) || undefined,
    status: String(r.status) as PersistedCommandRecord["status"],
    expiresAt: String(r.expires_at),
    mt5OrderTicket: r.mt5_order_ticket ? String(r.mt5_order_ticket) : undefined,
    mt5PositionTicket: r.mt5_position_ticket ? String(r.mt5_position_ticket) : undefined,
    retcode: Number(r.retcode) || undefined,
    ackMessage: r.ack_message ? String(r.ack_message) : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function enqueueCommand(input: {
  id: string;
  channelId: string;
  magicNumber?: number;
  action: PersistedCommandRecord["action"];
  symbol?: string;
  side?: "COMPRA" | "VENDA";
  volume?: number;
  price?: number;
  sl?: number;
  tp?: number;
  ttlSeconds?: number;
}): PersistedCommandRecord {
  const now = new Date();
  const nowIso = now.toISOString();
  const ttl = Math.max(5, Math.min(60, input.ttlSeconds ?? 15));
  const expiresIso = new Date(now.getTime() + ttl * 1000).toISOString();

  insertCmdStmt.run(
    input.id,
    input.channelId,
    (input.magicNumber !== undefined && input.magicNumber !== null && Number.isFinite(Number(input.magicNumber))) ? Math.trunc(Number(input.magicNumber)) : -1,
    input.action,
    String(input.symbol || "").toUpperCase(),
    input.side || "",
    Number(input.volume) || 0,
    Number(input.price) || 0,
    Number(input.sl) || 0,
    Number(input.tp) || 0,
    "pending",
    expiresIso,
    nowIso,
    nowIso
  );

  const row = selectCmdByIdStmt.all(input.id);
  return mapCommandRow(row[0]);
}

export function pollAndDispatchPendingCommands(channelId: string): PersistedCommandRecord[] {
  const nowIso = new Date().toISOString();
  expireOldCmdsStmt.run(nowIso, channelId, nowIso);
  const rows = selectPendingCmdsStmt.all(channelId, nowIso);
  const commands = rows.map(mapCommandRow);
  for (const cmd of commands) {
    markCmdDispatchedStmt.run(nowIso, cmd.id);
    cmd.status = "dispatched";
    cmd.updatedAt = nowIso;
  }
  return commands;
}

export function acknowledgeCommand(
  channelId: string,
  commandId: string,
  payload: {
    status: "executed" | "failed";
    mt5OrderTicket?: string;
    mt5PositionTicket?: string;
    retcode?: number;
    ackMessage?: string;
  }
): PersistedCommandRecord | null {
  const nowIso = new Date().toISOString();
  ackCmdStmt.run(
    payload.status,
    String(payload.mt5OrderTicket || ""),
    String(payload.mt5PositionTicket || ""),
    Math.trunc(Number(payload.retcode) || 0),
    String(payload.ackMessage || ""),
    nowIso,
    commandId,
    channelId
  );
  const rows = selectCmdByIdStmt.all(commandId);
  return rows.length > 0 ? mapCommandRow(rows[0]) : null;
}

export function listRecentCommands(channelId: string): PersistedCommandRecord[] {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  pruneOldCmdsStmt.run(cutoffIso);
  expireOldCmdsStmt.run(nowIso, channelId, nowIso);
  return selectRecentCmdsStmt.all(channelId).map(mapCommandRow);
}

export interface PersistedManagedRobot {
  id: string;
  channelId: string;
  name: string;
  magicNumber: number;
  symbol: string;
  timeframe: "M1" | "M5" | "M15" | "M30" | "H1";
  enabled: boolean;
  environment?: 'SIMULATOR' | 'PRODUCTION';
  strategyType: "ema_cross" | "rsi_reversal" | "breakout" | "wdo_opening_zones";
  params: Record<string, unknown>;
  risk: {
    volume: number;
    stopPoints: number;
    takePoints: number;
    startTime: string;
    endTime: string;
    closeTime: string;
    maxDailyLossBrl: number;
    reverseOnOpposite: boolean;
  };
  lastSignalBar: number;
  lastDecision: string;
  createdAt: string;
  updatedAt: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS managed_robots (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    magic_number INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    strategy_type TEXT NOT NULL,
    params_json TEXT NOT NULL,
    risk_json TEXT NOT NULL,
    last_signal_bar INTEGER NOT NULL DEFAULT 0,
    last_decision TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_managed_robots_channel ON managed_robots (channel_id, created_at DESC);
`);

try { db.exec("ALTER TABLE managed_robots ADD COLUMN environment TEXT NOT NULL DEFAULT 'SIMULATOR'"); } catch {}
const insertManagedBotStmt = db.prepare(`
  INSERT INTO managed_robots (id, channel_id, name, magic_number, symbol, timeframe, enabled, strategy_type, params_json, risk_json, last_signal_bar, last_decision, created_at, updated_at, environment)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Aguardando ativacao', ?, ?, ?)
`);
const selectManagedBotsByChannelStmt = db.prepare(`SELECT * FROM managed_robots WHERE channel_id = ? ORDER BY created_at DESC`);
const selectManagedBotByIdStmt = db.prepare(`SELECT * FROM managed_robots WHERE id = ? AND channel_id = ? LIMIT 1`);
const selectMaxMagicByChannelStmt = db.prepare(`SELECT COALESCE(MAX(magic_number), 9000) AS max_magic FROM managed_robots WHERE channel_id = ?`);
const updateManagedBotStmt = db.prepare(`UPDATE managed_robots SET name = ?, symbol = ?, timeframe = ?, enabled = ?, strategy_type = ?, params_json = ?, risk_json = ?, updated_at = ?, environment = ? WHERE id = ? AND channel_id = ?`);
const updateManagedBotSignalStmt = db.prepare(`UPDATE managed_robots SET last_signal_bar = ?, last_decision = ?, updated_at = ? WHERE id = ?`);
const updateManagedBotDecisionStmt = db.prepare(`UPDATE managed_robots SET last_decision = ?, updated_at = ? WHERE id = ?`);
const deleteManagedBotStmt = db.prepare(`DELETE FROM managed_robots WHERE id = ? AND channel_id = ?`);
const countActiveCmdsForMagicStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM command_queue WHERE channel_id = ? AND magic_number = ? AND status IN ('pending', 'dispatched') AND expires_at > ?`);

function mapManagedRobotRow(row: Record<string, unknown>): PersistedManagedRobot {
  let params: Record<string, unknown> = {};
  let risk = { volume: 1, stopPoints: 150, takePoints: 300, startTime: "09:05", endTime: "17:15", closeTime: "17:45", maxDailyLossBrl: 500, reverseOnOpposite: true };
  try { const p = JSON.parse(String(row.params_json || "{}")); if (p && typeof p === "object") params = p; } catch {}
  try { const r = JSON.parse(String(row.risk_json || "{}")); if (r && typeof r === "object") risk = { ...risk, ...r }; } catch {}
  const tfRaw = String(row.timeframe || "M5").toUpperCase();
  const timeframe = (["M1", "M5", "M15", "M30", "H1"].includes(tfRaw) ? tfRaw : "M5") as PersistedManagedRobot["timeframe"];
  const stRaw = String(row.strategy_type || "ema_cross");
  const strategyType = (["ema_cross", "rsi_reversal", "breakout", "wdo_opening_zones"].includes(stRaw) ? stRaw : "ema_cross") as PersistedManagedRobot["strategyType"];
  return {
    id: String(row.id || ""),
    channelId: String(row.channel_id || ""),
    name: String(row.name || "Robo App"),
    magicNumber: Number(row.magic_number) || 9001,
    symbol: String(row.symbol || "WIN$").toUpperCase(),
    timeframe,
    enabled: Number(row.enabled) === 1,
    environment: (String(row.environment || 'SIMULATOR').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SIMULATOR'),
    strategyType,
    params,
    risk,
    lastSignalBar: Number(row.last_signal_bar) || 0,
    lastDecision: String(row.last_decision || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export function listManagedRobots(channelId: string): PersistedManagedRobot[] {
  return selectManagedBotsByChannelStmt.all(channelId).map(mapManagedRobotRow);
}

export function createManagedRobot(input: { channelId: string; name: string; magicNumber?: number; symbol: string; timeframe: PersistedManagedRobot["timeframe"]; enabled?: boolean; environment?: 'SIMULATOR' | 'PRODUCTION'; strategyType: PersistedManagedRobot["strategyType"]; params: Record<string, unknown>; risk: PersistedManagedRobot["risk"]; }): PersistedManagedRobot {
  const nowIso = new Date().toISOString();
  const id = `appbot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const maxRow = selectMaxMagicByChannelStmt.all(input.channelId).at(0);
  const nextAutoMagic = Math.max(9001, (Number(maxRow?.max_magic) || 9000) + 1);
  const magicNumber = input.magicNumber && input.magicNumber > 0 ? Math.trunc(input.magicNumber) : nextAutoMagic;
  insertManagedBotStmt.run(id, input.channelId, String(input.name || `Robo #${magicNumber}`).trim(), magicNumber, String(input.symbol || "WIN$").trim().toUpperCase(), input.timeframe, input.enabled ? 1 : 0, input.strategyType, JSON.stringify(input.params || {}), JSON.stringify(input.risk || {}), nowIso, nowIso, input.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SIMULATOR');
  return mapManagedRobotRow(selectManagedBotByIdStmt.all(id, input.channelId).at(0)!);
}

export function updateManagedRobot(channelId: string, robotId: string, patch: Partial<{ name: string; symbol: string; timeframe: PersistedManagedRobot["timeframe"]; enabled: boolean; environment: 'SIMULATOR' | 'PRODUCTION'; strategyType: PersistedManagedRobot["strategyType"]; params: Record<string, unknown>; risk: PersistedManagedRobot["risk"]; }>): PersistedManagedRobot | null {
  const existingRow = selectManagedBotByIdStmt.all(robotId, channelId).at(0);
  if (!existingRow) return null;
  const cur = mapManagedRobotRow(existingRow);
  const nowIso = new Date().toISOString();
  const nextEnv = patch.environment !== undefined ? (patch.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SIMULATOR') : (cur.environment || 'SIMULATOR');
  const nextEnabled = nextEnv === 'SIMULATOR' ? false : (patch.enabled !== undefined ? patch.enabled : cur.enabled);
  updateManagedBotStmt.run(
    patch.name !== undefined ? String(patch.name).trim() || cur.name : cur.name,
    patch.symbol !== undefined ? String(patch.symbol).trim().toUpperCase() || cur.symbol : cur.symbol,
    patch.timeframe !== undefined ? patch.timeframe : cur.timeframe,
    nextEnabled ? 1 : 0,
    patch.strategyType !== undefined ? patch.strategyType : cur.strategyType,
    JSON.stringify(patch.params !== undefined ? { ...cur.params, ...patch.params } : cur.params),
    JSON.stringify(patch.risk !== undefined ? { ...cur.risk, ...patch.risk } : cur.risk),
    nowIso, nextEnv, robotId, channelId
  );
  const updated = selectManagedBotByIdStmt.all(robotId, channelId).at(0);
  return updated ? mapManagedRobotRow(updated) : null;
}

export function markManagedRobotSignal(robotId: string, barTime: number, decision: string): void {
  updateManagedBotSignalStmt.run(Math.trunc(barTime), decision, new Date().toISOString(), robotId);
}

export function updateManagedRobotDecision(robotId: string, decision: string): void {
  updateManagedBotDecisionStmt.run(decision, new Date().toISOString(), robotId);
}

export function deleteManagedRobot(channelId: string, robotId: string): boolean {
  deleteManagedBotStmt.run(robotId, channelId);
  return selectManagedBotByIdStmt.all(robotId, channelId).length === 0;
}

export function hasActiveCommandForMagic(channelId: string, magicNumber: number): boolean {
  const row = countActiveCmdsForMagicStmt.all(channelId, magicNumber, new Date().toISOString()).at(0);
  return Number(row?.cnt || 0) > 0;
}
