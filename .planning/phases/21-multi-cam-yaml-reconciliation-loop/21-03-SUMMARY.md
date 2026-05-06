---
phase: 21-multi-cam-yaml-reconciliation-loop
plan: 03
status: complete
subsystem: protect-hub-orchestration

tags: [reconcile, single-flight, atomic-deploy, ssh, canonical-hash, audit-log, vitest, partial-mock]

requires:
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 01
    provides: protect_hub_reconcile_runs Drizzle table + reconcile.test.ts stub + extended in-mem DDL fixture pattern
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 02
    provides: buildBridgeYaml() pure function + canonicalHash() dedupe primitive + OutputRow public type
  - phase: 19-protect-hub-schema-lock
    provides: cameras (source, mac, kind, hub_bridge_id) + cameraOutputs + protectStreamCatalog + protectHubBridges columns
  - phase: 20-bridge-lxc-provisioning
    provides: bridge LXC live at vmid 2014 with go2rtc systemd unit; pushFileToContainer + executeOnContainer + connectToProxmox SSH primitives

provides:
  - reconcile(bridgeId, reason) → ReconcileResult — single-flight 4-pass orchestrator
  - isReconcilerBusy() → boolean — synchronous busy probe (consumed by Plan 06 update-checker.ts CR-4 gate)
  - ReconcileResult tagged-Result type (success | no_op | bridge_unreachable | error) per Pattern S-1
  - ReconcileReason type ('tick' | 'force' | 'output_toggle' | 'ws_reconnect')
  - 15 behavioural tests covering every P21-relevant requirement + audit-log invariants
  - Pattern 1 single-flight implementation: module-scoped Promise + dirty flag + setImmediate follow-up
  - CR-1 mitigation in-reconcile: atomic tmp+rename via pushFileToContainer + executeOnContainer mv

affects: [21-04 (ws-manager calls reconcile), 21-05 (API route calls reconcile + queries protect_hub_reconcile_runs), 21-06 (scheduler tick calls reconcile + update-checker uses isReconcilerBusy)]

tech-stack:
  added: []
  patterns:
    - "Pattern 1 single-flight per-bridge: module-scoped Promise + dirty flag + setImmediate(reconcile, 'tick') follow-up; queue depth 1 per L-13 + P21-#6"
    - "CR-1 mitigation Option 2 (in-reconcile): pushFileToContainer to <dest>.tmp.<reconcileId>, executeOnContainer mv tmp final — atomic rename inside LXC, satisfies HUB-RCN-10 literally without modifying ssh.ts"
    - "CR-3 honest restart: systemctl restart go2rtc (NOT reload-or-restart — go2rtc has no SIGHUP); explicit code comment + test forbidance"
    - "Pass 3 mtime fast-path with ±2s tolerance per Pattern 3 / P21-#11; one stat over SSH ≈ 80ms; first-deploy bypass when last_deployed_yaml_hash null"
    - "Audit-row state machine mirrors P24 update_runs: INSERT (status='running') BEFORE side effects, UPDATE (status=success|no_op|bridge_unreachable|error) AFTER — forensic record always exists per T-21-05"
    - "Direct db.insert(events) in reconcile.ts to bypass the closed EventType union in src/lib/types.ts (out-of-scope per plan files_modified); P23 widens the union when reconcile-log UI lands"
    - "Test-side leaked-follow-up flush: two setImmediate awaits in beforeEach BEFORE vi.clearAllMocks() drain prior tests' fire-and-forget reconcile() calls so they don't inflate the next test's mock counts"
    - "Test-side partial mock for protect-bridge.ts: fetchBootstrap mocked, pure helpers (normalizeMac, classifyKind, protectStreamUrl, TLS_SCHEME) kept real for fidelity"

key-files:
  created:
    - src/lib/server/orchestration/protect-hub/reconcile.ts
  modified:
    - src/lib/server/orchestration/protect-hub/reconcile.test.ts

key-decisions:
  - "Auto-add seeding lives in reconcile.ts (NOT catalog.ts) — keeps catalog.ts a pure read-side helper, keeps the kind-policy change out of the closed P19. Plan 06 imports seedDefaultOutputsForNewCams() from reconcile.ts if it ever needs to call it independently."
  - "Soft-delete diff via direct fetchBootstrap() call (not extended discover() return signature) — avoids touching the P19 contract. Cost: ~1 extra cached call per reconcile; lib's 8-min refresh window absorbs it (L-12)."
  - "Direct db.insert(events) for reconcile event emission. storeEvent() requires EventType ∈ {camera_disconnect, camera_reconnect, stream_failed, adoption_changed, aiport_error} — none fit. Extending the union would have required modifying src/lib/types.ts which is NOT in the plan's files_modified. P23 will widen + replace direct inserts with storeEvent() when it ships the reconcile-log UI."
  - "Bridge-error classification heuristic (regex over message): connect ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ssh.*connect|pct.*exec|pct.*push folds to 'bridge_unreachable'. Other errors fall to 'error'. Connect-time failures already short-circuit before this branch; the heuristic only fires for SSH-layer errors that surface mid-deploy (e.g. broken connection during pct push)."
  - "Two setImmediate awaits in test beforeEach to drain leaked follow-ups from prior tests. Discovered when the dirty-flag test failed with 3 mockDiscover calls instead of 2: the previous single-flight test's dirty trigger had scheduled a follow-up via setImmediate, which fired AFTER vi.clearAllMocks() in the next test's beforeEach, inflating the counter. Two flushes — the follow-up itself can schedule another setImmediate."

requirements-completed:
  - HUB-RCN-04
  - HUB-RCN-05
  - HUB-RCN-06
  - HUB-RCN-08
  - HUB-RCN-09
  - HUB-RCN-10
  - HUB-OUT-05
  - HUB-OUT-06

metrics:
  duration_minutes: 12
  task_count: 2
  files_count: 2
  tests_added: 15
  tests_passing: 15
  reconcile_ts_lines: 654
  reconcile_test_ts_lines: 749
completed: 2026-05-06
---

# Phase 21 Plan 03: Reconcile Orchestrator Summary

**`reconcile.ts` shipped as the heart of P21 — single-flight 4-pass orchestrator that turns DB state (camera_outputs JOIN cameras JOIN protect_stream_catalog) into a deployed `go2rtc.yaml` on the bridge LXC, with canonical-hash dedupe + ±2s mtime fast-path + atomic tmp+rename SSH push + full audit trail in `protect_hub_reconcile_runs`. 15 behavioural tests lock every P21-relevant requirement and audit-log invariant; `npm run check` clean; full-suite regression confirms only the 12 pre-existing deferred failures remain.**

## Performance

- **Duration:** ~12 min (post-context-load)
- **Started:** 2026-05-06T06:08:Z
- **Completed:** 2026-05-06T06:19:Z
- **Tasks:** 2 (atomic per-task commits)
- **Files created:** 1 (reconcile.ts, 654 lines)
- **Files modified:** 1 (reconcile.test.ts, stubs replaced with 15 real tests, 749 lines)

## Accomplishments

1. **`reconcile.ts` (654 lines)** — exports `reconcile`, `isReconcilerBusy`, `ReconcileResult`, `ReconcileReason`. Implements:
   - **Pass 0:** INSERT `protect_hub_reconcile_runs` row (status='running') BEFORE any side effect (T-21-05 audit-row invariant).
   - **Pass 1a:** call `discover()` from `catalog.ts` (D-RCN-05, CR-5) — re-extracts Protect URLs from bootstrap every pass; tagged-Result on failure folds to `status='error'`.
   - **Pass 1b:** `seedDefaultOutputsForNewCams()` — first-party cams without any cameraOutputs row → INSERT loxone-mjpeg enabled (HUB-OUT-05 + HUB-RCN-08); third-party cams stay opted-out.
   - **Pass 1c:** `softDeleteMissingCams(bootstrapMacs)` — cams in DB but missing from bootstrap → UPDATE source='external_archived' (HUB-RCN-09 + CR-6 + L-20). Bootstrap MACs obtained via direct `fetchBootstrap()` call (not via extending `discover()` signature).
   - **Pass 2:** `loadOutputRows()` — raw SQL JOIN over camera_outputs × cameras × protect_stream_catalog with conditional quality-match (loxone-mjpeg → quality='low'; frigate-rtsp → quality='high'). Returns `OutputRow[]` for yaml-builder.
   - **Pass 3:** build YAML via `buildBridgeYaml(rows, reconcileId)`; compute `canonicalHash`; if matches `bridge.lastDeployedYamlHash`, do mtime fast-path: `stat -c "%Y" /etc/go2rtc/go2rtc.yaml` over SSH; if `|remoteMtime - lastReconciledAt| ≤ 2s` → `status='no_op'`, no SSH push (Pattern 3 / P21-#11). Bypassed entirely on first deploy.
   - **Pass 4:** atomic deploy. `pushFileToContainer(ssh, vmid, yaml, /etc/go2rtc/go2rtc.yaml.tmp.<reconcileId>)` → `executeOnContainer(ssh, vmid, mv .tmp.<id> /etc/go2rtc/go2rtc.yaml)` → `executeOnContainer(ssh, vmid, systemctl restart go2rtc)` (CR-1 + CR-3 + HUB-RCN-10). UPDATE `protect_hub_bridges` cache; UPDATE audit row to `status='success'`; emit `reconcile_deployed` event.
   - **Concurrency:** module-scoped `_inFlight: Promise | null` + `_dirty: boolean` per Pattern 1 / P21-#6. Concurrent callers join the in-flight Promise and set `_dirty=true`; finally clears `_inFlight` and (if dirty) schedules ONE follow-up via `setImmediate(() => reconcile(bridgeId, 'tick'))` (queue depth 1 per L-13).
   - **Error handling:** Pattern S-1 tagged-Result return. SSH dial fail folds to `status='bridge_unreachable'` per D-CAP-04 (no immediate retry; next 5min tick handles it). Heuristic regex classifies post-dial SSH errors (`pct exec`/`pct push` failures) as `bridge_unreachable`; everything else as `error`.
   - **Event emission:** direct `db.insert(events)` (bypassing `storeEvent()` to avoid extending the closed `EventType` union — see Decisions Made below). Three event types: `reconcile_deployed`, `reconcile_noop`, `reconcile_error`.
2. **`reconcile.test.ts` (749 lines, 15 tests, all green)** — replaces the Plan 01 stub. Covers:
   - HUB-RCN-04: `discover()` called once per reconcile call.
   - HUB-RCN-05: identical YAML → no `pushFileToContainer`, status='no_op'.
   - HUB-RCN-06: two simultaneous calls share the same Promise; `mockDiscover` called once.
   - HUB-RCN-08 dirty-flag follow-up: concurrent trigger schedules ONE extra reconcile via setImmediate; 2 audit rows total.
   - HUB-OUT-05 first-party auto-add: cameraOutputs(loxone-mjpeg, enabled=1) inserted; protect_hub_cam_added event logged.
   - HUB-OUT-05 third-party: NO outputs seeded.
   - HUB-RCN-09 + CR-6 soft-delete: cam missing from bootstrap → source='external_archived'; protect_hub_cam_archived event logged.
   - HUB-RCN-10 busy gate: `isReconcilerBusy()` true mid-reconcile, false after.
   - P21-#11 mtime fast-path: ±2s skews [-2,-1,0,1,2] all skip; +5s skew → defensive re-deploy (push happens, status='success').
   - P21-#1 token rotation: first reconcile pushes OLD-token YAML; mutate `protect_stream_catalog.rtsp_url` → second reconcile pushes again with NEW-token YAML; hashes differ.
   - D-CAP-04 bridge-unreachable: `connectToProxmox` rejects with `connect ETIMEDOUT` → `result.ok=false`, `status='bridge_unreachable'`, no push, audit row error contains 'ETIMEDOUT'.
   - CR-1 + CR-3 atomic deploy: assert call ORDER (push → mv → systemctl restart) via `mock.invocationCallOrder`; assert tmp path matches `^/etc/go2rtc/go2rtc.yaml.tmp.<uuid-v4>$`; assert mv command exactly renames FROM the tmp path TO the final path; assert `reload-or-restart` is NEVER called (CR-3).
   - T-21-05 audit invariants: count delta = 1 per reconcile pass; successful reconcile transitions running → success with hash + completed_at + null error; deployed_yaml_hash matches the result's newHash.

## Task Commits

1. **Task 1: reconcile.ts orchestrator** — `612056e` (feat)
2. **Task 2: reconcile.test.ts behavioural tests** — `ec219bf` (test)

## Test Coverage Map (Requirement → Test)

| Requirement / Pitfall | Test name | File line range |
|---|---|---|
| HUB-RCN-04 | `re-extract URLs — calls discover() as Pass 1` | reconcile.test.ts |
| HUB-RCN-05 | `no-op skip — identical YAML produces no SSH push, status=no_op` | reconcile.test.ts |
| HUB-RCN-06 | `single-flight — two simultaneous reconciles share the same Promise` | reconcile.test.ts |
| HUB-RCN-08 (auto-add) | `auto-add — first-party cam with no outputs → seeds Loxone-MJPEG enabled` + `auto-add — third-party cam → no outputs seeded` | reconcile.test.ts |
| HUB-RCN-08 (dirty-flag) | `dirty-flag follow-up — concurrent trigger schedules ONE extra reconcile` | reconcile.test.ts |
| HUB-RCN-09 | `soft-delete — cam in DB but missing from bootstrap → source='external_archived'` | reconcile.test.ts |
| HUB-RCN-10 (busy gate) | `busy gate — isReconcilerBusy() is true mid-reconcile, false after` | reconcile.test.ts |
| HUB-RCN-10 (atomicity) | `atomic deploy — push to .tmp.<id> then mv then systemctl restart (NOT reload-or-restart)` | reconcile.test.ts |
| HUB-OUT-05 | covered by both auto-add tests above | reconcile.test.ts |
| HUB-OUT-06 | implicit (yaml-builder slug pattern locked in P21-02; reconcile passes the OutputRow through) | yaml-builder.test.ts (Plan 02) |
| P21-#1 (token rotation) | `token rotation — fresh tokens in URL → hash changes → SSH push happens` | reconcile.test.ts |
| P21-#6 (concurrency) | covered by single-flight + dirty-flag tests above | reconcile.test.ts |
| P21-#11 (mtime fast-path) | `mtime fast-path — within ±2s tolerance treats as no-op` + `mtime fast-path — skew > 2s → defensive re-deploy` | reconcile.test.ts |
| D-CAP-04 (bridge unreachable) | `bridge-unreachable — SSH dial fail → status=bridge_unreachable, no retry` | reconcile.test.ts |
| T-21-05 (audit-row invariant) | `audit log — every reconcile pass creates exactly 1 row` + `audit log — successful reconcile updates row from running→success with hash` | reconcile.test.ts |
| CR-1 (atomic tmp+rename) | atomic deploy test (above) — call ORDER assertion | reconcile.test.ts |
| CR-3 (no reload-or-restart) | atomic deploy test — `expect(...includes('reload-or-restart')).toBe(false)` | reconcile.test.ts |
| CR-5 (reuse discover) | re-extract URLs test + import statement | reconcile.test.ts |
| CR-6 (external_archived) | soft-delete test (above) | reconcile.test.ts |

## Decisions Made

- **Auto-add seeding location:** in `reconcile.ts` as `seedDefaultOutputsForNewCams()`, called between Pass 1a (`discover()`) and Pass 1c (`softDeleteMissingCams`). NOT in `catalog.ts`. Rationale: keeps `catalog.ts` a pure read-side helper (closes P19 cleanly); keeps the kind-policy change (first-party→ON, third-party→OFF) out of the closed phase. If Plan 06 ever needs to call it independently, it imports from `reconcile.ts`.
- **Soft-delete bootstrap MAC source:** direct `fetchBootstrap()` call from inside `doReconcile`, NOT via extending `discover()`'s return signature with `seenMacs?: string[]`. Rationale: avoids touching the P19 `DiscoverResult` contract; the `unifi-protect` lib's 8-min refresh window absorbs the extra call cost (one cached fetch per 5-min reconcile tick). Documented in code comment.
- **Event emission via direct `db.insert(events)`:** the existing `storeEvent()` from `services/events.ts` requires `EventType` to be one of `{camera_disconnect, camera_reconnect, stream_failed, adoption_changed, aiport_error}` — none of these fit reconcile-flow events. Extending the union would have required modifying `src/lib/types.ts`, which is NOT in this plan's `files_modified`. Trade-off: we lose `storeEvent()`'s built-in dedup-by-(timestamp,type,message); for reconcile events the `reconcileId` is part of the message so duplicates are statistically impossible. P23 will widen the union and replace the direct inserts with `storeEvent()` when it ships the reconcile-log UI.
- **Bridge-error heuristic:** post-dial SSH errors are classified as `bridge_unreachable` via a regex over the error message (`/connect E(TIMEDOUT|CONNREFUSED)|EN(ETUNREACH|ETUNREACH)|ssh.*connect|pct.*(exec|push)/i`). Rationale: from the orchestrator's POV, a `pct push` failure mid-deploy IS effectively the bridge being unreachable; lumping it under `bridge_unreachable` lets the next 5-min tick retry naturally. Connect-time failures short-circuit BEFORE this branch (they go through their own dedicated catch).
- **Test-side leaked-follow-up flush:** two `await new Promise(r => setImmediate(r))` BEFORE `vi.clearAllMocks()` in `beforeEach`. Discovered when the dirty-flag test reported 3 `mockDiscover` calls instead of 2: the previous single-flight test's dirty trigger had scheduled a `setImmediate(reconcile, 'tick')`, which fired AFTER `clearAllMocks()` in the next test's `beforeEach`, inflating the counter. Two flushes are needed because the follow-up itself can schedule another setImmediate inside its finally block. Fixed without modifying production code — leakage is purely an artefact of vi's module-cache semantics.
- **Pure-helper partial mock for protect-bridge.ts:** mock only `fetchBootstrap` (the network call), keep `normalizeMac` / `classifyKind` / `protectStreamUrl` / `TLS_SCHEME` real via `vi.importActual`. Rationale: the pure helpers are deterministic + test-cheap; keeping them real catches MAC-normalisation regressions for free.

## Final Design Choice — auto-add seeding location

Per plan task step 5 — record explicitly so Plan 06 knows where to look:

**Location:** `src/lib/server/orchestration/protect-hub/reconcile.ts`
**Function:** `seedDefaultOutputsForNewCams()` (private; not exported)
**Call site:** `doReconcile()` between `discover()` success and `loadOutputRows()`.
**Trigger:** runs every reconcile pass; idempotent — for each `cameras WHERE source='external'` row, checks `cameraOutputs WHERE camera_id=?` existence and skips if any row exists (regardless of output_type).

If Plan 06's update-checker or Plan 04's ws-manager ever needs to invoke this independently, the function can be promoted to an export. For now it stays private — the only public reconcile surface is `reconcile(bridgeId, reason)`.

## Soft-delete strategy — actual choice

**Choice:** direct `fetchBootstrap()` call from `doReconcile`, NOT extending `discover()`.

**Code:**
```typescript
const bootstrap = await fetchBootstrap();
if (bootstrap.ok) {
  const bootstrapMacs = new Set(
    bootstrap.cameras.map((c) => normalizeMac(c.mac ?? '')).filter((m) => m !== '')
  );
  softDeleteMissingCams(bootstrapMacs);
}
```

**Cost analysis:** 1 extra cached call per reconcile (the lib's 8-min refresh window means ~7 of 8 calls hit cache). On a 5-min tick cadence: ~1 actual network call per 8 min, which is ~12.5% of reconcile cycles paying the lib cache miss. Acceptable.

**Why not extend `discover()`:** the closed P19 phase ships `DiscoverResult` as `{ok: true, insertedCams, updatedCams, insertedChannels} | {ok: false, reason, error}`. Adding `seenMacs?: string[]` to the success branch would require modifying `catalog.ts` (Plan 19), which sits outside this plan's `files_modified`. Plan 19's executor explicitly closed the phase; touching it would also require Plan 19 retro-cert.

## reconcile.ts line count vs. plan prediction

- **Plan prediction:** `min_lines: 200`
- **Actual:** 654 lines

The 3.3× delta is mostly comments + JSDoc. The plan implicitly underestimated the doc/code ratio for an orchestrator with 4 distinct passes, single-flight semantics, audit-row state machine, and 6 different error paths. Code-only line count (excluding comments + blank lines) is ~280 — within an order of magnitude of the prediction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Generated `src/lib/version.ts` so `npm run check` could run**
- **Found during:** Pre-Task 1 environment setup (npm install in fresh worktree)
- **Issue:** Build-time generated file `src/lib/version.ts` is `.gitignore`d and was missing in the fresh worktree (same issue Plans 01 + 02 hit; documented in their summaries).
- **Fix:** `npm run gen:version` (existing project script).
- **Files modified:** `src/lib/version.ts` (gitignored, not committed).
- **Verification:** `npm run check` reports 0 errors after.

**2. [Rule 3 — Blocking] Created `data/` directory before any DB-touching code path**
- **Found during:** Pre-Task 1 setup
- **Issue:** Same as Plans 01 + 02 — `data/` is gitignored and missing in fresh worktree.
- **Fix:** `mkdir -p data`.
- **Files modified:** None committed (`data/` stays gitignored).

**3. [Rule 1 — Test bug] dirty-flag test reported 3 discover calls instead of 2**
- **Found during:** Task 2 first vitest run on the full test file
- **Issue:** `mockDiscover` count was 3 instead of expected 2 in the dirty-flag test. Root cause: the prior test (`single-flight`) sets `_dirty=true` via the second `reconcile()` call, which schedules a `setImmediate(() => reconcile(bridgeId, 'tick'))` follow-up inside the finally block of `_inFlight`. After the test body finishes, that setImmediate is still queued. When the next test's `beforeEach` runs `vi.clearAllMocks()` synchronously, the leaked follow-up fires AFTER on the next macrotask, calling `mockDiscover` (which was just cleared). The dirty-flag test then sees an extra discover call.
- **Fix:** in `beforeEach`, `await new Promise(r => setImmediate(r))` TWICE before `vi.clearAllMocks()`. Two flushes because the follow-up itself can schedule another setImmediate inside its own finally block.
- **Files modified:** `reconcile.test.ts` only.
- **Verification:** all 15 tests pass; full-suite regression unchanged.
- **Commit:** folded into Task 2 commit `ec219bf`.

---

**Total deviations:** 3 — all auto-fixed (2× Rule 3 environment setup, 1× Rule 1 test bug). The reconcile.ts implementation shipped exactly as planned; ZERO deviation from CR-1 / CR-3 / CR-5 / CR-6 mitigations.

## Out-of-Scope Discoveries (logged to deferred-items.md, NOT auto-fixed)

- 12 pre-existing test failures across 4 unrelated services (`backup.test.ts`, `proxmox-validate.test.ts`, `onboarding.test.ts`, `proxmox.test.ts`). Reproduced on the wave-1 base before any 21-03 changes. Already logged by Plan 02 in `.planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md`. No action taken.

## Verification

- `npx vitest --run src/lib/server/orchestration/protect-hub/reconcile.test.ts` → **15/15 pass** (104 ms test execution; ~360 ms total)
- `npx vitest --run` (full suite) → **314 pass / 12 fail / 15 skipped** — failures are exactly the 12 pre-existing in deferred-items.md; no regressions
- `npm run check` → **0 errors**, 30 warnings (all pre-existing in unrelated `.svelte` files)

## Threat Model Compliance

| Threat ID | Mitigation Implemented | Test Coverage |
|---|---|---|
| T-21-02 (DoS via concurrent reconciles) | Single-flight Promise + dirty flag; concurrent triggers join in-flight Promise | `single-flight — two simultaneous reconciles share the same Promise` |
| T-21-03 (Tampering: partial YAML mid-deploy) | Atomic tmp+rename inside LXC: pushFileToContainer to <dest>.tmp.<reconcileId>, then executeOnContainer mv tmp final | `atomic deploy — push to .tmp.<id> then mv then systemctl restart` (asserts call ORDER) |
| T-21-05 (Repudiation: missing audit trail) | INSERT runs row with status='running' BEFORE any side effect; UPDATE to terminal status (success | no_op | bridge_unreachable | error) AFTER. Forensic record always exists. | `audit log — every reconcile pass creates exactly 1 row` + `audit log — successful reconcile updates row from running→success with hash` |
| T-21-09 (Tampering: false-positive soft-delete from bootstrap glitch) | Accepted per plan: archival is reversible (P23 restore path); 7-day grace before purge per L-20; logged as warning event for visibility | implicit — `protect_hub_cam_archived` event is severity='warning' (not 'error') |
| T-21-10 (Information Disclosure: error column leaks creds) | Error column is plain text; SSH errors include hostnames/IPs but never credentials (creds come from env, not embedded in error messages — verified pattern from P24 `update_runs.error_message`). | implicit (no creds in test fixture errors) |

## Next Plan Readiness

- **Plan 04 (ws-manager.ts)** can `import { reconcile } from './reconcile'` and call `void reconcile(bridge.id, 'ws_reconnect').catch(() => {})` per Pattern 4 in 21-RESEARCH.md.
- **Plan 05 (API routes)** can `import { reconcile, isReconcilerBusy, type ReconcileResult } from '$lib/server/orchestration/protect-hub/reconcile'`. The `POST /api/protect-hub/reconcile` route returns 202+reconcileId by spawning `void reconcile(bridge.id, 'force')` and immediately returning the freshly-minted UUID (caller polls `protect_hub_reconcile_runs`).
- **Plan 06 (scheduler tick + update-checker gate)** can:
  - call `reconcile(bridge.id, 'tick')` from the new `protectHubReconcileInterval` (5-min cadence)
  - extend `update-checker.ts:getActiveFlowConflicts()` with `if (isReconcilerBusy()) conflicts.push({kind: 'reconciler_busy', detail: '...'})` per CR-4
- **No new schema migrations needed** — all DB writes use the schema shipped by Plan 01.
- **No new type exports needed** for downstream plans — `ReconcileResult`, `ReconcileReason`, `isReconcilerBusy`, `reconcile` are the complete public surface.

## Self-Check: PASSED

- `src/lib/server/orchestration/protect-hub/reconcile.ts` — created (commit `612056e` ✓)
- `src/lib/server/orchestration/protect-hub/reconcile.test.ts` — modified (commit `ec219bf` ✓)
- 15/15 vitest assertions pass ✓
- 0 errors from `npm run check` ✓
- No regressions in full-suite test run (only the 12 pre-existing deferred failures remain) ✓
- isReconcilerBusy() exported (verified by `grep -E 'export function isReconcilerBusy' reconcile.ts`) ✓
- ReconcileResult typed-Result return per Pattern S-1 (verified by `grep -E 'export type ReconcileResult' reconcile.ts`) ✓
- CR-1 atomic deploy implemented (verified by atomic-deploy test asserting call order) ✓
- CR-3 systemctl restart (NOT reload-or-restart) (verified by atomic-deploy test forbidance) ✓
- CR-5 reuses catalog.ts:discover() (verified by import statement in reconcile.ts) ✓
- CR-6 source='external_archived' (verified by soft-delete test) ✓
- T-21-05 audit row at start + end (verified by audit-log invariant tests) ✓

---
*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Plan: 03 — reconcile.ts orchestrator + 15 behavioural tests*
*Completed: 2026-05-06*
