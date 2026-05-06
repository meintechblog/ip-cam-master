---
phase: 21-multi-cam-yaml-reconciliation-loop
plan: 05
status: complete
subsystem: api-routes-protect-hub

tags: [sveltekit, api-route, protect-hub, vaapi-cap, single-flight, fire-and-forget, vitest, drizzle, force-reconcile]

requires:
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 01
    provides: protect_hub_reconcile_runs Drizzle table + 2 server-test stub files (reconcile/server.test.ts + outputs/server.test.ts) + extended in-mem DDL for reconcile.test.ts
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 03
    provides: reconcile(bridgeId, reason) public function + ReconcileResult tagged-Result type + protectHubReconcileRuns Drizzle queries
  - phase: 19-protect-hub-schema-lock
    provides: cameras (source, kind, mac), cameraOutputs (cameraId, outputType, enabled), protectHubBridges (status, vmid)
  - phase: 20-bridge-lxc-provisioning
    provides: bridge LXC live at vmid 2014 — UAT smoke target for the manual force-reconcile curl

provides:
  - "POST /api/protect-hub/reconcile (force-reconcile, 202 + reconcileId per D-API-01)"
  - "GET /api/protect-hub/reconcile-runs?reconcileId=… (poll status by id; 400/404/200)"
  - "PUT /api/cameras/[id]/outputs (replace; VAAPI cap; D-CAP-01 soft-event + D-CAP-02 hard-422; HUB-RCN-02 reconcile trigger)"
  - "reconcile.ts signature extension: optional `externalReconcileId?: string` 3rd param (backwards-compatible — scheduler.ts/ws-manager.ts unaffected)"
  - "16th reconcile.test.ts assertion locking the externalReconcileId path (RED→GREEN proven)"
  - "5 POST/GET reconcile route assertions (replaces Wave-0 stubs)"
  - "10 PUT outputs route assertions (replaces Wave-0 stubs)"
  - "Mock-chain SELECT-order contract documented in BOTH +server.ts AND server.test.ts so Plan 06 + future maintainers cannot drift them silently"

affects: [21-06 (Plan 06 scheduler tick & update-checker; consumes /api/protect-hub/reconcile + /api/protect-hub/reconcile-runs surface), 22-protect-hub-ui (PUT /api/cameras/[id]/outputs IS the toggle target; reconcile-runs IS the polling surface)]

tech-stack:
  added: []
  patterns:
    - "D-API-01 non-blocking 202 + reconcileId: pre-mint UUID, return JSON before reconcile runs, fire-and-forget background reconcile() with externalReconcileId so the polled audit row matches"
    - "Replace strategy on PUT (D-API-02): db.delete(cameraOutputs).where(cameraId) → db.insert per body row; cap check + enum gate run BEFORE delete to keep failures atomic"
    - "VAAPI cap arithmetic: count MJPEG outputs on OTHER cams (NOT including the cam being toggled, which is being replaced); add requested MJPEG count from body; compare to 6 hard / 4 soft. Frigate-RTSP NOT counted (passthrough is zero VAAPI cost — L-26)"
    - "TS-cast escape hatch for storeEvent — EventType union in src/lib/types.ts is closed (legacy v1.0); P21 introduces 'vaapi_soft_cap_warning' + source='protect_hub' that the union doesn't list yet. Cast through `as unknown as Omit<CameraEvent,'id'>` and let the events-table text columns absorb it (same posture reconcile.ts took for its own new event types per Plan 03 Decisions). P23 widens the union when it ships the reconcile-log + cap-warning UI"
    - "Mock-chain SELECT-order contract: PUT outputs +server.ts documents its 3-SELECT order (camera → cap-count → bridge) in a header comment; server.test.ts mirrors the same comment. Reordering production SELECTs requires updating .mockReturnValueOnce sequence — the contract is explicit so the next maintainer can't drift them silently"

key-files:
  created:
    - src/routes/api/protect-hub/reconcile/+server.ts
    - src/routes/api/protect-hub/reconcile-runs/+server.ts
    - src/routes/api/cameras/[id]/outputs/+server.ts
  modified:
    - src/lib/server/orchestration/protect-hub/reconcile.ts
    - src/lib/server/orchestration/protect-hub/reconcile.test.ts
    - src/routes/api/protect-hub/reconcile/server.test.ts
    - src/routes/api/cameras/[id]/outputs/server.test.ts

key-decisions:
  - "POST /reconcile pre-mints reconcileId in the route (NOT inside reconcile.ts) so it can return 202+id before reconcile runs. Pass it as externalReconcileId to reconcile() so the audit row matches"
  - "PUT outputs returns 200 even when no running bridge exists — the toggle is persisted and the next force-reconcile or scheduler tick (Plan 06) picks it up. Refusing the write would block the user from configuring outputs while the bridge is restarting/being-provisioned"
  - "VAAPI hard-cap message uses EXACT German wording per D-CAP-02; the projected total is dynamic but the prefix string is character-exact (plan-checker enforces). Test asserts the FULL string for n=7 to lock both prefix and number formatting"
  - "Soft-cap event emitted AFTER successful DB write (not before) — if the write fails for any reason, the event is not emitted. Order asserted in test via mock.invocationCallOrder"
  - "Mock-chain SELECT order documented in BOTH +server.ts AND test header — reordering production code requires updating mock sequence. Explicit contract beats implicit coupling"
  - "Single-flight in reconcile.ts joiner case drops externalReconcileId (in-flight reconcile keeps its own id) — documented in reconcile.ts JSDoc. Trade-off: API correlation is best-effort, single-flight correctness is absolute (per L-13). Clients should retry on 404 from /reconcile-runs polling"

requirements-completed:
  - HUB-OUT-01
  - HUB-OUT-04
  - HUB-RCN-02
  - HUB-RCN-03

metrics:
  duration_minutes: 12
  task_count: 3
  files_created: 3
  files_modified: 4
  tests_added: 16  # 1 reconcile externalReconcileId + 5 reconcile/POST&GET + 10 outputs/PUT
  tests_passing_in_plan_files: 31  # 16 reconcile.test + 5 reconcile/server.test + 10 outputs/server.test
completed: 2026-05-06
---

# Phase 21 Plan 05: Force-Reconcile + Outputs API Surface Summary

**3 SvelteKit API routes shipped that expose the reconcile/outputs surface to the UI and to manual UAT — `POST /api/protect-hub/reconcile` (non-blocking 202+reconcileId per D-API-01), `GET /api/protect-hub/reconcile-runs?reconcileId=…` (poll status by id), `PUT /api/cameras/[id]/outputs` (replace + VAAPI cap with EXACT D-CAP-02 German wording + HUB-RCN-02 reconcile fan-out). Plus a small Plan-03 follow-up: `reconcile.ts` now accepts an optional `externalReconcileId` so the API-returned id matches the audit row the client polls for. 31 tests across 3 files (replaces Wave-0 stubs); `npm run check` clean; full-suite shows only the 12 pre-existing deferred failures.**

## Task Commits

1. **Task 1: reconcile.ts externalReconcileId extension + RED/GREEN test** — `1d43917` (refactor)
2. **Task 2: POST /api/protect-hub/reconcile + GET /api/protect-hub/reconcile-runs (5 tests)** — `e867383` (feat)
3. **Task 3: PUT /api/cameras/[id]/outputs — VAAPI cap + reconcile trigger (10 tests)** — `e9122fc` (feat)

## Test Coverage Map (Requirement → Test → File)

| Requirement | Test name | File |
|---|---|---|
| HUB-OUT-01 | `200 — body with 1 Loxone-MJPEG output → row written + reconcile called` | `src/routes/api/cameras/[id]/outputs/server.test.ts` |
| HUB-OUT-04 (D-CAP-02 hard cap) | `422 — projected total > 6 MJPEG → vaapi_hard_cap_exceeded with D-CAP-02 message` | `src/routes/api/cameras/[id]/outputs/server.test.ts` |
| L-26 (Frigate not counted) | `200 — Frigate-RTSP outputs do NOT count toward VAAPI cap` | `src/routes/api/cameras/[id]/outputs/server.test.ts` |
| D-CAP-01 (soft cap event) | `emits vaapi_soft_cap_warning event when projected total >= 4` + `does NOT emit … when projected < 4` | `src/routes/api/cameras/[id]/outputs/server.test.ts` |
| HUB-RCN-02 (reconcile trigger) | `200 — body with 1 Loxone-MJPEG output → row written + reconcile called` (asserts `reconcile(bridge.id, 'output_toggle')`) | `src/routes/api/cameras/[id]/outputs/server.test.ts` |
| HUB-RCN-03 (POST 202) | `returns 202 + { ok: true, reconcileId } when a running bridge exists` | `src/routes/api/protect-hub/reconcile/server.test.ts` |
| HUB-RCN-03 (POST 503) | `returns 503 with reason="no_running_bridge" when no bridge is in status=running` | `src/routes/api/protect-hub/reconcile/server.test.ts` |
| HUB-RCN-03 (GET 400) | `returns 400 when reconcileId query param is missing` | `src/routes/api/protect-hub/reconcile/server.test.ts` |
| HUB-RCN-03 (GET 404) | `returns 404 when no run row matches the supplied reconcileId` | `src/routes/api/protect-hub/reconcile/server.test.ts` |
| HUB-RCN-03 (GET 200) | `returns 200 + { ok: true, run } when the run row exists` | `src/routes/api/protect-hub/reconcile/server.test.ts` |
| Plan 05 Task 1 (API correlation) | `API-correlated id — externalReconcileId is used for the runs row when provided` | `src/lib/server/orchestration/protect-hub/reconcile.test.ts` |
| T-21-12 (enum gate) | `400 — unknown outputType → rejected before any DB write` | `src/routes/api/cameras/[id]/outputs/server.test.ts` |

## Mock-chain SELECT order (assumed by PUT /outputs tests)

Both `+server.ts` and `server.test.ts` document this order in their headers. Reordering on either side without updating the other will break test mocks silently.

| # | SELECT | Why |
|---|---|---|
| 1 | `db.select().from(cameras).where(eq(cameras.id, camId)).get()` | Camera lookup — 404 if missing, 400 if not external |
| 2 | `db.select({n: sql\`count(*)\`}).from(cameraOutputs).where(...).get()` | Cap check — count MJPEG outputs on OTHER cams |
| 3 | `db.select().from(protectHubBridges).where(eq(status, 'running')).limit(1).get()` | Bridge for reconcile fan-out |

Test default `beforeEach` chain: `mockReturnValueOnce(camRow).mockReturnValueOnce({n: 0}).mockReturnValueOnce(bridgeRow)`. Tests that exercise different paths (e.g. cap rejection, 404) override per-test.

## Decisions Made

- **POST /reconcile pre-mints the reconcileId** in the route handler (via `crypto.randomUUID()`), then passes it to `reconcile()` as `externalReconcileId`. The route returns 202+id BEFORE reconcile runs (D-API-01 non-blocking). Without the externalReconcileId extension, the client would have a different id from the audit row and the polling endpoint would 404 forever.

- **PUT /outputs returns 200 even when no running bridge exists.** Refusing the write would block users from configuring outputs while a bridge restart/provision is in flight. Persisted toggles are picked up by the next manual force-reconcile or the Plan-06 scheduler tick (5 min cadence).

- **VAAPI hard-cap message format is character-exact per D-CAP-02:** `Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: ${projectedTotal}.` — the prefix string is locked; the number is dynamic. Test asserts the full string for n=7 to verify both prefix and number formatting (no trailing whitespace, single trailing period).

- **Soft-cap event is emitted AFTER successful DB write** (not before). If the insert fails for any reason, the event is not emitted. Order is asserted in test via `mock.invocationCallOrder` so future refactors cannot regress this ordering accidentally.

- **TS cast for storeEvent input:** `EventType` and `EventSource` unions in `src/lib/types.ts:220-222` are closed over the legacy v1.0 names (`camera_disconnect | camera_reconnect | stream_failed | adoption_changed | aiport_error` and `protect_api | ssh_logs | app`). P21 introduces `vaapi_soft_cap_warning` + `source='protect_hub'` that the union doesn't list yet. Two options:
  1. Widen the union (modifies `src/lib/types.ts` — out of plan scope per Plan 03 Decisions)
  2. Cast through `as unknown as Omit<CameraEvent,'id'>` at the call site
  Chose Option 2 — same posture `reconcile.ts` took for its own new event types per Plan 03 Decisions ("Direct db.insert(events) for reconcile event emission … Extending the union would have required modifying src/lib/types.ts which is NOT in the plan's files_modified."). The `events` table columns are plain text — runtime works fine. P23 widens the union when it ships the reconcile-log + cap-warning UI.

- **Single-flight joiner case drops externalReconcileId:** if a caller supplies `externalReconcileId` while a reconcile is already in flight, the new caller joins the in-flight Promise — the in-flight reconcile keeps its OWN id, the externalReconcileId is dropped. Documented in `reconcile.ts` JSDoc. Trade-off: API correlation is best-effort, single-flight correctness is absolute (per L-13). Clients should retry on 404 from `/reconcile-runs?reconcileId=…` polling — the next reconcile pass will use their id.

## Manual UAT smoke tests

All 3 endpoints are reachable via curl from the dev machine to the VM at `192.168.3.249`:

```bash
# POST — force a reconcile, get a reconcileId back
curl -sX POST http://192.168.3.249/api/protect-hub/reconcile
# {"ok":true,"reconcileId":"<uuid>"}  (status 202)

# Poll status — repeat until status terminal (success | no_op | bridge_unreachable | error)
curl -s "http://192.168.3.249/api/protect-hub/reconcile-runs?reconcileId=<uuid>"
# {"ok":true,"run":{"reconcileId":"<uuid>","status":"running",...}}

# PUT outputs — toggle Loxone-MJPEG ON for cam id=1
curl -sX PUT -H 'content-type: application/json' \
  -d '{"outputs":[{"outputType":"loxone-mjpeg","enabled":true}]}' \
  http://192.168.3.249/api/cameras/1/outputs
# {"ok":true,"projectedMjpegCount":1}  (status 200; reconcile triggered in background)

# Hard-cap negative test — try to push to 7th MJPEG, expect German message
# (assumes 6 MJPEG outputs are already enabled across other cams)
curl -sX PUT -H 'content-type: application/json' \
  -d '{"outputs":[{"outputType":"loxone-mjpeg","enabled":true}]}' \
  http://192.168.3.249/api/cameras/9/outputs
# {"ok":false,"reason":"vaapi_hard_cap_exceeded","message":"Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: 7."}  (status 422)
```

The wave-3 merge to main makes these endpoints live at the next deploy. UAT can run against staging or the prod VM.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Generated `src/lib/version.ts` so `npm run check` could run**
- **Found during:** Pre-Task 1 environment setup (`npm install` in fresh worktree)
- **Issue:** Build-time generated file `src/lib/version.ts` is `.gitignore`d and missing in fresh worktree (same issue every prior plan in this phase hit; documented in 21-01 / 21-02 / 21-03 SUMMARYs).
- **Fix:** `npm run gen:version` (existing project script).
- **Files modified:** `src/lib/version.ts` (gitignored — not committed).
- **Commit:** N/A (artifact stays gitignored).

**2. [Rule 3 — Blocking] Created `data/` directory before any DB-touching code path**
- **Found during:** Pre-Task 1 environment setup
- **Issue:** Same as prior P21 plans — `data/` is gitignored and missing in fresh worktree.
- **Fix:** `mkdir -p data` (the project's `client.ts` does the same `mkdirSync('data')` at boot).
- **Files modified:** None committed.
- **Commit:** N/A.

---

**Total deviations:** 2 — both Rule 3 environment setup, identical to every prior P21 plan executor. Zero deviations from plan content (all 3 routes shipped exactly as spec'd; D-CAP-02 wording verbatim; VAAPI cap arithmetic exactly per L-26).

## Out-of-Scope Discoveries (logged to deferred-items.md, NOT auto-fixed)

- Same 12 pre-existing test failures observed on the wave-3 base (commit `2263417`). Already documented in `deferred-items.md` under "Plan 21-02 worktree observations" + "Plan 21-04 worktree observations". Reproduced on the wave-3 base before any 21-05 commit. No regression introduced by Plan 05.

## Verification

- `npx vitest --run src/lib/server/orchestration/protect-hub/reconcile.test.ts` → **16/16 pass** (15 from Plan 03 + 1 new externalReconcileId test)
- `npx vitest --run src/routes/api/protect-hub/reconcile/server.test.ts` → **5/5 pass** (replaces Wave-0 stub)
- `npx vitest --run "src/routes/api/cameras/[id]/outputs/server.test.ts"` → **10/10 pass** (replaces Wave-0 stub)
- `npx vitest --run` (full suite) → **339 pass / 12 fail / 4 skipped** — failures are exactly the 12 pre-existing in deferred-items.md; no regressions
- `npm run check` → **0 errors**, 30 warnings (all pre-existing in unrelated `.svelte` files)

## Threat Model Compliance

| Threat ID | Mitigation Implemented | Test Coverage |
|---|---|---|
| T-21-04 (EoP — no app-level auth) | Accept disposition per L-23 LAN-trust posture; matches existing `discover/+server.ts` and `bridge/{start,stop,restart}` precedent | implicit (auth handled by global hooks.server.ts; no new public paths) |
| T-21-12 (Tampering — output type enum bypass) | `ALLOWED_OUTPUT_TYPES` Set checked BEFORE any DB write; unknown values return 400 | `400 — unknown outputType → rejected before any DB write` |
| T-21-02 (DoS — flood of POST/PUT) | Single-flight in `reconcile.ts` (Plan 03) absorbs N parallel triggers as 1 reconcile + 1 follow-up; PUT bounded by enum-size DB write cost | implicit (verified in reconcile.test.ts single-flight + dirty-flag tests from Plan 03) |
| T-21-13 (Info disclosure — error column) | Accept disposition; LAN-trust; same posture as `update_runs` GET endpoint from P24 | implicit (error column never includes credentials per T-21-10 from Plan 03) |

## Next Plan Readiness

- **P22 (Protect Hub UI)** can call `PUT /api/cameras/[id]/outputs` from output-toggle UI; the endpoint returns `projectedMjpegCount` for the soft-cap badge ("X von 6 aktiv"). Hard-cap 422 carries the German message ready for direct toast display.
- **P22 reconcile-log surface** consumes `GET /api/protect-hub/reconcile-runs?reconcileId=…` for spinner-until-terminal polling. The "last 50 runs" feed is P22's add (this plan only ships by-id GET per scope).
- **Plan 06 (scheduler + update-checker)** can keep calling `reconcile(bridge.id, 'tick')` with 2 args — the externalReconcileId 3rd param is purely additive and backwards-compatible (default = `randomUUID()`).
- **No new schema migrations needed** — all DB writes use the schema shipped by Plan 01.
- **No new public types exported** for downstream — the `reconcile()` 3rd param signature change is the only public-surface delta; existing callers compile unchanged.

## Self-Check: PASSED

- `src/routes/api/protect-hub/reconcile/+server.ts` — created (commit `e867383` ✓)
- `src/routes/api/protect-hub/reconcile-runs/+server.ts` — created (commit `e867383` ✓)
- `src/routes/api/cameras/[id]/outputs/+server.ts` — created (commit `e9122fc` ✓)
- `src/lib/server/orchestration/protect-hub/reconcile.ts` — modified (commit `1d43917` ✓)
- `src/lib/server/orchestration/protect-hub/reconcile.test.ts` — modified (commit `1d43917` ✓)
- `src/routes/api/protect-hub/reconcile/server.test.ts` — modified (commit `e867383` ✓)
- `src/routes/api/cameras/[id]/outputs/server.test.ts` — modified (commit `e9122fc` ✓)
- D-CAP-02 EXACT German prefix verified in test (`Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: 7.`) ✓
- 16 reconcile.test + 5 reconcile/server.test + 10 outputs/server.test = 31/31 vitest assertions pass ✓
- 0 errors from `npm run check` ✓
- No regressions in full-suite test run (only the 12 pre-existing deferred failures remain) ✓
- reconcile.ts signature accepts optional externalReconcileId — verified by RED→GREEN cycle on the new "API-correlated id" test ✓
- ws-manager.ts and (future) scheduler.ts callers unmodified — backwards-compatible by construction (3rd param optional) ✓

---

*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Plan: 05 — Force-reconcile + outputs API surface*
*Completed: 2026-05-06*
