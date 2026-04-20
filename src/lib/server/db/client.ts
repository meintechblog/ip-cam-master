import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const DB_PATH = resolve('data/ip-cam-master.db');
mkdirSync(resolve('data'), { recursive: true });

export const DB_ABS_PATH = DB_PATH;

export const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Auto-create tables that don't exist yet (lightweight migration for new tables)
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		camera_id INTEGER,
		camera_name TEXT,
		event_type TEXT NOT NULL,
		severity TEXT NOT NULL DEFAULT 'info',
		message TEXT NOT NULL,
		source TEXT NOT NULL,
		timestamp TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// Idempotent ADD COLUMN migrations. SQLite throws on duplicate adds,
// so we check PRAGMA table_info first. Keeps dev-deploys reproducible
// without requiring a separate `drizzle-kit push` step on the VM.
function ensureColumn(table: string, column: string, definition: string): void {
	const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	if (rows.some((r) => r.name === column)) return;
	sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('cameras', 'rtsp_auth_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('credentials', 'type', "TEXT NOT NULL DEFAULT 'mobotix'");
ensureColumn('credentials', 'access_code', 'TEXT');
ensureColumn('credentials', 'serial_number', 'TEXT');
