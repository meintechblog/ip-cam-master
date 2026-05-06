---
phase: 21-multi-cam-yaml-reconciliation-loop
plan: 06
status: complete-pending-uat
subsystem: protect-hub-orchestration

tags: [scheduler, integration, lifecycle, sigterm, busy-gate, 2-strike, vitest, fake-timers, checkpoint-pending]

requires:
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 03
    provides: reconcile() + isReconcilerBusy() — consumed by scheduler tick + update-checker gate + SIGTERM grace
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 04
    provides: startWs() / stopWs() — wired into scheduler boot/shutdown lifecycle
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 05
    provides: API surface; not consumed directly here, but the live UAT exercises both the API routes (PUT outputs, POST reconcile) and the new scheduler tick
  - phase: 19-protect-hub-schema-lock
    provides: protect_hub_bridges + cameras + camera_outputs schema columns the tick + health probe touch
  - phase: 20-bridge-lxc-provisioning
    provides: bridge LXC live at vmid 2014 — UAT target

provides:
  - scheduler.ts:protectHubReconcileInterval — 5min gated tick (HUB-RCN-01)
  - scheduler.ts:bridge health probe with 2-strike + recovery (HUB-OPS-05 + D-CAP-03)
  - scheduler.ts:startScheduler() boots ws-manager (Plan 04) when settings.protect_hub_enabled=true
  - scheduler.ts:stopScheduler() clears reconcile interval + stopWs() — clean shutdown of all P21 surfaces
  - update-checker.ts:FlowConflict union widened with reconciler_busy (HUB-RCN-10 + CR-4)
  - hooks.server.ts:30s SIGTERM grace polling isReconcilerBusy() (L-14 + P21-#13)
  - 9 new vitest fake-timer tests covering tick gate, ws-manager boot, 2-strike threshold, recovery, clean shutdown

affects: [22, 23]  # P22 onboarding wizard expects the 5min tick to be live; P23 reconcile-log UI consumes the audit rows the tick writes

tech-stack:
  added: []
  patterns:
    - "Dynamic import for cross-package gates: scheduler.ts lazily imports reconcile.ts + ws-manager.ts so the unifi-protect lib's transitive graph is NOT pulled in at boot when settings.protect_hub_enabled='false'. Mirrors how the existing health-check tick handles bambu-mqtt."
    - "2-strike threshold via module-scoped counter: bridgeFailureCount survives across ticks; reset on success; flip to 'unhealthy' only on >=2 consecutive failures; recovery on a single success regardless of strike count."
    - "Fire-and-forget startWs() inside startScheduler() via void IIFE: keeps the public function signature sync (matches startScheduler's existing shape and the established Bambu MQTT pattern), surfaces dynamic-import failures via console.error without blocking other interval setup."
    - "FlowConflict tagged union widening: source-compatible because every existing caller narrows on .kind === 'hub_starting'|'hub_stopping' before reading. The new branch piggybacks on the existing 409 wrapper at routes/api/update/run/+server.ts."
    - "SIGTERM polling loop: 250ms cadence, 30s deadline, double try/catch around isReconcilerBusy() (defensive in case the reconcile module never loaded at all in this process)."
    - "Test-side per-test fetch spy: re-create vi.spyOn(global, 'fetch') inside beforeEach because vi.restoreAllMocks() in afterEach removes the spy from global.fetch — without this fix, the second test in the suite cannot intercept fetch."

key-files:
  created: []
  modified:
    - src/lib/server/services/scheduler.ts
    - src/lib/server/services/scheduler.test.ts
    - src/lib/server/services/update-checker.ts
    - src/hooks.server.ts
    - .planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md

key-decisions:
  - "Did NOT touch routes/api/update/run/+server.ts to add the Retry-After:60 header. The plan body explicitly states the existing 409 wrapper is unchanged ('no change needed there'). Header is logged to deferred-items.md as a future cleanup; clients can already discriminate on conflicts[].kind === 'reconciler_busy'."
  - "Dynamic import for reconcile + ws-manager from scheduler.ts — keeps scheduler's static module graph free of the unifi-protect lib + SSH transitive cost when the Hub is off. Per-tick import overhead is amortised by Node's ESM module cache (one resolution per process lifetime)."
  - "Fire-and-forget stopWs() in stopScheduler() via void IIFE: stopScheduler is sync to match the existing public surface, but stopWs() needs the dynamic import to be safe even if ws-manager was never loaded (Hub disabled at boot). Console-swallowed catch is the correct posture — dispose ops should never block shutdown."
  - "Per-test fetch spy re-creation inside beforeEach. Initial naive design used a describe-scoped const; the second test failed silently because vi.restoreAllMocks() in afterEach ripped the spy off global.fetch. Re-spying per-test gave deterministic interception."
  - "scheduler.test.ts cameras DDL mirrors the full production schema (every NOT-NULL column with DEFAULT). Drizzle prepares the SELECT against schema.cameras's full column set, so a pared-down test fixture throws 'no such column: vmid' even when no rows exist."

requirements-completed:
  - HUB-RCN-01
  - HUB-OPS-05
  - HUB-RCN-10  # busy gate now wired into update-checker.ts (Plan 03 implemented isReconcilerBusy; Plan 06 consumes it)

requirements-pending-uat:
  - HUB-RCN-01  # 5min tick exercise on live bridge
  - HUB-OPS-05  # 2-strike + recovery on live bridge
  - All 11 ROADMAP §Phase 21 SC-1..SC-11 (live bridge vmid 2014 — see "Live UAT pending user" below)

metrics:
  duration_minutes: 12
  task_count: 3  # 2 atomic source commits + 1 verification gate
  files_count: 5  # 4 source + 1 deferred-items append
  tests_added: 9  # scheduler.test.ts: 9 new fake-timer tests (6 reconcile-tick + 1 startWs + 2 health-probe)
  tests_passing: 348  # full suite excluding the 12 pre-existing deferred failures
completed: 2026-05-06
---

# Phase 21 Plan 06: Scheduler + Update-Checker + SIGTERM Wiring Summary

**P21 backend integration glue: scheduler.ts now drives the 5min reconcile tick (gated on settings.protect_hub_enabled), boots Plan 04's ws-manager, and runs a 2-strike bridge health probe with recovery; update-checker's getActiveFlowConflicts() widens to surface reconciler_busy so self-update returns 409 mid-deploy; hooks.server.ts SIGTERM handler now polls isReconcilerBusy() for up to 30s before exit. Plans 02-05 are no longer inert modules — the reconcile loop is LIVE in code. Live UAT against bridge vmid 2014 is pending (checkpoint:human-verify).**

## Performance

- **Duration:** ~12 min (post-context-load)
- **Tasks:** 2 atomic auto-task commits + 1 verification gate
- **Files modified:** 4 source + 1 deferred-items append
- **Tests added:** 9 fake-timer tests in scheduler.test.ts (replaces Wave-0 stub from Plan 01)
- **Tests passing:** 348/360 full-suite (12 pre-existing failures in deferred-items, NO regressions from this plan)

## Accomplishments

### Task 1 — `scheduler.ts` (commit `6adcf9c`)

1. **`protectHubReconcileInterval` — 5min reconcile tick (HUB-RCN-01).**
   - Gated on `settings.protect_hub_enabled === 'true'`. Disabled state is silent (no log spam, no DB hit) per HUB-RCN-01.
   - Selects the running bridge via `db.select().from(protectHubBridges).where(eq(status, 'running')).limit(1).get()` — silent when no running bridge present.
   - Dynamic-imports `reconcile` from `'$lib/server/orchestration/protect-hub/reconcile'` so scheduler.ts's static graph stays clear of the unifi-protect lib + SSH transitive cost when the Hub is off.
   - 5min cadence per L-5 + HUB-RCN-01.

2. **`startWs()` boot wiring.**
   - `void (async () => { ... })()` IIFE inside `startScheduler()` — keeps the public sync signature.
   - Reads `getSetting('protect_hub_enabled')`; if `'true'`, dynamic-imports `startWs` and awaits it. Errors fall to `console.error` (do not block other interval setup).

3. **Bridge health probe extended with 2-strike + recovery (HUB-OPS-05 + D-CAP-03).**
   - Module-scoped `bridgeFailureCount` counter.
   - On success: counter reset; if previously `'unhealthy'`, flip to `'running'` + emit `info` event ("go2rtc recovered on …").
   - On failure: counter increments; only when `>= 2` AND status was not already `'unhealthy'` does it flip to `'unhealthy'` + emit `warning` event ("go2rtc unreachable 2x on … — marked unhealthy").
   - Probe now runs against both `'running'` and `'unhealthy'` bridges — required so a recovered bridge can flip back on the next single success (otherwise the gate prevents recovery).

4. **`stopScheduler()` clears P21 surfaces.**
   - Clears `protectHubReconcileInterval`; resets `bridgeFailureCount = 0`; fires `stopWs()` via dynamic-import IIFE (swallowed catch — ws-manager may have never loaded).

5. **`scheduler.test.ts` — 9 new fake-timer tests (replaces Wave-0 stub).**
   | # | Test | Exercises |
   |---|------|-----------|
   | 1 | `5-min tick — fires reconcile when protect_hub_enabled=true AND running bridge exists` | HUB-RCN-01 happy path |
   | 2 | `5-min tick — silent when protect_hub_enabled=false` | HUB-RCN-01 disabled state |
   | 3 | `5-min tick — silent when protect_hub_enabled is missing (null)` | HUB-RCN-01 unconfigured fall-through |
   | 4 | `5-min tick — silent when no running bridge (status=pending)` | HUB-RCN-01 narrow-bridge-query gate |
   | 5 | `startScheduler — boots ws-manager when protect_hub_enabled=true` | startWs boot wiring |
   | 6 | `startScheduler — does NOT boot ws-manager when protect_hub_enabled=false` | startWs boot wiring negative |
   | 7 | `stopScheduler — clears protectHubReconcileInterval (no further reconcile after stop)` | Clean shutdown of reconcile tick + stopWs() called |
   | 8 | `2-strike — 1st bridge fetch failure does NOT flip status, 2nd consecutive flips to unhealthy` | HUB-OPS-05 + D-CAP-03 |
   | 9 | `recovery — single success on a previously unhealthy bridge flips back to running + emits info event` | HUB-OPS-05 recovery branch |

### Task 2 — `update-checker.ts` + `hooks.server.ts` (commit `88a7230`)

6. **`update-checker.ts` — `getActiveFlowConflicts()` widened with reconciler_busy (CR-4 + HUB-RCN-10).**
   - New `FlowConflict` discriminated-union type exported.
   - Imports `isReconcilerBusy` from `$lib/server/orchestration/protect-hub/reconcile`.
   - Defensive try/catch around the call so an early-boot import failure folds to "no conflict" rather than crashing the self-update flow.
   - Downstream 409 wrapper at `routes/api/update/run/+server.ts:71-76` is unchanged per plan body — the conflicts array now carries the new `kind: 'reconciler_busy'` so clients can discriminate.

7. **`hooks.server.ts` — 30s SIGTERM grace (L-14 + P21-#13).**
   - Imports `isReconcilerBusy` directly.
   - Replaces the old 1-line `process.exit(0)` shutdown with an async function: poll every 250ms for up to 30 000ms (`SHUTDOWN_RECONCILE_GRACE_MS`); break early when reconciler goes idle; log a tidy "exiting (reconciler idle/STILL BUSY (timeout))" line.
   - Wraps the listener in `void shutdown(signal)` so Node's event-listener API (which doesn't await async listeners) still triggers the polling loop. `process.exit(0)` inside the handler short-circuits the rest of the shutdown sequence safely.
   - 30s budget fits well within systemd's default `TimeoutStopSec=90s`. Even a hard-kill is safe because the atomic tmp+rename inside the bridge LXC (Plan 03 / CR-1) means the existing `/etc/go2rtc/go2rtc.yaml` is either OLD or NEW — never partial.

### Task 3 — Verification gate (no source modifications)

- **`npx vitest --run`** → 348 pass / 12 fail / 15 skipped. The 12 failures are exactly the pre-existing cohort in `deferred-items.md` (4 unrelated services: backup, proxmox-validate, onboarding, proxmox). NO regressions from this plan.
- **`npm run check`** → 0 errors / 30 warnings (all pre-existing in unrelated `.svelte` files).
- **`npm run build`** → reproduces the **pre-existing wave-base SSR SQLite crash** (`Error [ERR_UNHANDLED_ERROR]: Unhandled error. ({ code: 'SQLITE_ERROR' })` during `rendering chunks…`). Verified by checking out the wave-3 base `191bab7` clean and re-running `npm run build` → same crash. Logged to `deferred-items.md`. Out of scope per SCOPE BOUNDARY rule.
- **Cyclic-import guard:** `grep "ws-manager" src/lib/server/orchestration/protect-hub/reconcile.ts` returns 0 matches. Plan 04's design intent (one-way `ws-manager → reconcile` import edge) holds at the wave-3 merge.

## Task Commits

| Task | Hash | Type | Description |
|------|------|------|-------------|
| 1 | `6adcf9c` | feat | scheduler protect-hub interval + 2-strike health probe + ws-manager boot + 9 fake-timer tests |
| 2 | `88a7230` | feat | update-checker reconciler_busy gate + 30s SIGTERM grace |

## Live UAT pending user

**Status:** `checkpoint:human-verify` — auto tasks code-complete + green-light passed; live verification on bridge vmid 2014 is the final gate. The orchestrator (or user via `/gsd:execute-phase` continuation) must run the steps below.

**Cannot self-execute:** I am running inside an isolated git worktree with no SSH access to `192.168.3.139` (bridge LXC), `192.168.3.249` (app VM), or the UDM Pro. The plan body's `<task type="checkpoint:human-verify">` block (lines 422-538 in `21-06-PLAN.md`) is the authoritative UAT runbook. Key entry points reproduced here for convenience:

### Setup (do once)

1. **Deploy the wave-3 + this plan's commits to the VM:** `./scripts/dev-deploy.sh` (per memory: rsync deploy + atomic). Wait for the systemd `ip-cam-master` service to restart — the new `protectHubReconcileInterval` boot will only fire on a fresh process.
2. **Verify the app is alive:** `curl http://192.168.3.249/api/version` → returns the new SHA (the merge of this worktree).
3. **Pick a Carport-class Protect cam from the catalog:**
   - The P19-01 spike found a live HEVC 1280×720 source on the Carport.
   - Note its MAC (lowercased, no separators — e.g., `aabbccddeeff`).
   - Note its `cameras.id` from `curl http://192.168.3.249/api/cameras | jq` (or directly: `sqlite3 /var/lib/ip-cam-master/data/app.db "SELECT id, name, mac FROM cameras WHERE mac IS NOT NULL"`).

### SC-1 — Loxone-MJPEG + Frigate-RTSP both play (CRITICAL)

```bash
# Enable both outputs on the Carport cam
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"outputs":[{"outputType":"loxone-mjpeg","enabled":true},{"outputType":"frigate-rtsp","enabled":true}]}' \
  http://192.168.3.249/api/cameras/<CARPORT_CAM_ID>/outputs
# Expect: {ok: true, projectedMjpegCount: 1}

# Wait 5-10s for in-process reconcile to deploy YAML
sleep 10

# go2rtc HTTP API should now have both streams
curl http://192.168.3.139:1984/api/streams | jq 'keys'
# Expect: includes "<carport-mac>-low" AND "<carport-mac>-high"

# VLC test (manual): open http://192.168.3.139:1984/api/stream.mjpeg?src=<carport-mac>-low

# ffprobe on Loxone-MJPEG — must show MJPEG 640x360 @ ~10fps with NO audio
ffprobe -hide_banner -i http://192.168.3.139:1984/api/stream.mjpeg?src=<carport-mac>-low 2>&1 \
  | grep -E "Video:|Audio:|fps"

# ffprobe on Frigate-RTSP — codec_name MUST equal hevc (passthrough; no re-encode)
ffprobe -hide_banner -show_streams rtsp://192.168.3.139:8554/<carport-mac>-high 2>&1 \
  | grep -E "codec_name|width|height"
```

### SC-2 — Auto-reconcile every 5min when enabled

```bash
# Watch bridge YAML mtime over 5+ min — should NOT change if DB state unchanged (no_op skip)
pct exec 2014 -- stat -c '%Y' /etc/go2rtc/go2rtc.yaml
sleep 300
pct exec 2014 -- stat -c '%Y' /etc/go2rtc/go2rtc.yaml
# Expect: identical mtime → no_op skip working

# Toggle a Frigate output OFF; within ~10s the slug should disappear
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"outputs":[{"outputType":"loxone-mjpeg","enabled":true},{"outputType":"frigate-rtsp","enabled":false}]}' \
  http://192.168.3.249/api/cameras/<CARPORT_CAM_ID>/outputs
sleep 10
curl http://192.168.3.139:1984/api/streams | jq 'keys'
# Expect: <carport-mac>-high is gone
```

### SC-3 — No-op reconcile is fast (<2s) and produces no SSH push

```bash
# Force-reconcile (202 fire-and-forget)
RECONCILE_ID=$(curl -s -X POST http://192.168.3.249/api/protect-hub/reconcile | jq -r '.reconcileId')
echo "reconcileId=$RECONCILE_ID"

# Poll status
sleep 3
curl "http://192.168.3.249/api/protect-hub/reconcile-runs?reconcileId=$RECONCILE_ID" | jq
# Expect: status=no_op, hashChanged=0, completedAt within ~2s of startedAt
```

### SC-4 — Single-flight serialisation (two parallel reconciles)

```bash
(curl -s -X POST http://192.168.3.249/api/protect-hub/reconcile &
 curl -s -X POST http://192.168.3.249/api/protect-hub/reconcile &
 wait) | jq -s '.'
# Inspect protect_hub_reconcile_runs — both reconcileIds should resolve nearly simultaneously
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT reconcile_id, started_at, completed_at, status FROM protect_hub_reconcile_runs ORDER BY id DESC LIMIT 5"
```

### SC-5 — Token rotation (DEFER unless natural UDM reboot occurs)

Marked covered by Plan 03 reconcile.test.ts unit test "token rotation produces different hash". Manual verification requires waiting for natural rotation or rebooting the UDM Pro.

### SC-6 — WS reconnect uses exp backoff

```bash
# Block UDM port 443 from app VM (or kill UDM briefly)
journalctl -u ip-cam-master -f | grep ws-manager
# Expect: reconnect attempts at 5s, 10s, 30s, 60s intervals (NOT 1s)

# Restore UDM access; expect ONE reconcile fired with reason='ws_reconnect'
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT reconcile_id, started_at, status FROM protect_hub_reconcile_runs ORDER BY id DESC LIMIT 1"
```

### SC-7 — Auto-add new cam (DEFER unless cam adoption is convenient)

Marked covered by Plan 03 reconcile.test.ts auto-add tests. Live test requires adopting a new cam in Protect.

### SC-8 — VAAPI cap enforcement

```bash
# Try to enable a 7th MJPEG output across cams — should 422
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"outputs":[{"outputType":"loxone-mjpeg","enabled":true}]}' \
  http://192.168.3.249/api/cameras/<NEW_CAM_ID>/outputs
# Expect: HTTP 422 with German message "Maximal 6 gleichzeitige Loxone-MJPEG"
```

### SC-9 — Slug stability across cam name edits

```bash
# Note current slug
curl http://192.168.3.139:1984/api/streams | jq 'keys' | grep <carport-mac>-low

# Rename the cam in Protect web UI ("Carport" → "Garage"); wait 5min for next tick
sleep 300

# Slug should be UNCHANGED
curl http://192.168.3.139:1984/api/streams | jq 'keys' | grep <carport-mac>-low
```

### SC-10 — Self-update returns 409 mid-reconcile (THIS PLAN'S BUSY GATE)

```bash
# Trigger reconcile (force a longer one — e.g. by toggling outputs to provoke a deploy)
curl -X POST http://192.168.3.249/api/protect-hub/reconcile

# Immediately try to trigger update
curl -i -X POST http://192.168.3.249/api/update/run -H 'Host: localhost'
# Expect: HTTP 409 with body containing "active_flows" + conflicts[].kind="reconciler_busy"
# Note: plan body did NOT mandate the Retry-After:60 header — the conflict array carries
# the discriminator. See deferred-items.md if you want to add the explicit header.

# Wait for reconcile to finish; retry update — expect 200
sleep 15
curl -i -X POST http://192.168.3.249/api/update/run -H 'Host: localhost'
```

### SC-11 — Bridge health probe 2-strike (THIS PLAN'S CHANGE)

```bash
# Block bridge:1984 from app VM
pct exec 2014 -- systemctl stop go2rtc

# Wait for 1st health-probe tick (~5min) — expect status STILL 'running' (1st strike)
sleep 310
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT status FROM protect_hub_bridges LIMIT 1"
# Expect: running

# Wait for 2nd tick — expect status flip to 'unhealthy' + warning event
sleep 310
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT status FROM protect_hub_bridges LIMIT 1"
# Expect: unhealthy
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT message, severity FROM events WHERE event_type LIKE '%health%' ORDER BY id DESC LIMIT 3"
# Expect: at least one row with 'unreachable 2x' + severity='warning'

# Restart go2rtc
pct exec 2014 -- systemctl start go2rtc

# Wait 5min — expect flip back to 'running' + info recovery event
sleep 310
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT status FROM protect_hub_bridges LIMIT 1"
# Expect: running
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT message FROM events WHERE message LIKE '%recovered%' ORDER BY id DESC LIMIT 1"
```

### Bonus — 30s SIGTERM grace (THIS PLAN'S CHANGE)

```bash
# Trigger a long reconcile (force toggle to provoke deploy)
curl -X POST http://192.168.3.249/api/protect-hub/reconcile

# Immediately restart the service while reconcile is in-flight
systemctl restart ip-cam-master

# Inspect logs for the new shutdown line
journalctl -u ip-cam-master -n 50 | grep '\[shutdown\]'
# Expect: "[shutdown] received SIGTERM, draining..."
#         "[shutdown] exiting (reconciler idle)"     ← if grace let it finish
#       OR "[shutdown] exiting (reconciler STILL BUSY (timeout))"  ← rare; atomic write still safe

# Verify YAML on bridge is intact (not partial)
pct exec 2014 -- sha256sum /etc/go2rtc/go2rtc.yaml
# Compare against the last_deployed_yaml_hash — they should match if grace let reconcile finish
sqlite3 /var/lib/ip-cam-master/data/app.db \
  "SELECT last_deployed_yaml_hash FROM protect_hub_bridges LIMIT 1"
```

### Exit conditions (any = STOP and report failure)

- VLC cannot play Loxone-MJPEG → reconcile output is wrong (Plan 02/03 bug)
- ffprobe shows audio stream on Frigate-RTSP → -an flag missing (D-PIPE-04 violation)
- Frigate-RTSP shows transcoded codec instead of HEVC → -c:v copy missing
- Reconcile fails with status=error in audit table → reconcile.ts bug
- 7th MJPEG returns 200 instead of 422 → cap enforcement bypass (security)
- SIGTERM mid-deploy leaves partial YAML on disk → atomicity bug (BUT atomic tmp+rename should make this impossible)
- More than 1 SSH push event observed for an unchanged DB state → canonical-hash dedupe broken
- After running SC-11, bridge does NOT recover within 1 health-probe tick after `systemctl start go2rtc` → recovery branch broken (Task 1 regression)

### Resume signal

Type `approved — all SC-1..SC-11 green` (or `approved — SC-1..SC-N green; SC-X..SC-Y deferred`) OR describe failures with concrete output.

## Decisions Made

- **`Retry-After: 60` header NOT added.** The orchestrator's success criteria mentioned it but the plan body explicitly says the downstream wrapper at `routes/api/update/run/+server.ts:71-76` is unchanged ("no change needed there"). I respected `files_modified` scope. Future cleanup logged to `deferred-items.md`.
- **Dynamic imports for reconcile + ws-manager from scheduler.ts.** Keeps the static module graph small at boot. Per-tick import overhead is negligible (Node ESM caches resolved modules).
- **Fire-and-forget startWs() in startScheduler() via void IIFE.** Public sync signature preserved. Mirrors how `startBambuSubscribers().catch(...)` is handled in the same file.
- **Per-test fetch spy re-creation.** vitest's `vi.restoreAllMocks()` in afterEach removes the spy from `global.fetch`, so a describe-scoped spy goes dead after the first test. Re-spying inside beforeEach gave deterministic interception.
- **Probe runs on both 'running' and 'unhealthy' bridges.** Required so a recovered bridge can flip back on the next single success — otherwise the gate `bridge.status === 'running'` traps it forever in 'unhealthy'.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `data/` directory + `src/lib/version.ts` missing in fresh worktree.**
- **Found during:** Task 1 setup (npm install in fresh worktree).
- **Issue:** Same recurrent fresh-worktree environment issue Plans 01/02/03/04 hit; both files are gitignored.
- **Fix:** `mkdir -p data && npm run gen:version`.
- **Files modified:** `src/lib/version.ts` (gitignored, not committed).

**2. [Rule 1 — Test bug] Initial scheduler.test.ts cameras DDL was too narrow.**
- **Found during:** First full test run.
- **Issue:** Drizzle's `db.select().from(cameras).all()` prepares the SELECT against schema.cameras's full column set. A pared-down `cameras` DDL (only id/name/container_ip/etc) threw `SqliteError: no such column: vmid` even when no rows exist.
- **Fix:** Mirrored the full production DDL with NOT-NULL columns + DEFAULT values so the prepare succeeds without rows.
- **Files modified:** `src/lib/server/services/scheduler.test.ts` only.
- **Verification:** all 9 tests pass; folded into Task 1 commit `6adcf9c`.

**3. [Rule 1 — Test bug] Initial fetchSpy was describe-scoped and went dead between tests.**
- **Found during:** Second full test run on the new tests.
- **Issue:** `const fetchSpy = vi.spyOn(global, 'fetch')` at describe-scope — vitest's `vi.restoreAllMocks()` in afterEach restored `global.fetch` to its original implementation, so the second test's `fetchSpy.mockRejectedValue(...)` had no interception effect. Both 2-strike + recovery tests failed because the bridge probe used the unmocked global fetch.
- **Fix:** Re-create the spy inside `beforeEach`. Drop the explicit `fetchSpy.mockReset()` call from afterEach (`vi.restoreAllMocks()` already handles it).
- **Files modified:** `src/lib/server/services/scheduler.test.ts` only.
- **Verification:** all 9 tests pass; folded into Task 1 commit `6adcf9c`.

### Out-of-scope discoveries (logged to deferred-items.md, NOT auto-fixed)

- **Pre-existing 12 test failures across 4 unrelated services (`backup`, `proxmox-validate`, `onboarding`, `proxmox`).** Same cohort flagged by Plans 02/03/04. Confirmed unchanged on `191bab7` base.
- **`npm run build` SQLITE_ERROR crash during `rendering chunks…`.** Pre-existing — reproduced on the wave-3 base before any 21-06 changes. Likely a SvelteKit prerender worker importing a server module that touches the embedded SQLite client at build-time. Out of scope for P21-06 — route to a separate build-stabilisation plan. Logged.
- **`Retry-After: 60` header on the 409 self-update response.** Mentioned in the orchestrator's success criteria but not in the plan body. The plan body's `<task>` step 1 explicitly says the downstream wrapper is unchanged. Logged to deferred-items as a future cleanup; clients can already discriminate on `conflicts[].kind === 'reconciler_busy'`.

**Total deviations:** 3 — all auto-fixed (1× Rule 3 environment setup, 2× Rule 1 test bugs). The integration shipped exactly as planned; ZERO deviation from CR-4 / L-14 / P21-#13 mitigations.

## Threat Model Compliance

| Threat ID | Mitigation Implemented | Verified by |
|---|---|---|
| T-21-02 (DoS via concurrent reconciles) | Tick CALLS reconcile, which is single-flight (Plan 03 enforces). Tick is gated on `protect_hub_enabled='true'` so disabled state is silent. | `5-min tick — silent when settings.protect_hub_enabled=false` test |
| T-21-13 (EoP via internal scheduler tick) | Accepted: tick is internal; same posture as existing `logScanInterval`, `healthCheckInterval`, `protectPollInterval`. | by-design (no auth on in-process call) |
| T-21-03 (Tampering via SIGTERM mid-deploy) | 30s grace polling `isReconcilerBusy()` lets in-flight atomic tmp+rename finish. Even past 30s, the atomic write inside the bridge LXC means the file is OLD or NEW — never partial. | `[shutdown] exiting (reconciler ...)` log line + bridge YAML hash check (live UAT bonus) |
| T-21-14 (DoS via bridge health probe flapping) | 2-strike threshold + recovery on single success. Single transient blip no longer flips bridge. | `2-strike — 1st bridge fetch failure does NOT flip status, 2nd consecutive flips to unhealthy` test + `recovery — single success on a previously unhealthy bridge flips back to running` test |

## Verification

- `npx vitest --run src/lib/server/services/scheduler.test.ts` → **9/9 pass** (~330ms)
- `npx vitest --run src/lib/server/orchestration/protect-hub/ src/lib/server/services/scheduler.test.ts` → **83/83 pass** (full P21 + scheduler suite, ~30s)
- `npx vitest --run src/lib/server/routes-tests/update-run-post.test.ts` → **6/6 pass** (FlowConflict union widening confirmed source-compatible)
- `npx vitest --run` (full suite) → **348 pass / 12 fail** — failures are exactly the 12 pre-existing in `deferred-items.md`; NO regressions
- `npm run check` → **0 errors**, 30 warnings (all pre-existing in unrelated `.svelte` files)
- `npm run build` → reproduces pre-existing wave-base SSR SQLite crash (logged to deferred-items.md)

## TDD Gate Compliance

This plan has `type: execute` (NOT `tdd`), so RED/GREEN/REFACTOR gates do not apply at the plan level. Per-task TDD was not used (`tdd="false"` on both auto tasks). Tests were written alongside production code in Task 1; this is consistent with the plan's `<verify>` block.

## Self-Check: PASSED

- `src/lib/server/services/scheduler.ts` — modified (commit `6adcf9c` ✓)
- `src/lib/server/services/scheduler.test.ts` — modified (commit `6adcf9c` ✓)
- `src/lib/server/services/update-checker.ts` — modified (commit `88a7230` ✓)
- `src/hooks.server.ts` — modified (commit `88a7230` ✓)
- `.planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md` — modified (committed with this SUMMARY)
- 9 new vitest assertions pass ✓
- Full suite shows zero regressions ✓
- 0 errors from `npm run check` ✓
- protectHubReconcileInterval added ✓ (`grep -n protectHubReconcileInterval src/lib/server/services/scheduler.ts` → 4 matches)
- 2-strike threshold added ✓ (`grep -n bridgeFailureCount src/lib/server/services/scheduler.ts` → 4 matches)
- startWs/stopWs wired into lifecycle ✓ (`grep -n 'startWs\|stopWs' src/lib/server/services/scheduler.ts` → 2 matches)
- FlowConflict union widened ✓ (`grep -n reconciler_busy src/lib/server/services/update-checker.ts` → 2 matches)
- 30s SIGTERM grace ✓ (`grep -n SHUTDOWN_RECONCILE_GRACE_MS src/hooks.server.ts` → 2 matches)
- Live UAT runbook included ✓ (this section: "Live UAT pending user")
- Frontmatter `status: complete-pending-uat` (NOT `complete`) ✓

## Next-step readiness

- **Live UAT (Task 4 / checkpoint:human-verify):** waiting on orchestrator/user. Runbook above is the authoritative replay of the plan's `<how-to-verify>` block.
- **STATE.md / ROADMAP.md NOT updated** by this executor (per parallel-execution rules). Final phase-close belongs to the orchestrator after live UAT acknowledgement.
- **No new schema migrations** — all DB writes use the schema shipped by Plan 01.

---
*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Plan: 06 — scheduler tick + busy gate + SIGTERM grace*
*Auto-tasks completed: 2026-05-06 — Live UAT pending user*
