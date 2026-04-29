# Phase 19: Data Model + Protect Catalog (Read-Only) — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 9 (6 NEW, 3 EXTEND)
**Analogs found:** 9 / 9 (all NEW/EXTEND files have at least one strong in-repo analog)

---

## File Classification

| New/Modified File | New/Extend | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------------|------|-----------|----------------|---------------|
| `src/lib/server/services/protect-bridge.ts` | NEW | service (lib wrapper) | request-response + cached read | `src/lib/server/services/protect.ts` | exact (same domain, same TTL pattern) |
| `src/lib/server/orchestration/protect-hub/catalog.ts` | NEW | service (orchestration) | fetch → upsert → cache | `src/lib/server/services/onboarding.ts` (`saveCameraToDatabase`) + `src/lib/server/services/proxmox.ts` (`onConflictDoUpdate`) | role-match (no orchestration folder yet exists) |
| `src/routes/api/protect-hub/discover/+server.ts` | NEW | controller (API route) | request-response (POST) | `src/routes/api/protect/adopt/+server.ts` | exact (POST + try/catch + json envelope) |
| `src/routes/settings/protect-hub/+page.server.ts` | NEW | controller (load) | request-response | `src/routes/settings/+page.server.ts` | exact (PageServerLoad pattern) |
| `src/routes/settings/protect-hub/+page.svelte` | NEW | component (page) | client-side fetch + render | `src/routes/kameras/+page.svelte` (poll + render) | exact |
| `src/lib/components/settings/ProtectHubTab.svelte` | NEW | component (tab) | client form + status | `src/lib/components/settings/BackupTab.svelte` | exact (settings tab + status cards) |
| `src/lib/server/db/schema.ts` | EXTEND | model (Drizzle schema) | DDL | itself (existing `cameras` + `containers` tables) | exact |
| `src/lib/server/db/client.ts` | EXTEND | config (boot migration) | DDL | itself (existing `ensureColumn()` calls + `CREATE TABLE IF NOT EXISTS` blocks) | exact |
| `src/routes/settings/+page.svelte` | EXTEND | component (tabs page) | client tab switch | itself (existing tabs array + tab dispatch) | exact |

---

## Pattern Assignments

### `src/lib/server/services/protect-bridge.ts` (NEW — service, request-response + cached read)

**Analog:** `src/lib/server/services/protect.ts` (lines 1–86, 141–197)

The new file is the v1.3 lib-backed twin of the legacy hand-rolled `protect.ts`. Per D-LIB-01, the legacy file MUST stay UNCHANGED. `protect-bridge.ts` mirrors its shape — singleton-with-TTL, same `getSettings('unifi_')` config source, same "don't cache failures" rule — but uses the `unifi-protect` npm lib instead of `fetch()`.

**Imports + module-level singleton** (`protect.ts:1–16`):

```typescript
import { getSettings } from './settings';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import type { ProtectCamera, ProtectCameraMatch, ProtectStatus } from '$lib/types';

// Self-signed UDM certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface ProtectSession {
	cookies: string;
	csrfToken: string;
	expiresAt: number;
}

let session: ProtectSession | null = null;
let statusCache: { data: ProtectStatus; expiresAt: number } | null = null;
```

**Credentials read pattern** (`protect.ts:18–55`):

```typescript
async function getHost(): Promise<string> {
	const settings = await getSettings('unifi_');
	const host = settings.unifi_host;
	if (!host) throw new Error('UniFi host not configured. Set unifi_host in Settings.');
	return host;
}

async function login(): Promise<ProtectSession> {
	const settings = await getSettings('unifi_');
	const host = settings.unifi_host;
	if (!host) throw new Error('UniFi host not configured');
	const username = settings.unifi_username;
	const password = settings.unifi_password; // already decrypted by getSettings()
	if (!username || !password) {
		throw new Error('UniFi credentials not configured');
	}
	// ... lib-equivalent: new ProtectApi() + login(host, username, password)
}
```

**TTL cache + don't-cache-failures pattern** (`protect.ts:141–197`):

```typescript
export async function getProtectStatus(...): Promise<ProtectStatus> {
	// Return cached data if still valid (30s TTL)
	if (statusCache && Date.now() < statusCache.expiresAt) {
		return statusCache.data;
	}
	try {
		const protectCameras = await getProtectCameras();
		// ... build status ...
		// Cache for 30s
		statusCache = { data: status, expiresAt: Date.now() + 30_000 };
		return status;
	} catch (err) {
		const msg = (err as Error).message;
		if (!msg.includes('not configured')) {
			console.error('[protect] Status fetch failed:', msg);
		}
		// Do NOT cache failures
		return { connected: false, /* empty fallback */ };
	}
}
```

**What's different:**
- Replace hand-rolled `fetch(...)` + cookies/CSRF with the `unifi-protect` lib's `ProtectApi` instance (singleton via `getProtectClient()`).
- Add named exports per D-LIB-02: `getProtectClient()`, `fetchBootstrap()`, `classifyKind(camera)`, `TLS_SCHEME`.
- Bootstrap cache uses 30s TTL just like `protect.ts` `statusCache`.
- `classifyKind()` per D-CLASS-01: regex-test `manufacturer` against `/^(Ubiquiti|UniFi)$/i` (exact word, case-insensitive). Returns `'first-party' | 'third-party' | 'unknown'`.
- `TLS_SCHEME` const populated from spike result file (`p19-tls-rtspx.md`).

---

### `src/lib/server/orchestration/protect-hub/catalog.ts` (NEW — service, fetch→upsert→cache)

**Analogs:**
1. `src/lib/server/services/onboarding.ts:182–213` — `saveCameraToDatabase(params)` (insert + return id)
2. `src/lib/server/services/proxmox.ts:113–134` — upsert via `onConflictDoUpdate`
3. `src/lib/server/services/events.ts:6–38` — dedup-then-insert pattern (mirrors "upsert by natural key")
4. `src/lib/server/services/protect.ts:88–139` — `matchCamerasToProtect()` MAC normalization (lowercased + separator-stripped)

**Camera insert pattern** (`onboarding.ts:186–212`):

```typescript
db.insert(cameras)
	.values({
		vmid: params.vmid,
		name: params.name,
		ip: params.ip,
		username: params.username,
		password: encryptedPassword,
		cameraType: params.cameraType || 'mobotix',
		streamPath: params.streamPath || '/stream0/mobotix.mjpeg',
		// ...
		streamName,
		status: CAMERA_STATUS.PENDING,
		rtspAuthEnabled: true,
		model: params.model ?? null
	})
	.run();

// Get the inserted camera by vmid
const inserted = db.select({ id: cameras.id })
	.from(cameras)
	.where(eq(cameras.vmid, params.vmid))
	.get();
return inserted?.id ?? 0;
```

**Upsert via `onConflictDoUpdate`** (`proxmox.ts:113–134`):

```typescript
db.insert(containers)
	.values({
		vmid: params.vmid,
		hostname: params.hostname,
		cameraName: params.cameraName || null,
		cameraIp: params.cameraIp || null,
		cameraType: params.cameraType || null,
		status: 'stopped',
		updatedAt: new Date().toISOString()
	})
	.onConflictDoUpdate({
		target: containers.vmid,
		set: {
			hostname: params.hostname,
			cameraName: params.cameraName || null,
			cameraIp: params.cameraIp || null,
			cameraType: params.cameraType || null,
			updatedAt: new Date().toISOString()
		}
	})
	.run();
```

**MAC normalization pattern (use exactly this for `cameras.mac` PK, per HUB-CAT-02 + ARCH §1.1)** (`protect.ts:104–113`):

```typescript
if (cam.lxcMac) {
	const normalizedMac = cam.lxcMac.toUpperCase().replace(/[:-]/g, '');
	const candidates = protectCameras.filter((p) => {
		const pMac = (p.mac || '').toUpperCase().replace(/[:-]/g, '');
		return pMac === normalizedMac;
	});
	// ...
}
```

**Note:** Per ROADMAP success-criterion #2, store MAC `.toLowerCase()` — flip the case but keep the separator-strip.

**What's different:**
- `catalog.ts` lives under `src/lib/server/orchestration/protect-hub/` — **new directory** (no in-repo orchestration folder exists yet; this phase creates the scaffold per ARCH §2.3 + §12).
- Imports from `protect-bridge.ts` (NOT `protect.ts`, per D-LIB-01).
- Two upsert targets per discover() pass:
  1. `cameras` rows where `source='external'`, keyed on `mac` (PK for external cams). Use `onConflictDoUpdate({ target: cameras.mac, ... })` once schema lands.
  2. `protect_stream_catalog` rows keyed on `(cameraId, quality)` — full delete-then-insert per cam (catalog is cache, not source-of-truth, per ARCH §1.2).
- Exposes `discover()` (the route handler calls this) and `loadCatalog()` (the page-server load() calls this for cached-read).
- On UDM-unreachable: catch → leave SQLite cache untouched → return `{ stale: true, lastDiscoveredAt: ... }`. Mirrors `protect.ts` "don't cache failures" rule.

---

### `src/routes/api/protect-hub/discover/+server.ts` (NEW — controller, request-response POST)

**Analog:** `src/routes/api/protect/adopt/+server.ts:9–80` (POST handler with input validation, business call, error envelope)

**Imports + handler shape** (`adopt/+server.ts:1–17`):

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyOnvifServer } from '$lib/server/services/protect';
import { getSetting } from '$lib/server/services/settings';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { cameraId } = await request.json();
		if (!cameraId || typeof cameraId !== 'number') {
			return json({ error: 'cameraId (number) ist erforderlich' }, { status: 400 });
		}
		// ... business work ...
		return json({ /* result envelope */ });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
```

**Alternative envelope shape (GET, no body)** (`src/routes/api/protect/cameras/+server.ts:5–26`):

```typescript
export const GET: RequestHandler = async () => {
	try {
		const status = await getProtectStatus();
		return json({ connected: status.connected, /* ... */ });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ connected: false, error: message }, { status: 500 });
	}
};
```

**What's different:**
- POST verb (refresh action), no request body needed — the route just kicks `discover()` from `protect-hub/catalog.ts`.
- Auth gating is implicit: `src/hooks.server.ts` already guards every non-public path through the global `handle` (no per-route auth check needed; see "Shared Patterns / Authentication" below).
- Response envelope: `{ ok: true, discovered: <count>, stale: false }` on success; `{ ok: false, error, stale: true, lastDiscoveredAt }` on UDM-unreachable.

---

### `src/routes/settings/protect-hub/+page.server.ts` (NEW — controller, load)

**Analog:** `src/routes/settings/+page.server.ts:1–23` (PageServerLoad with `getSettings()`)

**Load pattern** (`settings/+page.server.ts:1–23`):

```typescript
import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSettings, getSetting, saveSetting } from '$lib/server/services/settings';
import { getUser, createUser, deleteUser, verifyPassword, isYoloMode } from '$lib/server/services/auth';

export const load: PageServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	const udmSshKeyPath = await getSetting('udm_ssh_key_path');
	// ...
	return {
		proxmox,
		unifi,
		// ...
	};
};
```

**What's different:**
- Returns: `{ hubEnabled, unifiConfigured, catalog, lastDiscoveredAt, stale }`.
  - `hubEnabled = (await getSetting('protect_hub_enabled')) === 'true'`
  - `unifiConfigured = !!(unifi.unifi_host && unifi.unifi_username && unifi.unifi_password)` — controls the Q-OPEN-04 deep-link copy
  - `catalog` = `loadCatalog()` from `protect-hub/catalog.ts` (cached read; never triggers a refresh)
  - On first visit when catalog is empty, the page-svelte calls POST `/api/protect-hub/discover` from the client side (per D-REFRESH-01). The server load does NOT auto-discover.

---

### `src/routes/settings/protect-hub/+page.svelte` (NEW — component, client fetch + render)

**Analog:** `src/routes/kameras/+page.svelte:1–69` (server-data + client poll + render)

**Imports + state + initial fetch pattern** (`kameras/+page.svelte:1–32`):

```svelte
<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import CameraDetailCard from '$lib/components/cameras/CameraDetailCard.svelte';
	import type { CameraCardData } from '$lib/types';
	import { Loader2 } from 'lucide-svelte';

	let { data } = $props();
	let cameras = $state<CameraCardData[]>([]);
	let loading = $state(true);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchCameras() {
		try {
			const res = await fetch('/api/cameras/status');
			if (res.ok) cameras = await res.json();
		} catch { /* silently retry next poll */ }
		finally { loading = false; }
	}

	$effect(() => {
		fetchCameras();
		pollTimer = setInterval(fetchCameras, 10000);
		return () => { if (pollTimer) clearInterval(pollTimer); };
	});
</script>
```

**Render pattern (header + loading + empty + list)** (`kameras/+page.svelte:34–69`):

```svelte
<div class="flex items-center justify-between mb-6">
	<h1 class="text-2xl font-bold text-text-primary">Kameras</h1>
	<!-- action button -->
</div>

{#if loading}
	<div class="flex items-center gap-3 text-text-secondary py-8">
		<Loader2 class="w-5 h-5 animate-spin" />
		<span>Kamerastatus wird geladen...</span>
	</div>
{:else if cameras.length === 0}
	<div class="text-text-secondary text-center py-12">
		<p class="text-lg mb-2">Keine Kameras eingerichtet</p>
	</div>
{:else}
	<div class="space-y-4">
		{#each cameras as camera (camera.id)}
			<CameraDetailCard {camera} />
		{/each}
	</div>
{/if}
```

**What's different:**
- No 10s polling (catalog refreshes are user-driven per D-REFRESH-01).
- Header shows "Aktualisieren" button (POST to `/api/protect-hub/discover`); orange "Controller nicht erreichbar — Anzeige aus Cache" banner when `data.stale === true` (HUB-CAT-05).
- On mount, if `data.catalog.length === 0` AND `data.unifiConfigured`, fire one initial discover() with spinner (D-REFRESH-01).
- Table layout for catalog: column per quality, rows per cam — uses the "single-channel cams render correctly" rule (HUB-CAT-06: do not assume 3 channels).
- Each cam row shows manufacturer / model / MAC + first-party/third-party badge (HUB-CAT-03).

---

### `src/lib/components/settings/ProtectHubTab.svelte` (NEW — component, settings tab content)

**Analog:** `src/lib/components/settings/BackupTab.svelte:1–156` (settings tab with status cards + action button + feedback)

**Imports + state pattern** (`BackupTab.svelte:1–17`):

```svelte
<script lang="ts">
	import { Download, Upload, AlertTriangle, Loader2 } from 'lucide-svelte';

	let file = $state<File | null>(null);
	let showConfirm = $state(false);
	let submitting = $state(false);
	let success = $state<string | null>(null);
	let error = $state<string | null>(null);
</script>
```

**Card layout pattern (matches existing settings design system)** (`BackupTab.svelte:77–156`):

```svelte
<div class="max-w-lg space-y-6">
	{#if success}
		<div class="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded">
			{success}
		</div>
	{/if}
	{#if error}
		<div class="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
			{error}
		</div>
	{/if}

	<div class="bg-bg-card rounded-lg border border-border p-6">
		<h2 class="text-lg font-semibold text-text-primary mb-2">Backup herunterladen</h2>
		<p class="text-sm text-text-secondary mb-4">…</p>
		<a href="/api/backup/download" download
			class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded font-medium
				hover:bg-accent/90 transition-colors">
			<Download class="w-4 h-4" />
			Jetzt herunterladen
		</a>
	</div>
</div>
```

**Form submit + feedback pattern** (lift from `CredentialsTab.svelte:63–80`):

```svelte
async function postCredential(body: Record<string, unknown>, resetForm: () => void) {
	saving = true;
	feedback = null;
	try {
		const res = await fetch('/api/credentials', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json();
		if (data.success) {
			feedback = { type: 'success', message: `"${body.name}" gespeichert.` };
		} else {
			feedback = { type: 'error', message: data.error || 'Fehler' };
		}
	} catch { /* ... */ }
}
```

**What's different:**
- Three cards (per HUB-WIZ-01 minimal-shell scope):
  1. **Status** card: feature toggle (default OFF), last-discovery timestamp, cam count, stale-banner.
  2. **Aktualisieren** card: button → POST `/api/protect-hub/discover`.
  3. **Deep-link** card (only when `!data.unifiConfigured`): "Konfiguriere zuerst die UniFi-Verbindung →" link to `/settings?tab=UniFi` (per Q-OPEN-04 recommendation).
- The page-route at `/settings/protect-hub` uses this same component for its body. The settings-tab path renders this same component inline. Single component, two mount points.

---

### `src/lib/server/db/schema.ts` (EXTEND — model)

**Analog:** the file itself — existing `cameras` table (lines 31–63) and existing pattern of "add Bambu A1 model column in v1.2" via `cameraType` text discriminator (line 38) + nullable `model` column (line 54).

**Existing `cameras` table shape** (`schema.ts:31–63`):

```typescript
export const cameras = sqliteTable('cameras', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	vmid: integer('vmid').notNull(),
	name: text('name').notNull(),
	ip: text('ip').notNull(),
	username: text('username').notNull(),
	password: text('password').notNull(),
	cameraType: text('camera_type').notNull().default('mobotix'),
	// ...
	streamMode: text('stream_mode').default('adaptive'),
	rtspAuthEnabled: integer('rtsp_auth_enabled', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});
```

**Existing v1.2 Bambu pattern** (the v1.2 way to extend a row with a new cam-type-specific column):

```typescript
// Phase 18 / BAMBU-A1-02: persist SSDP-captured model for Bambu rows
// so downstream capability checks (UI + preflight) have real data.
model: text('model'),
```

Note: `cameraType` accepts string values not in the `CameraType` union (line 3) — schema is the looser of the two. The `'protect-external'` discriminator value can be added by extending the `CameraType` type or as a free-form string.

**What to add (per ARCH §1.1 + §1.2):**

```typescript
// In `cameras` table — APPEND these columns:
source: text('source').notNull().default('managed'),       // 'managed' | 'external'
mac: text('mac'),                                          // lowercased, no separators (e.g. 'aabbccddeeff'); NOT NULL when source='external' (enforced via app code, not CHECK constraint)
externalId: text('external_id'),                           // Protect cam UUID (denormalized cache only per CONTEXT)
hubBridgeId: integer('hub_bridge_id'),                     // FK → protect_hub_bridges.id; NULL for managed
manufacturer: text('manufacturer'),                        // from Protect bootstrap
modelName: text('model_name'),                             // from Protect bootstrap (note: 'model' is taken by Bambu; rename collision-free)
kind: text('kind')                                         // 'first-party' | 'third-party' | 'unknown'
```

**Three new tables to APPEND** (verbatim from ARCH §1.2):

```typescript
export const protectHubBridges = sqliteTable('protect_hub_bridges', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	vmid: integer('vmid').notNull().unique(),
	hostname: text('hostname').notNull(),
	containerIp: text('container_ip'),
	status: text('status').notNull().default('pending'),
	lastDeployedYamlHash: text('last_deployed_yaml_hash'),
	lastReconciledAt: text('last_reconciled_at'),
	lastHealthCheckAt: text('last_health_check_at'),
	createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const cameraOutputs = sqliteTable('camera_outputs', { /* … see ARCH §1.2 */ });
export const protectStreamCatalog = sqliteTable('protect_stream_catalog', { /* … see ARCH §1.2 */ });
```

**What's different from analog:**
- Three new tables (orchestration/bridges, per-cam outputs, per-cam stream cache). All follow the established `id + autoIncrement` PK + `createdAt/updatedAt` ISO-string pattern (matches `cameras`, `containers`, `events`).
- `cameras.modelName` is split from existing `cameras.model` (Bambu-specific, line 54) to avoid semantic overload.

---

### `src/lib/server/db/client.ts` (EXTEND — config)

**Analog:** the file itself — existing `ensureColumn()` helper (lines 44–48) and existing `CREATE TABLE IF NOT EXISTS` blocks (lines 19–39).

**Existing `ensureColumn()` helper** (`client.ts:44–48`):

```typescript
function ensureColumn(table: string, column: string, definition: string): void {
	const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	if (rows.some((r) => r.name === column)) return;
	sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```

**Existing call sites — what to mirror** (`client.ts:50–54`):

```typescript
ensureColumn('cameras', 'rtsp_auth_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('cameras', 'model', 'TEXT');
ensureColumn('credentials', 'type', "TEXT NOT NULL DEFAULT 'mobotix'");
ensureColumn('credentials', 'access_code', 'TEXT');
ensureColumn('credentials', 'serial_number', 'TEXT');
```

**Existing `CREATE TABLE IF NOT EXISTS` pattern** (`client.ts:19–39`):

```typescript
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
```

**What to add (per ARCH §12 file-touch matrix):**

```typescript
// New columns on cameras (append to lines 50–54 block):
ensureColumn('cameras', 'source', "TEXT NOT NULL DEFAULT 'managed'");
ensureColumn('cameras', 'mac', 'TEXT');
ensureColumn('cameras', 'external_id', 'TEXT');
ensureColumn('cameras', 'hub_bridge_id', 'INTEGER');
ensureColumn('cameras', 'manufacturer', 'TEXT');
ensureColumn('cameras', 'model_name', 'TEXT');
ensureColumn('cameras', 'kind', 'TEXT');

// Three new CREATE TABLE IF NOT EXISTS blocks for protect_hub_bridges,
// camera_outputs, protect_stream_catalog (mirror the events-table block above).
```

**What's different:**
- No new helpers — reuse `ensureColumn()` and `sqlite.exec(...)` exactly as currently used.
- Per CONTEXT.md "Schema-irreversibility" constraint: P19 commits the `cameras.mac NOT NULL`-for-external decision. Since SQLite ALTER TABLE cannot add a NOT NULL column without a default to an existing table, the column is `TEXT` (nullable) at DDL level and the `NOT NULL for source='external'` invariant is enforced in app code (catalog.ts upsert).

---

### `src/routes/settings/+page.svelte` (EXTEND — component, tabs page)

**Analog:** the file itself — existing tabs array (line 11) + dispatch (lines 38–48).

**Existing tab declaration + dispatch** (`settings/+page.svelte:1–48`):

```svelte
<script lang="ts">
	import ProxmoxTab from '$lib/components/settings/ProxmoxTab.svelte';
	import UnifiTab from '$lib/components/settings/UnifiTab.svelte';
	import CredentialsTab from '$lib/components/settings/CredentialsTab.svelte';
	import BackupTab from '$lib/components/settings/BackupTab.svelte';
	import VersionTab from '$lib/components/settings/VersionTab.svelte';

	const tabs = ['Proxmox', 'UniFi', 'Credentials', 'Backup', 'Version', 'Zugangsschutz'] as const;
	let activeTab = $state<(typeof tabs)[number]>('Proxmox');
</script>

<!-- … tab buttons … -->

<div>
	{#if activeTab === 'Proxmox'}
		<ProxmoxTab initialValues={data.proxmox} />
	{:else if activeTab === 'UniFi'}
		<UnifiTab initialValues={data.unifi} ... />
	{:else if activeTab === 'Credentials'}
		<CredentialsTab />
	{:else if activeTab === 'Backup'}
		<BackupTab />
	{:else if activeTab === 'Version'}
		<VersionTab />
	{:else if activeTab === 'Zugangsschutz'}
		<!-- inline content -->
	{/if}
</div>
```

**What to add:**

```svelte
import ProtectHubTab from '$lib/components/settings/ProtectHubTab.svelte';

const tabs = ['Proxmox', 'UniFi', 'Protect Hub', 'Credentials', 'Backup', 'Version', 'Zugangsschutz'] as const;

<!-- in the dispatch: -->
{:else if activeTab === 'Protect Hub'}
	<ProtectHubTab />
```

**What's different:**
- The new tab needs the same `data.unifiConfigured` / `data.catalog` props that `+page.server.ts` would normally provide. Two acceptable patterns:
  1. Extend `settings/+page.server.ts load()` to fetch hub status + pass via `data.protectHub`.
  2. Let `ProtectHubTab.svelte` fetch its own state via `/api/protect-hub/discover` (pure GET fallback returning cache only) on mount.
- Pattern (2) keeps the `/settings` route loader unchanged — preferred since it isolates hub-tab failures from the rest of settings.

---

## Shared Patterns

### Authentication

**Source:** `src/hooks.server.ts:28–59`
**Apply to:** All new `/api/protect-hub/*` routes AND `/settings/protect-hub/*` routes.

```typescript
export const handle: Handle = async ({ event, resolve }) => {
	if (isPublicPath(event.url.pathname)) {
		return resolve(event);
	}
	if (isYoloMode()) {
		return resolve(event);
	}
	const user = getUser();
	if (!user) {
		return new Response(null, { status: 303, headers: { location: '/setup' } });
	}
	const sessionId = event.cookies.get('session');
	if (!sessionId) {
		return new Response(null, { status: 303, headers: { location: '/login' } });
	}
	const session = validateSession(sessionId);
	if (!session) {
		event.cookies.delete('session', { path: '/' });
		return new Response(null, { status: 303, headers: { location: '/login' } });
	}
	event.locals.user = session;
	return resolve(event);
};
```

**Key takeaway:** Auth is **global** — every non-public path is gated by the session cookie. New API routes do NOT add per-route auth checks. Just write the handler — `hooks.server.ts` already protects it. Public paths (`isPublicPath()` from `$lib/config/routes`) are a closed list; do NOT extend it for hub routes.

---

### Error Handling (API routes)

**Source:** `src/routes/api/protect/cameras/+server.ts:5–26`, `src/routes/api/protect/adopt/+server.ts:9–80`, `src/routes/api/protect/events/+server.ts:8–33`
**Apply to:** All `/api/protect-hub/*/+server.ts` routes.

```typescript
export const POST: RequestHandler = async ({ request }) => {
	try {
		// 1. Validate inputs (return 400 with error code on failure)
		// 2. Call into service / orchestration layer
		// 3. Return json({ ok: true, ...data })
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
```

**Convention:** Error envelope is `{ error: <human-readable string> }` with HTTP status code. Some endpoints add a top-level `connected: false` flag for "external service unreachable" (see `protect/cameras/+server.ts:24`); reuse that for the discover endpoint when UDM is down (`{ ok: false, stale: true, error, lastDiscoveredAt }`).

---

### Settings & Encrypted Credentials Read

**Source:** `src/lib/server/services/settings.ts:19–58`
**Apply to:** Any new code that reads UniFi credentials (e.g. `protect-bridge.ts`).

```typescript
export async function getSetting(key: string): Promise<string | null> { /* decrypts on read */ }
export async function getSettings(prefix: string): Promise<Record<string, string>> {
	if (settingsCache && settingsCache.prefix === prefix && Date.now() < settingsCache.expiresAt) {
		return settingsCache.data;
	}
	// ... 30s cache, decrypts encrypted rows transparently ...
}
```

**Key takeaway:** ALWAYS use `getSettings('unifi_')` to read Protect creds. NEVER call `decrypt()` directly. The decryption + 30s TTL cache is centralized.

---

### Drizzle ORM Imports

**Source:** consistent across all `src/lib/server/services/*.ts` and `src/routes/api/**/*.ts`

```typescript
import { db } from '$lib/server/db/client';
import { cameras, /* new tables */ } from '$lib/server/db/schema';
import { eq, and, desc /* etc */ } from 'drizzle-orm';
```

**Apply to:** `protect-bridge.ts`, `catalog.ts`, all new `+server.ts`, `+page.server.ts`.

---

### Lucide-Svelte Icon Imports (UI)

**Source:** `BackupTab.svelte:2`, `kameras/+page.svelte:5`, `CameraDetailCard.svelte:3`

```svelte
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-svelte';
```

**Apply to:** `ProtectHubTab.svelte`, `settings/protect-hub/+page.svelte`. Suggested icons: `RefreshCw` (Aktualisieren), `Loader2` (spinner), `AlertTriangle` (stale banner), `CheckCircle2` (status OK), `Shield` (first-party badge), `ShieldQuestion` (unknown badge).

---

### Tailwind Design System (status banners + cards)

**Source:** `BackupTab.svelte:78–104`, `settings/+page.svelte:50–60`
**Apply to:** `ProtectHubTab.svelte`, `settings/protect-hub/+page.svelte`.

```svelte
<!-- Success banner -->
<div class="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded">…</div>

<!-- Error banner -->
<div class="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">…</div>

<!-- Card -->
<div class="bg-bg-card rounded-lg border border-border p-6">
	<h2 class="text-lg font-semibold text-text-primary mb-2">…</h2>
	<p class="text-sm text-text-secondary mb-4">…</p>
</div>

<!-- Primary action button -->
<button class="px-4 py-2 bg-accent text-white rounded font-medium hover:bg-accent/90 transition-colors">…</button>
```

For the orange "stale / cache" banner (HUB-CAT-05), follow the success/error pattern with `bg-orange-500/10 border-orange-500/30 text-orange-400`.

---

## No Analog Found

| File | Reason |
|------|--------|
| (none) | All P19 files have at least one strong analog in the existing repo. The orchestration folder `src/lib/server/orchestration/protect-hub/` does not exist yet — `catalog.ts` is the file that creates it — but the *patterns* it follows (upsert, dedup, fetch-with-cache, MAC normalization) are all drawn from existing services. |

---

## Metadata

**Analog search scope:**
- `src/lib/server/services/` (47 files)
- `src/lib/server/db/`
- `src/lib/components/settings/`
- `src/lib/components/cameras/`
- `src/routes/api/protect/`
- `src/routes/api/cameras/`
- `src/routes/settings/`
- `src/routes/kameras/`
- `src/hooks.server.ts`
- `package.json` (dependency surface)

**Files scanned:** ~25 (focused targeted reads; large files like `onboarding.ts`, `proxmox.ts`, `CameraDetailCard.svelte` read with offset/limit).

**Pattern extraction date:** 2026-04-30

---

## PATTERN MAPPING COMPLETE
