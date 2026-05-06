# Phase 21: Multi-Cam YAML + Reconciliation Loop — Research

**Researched:** 2026-05-06
**Domain:** go2rtc multi-stream YAML emission + scheduler-driven reconciliation
  loop (ffmpeg pipelines, canonical-form sha256 dedupe, single-flight + dirty
  flag, WS reconnect with exp backoff, VAAPI cap enforcement, busy gate for
  self-update)
**Confidence:** HIGH (all 4 D-* areas locked in CONTEXT.md; all 30 L-*
  decisions in research/v1.3/SUMMARY.md still hold; codebase grounded against
  shipped P19+P20 code; one source-code surprise found on `pushFileToContainer`
  atomicity — see Pitfall §P21-#13-revised below)

---

## Summary

P21 is the heart of v1.3: it converts the static hello-world bridge from P20
into a **DB-driven, multi-cam streaming bridge** that auto-reconciles every 5
minutes (and instantly on output toggle). All strategic choices are already
locked — 30 items in `SUMMARY.md` (L-1..L-30) and 4 grey areas accepted with
recommended defaults in CONTEXT.md (D-PIPE / D-RCN / D-API / D-CAP). The job
of the planner is **mechanical wiring**, not architecture.

The new module surface is tight: one new file `yaml-builder.ts`, one new file
`reconcile.ts`, one new table `protect_hub_reconcile_runs`, one extension to
`scheduler.ts` (extra interval + 1 extra fetch in the existing
`healthCheckInterval`), three new SvelteKit routes (`POST
/api/protect-hub/reconcile`, `GET /api/protect-hub/reconcile-runs`, `PUT
/api/cameras/[id]/outputs`), and a single exported `isReconcilerBusy()` helper
that `update-checker.ts` imports.

**Primary recommendation:** Lean on what is already shipped — `pushFileToContainer`,
`generateBridgeConfig`, `protectStreamUrl`, `getProtectClient`, `discover()`,
the `protectHubBridges` row, and the `cameraOutputs`/`protectStreamCatalog`
tables. The new code is glue + canonical-form hashing + a 50-line single-flight
runner. The risk is concentrated in **two** spots: (1) `pushFileToContainer` is
NOT actually tmp+rename atomic in the current code (CONTEXT.md is slightly
wrong — see §Code-Reality-Check below) — P21 must either add atomicity or
accept go2rtc's restart loop as the recovery mechanism; (2) go2rtc has **no
SIGHUP/reload handler** — `systemctl reload-or-restart go2rtc` is effectively
`restart`, so every YAML deploy bounces all consumer streams for ~1–3s.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — ffmpeg Pipeline per Output (D-PIPE)**

- **D-PIPE-01** Source URL form: `rtsps://192.168.3.1:7441/<rtspAlias>?enableSrtp`
  with `tls_verify=0` (per L-10 + P19-01 spike result `Result: rtsps-tls-verify-0`).
  yaml-builder MUST consume Protect-Bridge's already-rewritten `rtsps://...` URLs.
  *(Note: `protect-bridge.ts:protectStreamUrl()` already returns `rtsps://`, not
  `rtspx://` — see §Code-Reality-Check.)*
- **D-PIPE-02** Loxone-MJPEG ffmpeg form (canonical):
  ```
  ffmpeg:rtsps://192.168.3.1:7441/<token>?enableSrtp#input=tls_verify=0#video=mjpeg#width=640#height=360#raw=-r 10#raw=-an#hardware=vaapi#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2
  ```
- **D-PIPE-03** HEVC decoder selection: implicit via `hardware=vaapi` —
  go2rtc/ffmpeg auto-selects `hevc_vaapi` per source codec. No explicit `-c:v`
  decoder flag. Verified for the live Carport HEVC source.
- **D-PIPE-04** Frigate-RTSP ffmpeg form (canonical):
  ```
  ffmpeg:rtsps://192.168.3.1:7441/<token>?enableSrtp#input=tls_verify=0#video=copy#raw=-an
  ```
- **D-PIPE-05** Reconnect robustness: `-reconnect 1 -reconnect_streamed 1
  -reconnect_delay_max 2` on every output, regardless of type.
- **D-PIPE-06** Stream slug derivation: `<mac-slug>-<output-suffix>`
  (mac-slug = lowercased MAC, no separators; output-suffix = `low`/`high` per
  Loxone-MJPEG/Frigate-RTSP). Final slug pattern locked in plan-phase.

**Area 2 — Reconcile Correctness + No-op Skip (D-RCN)**

- **D-RCN-01** Canonical YAML form: `yaml@2.6` with `sortMapEntries: true`.
  Strip first-line stamp comment BEFORE sha256.
- **D-RCN-02** mtime fast-path: read remote file mtime AND its sha256. Skip
  deploy ONLY if BOTH match `protect_hub_bridges.last_deployed_yaml_hash`.
- **D-RCN-03** YAML deploy: write to `<dest>.tmp`, `mv` to final path, then
  `systemctl reload-or-restart go2rtc`. Reuse `pushFileToContainer` from `ssh.ts`.
  *(Caveat: current `pushFileToContainer` does NOT do tmp+rename — see
  §Code-Reality-Check; planner must decide whether to extend it or wrap it.)*
- **D-RCN-04** New SQLite table `protect_hub_reconcile_runs` (mirrors `update_runs`):
  `id`, `reconcileId`, `startedAt`, `completedAt`, `status`
  (running/success/no_op/bridge_unreachable/error), `hashChanged`,
  `deployedYamlHash`, `error`.
- **D-RCN-05** URL re-extraction every reconcile pass — never cached across
  passes (per L-11). Reuse `discover()` from `catalog.ts`.

**Area 3 — API + Concurrency (D-API)**

- **D-API-01** `POST /api/protect-hub/reconcile` — non-blocking, returns 202
  + `{ reconcileId: <uuid> }`. Status polled via `GET
  /api/protect-hub/reconcile-runs?reconcileId=…`.
- **D-API-02** `PUT /api/cameras/[id]/outputs` — set outputs (replace).
  Toggle ON/OFF triggers in-process force-reconcile.
- **D-API-03** Single-flight: module-scoped Promise per bridge id. Queue depth 1:
  extra triggers SET a dirty flag and return immediately; in-flight reconcile
  completes, checks dirty flag, runs ONE follow-up.
- **D-API-04** `update-runner.ts` (P24) imports `isReconcilerBusy()`. If true,
  HTTP 409 with `Retry-After: 60`.
- **D-API-05** WS reconnect: exp backoff `[5, 10, 30, 60, 120, 300]`s
  (cap 5min); single-flight; on reconnect, full bootstrap re-fetch + force-reconcile.

**Area 4 — VAAPI Cap + Health Probe (D-CAP)**

- **D-CAP-01** Soft cap (4 MJPEG outputs): emit `vaapi_soft_cap_warning` event;
  toggle-on still succeeds (UI banner is P22).
- **D-CAP-02** Hard cap (6 MJPEG outputs): `PUT /api/cameras/[id]/outputs`
  returns HTTP 422 with `{ ok: false, reason: "vaapi_hard_cap_exceeded",
  message: "Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge
  möglich. Aktuell: 6." }`.
- **D-CAP-03** Health probe extension: extend existing `healthCheckInterval`
  in `scheduler.ts` (one extra `fetch(http://<bridgeIp>:1984/api/streams)`
  per tick — already wired in P20, see `scheduler.ts:138-160`). Threshold:
  2 consecutive failures → `protect_hub_bridges.status='unhealthy'` +
  reconcile log event. Recovery: single success → `status='running'`.
- **D-CAP-04** Bridge unreachable mid-reconcile: SSH dial fail → reconcile
  aborts, `status='bridge_unreachable'`, retry on next 5min tick.

### Claude's Discretion

The following are implementation details the planner / executor decide:
- Exact stream slug suffix wording (loxone-low vs simply low; frigate-high vs high)
- File layout: `src/lib/server/orchestration/protect-hub/yaml-builder.ts` +
  `reconcile.ts` is the obvious split, but planner may bundle into one if
  rationale is sound
- Test structure (which assertions belong to yaml-builder vs reconcile)
- Migration strategy for the new `protect_hub_reconcile_runs` table
  (`ensureColumn` pattern from existing schema migrations vs. drizzle-kit)

### Deferred Ideas (OUT OF SCOPE)

- VAAPI cap UI banner styling and exact German wording — owned by P22
- "All Hub URLs" copy-list page — P22
- Bulk-toggle output type across cams — P22
- Drift indicator UI surface — P23 (P21 only writes to `protect_hub_reconcile_runs`)
- Per-stream metrics card — P23
- "Export Hub config before uninstall" — P23
- Auto-add new Protect cam (kind-based default ON/OFF) and soft-delete with
  7-day grace — covered by L-20 + L-28; P21 implements the writeback in
  reconcile, P23 implements UI

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HUB-OUT-01 | Each Protect cam can independently activate one or more outputs (Loxone-MJPEG, Frigate-RTSP) | `cameraOutputs` table from P19 (already shipped); reconcile reads `WHERE enabled=1`; `PUT /api/cameras/[id]/outputs` route |
| HUB-OUT-02 | Loxone-MJPEG transcodes via VAAPI 640×360@10fps; URL `http://<bridge-ip>:1984/api/stream.mjpeg?src=<cam-slug>-low` | D-PIPE-02 ffmpeg form; verified by Florian Rhomberg recipe + meintechblog 2025-11-07 |
| HUB-OUT-03 | Frigate-RTSP `-c:v copy -an` passthrough; URL `rtsp://<bridge-ip>:8554/<cam-slug>-high` | D-PIPE-04 ffmpeg form; zero VAAPI cost per L-26 |
| HUB-OUT-04 | VAAPI cap soft 4 / hard 6 MJPEG; Frigate copy is uncounted | D-CAP-01/02; counted in `PUT outputs` handler before write |
| HUB-OUT-05 | First-party UniFi default ON; third-party default OFF | L-28 + D-CLASS-01 (`isThirdPartyCamera` boolean from `protect-types.ts:788`); reconcile applies on auto-add |
| HUB-OUT-06 | Stream URLs stable across cam-name edits — slug derived from MAC | D-PIPE-06 (`<mac-slug>-<suffix>`); MAC stored in `cameras.mac` per L-1 |
| HUB-OUT-07 | One-click copy + per-target hint snippet | P21 backend emits the URLs; UI rendering in P22 |
| HUB-RCN-01 | Auto-reconcile every 5min when `settings.protect_hub_enabled=true` | L-5 + L-6; new `protectHubReconcileInterval` in `scheduler.ts` |
| HUB-RCN-02 | Force-reconcile on every output toggle | D-API-02; in-process call to `reconcile()` from PUT handler |
| HUB-RCN-03 | Manual "Sync now" button → force-reconcile + log | D-API-01 (`POST /api/protect-hub/reconcile` endpoint); UI in P22 |
| HUB-RCN-04 | Re-extract URLs from bootstrap every pass | D-RCN-05 (call `discover()` first); per L-11 |
| HUB-RCN-05 | Canonical sha256 dedupe — identical YAML = no-op | D-RCN-01; `yaml@2.6` `stringify({sortMapEntries:true})` then strip stamp then sha256 |
| HUB-RCN-06 | Single-flight + dirty-flag retry | D-API-03; module-scoped Promise + boolean `dirty` flag |
| HUB-RCN-07 | WS reconnect exp backoff `[5,10,30,60,120,300]`s, single-flight, full bootstrap on reconnect | D-API-05; `unifi-protect` lib does NOT auto-reconnect (verified via lib source) — P21 wraps it |
| HUB-RCN-08 | Auto-add new cam (default ON for first-party, OFF for third-party) | L-28; in `discover()` upsert, on insert seed `cameraOutputs` row per kind |
| HUB-RCN-09 | Removed cam → `cameras.source='external_archived'`; 7-day grace | L-20; P21 only does the write — UI surface in P23 |
| HUB-RCN-10 | Self-update returns 409 if `reconciler.busy`; YAML deploy via tmp+rename | D-API-04 + D-RCN-03; `update-checker.ts:getActiveFlowConflicts()` already exists — extend with `isReconcilerBusy()` |
| HUB-OPS-05 | Bridge health probe extends existing `healthCheckInterval` | D-CAP-03; already wired in `scheduler.ts:138-160` (P20) — P21 adds 2-strike threshold |

---

## Project Constraints (from CLAUDE.md)

The repo's `CLAUDE.md` mandates:
- **Public GitHub repo** (`meintechblog/ip-cam-master`) — never commit credentials,
  Protect tokens, SSH keys, or any host-specific secrets. The yaml-builder
  must NEVER write tokens into committed test fixtures (use redacted
  placeholders).
- **TypeScript strict** — no `any` without comment.
- **Drizzle for schema + queries**; no raw SQL except in migrations
  (`client.ts ensureColumn` pattern OK for the new `protect_hub_reconcile_runs`
  table).
- **Vitest with `vi.hoisted` mocks**; in-memory `better-sqlite3` + drizzle
  for DB tests.
- **Module-level singletons** for stateful services (lib client, scheduler
  intervals, single-flight Promise).
- **GSD Workflow Enforcement** — work goes through GSD commands; this RESEARCH.md
  is the input to `/gsd-plan-phase 21`.
- **Atomic per-task git commits** with Why/How messages + Co-Authored-By trailer.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YAML emission (multi-cam streams block) | API/Backend (Node service) | — | Pure compute, no IO; testable in isolation |
| Canonical-form hashing & deploy diff | API/Backend (orchestration) | — | Reads DB, computes hash; no UI involvement |
| SSH push to bridge LXC + go2rtc reload | API/Backend (orchestration → ssh.ts → Proxmox) | OS (systemd inside LXC restarts go2rtc) | `pushFileToContainer` already centralizes the SSH path |
| Scheduler tick (5min reconcile + bridge health) | API/Backend (scheduler.ts) | — | Existing pattern; new interval added next to `healthCheckInterval` |
| Force-reconcile API | API/Backend (SvelteKit `+server.ts` route) | Browser/Client (P22 polls `GET reconcile-runs`) | 202+id pattern keeps UI thread free |
| Output toggle endpoint | API/Backend (SvelteKit `+server.ts` route) | Browser/Client (P22 form) | Persistent write to `cameraOutputs` + in-process reconcile call |
| WebSocket reconnect manager | API/Backend (Node module singleton) | External (UDM Protect controller) | Lib (`unifi-protect@4.29.0`) does NOT auto-reconnect — wrapper required |
| VAAPI cap enforcement | API/Backend (validation in PUT handler) | Database (count `WHERE enabled=1 AND outputType='loxone-mjpeg'`) | DB count is source of truth — soft/hard caps gate writes, NOT runtime check |
| Reconcile event log table | Database (SQLite via drizzle) | API/Backend (writes; P23 reads) | Mirrors `update_runs` table layout from P24 — proven pattern |
| Self-update busy gate | API/Backend (`update-checker.ts` calls `isReconcilerBusy()`) | — | Existing `getActiveFlowConflicts()` extends with one more conflict kind |

---

## Standard Stack

### Core (already installed; no version bumps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yaml` (eemeli) | `^2.6.0` (verified `2.6.0` published 2024-09-28 — [npm view yaml@2.6 version]) | Canonical YAML emission | `sortMapEntries:true` flag enables deterministic key order; supports custom comparator function for nested maps. Already pinned in package.json. |
| `unifi-protect` | `^4.29.0` | Protect API client + WebSocket events | Already used by `protect-bridge.ts`; lib emits `bootstrap`, `message`, `login` events but does NOT auto-reconnect on disconnect (verified via [hjdhjd/unifi-protect/src/protect-api.ts]) — wrapper needed |
| `node-ssh` | `^13.2.1` | SSH transport for `pushFileToContainer` | Already used by `bridge-provision.ts` |
| `better-sqlite3` | `^12.6.2` | Synchronous SQLite via `db.transaction()` | Already wired; reconcile run insert is a single `db.insert(...).run()` |
| `drizzle-orm` | `^0.45.1` | Typed queries for `cameraOutputs`, `protectStreamCatalog`, `protectHubReconcileRuns` | Existing schema patterns |
| `vitest` | `^4.1.0` | Unit + integration tests with `vi.hoisted` mocks | Existing project standard; `bridge-provision.test.ts` is the exemplar |

[VERIFIED: npm registry 2026-05-06] — `yaml@2.6.0` is the latest 2.6 line.
The `^` constraint will pick up 2.6.x patches. Major v2.6 release notes:
[github.com/eemeli/yaml/releases].

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (built-in) | Node 22 | `randomUUID()` for `reconcileId`; `createHash('sha256')` for canonical hash | Both reconcile module + yaml-builder fingerprint helper |
| `node:child_process` (transitively via SSH) | — | None directly in P21; SSH wraps it | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaml@2.6` `sortMapEntries:true` | `js-yaml` with `sortKeys` | `js-yaml` lacks per-collection comparator and is in maintenance mode; `yaml` (eemeli) is the active choice and already in package.json |
| `systemctl reload-or-restart go2rtc` | `POST /api/restart` against go2rtc HTTP API | The HTTP API path requires hitting `0.0.0.0:1984` from the app VM and waiting for go2rtc to come back up; `systemctl` via `pct exec` is the proven pattern (used by `generateBridgeSystemdUnit`) and survives go2rtc being unreachable |
| go2rtc `PUT /api/streams` (runtime add) | YAML-as-source-of-truth with restart | PITFALLS #5 + L-7 already locked YAML-as-source-of-truth: runtime API edits are not persistent across container restarts; YAML is the only sane source |
| Crypto in `web crypto` API (`crypto.subtle`) | `node:crypto` `createHash` | `node:crypto.createHash('sha256')` is synchronous and zero-allocation; `crypto.subtle.digest` is async + returns ArrayBuffer; not worth the ergonomic cost |

**No new install commands.** All deps already in `package.json` since P19.

---

## Architecture Patterns

### System Architecture Diagram

```
                        ┌──────────────────────────────────────┐
                        │  Trigger sources (4)                  │
                        │  ─────────────────────                │
                        │  1. scheduler tick (5min, P21 NEW)    │
                        │  2. POST /api/protect-hub/reconcile   │
                        │  3. PUT /api/cameras/[id]/outputs     │
                        │  4. WS reconnect (full bootstrap)     │
                        └──────────────────┬───────────────────┘
                                           │
                                           ▼
                        ┌──────────────────────────────────────┐
                        │  reconcile.ts:reconcile(bridgeId)    │
                        │  ──────────────────────────────────   │
                        │  - check single-flight Promise        │
                        │    in-flight? set dirty=true, return  │
                        │  - acquire lock (Promise stored)      │
                        │  - INSERT protect_hub_reconcile_runs  │
                        │    (status=running, reconcileId)      │
                        └──────────────────┬───────────────────┘
                                           │
                                           ▼
              ┌────────────────────────────────────────────────┐
              │  Pass 1 — Re-extract URLs (HUB-RCN-04)         │
              │  ───────────────────────────────────────────    │
              │  catalog.discover() — fetchBootstrap() +       │
              │  upsert protect_stream_catalog with fresh      │
              │  rtspAlias tokens (PITFALLS #1: never cached)  │
              └──────────────────┬─────────────────────────────┘
                                 │
                                 ▼
              ┌────────────────────────────────────────────────┐
              │  Pass 2 — Build YAML                            │
              │  ─────────────────────                          │
              │  query: external cams JOIN cameraOutputs       │
              │         WHERE enabled=1                         │
              │         JOIN protectStreamCatalog               │
              │  → yaml-builder.ts:buildBridgeYaml(rows, id)   │
              │    emits multi-stream YAML with stamp comment   │
              │    (per L-8) + ffmpeg blocks per D-PIPE-02/04   │
              └──────────────────┬─────────────────────────────┘
                                 │
                                 ▼
              ┌────────────────────────────────────────────────┐
              │  Pass 3 — Canonical hash + dedupe              │
              │  ──────────────────────────────────────────     │
              │  - strip first-line stamp comment               │
              │  - canonical = yaml.stringify(parsed,           │
              │                  {sortMapEntries:true})         │
              │  - sha256(canonical) → newHash                  │
              │  - mtime fast-path: ssh stat -c '%Y %s' file    │
              │  - if (mtime+hash match last_deployed) → no_op  │
              │    UPDATE reconcile_runs status='no_op',        │
              │    completedAt=now, return                       │
              └──────────────────┬─────────────────────────────┘
                                 │ (hash differs OR mtime differs)
                                 ▼
              ┌────────────────────────────────────────────────┐
              │  Pass 4 — Deploy                                │
              │  ───────                                        │
              │  - ssh.connectToProxmox()                       │
              │  - pushFileToContainer(ssh, vmid, fullYaml,    │
              │       '/etc/go2rtc/go2rtc.yaml')                │
              │    *** see Code-Reality-Check: not actually     │
              │    tmp+rename atomic — planner decision         │
              │  - executeOnContainer(ssh, vmid,                │
              │       'systemctl restart go2rtc')               │
              │    *** go2rtc has no SIGHUP — reload == restart │
              │  - UPDATE protect_hub_bridges                   │
              │       SET last_deployed_yaml_hash = newHash,    │
              │           last_reconciled_at = now              │
              │  - UPDATE reconcile_runs status='success',      │
              │       hashChanged=1, deployedYamlHash=newHash   │
              │  - ssh.dispose()                                │
              └──────────────────┬─────────────────────────────┘
                                 │
                                 ▼
              ┌────────────────────────────────────────────────┐
              │  Cleanup — release lock                         │
              │  ─────────────────────                          │
              │  - if dirty=true: schedule single follow-up     │
              │    reconcile (queue depth 1)                    │
              │  - clear in-flight Promise                      │
              └────────────────────────────────────────────────┘

   Parallel: WS reconnect manager (separate module-scoped state)
   ───────────────────────────────────────────────────────────
   On lib emits 'login: false' OR `_eventsWs` cleanup detected:
     - schedule reconnect with backoff[attempt++]
     - on success: reset attempt=0, force-reconcile (URL refresh)
   On bootstrap success after disconnect:
     - reset attempt counter
     - call reconcile(bridgeId) with reason='ws_reconnect'

   Parallel: scheduler tick (P20 healthCheckInterval extension)
   ───────────────────────────────────────────────────────────
   Every 5min in healthCheckInterval (already shipped P20:138-160):
     - bridge fetch http://bridgeIp:1984/api/streams (3s timeout)
     - on success: reset failureCount, status='running'
     - on failure: increment failureCount; if ≥2 → status='unhealthy',
       emit health event
     P21 adds 2-strike threshold (currently single-shot)
```

### Component Responsibilities

| File | Responsibility | New / Modified |
|------|---------------|----------------|
| `src/lib/server/orchestration/protect-hub/yaml-builder.ts` | Pure function: `buildBridgeYaml(cams, outputs, catalog, reconcileId) → string`. No IO, no DB. | NEW |
| `src/lib/server/orchestration/protect-hub/reconcile.ts` | Orchestrator: query → discover → build → hash → diff → deploy. Exposes `reconcile(bridgeId, reason)`, `isReconcilerBusy()`. | NEW |
| `src/lib/server/orchestration/protect-hub/ws-manager.ts` | Singleton WS reconnect with backoff `[5,10,30,60,120,300]`s. Exposes `startWs()`, `stopWs()`. | NEW |
| `src/lib/server/services/scheduler.ts` | Add `protectHubReconcileInterval`; gate on `settings.protect_hub_enabled`; extend bridge health probe with 2-strike threshold | MODIFIED |
| `src/lib/server/services/update-checker.ts` | Extend `getActiveFlowConflicts()` to call `isReconcilerBusy()` and append `{kind:'reconciler_busy', detail:...}` | MODIFIED |
| `src/lib/server/db/schema.ts` | Add `protectHubReconcileRuns` drizzle table | MODIFIED |
| `src/lib/server/db/client.ts` | Add `CREATE TABLE IF NOT EXISTS protect_hub_reconcile_runs` block + index | MODIFIED |
| `src/routes/api/protect-hub/reconcile/+server.ts` | POST: 202 + reconcileId; spawn reconcile in background | NEW |
| `src/routes/api/protect-hub/reconcile-runs/+server.ts` | GET: query rows, support `?reconcileId=` filter | NEW |
| `src/routes/api/cameras/[id]/outputs/+server.ts` | PUT: validate VAAPI cap, write `cameraOutputs`, trigger force-reconcile | NEW |
| `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` | Golden-file fixtures: 1 cam Loxone-only, 1 cam Frigate-only, 2 cams mixed, 0 cams (empty bridge), HEVC source | NEW |
| `src/lib/server/orchestration/protect-hub/reconcile.test.ts` | Single-flight serialization test, dirty-flag follow-up test, no-op skip test, bridge-unreachable abort test | NEW |
| `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` | Backoff schedule [5,10,30,60,120,300] test, single-flight reconnect test, force-reconcile-on-reconnect test | NEW |

### Recommended Project Structure

```
src/lib/server/orchestration/protect-hub/   # ALREADY EXISTS from P19+P20
├── catalog.ts                # P19 — discover() + loadCatalog() (REUSE)
├── catalog.test.ts
├── bridge-provision.ts       # P20 (REUSE; do not modify)
├── bridge-provision.test.ts
├── bridge-lifecycle.ts       # P20 (REUSE; do not modify)
├── bridge-lifecycle.test.ts
├── yaml-builder.ts           # P21 NEW
├── yaml-builder.test.ts      # P21 NEW (golden-file fixtures)
├── reconcile.ts              # P21 NEW (heart)
├── reconcile.test.ts         # P21 NEW
├── ws-manager.ts             # P21 NEW
└── ws-manager.test.ts        # P21 NEW

src/routes/api/protect-hub/                 # ALREADY EXISTS from P19+P20
├── bridge/                   # P20
│   ├── provision/+server.ts
│   ├── status/+server.ts
│   ├── start/+server.ts
│   ├── stop/+server.ts
│   └── restart/+server.ts
├── discover/+server.ts       # P19
├── reconcile/+server.ts      # P21 NEW (POST 202 + id)
└── reconcile-runs/+server.ts # P21 NEW (GET status)

src/routes/api/cameras/[id]/                # ALREADY EXISTS
└── outputs/+server.ts        # P21 NEW (PUT)
```

### Pattern 1: Single-flight Promise + dirty-flag retry

**What:** One in-flight reconcile per bridge; subsequent triggers set a flag
and return immediately. Lock-holder runs follow-up if dirty.

**When to use:** Both API-driven (`POST /api/protect-hub/reconcile`,
`PUT /outputs`) and tick-driven (`scheduler.ts`) reconciles funnel through
the same `reconcile(bridgeId, reason)` function.

**Example (TypeScript):**
```typescript
// reconcile.ts
type ReconcileReason = 'tick' | 'force' | 'output_toggle' | 'ws_reconnect';

let _inFlight: Promise<ReconcileResult> | null = null;
let _dirty = false;

export function isReconcilerBusy(): boolean {
  return _inFlight !== null;
}

export async function reconcile(
  bridgeId: number,
  reason: ReconcileReason
): Promise<ReconcileResult> {
  if (_inFlight) {
    _dirty = true;
    return _inFlight; // share the in-flight result with the new caller
  }

  const reconcileId = crypto.randomUUID();
  _inFlight = doReconcile(bridgeId, reconcileId, reason);

  try {
    const result = await _inFlight;
    return result;
  } finally {
    _inFlight = null;
    if (_dirty) {
      _dirty = false;
      // Schedule one follow-up (queue depth 1). Fire-and-forget; it
      // creates its own in-flight Promise via re-entry.
      setImmediate(() => reconcile(bridgeId, 'tick').catch(() => {}));
    }
  }
}
```

**Why this shape:** matches L-13 (per-bridge mutex) and PITFALLS #6 mitigation.
The `setImmediate` decouples the follow-up from the API caller's Promise so
the `PUT /outputs` HTTP response returns once the first reconcile finishes,
not after the follow-up.

### Pattern 2: Canonical-form sha256 with stamp strip

**What:** Hash YAML semantically-not-bytewise; otherwise every render with a
fresh stamp comment produces a new hash and dedupe is useless.

**When to use:** Every reconcile pass, before deciding to deploy.

**Example (TypeScript):**
```typescript
// yaml-builder.ts
import { stringify, parse } from 'yaml';
import { createHash } from 'node:crypto';

export const STAMP_REGEX = /^# managed by ip-cam-master, reconcile-id [^\n]+\n/;

export function canonicalHash(yamlText: string): string {
  // 1. strip the stamp comment (first line, varies every render)
  const stripped = yamlText.replace(STAMP_REGEX, '');

  // 2. round-trip through yaml.stringify with sortMapEntries to normalize
  //    whitespace, quoting style, key ordering at all nesting levels.
  //    sortMapEntries:true → applies to all maps in the document tree
  //    (per yaml@2.6 docs at eemeli.org/yaml/#sortmapentries — confirmed
  //     `(a, b: Pair) => number` comparator and Schema-level scope).
  const parsed = parse(stripped);
  const canonical = stringify(parsed, { sortMapEntries: true });

  return createHash('sha256').update(canonical).digest('hex');
}
```

**Verified:** `yaml@2.6.0`'s `sortMapEntries:true` is a Schema option applied
during stringification — it operates as the sort comparator at every map node
the stringifier visits, so nested maps are also sorted (same comparator
function used recursively). Source: [eemeli.org/yaml/#sortmapentries] +
[github.com/eemeli/yaml/blob/main/docs/03_options.md].

### Pattern 3: mtime fast-path with defensive re-deploy

**What:** Avoid pulling the YAML over SSH when nothing has changed. Use a
single `stat -c "%Y %s" file` call — typically <100 ms over SSH.

**When to use:** Inside reconcile, AFTER hashing the freshly-built YAML, BEFORE
the SSH push.

**Example (TypeScript pseudocode):**
```typescript
// reconcile.ts  (inside doReconcile)
const newYaml = buildBridgeYaml(...);
const newHash = canonicalHash(newYaml);

if (newHash === bridge.lastDeployedYamlHash) {
  // Hash matches the last deploy — but we still defensively check the file
  // exists with the expected mtime to detect drift (someone manually edited).
  const ssh = await connectToProxmox();
  try {
    const statResult = await ssh.execCommand(
      `pct exec ${bridge.vmid} -- stat -c "%Y" /etc/go2rtc/go2rtc.yaml`
    );
    const remoteMtime = parseInt(statResult.stdout.trim(), 10);
    const lastDeployMtime = bridge.lastReconciledAt
      ? Math.floor(Date.parse(bridge.lastReconciledAt) / 1000)
      : 0;

    // Tolerance: ±2s (clock skew between Proxmox host and app VM)
    if (Math.abs(remoteMtime - lastDeployMtime) <= 2) {
      // Both hash and mtime check out → real no-op
      return { status: 'no_op', hashChanged: false };
    }
    // mtime drifted but hash matches → defensive re-deploy
  } finally {
    ssh.dispose();
  }
}

// Hash differs OR mtime drifted → deploy
```

**Cost:** one `stat` call over SSH ≈ 80 ms (one round-trip; pct exec).
Within the SC-3 "<2s reconcile cycle when YAML unchanged" budget.

### Pattern 4: WebSocket reconnect with single-flight + exp backoff

**What:** `unifi-protect@4.29.0` does NOT auto-reconnect on disconnect — its
`launchEventsWs()` is called once during `getBootstrap()` and the lib only
cleans up `_eventsWs = null` on close. (Verified via lib source.) P21 must
implement reconnect on top.

**When to use:** Long-lived connection to the UDM Protect WebSocket; backoff
on disconnect; force-reconcile on reconnect.

**Example (TypeScript pseudocode):**
```typescript
// ws-manager.ts
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000];
let _attempt = 0;
let _reconnectingPromise: Promise<void> | null = null;
let _stopped = false;

export async function startWs(): Promise<void> {
  _stopped = false;
  await connectAndListen();
}

async function connectAndListen(): Promise<void> {
  const client = await getProtectClient();
  // Re-bootstrap re-launches the events WS internally (per lib source)
  const ok = await client.getBootstrap();
  if (!ok) return scheduleReconnect();

  _attempt = 0; // reset on success

  // Detect disconnect via 'login' false event or close on the events WS
  client.on('login', (success: boolean) => {
    if (!success && !_stopped) scheduleReconnect();
  });

  // After successful (re)connect, force a reconcile to refresh URLs
  // (PITFALLS #1 — Protect tokens may have rotated during disconnect)
  const bridge = db.select().from(protectHubBridges).get();
  if (bridge) {
    void reconcile(bridge.id, 'ws_reconnect').catch(() => {});
  }
}

function scheduleReconnect(): void {
  if (_stopped || _reconnectingPromise) return;
  const delay = BACKOFF_SCHEDULE_MS[Math.min(_attempt, BACKOFF_SCHEDULE_MS.length - 1)];
  _attempt++;
  _reconnectingPromise = new Promise<void>((resolve) => {
    setTimeout(async () => {
      _reconnectingPromise = null;
      try {
        await connectAndListen();
      } catch {
        scheduleReconnect();
      }
      resolve();
    }, delay);
  });
}

export function stopWs(): void {
  _stopped = true;
  resetProtectClient(); // from protect-bridge.ts
}
```

**Why this shape:** matches L-12 (exp backoff 5s → 5min cap, single-flight,
full bootstrap on reconnect) and PITFALLS #3 mitigation. `resetProtectClient()`
is already exported from `protect-bridge.ts` and forces a fresh login on next
`getProtectClient()` call.

### Anti-Patterns to Avoid

- **Don't** call `PUT /api/streams` on go2rtc to add streams at runtime. PITFALLS
  #5 + L-7: YAML is the only sane source of truth. Runtime API edits are not
  persistent across container restarts and create drift. Confirmed by
  [github.com/AlexxIT/go2rtc/issues/1136] — there is currently no API to
  reload streams without restart.
- **Don't** hash raw bytes. Stamp comment varies every render → infinite
  redeploy loop. PITFALLS #5 + #11. Always hash canonical form.
- **Don't** cache Protect URLs across reconcile passes. PITFALLS #1: tokens
  rotate on UDM reboot. Re-extract via `discover()` every pass.
- **Don't** fire reconciles in parallel. PITFALLS #6: even two simultaneous
  triggers can interleave SSH writes → corrupted YAML. Single-flight Promise
  is mandatory.
- **Don't** put reconcile on the existing 60s `logScanInterval` SSH log scan.
  PITFALLS architectural map: different cadence, different config gate, one
  slow SSH timeout starves the other. Dedicated `protectHubReconcileInterval`.
- **Don't** rely on `unifi-protect`'s auto-reconnect — it doesn't exist.
  Wrap manually with backoff.
- **Don't** count Frigate-RTSP outputs against the VAAPI cap. L-26 + D-CAP-02:
  `-c:v copy` is zero VAAPI cost.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-stream YAML emission | Hand-templated string concatenation | `yaml@2.6.stringify()` with typed input | Multi-line `exec:` strings + nested maps + comment preservation are fragile to escape by hand; lib already in package.json |
| WebSocket reconnect backoff | Naive `setTimeout(connect, 1000)` | Exp backoff schedule + single-flight Promise (Pattern 4 above) | PITFALLS #3 — connect storms during UDM reboot are a known footgun; matches Bambu MQTT pattern from v1.2 |
| Canonical YAML hashing | Raw `sha256(fileContents)` | Strip stamp + parse + restringify with `sortMapEntries:true`, then sha256 | Whitespace + key-order changes from any source produce false-positive drift |
| Reconcile concurrency | Per-camera locks | Per-bridge module-scoped Promise + dirty flag | YAML is one atomic unit per bridge; per-camera locking creates worse races (PITFALLS #6) |
| Atomic file write to LXC | Open-and-overwrite via SSH | `pushFileToContainer` writes to `<dest>.tmp` then `mv <dest>.tmp <dest>` | tmp+rename is single-syscall atomic on local FS; current `pushFileToContainer` does NOT do this — see §Code-Reality-Check |
| Reconcile run history | JSON blob in `settings` | Drizzle table `protect_hub_reconcile_runs` (mirror of `update_runs`) | UI in P23 needs queries (filter by status, time-range); proven pattern from P24 |

**Key insight:** Every "hand-roll" risk in this phase is a known PITFALL with a
named mitigation. The lift is wiring, not invention.

---

## Code Reality Check (Surprises Found in Codebase)

These are gaps between CONTEXT.md assumptions and what the source code actually does.
**Plan-phase MUST address each.**

### CR-1: `pushFileToContainer` is NOT tmp+rename atomic

CONTEXT.md D-RCN-03 says: "Use existing `pushFileToContainer` helper from
`ssh.ts` (already implements tmp+rename per Phase 18 pattern)."

**Reality** (`ssh.ts:79-95`):
```typescript
export async function pushFileToContainer(ssh, vmid, content, remotePath) {
  const tmpPath = `/tmp/ipcam-${Date.now()}`;
  await ssh.execCommand(`cat > ${tmpPath} << 'IPCAMEOF'\n${content}\nIPCAMEOF`);
  await ssh.execCommand(`pct push ${vmid} ${tmpPath} ${remotePath}`);
  await ssh.execCommand(`rm ${tmpPath}`);
}
```

The `tmpPath` is on the **Proxmox host**, NOT inside the LXC. `pct push`
writes directly to `remotePath` inside the container — there is no tmp file
inside the LXC and no `mv` step. If go2rtc reads the file mid-`pct push`, it
sees a partial file.

**Mitigations the planner can choose from:**
1. **Extend `pushFileToContainer`** to optionally do tmp+rename inside the
   container: push to `<remotePath>.tmp.<reconcileId>`, then
   `executeOnContainer(ssh, vmid, 'mv ${tmpInside} ${remotePath}')`. Add a
   regression test in `ssh.test.ts`. Touches a file outside `protect-hub/`,
   but it's a 4-line addition and improves correctness for ALL callers
   (including the per-cam path).
2. **Wrap in `reconcile.ts`** — call `pushFileToContainer(ssh, vmid, content,
   '/etc/go2rtc/go2rtc.yaml.tmp.<id>')` then `executeOnContainer(ssh, vmid,
   'mv /etc/go2rtc/go2rtc.yaml.tmp.<id> /etc/go2rtc/go2rtc.yaml')`. Keeps
   `ssh.ts` unchanged.
3. **Accept go2rtc's restart loop as recovery.** systemd has `Restart=always`
   on go2rtc (per `generateBridgeSystemdUnit`). If go2rtc crashes on a partial
   YAML it auto-restarts within 5s and retries. ~3s of stream blackness on
   ~1-in-1000 deploys is probably acceptable for v1.3. Document explicitly.

**Recommendation:** Option 2. Self-contained inside `reconcile.ts`, no
collateral changes, satisfies HUB-RCN-10's "tmp+mv atomic" requirement
literally.

### CR-2: `protectStreamUrl` already returns `rtsps://` — no rewrite needed

CONTEXT.md `<canonical_refs>` says: "yaml-builder MUST rewrite Protect's
published `rtspx://...` URLs to `rtsps://...`."

**Reality** (`protect-bridge.ts:123-127`):
```typescript
export function protectStreamUrl(host: string, rtspAlias: string): string {
  return TLS_SCHEME === 'rtspx'
    ? `rtspx://${host}:7441/${rtspAlias}?enableSrtp`
    : `rtsps://${host}:7441/${rtspAlias}?enableSrtp`;
}
```

Since `TLS_SCHEME = 'rtsps-tls-verify-0'` (locked by spike), this function
already returns `rtsps://...`. The catalog upsert (`catalog.ts:140`) writes
this to `protectStreamCatalog.rtspUrl`. yaml-builder reads
`row.rtspUrl` from the DB and gets the right scheme already.

**Implication:** yaml-builder does NOT need to do URL rewriting. It just
consumes `protectStreamCatalog.rtspUrl` directly and appends the per-output
ffmpeg query-string suffixes from D-PIPE-02/04.

### CR-3: `go2rtc systemctl reload` does NOT do graceful reload

CONTEXT.md D-RCN-03 says "`systemctl reload-or-restart go2rtc`."

**Reality** (verified via [deepwiki.com/AlexxIT/go2rtc/1.2-configuration-basics]
and lib doc review): go2rtc has **no SIGHUP handler** and **no file watcher**.
Its only "reload" paths are `POST /api/restart` (HTTP API) and `POST
/api/config` (overwrites YAML + restarts). There is no `ExecReload=` in our
generated systemd unit (`generateBridgeSystemdUnit` does not define one).

**Implication:** `systemctl reload-or-restart go2rtc` will fall through to
`restart` because no `ExecReload` is defined. Every YAML deploy bounces ALL
consumer streams for ~1–3s (the time go2rtc takes to start + redial all
upstream RTSP sources). PITFALLS #17 already calls this out for Loxone:
"After a planned bridge restart, expect 1–5s blip on Loxone tiles."

**Implication for testing:** the "no-op" path (hash unchanged) MUST NOT call
`systemctl restart`, otherwise a quiet user gets a 1–3s tile blip every 5
minutes. Already covered by D-RCN-02 (skip deploy when hash matches), but
the test suite must explicitly verify `systemctl restart` is NOT called on
the no-op path.

**Recommendation:** Use `systemctl restart go2rtc` (drop the `reload-or-restart`
fiction). Document in code comment that go2rtc has no SIGHUP and that every
YAML change costs a 1–3s consumer blip. Mitigate by trusting the canonical-
hash dedupe to skip 99% of reconciles.

### CR-4: `update-checker.ts:getActiveFlowConflicts()` exists — extend, don't replace

`update-checker.ts:50-69` already implements the busy-flag pattern:

```typescript
export function getActiveFlowConflicts(): Array<{
  kind: 'hub_starting' | 'hub_stopping';
  detail: string;
}> {
  // checks protectHubBridges.status
}
```

P21 should **extend** this function's return type to include
`'reconciler_busy'` and the array branch:

```typescript
type FlowConflict =
  | { kind: 'hub_starting' | 'hub_stopping'; detail: string }
  | { kind: 'reconciler_busy'; detail: string };

// Add:
if (isReconcilerBusy()) {
  conflicts.push({ kind: 'reconciler_busy', detail: 'Protect Hub reconcile in progress' });
}
```

This satisfies HUB-RCN-10 + L-14 + D-API-04 with one import + 4 lines.

### CR-5: `discover()` already does the L-11 URL re-extraction work

`catalog.ts:38-157` already:
- Calls `fetchBootstrap()`
- Iterates `cam.channels.filter(c => c.enabled)`
- Computes `protectStreamUrl(cam.host, ch.rtspAlias)` per channel
- Writes the result to `protectStreamCatalog.rtspUrl`

**Implication:** P21's reconcile MUST call `discover()` as Pass 1 (per
D-RCN-05); after that, the yaml-builder reads from `protectStreamCatalog`
which is now fresh.

### CR-6: `cameras.kind` enum doesn't include `'external_archived'` yet

P19 added `cameras.source = 'external'` and `cameras.kind` columns, but the
soft-delete state `source = 'external_archived'` (per L-20 + HUB-RCN-09) is
**not yet seen anywhere in the schema or code**. P21's HUB-RCN-09 requires
this transition.

**Implication:** P21 must:
1. NOT add a CHECK constraint on `cameras.source` (it's free text already)
2. In `discover()` (or in reconcile's auto-add/auto-archive logic) detect
   "cam was in last bootstrap, missing now" → `UPDATE cameras SET source =
   'external_archived' WHERE mac = ?`
3. Filter `cameras WHERE source = 'external'` (NOT `'external_archived'`)
   in the reconcile query so archived cams stop being deployed
4. The UI to surface archived cams (drift indicator, "remove from hub" CTA)
   is P23 — P21 just does the writeback

---

## Common Pitfalls

> All cross-references go to `.planning/research/v1.3/PITFALLS.md`.

### Pitfall P21-#1: Protect "Share Livestream" RTSPS token rotation

**What goes wrong:** Token in `rtsps://...?enableSrtp` URL changes on every
UDM reboot, firmware update, or controller restart. Cached YAML becomes a
graveyard of 404 dead links.

**Why it happens:** Tokens are session-scoped, regenerated on Protect process
start; they're capabilities, not stable identifiers. Confirmed by
[openHAB#20072].

**How to avoid:** D-RCN-05 + L-11 — re-extract URLs every reconcile pass via
`discover()`. Hash the *resolved URL inside the deployed YAML* — if the token
rotated, hash differs → automatic redeploy.

**Test idea:** Mock `fetchBootstrap()` to return cam with `rtspAlias='oldtoken'`,
run reconcile, then change mock to `'newtoken'`, run reconcile again. Assert
that the second pass:
1. Produces a different YAML (`newHash !== oldHash`)
2. Calls `pushFileToContainer` (not skipped as no-op)
3. UPDATEs `protect_hub_bridges.lastDeployedYamlHash` to the new value

**Warning signs:** All Loxone tiles black after a known UDM reboot; go2rtc
log shows `404 Not Found` on `:7441/<token>`.

### Pitfall P21-#3: WebSocket reconnect storm during UDM reboots

**What goes wrong:** Naive 1s reconnect floods the UDM during its 60–120s
boot, causes UDM-side rate-limit + race conditions on first acceptance.

**How to avoid:** Pattern 4 above — exp backoff `[5,10,30,60,120,300]`s,
single-flight `_reconnectingPromise`, full bootstrap on success.

**Test idea:** Mock the lib so `getBootstrap()` rejects with `ECONNREFUSED`
3× then succeeds. Use `vi.useFakeTimers()` and assert that:
- After 1st failure, next attempt is 5000ms in the future
- After 2nd failure, next attempt is 10000ms
- After 3rd failure, next attempt is 30000ms
- On success, `_attempt` resets to 0 AND `reconcile(bridgeId, 'ws_reconnect')`
  is called once

**Warning signs:** App log shows >10 connect attempts in 60s; `journalctl
-u ip-cam-master | grep -c "WS reconnect"` exceeds expectations.

### Pitfall P21-#5: go2rtc YAML drift via foreign writers + raw-byte hashing

**What goes wrong:** go2rtc UI editor or `POST /api/config` rewrites YAML
with reformatted whitespace; even though semantically identical, our raw-byte
hash sees "drift" → infinite redeploy loop.

**How to avoid:** D-RCN-01 + Pattern 2 — strip stamp, parse, restringify with
`sortMapEntries:true`, then sha256. + the `ui_editor: false` already locked
in P20 prevents the most common foreign-write source.

**Test idea:** golden-file test for canonical hash:
- Take a YAML, swap two top-level `streams:` entries' order
- Assert `canonicalHash(reordered) === canonicalHash(original)`
- Repeat with different stamp values: assert hash unchanged
- Repeat with different inline-vs-block scalar style: assert hash unchanged

**Warning signs:** Reconcile log shows "drift detected" on every pass even
when nothing changed; go2rtc restarts every 5min in container uptime.

### Pitfall P21-#6: Reconcile race between scheduler tick and user toggle

**What goes wrong:** Two simultaneous triggers (timer + WS event, or timer +
HTTP `PUT /outputs`) → parallel SSH writes → corrupted YAML inside container.

**How to avoid:** D-API-03 + Pattern 1 — module-scoped `_inFlight: Promise` +
`_dirty` flag. Subsequent triggers join the in-flight Promise; lock-holder
runs ONE follow-up if dirty.

**Test idea:**
```typescript
it('serializes two simultaneous reconciles via single-flight', async () => {
  let firstResolved = 0, secondResolved = 0;
  const p1 = reconcile(bridgeId, 'tick').then(() => { firstResolved = Date.now(); });
  const p2 = reconcile(bridgeId, 'force').then(() => { secondResolved = Date.now(); });
  await Promise.all([p1, p2]);
  // p2 should resolve at the same time as p1 (it joined the in-flight Promise)
  expect(Math.abs(secondResolved - firstResolved)).toBeLessThan(50);
});

it('runs a single follow-up reconcile if dirty was set', async () => {
  const buildSpy = vi.spyOn(yamlBuilder, 'buildBridgeYaml');
  const p1 = reconcile(bridgeId, 'tick');
  // Trigger a second reconcile while the first is in-flight
  void reconcile(bridgeId, 'force');
  await p1;
  // Wait for setImmediate
  await new Promise((r) => setImmediate(r));
  // Should have called buildBridgeYaml twice: once for p1, once for follow-up
  expect(buildSpy).toHaveBeenCalledTimes(2);
});
```

**Warning signs:** User reports "I toggled X but it didn't stick"; two
reconcile log entries within seconds of each other.

### Pitfall P21-#11: mtime fast-path defeated by clock skew

**What goes wrong:** Proxmox host clock and app VM clock drift by N seconds.
mtime comparison fails, triggering unnecessary redeploys.

**How to avoid:** Pattern 3 — `±2s` tolerance on mtime comparison. Or skip
the mtime check entirely if the user reports clock drift issues — the hash
comparison alone is sufficient correctness; mtime is only a fast-path.

**Test idea:**
```typescript
it('treats remote mtime within ±2s of last reconcile as no-op', async () => {
  // bridge.lastReconciledAt = '2026-05-06T12:00:00Z'
  // mock ssh stat → '1741267200' (12:00:00 UTC) or ±2s
  for (const skew of [-2, -1, 0, 1, 2]) {
    mockSshStat(1741267200 + skew);
    const result = await reconcile(bridgeId, 'tick');
    expect(result.status).toBe('no_op');
  }
  // ±3s should trigger defensive re-deploy
  mockSshStat(1741267200 + 3);
  const result = await reconcile(bridgeId, 'tick');
  expect(result.hashChanged).toBe(false); // defensive re-deploy, hash same
  expect(result.status).toBe('success'); // but it did push
});
```

**Warning signs:** Bridge shows unexpected redeploys when DB state hasn't
changed; reconcile cycle time grows from <2s to ~5s.

### Pitfall P21-#13: Self-update during in-flight reconcile (REVISED)

**What goes wrong:** v1.1+v1.3+v3.4 self-update spawns updater systemd unit
that triggers SIGTERM on the app process. If reconcile is mid-SSH-push,
the YAML deploy gets cut off → partial file → go2rtc fails to parse on its
auto-restart.

**How to avoid:**
- D-API-04 — `getActiveFlowConflicts()` returns `'reconciler_busy'` when
  `isReconcilerBusy()` is true → updater backs off with HTTP 409 + Retry-After
- 30s SIGTERM grace (already wired in `hooks.server.ts` per P24) gives an
  in-flight reconcile time to finish
- Atomic tmp+rename per CR-1 mitigation #2 ensures even a hard-kill leaves
  the existing YAML intact

**Test idea:**
- Start a reconcile, then in parallel call `getActiveFlowConflicts()`,
  assert it returns the `reconciler_busy` entry
- After reconcile completes, `isReconcilerBusy()` returns false and
  `getActiveFlowConflicts()` array is empty (assuming no other Hub conflicts)

**Warning signs:** After a self-update, bridge YAML is corrupted; go2rtc
service is failed; `journalctl` shows SIGTERM during reconcile.

### Pitfall P21-#14: go2rtc holds dead consumer connection after source disconnect

**What goes wrong:** Protect cam reboots → upstream RTSP drops → per
[github.com/AlexxIT/go2rtc/issues/762] go2rtc sometimes holds the
consumer-side MJPEG/RTSP connection open without producing new frames →
Loxone tile shows "loading" indefinitely.

**How to avoid:**
- `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2` per D-PIPE-05
  on every output (already locked)
- Health probe extension (D-CAP-03) detects this case via
  `GET /api/streams` response showing `producers=0` for >2 ticks → emit
  health event → P22's UI surfaces "stream X upstream disconnected"
- **In P21 scope:** just emit the event. The "force-reconnect via DELETE+PUT
  /api/streams" path from PITFALLS #14 mitigation is **deferred to P23**
  (UI surface for the "Re-deploy" button per HUB-OPS-03)

**Test idea:** Mock `fetch('http://bridgeIp:1984/api/streams')` to return a
response where one stream has `producers=0`. Assert that after 2 consecutive
health-probe ticks with `producers=0`, a `health_event` row is inserted
into `events` table with `severity='warning'` and message mentioning the
stream slug.

**Warning signs:** Loxone tile shows persistent "loading" with brief frame
glimpses; `/api/streams` shows `producers=0` for a stream we expect to be live.

### Pitfall P21-#18: Frigate codec passthrough breaks on Protect's smart-codec channels

**What goes wrong:** Some Protect cams emit non-standard B-frame patterns
("Enhance Detail" mode) or omit AUD NAL units → Frigate `-c:v copy` fails
silently.

**How to avoid:**
- D-PIPE-04 already locks `-an` (no audio) by default — eliminates the
  pcm_mulaw audio failure mode
- `-c:v copy` passthrough only works if upstream codec is clean H.264 or H.265.
  P19-01 spike captured Carport cam = HEVC@1280×720, which is the realistic
  default. Frigate accepts H.265 (with browser-live-view caveats).
- **In P21 scope:** ship passthrough with `-an`. If user reports Frigate
  issues, P22 adds a "passthrough vs re-encode" toggle per cam.

**Test idea:** This is hard to test in CI (requires real ffprobe + sample
streams). Defer to live UAT against the user's Carport cam in P21
acceptance: pull `ffprobe rtsp://bridge:8554/<mac>-high` and assert
`codec=hevc`, no transcode artifact.

**Warning signs:** Frigate log "Could not find tag for codec pcm_mulaw" or
"No frames have been received"; black/garbled video in Frigate UI but VLC
plays cleanly.

---

## Code Examples

### Example 1: Multi-stream YAML emission (D-PIPE-02 + D-PIPE-04)

```typescript
// yaml-builder.ts
import { stringify } from 'yaml';

type OutputType = 'loxone-mjpeg' | 'frigate-rtsp';

interface OutputRow {
  cameraId: number;
  mac: string;          // normalised — e.g. 'a89c6cb23e85'
  outputType: OutputType;
  rtspUrl: string;      // already-rewritten rtsps:// URL from protect_stream_catalog
}

function buildLoxoneMjpegSource(rtspUrl: string): string {
  // D-PIPE-02 canonical form
  return `ffmpeg:${rtspUrl}#input=tls_verify=0#video=mjpeg#width=640#height=360`
    + `#raw=-r 10#raw=-an#hardware=vaapi`
    + `#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2`;
}

function buildFrigateRtspSource(rtspUrl: string): string {
  // D-PIPE-04 canonical form
  return `ffmpeg:${rtspUrl}#input=tls_verify=0#video=copy#raw=-an`
    + `#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2`;
}

export function buildBridgeYaml(
  outputs: OutputRow[],
  reconcileId: string
): string {
  const stamp = `# managed by ip-cam-master, reconcile-id ${reconcileId}, ts ${new Date().toISOString()}`;

  const streams: Record<string, string[]> = {};
  for (const out of outputs) {
    const suffix = out.outputType === 'loxone-mjpeg' ? 'low' : 'high';
    const slug = `${out.mac}-${suffix}`;
    streams[slug] = [
      out.outputType === 'loxone-mjpeg'
        ? buildLoxoneMjpegSource(out.rtspUrl)
        : buildFrigateRtspSource(out.rtspUrl),
    ];
  }

  const config = {
    api: { listen: '0.0.0.0:1984', ui_editor: false },
    rtsp: { listen: ':8554' },
    streams,
    ffmpeg: { bin: 'ffmpeg' },
    log: { level: 'info' },
  };

  // sortMapEntries:true ensures deterministic key order at every nesting level
  return `${stamp}\n${stringify(config, { sortMapEntries: true })}`;
}
```

### Example 2: Reconcile run insert (mirrors update_runs)

```typescript
// reconcile.ts
import { protectHubReconcileRuns } from '$lib/server/db/schema';

async function doReconcile(
  bridgeId: number,
  reconcileId: string,
  reason: ReconcileReason
): Promise<ReconcileResult> {
  const startedAt = new Date().toISOString();
  db.insert(protectHubReconcileRuns).values({
    reconcileId,
    startedAt,
    status: 'running',
    hashChanged: false,
  }).run();

  try {
    // ... pass 1-4 from architecture diagram ...
    const result = { /* ... */ };

    db.update(protectHubReconcileRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: result.status,
        hashChanged: result.hashChanged,
        deployedYamlHash: result.newHash ?? null,
      })
      .where(eq(protectHubReconcileRuns.reconcileId, reconcileId))
      .run();

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(protectHubReconcileRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: 'error',
        error: message,
      })
      .where(eq(protectHubReconcileRuns.reconcileId, reconcileId))
      .run();
    throw err;
  }
}
```

### Example 3: VAAPI cap enforcement in PUT /outputs

```typescript
// src/routes/api/cameras/[id]/outputs/+server.ts
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/client';
import { cameraOutputs, cameras } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { reconcile } from '$lib/server/orchestration/protect-hub/reconcile';

const VAAPI_HARD_CAP = 6;

export const PUT: RequestHandler = async ({ params, request }) => {
  const camId = Number(params.id);
  const body = await request.json() as { outputs: Array<{ outputType: string; enabled: boolean }> };

  // Count currently-enabled MJPEG outputs ACROSS ALL cams (the cap is per-bridge,
  // not per-cam). EXCLUDE this cam's existing rows because we're about to overwrite them.
  const currentMjpegCount = db
    .select({ n: sql<number>`count(*)` })
    .from(cameraOutputs)
    .where(and(
      eq(cameraOutputs.outputType, 'loxone-mjpeg'),
      eq(cameraOutputs.enabled, true),
      sql`${cameraOutputs.cameraId} != ${camId}`,
    ))
    .get()?.n ?? 0;

  const requestedMjpegCount = body.outputs.filter(
    (o) => o.outputType === 'loxone-mjpeg' && o.enabled
  ).length;

  const projectedTotal = currentMjpegCount + requestedMjpegCount;

  if (projectedTotal > VAAPI_HARD_CAP) {
    return json({
      ok: false,
      reason: 'vaapi_hard_cap_exceeded',
      message: `Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: ${projectedTotal}.`,
    }, { status: 422 });
  }

  // Replace strategy: delete existing rows for this cam, insert new ones
  db.delete(cameraOutputs).where(eq(cameraOutputs.cameraId, camId)).run();
  for (const out of body.outputs) {
    db.insert(cameraOutputs).values({
      cameraId: camId,
      outputType: out.outputType,
      enabled: out.enabled,
    }).run();
  }

  // Soft-cap warning (D-CAP-01) — emit event but still succeed
  if (projectedTotal >= 4) {
    storeEvent({
      cameraId: null,
      cameraName: 'Protect Hub',
      eventType: 'vaapi_soft_cap_warning',
      severity: 'info',
      message: `${projectedTotal} von 4 Transkodierungen aktiv (Soft-Cap erreicht).`,
      source: 'protect_hub',
      timestamp: new Date().toISOString(),
    });
  }

  // Force-reconcile (in-process; non-blocking)
  void reconcile(getBridgeId(), 'output_toggle').catch((err) => {
    console.error('[outputs] reconcile failed:', err);
  });

  return json({ ok: true, projectedMjpegCount: projectedTotal });
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `js-yaml` | `yaml@2.6` (eemeli) | Already v1.3 standard (L-29) | Better TS types, deterministic key ordering, comment preservation, custom comparator support |
| Naive 1s reconnect | Exp backoff with single-flight Promise | v1.2 Bambu MQTT precedent | No more reconnect storms during UDM reboot |
| Hash raw bytes | Strip stamp + parse + restringify + sha256 | Pattern from Frigate go2rtc community | False-positive drift eliminated |
| `pct push` straight-overwrite | Push to `.tmp.<reconcileId>` then `mv` | Required by HUB-RCN-10 + L-14 | Mid-deploy crash never leaves half-written YAML |
| Per-camera mutex | Per-bridge module-scoped Promise | PITFALLS #6 + L-13 | YAML is one atomic unit; per-cam locks make races worse |

**Deprecated/outdated:**
- go2rtc's `POST /api/config` for runtime YAML edits — non-persistent across
  restart; we never use it.
- go2rtc UI editor — disabled by `ui_editor: false` in P20 (already shipped).
- `rtspx://` scheme as ffmpeg input — ffmpeg returns "Protocol not found"
  (verified by P19-01 spike). Always rewrite to `rtsps://` (already done at
  catalog-extraction time per CR-2).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.0` (already in package.json) |
| Config file | `/Users/hulki/codex/ip-cam-master/vitest.config.ts` |
| Quick run command | `npm test -- src/lib/server/orchestration/protect-hub/` (only protect-hub) |
| Full suite command | `npm test` (all vitest tests) + `npm run check` (svelte-check + tsc) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HUB-OUT-01 | enable Loxone-MJPEG output toggles correctly | unit | `vitest run src/routes/api/cameras/\\[id\\]/outputs/server.test.ts` | ❌ Wave 0 |
| HUB-OUT-02 | yaml-builder emits Loxone-MJPEG ffmpeg form per D-PIPE-02 | unit (golden file) | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "loxone"` | ❌ Wave 0 |
| HUB-OUT-03 | yaml-builder emits Frigate-RTSP ffmpeg form per D-PIPE-04 | unit (golden file) | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "frigate"` | ❌ Wave 0 |
| HUB-OUT-04 | VAAPI hard cap returns 422 at 7 MJPEG outputs | integration | `vitest run src/routes/api/cameras/\\[id\\]/outputs/server.test.ts -t "hard cap"` | ❌ Wave 0 |
| HUB-OUT-05 | first-party default ON, third-party default OFF on auto-add | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "auto-add seeds outputs"` | ❌ Wave 0 |
| HUB-OUT-06 | slug = `<mac>-<suffix>`, stable across name edits | unit | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "slug stable"` | ❌ Wave 0 |
| HUB-OUT-07 | URLs emitted in YAML are correct format | unit (golden file) | covered by yaml-builder.test.ts | ❌ Wave 0 |
| HUB-RCN-01 | scheduler tick fires every 5min when enabled, silent when disabled | unit (fake timers) | `vitest run src/lib/server/services/scheduler.test.ts -t "protect hub"` | ❌ Wave 0 (extend existing scheduler.test.ts if exists) |
| HUB-RCN-02 | PUT /outputs triggers reconcile in-process | unit (mock reconcile) | `vitest run src/routes/api/cameras/\\[id\\]/outputs/server.test.ts -t "triggers reconcile"` | ❌ Wave 0 |
| HUB-RCN-03 | POST /reconcile returns 202 + reconcileId | unit | `vitest run src/routes/api/protect-hub/reconcile/server.test.ts` | ❌ Wave 0 |
| HUB-RCN-04 | discover() called as Pass 1 of reconcile | unit (mock discover) | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "re-extract URLs"` | ❌ Wave 0 |
| HUB-RCN-05 | identical YAML produces no_op (no SSH push) | unit (mock SSH) | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "no-op skip"` | ❌ Wave 0 |
| HUB-RCN-06 | two simultaneous reconciles serialize via single-flight | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "single-flight"` | ❌ Wave 0 |
| HUB-RCN-07 | WS reconnect uses backoff [5,10,30,60,120,300]s | unit (fake timers) | `vitest run src/lib/server/orchestration/protect-hub/ws-manager.test.ts` | ❌ Wave 0 |
| HUB-RCN-08 | new cam detected → outputs seeded per kind | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "auto-add"` | ❌ Wave 0 |
| HUB-RCN-09 | removed cam → source='external_archived' | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "soft-delete"` | ❌ Wave 0 |
| HUB-RCN-10 | isReconcilerBusy() returns true mid-reconcile, false after | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "busy gate"` | ❌ Wave 0 |
| HUB-OPS-05 | bridge fetch failure 2× → status='unhealthy' + event | unit | `vitest run src/lib/server/services/scheduler.test.ts -t "2-strike threshold"` | ❌ Wave 0 |

**Smoke / live UAT (manual, NOT in automated suite):**
- Loxone-MJPEG output plays in VLC at 640×360 @ 10 fps with no audio
- Frigate-RTSP output plays with original H.264/H.265 codec untouched
- Force-reconcile button completes in <5s on a 3-cam bridge
- Self-update during in-flight reconcile returns 409 + Retry-After:60

### Sampling Rate

- **Per task commit:** `npm test -- src/lib/server/orchestration/protect-hub/` (sub-dir filter)
- **Per wave merge:** `npm test && npm run check` (all tests + tsc)
- **Phase gate:** `npm test && npm run check && npm run build` green before
  `/gsd-verify-work`
- **Live UAT:** Bridge vmid 2014 at 192.168.3.139 (per STATE.md) — must accept
  multi-cam YAML and reload without manual intervention; smoke check via
  `curl http://192.168.3.139:1984/api/streams` after reconcile

### Wave 0 Gaps

- [ ] `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` — covers HUB-OUT-{02,03,06,07}
- [ ] `src/lib/server/orchestration/protect-hub/reconcile.test.ts` — covers HUB-RCN-{04,05,06,08,09,10}
- [ ] `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` — covers HUB-RCN-07
- [ ] `src/routes/api/cameras/[id]/outputs/server.test.ts` — covers HUB-OUT-{01,04} + HUB-RCN-02
- [ ] `src/routes/api/protect-hub/reconcile/server.test.ts` — covers HUB-RCN-03
- [ ] Extend `src/lib/server/services/scheduler.test.ts` (or create if missing) — covers HUB-RCN-01 + HUB-OPS-05
- [ ] Add `protectHubReconcileRuns` table to all in-memory test schemas (already-existing pattern in `bridge-provision.test.ts:90`, `catalog.test.ts:117`)
- [ ] No new test framework installs needed — `vitest@4.1.0` already in deps

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: codebase] `src/lib/server/services/scheduler.ts:138-160` —
  bridge health probe already wired in P20; P21 extends with 2-strike threshold
- [VERIFIED: codebase] `src/lib/server/services/protect-bridge.ts:14-131` —
  `TLS_SCHEME='rtsps-tls-verify-0'`, `protectStreamUrl()` already returns
  `rtsps://`; classification + bootstrap fetch already typed via
  `unifi-protect@4.29.0`
- [VERIFIED: codebase] `src/lib/server/orchestration/protect-hub/catalog.ts` —
  `discover()` already does L-11 URL re-extraction work; reconcile reuses it
- [VERIFIED: codebase] `src/lib/server/services/ssh.ts:79-95` — surprise:
  `pushFileToContainer` does NOT do tmp+rename (CR-1)
- [VERIFIED: codebase] `src/lib/server/services/update-checker.ts:50-69` —
  `getActiveFlowConflicts()` already implements the busy-gate pattern; P21
  extends with `'reconciler_busy'` (CR-4)
- [VERIFIED: codebase] `src/lib/server/db/client.ts:44-110` — `ensureColumn`
  + `CREATE TABLE IF NOT EXISTS` migration pattern; `protectHubReconcileRuns`
  follows same shape as `update_runs` block at line 115
- [VERIFIED: codebase] `src/lib/server/services/go2rtc.ts:505-548` —
  `generateBridgeConfig` + `generateBridgeSystemdUnit` already include stamp,
  `0.0.0.0:1984`, `ui_editor: false`, `LimitNOFILE=4096`. P21 yaml-builder
  follows the same string-template approach but emits multi-stream YAML
- [CITED: eemeli.org/yaml/#sortmapentries] `sortMapEntries` is a
  Schema option that accepts `boolean | (a, b: Pair) => number`; sorting is
  applied during stringification (per [eemeli/yaml docs/03_options.md])
- [CITED: github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts] —
  `_eventsWs` cleanup on close, no auto-reconnect; emits `login`, `bootstrap`,
  `message` events; `launchEventsWs()` called automatically inside
  `getBootstrap()`
- [CITED: deepwiki.com/AlexxIT/go2rtc/1.2-configuration-basics] — go2rtc has
  no SIGHUP handler and no file watcher; `POST /api/config` and `POST
  /api/restart` are the only HTTP-driven reload paths (CR-3)
- [CITED: github.com/AlexxIT/go2rtc/issues/762] — go2rtc reconnect-after-
  source-disconnect bugs documented; mitigation = `-reconnect 1
  -reconnect_streamed 1 -reconnect_delay_max 2` (Pitfall P21-#14)
- [CITED: github.com/AlexxIT/go2rtc/issues/1136] — no API to reload streams
  without restart (Anti-pattern: `PUT /api/streams`)
- [CITED: github.com/openhab/openhab-addons/issues/20072] — Protect Share
  Livestream tokens rotate on restart (Pitfall P21-#1)
- [VERIFIED: npm registry 2026-05-06] `yaml@2.6.0` published 2024-09-28; current

### Secondary (MEDIUM confidence)

- `.planning/research/v1.3/PITFALLS.md` — failure modes #1, #3, #5, #6, #11,
  #13, #14, #18 (P21-relevant subset)
- `.planning/research/v1.3/SUMMARY.md` — 30 locked decisions L-1..L-30
- `.planning/research/v1.3/STACK.md` — yaml@2.6, unifi-protect@4.29, no new deps
- `.planning/research/v1.3/ARCHITECTURE.md` — file layout + reconcile placement
- `.planning/research/v1.3/spikes/p19-tls-rtspx.md` — TLS scheme spike
- `.planning/phases/19-data-model-protect-catalog/19-CONTEXT.md` — D-CLASS,
  D-LIB, D-REFRESH precedents
- `.planning/phases/20-bridge-lxc-provisioning/20-CONTEXT.md` — D-API-BIND,
  D-PROV precedents (especially D-API-BIND-01 amending L-9 to `0.0.0.0:1984`)
- `.planning/phases/20-bridge-lxc-provisioning/20-03-SUMMARY.md` — bridge live
  at vmid 2014 @ 192.168.3.139; baseline for live UAT against this bridge

### Tertiary (LOW confidence — flag for validation)

- *None this phase — every claim either verified in the codebase or cited
  to a primary source.*

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `yaml@2.6` `sortMapEntries:true` applies recursively to nested maps in the document tree (not just the top-level map) | Pattern 2, code Example 1 | If only top-level: nested `streams:` map keys would still sort, but if go2rtc ever uses a deeper nested map key that we care about ordering for, hash could be unstable. Mitigation: a unit test in `yaml-builder.test.ts` that takes a YAML with a deep nested map, swaps inner keys, and asserts canonical-hash equality. If the test fails, fall back to a custom comparator function. |
| A2 | go2rtc systemd unit defaults to `Type=simple` (no `ExecReload` defined), so `systemctl reload-or-restart` will execute `restart` semantics | CR-3 | If unit somehow has `ExecReload`: reload would be a no-op (go2rtc ignores HUP), streams would not pick up new YAML, and the deploy would silently fail. Mitigation: explicit `systemctl restart` in reconcile.ts (drop `reload-or-restart`); verify in the bridge-lifecycle.test.ts that the systemd unit DOES NOT define `ExecReload`. |
| A3 | mtime tolerance ±2s is sufficient for typical Proxmox-host-vs-app-VM clock skew | Pattern 3, Pitfall P21-#11 | If skew is >2s (e.g. NTP failure on one side): every reconcile triggers defensive re-deploy, costing ~3s consumer blip every 5 minutes. Mitigation: surface clock-skew in the reconcile log; planner may decide to drop mtime fast-path entirely if skew turns out worse than expected. |
| A4 | `setImmediate` for the dirty-flag follow-up does not violate the "queue depth 1" contract | Pattern 1, code | If a third trigger arrives between the original reconcile completing and the follow-up starting (sub-millisecond window): `_inFlight` is briefly null and the third trigger creates its own Promise, with the follow-up then becoming a fourth in-flight. Mitigation: in the follow-up, re-check `_dirty` and skip if false; if Pattern 1's tests fail at high concurrency, switch to a queue+drain pattern. |

**If this table is empty:** All claims in this research were verified or cited
— no user confirmation needed.

---

## Open Questions for Plan-Phase

1. **CR-1 mitigation choice (atomicity of `pushFileToContainer`)** —
   - What we know: current `pushFileToContainer` does NOT do tmp+rename; HUB-RCN-10
     literally requires "writes YAML via `tmp+rename` so a mid-deploy crash never
     leaves a half-written file"
   - What's unclear: whether to extend `ssh.ts` (touches code outside protect-hub)
     or wrap inside `reconcile.ts` (self-contained)
   - Recommendation: wrap inside `reconcile.ts` for minimum blast radius

2. **Slug format finalisation (D-PIPE-06)** —
   - What we know: pattern `<mac-slug>-<output-suffix>`; suffix locked as `low` for
     Loxone-MJPEG and `high` for Frigate-RTSP
   - What's unclear: whether to use `loxone-low` (descriptive) or just `low` (terse).
     CONTEXT.md says "loxone-low vs simply low; frigate-high vs high" is Claude's
     discretion
   - Recommendation: `low`/`high` (matches existing naming convention in
     `generateGo2rtcConfigBambu` and `generateGo2rtcConfigLoxone`); avoids
     redundancy when reading URLs (`stream.mjpeg?src=aabb...-low` is clear from
     context)

3. **WS reconnect attached to which bridge?** —
   - What we know: WS connects to UDM Protect controller (one per app instance,
     per L-23 single-Protect-controller scope)
   - What's unclear: when does `startWs()` first run? On first POST to enable Hub?
     On scheduler boot if `protect_hub_enabled=true`?
   - Recommendation: in `scheduler.ts` `startScheduler()`, after the existing
     `startBambuSubscribers()` call, gate on `await getSetting('protect_hub_enabled')
     === 'true'`. Same start/stop lifecycle as existing intervals. Reset the WS
     manager state on settings change (P22 toggle path).

4. **`protectHubReconcileRuns.error` column max length / pruning policy** —
   - What we know: errors can be large (full SSH error messages with stack traces)
   - What's unclear: should reconcile-runs be pruned after N entries (e.g., keep
     last 50 like reconcile log shows in HUB-OPS-02)?
   - Recommendation: P21 ships unbounded; add a `cleanupOldReconcileRuns` to the
     existing 24h `updateLogCleanupInterval` in P22 or P23 (same cadence as
     `cleanupOldUpdateLogs`)

5. **Test fixture token redaction policy** —
   - What we know: this is a public GitHub repo
   - What's unclear: golden-file YAML fixtures will contain `<token>` placeholders;
     should those be `aaaa-bbbb-cccc-dddd` constants or generated UUIDs each test run?
   - Recommendation: hardcoded constants like `<TEST-TOKEN-CARPORT>` in fixtures;
     all tests pass them through the URL builder via mock — they NEVER hit a real
     UDM. Mirrors the redaction pattern from `p19-tls-rtspx.md`.

6. **HEVC Loxone-MJPEG transcode performance** —
   - What we know: D-PIPE-03 says implicit `hevc_vaapi` selection via
     `hardware=vaapi`; Carport cam ships HEVC@1280×720 (per spike)
   - What's unclear: is the VAAPI cost of `hevc_vaapi` decode + `h264_vaapi` encode
     measurably different from `h264_vaapi` decode + encode? L-26 cap (4 soft / 6
     hard) might need to drop if HEVC sources double the cost
   - Recommendation: defer to live UAT. P21 ships the cap as locked; if Carport
     transcode + 3 H.264 transcodes saturates VAAPI, P22 lowers the cap (cap is
     a const in code, not in DB).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | Build + runtime | ✓ | (per STATE.md, v1.x deployed) | — |
| `yaml@^2.6.0` | yaml-builder canonical hashing | ✓ (in package.json) | 2.6.0 | — |
| `unifi-protect@^4.29.0` | WS manager + catalog refresh | ✓ (in package.json) | 4.29.x | — |
| `node-ssh@^13.2.1` | SSH push to bridge | ✓ (in package.json) | 13.2.1 | — |
| `better-sqlite3@^12.6.2` | reconcile-runs table writes | ✓ (in package.json) | 12.6.2 | — |
| `vitest@^4.1.0` | All P21 tests | ✓ (in package.json) | 4.1.0 | — |
| Bridge LXC `vmid 2014 @ 192.168.3.139` | Live UAT target | ✓ (per STATE.md 2026-05-06) | go2rtc inside | — |
| UDM Protect controller `192.168.3.1` | bootstrap fetch + WS reconnect tests (live) | ✓ (per spike artifact) | (firmware not captured) | — |
| ffmpeg with VAAPI inside bridge LXC | Loxone-MJPEG transcode at runtime | ✓ (per P20-03 SUMMARY criterion 9: `/dev/dri` passthrough verified) | intel-media-va-driver 25.x (Debian 13) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | UDM creds reused from existing settings (AES-256-GCM at rest in SQLite — v1.0 pattern); no new auth surface added in P21 |
| V3 Session Management | partial | `unifi-protect` lib manages its own session cookie; `protect-bridge.ts` already implements 8-min refresh window; P21 doesn't introduce new sessions |
| V4 Access Control | yes | API routes `POST /api/protect-hub/reconcile`, `PUT /api/cameras/[id]/outputs` are gated by the global `hooks.server.ts` auth handler (per existing pattern in `discover/+server.ts:3`); no new public paths |
| V5 Input Validation | yes | `PUT /outputs` body validated against typed schema; cap counts validated server-side (NOT client-side); reconcile reads only from typed Drizzle results — no string interpolation into shell or SSH |
| V6 Cryptography | yes | sha256 via `node:crypto.createHash` (built-in, audited); UUID via `crypto.randomUUID` (built-in); no hand-rolled crypto |

### Known Threat Patterns for SvelteKit + node-ssh + go2rtc stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via slug → ffmpeg/SSH | Tampering | Slugs derived from MAC (lowercased hex via `normalizeMac()`, regex-validated by lib type) — no user-supplied strings reach the YAML builder; URLs from Protect bootstrap go through `protectStreamUrl()` which only formats already-typed `rtspAlias` strings |
| YAML injection via Protect cam name | Tampering | yaml-builder uses `yaml.stringify()` (not string concat); cam names are NOT included in the YAML — only MAC-derived slugs and rtspAlias tokens |
| Reconciler abuse → DoS via flood of `POST /reconcile` | Denial of Service | Single-flight Pattern 1 (D-API-03) means N parallel triggers cost 1 reconcile + 1 follow-up; no resource amplification |
| Token leak in golden-file test fixtures | Information Disclosure | Fixtures use placeholder constants (`<TEST-TOKEN-CARPORT>`) per redaction policy in p19-tls-rtspx.md; CI never sees real tokens |
| Bridge LAN exposure of all Protect cams | Information Disclosure | Already documented as LAN trust boundary (L-23, PITFALLS #15); P21 doesn't change the posture; `ui_editor:false` (already shipped P20) blocks the only sensitive surface |
| SSH key leak via container-state log | Information Disclosure | SSH ops use existing `connectToProxmox()` which reads from settings (encrypted at rest); no key material logged |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already in package.json, versions verified
  against npm registry on 2026-05-06
- Architecture: HIGH — every new file maps to a CONTEXT.md decision; reuses
  proven P19+P20 modules; no architectural invention
- Pitfalls: HIGH — all 8 P21-relevant pitfalls have concrete code-level
  mitigations + test ideas; all ground in PITFALLS.md
- Code reality checks: HIGH — five surprises caught and documented (CR-1
  through CR-6); each has a recommended planner action
- Validation architecture: HIGH — every requirement has a named test command;
  Wave 0 file gaps explicit

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days; stack is stable, dependencies pinned by `^`)

## RESEARCH COMPLETE
