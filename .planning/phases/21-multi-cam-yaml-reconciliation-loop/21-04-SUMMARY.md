---
phase: 21-multi-cam-yaml-reconciliation-loop
plan: 04
status: complete
subsystem: orchestration

tags: [websocket, reconnect, exp-backoff, single-flight, fake-timers, vitest, unifi-protect, protect-hub]

requires:
  - phase: 19-protect-hub-schema-lock
    provides: protect_hub_bridges table (selectGet target for bridge.id)
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 01
    provides: ws-manager.test.ts stub (Wave-0) — replaced in this plan
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 03
    provides: reconcile() function — imported one-way (Plan 03 ships in parallel; merge deferred)
provides:
  - startWs() / stopWs() singleton lifecycle (Pattern S-6)
  - BACKOFF_SCHEDULE_MS exported readonly tuple [5,10,30,60,120,300]s
  - On-success force-reconcile fan-out via reconcile(bridgeId, 'ws_reconnect')
  - 9 fake-timer tests locking the backoff cadence + single-flight + cap behaviour
affects: [21-06]  # scheduler.ts wires startWs/stopWs into boot path

tech-stack:
  added: []
  patterns:
    - "WebSocket reconnect singleton: module-scoped state, idempotent start/stop, single-flight _reconnectingPromise, cancellable _reconnectTimer"
    - "Fake-timer test recipe: vi.resetModules() per test + vi.advanceTimersByTimeAsync to flush async connectAndListen continuations"

key-files:
  created:
    - src/lib/server/orchestration/protect-hub/ws-manager.ts
  modified:
    - src/lib/server/orchestration/protect-hub/ws-manager.test.ts
    - .planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md

key-decisions:
  - "(err: unknown) on inner .catch() — explicit type so svelte-check stays clean while reconcile.ts is being authored in parallel"
  - "vi.resetModules() inside beforeEach — required because module-scoped _attempt/_reconnectTimer leak between tests otherwise"
  - "Single afterEach stopWs() — best-effort cleanup; idempotent stopWs without prior startWs is also tested explicitly"
  - "Defer cyclic-import grep to wave-2 merge — reconcile.ts arrives from parallel Plan 21-03; design intent locked in PATTERNS.md and ws-manager.ts header"

requirements-completed:
  - HUB-RCN-07

duration: ~22min
completed: 2026-05-06
---

# Phase 21 Plan 04: ws-manager (WebSocket Reconnect Singleton) Summary

**Module-scoped singleton wrapping unifi-protect@4.29.0's NON-auto-reconnecting client with exponential backoff [5,10,30,60,120,300]s, single-flight reconnect, and a one-shot reconcile-on-(re)connect to refresh rotated share-livestream tokens — closes HUB-RCN-07.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-05-06T07:54Z
- **Completed:** 2026-05-06T08:16Z
- **Tasks:** 2 atomic commits + 1 fixup + 1 docs commit
- **Files created:** 1 (ws-manager.ts, 143 lines)
- **Files modified:** 1 (ws-manager.test.ts, +242/-14 lines = 261 lines total) + deferred-items.md
- **Tests:** 9 passing (HUB-RCN-07 fully covered)

## Accomplishments

1. **`ws-manager.ts` (143 lines)** — singleton service exporting `startWs()`, `stopWs()`, `BACKOFF_SCHEDULE_MS`. Tracks `_attempt`, `_reconnectingPromise` (single-flight gate), `_reconnectTimer` (cancellable handle), `_stopped`, `_started`. On every successful (re)connect, looks up the bridge row from `protect_hub_bridges` and fires `void reconcile(bridge.id, 'ws_reconnect')` exactly once. On `stopWs()`, clears the in-flight setTimeout, nulls all state, and calls `resetProtectClient()` so the next `startWs()` performs a fresh login.

2. **`ws-manager.test.ts` (261 lines, 9 tests)** — replaces the Wave-0 4-test `it.skip` stub with a real fake-timer suite:
   - **BACKOFF_SCHEDULE_MS regression guard** — locks the tuple `[5_000, 10_000, 30_000, 60_000, 120_000, 300_000]` against accidental edits.
   - **+5000ms boundary** — at +4999ms no second attempt; at +5000ms exactly the second attempt fires.
   - **Full cadence** — 6 sequential failures stepped through `[5,10,30,60,120,300]`s with `getBootstrap` call-count assertions per step.
   - **Cap clamp** — 7th failure also waits 300_000ms (boundary asserted 299_999ms / +1ms).
   - **Single-flight** — two back-to-back `login(false)` events produce exactly ONE timer (`vi.getTimerCount() === 1`) and ONE replay attempt.
   - **Reconcile-on-success exactly once** — `mockReconcile` called with `(1, 'ws_reconnect')` after a fail-then-succeed sequence.
   - **`_attempt` reset semantics** — after 3 failures + 1 success, the next disconnect uses delay `[0]=5_000` (NOT `[3]=60_000`), proving the counter reset.
   - **`stopWs` cancels in-flight backoff** — `vi.getTimerCount()` drops to 0 immediately; subsequent timer advance does NOT call `getBootstrap` again. `mockResetProtectClient` called once.
   - **`stopWs` without prior `startWs`** — does not throw; `resetProtectClient` still called.

3. **`deferred-items.md`** — appended Plan-21-04 observations: same 12 pre-existing failing tests confirmed unchanged on this worktree's base; the `./reconcile` typecheck error is by design (parallel Plan 21-03 ships that module); cyclic-import grep deferred to merge.

## Task Commits

| Task | Hash | Type | Description |
|------|------|------|-------------|
| 1 | `2500b66` | feat | ws-manager singleton + exp backoff + reconcile-on-reconnect (143 lines) |
| 2 | `05eb598` | test | replace stubs with 9 fake-timer tests for HUB-RCN-07 |
| Fixup | `b1f13a2` | fix | type catch param explicitly (svelte-check implicit-any) |
| Docs | `8ce0627` | docs | log deferred items |

## Files Created/Modified

### Created
- `src/lib/server/orchestration/protect-hub/ws-manager.ts` — 143 lines, ≥ 80 line target satisfied

### Modified
- `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` — Wave-0 stub (33 lines) → full suite (261 lines)
- `.planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md` — appended Plan-21-04 observations

## Decisions Made

- **Explicit `(err: unknown)` on the inner `.catch()`** — svelte-check (TS strict) flagged implicit-any because `reconcile.ts` is not yet on disk in this worktree (parallel Plan 21-03). Project convention is `unknown` for catch params; mirrors the surrounding `connectAndListen` outer catch.
- **`vi.resetModules()` inside `beforeEach`** — without this, module-scoped state (`_attempt`, `_reconnectTimer`, `_started`) leaks across tests and produces flaky failures (e.g., a previous test's pending timer interferes with `getTimerCount` assertions). This is the standard recipe for testing Pattern S-6 modules.
- **`afterEach { stopWs(); vi.useRealTimers(); vi.restoreAllMocks(); }`** — defensive cleanup. `stopWs()` is idempotent so calling it without a prior `startWs` is safe (and explicitly tested).
- **One initial+six-retry assertion strategy** — instead of asserting `setTimeout` was called with specific delays (which is fragile against vitest internals), we step through `vi.advanceTimersByTimeAsync(delay)` and assert `getBootstrap` call counts. This locks the schedule from the OUTSIDE rather than via internal mock spying.

## Lib Behavioural Confirmation

- **`client.on('login', false)` semantics matched the assumption.** Per RESEARCH §Standard Stack and the unifi-protect@4.29.0 source citation, the lib emits `login` (boolean success) on each (re)login attempt. The test "single-flight — concurrent disconnect + login(false) coalesce into one timer" exercises exactly this contract via `client.__emit('login', false)` and observes the expected `scheduleReconnect` invocation. No deviation.
- **NO auto-reconnect inside the lib confirmed by behaviour.** Tests only ever observe additional `getBootstrap` calls when this module's `scheduleReconnect` fires, never spuriously — consistent with the lib nullifying `_eventsWs` without retry.

## Cyclic-Import Verification (Deferred)

The plan calls for: `grep -L "ws-manager" src/lib/server/orchestration/protect-hub/reconcile.ts`

Outcome: `reconcile.ts` does not exist in this worktree (parallel Plan 21-03 owns it). Verification deferred to wave-2 merge. Design intent locked in:
- File header comment in `ws-manager.ts` (lines 18-21) explicitly forbids `reconcile.ts → ws-manager` import.
- PATTERNS.md §ws-manager.ts records the one-way invariant.
- 21-04-PLAN.md success criteria item: "No cyclic import (reconcile does NOT import ws-manager)".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] svelte-check implicit-any on inner .catch param**
- **Found during:** Task 2 verification (`npm run check`)
- **Issue:** `void reconcile(bridge.id, 'ws_reconnect').catch((err) => ...)` — TS could not infer `err` because `reconcile`'s return-type is unresolvable while reconcile.ts is being authored in parallel. svelte-check reported `Parameter 'err' implicitly has an 'any' type.`
- **Fix:** Explicit `(err: unknown)` (matches the surrounding outer catch and project convention).
- **Files modified:** `src/lib/server/orchestration/protect-hub/ws-manager.ts:108`
- **Commit:** `b1f13a2`

**2. [Rule 3 - Blocking] Missing `src/lib/version.ts` blocked `npm run check`**
- **Found during:** First `npm run check` invocation
- **Issue:** Generated artifact (gitignored); fresh worktree had not run `npm run gen:version` yet.
- **Fix:** `npm run gen:version` (project-defined script).
- **Files modified:** `src/lib/version.ts` (gitignored — not committed).
- **Commit:** N/A (artifact not source-controlled).

**3. [Documentation] Logged the parallel-coordination typecheck error and pre-existing test cohort to deferred-items.md** — not a code change but enforces the SCOPE BOUNDARY rule. Commit: `8ce0627`.

## Test Coverage Map

| Requirement | Test name | Asserts |
|-------------|-----------|---------|
| HUB-RCN-07 (cadence) | "1st failure → next attempt at +5000ms" | first delay boundary |
| HUB-RCN-07 (full schedule) | "backoff cadence — 1→5s, 2→10s, 3→30s, 4→60s, 5→120s, 6→300s" | every entry of BACKOFF_SCHEDULE_MS |
| HUB-RCN-07 (cap) | "cap — 7th failure still uses 300_000ms" | clamp at last index |
| HUB-RCN-07 (single-flight) | "single-flight — concurrent disconnect + login(false) coalesce into one timer" | only one setTimeout in flight |
| HUB-RCN-07 (force-reconcile) | "on success — _attempt resets AND reconcile(bridgeId, ws_reconnect) called exactly once" | reconcile fan-out semantics |
| HUB-RCN-07 (reset) | "on success after multiple failures — _attempt counter resets to 0" | _attempt = 0 invariant |
| HUB-RCN-07 (stop) | "stopWs — cancels in-flight backoff" | timer cancel + resetProtectClient |
| HUB-RCN-07 (stop idempotent) | "stopWs — without prior startWs — still calls resetProtectClient" | idempotency |
| Schedule lock | "BACKOFF_SCHEDULE_MS regression guard" | tuple equality |

## Issues Encountered

- **Pre-existing test failures** (5 files / 12 tests in `services/{backup,proxmox,proxmox-validate,onboarding,version}.test.ts`) — confirmed unchanged on the 21-04 base commit (`38bcd0e`). Out of scope per SCOPE BOUNDARY rule. Logged in deferred-items.md.
- **`./reconcile` missing module** (svelte-check error) — by design; resolves at wave-2 merge.

## Next Plan Readiness

- **Plan 21-06 (scheduler boot wiring) unblocked.** scheduler.ts can now `import { startWs, stopWs } from '../orchestration/protect-hub/ws-manager';` and add the bootstrap call. Module is ready.
- **Plan 21-03 (reconcile.ts) unaffected.** Plans 21-03 and 21-04 share zero source files; their integration point is the import-only edge `ws-manager → reconcile`, which is the plan's documented direction.
- **No blockers identified.** Wave-2 merge will resolve the `./reconcile` typecheck error and enable the cyclic-import grep verification.

## Self-Check: PASSED

- `src/lib/server/orchestration/protect-hub/ws-manager.ts` — created (commit `2500b66` + fix `b1f13a2`)
- `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` — modified (commit `05eb598`)
- `.planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md` — modified (commit `8ce0627`)
- `npx vitest run ws-manager.test.ts` — 9 passing, 0 failing
- `npm run check` — only the expected `./reconcile` missing-module error remains (parallel-design)
- BACKOFF_SCHEDULE_MS regression guard test in place ✓
- Single-flight invariant tested via vi.getTimerCount() ✓
- HUB-RCN-07 fully covered ✓

---
*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Plan: 04 — ws-manager WebSocket reconnect singleton*
*Completed: 2026-05-06*
