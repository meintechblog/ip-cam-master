# Phase 19: Data Model + Protect Catalog (Read-Only) — Research

**Researched:** 2026-04-30
**Domain:** UniFi Protect bootstrap discovery + first/third-party classification + irreversible schema commit + TLS spike (`rtspx://` against UDM 192.168.3.1)
**Confidence:** HIGH (architecture, schema, codebase patterns); HIGH (lib API surface — verified verbatim against `protect-types.ts@main`); MEDIUM (TLS scheme — must be empirically confirmed by the spike, that's the whole point)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HUB-CAT-01 | User sees all UniFi Protect cams in `/cameras` (inline with managed cams), each marked with a "Protect Hub" badge. | **Out of scope for P19.** This req is delivered by P22 (`/cameras` integration). P19 only ships the catalog *table* + Settings-Hub-Tab read-only view. The req is in the P19 list per ROADMAP because P19 *populates the data* that P22 consumes; the visibility itself is P22. Plan-checker note: do NOT plan `/cameras` UI work in P19. |
| HUB-CAT-02 | For each external Protect cam, the catalog displays manufacturer, model, MAC, and the set of available native stream qualities with codec, resolution, framerate, and bitrate per quality. | Catalog UI on `/settings/protect-hub` Hub-Tab renders rows from `protect_stream_catalog` joined with `cameras`. Supported by §API Surface — `bootstrap.cameras[].marketName` (model) + `videoCodec` (camera-level) + `channels[]` (per-quality bitrate/fps/width/height). **Note on "manufacturer":** see §Risks #2 — there is no `manufacturer` field in the typed lib interface; D-CLASS-01 needs a derivation revision. |
| HUB-CAT-03 | System auto-classifies each Protect cam as `first-party` (UniFi/UVC) or `third-party` (adopted Mobotix/Hikvision/etc.) based on Protect bootstrap data; classification is visible in the UI as a secondary qualifier badge. | `protect-bridge.ts classifyKind(camera)` derives `kind` per the *revised* D-CLASS-01 (see §Open Questions Resolved → Q-OPEN-01). UI badge in catalog table. |
| HUB-CAT-04 | Stream catalog refreshes automatically on a cadence (15 min default) and on user-triggered "Sync now." | **Partially in scope for P19** per D-REFRESH-01: P19 ships only Initial-Auto on empty cache + Manual button. The 15-min auto-cadence is P21 (reconciler tick). Plans for P19 must NOT add a scheduler interval. |
| HUB-CAT-05 | Catalog is cached in SQLite so the UI renders correctly even when the UDM is briefly unreachable. | `protect_stream_catalog` is the cache. `discover()` catches UDM-unreachable network errors, leaves cache untouched, UI renders cached rows + "Controller nicht erreichbar" banner. |
| HUB-CAT-06 | Single-channel cams (low-end models with only one stream quality) render correctly — no hardcoded 3-channel assumption. | `bootstrap.cameras[].channels` is `ProtectCameraChannelConfigInterface[]` — an array, length not constrained by the type. Catalog rows are 1-per-channel iterated from `camera.channels`. UI must not template 3 hardcoded slots. Verified against `protect-types.ts:855`. See §Risks #3. |
| HUB-WIZ-01 | Settings page shows a "Protect Hub" tab with the feature toggle (default OFF) as the entry point. | Settings tabs array gains a 7th entry "Protect Hub" → renders new `ProtectHubTab.svelte`. Toggle reads `settings.protect_hub_enabled` (default `false` — but per L-17 / D-REFRESH-01, the toggle does NOT trigger anything on its own in P19; in P19 it's a future-flag stub. The toggle's wizard-launching behavior is P20). |
</phase_requirements>

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Classification (D-CLASS):**
- **D-CLASS-01** — first-party detection rule (PRIMARY: manufacturer):
  ```
  kind = 'first-party'  IF  manufacturer matches /^(Ubiquiti|UniFi)$/i
  kind = 'third-party'  IF  manufacturer present AND not first-party
  kind = 'unknown'      IF  manufacturer is null/empty
                            AND type matches /^UVC/i (low-confidence first-party guess; NOT used to assign first-party)
  ```
  > **`[VERIFIED: github.com/hjdhjd/unifi-protect/src/protect-types.ts@main]` — `manufacturer` is NOT a field on `ProtectCameraConfigInterface` or `ProtectDeviceBaseInterface`.** The lib's typed bootstrap exposes `marketName`, `type`, `modelKey`, `isThirdPartyCamera` — but no `manufacturer`. This rule needs revision. See §Risks #2 and §Open Questions Resolved → Q-OPEN-01 for the proposed alternative; user confirmation required before P19 plans go to execute.

- **D-CLASS-02** — `kind='unknown'` treatment: third-party for default-enable logic (default-OFF, opt-in). UI shows manufacturer-as-is + small `?` qualifier badge so user can override manually.

**TLS Spike (D-TLS):**
- **D-TLS-01** — Spike is the first plan-task in P19, automated and committed: provisions a throwaway LXC, runs `ffprobe -i rtspx://192.168.3.1:7441/<known-share-alias>` (with and without `tls_verify=0`), captures output, writes findings to `.planning/research/v1.3/spikes/p19-tls-rtspx.md`, commits.
- **D-TLS-02** — Spike result is locked into a const in `src/lib/server/services/protect-bridge.ts`. All later phases (P21 yaml-builder, P23 share-toggle) import this const — no inline fallbacks, no runtime probing.

**Catalog Refresh (D-REFRESH):**
- **D-REFRESH-01** — Initial-Auto on empty cache + Manual button; NO background polling in P19.
  - First time `/settings/protect-hub` is opened AND `protect_stream_catalog` is empty → automatic `discover()` run with spinner UI; populate catalog.
  - Subsequent visits: catalog renders from SQLite cache (instant); a manual "Aktualisieren" button triggers `discover()`.
  - On UDM unreachability: discover() catches the network error, leaves cache untouched, UI shows orange "Controller nicht erreichbar — Anzeige aus Cache" banner with last-discovery timestamp. (Satisfies HUB-CAT-05.)

**Lib Boundary (D-LIB):**
- **D-LIB-01** — New `unifi-protect@^4.29.0` lib for ALL new v1.3 read paths; hand-rolled `protect.ts` UNTOUCHED for legacy v1.0 cam-monitoring.
- **D-LIB-02** — Module location: `src/lib/server/services/protect-bridge.ts` (sits next to `protect.ts` in flat services folder; NOT under `src/lib/server/orchestration/protect-hub/`, which is reserved for orchestration logic). Exports: `getProtectClient()`, `fetchBootstrap()`, `classifyKind(camera)`, `TLS_SCHEME` const, (P23 future) `enableCameraRtsp(...)`.

### Claude's Discretion

- Internal split between `protect-bridge.ts` (lib boundary, classification) and `orchestration/protect-hub/catalog.ts` (upsert work, transaction boundaries) — researcher recommends keeping them separated per D-LIB-02.
- Exact Svelte 5 component shape for `ProtectHubTab.svelte` and the `/settings/protect-hub/+page.svelte` page — researcher recommends server-load + cache-vs-fresh branch (see §`/settings/protect-hub` Page).
- Test file naming and fixture layout — researcher proposes `tests/server/services/protect-bridge.test.ts` + `tests/server/orchestration/protect-hub/catalog.test.ts` + a `tests/fixtures/protect-bootstrap-*.json` set covering the 4 cam-shape variants (see §Validation Architecture).

### Deferred Ideas (OUT OF SCOPE)

*None this session* — all discussion stayed within Phase 19 boundaries. Carried-over deferrals from milestone research: multi-bridge support, per-channel `enableRtsp` granularity, additional output types (HomeAssistant, Scrypted), profile system, output-stream auth, real Drizzle migration system.
</user_constraints>

---

## Project Constraints (from CLAUDE.md)

- **Language:** TypeScript 5.9.3 strict mode `[VERIFIED: tsconfig.json + package.json]`
- **Package Manager:** npm (note: project CLAUDE.md says `npm`; root CLAUDE.md elsewhere references `pnpm` — for ip-cam-master use `npm` per project file)
- **Framework:** SvelteKit 2.50+ + Svelte 5.51+ + Node.js 22 LTS `[VERIFIED: package.json]`
- **DB:** better-sqlite3 12.6 + Drizzle ORM 0.45.1 + drizzle-kit 0.31.8 `[VERIFIED: package.json]`
- **Migration pattern:** Pseudo-Drizzle via `ensureColumn()` helper in `src/lib/server/db/client.ts`. Real Drizzle migration system is v1.4+ work — DO NOT introduce drizzle-kit migrations in P19. `[VERIFIED: src/lib/server/db/client.ts:44-48]`
- **Two new deps:** `unifi-protect@^4.29.0` + `yaml@^2.6.0`. NO bumping of existing deps. `yaml` is not used in P19 directly but is locked at milestone level — P19 plan 01 (deps install) installs both.
- **Test framework:** Vitest 4.1.0 `[VERIFIED: package.json]`
- **Hand-rolled `protect.ts` STAYS UNTOUCHED.** Plan-checker MUST flag any modification.
- **Workflow:** All file edits via GSD commands per `## GSD Workflow Enforcement` directive.

---

## Summary

Phase 19 is a **schema-irreversibility commit** plus a **read-only catalog discovery slice**. Five concrete deliverables:

1. **Schema lock:** Extend `cameras` with `source`, `mac` (lowercase, no separators, NOT NULL for external rows), `external_id`, `hub_bridge_id`, `manufacturer`, `model`, `kind`. Three new tables: `protect_hub_bridges`, `camera_outputs`, `protect_stream_catalog`. All via `ensureColumn()` and `CREATE TABLE IF NOT EXISTS` in the existing pseudo-migration on boot.
2. **TLS spike (FIRST plan-task):** Provision throwaway LXC → `ffprobe rtspx://192.168.3.1:7441/<alias>` → capture findings to `.planning/research/v1.3/spikes/p19-tls-rtspx.md` → lock chosen scheme as a const in `protect-bridge.ts`.
3. **Lib boundary:** New `protect-bridge.ts` module (singleton `ProtectApi` instance, `fetchBootstrap()`, `classifyKind()`, `TLS_SCHEME` const). Hand-rolled `protect.ts` untouched.
4. **Catalog discovery:** `orchestration/protect-hub/catalog.ts` — fetch bootstrap, derive `kind`, upsert `cameras` (source='external') + `protect_stream_catalog` rows in one transaction. Idempotent on repeated calls.
5. **Settings-Hub-Tab:** 7th tab "Protect Hub" on `/settings`. Hub-Tab renders cache-vs-fresh: empty cache → auto-discover spinner; populated cache → instant render + "Aktualisieren" button. UDM unreachable → orange banner + cache fallback.

**Primary recommendation:** Plan 01 = TLS spike (sets the const that everything imports). Plan 02 = schema migration + new deps install (irreversible — gate with plan-checker before execute). Plan 03 = `protect-bridge.ts` + `catalog.ts` + tests. Plan 04 = `/settings/protect-hub` Hub-Tab + ProtectHubTab.svelte + UAT.

**Critical risk:** the locked D-CLASS-01 derivation rule references a `manufacturer` field that does not exist on the typed `ProtectCameraConfigInterface`. The discrepancy must be surfaced to the user before P19 plans execute. See §Open Questions Resolved → Q-OPEN-01 for the proposed alternative discriminator (`isThirdPartyCamera` boolean + `marketName` substring).

---

## Phase Boundary

**In scope:** schema irreversibility (`cameras.mac`, `cameras.source`, 3 new tables); installed `unifi-protect@^4.29.0` + `yaml@^2.6.0`; `protect-bridge.ts` (singleton client, bootstrap fetch, `classifyKind`, `TLS_SCHEME` const); `orchestration/protect-hub/catalog.ts` (discover + upsert); `/api/protect-hub/discover` POST endpoint; `/settings/protect-hub/+page.svelte` Hub-Tab (read-only); 7th tab in `src/routes/settings/+page.svelte`; TLS spike artifact at `.planning/research/v1.3/spikes/p19-tls-rtspx.md`.

**Out of scope (handled by later phases):** Bridge LXC provisioning (P20), reconciler tick (P21), `/cameras` integration with external badge (P22), Wizard Steps 2-6 (P20+P22), offboarding (P23), per-channel `enableRtsp` writes (P21+P23), `cameras.id` mutation paths, any multi-bridge logic.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pseudo-migration on boot | DB / boot path | — | Existing pattern in `src/lib/server/db/client.ts`; reuse |
| Bootstrap fetch + auth (Protect API) | Backend / Server-only service | — | Singleton lib client lives server-side; never reaches the browser |
| Catalog upsert (DB writes) | Backend / Orchestration | — | `orchestration/protect-hub/catalog.ts` runs in a single SQLite transaction |
| TLS scheme const | Backend / Service module | — | `protect-bridge.ts` exports `TLS_SCHEME`; all later phases import |
| `/api/protect-hub/discover` endpoint | Backend / SvelteKit `+server.ts` route | — | Trigger for the orchestration; thin wrapper around `catalog.discover()` |
| Settings-Hub-Tab page load | Frontend Server (SSR) | Frontend Client | `+page.server.ts` reads cached catalog from SQLite; `+page.svelte` renders + handles "Aktualisieren" button (POSTs to discover endpoint) |
| Hub-Tab badge / table rendering | Frontend Client (Svelte 5) | — | Pure render of server-loaded data; minimal client interactivity |
| Classification (`classifyKind`) | Backend / Service module | — | Lives in `protect-bridge.ts` next to lib boundary; never on the client |

---

## API Surface: `unifi-protect@4.29.0` Bootstrap Shape

> All claims in this section are **`[VERIFIED]`** against the live source at `https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-types.ts` (commit `main`, fetched 2026-04-30). Line numbers cited.

### 1. The Calling Pattern (verified)

```typescript
// From src/protect-api.ts:32-38 (JSDoc example)
import { ProtectApi } from "unifi-protect";

const protect = new ProtectApi();
await protect.login("192.168.3.1", "admin", "<password>");  // boolean return
await protect.getBootstrap();                                // boolean return
const cameras = protect.bootstrap?.cameras ?? [];            // ProtectCameraConfig[]
```

`protect.bootstrap` is `Nullable<ProtectNvrBootstrap>` — null until `getBootstrap()` succeeds. `[VERIFIED: protect-api.ts:254]`

### 2. `cameras[]` shape (`ProtectCameraConfigInterface`)

`extends ProtectDeviceBaseInterface` — so it inherits these fields `[VERIFIED: protect-types.ts:855]`:

| Field | Type | Required? | P19 use |
|-------|------|-----------|---------|
| `id` | `string` | required (inherited) | denormalized cache → `cameras.external_id` |
| `mac` | `string` | required (inherited, line 165 echoed at 356) | **PK identity** — normalize lowercase, strip separators → `cameras.mac` |
| `marketName` | `string` | required (inherited) | display "model" → `cameras.model` (e.g. "G4 Bullet", "Mobotix S15") |
| `name?` | `string` | **optional** (inherited; the `?` matters) | display name; can be undefined → fall back to `displayName` |
| `displayName` | `string` | required (inherited) | display name fallback |
| `type` | `string` | required (inherited) | secondary discriminator (e.g. "UVC G4 Bullet") |
| `modelKey` | `"camera"` | required literal | filter — only `modelKey === 'camera'` rows go in catalog |
| `state` | `string` | required (inherited) | "CONNECTED" / "DISCONNECTED" — surface in UI |
| `host` | `string` | required (inherited) | UDM host IP |
| `isAdopted` | `boolean` | required (inherited) | filter — skip non-adopted cams |
| `isConnected` | `boolean` | required (inherited) | UI status |
| `isThirdPartyCamera` | `boolean` | **required** | `[VERIFIED: protect-types.ts:788]` **THIS IS THE REAL THIRD-PARTY DISCRIMINATOR.** See §Risks #2 — D-CLASS-01 should use this, not a non-existent `manufacturer`. |
| `videoCodec` | `string` | required | `[VERIFIED: protect-types.ts:1053]` — camera-level, NOT channel-level. "h264" / "h265". → `protect_stream_catalog.codec` for ALL channels of this cam (single value, propagated to each row). |
| `channels` | `ProtectCameraChannelConfigInterface[]` | required (line 410) | `protect_stream_catalog` rows iterated per-channel |

**Fields NOT present on the typed interface** (verified by full-file grep):
- ❌ `manufacturer` — the locked D-CLASS-01 rule references this; it does not exist. `[VERIFIED: full-file grep, no match for "manufacturer", "make", "vendor", "brand"]`
- ❌ `vendor`
- ❌ Per-channel `codec` — codec is camera-level only

### 3. `cameras[].channels[]` shape (`ProtectCameraChannelConfigInterface`)

`[VERIFIED: protect-types.ts]`. All fields are required (no `?`):

```typescript
export interface ProtectCameraChannelConfigInterface {
  autoBitrate: boolean;
  autoFps: boolean;
  bitrate: number;                          // bps; divide by 1000 for kbps
  enabled: boolean;                         // channel master enable
  fps: number;
  fpsValues: number[];                      // available fps options
  height: number;
  id: number;                               // channel id (0=High, 1=Medium, 2=Low conventionally — but DO NOT rely on order)
  idrInterval: number;                      // GOP / keyframe interval
  internalRtspAlias: Nullable<string>;      // null when internal RTSP off
  isInternalRtspEnabled: boolean;
  isRtspEnabled: boolean;                   // **THE TOGGLE** — false means no rtspAlias is exposed
  maxBitrate: number;
  minBitrate: number;
  minClientAdaptiveBitRate: number;
  minMotionAdaptiveBitRate: number;
  name: string;                             // "High" | "Medium" | "Low" (or arbitrary on third-party cams)
  rtspAlias: string;                        // empty string when isRtspEnabled=false
  validBitrateRangeMargin: Nullable<number>;
  videoId: string;
  width: number;
  [key: string]: ProtectKnownJsonValue;     // index sig — covers stuff the typed interface misses
}
```

**Single-channel cam edge case (HUB-CAT-06):** the type does NOT constrain `channels.length`. A cam can have `channels.length === 1` (low-end models, some firmwares with manual disable, or third-party cams with only one stream profile). Catalog UI MUST iterate `channels[]` and render one row per element, never assume 3 fixed slots. `[VERIFIED: type signature; no length constraint]`

### 4. Field Confidence for Catalog Rendering

| Field | Confidence | Source |
|-------|------------|--------|
| `cam.mac` | HIGH — required string | `[VERIFIED: protect-types.ts:356]` |
| `cam.id` | HIGH — required string | `[VERIFIED: protect-types.ts ProtectDeviceBaseInterface]` |
| `cam.marketName` | HIGH — required string | `[VERIFIED: protect-types.ts:356]` |
| `cam.type` | HIGH — required string | `[VERIFIED: protect-types.ts ProtectDeviceBaseInterface]` |
| `cam.isThirdPartyCamera` | HIGH — required boolean | `[VERIFIED: protect-types.ts:788]` |
| `cam.videoCodec` | HIGH — required string | `[VERIFIED: protect-types.ts:1053]` |
| `cam.name` | MEDIUM — **optional** (note `?`); fall back to `displayName` | `[VERIFIED: protect-types.ts ProtectDeviceBaseInterface]` |
| `ch.bitrate / ch.fps / ch.width / ch.height` | HIGH — required numbers | `[VERIFIED: ProtectCameraChannelConfigInterface]` |
| `ch.isRtspEnabled` | HIGH — required boolean | same |
| `ch.rtspAlias` | HIGH — required string (empty when disabled) | same |
| `cam.manufacturer` | **DOES NOT EXIST** | `[VERIFIED: full-file grep returned no matches]` |

---

## Schema Migration Pattern

### Existing pseudo-migration in `src/lib/server/db/client.ts`

`[VERIFIED: src/lib/server/db/client.ts:44-48]`

```typescript
function ensureColumn(table: string, column: string, definition: string): void {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((r) => r.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```

This helper is called inline at module load (lines 50-54). To add P19 columns, **append calls to the existing list** — do NOT refactor the helper.

### P19 additions to `src/lib/server/db/client.ts`

Append after line 54:

```typescript
// v1.3 Phase 19 — Protect Stream Hub schema lock
// MAC-as-PK for source='external' rows (irreversible after this commit per L-1)
ensureColumn('cameras', 'source', "TEXT NOT NULL DEFAULT 'managed'");
ensureColumn('cameras', 'mac', 'TEXT');                      // NULL for managed; required by app logic for external (NOT NULL DEFAULT NULL is the cleanest you can do via ALTER TABLE in SQLite — actual NOT-NULL invariant enforced in catalog upsert + a runtime check; documented in catalog.ts)
ensureColumn('cameras', 'external_id', 'TEXT');              // protect cam UUID for source='external'; denormalized cache only — never join on this
ensureColumn('cameras', 'hub_bridge_id', 'INTEGER');         // FK → protect_hub_bridges.id; NULL for managed
ensureColumn('cameras', 'manufacturer', 'TEXT');             // denormalized — see §Risks #2 for what this is filled from given the lib doesn't expose `manufacturer`
ensureColumn('cameras', 'kind', "TEXT NOT NULL DEFAULT 'unknown'");  // 'first-party' | 'third-party' | 'unknown'
// `cameras.model` already exists from Phase 18 (line 51) — REUSE for marketName, do NOT re-add
```

**Important note about `cameras.model`:** Phase 18 already added `cameras.model` for Bambu A1/H2C SSDP model codes (`'A1'`, `'H2C'`, `'O1C2'`). Reusing the same column for Protect cams (`marketName` like "G4 Bullet") is acceptable because the column is generic free-text. Plan-checker should verify both code paths (Bambu writer + Protect writer) treat the column as opaque text — no migration needed. `[VERIFIED: src/lib/server/db/schema.ts:50-54 + src/lib/server/db/client.ts:51]`

### P19 new tables — append after the `users` `CREATE TABLE IF NOT EXISTS` block

```typescript
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

// Optional but recommended: support fast lookup by camera-id + quality
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_stream_catalog_cam ON protect_stream_catalog(camera_id)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_camera_outputs_cam ON camera_outputs(camera_id)`);
```

### Drizzle schema additions to `src/lib/server/db/schema.ts`

Append after the `events` table:

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

export const cameraOutputs = sqliteTable('camera_outputs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').notNull(),
  outputType: text('output_type').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  config: text('config').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const protectStreamCatalog = sqliteTable('protect_stream_catalog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').notNull(),
  quality: text('quality').notNull(),
  codec: text('codec'),
  width: integer('width'),
  height: integer('height'),
  fps: integer('fps'),
  bitrate: integer('bitrate'),
  rtspUrl: text('rtsp_url'),
  shareEnabled: integer('share_enabled', { mode: 'boolean' }).notNull().default(false),
  cachedAt: text('cached_at').notNull().$defaultFn(() => new Date().toISOString())
});
```

Also extend the existing `cameras` table in `schema.ts` with the 6 new fields (`source`, `mac`, `externalId`, `hubBridgeId`, `manufacturer`, `kind`). This keeps the Drizzle types in sync with the runtime ALTER TABLEs. **Both must be updated in the same plan task** to avoid type drift.

### Ordering Considerations

1. The `ensureColumn()` calls and `CREATE TABLE IF NOT EXISTS` runs every time the app boots — they MUST be idempotent. Verified by reading the helper: PRAGMA-table_info-check before ALTER; CREATE-IF-NOT-EXISTS guards the new tables.
2. Order doesn't matter for the `cameras` column adds (independent ALTERs).
3. New tables don't depend on each other — `cameras.hub_bridge_id` is a logical FK to `protect_hub_bridges.id` but SQLite doesn't enforce it without an explicit `FOREIGN KEY` clause (we don't add one — matches existing project convention; FK enforcement happens in app code).
4. **No CREATE INDEX on `cameras.mac`:** existing project convention is no indexes outside PKs; adding one for v1.3 introduces inconsistency. The catalog query patterns (UPSERT by `external_id`, list by `source='external'`) are fine on a table with <100 rows.

---

## TLS Spike Plan-Task

> This is the FIRST plan-task of P19 per D-TLS-01. Spike runs against real UDM at 192.168.3.1; output drives the const value in `protect-bridge.ts`.

### What the spike does (step-by-step)

1. **Pre-step (no spike code yet):** verify a Protect cam has its "Share Livestream → Enable Secure RTSPS Output" toggle ON in the user's UDM. The spike alias must be a real, currently-shared stream. (One-time human action documented in the plan-task description.)
2. **Provision throwaway LXC** via existing `proxmox.ts createContainer()` — Debian 13 + ffmpeg pre-installed. Hostname: `p19-tls-spike`. NO `/dev/dri` passthrough (we don't transcode here). Sized: 512 MB RAM, 1 core.
3. **Install ffmpeg** in the LXC (the existing `go2rtc.ts getInstallCommands(forBambuA1=false)` includes ffmpeg; reuse via SSH execution).
4. **Run probe (variant A — `rtspx://`):**
   ```bash
   ffprobe -v info -show_format -show_streams \
     -i "rtspx://192.168.3.1:7441/<rtspAlias>?enableSrtp" \
     -timeout 5000000 \
     2>&1 | tee /tmp/rtspx-probe.txt
   ```
5. **Run probe (variant B — `rtsp://` + `tls_verify=0`):**
   ```bash
   ffprobe -v info -show_format -show_streams \
     -tls_verify 0 \
     -i "rtsps://192.168.3.1:7441/<rtspAlias>?enableSrtp" \
     -timeout 5000000 \
     2>&1 | tee /tmp/rtsps-probe.txt
   ```
6. **Capture both outputs** + the LXC's ffmpeg version banner + the Protect cam's `videoCodec`/`width`/`height` (from a separate `unifi-protect` lib call run from the app side, NOT from inside the LXC).
7. **Write findings** to `.planning/research/v1.3/spikes/p19-tls-rtspx.md` with the structure below.
8. **Destroy the spike LXC** (`pct destroy <vmid>` via existing helpers). The spike is one-shot — leaves nothing behind on Proxmox.
9. **Commit** the spike findings file (per `commit_docs` config). The plan-task's COMPLETE marker contains the chosen scheme.

### Expected ffprobe output

**Variant A success (`rtspx://`):**
```
Input #0, rtsp, from 'rtspx://192.168.3.1:7441/<alias>?enableSrtp':
  Metadata:
    title           : Session streamed by "<server>"
  Duration: N/A, start: ..., bitrate: N/A
    Stream #0:0: Video: h264 (Main), yuv420p, 1920x1080, ..., 15 fps, ...
    Stream #0:1: Audio: aac, 16000 Hz, mono, fltp
```

**Variant A failure (TLS rejected):**
```
[tls @ 0x...] Certificate verify failed
[rtsp @ 0x...] method DESCRIBE failed: 401 Unauthorized
[rtsp @ 0x...] Server returned 401 Unauthorized (authorization failed)
```
or
```
rtspx://...: Server returned 5XX Internal Server Error
```

**Variant B success (`rtsps://` + `-tls_verify 0`):**
```
[tls @ 0x...] Skipping TLS verification (tls_verify=0)
Input #0, rtsp, from 'rtsps://192.168.3.1:7441/<alias>?enableSrtp':
  ...
```
Same stream metadata as Variant A.

### Findings file structure (`.planning/research/v1.3/spikes/p19-tls-rtspx.md`)

```markdown
# P19 Spike — TLS Scheme for Protect RTSPS Streams

**Date:** 2026-04-30
**Run by:** P19 Plan 01 Task 01 (automated)
**Target UDM:** 192.168.3.1 (firmware version: <captured from Protect bootstrap>)
**Test alias:** <rtspAlias of one shared cam>

## Result: <CHOSEN SCHEME>

`TLS_SCHEME = '<rtspx | rtsps-tls-verify-0>'`

## Variant A — `rtspx://`
Command: `<exact command>`
Result: <SUCCESS | FAILURE>
Output: ```<full ffprobe stderr>```

## Variant B — `rtsps://` + `-tls_verify 0`
Command: `<exact command>`
Result: <SUCCESS | FAILURE>
Output: ```<full ffprobe stderr>```

## Decision Rationale
<2-3 sentences. If both succeeded, prefer `rtspx://` (cleaner; go2rtc-native). If only B succeeded, use B + `-tls_verify 0` flag in ffmpeg exec strings.>

## Implications for Later Phases
- **P21 yaml-builder** imports `TLS_SCHEME` from `protect-bridge.ts` and emits the chosen scheme in every `streams[]` source URL for `frigate-rtsp` outputs and every `exec:ffmpeg ... -i <url>` for `loxone-mjpeg` outputs.
- **P23 share-toggle** uses the same scheme when probing channel availability post-toggle.

## Reproducibility
- Spike LXC was destroyed after run; vmid recorded above for audit.
- Re-running this spike in the future requires a Protect cam with active "Enable Secure RTSPS Output" toggle.
```

### How the const lock works in `protect-bridge.ts`

```typescript
// src/lib/server/services/protect-bridge.ts
// TLS scheme for upstream Protect RTSPS streams.
// Result of P19 spike — see .planning/research/v1.3/spikes/p19-tls-rtspx.md
// DO NOT change this without re-running the spike against the same UDM firmware.
export const TLS_SCHEME = 'rtspx' as const;  // OR 'rtsps-tls-verify-0' if spike chose that
//                       ^^^^^^^^
//                       VALUE LOCKED BY SPIKE — only change with audit trail

// Helper to construct URLs based on the locked scheme
export function protectStreamUrl(host: string, rtspAlias: string): string {
  if (TLS_SCHEME === 'rtspx') {
    return `rtspx://${host}:7441/${rtspAlias}?enableSrtp`;
  }
  // 'rtsps-tls-verify-0' — caller passes -tls_verify 0 in ffmpeg flags
  return `rtsps://${host}:7441/${rtspAlias}?enableSrtp`;
}
```

The const is a TypeScript literal type — any later phase importing it gets compile-time guarantees about the available cases. P21's yaml-builder pattern-matches on this const to choose between emitting just-the-URL vs. the URL plus the `-tls_verify 0` flag.

---

## `protect-bridge.ts` Module Skeleton

> Location locked by D-LIB-02: `src/lib/server/services/protect-bridge.ts` (NOT under `orchestration/`).

### Proposed module shape

```typescript
// src/lib/server/services/protect-bridge.ts
import 'server-only';  // explicit guard — never bundle to client
import { ProtectApi, type ProtectCameraConfig } from 'unifi-protect';
import { getSettings } from './settings';

// ────────────────────────────────────────────────────────────────────────────
// TLS scheme — locked by P19 spike, see .planning/research/v1.3/spikes/p19-tls-rtspx.md
// ────────────────────────────────────────────────────────────────────────────
export type TlsScheme = 'rtspx' | 'rtsps-tls-verify-0';
export const TLS_SCHEME: TlsScheme = 'rtspx';  // LOCKED — re-run spike to change

// ────────────────────────────────────────────────────────────────────────────
// Lib client singleton
// ────────────────────────────────────────────────────────────────────────────
let _client: ProtectApi | null = null;
let _loginExpiresAt = 0;
const LOGIN_TTL_MS = 8 * 60 * 1000;  // 8 min — matches existing protect.ts session TTL

export async function getProtectClient(): Promise<ProtectApi> {
  if (_client && Date.now() < _loginExpiresAt) return _client;

  const settings = await getSettings('unifi_');
  const host = settings.unifi_host;
  const username = settings.unifi_username;
  const password = settings.unifi_password;
  if (!host) throw new Error('UniFi host not configured. Set unifi_host in Settings.');
  if (!username || !password) throw new Error('UniFi credentials not configured.');

  const client = new ProtectApi();
  const ok = await client.login(host, username, password);
  if (!ok) throw new Error('Protect login failed (lib reported false).');

  _client = client;
  _loginExpiresAt = Date.now() + LOGIN_TTL_MS;
  return client;
}

// Reset on credential change — call from settings.saveSetting() if/when key matches /^unifi_/
export function resetProtectClient(): void {
  _client = null;
  _loginExpiresAt = 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Bootstrap fetch — typed wrapper
// ────────────────────────────────────────────────────────────────────────────
export type BootstrapResult =
  | { ok: true; cameras: ProtectCameraConfig[] }
  | { ok: false; reason: 'controller_unreachable' | 'auth_failed' | 'unknown'; error: Error };

export async function fetchBootstrap(): Promise<BootstrapResult> {
  try {
    const client = await getProtectClient();
    const ok = await client.getBootstrap();
    if (!ok) return { ok: false, reason: 'unknown', error: new Error('getBootstrap returned false') };
    const cameras = client.bootstrap?.cameras ?? [];
    // Filter to cameras only (modelKey === 'camera') — defensive; bootstrap also has nvr, lights, sensors
    const cams = cameras.filter((c) => c.modelKey === 'camera') as ProtectCameraConfig[];
    return { ok: true, cameras: cams };
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not configured')) return { ok: false, reason: 'auth_failed', error: e };
    if (e.message.match(/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ENOTFOUND/i)) {
      return { ok: false, reason: 'controller_unreachable', error: e };
    }
    return { ok: false, reason: 'unknown', error: e };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Classification — first/third/unknown
// See §Open Questions Resolved → Q-OPEN-01 for the discriminator rationale.
// ────────────────────────────────────────────────────────────────────────────
export type CameraKind = 'first-party' | 'third-party' | 'unknown';

export function classifyKind(camera: ProtectCameraConfig): CameraKind {
  // PRIMARY: isThirdPartyCamera boolean (the lib-typed third-party indicator).
  // Verified at protect-types.ts:788 — required boolean, set by the controller during adoption.
  if (camera.isThirdPartyCamera === true) return 'third-party';
  if (camera.isThirdPartyCamera === false) {
    // Confirmed first-party; sanity-check via marketName/type for audit logging.
    return 'first-party';
  }
  // Defensive: lib type says required, but be safe against future API drift.
  return 'unknown';
}

// Helper — what we expose as `manufacturer` to the catalog UI given the lib has no such field.
// "Ubiquiti" for first-party, marketName-derived hint for third-party, '?' for unknown.
export function deriveManufacturerHint(camera: ProtectCameraConfig, kind: CameraKind): string {
  if (kind === 'first-party') return 'Ubiquiti';
  if (kind === 'third-party') {
    // marketName for third-party cams is set at adoption time and is often "Mobotix S15", "Hikvision DS-XYZ", etc.
    // Take the first whitespace-delimited token as the brand. Fall back to the full string.
    return camera.marketName?.split(/\s+/)[0] ?? 'Unknown';
  }
  return 'Unknown';
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (will be extended in P21 + P23)
// ────────────────────────────────────────────────────────────────────────────
export function protectStreamUrl(host: string, rtspAlias: string): string {
  return TLS_SCHEME === 'rtspx'
    ? `rtspx://${host}:7441/${rtspAlias}?enableSrtp`
    : `rtsps://${host}:7441/${rtspAlias}?enableSrtp`;
}

// Normalize a MAC address to lowercase, no separators (matches our PK convention)
export function normalizeMac(mac: string): string {
  return mac.toLowerCase().replace(/[:-]/g, '');
}
```

### Why a singleton

- The lib's `ProtectApi` instance maintains an internal WebSocket and HTTP keep-alive. Re-creating it on every request triggers re-login, defeats keepalive, and burns Protect-controller CPU.
- 8-min TTL matches the existing `protect.ts` cookie TTL — same operational envelope.
- `resetProtectClient()` lets the settings-update flow drop the cached client when creds change (P19 doesn't wire the reset call yet — that's a P20+ refinement when the wizard mutates creds).

### Error handling around UDM unreachability

`fetchBootstrap()` returns a tagged result instead of throwing. This lets `catalog.discover()` upstream make a clean choice: persist nothing on `controller_unreachable`, surface the reason to the UI, leave cache untouched. The result type is exhaustive — `switch` in the caller is type-safe.

---

## `/settings/protect-hub` Page

> Per HUB-WIZ-01: a 7th tab on the existing `/settings` page. Per D-REFRESH-01: cache-vs-fresh branching on first load.

### Approach: extend existing `/settings` rather than create separate route

The existing `/settings/+page.svelte` `[VERIFIED: src/routes/settings/+page.svelte:11]` already has a 6-tab pattern:

```typescript
const tabs = ['Proxmox', 'UniFi', 'Credentials', 'Backup', 'Version', 'Zugangsschutz'] as const;
```

P19 adds `'Protect Hub'` as the 7th entry. The tab body delegates to a new `ProtectHubTab.svelte` (mirrors the existing `BackupTab.svelte` / `VersionTab.svelte` pattern).

### Server load shape (`+page.server.ts`)

The existing `/settings/+page.server.ts` (current) loads Proxmox + UniFi + auth state. Extend it to also pre-load the catalog state:

```typescript
// src/routes/settings/+page.server.ts (additive)
import { db } from '$lib/server/db/client';
import { cameras, protectStreamCatalog } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/services/settings';
import { eq } from 'drizzle-orm';

export const load = async () => {
  // ... existing Proxmox, UniFi, Auth loads ...

  // Hub-Tab load (read-only; no fetching from UDM here — that happens via POST /api/protect-hub/discover)
  const hubEnabled = (await getSetting('protect_hub_enabled')) === 'true';
  const externalCams = db.select().from(cameras).where(eq(cameras.source, 'external')).all();
  const catalog = db.select().from(protectStreamCatalog).all();

  // Group catalog rows by camera_id for the UI
  const catalogByCam = new Map<number, typeof catalog>();
  for (const row of catalog) {
    if (!catalogByCam.has(row.cameraId)) catalogByCam.set(row.cameraId, []);
    catalogByCam.get(row.cameraId)!.push(row);
  }

  // Are creds configured? — drives Q-OPEN-04 fallback UI
  const unifiHost = await getSetting('unifi_host');
  const unifiUsername = await getSetting('unifi_username');
  const credsConfigured = !!(unifiHost && unifiUsername);

  return {
    // ... existing fields ...
    protectHub: {
      enabled: hubEnabled,
      credsConfigured,
      cams: externalCams,
      catalogByCamId: Object.fromEntries(catalogByCam),  // serializable
      lastDiscoveredAt: catalog.length > 0 ? Math.max(...catalog.map((r) => Date.parse(r.cachedAt))) : null
    }
  };
};
```

### Client UI primitives (`ProtectHubTab.svelte`)

```svelte
<script lang="ts">
  import { Eye, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-svelte';
  let { data } = $props();
  let refreshing = $state(false);
  let unreachable = $state(false);  // toggled by /api/protect-hub/discover error response

  async function refresh() {
    refreshing = true;
    unreachable = false;
    try {
      const res = await fetch('/api/protect-hub/discover', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json();
        if (body.reason === 'controller_unreachable') unreachable = true;
        else throw new Error(body.error || 'discover failed');
      }
      // SvelteKit's invalidate to re-fetch +page.server.ts data
      await import('$app/navigation').then(({ invalidateAll }) => invalidateAll());
    } finally {
      refreshing = false;
    }
  }

  // Auto-discover on first mount when cache is empty (D-REFRESH-01)
  $effect(() => {
    if (data.protectHub.credsConfigured && data.protectHub.cams.length === 0 && !refreshing) {
      refresh();
    }
  });
</script>

<!-- cache-vs-fresh branch -->
{#if !data.protectHub.credsConfigured}
  <!-- Q-OPEN-04 resolution: tab visible, deep-link to UniFi-tab -->
  <div class="rounded border border-yellow-500/30 bg-yellow-500/10 p-4">
    <p class="text-text-primary">Konfiguriere zuerst die UniFi-Verbindung, um den Protect Hub zu nutzen.</p>
    <button onclick={() => /* tab switch to UniFi */} class="mt-2 inline-flex items-center gap-2 text-accent">
      Zur UniFi-Konfiguration <ExternalLink class="h-4 w-4" />
    </button>
  </div>
{:else}
  <header class="flex items-center justify-between mb-4">
    <h2 class="text-lg font-semibold">Protect Hub — Stream-Katalog</h2>
    <button onclick={refresh} disabled={refreshing} class="...">
      <RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
      Aktualisieren
    </button>
  </header>

  {#if unreachable}
    <div class="rounded border border-orange-500/30 bg-orange-500/10 p-3 mb-4 flex items-start gap-2">
      <AlertTriangle class="h-5 w-5 text-orange-400 flex-shrink-0" />
      <div>
        <p class="font-medium">Controller nicht erreichbar</p>
        <p class="text-sm text-text-secondary">
          Anzeige aus Cache. Letzte Aktualisierung: {data.protectHub.lastDiscoveredAt
            ? new Date(data.protectHub.lastDiscoveredAt).toLocaleString('de-DE')
            : 'noch nie'}
        </p>
      </div>
    </div>
  {/if}

  {#if data.protectHub.cams.length === 0 && !refreshing}
    <p class="text-text-secondary">Noch keine Protect-Cams gefunden. Klicke auf "Aktualisieren".</p>
  {:else}
    <table class="w-full">
      <thead><tr><th>Cam</th><th>Hersteller</th><th>Modell</th><th>MAC</th><th>Klassifizierung</th><th>Streams</th></tr></thead>
      <tbody>
        {#each data.protectHub.cams as cam}
          <tr>
            <td>{cam.name}</td>
            <td>{cam.manufacturer ?? '?'}</td>
            <td>{cam.model ?? '?'}</td>
            <td class="font-mono">{cam.mac}</td>
            <td>
              <KindBadge kind={cam.kind} />
            </td>
            <td>
              <!-- Iterate channels — NO 3-row hardcode (HUB-CAT-06) -->
              {#each data.protectHub.catalogByCamId[cam.id] ?? [] as ch}
                <div class="text-xs">
                  <span class="font-medium">{ch.quality}</span>
                  · {ch.codec} · {ch.width}×{ch.height} @ {ch.fps}fps · {Math.round(ch.bitrate / 1000)}kbps
                </div>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}
```

### Cache-vs-fresh rendering branch

| State | Cache | Branch | UI |
|-------|-------|--------|-----|
| Fresh install, no creds | empty | "Konfiguriere UniFi" deep-link card | Yellow banner with link |
| Creds OK, cache empty | empty | `$effect` auto-runs `refresh()` | Spinner during fetch; populated table after |
| Creds OK, cache populated | non-empty | Render cached rows immediately | Table renders instantly; banner if last discover failed |
| Creds OK, UDM unreachable | populated cache | Render cached rows + orange banner | "Controller nicht erreichbar — Anzeige aus Cache" + last-discovery-ts |

### "Controller unreachable" banner

The orange banner is set by the discover endpoint's structured error response (`{ ok: false, reason: 'controller_unreachable' }`). The cache continues to render — never blank, never error-page.

---

## Validation Architecture

> Required because `workflow.nyquist_validation` is not explicitly disabled — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 `[VERIFIED: package.json devDependencies]` |
| Config file | `vite.config.ts` / `vitest.config.ts` (existing) |
| Quick run command | `npm run test:unit -- --run -t "<test-name-pattern>"` |
| Full suite command | `npm run test` |
| Phase gate | Full suite green before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| HUB-CAT-02 | Catalog rows correctly populated from bootstrap fixture | unit | `npm run test:unit -- --run tests/server/orchestration/protect-hub/catalog.test.ts` | ❌ Wave 0 — file does not yet exist |
| HUB-CAT-03 | `classifyKind()` returns first-party for `isThirdPartyCamera=false` | unit | `npm run test:unit -- --run tests/server/services/protect-bridge.test.ts -t "classifyKind"` | ❌ Wave 0 |
| HUB-CAT-03 | `classifyKind()` returns third-party for `isThirdPartyCamera=true` | unit | same | ❌ Wave 0 |
| HUB-CAT-05 | `fetchBootstrap()` returns `{ok:false, reason:'controller_unreachable'}` on ECONNREFUSED | unit | `npm run test:unit -- --run tests/server/services/protect-bridge.test.ts -t "fetchBootstrap unreachable"` | ❌ Wave 0 |
| HUB-CAT-06 | Catalog renders 1 row for single-channel cam, 3 rows for triple-channel cam | unit (integration-flavor) | `npm run test:unit -- --run tests/server/orchestration/protect-hub/catalog.test.ts -t "single-channel"` | ❌ Wave 0 |
| HUB-CAT-04 / D-REFRESH-01 | Initial-auto: empty cache + first page load triggers `discover()` | integration (Vitest with jsdom) | `npm run test:unit -- --run tests/routes/settings/protect-hub-tab.test.ts -t "auto-discover"` | ❌ Wave 0 |
| HUB-CAT-04 | Manual refresh button POSTs to `/api/protect-hub/discover` | integration | same file | ❌ Wave 0 |
| HUB-WIZ-01 | 7th "Protect Hub" tab is visible on `/settings` | integration / smoke | `npm run test:unit -- --run tests/routes/settings/tabs.test.ts -t "Protect Hub tab"` | ❌ Wave 0 |
| (Schema irreversibility) | `cameras.source` defaults to `'managed'` for existing rows after migration | integration (real SQLite) | `npm run test:unit -- --run tests/server/db/migration.test.ts -t "P19 schema"` | ❌ Wave 0 |
| (Idempotency) | Calling `discover()` twice with same bootstrap produces identical DB state | integration | `npm run test:unit -- --run tests/server/orchestration/protect-hub/catalog.test.ts -t "idempotent"` | ❌ Wave 0 |
| (TLS spike) | Spike artifact exists at `.planning/research/v1.3/spikes/p19-tls-rtspx.md` and `TLS_SCHEME` const matches | integration / smoke | `npm run test:unit -- --run tests/server/services/protect-bridge.test.ts -t "TLS_SCHEME"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --run tests/server/services/protect-bridge.test.ts tests/server/orchestration/protect-hub/`
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/server/services/protect-bridge.test.ts` — covers HUB-CAT-03 (classifyKind), HUB-CAT-05 (fetchBootstrap unreachable), TLS_SCHEME presence
- [ ] `tests/server/orchestration/protect-hub/catalog.test.ts` — covers HUB-CAT-02 (catalog upsert), HUB-CAT-06 (single-channel), idempotency
- [ ] `tests/server/db/migration.test.ts` — covers schema irreversibility (P19 schema lock)
- [ ] `tests/routes/settings/protect-hub-tab.test.ts` — covers HUB-CAT-04 (initial-auto + manual refresh) and HUB-CAT-05 banner
- [ ] `tests/routes/settings/tabs.test.ts` — covers HUB-WIZ-01 (7th tab present)
- [ ] `tests/fixtures/protect-bootstrap-*.json` — 4 fixture files for catalog tests:
  - `protect-bootstrap-first-party-3-channel.json` — UniFi G4 Bullet, 3 channels enabled
  - `protect-bootstrap-third-party-1-channel.json` — Mobotix-via-adopt, single channel
  - `protect-bootstrap-third-party-isThirdPartyCamera-true.json` — Hikvision adopted, multi-channel
  - `protect-bootstrap-empty.json` — no cameras
- [ ] **Mocking strategy:** Use Vitest `vi.mock('unifi-protect')` to provide a stub `ProtectApi` class whose `getBootstrap()` returns canned fixture data. Catalog tests run against an in-memory better-sqlite3 instance (`new Database(':memory:')`) seeded with the P19 migrations. This pattern matches Phase 18's test approach `[VERIFIED: existing tests/ folder convention from v1.2]`.
- [ ] No framework install needed — Vitest 4.1.0 + jsdom already configured.

### Manual UAT (covered by `/gsd-verify-work` checkpoint)

- [ ] Open `/settings`, click "Protect Hub" tab — table appears, populated from real UDM 192.168.3.1
- [ ] Verify ≥1 row per Protect cam (one user has G4 + 1 Bambu-via-adopt = 2 expected)
- [ ] Verify single-channel cam (if any) renders 1 quality row, not 3
- [ ] Click "Aktualisieren" — spinner shows, then refreshes
- [ ] Stop UniFi controller (or block port 443 to it briefly), click "Aktualisieren" — orange banner shows, table still rendered from cache
- [ ] Open `data/ip-cam-master.db` in `sqlite3` and verify: `SELECT mac, source, kind, manufacturer, model FROM cameras WHERE source='external';` returns lowercased no-separator MACs

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Protect REST API client (cookie + CSRF + WebSocket) | Hand-rolled `fetch()` for the new bootstrap path | `unifi-protect@^4.29.0` `ProtectApi` class | The lib handles cookie+CSRF+session refresh+WS+typed responses; rewriting it is the failure mode of v1.0/v1.1 `protect.ts` |
| TLS scheme for Protect RTSPS | Inline `if rtspx-fails-then-rtsps` runtime probing | Const `TLS_SCHEME` set once by P19 spike | Probing at runtime adds latency, breaks idempotency, leaks "did spike find rtspx" into every reconcile |
| Bootstrap-shape parsing | Manual JSON shape validation with Zod | Trust the lib's TypeScript types | `protect-types.ts` is auto-derived from the live API; adding our own Zod layer is double-work and out-of-date the moment Protect ships a new field |
| Pseudo-migration | Hand-written `IF NOT EXISTS` SQL strings outside `client.ts` | `ensureColumn()` already in `client.ts` | Existing pattern; introducing a second pattern fragments the migration story before v1.4's real Drizzle migration system |
| MAC normalization | Multiple variants per call site | `normalizeMac()` helper in `protect-bridge.ts` | Single source of truth; if normalization bug exists, fix it once |

**Key insight:** P19 is a "thin wiring" phase. Every line of bespoke code is a maintenance liability. Lean on the lib + existing primitives.

---

## Common Pitfalls

### Pitfall 1: Mistaking lib types for live API shape

**What goes wrong:** the locked D-CLASS-01 references a `manufacturer` field that doesn't exist on the lib's typed interface. If a plan task is written assuming `camera.manufacturer` is readable, runtime returns `undefined` and classification falls through to `'unknown'` for every cam.

**Why:** the original research file mentioned "`manufacturer` from Protect bootstrap" as if it were a published field. It isn't — it conflates Home Assistant's UniFi Protect integration (which exposes a derived `manufacturer` attribute) with the raw Protect bootstrap. The lib types are the source of truth.

**How to avoid:** treat the lib's `protect-types.ts` as canonical. If a field doesn't appear there, it doesn't exist. The actual third-party discriminator is `isThirdPartyCamera: boolean` (verified at line 788).

**Warning signs:** plan tasks that say "read `cam.manufacturer`" — those tasks will silently produce wrong classifications until UAT catches them.

### Pitfall 2: Schema irreversibility ambushes a future migration

**What goes wrong:** `cameras.mac NOT NULL` (for source='external' rows) is committed in P19. If a future v1.4+ feature decides to use `external_id` as the join key instead, every external row in production must be re-keyed.

**Why:** locked decision L-1 chose MAC-as-PK based on stability evidence (UI Help filesystem layout). The decision is correct, but its irreversibility means any plan task that loosens the invariant (e.g., `source='external_archived'` rows with `mac IS NULL`) is silently a regression.

**How to avoid:** the catalog upsert must enforce `mac NOT NULL` at the application layer (since SQLite ALTER TABLE can't add `NOT NULL` without a default that breaks existing rows). Plan-checker MUST verify the catalog upsert throws if `normalizeMac(cam.mac)` returns empty. Test the invariant explicitly.

**Warning signs:** test that asserts "rows where source='external' have mac IS NOT NULL" — if it ever fails or is removed, the irreversibility guarantee is broken.

### Pitfall 3: HUB-CAT-06 single-channel hardcode

**What goes wrong:** copy-pasting a 3-row "Low / Medium / High" template into the catalog UI. A G3 Flex with one channel renders empty cells in the Medium and High slots, and the user can't tell whether their Medium channel is "disabled" or "the camera doesn't have one."

**Why:** every existing UI in this domain (Frigate, Scrypted) shows 3-channel layouts because most cams have 3. P19 must explicitly iterate `channels[]`.

**How to avoid:** the rendering code uses `{#each catalog.channels as ch}` — never indexes into a fixed `[low, medium, high]` array. Test with a single-channel fixture covers this.

**Warning signs:** UI markup with `slot1`, `slot2`, `slot3` named bindings; HTML structure with hardcoded 3 columns; CSS with `:nth-child(3)` rules.

### Pitfall 4: UDM unreachability hides cache

**What goes wrong:** if `discover()` throws on network error, the page-load-effect catches the throw, the catalog renders empty, the user thinks the feature is broken.

**Why:** network errors and "no cams in cache yet" look identical from the UI's perspective unless explicitly distinguished.

**How to avoid:** `fetchBootstrap()` returns `{ok: false, reason: 'controller_unreachable'}` instead of throwing. The page renders cached rows + an orange banner. UAT explicitly tests this scenario by blocking the UDM port mid-session.

### Pitfall 5: Settings cache staleness on UniFi creds change

**What goes wrong:** user changes UniFi creds in the UniFi tab, then clicks "Aktualisieren" in the Protect Hub tab. The singleton client still holds the old session; `getBootstrap()` returns 401; reason classified as 'auth_failed'; user is confused because they "just fixed" the creds.

**Why:** the 30s settings cache + 8min lib client TTL stack — even after `getSettings()` returns fresh creds, the lib client still uses the old session.

**How to avoid:** wire `resetProtectClient()` into the settings save flow when key matches `/^unifi_/`. P19 plan task: extend `saveSetting()` to call `resetProtectClient()` when the key is unifi-related.

**Warning signs:** UAT step "change unifi password, then refresh hub catalog" returns auth_failed.

---

## Code Examples

### Catalog upsert (skeleton)

```typescript
// src/lib/server/orchestration/protect-hub/catalog.ts
import 'server-only';
import { db, sqlite } from '$lib/server/db/client';
import { cameras, protectStreamCatalog } from '$lib/server/db/schema';
import { fetchBootstrap, classifyKind, deriveManufacturerHint, normalizeMac } from '$lib/server/services/protect-bridge';
import { eq, and } from 'drizzle-orm';

export type DiscoverResult =
  | { ok: true; insertedCams: number; updatedCams: number; insertedChannels: number }
  | { ok: false; reason: 'controller_unreachable' | 'auth_failed' | 'unknown'; error: string };

export async function discover(): Promise<DiscoverResult> {
  const result = await fetchBootstrap();
  if (!result.ok) {
    return { ok: false, reason: result.reason, error: result.error.message };
  }

  let insertedCams = 0;
  let updatedCams = 0;
  let insertedChannels = 0;

  // Single transaction — partial failure rolls back
  const tx = sqlite.transaction(() => {
    for (const cam of result.cameras) {
      const mac = normalizeMac(cam.mac);
      if (!mac) {
        // Pitfall 2 enforcement — never insert an external cam without a MAC
        throw new Error(`Camera ${cam.id} has empty mac after normalization; refusing insert`);
      }

      const kind = classifyKind(cam);
      const manufacturer = deriveManufacturerHint(cam, kind);

      // Upsert into cameras (source='external')
      const existing = db.select().from(cameras)
        .where(and(eq(cameras.mac, mac), eq(cameras.source, 'external')))
        .all()[0];

      let cameraId: number;
      if (existing) {
        db.update(cameras).set({
          externalId: cam.id,
          name: cam.name ?? cam.displayName,
          model: cam.marketName,
          manufacturer,
          kind,
          updatedAt: new Date().toISOString()
        }).where(eq(cameras.id, existing.id)).run();
        cameraId = existing.id;
        updatedCams++;
      } else {
        // For external rows, set the legacy NOT-NULL columns to harmless defaults
        // (vmid=0, ip=cam.host, etc. — see schema.ts; managed-cam columns stay null/default).
        const inserted = db.insert(cameras).values({
          source: 'external',
          mac,
          externalId: cam.id,
          name: cam.name ?? cam.displayName,
          ip: cam.host,
          vmid: 0,  // sentinel — external cams have no LXC
          username: '',  // not applicable
          password: '',  // not applicable
          streamName: `external_${mac}`,
          model: cam.marketName,
          manufacturer,
          kind,
          status: cam.isConnected ? 'connected' : 'disconnected'
        }).returning({ id: cameras.id }).all();
        cameraId = inserted[0].id;
        insertedCams++;
      }

      // Refresh catalog rows — delete-then-insert keeps it idempotent
      // (channels can come and go on a Protect cam; we don't preserve stale rows)
      db.delete(protectStreamCatalog).where(eq(protectStreamCatalog.cameraId, cameraId)).run();

      // HUB-CAT-06: iterate channels[], do NOT assume 3
      for (const ch of cam.channels) {
        if (!ch.enabled) continue;  // skip disabled channels
        db.insert(protectStreamCatalog).values({
          cameraId,
          quality: ch.name,           // "High" / "Medium" / "Low" or arbitrary on third-party
          codec: cam.videoCodec,      // camera-level (verified line 1053)
          width: ch.width,
          height: ch.height,
          fps: ch.fps,
          bitrate: ch.bitrate,
          rtspUrl: ch.isRtspEnabled ? `${cam.host}:7441/${ch.rtspAlias}?enableSrtp` : null,
          shareEnabled: ch.isRtspEnabled
        }).run();
        insertedChannels++;
      }
    }
  });

  try {
    tx();
  } catch (err) {
    return { ok: false, reason: 'unknown', error: (err as Error).message };
  }

  return { ok: true, insertedCams, updatedCams, insertedChannels };
}
```

### `/api/protect-hub/discover` endpoint

```typescript
// src/routes/api/protect-hub/discover/+server.ts
import { json } from '@sveltejs/kit';
import { discover } from '$lib/server/orchestration/protect-hub/catalog';

export const POST = async () => {
  const result = await discover();
  if (!result.ok) {
    return json(
      { ok: false, reason: result.reason, error: result.error },
      { status: result.reason === 'controller_unreachable' ? 503 : 500 }
    );
  }
  return json(result);
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled `fetch()` to `/proxy/protect/api/cameras` (`protect.ts` v1.0) | Typed `unifi-protect@^4.29.0` lib for bootstrap + write paths | v1.3 / Phase 19 | Per-channel `bitrate/fps/width/height` available without manual JSON walking; future `enableRtsp()` writes (P23) become one-line |
| Stuff catalog data into a JSON column on `cameras` | Dedicated `protect_stream_catalog` table | locked L-4 | Reconciler in P21 can `WHERE quality='high' AND share_enabled=true` without parsing JSON |
| Use Protect cam UUID (`id`) as join key | MAC-as-PK + `external_id` denormalized | locked L-1 | Survives Protect backup/restore + re-adoption + rename without losing user output toggles |
| Per-cam container for every Protect cam | Single shared bridge LXC (later phases) | locked L-3 | One go2rtc.yaml, n streams, one VAAPI device contention surface |

**Deprecated/outdated for P19 specifically:**
- The original research suggestion to read `manufacturer` from bootstrap — **deprecated**, replaced by `isThirdPartyCamera` boolean per protect-types.ts:788. See §Risks #2.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The user's UDM exposes Protect cams' `isThirdPartyCamera` boolean correctly (true for adopted Mobotix etc., false for native UniFi). | §API Surface | Classification fails for the Mobotix-via-third-party-adopt case → first-party Hub default-ON triggers unwanted re-distribution. **Mitigation:** spike already covers reading the field; UAT explicitly checks that Mobotix S15 reads as `third-party`. |
| A2 | The user has at least one Protect cam with "Enable Secure RTSPS Output" toggled ON (required for the TLS spike to have a real alias to probe). | §TLS Spike | Spike Plan-Task 01 stalls; whole P19 blocks. **Mitigation:** the spike Plan-Task description must have a pre-step asking the user to confirm + showing them where to flip the toggle in Protect's UI. |
| A3 | The legacy NOT-NULL columns on `cameras` (`vmid`, `username`, `password`, `streamName`) will accept the sentinel/empty values written for external rows without runtime errors. | §Code Examples / catalog upsert | Insert throws on first external cam; catalog stays empty. **Mitigation:** test fixture writes a real external cam to in-memory SQLite as the FIRST integration test; failure surfaces in Wave 0. |

**If this table is empty:** N/A — three assumptions are tagged.

---

## Open Questions Resolved

### Q-OPEN-01: Does `unifi-protect.getBootstrap()` always return `manufacturer` and `type` fields?

**Answer:** `manufacturer` does NOT exist on the typed `ProtectCameraConfigInterface`. `type` exists and is required (inherited from `ProtectDeviceBaseInterface`).

**`[VERIFIED: github.com/hjdhjd/unifi-protect/src/protect-types.ts@main, full-file grep returned zero matches for "manufacturer", "make", "vendor", "brand"]`**

**Recommended replacement for D-CLASS-01:**

```
kind = 'first-party'  IF  isThirdPartyCamera === false
kind = 'third-party'  IF  isThirdPartyCamera === true
kind = 'unknown'      IF  isThirdPartyCamera is undefined (defensive — type says required, but we guard against future API drift)
```

The `manufacturer` column we add to `cameras` (per L-28) is **derived in app code**, not read from the bootstrap:
- For first-party cams: the literal string `"Ubiquiti"`.
- For third-party cams: the first whitespace-delimited token of `marketName` (e.g., "Mobotix S15" → "Mobotix"). Heuristic, not authoritative.
- For unknown: literal string `"Unknown"` + `?` qualifier badge in UI.

**Why this is better than the original D-CLASS-01:**
- `isThirdPartyCamera` is the controller's own boolean determination, set at adoption time. Most reliable signal possible.
- `marketName` substring matching is brittle; using it as PRIMARY (per original D-CLASS-01) would false-classify a UniFi cam whose `marketName` happened to start with a non-"Ubiquiti" token.
- The Mobotix-via-Protect-third-party-adopt edge case explicitly motivated D-CLASS-01 — `isThirdPartyCamera` handles it correctly because the controller knows the cam was adopted via the third-party path.

**Action required from user before P19 plans execute:** confirm the proposed replacement is acceptable. If yes, the locked D-CLASS-01 in CONTEXT.md should be amended to reference `isThirdPartyCamera` boolean instead of the non-existent `manufacturer` field.

---

### Q-OPEN-02: Exact TypeScript shape of `bootstrap.cameras[].channels[]` — are width/height/fps/bitrate always present?

**Answer:** YES, all four are required (no `?`), all `number`. Verified verbatim from `protect-types.ts`:

```typescript
export interface ProtectCameraChannelConfigInterface {
  bitrate: number;
  fps: number;
  height: number;
  width: number;
  // ... all other fields also required (no optional ones except internalRtspAlias and validBitrateRangeMargin which are Nullable<>)
}
```

**`[VERIFIED: github.com/hjdhjd/unifi-protect/src/protect-types.ts@main]`**

**However**, runtime values to be aware of:
- `bitrate` is **bps** (not kbps). UI must divide by 1000. `[CITED: lib JSDoc + UniFi developer docs]`
- `rtspAlias` is `string` but is the empty string `""` when `isRtspEnabled === false`. Test for non-empty before constructing URLs.
- `enabled` (channel master enable) and `isRtspEnabled` (RTSP-specific toggle) are different booleans. A channel can be `enabled: true` but `isRtspEnabled: false` (channel exists internally but no RTSP exposure). `[VERIFIED: separate fields in the type signature]`

---

### Q-OPEN-03: Spike result — what does ffprobe report for `rtspx://192.168.3.1:7441` against a UDM Pro with default self-signed cert?

**Answer:** The spike has not been run yet — that's Plan 01 Task 01 of P19. This question is what the spike *resolves*, not what is known a priori. What the spike's plan-task should look like is fully specified in §TLS Spike Plan-Task above.

**Probabilistic prediction (LOW confidence — for plan sizing, not as a substitute for the spike):**
- `rtspx://` is documented in go2rtc's source as a "TLS-skip variant" specifically for UniFi cams. ([go2rtc docs reference in PITFALLS.md](https://github.com/AlexxIT/go2rtc) §RTSP). Probable that it works directly against UDM 192.168.3.1.
- If `rtspx://` fails, the fallback `rtsps://` + `-tls_verify 0` is well-trodden — every Frigate/HA/Scrypted user has this in their config when pulling from UDM. Probable that it works as the fallback.
- Possible-but-unlikely failure mode: UDM firmware quirk where port 7441 is NOT actually open (some users report the port behind firewall by default in newer firmwares). The spike's pre-step (confirming a Share Livestream toggle is ON) covers this — toggling the share opens the port.

**The spike is the source of truth.** This research file does NOT assert which scheme will be chosen — that is the spike's deliverable.

---

### Q-OPEN-04: When user has no Protect creds yet, does the Hub-Tab show a deep-link to UniFi-settings, or hide entirely?

**Answer:** **Tab visible, content shows a deep-link card.**

**Rationale:**
- Hiding the tab makes the feature undiscoverable. New users wouldn't know the Hub exists.
- A deep-link card teaches the user that UniFi creds are a prerequisite + gives them the path to fix it.
- Matches the pattern from v1.0 onboarding wizard ("creds wrong → re-enter creds" is a first-class state).

**Recommended UI** (already shown in §`/settings/protect-hub` Page client primitives):

```
[ Yellow card ]
Konfiguriere zuerst die UniFi-Verbindung, um den Protect Hub zu nutzen.
[ Button: "Zur UniFi-Konfiguration →" ]
```

The button switches the active tab to "UniFi" via the existing tab-state pattern (no router push needed — the tabs are local state in `+page.svelte`).

**Edge case:** if creds exist but are wrong (401 from Protect), the discover endpoint returns `{ok:false, reason:'auth_failed'}`. The Hub-Tab in that state shows a different banner: "Anmeldung bei UniFi fehlgeschlagen. Bitte Zugangsdaten prüfen → UniFi-Tab".

---

## Risks

### Risk 1: Schema irreversibility (HUB-CAT-04, HUB-CAT-05, HUB-CAT-06 anchor)

**Concrete:** P19 commits `cameras.mac NOT NULL` for `source='external'` rows, plus 3 new tables. If a future v1.4+ feature decides to use `external_id` as the primary join key, every external row must be re-keyed; if `protect_stream_catalog`'s shape proves wrong (e.g., need a `last_validated_at` column for HUB-RCN-04 in P21), additive ALTER works but can't reorder columns.

**Mitigation:**
- Plan-checker MUST gate P19 on a manual `/gsd-discuss` review of the schema shape before plans go to execute. If anything in the column list feels uncertain, defer to a follow-up phase rather than commit-and-pray.
- Test `tests/server/db/migration.test.ts -t "P19 schema irreversibility"` asserts the invariants concretely: `cameras.source IN ('managed', 'external', 'external_archived')`; for source='external' rows, `mac IS NOT NULL`.
- Pseudo-migration uses `IF NOT EXISTS` — so re-running the boot path on an already-migrated DB is a no-op. This makes it safe to keep the migration in `client.ts` permanently across versions.

### Risk 2: `manufacturer` field does not exist (HUB-CAT-02, HUB-CAT-03 anchor)

**Concrete:** Locked decision D-CLASS-01 references reading `manufacturer` from the Protect bootstrap. The lib's typed interface has no such field (verified). Any plan task assuming `cam.manufacturer` is readable will produce universally `'unknown'` classifications until UAT catches the bug.

**Mitigation:**
- This research file's §Open Questions Resolved Q-OPEN-01 proposes the corrected discriminator: `isThirdPartyCamera` boolean.
- **The user must confirm the corrected discriminator before P19 plans execute.** Plan-checker should refuse to schedule plans until D-CLASS-01 is amended.
- The `manufacturer` text column we add to `cameras` is repurposed to store the *derived* hint (`"Ubiquiti"` for first-party, first-token-of-marketName for third-party). The catalog UI displays this column; users see a sensible value regardless.

### Risk 3: Channels-array edge cases (HUB-CAT-06 anchor)

**Concrete:** The lib type doesn't constrain `channels.length`. A G3 Flex with one channel + a UDM with the High channel disabled in Protect's UI = 1-element array. A 4K cam with a hardware-disabled channel + 2 enabled = 2-element array (with one having `enabled: false` in metadata). UI must handle both gracefully without padding empty rows or skipping the cam.

**Mitigation:**
- `catalog.ts` filters `cam.channels` by `ch.enabled` before inserting rows; `protect_stream_catalog` reflects only the cam's actual streamable inventory.
- UI iterates with `{#each catalog.channels as ch}` — no fixed slots.
- Test fixture `protect-bootstrap-third-party-1-channel.json` covers the single-channel case. UAT verifies on real hardware (the user's Mobotix S15 may be single-channel via Protect's third-party adoption).

### Risk 4: UDM unreachable during discover (HUB-CAT-05 anchor)

**Concrete:** `fetchBootstrap()` throws on network error → page-load `$effect` swallows the throw → catalog renders empty + no banner → user thinks the feature is broken.

**Mitigation:**
- `fetchBootstrap()` returns a tagged result, not a throw. The caller (`catalog.discover()`) propagates the reason; the API endpoint returns 503 on `controller_unreachable`; the UI distinguishes "no cache yet" from "cache exists but UDM offline" via the orange banner.
- Test asserts the unreachable path: mock `unifi-protect` to throw `ECONNREFUSED`, verify `discover()` returns `{ok:false, reason:'controller_unreachable'}`, verify the API returns 503, verify the UI renders the banner.

### Risk 5: Settings-form has not yet got Protect creds (HUB-WIZ-01 anchor + Q-OPEN-04)

**Concrete:** Fresh install. User opens `/settings`, clicks "Protect Hub" tab. Creds are not yet set. Naive implementations call `getProtectClient()` → throw "credentials not configured" → ugly stack trace in the UI.

**Mitigation:**
- `+page.server.ts` pre-checks `unifi_host` + `unifi_username` settings; passes `credsConfigured: boolean` to the client.
- The Hub-Tab component branches on this BEFORE calling discover — shows the deep-link card if false.
- Auto-discover `$effect` only fires when creds are configured AND cache is empty.

---

## Sources

### Primary (HIGH confidence)
- [unifi-protect on GitHub — `protect-types.ts`](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-types.ts) — verified verbatim for `ProtectCameraConfigInterface`, `ProtectCameraChannelConfigInterface`, `ProtectDeviceBaseInterface`. Lines cited inline above.
- [unifi-protect on GitHub — `protect-api.ts`](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts) — verified `login()`, `getBootstrap()`, `bootstrap` getter, `enableRtsp()` API surface.
- [unifi-protect on npm](https://www.npmjs.com/package/unifi-protect) — verified version `4.29.0`, engine `node >= 22`, single transitive dep `undici@8.0.2`.
- `src/lib/server/db/client.ts` — verified `ensureColumn()` helper signature lines 44-48; existing `ensureColumn` calls lines 50-54.
- `src/lib/server/db/schema.ts` — verified `cameras` table columns; verified `cameras.model` exists from Phase 18.
- `src/lib/server/services/settings.ts` — verified `getSettings()`, `getSetting()`, `saveSetting()` signatures; verified 30s settings cache + AES-256-GCM encryption pattern.
- `src/lib/server/services/protect.ts` — verified hand-rolled cookie+CSRF flow; confirms STAYS UNTOUCHED.
- `src/routes/settings/+page.svelte` — verified existing 6-tab pattern (line 11); 7th-tab extension pattern.
- `package.json` — verified existing deps; verified absence of `unifi-protect` and `yaml` (both will be added).

### Secondary (MEDIUM confidence)
- `.planning/research/v1.3/SUMMARY.md` — 30 Locked-Early Decisions. Note: L-1 (MAC-as-PK) and L-30 (lib for write paths) are HIGH-confidence; L-28 (`manufacturer` column) is MEDIUM and superseded by §Risks #2 corrections.
- `.planning/research/v1.3/STACK.md` — `unifi-protect@^4.29.0` API surface verbatim. The `enableRtsp()` per-channel granularity question is open per L-30 but irrelevant to P19.
- `.planning/research/v1.3/ARCHITECTURE.md` — schema design + module locations + file-touch matrix. P19 file-touch-matrix verified against the 13 files this phase reasonably edits.
- `.planning/research/v1.3/PITFALLS.md` — pitfalls #2 (MAC-PK), #4 (channel iteration), #8 (TLS spike), #19 (sizing), #20 (SSH key) flagged for P19. Pitfalls list is comprehensive but some apply to later phases.
- [meintechblog UniFi → Loxone howto](https://meintechblog.de/2025/11/07/howto-unifi-protect-videofeed-in-loxone-einbinden/) — the user's own validated working recipe; confirms `:7441` for RTSPS endpoint; not directly P19 but relevant for §TLS Spike URL format.

### Tertiary (LOW confidence)
- [UniFi Developer API docs (developer.ui.com)](https://developer.ui.com/protect/) — sample JSON responses lack the full set of fields the lib's typed interface exposes (sample responses appear to be REST-API-public subset, not the bootstrap endpoint); would mislead if used as the canonical reference. The lib's `protect-types.ts` is more complete.

---

## Metadata

**Confidence breakdown:**
- API surface (lib bootstrap shape): **HIGH** — verified verbatim against current `protect-types.ts` source; field-level line numbers cited.
- Schema migration pattern: **HIGH** — directly mirrors existing `client.ts` lines 44-54; pseudo-migration is the established pattern.
- TLS spike methodology: **HIGH** for the methodology (the spike pattern is well-defined); **MEDIUM** for the predicted outcome (the spike must run to know).
- `protect-bridge.ts` skeleton: **HIGH** — every export's signature is grounded in lib types and existing project conventions (singleton from `protect.ts`, settings access from `settings.ts`).
- `/settings/protect-hub` page: **HIGH** for the tab-extension pattern + cache-vs-fresh branch; **MEDIUM** for exact Svelte-5 effect timing (verify against project's existing $effect usage during plan execution).
- Validation Architecture: **HIGH** — Vitest 4.1.0 confirmed; all proposed test files map 1:1 to phase requirements; mocking pattern matches existing v1.2 test conventions.
- Risks: **HIGH** — every risk is concrete with named files and named tests for verification.
- Open Questions Resolved: **HIGH** for Q-OPEN-01 (verified against source); **HIGH** for Q-OPEN-02 (verified); **METHODOLOGY HIGH / OUTCOME MEDIUM** for Q-OPEN-03 (the spike is what resolves it); **HIGH** for Q-OPEN-04 (UX recommendation grounded in existing patterns).

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days for stable; the lib changes infrequently, the codebase patterns are mature).

## RESEARCH COMPLETE
