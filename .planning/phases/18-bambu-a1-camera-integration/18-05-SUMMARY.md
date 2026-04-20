---
phase: 18-bambu-a1-camera-integration
plan: 05
subsystem: infra
tags: [mqtt, bambu, a1, tutk, cloud-mode, edge-trigger, vitest, tdd]

# Dependency graph
requires:
  - phase: 17-bambu-lan-integration
    provides: "bambu-mqtt.ts subscriber + BambuConnectionError enum"
  - plan: 18-01
    provides: "schema + BAMBU-A1-06 requirement groundwork"
provides:
  - "BambuConnectionError extended with 'A1_CLOUD_MODE_ACTIVE' variant"
  - "Pure testable handler `handleMqttMessage(sub, payload)` exported from bambu-mqtt.ts"
  - "Narrow public type `SubscriberLike` for unit testing without DB/MQTT setup"
  - "Edge-triggered TUTK cloud-mode runtime watch wired to sub.lastError"
  - "Conditional lastError reset that preserves printer-state errors across messages"
  - "10 Vitest cases covering edge-trigger, auto-clear, conditional reset, no-op semantics"
affects: [18-06, 18-07, future Bambu dashboard UI work, P1P analog if TUTK present]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Edge-triggered event semantics for state fields (disable → enable transition only)"
    - "Conditional reset guard so printer-state errors persist across message arrival"
    - "Exported pure handler + narrow interface pattern for MQTT unit testing"

key-files:
  created:
    - src/lib/server/services/bambu-mqtt.test.ts
  modified:
    - src/lib/server/services/bambu-mqtt.ts
    - .planning/phases/18-bambu-a1-camera-integration/deferred-items.md

key-decisions:
  - "Extract inline MQTT message handler into exported `handleMqttMessage` pure function (Plan option 1 — preferred over mocking `mqtt.connect`)"
  - "Introduce narrow `SubscriberLike` interface — unit tests don't need full Subscriber (client, reconnectAttempts, serial, lastGroup)"
  - "Cast `SubscriberLike → Subscriber` when invoking `handleStateChange` because live callers always supply full Subscriber; unit tests never hit the gcode branch (no gcode_state in fixtures)"
  - "Log on edge transitions only — steady-state repeat of 'enable' produces no log (prevents DoS spam per threat T-18-22)"
  - "Log lines carry only cameraId + status label — never access code or any secret (threat T-18-21)"

patterns-established:
  - "Pure handler export (`handleMqttMessage`) + narrow subscriber interface (`SubscriberLike`) = unit-testable MQTT logic without mocking the client"
  - "Edge-trigger guard: `if (value === 'enable' && state !== targetFlag)` — sets only on transition"
  - "Conditional-reset guard: `if (state && state !== persistentFlag) state = null` — transient errors auto-clear, printer-state errors persist"

requirements-completed: [BAMBU-A1-06]

# Metrics
duration: 18min
completed: 2026-04-20
---

# Phase 18 Plan 05: TUTK Cloud-Mode Runtime Watch Summary

**MQTT message handler extended with edge-triggered `ipcam.tutk_server` watch; dashboard now surfaces A1 cloud-mode as first-class `A1_CLOUD_MODE_ACTIVE` error via existing `getBambuState()` accessor — no silent stream-dead failures.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-20T17:32Z
- **Completed:** 2026-04-20T17:36Z
- **Tasks:** 1 (TDD — RED + GREEN commits)
- **Files modified:** 3 (2 source + 1 deferred-items appendix)

## Accomplishments

- Extended `BambuConnectionError` union from 4 to 5 variants (adds `A1_CLOUD_MODE_ACTIVE`)
- Extracted the inline `client.on('message', ...)` callback into an exported pure function `handleMqttMessage(sub, payload)` — zero DB/MQTT dependency, fully unit-testable
- Added edge-triggered runtime watch of `print.ipcam.tutk_server` (reads once per inbound message)
- Replaced unconditional `sub.lastError = null` reset with a conditional guard that preserves `A1_CLOUD_MODE_ACTIVE` across non-ipcam deltas
- 10 new Vitest cases — all 4 critical edge-trigger behaviors plus 6 adjacent safety cases (malformed JSON, liveness update, non-A1 error auto-clear, undefined field, ipcam-without-tutk delta)
- No regressions in existing Bambu test suites (bambu-mqtt, bambu-preflight, bambu-a1-auth, bambu-discovery, bambu-credentials) — 38/38 green; `tsc --noEmit` clean

## Task Commits

Atomic TDD commits for Task 1 (RED → GREEN; no REFACTOR needed):

1. **RED — failing tests** — `b04a104` (test)
2. **GREEN — implementation** — `585fc8a` (feat)

_(No REFACTOR commit — GREEN implementation is already minimal and idiomatic.)_

## Handler Diff Summary

### Before (bambu-mqtt.ts:104-117, inline in attachHandlers)

```typescript
client.on('message', (_topic, payload) => {
    sub.lastMessageAt = Date.now();
    sub.lastError = null;              // UNCONDITIONAL clear — clobbers A1 flag
    let msg: any;
    try { msg = JSON.parse(payload.toString()); } catch { return; }
    const gcodeState = msg?.print?.gcode_state;
    if (typeof gcodeState === 'string' && gcodeState) {
        void handleStateChange(sub, gcodeState);
    }
});
```

### After (bambu-mqtt.ts, extracted `handleMqttMessage` + thin `client.on` adapter)

```typescript
export function handleMqttMessage(sub: SubscriberLike, payload: Buffer | string): void {
    sub.lastMessageAt = Date.now();
    // Conditional clear — preserve printer-state errors (TUTK) across message arrival;
    // only transient connection errors auto-clear on successful message.
    if (sub.lastError && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') {
        sub.lastError = null;
    }
    let msg: any;
    try {
        msg = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
    } catch { return; }

    const gcodeState = msg?.print?.gcode_state;
    if (typeof gcodeState === 'string' && gcodeState) {
        void handleStateChange(sub as Subscriber, gcodeState);
    }

    // NEW (Phase 18 / D-06 / BAMBU-A1-06): TUTK cloud-mode runtime watch.
    const tutkServer = msg?.print?.ipcam?.tutk_server;
    if (typeof tutkServer === 'string') {
        if (tutkServer === 'enable' && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') {
            sub.lastError = 'A1_CLOUD_MODE_ACTIVE';
            console.log(`[bambu-mqtt] cam=${sub.cameraId} tutk_server=enable → CLOUD_MODE_ACTIVE`);
        } else if (tutkServer === 'disable' && sub.lastError === 'A1_CLOUD_MODE_ACTIVE') {
            sub.lastError = null;
            console.log(`[bambu-mqtt] cam=${sub.cameraId} tutk_server=disable → cleared`);
        }
    }
}

// client.on adapter (unchanged behaviour; just delegates)
client.on('message', (_topic, payload) => {
    handleMqttMessage(sub, payload);
});
```

## Test Matrix

10 Vitest cases covering the four must-have behaviors plus adjacent safety cases:

| # | Test name                                                                                    | Initial lastError     | Payload                                             | Expected lastError    | Must-have |
|---|----------------------------------------------------------------------------------------------|-----------------------|------------------------------------------------------|-----------------------|-----------|
| 1 | sets A1_CLOUD_MODE_ACTIVE when tutk_server transitions to enable                            | `null`                | `{ipcam:{tutk_server:'enable'}}`                    | `A1_CLOUD_MODE_ACTIVE`| EDGE-UP   |
| 2 | clears A1_CLOUD_MODE_ACTIVE when tutk_server transitions to disable                         | `A1_CLOUD_MODE_ACTIVE`| `{ipcam:{tutk_server:'disable'}}`                   | `null`                | EDGE-DOWN |
| 3 | preserves A1_CLOUD_MODE_ACTIVE across messages that do NOT carry tutk_server                | `A1_CLOUD_MODE_ACTIVE`| `{mc_percent:42}` (no ipcam at all)                 | `A1_CLOUD_MODE_ACTIVE`| COND-RST  |
| 4 | preserves A1_CLOUD_MODE_ACTIVE when ipcam delta lacks tutk_server field                     | `A1_CLOUD_MODE_ACTIVE`| `{ipcam:{ipcam_record:'enable'}}` (ipcam, no tutk)  | `A1_CLOUD_MODE_ACTIVE`| NO-OP     |
| 5 | clears transient connection errors on any message (existing behaviour preserved)            | `WRONG_ACCESS_CODE`   | `{mc_percent:0}`                                    | `null`                | —         |
| 6 | does not log re-fire when already in A1_CLOUD_MODE_ACTIVE (edge-trigger)                    | `A1_CLOUD_MODE_ACTIVE`| `{ipcam:{tutk_server:'enable'}}`                    | `A1_CLOUD_MODE_ACTIVE`+ no `console.log` | EDGE-GUARD |
| 7 | does not alter lastError when payload is malformed JSON                                     | `A1_CLOUD_MODE_ACTIVE`| `"not-valid-json{"` (string)                        | `A1_CLOUD_MODE_ACTIVE`| —         |
| 8 | updates lastMessageAt on every message (liveness tracking)                                  | `null`                | `{}`                                                | n/a (checks `lastMessageAt >= before`) | — |
| 9 | first-seen-as-enable (lastError === null) still transitions to A1_CLOUD_MODE_ACTIVE         | `null`                | `{ipcam:{tutk_server:'enable'}}`                    | `A1_CLOUD_MODE_ACTIVE`| EDGE-UP (first-seen) |
|10 | disable branch does not clobber non-A1 error (WRONG_ACCESS_CODE → null via cond-reset path) | `WRONG_ACCESS_CODE`   | `{ipcam:{tutk_server:'disable'}}`                   | `null`                | COND-RST  |

Legend — must-have mapping to the four critical behaviors from `<parallel_execution>`:
- **EDGE-UP:** `disable → enable` transition sets lastError (tests 1, 9)
- **EDGE-DOWN:** `enable → disable` clears lastError ONLY when current is A1 (test 2)
- **COND-RST:** `lastError = null` reset is skipped when current is A1; transient errors still clear (tests 3, 10)
- **NO-OP:** Delta without `ipcam.tutk_server` does not toggle (tests 3, 4)
- **EDGE-GUARD:** Steady-state repeat of 'enable' is silent — no log spam (test 6, threat T-18-22)

## Files Created/Modified

- `src/lib/server/services/bambu-mqtt.ts` — extended `BambuConnectionError` enum; added `SubscriberLike` public type; extracted and exported `handleMqttMessage` pure function; `client.on('message', ...)` now a thin delegating adapter.
- `src/lib/server/services/bambu-mqtt.test.ts` — **new file.** 10 Vitest cases; mocks `$env/dynamic/private`, `$lib/server/db/schema`, `$lib/server/db/client`, `./ssh`, `./crypto` to avoid the module-load SQLite side effect (`ensureColumn('cameras', ...)`) that prevents importing the service in unit tests.
- `.planning/phases/18-bambu-a1-camera-integration/deferred-items.md` — appended Plan 18-05 re-verification note confirming pre-existing failures in proxmox/backup/update-runner/onboarding/proxmox-validate reproduce at base commit and are unrelated to this plan.

## Decisions Made

- **Option 1 (extract + export pure handler) over Option 2 (mock `mqtt.connect`):** Plan gave both options; option 1 is less invasive — no mqtt-client plumbing in tests, easier to reason about, smaller surface. The `client.on('message', ...)` callback becomes a one-line delegator. Existing integration behavior is unchanged.
- **`SubscriberLike` narrow interface:** Tests don't need `client`, `serial`, `lastGroup`, `reconnectAttempts`. A narrow contract reduces the chance tests accidentally depend on connection-lifecycle fields. The `as Subscriber` cast inside `handleMqttMessage` (for the gcode branch) is safe because live callers always supply the full type; unit tests never exercise that branch (no `gcode_state` in fixtures).
- **No REFACTOR commit:** GREEN implementation is already minimal. Only change from plan's suggested shape is the `Buffer | string` payload type (so tests can pass `Buffer.from(...)` or a raw string for malformed JSON case) — idiomatic TypeScript, not refactor-worthy.
- **One extra log test (case 6) beyond the 4 plan must-haves:** threat T-18-22 (DoS via flooded MQTT) is explicitly listed in the plan's threat register as `mitigate` via edge-trigger log-guard. Asserting `logSpy).not.toHaveBeenCalled()` on the re-fire case locks in the mitigation so future refactors can't silently regress to level-triggered logging.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written; all deviations were forecast by the plan's Option 1/2 split and chosen at execution time per the plan's "pick whichever is less invasive" guidance.

### Scope Boundary Observations (out-of-scope, logged only)

Pre-existing test failures in `proxmox.test.ts`, `backup.test.ts`, `update-runner.test.ts`, `proxmox-validate.test.ts`, `onboarding.test.ts` reproduce at the worktree base commit (4494099) without any Plan 18-05 change. Logged to `deferred-items.md` per SCOPE BOUNDARY rule. Net regression from Plan 18-05: **zero** — the plan's changes only add green tests and improve the `bambu-mqtt.test.ts` suite (previously the suite failed at module-load; now 10 tests pass).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Clean execution; plan shape matched implementation byte-for-byte on the two core edits (enum + handler logic). Option 1 (extract-helper) chosen per plan guidance.

## Issues Encountered

**Module-load SQLite side effect blocking unit tests.**
`bambu-mqtt.ts` imports `$lib/server/db/client`, which at module load calls `ensureColumn('cameras', ...)`. In the test environment the `cameras` table does not exist, so `better-sqlite3` throws `SqliteError: no such table: cameras` before any test runs — the suite fails at import. Resolved by adding Vitest module mocks for `$env/dynamic/private`, `$lib/server/db/schema`, `$lib/server/db/client`, `./ssh`, and `./crypto` at the top of the test file (pattern borrowed from `onboarding.test.ts`). Pure `handleMqttMessage` never touches the DB, so the stub `db` object only needs to exist; no state required.

## Known Stubs

None. The handler wires `sub.lastError` through the existing `getBambuState()` accessor (`bambu-mqtt.ts:220-246`) with no API surface change — downstream dashboard consumers see the new `A1_CLOUD_MODE_ACTIVE` value on the existing `error` field. No placeholder or mocked data flows to UI. UI copy change for the new error code is scoped to Plan 18-06 (per plan `<output>` note).

## TDD Gate Compliance

- **RED gate:** `b04a104` — `test(18-05): add failing tests for TUTK runtime watch (RED)`. All 10 tests fail with `handleMqttMessage is not a function` (verified before GREEN commit).
- **GREEN gate:** `585fc8a` — `feat(18-05): TUTK cloud-mode runtime watch on MQTT message handler`. All 10 tests pass.
- **REFACTOR gate:** skipped — GREEN implementation is already minimal; no cleanup needed.

TDD cycle: RED → GREEN, no unexpected green in RED phase (fail-fast rule satisfied).

## Security / Threat Flags

Plan threat register (T-18-19 through T-18-22) fully mitigated:
- **T-18-19 (Input validation):** `typeof tutkServer === 'string'` guard + two literal comparisons. Unknown values are no-op.
- **T-18-20 (LAN tampering):** accepted per plan (LAN trust boundary); no change.
- **T-18-21 (Info disclosure in logs):** Log format is `cam=${sub.cameraId} tutk_server=...` only. Confirmed via `! grep -q "console.log.*accessCode" src/lib/server/services/bambu-mqtt.ts`.
- **T-18-22 (Log-flood DoS):** Edge-trigger guard in both transition branches. Locked in by test case 6.

No new threat surface introduced beyond what the plan's threat model covers.

## Next Phase Readiness

- `sub.lastError = 'A1_CLOUD_MODE_ACTIVE'` already surfaces via `getBambuState()` → `{error}` response payload on `/api/cameras/:id/bambu-state` (no route change required — Plan 18-06 consumes this directly for UI badge copy).
- The `handleMqttMessage` pure function is available as a reusable testing seam for future MQTT event additions (e.g., P1P TUTK analog if discovered, or additional `ipcam.*` fields).
- `SubscriberLike` narrow type is a reusable pattern for any future MQTT helper that needs DB-independent testing.

**No blockers for Plan 18-06 (UI badge copy + dashboard wiring).** The existing `error` field on `getBambuState()` carries the new enum variant with zero API-shape change.

## Self-Check: PASSED

Verified post-write:

- `src/lib/server/services/bambu-mqtt.ts` — FOUND (modified, compiles clean)
- `src/lib/server/services/bambu-mqtt.test.ts` — FOUND (new, 10 tests green)
- `.planning/phases/18-bambu-a1-camera-integration/deferred-items.md` — FOUND (appended Plan 18-05 note)
- Commit `b04a104` — FOUND in git log
- Commit `585fc8a` — FOUND in git log
- `grep -q "'A1_CLOUD_MODE_ACTIVE'" src/lib/server/services/bambu-mqtt.ts` → PASS
- `grep -q "tutk_server" src/lib/server/services/bambu-mqtt.ts` → PASS
- `grep -q "sub.lastError !== 'A1_CLOUD_MODE_ACTIVE'" src/lib/server/services/bambu-mqtt.ts` → PASS
- `! grep -q "console.log.*accessCode" src/lib/server/services/bambu-mqtt.ts` → PASS (no access-code logging)
- `npm run test:unit -- --run src/lib/server/services/bambu-mqtt.test.ts` → 10/10 green
- `npx tsc --noEmit` → exit 0

---
*Phase: 18-bambu-a1-camera-integration*
*Completed: 2026-04-20*
