# Phase 21: Multi-Cam YAML + Reconciliation Loop — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 13 (8 NEW + 5 MODIFIED)
**Analogs found:** 13 / 13 (every new file maps to an existing in-tree analog; no out-of-codebase guesswork required)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/server/orchestration/protect-hub/yaml-builder.ts` (NEW) | service (pure builder) | transform: `OutputRow[] + reconcileId → string` | `src/lib/server/services/go2rtc.ts:42-72` (`generateGo2rtcConfig`) + `:130-158` (`generateGo2rtcConfigLoxone`) + `:505-527` (`generateBridgeConfig`) | role-match (string-template emitter) — but uses `yaml.stringify` instead of template literals (per L-29 + Pattern 2 in RESEARCH.md) |
| `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` (NEW) | test (pure unit, golden-file) | inputs → fixture comparison | `src/lib/server/services/go2rtc.test.ts:21-77` | exact (same `generate*` shape, just multi-stream) |
| `src/lib/server/orchestration/protect-hub/reconcile.ts` (NEW) | orchestrator | event-driven + request-response: `bridgeId → DB writes + SSH push` | `src/lib/server/orchestration/protect-hub/catalog.ts` (discover envelope) + `bridge-provision.ts:74-195` (SSH connect/dispose) + `update-runner.ts:139-194` (run-row insert/update + state machine) | best match by composing 3 analogs: catalog gives the discover-then-write pattern, bridge-provision gives the SSH envelope, update-runner gives the runs-table state pattern |
| `src/lib/server/orchestration/protect-hub/reconcile.test.ts` (NEW) | test (orchestrator) | mocked SSH/discover → assert on DB rows | `src/lib/server/orchestration/protect-hub/bridge-provision.test.ts` (most relevant — same in-mem DB + hoisted SSH mocks) + `catalog.test.ts:54-144` (in-mem DDL fixture) | exact (this is the same testing recipe; just adds `protect_hub_reconcile_runs` to the in-memory DDL block) |
| `src/lib/server/orchestration/protect-hub/ws-manager.ts` (NEW) | service (singleton with state) | event-driven: WS disconnect → backoff → reconnect → trigger reconcile | `src/lib/server/services/update-checker.ts:189-219` (singleton interval start/stop with idempotent guard) + `src/lib/server/services/protect-bridge.ts:35-63` (lib client singleton + reset) + `src/lib/server/services/bambu-mqtt.ts` (per CLAUDE.md: precedent for backoff in v1.2) | role-match (singleton with start/stop + backoff); no exact prior example of WS-with-exp-backoff, so synthesise from these three |
| `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` (NEW) | test (fake-timers) | `vi.useFakeTimers()` + `advanceTimersByTime` | `src/lib/server/services/host-metrics.test.ts:112-135` (only existing fake-timer use in repo) | partial (rare pattern in this repo; reuse the `useFakeTimers/setSystemTime` shape) |
| `src/routes/api/protect-hub/reconcile/+server.ts` (NEW) | API endpoint (POST + GET) | request-response: 202+id (POST) / GET status | `src/routes/api/protect-hub/discover/+server.ts` (POST envelope with `result.ok` switch) + `src/routes/api/update/run/+server.ts` (run-spawn pattern returning ids) | exact (POST shape) + role-match (GET shape — uses `getStateSnapshot` analog) |
| `src/routes/api/protect-hub/reconcile/server.test.ts` (NEW) | test (route handler) | mocked reconcile module → assert response shape | `src/routes/api/cameras/[id]/a1-snapshot/server.test.ts:1-90` | exact (same `vi.mock('$env/dynamic/private')` + import-`{POST,GET}`-from-`./+server` recipe) |
| `src/routes/api/cameras/[id]/outputs/+server.ts` (NEW) | API endpoint (PUT) | request-response: validate cap + DB write + force-reconcile | `src/routes/api/cameras/[id]/rename/+server.ts` (PUT envelope, drizzle update, dispose-on-finally) + RESEARCH §"Code Examples" Example 3 (cap counting query) | role-match (PUT envelope) — extends with cap counting and reconcile fan-out |
| `src/routes/api/cameras/[id]/outputs/server.test.ts` (NEW) | test (route handler) | mock cap counts + reconcile → assert 422/200 + reconcile called | `src/routes/api/cameras/[id]/a1-snapshot/server.test.ts` | exact (same recipe, plus mock the new `reconcile` module) |
| `src/lib/server/db/schema.ts` (MODIFIED) | schema | drizzle table addition | `schema.ts:201-218` (`updateRuns` table — exemplar per D-RCN-04) | exact (clone the shape, rename columns, drop irrelevant ones) |
| `src/lib/server/db/client.ts` (MODIFIED) | schema migration | `CREATE TABLE IF NOT EXISTS` block + index | `client.ts:114-132` (`update_runs` table + index pattern) | exact (literal mirror) |
| `src/lib/server/services/scheduler.ts` (MODIFIED) | service (interval lifecycle) | timer tick → side effects | `scheduler.ts:71-165` (existing `healthCheckInterval` — extend) + `:18-69` (`logScanInterval` shape — model for new `protectHubReconcileInterval`) | exact (extend existing block + clone the interval-management pattern) |
| `src/lib/server/services/update-checker.ts` (MODIFIED) | service (busy-gate aggregator) | DB read → conflict array | `update-checker.ts:50-69` (`getActiveFlowConflicts()` — extend per CR-4) | exact (4-line extension) |
| `src/hooks.server.ts` (POTENTIALLY MODIFIED — see L-14) | bootstrap (process lifecycle) | SIGTERM handler | `hooks.server.ts:31-36` (current shutdown handler) | partial — current handler exits immediately; P21 may need to wait briefly on `isReconcilerBusy()` before `process.exit(0)` |

---

## Pattern Assignments

### `src/lib/server/orchestration/protect-hub/yaml-builder.ts` (NEW — service, transform)

**Primary analog:** `src/lib/server/services/go2rtc.ts:505-527` (`generateBridgeConfig` — already emits the bridge YAML stamp + structure that yaml-builder must extend with multi-stream blocks).

**Secondary analog:** `src/lib/server/services/go2rtc.ts:130-158` (`generateGo2rtcConfigLoxone` — exemplar of the ffmpeg query-string suffix pattern that D-PIPE-02 mirrors).

**Stamp + structure to extend** (`go2rtc.ts:510-527`):
```typescript
export function generateBridgeConfig(): string {
	const reconcileId = crypto.randomUUID();
	const ts = new Date().toISOString();
	return `# managed by ip-cam-master, reconcile-id ${reconcileId}, ts ${ts}
api:
  listen: "0.0.0.0:1984"
  ui_editor: false

streams:
  test: exec:ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=10 -c:v libx264 -f rtsp {output}

ffmpeg:
  bin: ffmpeg

log:
  level: info
`;
}
```

**Differences from analog:**
- `reconcileId` becomes a parameter (caller-supplied so it correlates with the `protect_hub_reconcile_runs` row), not generated inside.
- `streams:` block emitted via `yaml.stringify(config, { sortMapEntries: true })` instead of template literal (per D-RCN-01 + Pattern 2 — needed so canonical-form sha256 is stable).
- ffmpeg query-string suffix per output type follows D-PIPE-02 (Loxone-MJPEG) and D-PIPE-04 (Frigate-RTSP) verbatim. Reuse the `#raw=...` suffix pattern from `generateGo2rtcConfigLoxone:144`:
```typescript
const vaapiBase = `#video=h264#raw=-r ${cappedFps}#raw=-g ${cappedFps}#hardware=vaapi#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 5`;
```
- Source URL is read straight from `protectStreamCatalog.rtspUrl` (already `rtsps://` per CR-2) — NO rewrite needed.
- Slug pattern is `<mac-slug>-low|high` (D-PIPE-06); MAC normalisation already handled by `normalizeMac()` in `protect-bridge.ts:129`.

**Canonical-hash helper** (per Pattern 2 in RESEARCH.md §"Pattern 2"):
```typescript
import { stringify, parse } from 'yaml';
import { createHash } from 'node:crypto';
export const STAMP_REGEX = /^# managed by ip-cam-master, reconcile-id [^\n]+\n/;
export function canonicalHash(yamlText: string): string {
	const stripped = yamlText.replace(STAMP_REGEX, '');
	const parsed = parse(stripped);
	const canonical = stringify(parsed, { sortMapEntries: true });
	return createHash('sha256').update(canonical).digest('hex');
}
```

---

### `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` (NEW — test, pure unit/golden)

**Analog:** `src/lib/server/services/go2rtc.test.ts:1-77`

**Imports + describe shape to mirror** (`go2rtc.test.ts:1-29`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

vi.mock('$lib/server/db/client', () => ({ db: {} }));
vi.mock('$lib/server/db/schema', () => ({
	settings: {}, containers: {}, cameras: {}
}));

import { generateGo2rtcConfig, generateSystemdUnit, getInstallCommands } from './go2rtc';

describe('go2rtc service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});
```

**Assertion style to mirror** (`go2rtc.test.ts:38-60`):
```typescript
expect(yaml).toContain('cam-200:');
expect(yaml).toContain('#width=1280');
expect(yaml).toContain('#hardware=vaapi');
```

**Differences from analog:**
- The yaml-builder is pure — no DB mocks needed beyond the standard `$env/dynamic/private` boilerplate.
- Add `canonicalHash` golden tests per Pitfall §P21-#5 (`go2rtc.test.ts` does not exercise hashing).
- Test slug stability via fixture pairs: same MAC + different cam name → identical YAML (per HUB-OUT-06).

---

### `src/lib/server/orchestration/protect-hub/reconcile.ts` (NEW — orchestrator)

**Three composed analogs:**

**Analog A — discover/loadCatalog envelope** (`catalog.ts:38-157` — Pass-1 reuse for URL re-extraction per D-RCN-05):
```typescript
export async function discover(): Promise<DiscoverResult> {
	const result = await fetchBootstrap();
	if (!result.ok) {
		return { ok: false, reason: result.reason, error: result.error };
	}
	let insertedCams = 0;
	let updatedCams = 0;
	let insertedChannels = 0;
	try {
		const runUpsert = sqlite.transaction(() => { /* ... */ });
		runUpsert();
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		return { ok: false, reason: 'unknown', error: e };
	}
	return { ok: true, insertedCams, updatedCams, insertedChannels };
}
```
Use this exact "tagged Result + try/catch + transaction" envelope.

**Analog B — SSH connect/execute/dispose** (`bridge-provision.ts:74-195`):
```typescript
const ssh = await connectToProxmox();
try {
	// ... operations using executeOnContainer + pushFileToContainer ...
	await pushFileToContainer(ssh, vmid, config, '/etc/go2rtc/go2rtc.yaml');
	await executeOnContainer(
		ssh,
		vmid,
		'systemctl daemon-reload && systemctl enable go2rtc && systemctl restart go2rtc'
	);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	// ... error path ...
} finally {
	ssh.dispose();
}
```
Use this connect/try-finally/dispose envelope. **Per CR-1 (Recommendation: option 2):** wrap `pushFileToContainer` with tmp+rename inside reconcile.ts — push to `/etc/go2rtc/go2rtc.yaml.tmp.<reconcileId>`, then `executeOnContainer(ssh, vmid, 'mv /etc/go2rtc/go2rtc.yaml.tmp.<id> /etc/go2rtc/go2rtc.yaml')`. **Per CR-3:** use `systemctl restart go2rtc` (NOT `reload-or-restart`).

**Analog C — runs-table state machine** (`update-runner.ts:139-194` — pattern for `protect_hub_reconcile_runs` insert/update lifecycle):
```typescript
// At spawn time: write metadata row for in-flight tracking
writeUpdateState({
	updateStatus: 'installing',
	targetSha,
	updateStartedAt: startedAt
});
// Best-effort settings write so the next tick respects 23h spacing.
try {
	const { saveSetting } = await import('./settings');
	await saveSetting('update.lastAutoUpdateAt', String(now.getTime()));
} catch {
	/* tolerate */
}
```
For P21 the pattern is RESEARCH §Example 2 (already concrete):
```typescript
db.insert(protectHubReconcileRuns).values({
	reconcileId, startedAt, status: 'running', hashChanged: false
}).run();
try {
	const result = await /* ... pass 1-4 ... */;
	db.update(protectHubReconcileRuns)
		.set({ completedAt: new Date().toISOString(), status: result.status,
			hashChanged: result.hashChanged, deployedYamlHash: result.newHash ?? null })
		.where(eq(protectHubReconcileRuns.reconcileId, reconcileId))
		.run();
	return result;
} catch (err) {
	db.update(protectHubReconcileRuns)
		.set({ completedAt: new Date().toISOString(), status: 'error',
			error: err instanceof Error ? err.message : String(err) })
		.where(eq(protectHubReconcileRuns.reconcileId, reconcileId))
		.run();
	throw err;
}
```

**Single-flight + dirty-flag pattern** (RESEARCH §Pattern 1 — copy verbatim):
```typescript
let _inFlight: Promise<ReconcileResult> | null = null;
let _dirty = false;
export function isReconcilerBusy(): boolean { return _inFlight !== null; }
export async function reconcile(bridgeId, reason) {
	if (_inFlight) { _dirty = true; return _inFlight; }
	const reconcileId = crypto.randomUUID();
	_inFlight = doReconcile(bridgeId, reconcileId, reason);
	try { return await _inFlight; }
	finally {
		_inFlight = null;
		if (_dirty) {
			_dirty = false;
			setImmediate(() => reconcile(bridgeId, 'tick').catch(() => {}));
		}
	}
}
```

---

### `src/lib/server/orchestration/protect-hub/reconcile.test.ts` (NEW — test, orchestrator)

**Primary analog:** `src/lib/server/orchestration/protect-hub/bridge-provision.test.ts:1-321` (closest in-repo example: in-memory better-sqlite3 + Drizzle + hoisted SSH mocks + the `freshDb()` DDL block).

**Imports + hoisted-mocks shape to mirror** (`bridge-provision.test.ts:1-75`):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const {
	memDbRef,
	mockGetNextVmid,
	mockConnectToProxmox,
	mockExecuteOnContainer,
	mockPushFileToContainer,
	/* ... */
} = vi.hoisted(() => ({
	memDbRef: {
		db: null as ReturnType<typeof drizzle> | null,
		sqlite: null as Database.Database | null
	},
	mockConnectToProxmox: vi.fn(),
	mockExecuteOnContainer: vi.fn(),
	mockPushFileToContainer: vi.fn(),
	/* ... */
}));

vi.mock('$lib/server/db/client', () => ({
	get db() { return memDbRef.db; },
	get sqlite() { return memDbRef.sqlite; },
	DB_ABS_PATH: ':memory:'
}));

vi.mock('$lib/server/services/ssh', () => ({
	connectToProxmox: mockConnectToProxmox,
	executeOnContainer: mockExecuteOnContainer,
	pushFileToContainer: mockPushFileToContainer,
	waitForContainerReady: mockWaitForContainerReady
}));
```

**`freshDb()` DDL block to mirror** (`bridge-provision.test.ts:79-115`) — extend with the new `protect_hub_reconcile_runs` table per Wave-0 chore in VALIDATION.md:
```typescript
function freshDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`
		CREATE TABLE protect_hub_bridges (...);
	`);
	// NEW for P21:
	sqlite.exec(`
		CREATE TABLE protect_hub_reconcile_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			reconcile_id TEXT NOT NULL,
			started_at TEXT NOT NULL,
			completed_at TEXT,
			status TEXT NOT NULL,
			hash_changed INTEGER NOT NULL DEFAULT 0,
			deployed_yaml_hash TEXT,
			error TEXT
		);
	`);
	memDbRef.sqlite = sqlite;
	memDbRef.db = drizzle(sqlite, { schema });
}
```

**Catalog test fixtures already shipped** (`catalog.test.ts:42-46` — re-use these):
```typescript
import firstPartyFixture from '../../services/__fixtures__/protect-bootstrap-first-party-3-channel.json' with { type: 'json' };
import singleChannelFixture from '../../services/__fixtures__/protect-bootstrap-third-party-1-channel.json' with { type: 'json' };
```

**Single-flight assertion pattern** (RESEARCH §Pitfall P21-#6 — copy verbatim into reconcile.test.ts).

---

### `src/lib/server/orchestration/protect-hub/ws-manager.ts` (NEW — singleton with state)

**Analog A — singleton start/stop with idempotent guard** (`update-checker.ts:189-219`):
```typescript
let checkTimer: ReturnType<typeof setInterval> | null = null;
let autoUpdateTimer: ReturnType<typeof setInterval> | null = null;

export function startUpdateChecker(): void {
	if (checkTimer === null) {
		setTimeout(() => { performScheduledCheck(); }, 30_000);
		checkTimer = setInterval(performScheduledCheck, CHECK_INTERVAL_MS);
	}
	if (autoUpdateTimer === null) {
		autoUpdateTimer = setInterval(() => {
			maybeAutoUpdate().catch((err) =>
				console.error('[update-checker] auto-update tick failed:', err)
			);
		}, AUTO_UPDATE_TICK_MS);
	}
}

export function stopUpdateChecker(): void {
	if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
	if (autoUpdateTimer) { clearInterval(autoUpdateTimer); autoUpdateTimer = null; }
}
```
Use the `null-check guard + clear-on-stop + null-out` shape verbatim for `_reconnectingPromise` and `_attempt` state.

**Analog B — lib client singleton with reset** (`protect-bridge.ts:35-63`):
```typescript
let _client: ProtectApi | null = null;
let _loginExpiresAt = 0;
const LOGIN_TTL_MS = 8 * 60 * 1000;

export async function getProtectClient(): Promise<ProtectApi> {
	if (_client && Date.now() < _loginExpiresAt) return _client;
	/* ... establish, set _client, return ... */
}

export function resetProtectClient(): void {
	_client = null;
	_loginExpiresAt = 0;
}
```
ws-manager.ts MUST call `resetProtectClient()` from `stopWs()` per RESEARCH §Pattern 4 commentary.

**Backoff state machine** (RESEARCH §Pattern 4 — copy verbatim):
```typescript
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000];
let _attempt = 0;
let _reconnectingPromise: Promise<void> | null = null;
let _stopped = false;
function scheduleReconnect(): void { /* ... */ }
```

**Differences from analogs:**
- Adds `BACKOFF_SCHEDULE_MS` constant + `_attempt` counter (no precedent in repo for exponential backoff — copy from RESEARCH §Pattern 4).
- On successful (re)connect, fires `reconcile(bridgeId, 'ws_reconnect')` — wires ws-manager → reconcile (one-way; reconcile must not import ws-manager to avoid cycles).

---

### `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` (NEW — fake-timers test)

**Analog:** `src/lib/server/services/host-metrics.test.ts:112-135` (only existing fake-timer test in repo).

**Fake-timer setup pattern to mirror** (`host-metrics.test.ts:114-115`):
```typescript
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-04-10T13:00:00Z'));
```

**Differences from analog:**
- Use `vi.advanceTimersByTime(5_000)` to step through the backoff schedule (analog only uses `setSystemTime` once for uptime calc).
- Mock `getProtectClient()` and the lib's `client.getBootstrap()` to control the success/failure sequence.
- Assert call count of `reconcile()` (1× per successful (re)connect, never on failure).

**Test cases** per HUB-RCN-07:
1. After 1st `getBootstrap` failure, next attempt is at `+5_000ms`.
2. After 2nd failure, next attempt is at `+10_000ms`.
3. After 6th failure, attempts cap at `+300_000ms` (5min).
4. On success, `_attempt` resets to 0 AND `reconcile(bridgeId, 'ws_reconnect')` is called exactly once.
5. `stopWs()` cancels in-flight backoff (no further reconnect after stop).

---

### `src/routes/api/protect-hub/reconcile/+server.ts` (NEW — POST 202+id, GET status)

**POST analog:** `src/routes/api/protect-hub/discover/+server.ts:1-38` (closest sibling endpoint — same auth-gating model, same `result.ok` switch):
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { discover } from '$lib/server/orchestration/protect-hub/catalog';

export const POST: RequestHandler = async () => {
	try {
		const result = await discover();
		if (!result.ok) {
			const status = result.reason === 'controller_unreachable' ? 503
				: result.reason === 'auth_failed' ? 401 : 500;
			return json({ ok: false, reason: result.reason, error: result.error.message }, { status });
		}
		return json({ ok: true, /* ... */ });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ ok: false, error: message }, { status: 500 });
	}
};
```

**Differences from analog (per D-API-01):**
- POST returns 202 + `{ reconcileId }` immediately (NOT awaiting reconcile completion):
```typescript
export const POST: RequestHandler = async () => {
	const reconcileId = crypto.randomUUID();
	// Fire-and-forget; reconcile.ts manages single-flight internally
	void reconcile(getBridgeId(), 'force').catch((err) =>
		console.error('[reconcile] background reconcile failed:', err)
	);
	return json({ ok: true, reconcileId }, { status: 202 });
};
```
- GET `?reconcileId=…` queries `protect_hub_reconcile_runs` and returns the row (drizzle select-by-eq + json):
```typescript
export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('reconcileId');
	if (!id) return json({ ok: false, error: 'reconcileId required' }, { status: 400 });
	const row = db.select().from(protectHubReconcileRuns)
		.where(eq(protectHubReconcileRuns.reconcileId, id)).get();
	if (!row) return json({ ok: false, error: 'not found' }, { status: 404 });
	return json({ ok: true, run: row });
};
```

---

### `src/routes/api/protect-hub/reconcile/server.test.ts` (NEW — route handler test)

**Analog:** `src/routes/api/cameras/[id]/a1-snapshot/server.test.ts:1-90`

**Mock + import shape to mirror** (`a1-snapshot/server.test.ts:1-30`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const selectGet = vi.fn();
vi.mock('$lib/server/db/client', () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ get: selectGet }) }) }) }
}));
vi.mock('$lib/server/db/schema', () => ({ cameras: {} }));

import { GET } from './+server';

const call = async (id = '1'): Promise<Response> => await (GET({ params: { id } } as any) as Promise<Response>);
```

**For reconcile/server.test.ts, also mock the `reconcile` module:**
```typescript
const mockReconcile = vi.fn();
vi.mock('$lib/server/orchestration/protect-hub/reconcile', () => ({
	reconcile: mockReconcile,
	isReconcilerBusy: vi.fn(),
}));
```

**Test cases** (HUB-RCN-03): POST returns `{ ok: true, reconcileId }` with status 202; GET 400 on missing reconcileId; GET 404 on unknown id; GET 200 + run row on hit.

---

### `src/routes/api/cameras/[id]/outputs/+server.ts` (NEW — PUT)

**Primary analog:** `src/routes/api/cameras/[id]/rename/+server.ts:1-34` (PUT envelope, drizzle update):
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ params, request }) => {
	const cameraId = parseInt(params.id);
	const { name } = await request.json();
	if (!name) return json({ success: false, error: 'Name erforderlich' }, { status: 400 });
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;
	if (!camera) return json({ success: false, error: 'Kamera nicht gefunden' }, { status: 404 });
	db.update(cameras).set({ name, updatedAt: new Date().toISOString() })
		.where(eq(cameras.id, cameraId)).run();
	return json({ success: true });
};
```

**Cap counting + force-reconcile fan-out** (RESEARCH §Code Examples Example 3 — copy verbatim, adapted to use the shipped `storeEvent` from `events.ts:6-38`):
```typescript
const VAAPI_HARD_CAP = 6;
const currentMjpegCount = db.select({ n: sql<number>`count(*)` })
	.from(cameraOutputs)
	.where(and(
		eq(cameraOutputs.outputType, 'loxone-mjpeg'),
		eq(cameraOutputs.enabled, true),
		sql`${cameraOutputs.cameraId} != ${camId}`,
	)).get()?.n ?? 0;
/* ... */
if (projectedTotal > VAAPI_HARD_CAP) {
	return json({ ok: false, reason: 'vaapi_hard_cap_exceeded',
		message: `Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: ${projectedTotal}.`
	}, { status: 422 });
}
/* ... delete + insert outputs ... */
void reconcile(getBridgeId(), 'output_toggle').catch(/* ... */);
return json({ ok: true });
```

**Event emission** uses the shipped `storeEvent` helper at `src/lib/server/services/events.ts:6-38`:
```typescript
storeEvent({
	cameraId: null,
	cameraName: 'Protect Hub',
	eventType: 'vaapi_soft_cap_warning',
	severity: 'info',
	message: `${projectedTotal} von 4 Transkodierungen aktiv (Soft-Cap erreicht).`,
	source: 'protect_hub',
	timestamp: new Date().toISOString(),
});
```
NOTE: `eventType` is open-ended in the schema (`schema.ts:117`); no enum extension needed.

---

### `src/routes/api/cameras/[id]/outputs/server.test.ts` (NEW — route handler test)

**Analog:** Same as reconcile/server.test.ts → `cameras/[id]/a1-snapshot/server.test.ts`.

**Additional mocks needed:** `reconcile` module, `storeEvent` (from `events.ts`).

**Test cases:**
- HUB-OUT-01: PUT body `{outputs: [{outputType: 'loxone-mjpeg', enabled: true}]}` → 200 + `cameraOutputs` row written.
- HUB-OUT-04: existing `cameraOutputs` count = 6 + new request adds another → 422 with reason `vaapi_hard_cap_exceeded`.
- HUB-RCN-02: any successful PUT → `mockReconcile` called once with `(bridgeId, 'output_toggle')`.

---

### `src/lib/server/db/schema.ts` (MODIFIED — add `protectHubReconcileRuns` table)

**Analog:** `schema.ts:201-218` (`updateRuns` table — exemplar per D-RCN-04, "mirrors `update_runs` from P24").

**Mirror this exact shape**:
```typescript
export type UpdateRunStatus = 'running' | 'success' | 'failed' | 'rolled_back';
export type UpdateRunTrigger = 'manual' | 'auto';

export const updateRuns = sqliteTable('update_runs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	startedAt: text('started_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	finishedAt: text('finished_at'),
	preSha: text('pre_sha'),
	postSha: text('post_sha'),
	targetSha: text('target_sha'),
	status: text('status').notNull().default('running'),
	stage: text('stage'),
	errorMessage: text('error_message'),
	rollbackStage: text('rollback_stage'),
	unitName: text('unit_name'),
	logPath: text('log_path'),
	backupPath: text('backup_path'),
	trigger: text('trigger').notNull().default('manual')
});
```

**P21 column mapping per D-RCN-04:**
```typescript
export type ReconcileRunStatus = 'running' | 'success' | 'no_op' | 'bridge_unreachable' | 'error';

export const protectHubReconcileRuns = sqliteTable('protect_hub_reconcile_runs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	reconcileId: text('reconcile_id').notNull(),
	startedAt: text('started_at').notNull().$defaultFn(() => new Date().toISOString()),
	completedAt: text('completed_at'),
	status: text('status').notNull().default('running'),
	hashChanged: integer('hash_changed', { mode: 'boolean' }).notNull().default(false),
	deployedYamlHash: text('deployed_yaml_hash'),
	error: text('error')
});
```

---

### `src/lib/server/db/client.ts` (MODIFIED — add `CREATE TABLE` + index)

**Analog:** `client.ts:114-132` (`update_runs` CREATE block + index — literal mirror per RESEARCH §"Component Responsibilities").

**Mirror this exact pattern:**
```typescript
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
```

**P21 addition:**
```typescript
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
```

---

### `src/lib/server/services/scheduler.ts` (MODIFIED — extend healthCheckInterval + add protectHubReconcileInterval)

**Analog A — interval declaration + idempotent start** (`scheduler.ts:12-16, 18-69`):
```typescript
let logScanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let protectPollInterval: ReturnType<typeof setInterval> | null = null;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateLogCleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
	if (!logScanInterval) {
		logScanInterval = setInterval(async () => {
			try {
				const settings = await getSettings('unifi_');
				if (!settings.unifi_host) return;
				/* ... */
			} catch (err) {
				console.error('[scheduler] SSH log scan failed:', (err as Error).message);
			}
		}, 60_000);
	}
	/* ... */
}
```
Add `protectHubReconcileInterval` next to these declarations; mirror the `if (!x) { x = setInterval(...) }` pattern. Gate on `getSetting('protect_hub_enabled') === 'true'` per RESEARCH §"Open Question 3" recommendation.

**Analog B — bridge health probe (already shipped)** (`scheduler.ts:138-160`):
```typescript
// Bridge health probe (HUB-BRG-08)
const bridge = db.select().from(protectHubBridges).get();
if (bridge && bridge.status === 'running' && bridge.containerIp) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		await fetch(`http://${bridge.containerIp}:1984/api/streams`, { signal: controller.signal });
		clearTimeout(timeout);
		db.update(protectHubBridges)
			.set({ lastHealthCheckAt: new Date().toISOString() })
			.where(eq(protectHubBridges.id, bridge.id))
			.run();
	} catch {
		storeHealthEvent(0, 'Protect Hub Bridge', `go2rtc unreachable on ${bridge.containerIp}:1984`, 'warning');
	}
}
```

**Differences from analog (per D-CAP-03 + HUB-OPS-05):**
- Add a 2-strike threshold (currently fires immediately on first failure):
  - Hold a module-scoped counter `let bridgeFailureCount = 0;`
  - On success: reset counter + ensure `protectHubBridges.status === 'running'`.
  - On failure: increment; if `>= 2`, update `status='unhealthy'` and emit event.
- Recovery: single success → status back to `running`.

**stopScheduler analog** (`scheduler.ts:195-217`) — extend with the new interval clear.

---

### `src/lib/server/services/update-checker.ts` (MODIFIED — extend getActiveFlowConflicts per CR-4)

**Analog:** `update-checker.ts:50-69` (literally the function being extended):
```typescript
export function getActiveFlowConflicts(): Array<{
	kind: 'hub_starting' | 'hub_stopping';
	detail: string;
}> {
	const conflicts: Array<{ kind: 'hub_starting' | 'hub_stopping'; detail: string }> = [];
	try {
		const bridge = db.select().from(protectHubBridges).get();
		if (bridge?.status === 'starting' || bridge?.status === 'stopping') {
			conflicts.push({
				kind: bridge.status === 'starting' ? 'hub_starting' : 'hub_stopping',
				detail: `Protect Hub bridge VMID ${bridge.vmid} is ${bridge.status}`
			});
		}
	} catch {
		// Hub tables may not exist yet (P19 not deployed) — treat as no conflict
	}
	return conflicts;
}
```

**P21 extension** (per CR-4 recommendation):
```typescript
import { isReconcilerBusy } from '$lib/server/orchestration/protect-hub/reconcile';

type FlowConflict =
	| { kind: 'hub_starting' | 'hub_stopping'; detail: string }
	| { kind: 'reconciler_busy'; detail: string };

export function getActiveFlowConflicts(): FlowConflict[] {
	const conflicts: FlowConflict[] = [];
	try {
		const bridge = db.select().from(protectHubBridges).get();
		if (bridge?.status === 'starting' || bridge?.status === 'stopping') {
			conflicts.push({ /* ... existing ... */ });
		}
	} catch { /* ... */ }
	if (isReconcilerBusy()) {
		conflicts.push({ kind: 'reconciler_busy', detail: 'Protect Hub reconcile in progress' });
	}
	return conflicts;
}
```

The downstream HTTP 409 response shape is already wired in `routes/api/update/run/+server.ts:71-76` — no change needed there.

---

### `src/hooks.server.ts` (POTENTIALLY MODIFIED — SIGTERM grace per L-14)

**Current shutdown handler** (`hooks.server.ts:31-36`):
```typescript
const shutdown = (signal: string) => {
	console.log(`[shutdown] received ${signal}, exiting`);
	process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**Differences from analog (per L-14 + RESEARCH §Pitfall P21-#13):**
- Wait briefly (≤30s) on `isReconcilerBusy()` before exiting, so an in-flight reconcile finishes its tmp+rename atomic write rather than getting cut mid-push:
```typescript
const shutdown = async (signal: string) => {
	console.log(`[shutdown] received ${signal}, draining...`);
	const deadline = Date.now() + 30_000;
	while (isReconcilerBusy() && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 250));
	}
	console.log(`[shutdown] exiting (reconciler ${isReconcilerBusy() ? 'STILL BUSY' : 'idle'})`);
	process.exit(0);
};
```
- Open question for planner: whether to also drain ws-manager (`stopWs()`) and `stopScheduler()` here. Recommendation: yes, both, before the reconciler-busy poll.

---

## Shared Patterns

### Pattern S-1 — Tagged-Result returns (avoid throws across module boundaries)

**Source:** `src/lib/server/orchestration/protect-hub/catalog.ts:25-36` (DiscoverResult), `src/lib/server/services/protect-bridge.ts:70-72` (BootstrapResult), `src/lib/server/orchestration/protect-hub/bridge-provision.ts:38-40` (ProvisionResult).

**Apply to:**
- `reconcile.ts:reconcile()` → returns `Promise<ReconcileResult>` where `ReconcileResult = { ok: true, status: 'success' | 'no_op'; hashChanged: boolean; newHash?: string } | { ok: false; reason: 'bridge_unreachable' | 'controller_unreachable' | 'unknown'; error: Error }`
- `yaml-builder.ts:buildBridgeYaml()` → returns `string` directly (pure function, no IO, no error path).

**Excerpt to mirror** (`catalog.ts:25-36`):
```typescript
export type DiscoverResult =
	| { ok: true; insertedCams: number; updatedCams: number; insertedChannels: number }
	| { ok: false; reason: 'controller_unreachable' | 'auth_failed' | 'unknown'; error: Error };
```

---

### Pattern S-2 — SSH connect/dispose envelope

**Source:** `src/lib/server/orchestration/protect-hub/bridge-provision.ts:74, 193-195`:
```typescript
const ssh = await connectToProxmox();
try {
	/* ... operations ... */
} catch (err) {
	/* ... error path ... */
} finally {
	ssh.dispose();
}
```

**Apply to:** `reconcile.ts:doReconcile()` Pass-3 (mtime stat) AND Pass-4 (push + restart). Single SSH connection per reconcile pass — share between mtime check and push to avoid 2× connection overhead.

---

### Pattern S-3 — In-memory better-sqlite3 + Drizzle test fixture (W0)

**Source:** `bridge-provision.test.ts:79-115` (best example), `catalog.test.ts:54-144` (more tables).

**Apply to:** EVERY new test file in P21 that touches the DB:
- `reconcile.test.ts` — needs `cameras`, `protect_hub_bridges`, `protect_stream_catalog`, `camera_outputs`, `protect_hub_reconcile_runs` (NEW)
- `outputs/server.test.ts` — needs `cameras`, `camera_outputs`
- `reconcile/server.test.ts` — needs `protect_hub_reconcile_runs`
- `scheduler.test.ts` (extend or create) — needs `protect_hub_bridges`, `protect_hub_reconcile_runs`

**Mirror exactly** the `vi.hoisted({ memDbRef: { db: null, sqlite: null } })` + `get db() { return memDbRef.db }` getter pattern from `bridge-provision.test.ts:25-52`. This is the established way to swap the DB module without losing Drizzle's type inference.

---

### Pattern S-4 — vi.hoisted mocks for SSH/Proxmox/Protect

**Source:** `bridge-provision.test.ts:11-74` (most complete hoisted-mock setup in repo).

**Apply to:** `reconcile.test.ts` (mocks `ssh`, `protect-bridge`, optionally `proxmox`).

**Excerpt** (`bridge-provision.test.ts:69-74`):
```typescript
vi.mock('$lib/server/services/ssh', () => ({
	connectToProxmox: mockConnectToProxmox,
	executeOnContainer: mockExecuteOnContainer,
	pushFileToContainer: mockPushFileToContainer,
	waitForContainerReady: mockWaitForContainerReady
}));
```

---

### Pattern S-5 — `storeEvent` for cross-cutting events

**Source:** `src/lib/server/services/events.ts:6-38` (already shipped).

**Apply to:**
- `outputs/+server.ts` — `storeEvent({eventType: 'vaapi_soft_cap_warning', source: 'protect_hub', ...})`
- `scheduler.ts` health probe extension — `storeHealthEvent(0, 'Protect Hub Bridge', '...', 'warning')` (the existing helper at `events.ts:132-142` already wraps `storeEvent`)
- `reconcile.ts` — log significant state changes (no_op, bridge_unreachable, success-with-redeploy) for P23 drift indicator UI

`eventType` is open-ended (`schema.ts:117`); no enum extension needed.

---

### Pattern S-6 — Module-scoped singleton with start/stop guards

**Source:** `src/lib/server/services/update-checker.ts:189-219` + `src/lib/server/services/scheduler.ts:18-69, 195-217`.

**Apply to:** `ws-manager.ts` start/stop functions; `reconcile.ts` `_inFlight` Promise + `_dirty` flag.

**Idempotency invariant** (mirror from `update-checker.ts:191-204`): start functions check `if (timer === null)` before assigning; stop functions clear and null-out.

---

## No Analog Found

No files in P21 lack an analog. Every file maps to either an exact (same role + flow) or role-match (same role, different flow) sibling in the existing codebase. The two patterns with the weakest in-repo precedent are:

| Pattern | Weakness | Mitigation |
|---------|----------|------------|
| WebSocket reconnect with exponential backoff | No prior repo example of `[5,10,30,60,120,300]`s backoff (Bambu MQTT has reconnect logic but uses MQTT lib's built-in, not a hand-rolled schedule) | Copy RESEARCH §Pattern 4 verbatim — it's already a fully-formed code example, and ws-manager.test.ts uses fake-timers to lock the schedule |
| Fake-timer test for interval scheduling | Only `host-metrics.test.ts:114-115` uses `useFakeTimers`/`setSystemTime`, and never `advanceTimersByTime` | Use vitest's documented fake-timer API; the host-metrics example covers the bootstrap (`useFakeTimers` + `setSystemTime`), and the planner extends with `advanceTimersByTime(ms)` per RESEARCH §"Pitfall P21-#3" test idea |

---

## Wave-0 Coverage Map (per VALIDATION.md)

Each Wave-0 test stub from VALIDATION.md §"Wave 0 Requirements" maps to a `Pattern Assignment` section above:

| Wave-0 file | Pattern section | Analog |
|-------------|-----------------|--------|
| `yaml-builder.test.ts` | Pattern Assignment for `yaml-builder.test.ts` | `go2rtc.test.ts:1-77` |
| `reconcile.test.ts` | Pattern Assignment for `reconcile.test.ts` | `bridge-provision.test.ts:79-115` + `catalog.test.ts:42-46` |
| `ws-manager.test.ts` | Pattern Assignment for `ws-manager.test.ts` | `host-metrics.test.ts:112-135` |
| `routes/api/cameras/[id]/outputs/server.test.ts` | Pattern Assignment for `outputs/server.test.ts` | `cameras/[id]/a1-snapshot/server.test.ts:1-90` |
| `routes/api/protect-hub/reconcile/server.test.ts` | Pattern Assignment for `reconcile/server.test.ts` | `cameras/[id]/a1-snapshot/server.test.ts:1-90` + `discover/+server.ts:1-38` |
| `scheduler.test.ts` (extend or create) | Pattern Assignment for `scheduler.ts` | `host-metrics.test.ts:112-135` for fake-timer; no existing scheduler test → bootstrap from `bridge-provision.test.ts:79-115` for the in-mem DB shape |
| Add `protect_hub_reconcile_runs` to in-memory test schemas | Pattern S-3 | `bridge-provision.test.ts:79-115` |

---

## Metadata

**Analog search scope:**
- `/Users/hulki/codex/ip-cam-master/src/lib/server/orchestration/protect-hub/` (4 files)
- `/Users/hulki/codex/ip-cam-master/src/lib/server/services/` (~50 files; key ones: scheduler.ts, ssh.ts, go2rtc.ts, protect-bridge.ts, update-checker.ts, update-runner.ts, events.ts)
- `/Users/hulki/codex/ip-cam-master/src/lib/server/db/` (schema.ts, client.ts)
- `/Users/hulki/codex/ip-cam-master/src/routes/api/protect-hub/` + `/api/cameras/[id]/` + `/api/update/`
- `/Users/hulki/codex/ip-cam-master/src/hooks.server.ts`

**Files scanned (full read):** 14
**Files scanned (targeted Read or grep):** ~22

**Pattern extraction date:** 2026-05-06

**Cross-references baked into assignments:**
- CR-1 → reconcile.ts (wrap pushFileToContainer with tmp+rename inside reconcile)
- CR-2 → yaml-builder.ts (no rtspx→rtsps rewrite needed; consume protectStreamCatalog.rtspUrl directly)
- CR-3 → reconcile.ts (use `systemctl restart` not `reload-or-restart`; document 1-3s blip)
- CR-4 → update-checker.ts extension (4-line append + import isReconcilerBusy)
- CR-5 → reconcile.ts Pass 1 reuses `discover()` from catalog.ts
- CR-6 → reconcile.ts soft-delete writes `cameras.source = 'external_archived'` (no schema/CHECK change needed; column is free text)

## PATTERN MAPPING COMPLETE
