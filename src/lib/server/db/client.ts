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
ensureColumn('cameras', 'model', 'TEXT');
ensureColumn('credentials', 'type', "TEXT NOT NULL DEFAULT 'mobotix'");
ensureColumn('credentials', 'access_code', 'TEXT');
ensureColumn('credentials', 'serial_number', 'TEXT');

// v1.3 Phase 19 — Protect Stream Hub schema lock (per L-1, L-28; reuses Phase 18 `cameras.model` column).
// MAC-as-PK for source='external' rows is irreversible after this commit.
ensureColumn('cameras', 'source', "TEXT NOT NULL DEFAULT 'managed'");
ensureColumn('cameras', 'mac', 'TEXT'); // NULL for managed; required by app for external (enforced in catalog.ts upsert, Plan 03)
ensureColumn('cameras', 'external_id', 'TEXT'); // Protect cam UUID — denormalised cache only, never join on this
ensureColumn('cameras', 'hub_bridge_id', 'INTEGER'); // FK → protect_hub_bridges.id; NULL for managed
ensureColumn('cameras', 'manufacturer', 'TEXT'); // derived hint, see protect-bridge.ts deriveManufacturerHint() (Plan 03)
ensureColumn('cameras', 'model_name', 'TEXT'); // Protect marketName (e.g. 'G4 Bullet'). Phase 18's `model` is reused for Bambu SSDP codes.
ensureColumn('cameras', 'kind', "TEXT NOT NULL DEFAULT 'unknown'"); // 'first-party' | 'third-party' | 'unknown'

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS protect_hub_bridges (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		vmid INTEGER NOT NULL UNIQUE,
		hostname TEXT NOT NULL,
		container_ip TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		last_deployed_yaml_hash TEXT,
		last_reconciled_at TEXT,
		last_health_check_at TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS camera_outputs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		camera_id INTEGER NOT NULL,
		output_type TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 0,
		config TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS protect_stream_catalog (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		camera_id INTEGER NOT NULL,
		quality TEXT NOT NULL,
		codec TEXT,
		width INTEGER,
		height INTEGER,
		fps INTEGER,
		bitrate INTEGER,
		rtsp_url TEXT,
		share_enabled INTEGER NOT NULL DEFAULT 0,
		cached_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_stream_catalog_cam ON protect_stream_catalog(camera_id)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_camera_outputs_cam ON camera_outputs(camera_id)`);

// v1.3 Phase 24 — Auto-Update Parity (UPD-AUTO-10).
// Replaces the JSON blob in settings.update_run_history with a real table.
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS update_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		started_at TEXT NOT NULL,
		finished_at TEXT,
		pre_sha TEXT,
		post_sha TEXT,
		target_sha TEXT,
		status TEXT NOT NULL DEFAULT 'running',
		stage TEXT,
		error_message TEXT,
		rollback_stage TEXT,
		unit_name TEXT,
		log_path TEXT,
		backup_path TEXT,
		trigger TEXT NOT NULL DEFAULT 'manual'
	)
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_update_runs_started_at ON update_runs(started_at DESC)`);

// v1.3 Phase 21 — protect_hub_reconcile_runs (per D-RCN-04).
// Audit log for every reconcile pass; mirrors update_runs shape.
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS protect_hub_reconcile_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		reconcile_id TEXT NOT NULL,
		started_at TEXT NOT NULL DEFAULT (datetime('now')),
		completed_at TEXT,
		status TEXT NOT NULL DEFAULT 'running',
		hash_changed INTEGER NOT NULL DEFAULT 0,
		deployed_yaml_hash TEXT,
		error TEXT
	)
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_hub_reconcile_runs_started_at ON protect_hub_reconcile_runs(started_at DESC)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_hub_reconcile_runs_reconcile_id ON protect_hub_reconcile_runs(reconcile_id)`);
