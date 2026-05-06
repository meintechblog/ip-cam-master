// v1.3 Phase 21 Wave-0 stub — Plan 06 fills in.
// DB-touching, fake-timers. In-memory better-sqlite3 + Drizzle covering the
// minimal table set the protect-hub scheduler tick + bridge health probe will
// touch (HUB-RCN-01, HUB-OPS-05).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const { memDbRef } = vi.hoisted(() => ({
	memDbRef: {
		db: null as ReturnType<typeof drizzle> | null,
		sqlite: null as Database.Database | null
	}
}));

vi.mock('$lib/server/db/client', () => ({
	get db() {
		return memDbRef.db;
	},
	get sqlite() {
		return memDbRef.sqlite;
	},
	DB_ABS_PATH: ':memory:'
}));

import * as schema from '../db/schema';

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`
		CREATE TABLE protect_hub_bridges (
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
		);
		CREATE TABLE protect_hub_reconcile_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			reconcile_id TEXT NOT NULL,
			started_at TEXT NOT NULL DEFAULT (datetime('now')),
			completed_at TEXT,
			status TEXT NOT NULL DEFAULT 'running',
			hash_changed INTEGER NOT NULL DEFAULT 0,
			deployed_yaml_hash TEXT,
			error TEXT
		);
		CREATE TABLE settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT NOT NULL UNIQUE,
			value TEXT NOT NULL,
			encrypted INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	memDbRef.sqlite = sqlite;
	memDbRef.db = drizzle(sqlite, { schema });
}

describe('scheduler — protect hub interval + bridge health probe (Wave 0 stub — Plan 06 fills in)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-06T13:00:00Z'));
		freshDb();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// HUB-RCN-01
	it.skip('protect hub — tick fires every 5min when settings.protect_hub_enabled=true', () => {
		expect(true).toBe(true);
	});
	it.skip('protect hub — silent when settings.protect_hub_enabled=false', () => {
		expect(true).toBe(true);
	});
	// HUB-OPS-05
	it.skip('2-strike threshold — 2 consecutive bridge fetch failures → status=unhealthy + event', () => {
		expect(true).toBe(true);
	});
	it.skip('recovery — single success after unhealthy → status=running', () => {
		expect(true).toBe(true);
	});
});
