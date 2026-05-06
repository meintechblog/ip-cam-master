// v1.3 Phase 21 Plan 03 — reconcile.ts behavioural tests.
//
// Replaces the Plan 01 stub. Covers all P21-relevant pitfalls + audit-log
// invariants:
//
//   - HUB-RCN-04: re-extract URLs (calls discover() as Pass 1)
//   - HUB-RCN-05: no-op skip (identical YAML → no SSH push)
//   - HUB-RCN-06: single-flight (two simultaneous calls share Promise)
//   - HUB-RCN-08: dirty-flag follow-up
//   - HUB-RCN-09: soft-delete (cam missing from bootstrap → archived)
//   - HUB-RCN-10: busy gate + atomic tmp+rename SSH push
//   - HUB-OUT-05: auto-add (first-party Loxone default ON; third-party OFF)
//   - P21-#1: token rotation → hash changes → redeploy
//   - P21-#11: mtime fast-path (±2s tolerance)
//   - D-CAP-04: SSH dial fail → status='bridge_unreachable', no retry
//   - T-21-05: every reconcile pass produces exactly 1 audit row
//   - CR-1: atomic deploy order (push tmp → mv → systemctl restart)
//   - CR-3: never call `reload-or-restart` (go2rtc has no SIGHUP)
//
// In-memory better-sqlite3 + Drizzle. Mocks all SSH + Protect IO. Module-
// scoped state in reconcile.ts is reset between tests via vi.resetModules().

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

// ────────────────────────────────────────────────────────────────────────────
// $env mock — must hoist before importing schema (which transitively imports
// db/client → which would otherwise try to read the real env).
// ────────────────────────────────────────────────────────────────────────────
vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — all IO surfaces of reconcile.ts.
// ────────────────────────────────────────────────────────────────────────────
const {
	memDbRef,
	mockConnectToProxmox,
	mockExecuteOnContainer,
	mockPushFileToContainer,
	mockDiscover,
	mockFetchBootstrap
} = vi.hoisted(() => ({
	memDbRef: {
		db: null as ReturnType<typeof drizzle> | null,
		sqlite: null as Database.Database | null
	},
	mockConnectToProxmox: vi.fn(),
	mockExecuteOnContainer: vi.fn(),
	mockPushFileToContainer: vi.fn(),
	mockDiscover: vi.fn(),
	mockFetchBootstrap: vi.fn()
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

// We mock `fetchBootstrap` (the network call) but keep the pure helpers
// (`normalizeMac`, `classifyKind`, `protectStreamUrl`, `TLS_SCHEME`) real
// for fidelity — this is a "partial mock" idiom from vitest.
vi.mock('$lib/server/services/protect-bridge', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/protect-bridge')>(
		'$lib/server/services/protect-bridge'
	);
	return {
		...actual,
		fetchBootstrap: mockFetchBootstrap
	};
});

import * as schema from '../../db/schema';
import { buildBridgeYaml, canonicalHash } from './yaml-builder';

// ────────────────────────────────────────────────────────────────────────────
// In-memory DDL — mirrors client.ts CREATE TABLE shape and includes every
// column reconcile.ts reads/writes via Drizzle.
// ────────────────────────────────────────────────────────────────────────────

function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');

	sqlite.exec(`
		CREATE TABLE cameras (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			vmid INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL,
			ip TEXT NOT NULL DEFAULT '',
			username TEXT NOT NULL DEFAULT '',
			password TEXT NOT NULL DEFAULT '',
			camera_type TEXT NOT NULL DEFAULT 'mobotix',
			stream_path TEXT NOT NULL DEFAULT '/stream0/mobotix.mjpeg',
			width INTEGER NOT NULL DEFAULT 1280,
			height INTEGER NOT NULL DEFAULT 720,
			fps INTEGER NOT NULL DEFAULT 20,
			bitrate INTEGER NOT NULL DEFAULT 2000,
			stream_name TEXT NOT NULL DEFAULT '',
			rtsp_url TEXT,
			container_ip TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			access_code TEXT,
			serial_number TEXT,
			model TEXT,
			print_state TEXT,
			stream_mode TEXT DEFAULT 'adaptive',
			rtsp_auth_enabled INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'managed',
			mac TEXT,
			external_id TEXT,
			hub_bridge_id INTEGER,
			manufacturer TEXT,
			model_name TEXT,
			kind TEXT NOT NULL DEFAULT 'unknown',
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
		CREATE TABLE events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			camera_id INTEGER,
			camera_name TEXT,
			event_type TEXT NOT NULL,
			severity TEXT NOT NULL DEFAULT 'info',
			message TEXT NOT NULL,
			source TEXT NOT NULL,
			timestamp TEXT NOT NULL DEFAULT (datetime('now'))
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
	`);

	memDbRef.sqlite = sqlite;
	memDbRef.db = drizzle(sqlite, { schema });
}

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

const BRIDGE_VMID = 2014;
const CARPORT_MAC = 'aabbccddee01';
const FRONTDOOR_MAC = 'aabbccddee02';
const CARPORT_RTSP_OLD = 'rtsps://192.168.3.1:7441/<TEST-TOKEN-CARPORT-OLD>?enableSrtp';
const CARPORT_RTSP_NEW = 'rtsps://192.168.3.1:7441/<TEST-TOKEN-CARPORT-NEW>?enableSrtp';

function seedBridge(opts: { lastDeployedYamlHash?: string | null; lastReconciledAt?: string | null } = {}) {
	memDbRef.sqlite!.prepare(
		`INSERT INTO protect_hub_bridges (vmid, hostname, container_ip, status, last_deployed_yaml_hash, last_reconciled_at)
		 VALUES (?, ?, ?, 'running', ?, ?)`
	).run(
		BRIDGE_VMID,
		'protect-hub',
		'192.168.3.244',
		opts.lastDeployedYamlHash ?? null,
		opts.lastReconciledAt ?? null
	);
	return memDbRef.sqlite!.prepare('SELECT id FROM protect_hub_bridges').get() as { id: number };
}

function seedCarport(opts: {
	kind?: 'first-party' | 'third-party';
	enableLoxone?: boolean;
	rtspUrl?: string;
} = {}) {
	memDbRef.sqlite!.prepare(
		`INSERT INTO cameras (name, mac, source, kind, stream_name)
		 VALUES (?, ?, 'external', ?, ?)`
	).run('Carport', CARPORT_MAC, opts.kind ?? 'first-party', `external_${CARPORT_MAC}`);
	const cam = memDbRef.sqlite!
		.prepare('SELECT id FROM cameras WHERE mac=?')
		.get(CARPORT_MAC) as { id: number };

	memDbRef.sqlite!.prepare(
		`INSERT INTO protect_stream_catalog (camera_id, quality, rtsp_url) VALUES (?, 'low', ?)`
	).run(cam.id, opts.rtspUrl ?? CARPORT_RTSP_OLD);

	if (opts.enableLoxone) {
		memDbRef.sqlite!.prepare(
			`INSERT INTO camera_outputs (camera_id, output_type, enabled) VALUES (?, 'loxone-mjpeg', 1)`
		).run(cam.id);
	}
	return cam.id;
}

function getLatestRunRow() {
	return memDbRef.sqlite!
		.prepare(
			'SELECT * FROM protect_hub_reconcile_runs ORDER BY id DESC LIMIT 1'
		)
		.get() as {
		id: number;
		reconcile_id: string;
		started_at: string;
		completed_at: string | null;
		status: string;
		hash_changed: number;
		deployed_yaml_hash: string | null;
		error: string | null;
	};
}

function countRunRows() {
	return (
		memDbRef.sqlite!
			.prepare('SELECT COUNT(*) as c FROM protect_hub_reconcile_runs')
			.get() as { c: number }
	).c;
}

function makeBootstrapResult(macs: string[] = [CARPORT_MAC]) {
	return {
		ok: true as const,
		cameras: macs.map((mac) => ({
			id: `protect-${mac}`,
			mac,
			name: `cam-${mac}`,
			isThirdPartyCamera: false,
			channels: []
			// minimal stub — only `mac` is actually read by softDeleteMissingCams
		})) as unknown as import('unifi-protect').ProtectCameraConfig[]
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Tests — module re-imported via vi.resetModules() in beforeEach so the
// module-scoped _inFlight / _dirty state is fresh each test.
// ────────────────────────────────────────────────────────────────────────────

let reconcile: typeof import('./reconcile').reconcile;
let isReconcilerBusy: typeof import('./reconcile').isReconcilerBusy;

describe('reconcile (Phase 21 Plan 03)', () => {
	beforeEach(async () => {
		// Flush any setImmediate-scheduled follow-ups left over from the
		// previous test's single-flight + dirty-flag interaction. Without
		// this, a late `reconcile()` from the prior test's old module
		// instance can land *after* clearAllMocks() and inflate the
		// mockDiscover call count of the next test by 1. Two awaits — the
		// follow-up itself may schedule another setImmediate inside its
		// finally block.
		await new Promise<void>((r) => setImmediate(r));
		await new Promise<void>((r) => setImmediate(r));

		vi.clearAllMocks();
		vi.resetModules();
		freshDb();

		// Default mocks: reconcile happy path.
		mockDiscover.mockResolvedValue({
			ok: true,
			insertedCams: 0,
			updatedCams: 0,
			insertedChannels: 0
		});
		mockFetchBootstrap.mockResolvedValue(makeBootstrapResult([CARPORT_MAC]));
		mockConnectToProxmox.mockResolvedValue({ dispose: vi.fn() } as never);
		// Default `stat` returns a mtime far enough in the past that the
		// fast-path will NOT skip — tests that need the no-op path override.
		mockExecuteOnContainer.mockResolvedValue({ stdout: '0\n', stderr: '', code: 0 });
		mockPushFileToContainer.mockResolvedValue(undefined);

		// Re-import after resetModules to get fresh module-scoped state.
		const mod = await import('./reconcile');
		reconcile = mod.reconcile;
		isReconcilerBusy = mod.isReconcilerBusy;
	});

	// ── HUB-RCN-04 ──────────────────────────────────────────────────────────
	it('re-extract URLs — calls discover() as Pass 1', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		await reconcile(bridge.id, 'tick');

		expect(mockDiscover).toHaveBeenCalledTimes(1);
	});

	// ── HUB-RCN-05 ──────────────────────────────────────────────────────────
	it('no-op skip — identical YAML produces no SSH push, status=no_op', async () => {
		// Build the YAML the production code would build, hash it, seed the
		// bridge with that hash so reconcile sees a hash match.
		seedCarport({ enableLoxone: true });
		const camRow = memDbRef.sqlite!
			.prepare('SELECT id, mac FROM cameras')
			.get() as { id: number; mac: string };
		const knownHash = canonicalHash(
			buildBridgeYaml(
				[
					{
						cameraId: camRow.id,
						mac: camRow.mac,
						outputType: 'loxone-mjpeg',
						rtspUrl: CARPORT_RTSP_OLD
					}
				],
				'00000000-0000-0000-0000-000000000000'
			)
		);
		const lastReconciledAt = new Date('2026-05-06T06:00:00Z').toISOString();
		const bridge = seedBridge({
			lastDeployedYamlHash: knownHash,
			lastReconciledAt
		});

		// Mtime within ±2s of lastReconciledAt → fast-path skips.
		const matchingMtime = Math.floor(Date.parse(lastReconciledAt) / 1000);
		mockExecuteOnContainer.mockResolvedValue({
			stdout: `${matchingMtime}\n`,
			stderr: '',
			code: 0
		});

		const result = await reconcile(bridge.id, 'tick');

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.status).toBe('no_op');
		expect(mockPushFileToContainer).not.toHaveBeenCalled();
		// stat is the only executeOnContainer call expected.
		const cmds = mockExecuteOnContainer.mock.calls.map((c) => c[2] as string);
		expect(cmds.some((c) => c.includes('stat -c'))).toBe(true);
		expect(cmds.some((c) => c.startsWith('mv '))).toBe(false);
		expect(cmds.some((c) => c.includes('systemctl'))).toBe(false);

		const run = getLatestRunRow();
		expect(run.status).toBe('no_op');
		expect(run.hash_changed).toBe(0);
		expect(run.deployed_yaml_hash).toBe(knownHash);
	});

	// ── HUB-RCN-06 ──────────────────────────────────────────────────────────
	it('single-flight — two simultaneous reconciles share the same Promise', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		// Make discover slow so the second call truly races into the in-flight check.
		let resolveDiscover!: () => void;
		mockDiscover.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveDiscover = () =>
						res({ ok: true, insertedCams: 0, updatedCams: 0, insertedChannels: 0 });
				})
		);

		const p1 = reconcile(bridge.id, 'tick');
		const p2 = reconcile(bridge.id, 'force');
		// Sanity: while in-flight, isReconcilerBusy() must be true (HUB-RCN-10).
		expect(isReconcilerBusy()).toBe(true);

		resolveDiscover();
		const [r1, r2] = await Promise.all([p1, p2]);

		// Both joiners resolved with the same result object (same Promise).
		expect(r1).toEqual(r2);
		// discover() called exactly once for the shared in-flight pass.
		expect(mockDiscover).toHaveBeenCalledTimes(1);
	});

	// ── HUB-RCN-08 dirty-flag follow-up ─────────────────────────────────────
	it('dirty-flag follow-up — concurrent trigger schedules ONE extra reconcile', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		let resolveDiscover!: () => void;
		mockDiscover.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveDiscover = () =>
						res({ ok: true, insertedCams: 0, updatedCams: 0, insertedChannels: 0 });
				})
		);
		// Second discover (the follow-up) resolves immediately.
		mockDiscover.mockResolvedValue({
			ok: true,
			insertedCams: 0,
			updatedCams: 0,
			insertedChannels: 0
		});

		const p1 = reconcile(bridge.id, 'tick');
		// Dirty trigger lands while p1 is in flight.
		const p2 = reconcile(bridge.id, 'force');

		resolveDiscover();
		await Promise.all([p1, p2]);
		// Flush the setImmediate-scheduled follow-up.
		await new Promise<void>((r) => setImmediate(r));
		// Wait one more microtask in case the follow-up's discover call is async.
		await new Promise<void>((r) => setImmediate(r));

		// 1 reconcile pass (shared by p1+p2) + 1 follow-up = 2 discover calls total.
		expect(mockDiscover).toHaveBeenCalledTimes(2);
		// Audit log: 2 rows total (one per reconcile pass).
		expect(countRunRows()).toBe(2);
	});

	// ── HUB-OUT-05 + HUB-RCN-08 ─────────────────────────────────────────────
	it('auto-add — first-party cam with no outputs → seeds Loxone-MJPEG enabled', async () => {
		const bridge = seedBridge();
		seedCarport({ kind: 'first-party' /* no outputs seeded */ });

		await reconcile(bridge.id, 'tick');

		const outputs = memDbRef.sqlite!
			.prepare('SELECT * FROM camera_outputs')
			.all() as Array<{ camera_id: number; output_type: string; enabled: number }>;
		expect(outputs).toHaveLength(1);
		expect(outputs[0].output_type).toBe('loxone-mjpeg');
		expect(outputs[0].enabled).toBe(1);

		// And the auto-add event is logged.
		const evs = memDbRef.sqlite!
			.prepare("SELECT * FROM events WHERE event_type='protect_hub_cam_added'")
			.all();
		expect(evs).toHaveLength(1);
	});

	it('auto-add — third-party cam → no outputs seeded', async () => {
		const bridge = seedBridge();
		seedCarport({ kind: 'third-party' });

		await reconcile(bridge.id, 'tick');

		const outputs = memDbRef.sqlite!
			.prepare('SELECT * FROM camera_outputs')
			.all();
		expect(outputs).toHaveLength(0);
	});

	// ── HUB-RCN-09 + CR-6 ───────────────────────────────────────────────────
	it("soft-delete — cam in DB but missing from bootstrap → source='external_archived'", async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });
		// Bootstrap returns a DIFFERENT mac → carport is missing → archived.
		mockFetchBootstrap.mockResolvedValue(makeBootstrapResult([FRONTDOOR_MAC]));

		await reconcile(bridge.id, 'tick');

		const cam = memDbRef.sqlite!
			.prepare('SELECT source FROM cameras WHERE mac=?')
			.get(CARPORT_MAC) as { source: string };
		expect(cam.source).toBe('external_archived');

		const evs = memDbRef.sqlite!
			.prepare("SELECT * FROM events WHERE event_type='protect_hub_cam_archived'")
			.all();
		expect(evs).toHaveLength(1);
	});

	// ── HUB-RCN-10 busy gate ────────────────────────────────────────────────
	it('busy gate — isReconcilerBusy() is true mid-reconcile, false after', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		expect(isReconcilerBusy()).toBe(false);

		let resolveDiscover!: () => void;
		mockDiscover.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveDiscover = () =>
						res({ ok: true, insertedCams: 0, updatedCams: 0, insertedChannels: 0 });
				})
		);

		const p = reconcile(bridge.id, 'tick');
		expect(isReconcilerBusy()).toBe(true);
		resolveDiscover();
		await p;
		expect(isReconcilerBusy()).toBe(false);
	});

	// ── P21-#11 mtime fast-path ─────────────────────────────────────────────
	it('mtime fast-path — within ±2s tolerance treats as no-op', async () => {
		seedCarport({ enableLoxone: true });
		const camRow = memDbRef.sqlite!
			.prepare('SELECT id, mac FROM cameras')
			.get() as { id: number; mac: string };
		const knownHash = canonicalHash(
			buildBridgeYaml(
				[
					{
						cameraId: camRow.id,
						mac: camRow.mac,
						outputType: 'loxone-mjpeg',
						rtspUrl: CARPORT_RTSP_OLD
					}
				],
				'00000000-0000-0000-0000-000000000000'
			)
		);
		const lastReconciledAt = new Date('2026-05-06T06:00:00Z').toISOString();
		const baseMtime = Math.floor(Date.parse(lastReconciledAt) / 1000);

		// All ±2s skews: skip
		for (const skew of [-2, -1, 0, 1, 2]) {
			vi.clearAllMocks();
			mockDiscover.mockResolvedValue({
				ok: true,
				insertedCams: 0,
				updatedCams: 0,
				insertedChannels: 0
			});
			mockFetchBootstrap.mockResolvedValue(makeBootstrapResult([CARPORT_MAC]));
			mockConnectToProxmox.mockResolvedValue({ dispose: vi.fn() } as never);
			mockExecuteOnContainer.mockResolvedValue({
				stdout: `${baseMtime + skew}\n`,
				stderr: '',
				code: 0
			});
			mockPushFileToContainer.mockResolvedValue(undefined);

			// Reset the bridge each pass.
			memDbRef.sqlite!.prepare('DELETE FROM protect_hub_bridges').run();
			const bridge = seedBridge({
				lastDeployedYamlHash: knownHash,
				lastReconciledAt
			});

			const result = await reconcile(bridge.id, 'tick');
			expect(result.ok && result.status).toBe('no_op');
			expect(mockPushFileToContainer).not.toHaveBeenCalled();
		}
	});

	it('mtime fast-path — skew > 2s → defensive re-deploy (push happens)', async () => {
		seedCarport({ enableLoxone: true });
		const camRow = memDbRef.sqlite!
			.prepare('SELECT id, mac FROM cameras')
			.get() as { id: number; mac: string };
		const knownHash = canonicalHash(
			buildBridgeYaml(
				[
					{
						cameraId: camRow.id,
						mac: camRow.mac,
						outputType: 'loxone-mjpeg',
						rtspUrl: CARPORT_RTSP_OLD
					}
				],
				'00000000-0000-0000-0000-000000000000'
			)
		);
		const lastReconciledAt = new Date('2026-05-06T06:00:00Z').toISOString();
		const baseMtime = Math.floor(Date.parse(lastReconciledAt) / 1000);
		mockExecuteOnContainer.mockResolvedValue({
			stdout: `${baseMtime + 5}\n`, // 5s skew → defensive re-deploy
			stderr: '',
			code: 0
		});
		const bridge = seedBridge({
			lastDeployedYamlHash: knownHash,
			lastReconciledAt
		});

		const result = await reconcile(bridge.id, 'tick');
		expect(result.ok).toBe(true);
		expect(mockPushFileToContainer).toHaveBeenCalledTimes(1);
		// Bridge hash unchanged (same content), so this is a defensive re-deploy.
		// Status is 'success' from reconcile.ts — we always push when not skipping.
		if (result.ok) expect(result.status).toBe('success');
	});

	// ── P21-#1 token rotation ───────────────────────────────────────────────
	it('token rotation — fresh tokens in URL → hash changes → SSH push happens', async () => {
		const bridge = seedBridge();
		const camId = seedCarport({ enableLoxone: true, rtspUrl: CARPORT_RTSP_OLD });

		// First reconcile — pushes the OLD-token YAML.
		await reconcile(bridge.id, 'tick');
		expect(mockPushFileToContainer).toHaveBeenCalledTimes(1);
		const firstHash = (
			memDbRef.sqlite!
				.prepare('SELECT last_deployed_yaml_hash FROM protect_hub_bridges')
				.get() as { last_deployed_yaml_hash: string }
		).last_deployed_yaml_hash;

		// Simulate UDM reboot: discover() updated the catalog with a new token.
		memDbRef.sqlite!
			.prepare('UPDATE protect_stream_catalog SET rtsp_url=? WHERE camera_id=?')
			.run(CARPORT_RTSP_NEW, camId);

		// Second reconcile — must push again with the NEW token.
		await reconcile(bridge.id, 'tick');
		expect(mockPushFileToContainer).toHaveBeenCalledTimes(2);
		const secondHash = (
			memDbRef.sqlite!
				.prepare('SELECT last_deployed_yaml_hash FROM protect_hub_bridges')
				.get() as { last_deployed_yaml_hash: string }
		).last_deployed_yaml_hash;
		expect(firstHash).not.toBe(secondHash);
	});

	// ── D-CAP-04 bridge unreachable ─────────────────────────────────────────
	it('bridge-unreachable — SSH dial fail → status=bridge_unreachable, no retry', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });
		mockConnectToProxmox.mockRejectedValue(new Error('connect ETIMEDOUT 192.168.3.1:22'));

		const result = await reconcile(bridge.id, 'tick');

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.status).toBe('bridge_unreachable');
		expect(mockPushFileToContainer).not.toHaveBeenCalled();

		const run = getLatestRunRow();
		expect(run.status).toBe('bridge_unreachable');
		expect(run.error).toContain('ETIMEDOUT');
	});

	// ── CR-1 + CR-3 atomic deploy order ─────────────────────────────────────
	it('atomic deploy — push to .tmp.<id> then mv then systemctl restart (NOT reload-or-restart)', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		const result = await reconcile(bridge.id, 'tick');
		expect(result.ok).toBe(true);

		expect(mockPushFileToContainer).toHaveBeenCalledTimes(1);
		const pushArgs = mockPushFileToContainer.mock.calls[0];
		// Args: (ssh, vmid, content, remotePath)
		expect(pushArgs[1]).toBe(BRIDGE_VMID);
		expect(pushArgs[3]).toMatch(
			/^\/etc\/go2rtc\/go2rtc\.yaml\.tmp\.[0-9a-f-]{36}$/
		);

		// Find call indices.
		const pushOrder = mockPushFileToContainer.mock.invocationCallOrder[0];
		const execCalls = mockExecuteOnContainer.mock.calls;
		const execOrders = mockExecuteOnContainer.mock.invocationCallOrder;

		const mvIdx = execCalls.findIndex(
			(c) => typeof c[2] === 'string' && (c[2] as string).startsWith('mv ')
		);
		const restartIdx = execCalls.findIndex(
			(c) =>
				typeof c[2] === 'string' &&
				(c[2] as string).includes('systemctl restart go2rtc')
		);
		expect(mvIdx).toBeGreaterThanOrEqual(0);
		expect(restartIdx).toBeGreaterThanOrEqual(0);

		expect(pushOrder).toBeLessThan(execOrders[mvIdx]);
		expect(execOrders[mvIdx]).toBeLessThan(execOrders[restartIdx]);

		// CR-3: never use `reload-or-restart` — go2rtc has no SIGHUP.
		expect(
			execCalls.some(
				(c) =>
					typeof c[2] === 'string' && (c[2] as string).includes('reload-or-restart')
			)
		).toBe(false);

		// And the mv arg must rename FROM the same .tmp.<reconcileId> we pushed TO.
		const tmpPath = pushArgs[3] as string;
		const mvCmd = execCalls[mvIdx][2] as string;
		expect(mvCmd).toBe(`mv ${tmpPath} /etc/go2rtc/go2rtc.yaml`);
	});

	// ── T-21-05 audit invariants ────────────────────────────────────────────
	it('audit log — every reconcile pass creates exactly 1 row', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		const before = countRunRows();
		await reconcile(bridge.id, 'tick');
		const after = countRunRows();

		expect(after - before).toBe(1);
	});

	it('audit log — successful reconcile updates row from running→success with hash', async () => {
		const bridge = seedBridge();
		seedCarport({ enableLoxone: true });

		const result = await reconcile(bridge.id, 'tick');
		expect(result.ok).toBe(true);

		const run = getLatestRunRow();
		expect(run.status).toBe('success');
		expect(run.hash_changed).toBe(1);
		expect(run.deployed_yaml_hash).toBeTruthy();
		expect(run.completed_at).toBeTruthy();
		expect(run.error).toBeNull();
		if (result.ok && result.status === 'success') {
			expect(run.deployed_yaml_hash).toBe(result.newHash);
		}
	});
});
