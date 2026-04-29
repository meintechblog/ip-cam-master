# ARCHITECTURE — v1.3 Protect Stream Hub Integration

**Project:** ip-cam-master
**Milestone:** v1.3 (Protect Stream Hub: Loxone + Frigate-ready)
**Researched:** 2026-04-30
**Confidence:** HIGH (codebase-grounded — every recommendation maps to a concrete existing file)

---

## 0. Constraints That Drive The Design

These are observed in the existing repo and **non-negotiable for v1.3**:

1. **No new top-level frameworks.** SvelteKit 2.55, better-sqlite3, Drizzle, proxmox-api, node-ssh, MQTT are already in `package.json`.
2. **Migrations are pseudo-Drizzle.** `src/lib/server/db/client.ts` has an idempotent `ensureColumn()` helper that does `ALTER TABLE ... ADD COLUMN` on boot. v1.3 must keep that pattern (real Drizzle migration system is v1.4+ work).
3. **Single LXC, n streams.** Locked in `.planning/STATE.md` Decisions.
4. **Existing per-cam pipeline must not regress.** Onboarding flows for Mobotix/Loxone/Bambu A1/H2C have UAT items still open from v1.2. Add adjacent modules; do not refactor `onboarding.ts`, `proxmox.ts`, `go2rtc.ts`, or `/kameras/onboarding`.
5. **Settings-driven feature gate.** Hub off by default. Until on, every Hub code path must be inert.

---

## 1. Data Model

### 1.1 Recommendation: extend `cameras` with a discriminator + add 3 narrow tables

Rejected the "separate `external_cameras` table" option after reading `src/routes/api/cameras/status/+server.ts`. The status endpoint and `/kameras/+page.svelte` are written against one camera shape. Two parallel tables would force every consumer to UNION+normalize forever for one milestone's worth of separation.

**Lock Early Decision (must be decided before Phase 19 starts coding):**

Add to `src/lib/server/db/schema.ts` (and to `client.ts` via `ensureColumn()`):

```ts
// In `cameras` table:
source: text('source').notNull().default('managed'),  // 'managed' | 'external'
externalId: text('external_id'),       // protect cam UUID for source='external'; NULL for managed
hubBridgeId: integer('hub_bridge_id'),  // FK → bridges.id; NULL for managed
```

Why this exact shape:
- `source` defaults to `'managed'` so all existing rows survive the migration without backfill.
- `externalId` (Protect UUID) is the stable identity. IPs change, names get edited, MAC changes on adoption-reset — UUID does not.
- `hubBridgeId` keeps the FK on the cam (not the bridge) because cams are owned 1:N by a bridge.

Columns that stay NULL for `source='external'`: `vmid`, `containerIp`, `password`/`username`, `streamPath`, `width/height/fps/bitrate`, `printState`, `streamMode`, `accessCode`, `serialNumber`. Status endpoint short-circuits external cams before touching these.

### 1.2 New tables (additive)

```ts
// src/lib/server/db/schema.ts — APPEND, do not modify existing tables besides `cameras`

export const protectHubBridges = sqliteTable('protect_hub_bridges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vmid: integer('vmid').notNull().unique(),
  hostname: text('hostname').notNull(),
  containerIp: text('container_ip'),
  status: text('status').notNull().default('pending'),  // 'pending' | 'provisioned' | 'running' | 'failed' | 'stopped' | 'destroyed'
  lastDeployedYamlHash: text('last_deployed_yaml_hash'),
  lastReconciledAt: text('last_reconciled_at'),
  lastHealthCheckAt: text('last_health_check_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const cameraOutputs = sqliteTable('camera_outputs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').notNull(),
  outputType: text('output_type').notNull(),  // 'loxone-mjpeg' | 'frigate-rtsp' | future: 'homeassistant', 'scrypted'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  config: text('config').notNull().default('{}'),  // {sourceQuality:'low'|'medium'|'high', mode:'copy'|'transcode', width, height, fps}
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const protectStreamCatalog = sqliteTable('protect_stream_catalog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').notNull(),
  quality: text('quality').notNull(),  // 'low' | 'medium' | 'high'
  codec: text('codec'),
  width: integer('width'),
  height: integer('height'),
  fps: integer('fps'),
  bitrate: integer('bitrate'),
  rtspUrl: text('rtsp_url'),  // Protect's published RTSP URL after share-toggle; NULL if not shared yet
  shareEnabled: integer('share_enabled', { mode: 'boolean' }).notNull().default(false),
  cachedAt: text('cached_at').notNull().$defaultFn(() => new Date().toISOString())
});
```

Why three tables, not one:
- `protectHubBridges` has its own lifecycle independent of any cam.
- `cameraOutputs` is a **table, not a JSON column** — reconciler WHEREs on `enabled=1`, UI toggles individual rows, future output types add rows not migrate JSON.
- `protectStreamCatalog` is a **cache, not source-of-truth**. Refresh on cadence (15min) and on user-triggered "rescan."

### 1.3 What we explicitly do NOT touch

- `containers` table — bridge does not go there (per-cam by convention).
- `events` table — emit hub events with `source='protect_hub'`, `cameraId=null` for bridge-level, `cameraId=<external cam id>` for per-cam reconcile events.
- `settings` table — Hub feature toggle (`protect_hub_enabled`) only.

---

## 2. Reconciliation Loop

### 2.1 Placement: NEW dedicated scheduler entry, NOT on the 60s SSH log scan

The 60s scan in `scheduler.ts` does network IO via SSH to UDM — different cadence, failure mode, config gate. Bolting Hub reconcile on means: skipped when UDM unconfigured but Protect fine; one slow SSH timeout starves reconcile.

Add new interval inside `startScheduler()`:

```ts
let protectHubReconcileInterval: ReturnType<typeof setInterval> | null = null;
```

Cadence:
- **5 min**, not 60s. At 60s we'd hot-reload on every Protect cam name edit; at 5min the UI feels live (toggle a cam → ≤5min sync) but the bridge isn't thrashing.
- + event-driven force-reconcile on user actions (toggling outputs, manual "Sync now"). In-process Promise from API route handlers.

### 2.2 Diff strategy: SHA256-of-YAML, deploy only on change

1. Build full `go2rtc.yaml` from `cameras WHERE source='external' JOIN cameraOutputs WHERE enabled=1 JOIN protectStreamCatalog`
2. SHA256 the rendered string.
3. Compare to `protectHubBridges.lastDeployedYamlHash`.
4. Equal → emit "reconcile no-op", update `lastReconciledAt`, return.
5. Different → `pushFileToContainer` (existing helper) + `systemctl reload go2rtc` + update hash + emit event.

Why full-rewrite over delta: go2rtc has zero state in YAML. Delta is harder, error-prone, and offers no benefit since the file is <50 KB.

### 2.3 New module location

```
src/lib/server/orchestration/protect-hub/
  ├── catalog.ts          # fetch Protect cams + per-cam stream qualities → upsert into protect_stream_catalog
  ├── yaml-builder.ts     # multi-cam go2rtc.yaml generator (NEW; do not extend go2rtc.ts)
  ├── reconcile.ts        # main loop: query → build → diff-deploy → emit event
  ├── bridge-provision.ts # one-shot LXC creation, install go2rtc, initial YAML push
  ├── bridge-lifecycle.ts # start/stop/restart/destroy for the bridge container
  └── share-toggle.ts     # try Protect API to enable per-cam RTSP sharing; record success/fallback
```

Not in `services/` (47-file flat dump). Hub is multi-step orchestration over several services — deserves a folder. Existing per-cam `generateGo2rtcConfig*` functions in `go2rtc.ts` are NOT extended — multi-cam YAML for the bridge has fundamentally different shape (n × {hq, lq} streams, n × ffmpeg blocks, shared `rtsp:` server config, shared VAAPI device).

---

## 3. Bridge Container Provisioning

### 3.1 Reuse the existing primitives, NEW orchestration

`src/lib/server/services/proxmox.ts`: `createContainer()`, `startContainer()`, `cloneFromTemplate()` — work with zero changes (they accept generic `hostname`, `cameraName`, `cameraType`).
`src/lib/server/services/ssh.ts`: `pushFileToContainer()`, `executeOnContainer()` — as-is.
`src/lib/server/services/go2rtc.ts`: `getInstallCommands()` (the `forBambuA1=false` default path) installs ffmpeg + go2rtc + intel-media-va-driver — exactly what the bridge needs. **REUSE**.

### 3.2 What's NEW

`src/lib/server/orchestration/protect-hub/bridge-provision.ts`:

```ts
export async function provisionBridge(): Promise<{ vmid: number; containerIp: string }>
```

Flow:
1. Allocate next VMID.
2. `createContainer({ vmid, hostname: 'protect-hub', cameraName: 'ProtectHub', cameraType: 'protect-hub' })` — higher memory cap (1 GB; n parallel ffmpegs need RAM).
3. `startContainer()` + `waitForContainerReady()`.
4. Run `getInstallCommands()`.
5. Generate `systemd unit` via `generateSystemdUnit()`.
6. Insert row into `protectHubBridges` with `status='provisioned'`.
7. Initial YAML push via `reconcile.ts` (sets `'running'` after first successful push).

### 3.3 Lifecycle — UI-triggered vs automatic

| Op | Trigger | Owner |
|---|---|---|
| Provision | UI: settings toggle ON (first time) | wizard step 2 |
| Initial deploy | Auto, immediately after provision | reconcile.ts |
| Reconcile (drift) | Auto, every 5 min + on every output toggle | scheduler tick |
| Restart on YAML reload | Auto, when reconcile detects hash change | reconcile.ts |
| Restart on crash | Auto via systemd `Restart=always` | systemd in container |
| Stop | UI: "Hub deaktivieren (keep container)" | offboarding flow |
| Destroy LXC | UI: "Hub deaktivieren + Container löschen" | offboarding flow |
| Re-provision after stopped | UI: settings toggle ON when bridge row exists with `status='stopped'` | wizard short-path |

**Never automatically destroy the LXC.**

---

## 4. API & UI Surface

### 4.1 New SvelteKit routes

```
src/routes/api/protect-hub/
  ├── state/+server.ts             GET  → bridge status, last-reconcile, cam count
  ├── discover/+server.ts          POST → fetch cams from Protect, refresh stream catalog
  ├── reconcile/+server.ts         POST → force a reconcile cycle (returns event log)
  ├── enable/+server.ts            POST → settings toggle ON, kick off provision
  └── disable/+server.ts           POST → settings toggle OFF + offboarding mode (keep|destroy)

src/routes/api/cameras/[id]/outputs/
  ├── +server.ts                   GET  → list outputs for cam, PATCH → toggle one
  └── [outputType]/+server.ts      DELETE → disable an output

src/routes/api/protect-hub/cameras/
  └── [externalId]/share/+server.ts POST → enable Protect-side RTSP share for one cam
```

### 4.2 `/cameras` list integration

**Recommendation: extend the existing `/api/cameras/status` endpoint, do not create a parallel one.**

Modify `src/routes/api/cameras/status/+server.ts`:
1. After `allCameras = db.select().from(cameras).all()`, partition into `managed` and `external` by `cam.source`.
2. **Managed:** existing code path runs unchanged — Proxmox container probe, go2rtc 1984 check, ONVIF probe, snapshot URL. NO REGRESSION.
3. **External:** short-circuit before per-container probes. Build a different `CameraCardData` variant where:
   - `containerIp` = bridge.containerIp
   - `streamName` = `external_${cam.id}_<output-type>` (matches yaml-builder naming)
   - `vmid` = bridge.vmid
   - `cameraType` = `'external-protect'` (new type discriminator on UI)
   - `streamInfo` built from bridge's go2rtc API (one fetch covers all external cams — cache it)
4. Return one merged sorted array. UI doesn't need to know.

UI side (`CameraDetailCard.svelte`):
- "Protect Hub" badge when `camera.cameraType === 'external-protect'`.
- Hide cam-edit and cam-delete buttons for external cams.
- New "Outputs" subsection: toggles (Loxone-MJPEG / Frigate-RTSP) with copy-buttons for each output URL.
- Show native Protect stream catalog (read-only) — Low/Medium/High with codec/resolution/fps.

### 4.3 Onboarding wizard placement

**Dedicated page route `/settings/protect-hub/onboarding`, not a modal.**

Reasoning: existing `/kameras/onboarding/+page.svelte` is a 80+ line state machine; cramming a second wizard into a settings modal recreates that. Long-running ops (LXC provision = 30-90s) need their own page so refresh/back-button works predictably. Mirrors the existing pattern.

Wizard state: **local component state, no DB persistence**. Single-session. Power-loss recovery is not a goal (the user can re-trigger from a settings toggle that's still in the right intermediate state).

```
src/routes/settings/protect-hub/
  ├── +page.server.ts            # load: bridge state, hub-enabled, cam count
  ├── +page.svelte               # main settings tab content (status, toggles, "go to onboarding")
  └── onboarding/
      ├── +page.server.ts        # load: protect connection check
      └── +page.svelte           # wizard: connect → provision → discover → pick cams → first sync → done
```

Add **one tab** (`Protect Hub`) to existing `/settings/+page.svelte` whose content is a thin `ProtectHubTab.svelte` (next to `BackupTab.svelte`) with status/toggles + "Onboarding starten" button that navigates to `/settings/protect-hub/onboarding`.

---

## 5. Lifecycle Integration Points

### 5.1 Onboarding state machine

```
[Toggle ON in settings tab]
  ↓
Step 1: Verify Protect connection (existing protect.ts login() reused; deep-link to /settings UniFi tab if missing)
  ↓
Step 2: Provision bridge LXC (if no row in protectHubBridges)
  → bridge-provision.ts (long-running, 30-90s; show progress events)
  → on failure: bridge row stays at status='failed', user can retry
  ↓
Step 3: Initial discovery
  → catalog.ts: fetch Protect cams, populate protect_stream_catalog
  → show preview: "Found N cams. Pick which to enable."
  ↓
Step 4: User picks cams + default output type
  → INSERT INTO cameras (source='external', externalId, name, hubBridgeId)
  → INSERT INTO camera_outputs (cameraId, outputType=<picked>, enabled=true)
  ↓
Step 5: First reconcile (forced run; deploy YAML; wait for go2rtc)
  ↓
Step 6: Done — redirect to /kameras (external cams visible with Protect Hub badges)
```

State storage: **none persistent during the wizard**. Each step writes to its proper home. Closing the tab between steps leaves recoverable-by-re-entry state — wizard sees existing rows and skips ahead.

### 5.2 Offboarding state machine

```
[Toggle OFF in settings tab]
  ↓
Confirm dialog showing:
  - N Protect cams will disappear from /cameras
  - M Loxone consumers will lose their stream
  - K Frigate streams will go offline
  ↓
User picks one of:
  (A) "Disable only" → keep bridge container, status='stopped'
  (B) "Disable + destroy LXC" → also destroy the container
  ↓
Common path:
  1. Mark settings.protect_hub_enabled = false  (kills scheduler tick)
  2. UPDATE cameras SET source='external_archived' WHERE source='external'
     (keeps history; UI hides them; re-enable can restore)
  3. UPDATE camera_outputs SET enabled=0 WHERE camera_id IN (...)
  4. Stop bridge container via existing pct stop
  5. (Optional) call Protect API to disable RTSP shares
  6. (Path B only) Destroy LXC; UPDATE protect_hub_bridges SET status='destroyed'
```

**Reversibility:** soft-delete (`source='external_archived'`), never DELETE. Re-enable:
- Bridge `'stopped'` → start container → reconcile → flip cams to `source='external'` and re-enable outputs.
- Bridge `'destroyed'` → re-run wizard from Step 2.

---

## 6. Build Order — 5 Phases (continues from Phase 18)

### Phase 19 — Data Model + Protect Catalog Read-Only

**Scope:** Schema, catalog fetcher, read-only UI for inspection. NO bridge container, NO reconciliation, NO outputs.

**Deliverables:**
- Schema additions to `db/schema.ts` + `client.ts ensureColumn()` calls + new `CREATE TABLE IF NOT EXISTS`.
- `protect-hub/catalog.ts` — fetch Protect cams + per-cam stream qualities, upsert into catalog table.
- `/api/protect-hub/discover/+server.ts` — POST refresh.
- `/settings/protect-hub/+page.svelte` — minimal status page; "Refresh catalog" button; table of what was found.
- `ProtectHubTab.svelte` settings tab shell.
- Tests: catalog unit tests (mock `protectFetch`), schema migration test.

**Ships value:** "I can see what cams Protect has and their stream qualities." Risk: LOW. No new infra. Reads only.

### Phase 20 — Bridge LXC Provisioning Skeleton

**Scope:** Provision the bridge container, install go2rtc, deploy a hardcoded "hello world" YAML, verify up. NO multi-cam YAML, NO reconciliation loop.

**Deliverables:**
- `bridge-provision.ts` + `bridge-lifecycle.ts` (start/stop/restart only — destroy in Phase 23).
- `/api/protect-hub/enable/+server.ts` (provisions on first call) + `/api/protect-hub/state/+server.ts`.
- `/settings/protect-hub/onboarding/+page.svelte` — wizard Steps 1-2 only.
- Health check: extend existing `healthCheckInterval` in `scheduler.ts` to include bridge (one extra fetch to bridge.containerIp:1984).

**Ships value:** "I can spin up the Hub container from the UI." Risk: MEDIUM. New LXC type. Mitigation: reuse `createContainer()` exactly.

**Depends on:** Phase 19 (schema for `protect_hub_bridges`).

### Phase 21 — Multi-Cam YAML Generation + Reconciliation Loop

**Scope:** Stream-bridging pipeline. User enables outputs in DB, reconciler picks them up and deploys.

**Deliverables:**
- `yaml-builder.ts` — multi-cam YAML emission. Two output types: `loxone-mjpeg` (transcode 640×360 @ 10fps via VAAPI) + `frigate-rtsp` (passthrough copy).
- `reconcile.ts` — full pipeline: query enabled outputs → build YAML → sha256 → diff against `lastDeployedYamlHash` → deploy on change.
- New scheduler tick `protectHubReconcileInterval`, 5min cadence, gated on `settings.protect_hub_enabled`.
- `/api/protect-hub/reconcile/+server.ts` — force-run.
- `/api/cameras/[id]/outputs/+server.ts` (GET/PATCH).
- DB seed function for "user picks cams" wizard step.
- Tests: yaml-builder golden-file fixtures; sha256 dedupe behavior; reconcile no-op when YAML unchanged.

**Ships value:** "Streams flow." Risk: HIGH. Heart of the milestone. Mitigation: rich golden-file tests; start with one output type, add second once first works; deploy logic mirrors proven Bambu A1 pattern.

**Depends on:** Phases 19 + 20.

### Phase 22 — Onboarding Wizard + `/cameras` Integration

**Scope:** Full UX. Make the feature usable by non-developers.

**Deliverables:**
- Wizard Steps 3-6 in `/settings/protect-hub/onboarding/+page.svelte`.
- Modify `/api/cameras/status/+server.ts` — partition managed/external; build different `CameraCardData` variants; merge.
- Modify `CameraDetailCard.svelte` — Protect Hub badge, Outputs subsection, native catalog read-only display.
- `ProtectHubGuide.svelte` (next to `AdoptionGuide.svelte`) — Loxone Custom Intercom hint, Frigate cameras.yaml snippet.
- E2E test: enable Hub → wizard → pick 1 cam → see it in /cameras with output URLs.

**Ships value:** "A user can do this without reading docs." Risk: MEDIUM. Most risk is UX; wiring of `/cameras` is mechanically simple but must be reviewed for regression.

**Depends on:** Phase 21 + Phase 19.

### Phase 23 — Offboarding + Lifecycle Polish + Stream-Sharing API

**Scope:** Closing the lifecycle.

**Deliverables:**
- `/api/protect-hub/disable/+server.ts` — keep-or-destroy paths.
- Confirm dialog with consequences listing.
- `bridge-lifecycle.ts destroyBridge()`.
- Soft-delete via `source='external_archived'` + re-enable path detection in wizard.
- `share-toggle.ts` — Protect API auto-enable; UI fallback if API unavailable.
- Cleanup tab in settings: "Stream-Sharing in Protect aufräumen" button.
- "Sync now" button on settings page (manual reconcile).
- Drift indicator on settings page (last-reconciled-at, container-status badge).

**Ships value:** Feature complete and reversible. Risk: MEDIUM. Stream-sharing API path may fall back to UI instructions.

**Depends on:** Phases 19-22.

### Why this order (dependencies)

```
P19 (data model + read-only catalog)
  ↓
P20 (bridge container) ──────────────┐
  ↓                                  │
P21 (yaml + reconcile) ──────┐       │
  ↓                          │       │
P22 (wizard + /cameras UI)   │       │
  ↓                          │       │
P23 (offboarding + polish) ──┴───────┘
```

P19 and P20 each ship value alone. P21+P22 ship together for end-users but P21 is technically usable by a developer who can INSERT into `camera_outputs` manually. P23 cannot meaningfully come before P22.

---

## 7. Patterns to Follow

| # | Pattern | When | Why |
|---|---------|------|-----|
| 1 | Reuse `pushFileToContainer` + `executeOnContainer` for all bridge ops | Every Hub deployment, restart, config push | Auth, retry, connect-pooling are centralized; Bambu A1, Loxone, Mobotix all use this |
| 2 | Cache-with-TTL for all read paths from Protect | Every read-from-Protect operation in the Hub | Mirror existing 30s `statusCache` in `protect.ts`; without TTL we'll trigger session-storm on UDM |
| 3 | SHA256-hash-of-YAML before deploy | Every reconcile cycle | Idempotency; skip no-op deploys, reduce log noise |
| 4 | Soft-delete external cams (`source='external_archived'`) | Every Hub deactivation | Reversibility per PROJECT.md "Re-Enable nach Offboarding" |

---

## 8. Anti-Patterns to Avoid

| # | Anti-Pattern | Why Bad | Instead |
|---|--------------|---------|---------|
| AP-1 | Separate `external_cameras` table | Doubles every consumer query; UNION normalization throughout codebase forever | `cameras.source` discriminator + nullable container columns |
| AP-2 | Extending `generateGo2rtcConfig*` in `go2rtc.ts` | Per-camera, single-purpose, currently under v1.2 UAT; multi-cam YAML different shape | New `yaml-builder.ts` in `protect-hub/` orchestration folder |
| AP-3 | Wiring Hub into 60s `logScanInterval` | Different config gate (UDM SSH vs Protect API), cadence, failure mode; SSH timeouts starve Hub | Dedicated `protectHubReconcileInterval` at 5min |
| AP-4 | Persisting wizard state in DB | New "sessions" concept for one milestone; complicates resumability | Each wizard step writes to permanent tables incrementally |
| AP-5 | Auto-destroying the LXC on toggle-off | Destroys user infrastructure without explicit confirmation; v1.1 spent a phase on backup/restore | Default offboarding keeps container; "Destroy LXC" is explicit second confirm |

---

## 9. Scalability Considerations

| Concern | At 5 cams | At 30 cams | At 100 cams |
|---|---|---|---|
| go2rtc YAML size | ~3 KB | ~20 KB | ~70 KB |
| VAAPI parallel encodes | 5 (fine on UHD 770) | 30 (push to Arrow Lake or split bridges) | infeasible single bridge |
| Catalog refresh cost | ~10 Protect API calls | ~60 calls | ~200 calls (rate-limit risk) |
| Reconcile cycle time | <2s | ~5s | ~15s |
| sha256 dedupe efficacy | Critical | Critical | Critical |

For v1.3 we ship single-bridge. Multi-bridge is out of scope but the schema (`hubBridgeId` on `cameras`) leaves the door open for v1.5+.

---

## 10. Decisions to Lock Early

These should be confirmed *before* Phase 19 starts coding:

| # | Decision | Recommendation |
|---|---|---|
| D-1 | `cameras.source` discriminator vs separate table | Discriminator on existing `cameras` table |
| D-2 | Bridge container row in `containers` vs new `protect_hub_bridges` | New table — `containers` is per-cam by convention |
| D-3 | Reconcile cadence | 5 min + event-driven force-runs |
| D-4 | YAML deploy strategy | Full rewrite + sha256 dedupe |
| D-5 | Wizard state persistence | None — write to permanent tables incrementally |
| D-6 | Default offboarding behavior | Keep container; destroy is explicit second action |
| D-7 | Soft-delete on offboarding | `source='external_archived'`, never DELETE |
| D-8 | Stream-share API strategy | Try Protect API; fall back to UI instructions if API path fails |
| D-9 | Reuse existing LXC template | Yes — same Debian 13 + VAAPI passthrough |

---

## 11. Open Questions (don't block roadmap)

- **Loxone Custom Intercom: single low-stream sufficient?** Verify against Loxone docs during Phase 21 yaml-builder design. Worst case: add `*-medium` stream to YAML (no schema change needed).
- **Stream-share API auto-toggle in Protect:** research during Phase 23. Until verified, ship UI instructions per cam (already required as fallback).
- **VAAPI capacity at scale:** 30+ simultaneous transcodes need profiling. Out-of-scope for v1.3 (multi-bridge in v1.5+).

---

## 12. Files Touched Per Phase

| File | P19 | P20 | P21 | P22 | P23 | Action |
|---|---|---|---|---|---|---|
| `src/lib/server/db/schema.ts` | + | | | | | extend (cameras cols) + 3 new tables |
| `src/lib/server/db/client.ts` | + | | | | | new `ensureColumn` calls + CREATE TABLE IF NOT EXISTS |
| `src/lib/server/orchestration/protect-hub/catalog.ts` | + | | | | | NEW |
| `src/lib/server/orchestration/protect-hub/bridge-provision.ts` | | + | | | | NEW |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` | | + | | | + | NEW + extend (destroy in P23) |
| `src/lib/server/orchestration/protect-hub/yaml-builder.ts` | | | + | | | NEW |
| `src/lib/server/orchestration/protect-hub/reconcile.ts` | | | + | | | NEW |
| `src/lib/server/orchestration/protect-hub/share-toggle.ts` | | | | | + | NEW |
| `src/lib/server/services/scheduler.ts` | | + | + | | | extend (bridge health probe + reconcile tick) |
| `src/routes/api/protect-hub/state/+server.ts` | | + | | | | NEW |
| `src/routes/api/protect-hub/discover/+server.ts` | + | | | | | NEW |
| `src/routes/api/protect-hub/reconcile/+server.ts` | | | + | | | NEW |
| `src/routes/api/protect-hub/enable/+server.ts` | | + | | | | NEW |
| `src/routes/api/protect-hub/disable/+server.ts` | | | | | + | NEW |
| `src/routes/api/cameras/[id]/outputs/+server.ts` | | | + | | | NEW |
| `src/routes/api/cameras/status/+server.ts` | | | | + | | extend (managed/external partition) |
| `src/routes/settings/protect-hub/+page.{server,svelte}` | + | | | + | + | NEW + iterate |
| `src/routes/settings/protect-hub/onboarding/+page.{server,svelte}` | | + | | + | | NEW (P20 partial) + extend (P22 full) |
| `src/lib/components/settings/ProtectHubTab.svelte` | + | | | + | + | NEW + iterate |
| `src/lib/components/cameras/CameraDetailCard.svelte` | | | | + | | extend (badge, outputs, catalog display) |
| `src/lib/components/cameras/ProtectHubGuide.svelte` | | | | + | | NEW |
| `src/routes/settings/+page.svelte` | + | | | | | extend (add Protect Hub tab to tabs array) |

---

## 13. What We Explicitly Do NOT Touch in v1.3

- `src/lib/server/services/onboarding.ts` — Mobotix/Loxone/Bambu wizard. UAT pending.
- `src/lib/server/services/proxmox.ts createContainer()` signature — only call with new args.
- `src/lib/server/services/go2rtc.ts generateGo2rtcConfig*` functions — leave per-cam path intact.
- `src/lib/server/services/protect.ts` — read-only client; reuse `protectFetch()` and `getProtectStatus()`.
- `src/lib/server/services/ssh.ts` helpers — reuse, don't extend.
- `src/lib/server/db/client.ts ensureColumn()` semantics — extend by calling, do not refactor.
- The `containers` table — bridge does not go there.
- `events` table schema — emit Hub events using existing columns.
- `/kameras/onboarding` wizard — separate flow, do not merge.
- The 60s `logScanInterval` SSH log scan — leave Bambu/UDM scheduling alone.

---

## 14. Sources

- `.planning/PROJECT.md`, `.planning/STATE.md`
- `src/lib/server/db/schema.ts`, `src/lib/server/db/client.ts`
- `src/lib/server/services/scheduler.ts`, `protect.ts`, `go2rtc.ts`, `proxmox.ts`, `onboarding.ts`, `ssh.ts`, `settings.ts`
- `src/routes/api/cameras/status/+server.ts`
- `src/routes/kameras/+page.svelte`, `src/routes/kameras/onboarding/+page.svelte`
- `src/routes/settings/+page.svelte`
- `src/lib/components/cameras/CameraDetailCard.svelte`
- `src/hooks.server.ts`
- `package.json` — confirms no new deps required for orchestration

**RESEARCH COMPLETE — Confidence: HIGH (every recommendation references a concrete existing file in the repo).**
