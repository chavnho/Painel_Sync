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
  ORDER BY exit_date ASC, exit_time ASC, id ASC
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
  const rows = selectByAccountStmt.all(accountLogin);
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