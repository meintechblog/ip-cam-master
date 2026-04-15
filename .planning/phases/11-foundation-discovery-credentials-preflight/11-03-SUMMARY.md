---
phase: 11-foundation-discovery-credentials-preflight
plan: 03
subsystem: onboarding-preflight
tags: [bambu, preflight, mqtt, rtsps, error-taxonomy]
requires: [11-01]
provides:
  - runBambuPreflight
  - realDeps
  - POST /api/onboarding/bambu/preflight
  - PREFLIGHT_HINTS_DE
affects: []
tech-stack:
  added: [mqtt@5.15.1]
  patterns: [dep-injected orchestrator, sequential checks with hard timeouts]
key-files:
  created:
    - src/lib/server/services/bambu-preflight.ts
    - src/lib/server/services/bambu-preflight.test.ts
    - src/routes/api/onboarding/bambu/preflight/+server.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - Sequential (never parallel) checks per H2C single-connection limit
  - ffprobe wrapped in external SIGKILL timer (not relying on -timeout flag semantics)
  - mqtt@5 with rejectUnauthorized:false + reconnectPeriod:0 — no mosquitto_sub anywhere
metrics:
  duration: ~15min
  completed: 2026-04-15
---

# Phase 11 Plan 03: Bambu Pre-flight Handler Summary

**One-liner:** Sequential TCP→RTSPS→MQTT pre-flight with four-code error taxonomy (PRINTER_UNREACHABLE / LAN_MODE_OFF / WRONG_ACCESS_CODE / RTSPS_HANDSHAKE_HUNG) and dep-injected check functions for hermetic tests.

## What Shipped

- `src/lib/server/services/bambu-preflight.ts` — exports `runBambuPreflight`, `realDeps`, `PREFLIGHT_HINTS_DE`, types. Orchestrator runs checks sequentially and short-circuits on first failure.
- `src/lib/server/services/bambu-preflight.test.ts` — 8 Vitest tests (all 4 error codes × primary trigger + ok path + short-circuit verification + hints coverage).
- `src/routes/api/onboarding/bambu/preflight/+server.ts` — thin POST wrapper; 400 on missing fields, 500 on unexpected exception, 200 with `PreflightResult` otherwise.
- `mqtt@5.15.1` added (only new Phase 11 dep, per 11-CONTEXT §3).

## Verification Results

```
$ npx vitest run src/lib/server/services/bambu-preflight.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

```
$ npm run check
COMPLETED 4571 FILES 0 ERRORS 19 WARNINGS  (all warnings pre-existing, unrelated)
```

```
$ node -e "require('mqtt')"
require ok

$ grep -r mosquitto src/ | wc -l
1   # only the "do NOT shell out to mosquitto_sub" comment in bambu-preflight.ts
```

`mqtt` version confirmed via `node -e "console.log(require('mqtt/package.json').version)"` → **5.15.1**.

## Ground-Truth Citations

- RTSPS URL template `rtsps://bblp:<code>@<ip>:322/streaming/live/1` + flags `-rtsp_transport tcp -tls_verify 0` → H2C-FIELD-NOTES.md §Recommendations #2.
- MQTT `mqtts://<ip>:8883` with `rejectUnauthorized:false` via Node `mqtt` pkg (never mosquitto_sub) → H2C-FIELD-NOTES.md §Recommendations #5.
- Sequential (no Promise.all) between checks → PITFALLS.md §1 / 11-CONTEXT §Pitfalls.
- External SIGKILL timer on ffprobe → 11-CONTEXT §Pitfalls ("ALL ffprobe calls in pre-flight need hard `timeout` (10–15s)") plus PITFALLS.md §1 Live555 hang.

## Deviations from Plan

**1. [Rule 3 - Blocker] Dropped ffprobe `-timeout` flag from spawn args**

- **Found during:** Task 2
- **Issue:** Plan text included `'-timeout', String(timeoutMs * 1000)` in the ffprobe arg list. H2C-FIELD-NOTES.md explicitly warns `-timeout`/`-rw_timeout` are ffmpeg-version-dependent, and the user's execution brief restated this constraint.
- **Fix:** Rely solely on the external `setTimeout + SIGKILL` wrapper (already in the plan). The external timer is deterministic across ffmpeg versions.
- **Files modified:** `src/lib/server/services/bambu-preflight.ts`
- **Rationale:** Aligns with ground-truth field notes; no functional loss since external kill already bounded the process.

**2. [Rule 2 - Critical] Added `settled` guard to TCP + RTSPS resolvers**

- **Found during:** Task 2 review
- **Issue:** Bare `resolve()` calls in net/child_process event handlers can race (both `connect` and `error` fire in some edge cases, or `close` fires after timer killed the proc).
- **Fix:** Idempotent `finish()` helper guarded by a `settled` boolean.
- **Files modified:** `src/lib/server/services/bambu-preflight.ts`

**3. [Rule 2 - Critical] Hardened MQTT auth detection**

- **Found during:** Task 2 review
- **Issue:** mqtt@5 error messages vary (`"Connection refused: Bad username or password"`, `"Connection refused: Not authorized"`, `"connack"` in some paths). Plan only listed three tokens.
- **Fix:** Added `'bad username'` variant and lower-cased the string comparison on both sides.
- **Files modified:** `src/lib/server/services/bambu-preflight.ts`

**4. [Rule 2 - Critical] Added 8th test** covering MQTT AUTH → WRONG_ACCESS_CODE (plan listed 6 tests; orchestrator has 7 distinct outcome branches, so this branch deserved its own case). Plus a hints-coverage sanity test. Total: 8 tests, all pass.

No architectural Rule-4 deviations.

## Known Stubs

None. Route and service are fully wired.

## Out-of-Scope / Deferred

- Live against-hardware smoketest (POST against real H2C at 192.168.3.109) — belongs to Plan 04's UI checkpoint per plan `<output>` block. NOT a gate for this plan.
- Wizard UI binding this endpoint → Plan 11-04.
- Storing the pre-flight verdict or using it to gate LXC provisioning → Phase 12.

## Self-Check: PASSED

- src/lib/server/services/bambu-preflight.ts — FOUND
- src/lib/server/services/bambu-preflight.test.ts — FOUND
- src/routes/api/onboarding/bambu/preflight/+server.ts — FOUND
- package.json lists `mqtt` — FOUND (^5.15.1)
- `mosquitto_sub` shellout in src/ — NOT FOUND (only the prohibition comment)
- Vitest: 8/8 pass
- svelte-check: 0 errors
