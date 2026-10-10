import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();

const configured = process.env.DATABASE_PATH || "./data/energy.db";
const dbPath = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  voltage REAL NOT NULL,
  current REAL NOT NULL,
  power REAL NOT NULL,
  energy REAL NOT NULL,
  power_factor REAL NOT NULL,
  frequency REAL NOT NULL,
  temperature REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'esp32',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings(device_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  firmware_version TEXT,
  ip_address TEXT,
  wifi_rssi INTEGER,
  uptime_seconds INTEGER,
  last_seen TEXT,
  source TEXT NOT NULL DEFAULT 'esp32'
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  value REAL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
`);
const defaults = {
  tariff: process.env.DEFAULT_TARIFF || "8.5",
  minVoltage: "200", maxVoltage: "250", maxCurrent: "10",
  maxPower: "5000", minPowerFactor: "0.8", maxTemperature: "60",
  offlineSeconds: process.env.DEVICE_OFFLINE_SECONDS || "15",
  retentionDays: "90"
};
const insert = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
for (const [k,v] of Object.entries(defaults)) insert.run(k, String(v));
