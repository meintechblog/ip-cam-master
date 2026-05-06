// v1.3 Phase 21 Wave-0 stub — Plan 03 fills in.
// DB-touching: in-memory better-sqlite3 + Drizzle. DDL block mirrors client.ts
// CREATE-TABLE-IF-NOT-EXISTS shape and is extended with the new
// protect_hub_reconcile_runs audit table (per D-RCN-04 + L-14).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const { memDbRef, mockConnectToProxmox, mockExecuteOnContainer, mockPushFileToContainer, mockDiscover } =
	vi.hoisted(() => ({
		memDbRef: {
			db: null as ReturnType<typeof drizzle> | null,
			sqlite: null as Database.Database | null
		},
		mockConnectToProxmox: vi.fn(),
		mockExecuteOnContainer: vi.fn(),
		mockPushFileToContainer: vi.fn(),
		mockDiscover: vi.fn()
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

vi.mock('$lib/server/services/ssh', () => ({
	connectToProxmox: mockConnectToProxmox,
	executeOnContainer: mockExecuteOnContainer,
	pushFileToContainer: mockPushFileToContainer
}));

vi.mock('$lib/server/orchestration/protect-hub/catalog', () => ({
	discover: mockDiscover
}));

import * as schema from '../../db/schema';

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	// Mirror the same DDL the production client.ts emits — keep all P19/P20/P21
	// tables a reconcile test might need. Plans 03+ will write rows here.
	sqlite.exec(`
		CREATE TABLE cameras (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			ip TEXT,
			mac TEXT,
			source TEXT NOT NULL DEFAULT 'managed',
			kind TEXT NOT NULL DEFAULT 'unknown',
			hub_bridge_id INTEGER,
			external_id TEXT,
			manufacturer TEXT,
			model_name TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
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
		CREATE TABLE camera_outputs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			camera_id INTEGER NOT NULL,
			output_type TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 0,
			config TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE protect_stream_catalog (
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
		);
	`);
	// P21 — reconcile-runs audit table (mirrors client.ts CREATE).
	sqlite.exec(`
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
	`);
	memDbRef.sqlite = sqlite;
	memDbRef.db = drizzle(sqlite, { schema });
}

describe('reconcile (Wave 0 stub — Plan 03 fills in)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		freshDb();
	});

	// HUB-RCN-04
	it.skip('re-extract URLs — calls discover() as Pass 1', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-05
	it.skip('no-op skip — identical YAML → no SSH push, status=no_op', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-06
	it.skip('single-flight — two simultaneous calls share the same Promise', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-08 / HUB-OUT-05
	it.skip('auto-add — new cam → outputs seeded per kind (first-party ON, third-party OFF)', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-09
	it.skip('soft-delete — removed cam → cameras.source=external_archived', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-10
	it.skip('busy gate — isReconcilerBusy() returns true mid-reconcile, false after', () => {
		expect(true).toBe(true);
	});
	// P21-#11
	it.skip('mtime fast-path — ±2s tolerance treats as no-op', () => {
		expect(true).toBe(true);
	});
	// P21-#1
	it.skip('token rotation — fresh tokens in URL → hash changes → redeploy', () => {
		expect(true).toBe(true);
	});
});
