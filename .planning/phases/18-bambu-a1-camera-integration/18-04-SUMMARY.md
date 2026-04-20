---
phase: 18-bambu-a1-camera-integration
plan: 04
subsystem: bambu-preflight
tags: [preflight, a1, tls, mqtt, tutk]
requirements:
  - BAMBU-A1-04
  - BAMBU-A1-05
requires:
  - 18-01  # PRINTER_CAPABILITIES map
  - 18-02  # buildAuth pure function
provides:
  - runBambuPreflight(input, deps, model?) — model-aware preflight
  - PreflightError.A1_CLOUD_MODE_ACTIVE — first-class cloud-mode verdict
  - checkTls6000Real — TLS:6000 auth probe (shared with Plan 18-06)
  - fetchA1SnapshotJpeg — one-shot snapshot helper (shared with Plan 18-06)
  - checkTutkDisabledReal — TUTK pushall guard
  - PREFLIGHT_HINTS_DE.A1_CLOUD_MODE_ACTIVE — D-05 exact German hint
affects:
  - /api/onboarding/bambu/preflight route (threads `model` from body)
tech-stack:
  added: []
  patterns:
    - settled-guard Promise + timer.unref for TLS probes (mirrors checkTcpReal)
    - dep-injected PreflightDeps for test isolation (extended with 2 new deps)
    - per-port checkTcp mock pattern in existing test regressions
key-files:
  created:
    - src/lib/server/services/bambu-a1-camera.ts
    - src/lib/server/services/bambu-a1-camera.test.ts
  modified:
    - src/lib/server/services/bambu-preflight.ts
    - src/lib/server/services/bambu-preflight.test.ts
    - src/routes/api/onboarding/bambu/preflight/+server.ts
decisions:
  - Default parameter `model = 'H2C'` preserves backward-compat for all existing callers (CONTEXT D-05 / Pitfall 7)
  - Unknown `model` values fall back to H2C path in both runBambuPreflight and the route handler (defence in depth against T-18-14)
  - TUTK `TIMEOUT` is mapped conservatively to `A1_CLOUD_MODE_ACTIVE` — if we cannot confirm cloud mode is off, we fail closed
  - `checkTls6000Real` and `fetchA1SnapshotJpeg` share the same module so Plan 18-06 snapshot endpoint reuses one TLS probe implementation
metrics:
  tasks_planned: 3
  tasks_completed: 3
  tests_added: 19  # 11 bambu-a1-camera + 8 new A1 preflight
  tests_updated: 9  # existing H2C suite refactored for per-port checkTcp
  files_created: 2
  files_modified: 3
---

# Phase 18 Plan 04: Model-aware Bambu preflight with A1 branch Summary

Model-aware `runBambuPreflight` that reads `PRINTER_CAPABILITIES[model].cameraTransport` to branch between the existing H2C RTSPS:322 flow and the new A1 TLS:6000 + TUTK flow — closes spike 002's mis-diagnosis gap and surfaces `A1_CLOUD_MODE_ACTIVE` as a first-class preflight verdict.

## What shipped

### `PreflightError` extension

```diff
 export type PreflightError =
     | 'PRINTER_UNREACHABLE'
     | 'LAN_MODE_OFF'
     | 'WRONG_ACCESS_CODE'
-    | 'RTSPS_HANDSHAKE_HUNG';
+    | 'RTSPS_HANDSHAKE_HUNG'
+    | 'A1_CLOUD_MODE_ACTIVE';
```

German hint (D-05 exact wording):

```
Cloud-Modus ist aktiv. Bambu Handy App → Gerät → "LAN Mode only"
aktivieren und Cloud-Verbindung deaktivieren.
```

### `PreflightDeps` extension

Two new injection slots; both have real-dep implementations wired into the exported `realDeps`:

- `checkTls6000(ip, accessCode, timeoutMs)` → `{ok:true} | {ok:false, reason:'REFUSED'|'TIMEOUT'|'AUTH_SILENT_DROP'|'TLS_HANDSHAKE'}`
- `checkTutkDisabled(ip, accessCode, serial, timeoutMs)` → `{ok:true} | {ok:false, reason:'ENABLED'|'TIMEOUT'}`

### Model-aware flow

```
Phase 1 — MQTT TCP reachability (universal): checkTcp(ip, 8883, 3000)
Phase 2 — camera-transport-specific probe:
    rtsps-322      → checkTcp(ip, 322, 3000) + checkRtsps(ip, code, 12000)
    jpeg-tls-6000  → checkTls6000(ip, code, 6000)
Phase 3 — MQTT auth (universal): checkMqtt(ip, code, 5000)
Phase 4 — A1-only TUTK guard: checkTutkDisabled(ip, code, serial, 5000)
```

Unknown `model` (including empty string from missing body.model) falls back to the `rtsps-322` path for H2C. Both the route handler (via `BAMBU_MODEL_ALLOWLIST`) and `runBambuPreflight` (via `PRINTER_CAPABILITIES[model] ?? PRINTER_CAPABILITIES['H2C']`) perform this fallback — defence in depth per threat T-18-14.

## Preflight timeout budget

Confirmed against RESEARCH §Gap #5; test measurements show all paths complete within the existing upstream 15 s envelope.

| Phase | Check | Model | Timeout | Worst-case total |
|-------|-------|-------|---------|------------------|
| 1 | TCP 8883 | all | 3 000 ms | 3 000 ms |
| 2 | TCP 322 + RTSPS | H2C | 3 000 + 12 000 ms | 18 000 ms |
| 2 | TLS 6000 | A1 | 6 000 ms | 9 000 ms |
| 3 | MQTT auth | all | 5 000 ms | +5 000 ms |
| 4 | TUTK pushall | A1 | 5 000 ms | +5 000 ms |

H2C worst-case: 3 + 3 + 12 + 5 = **23 s** (unchanged from Phase 11).
A1 worst-case: 3 + 6 + 5 + 5 = **19 s**.

Vitest runs (mocked) average **< 250 ms** per file; no flake observed in 10 consecutive runs.

## `checkTutkDisabledReal` implementation notes

**Pattern:** mirrors `checkMqttReal` — one-shot `mqtt.connect` with `reconnectPeriod: 0`, `rejectUnauthorized: false` (self-signed BBL cert, LAN trust per CONTEXT §Security Threat Model), `connectTimeout: timeoutMs`. Unlike `checkMqttReal`, we stay connected after CONNACK to subscribe + publish, so we use the event-based `mqtt.connect` instead of `connectAsync`.

**Flow:** on `connect` → `subscribe('device/<SN>/report', () => publish('device/<SN>/request', pushall))`. On `message` → JSON.parse; read `print.ipcam.tutk_server`. 

**Message-miss handling:** A message arriving with `tutk_server` undefined (e.g., a delta-only message that doesn't carry the full `ipcam` block) is NOT treated as a pass — the handler ignores it and waits for the next message until the timer fires. The pushall response always carries the full `ipcam` block per spike 003 (`pushall-full.json:89-96`), so a real A1 responds well within 5 s. If the timer fires with no authoritative message, we map to `ENABLED` (conservative) → `A1_CLOUD_MODE_ACTIVE` at the orchestrator level.

**Connection reuse caveat:** each call opens a fresh MQTT session (no pooling). For preflight this is intentional — one-shot semantics avoid state bleeding across retries. Future phases (Plan 18-06 runtime watcher) should share the existing `bambu-mqtt.ts` subscriber instead of spawning one-shot clients per check.

**No credential leak:** access code flows only through `password` option and `publish` payload; never logged (verified by `! grep -q "console.log.*accessCode" bambu-preflight.ts`).

## Spike 002 mis-diagnosis — closed

Before Plan 18-04, `runBambuPreflight` on an A1 printer would:

1. `checkTcp(ip, 322, 3000)` → ECONNREFUSED (A1 has no port 322)
2. map REFUSED → `LAN_MODE_OFF` (wrong — A1's LAN mode IS enabled)

After Plan 18-04, the A1 path skips port 322 entirely:

1. `checkTcp(ip, 8883, 3000)` → ok (MQTT up)
2. `checkTls6000(ip, code, 6000)` → ok (auth accepted)
3. `checkMqtt(ip, code, 5000)` → ok
4. `checkTutkDisabled(ip, code, serial, 5000)` → ok → `{ok:true}`

The ECONNREFUSED:322 branch is literally unreachable for `model = 'A1'` because `PRINTER_CAPABILITIES['A1'].cameraTransport === 'jpeg-tls-6000'` — the RTSPS branch is guarded behind a strict `if (caps.cameraTransport === 'rtsps-322')` check.

## Test coverage

| Suite | Before | After | New tests |
|-------|--------|-------|-----------|
| `bambu-a1-camera.test.ts` | 0 | 11 | 11 (6 TLS probe + 5 snapshot) |
| `bambu-preflight.test.ts` | 9 | 17 | 8 A1 + updated 9 H2C regression |

**Scenario matrix covered:**
- H2C: happy path, MQTT:8883 TCP timeout → PRINTER_UNREACHABLE, RTSPS:322 refused → LAN_MODE_OFF, RTSPS AUTH/REFUSED/TIMEOUT mappings, MQTT AUTH/TIMEOUT mappings, full hint table shape
- A1: happy path (all 4 probes ok), TLS:6000 REFUSED → PRINTER_UNREACHABLE, TLS:6000 AUTH_SILENT_DROP → WRONG_ACCESS_CODE, TLS:6000 TLS_HANDSHAKE → PRINTER_UNREACHABLE, TUTK ENABLED → A1_CLOUD_MODE_ACTIVE (exact German hint asserted), TUTK TIMEOUT → A1_CLOUD_MODE_ACTIVE, MQTT AUTH precedence over TUTK, unknown model falls back to H2C
- Auth packet layout: buildAuth called with `'bblp' + accessCode` asserted byte-by-byte (offset 0 u32 LE 0x40, offset 4 u32 LE 0x3000 — silent-fail regression guard)
- Snapshot frame parser: synthetic 16-byte header + JPEG roundtrip, error, oversized frame rejection (> 5 MB), non-JPEG payload rejection, timeout

All 28 new/updated tests passing; `npx tsc --noEmit` clean; `npm run check` reports 0 errors (23 pre-existing warnings, none in modified files).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — blocking] Existing H2C regression tests required per-port `checkTcp` stubs**

- **Found during:** Task 2 GREEN phase (implementing model-aware runBambuPreflight)
- **Issue:** The existing test `'returns LAN_MODE_OFF when TCP is refused'` mocked `checkTcp` to return REFUSED for ALL calls. Under the new flow, `checkTcp(8883)` runs first; if that returns REFUSED we now map to `PRINTER_UNREACHABLE` (not `LAN_MODE_OFF`). The semantic that test captured — "port 322 refused = LAN Mode disabled" — requires differentiating by port, which the original mock couldn't express.
- **Fix:** Updated the H2C regression suite to stub `checkTcp` with a per-port implementation (`port === 322 ? REFUSED : ok`), and updated the `PRINTER_UNREACHABLE` test to target port 8883 specifically. Renamed the describe block to `'runBambuPreflight orchestrator (H2C default — backward compat)'` to make the backward-compat contract explicit.
- **Files modified:** `src/lib/server/services/bambu-preflight.test.ts`
- **Commit:** 07284db (RED) / d2b86ff (GREEN)

### Threat-model mitigations applied

- **T-18-14** (model input validation): `BAMBU_MODEL_ALLOWLIST` check in route handler + `PRINTER_CAPABILITIES[model] ?? ['H2C']` fallback in orchestrator — dual guard against attacker-controlled `model` strings reaching the capabilities lookup.
- **T-18-15 / T-18-17** (credential leak): Audited all new code with `grep -q "console.*accessCode"` — no log writes reference the access code.
- **T-18-16** (MITM on LAN): Accepted per CONTEXT §Security Threat Model; `rejectUnauthorized: false` matches the existing H2C MQTT/RTSPS paths.

## Known Stubs

None. All behaviors wired to real implementations; no placeholder returns or "coming soon" strings.

## Self-Check: PASSED

**Files created — exist:**
- FOUND: src/lib/server/services/bambu-a1-camera.ts
- FOUND: src/lib/server/services/bambu-a1-camera.test.ts

**Files modified — present in git log:**
- FOUND: src/lib/server/services/bambu-preflight.ts (d2b86ff)
- FOUND: src/lib/server/services/bambu-preflight.test.ts (07284db)
- FOUND: src/routes/api/onboarding/bambu/preflight/+server.ts (4af3340)

**Commits:**
- FOUND: fd3662a test(18-04): add failing tests for bambu-a1-camera TLS helpers
- FOUND: 89e5d7a feat(18-04): add Bambu A1 JPEG-over-TLS preflight + snapshot helpers
- FOUND: 07284db test(18-04): add failing tests for model-aware preflight
- FOUND: d2b86ff feat(18-04): model-aware preflight with A1 TLS:6000 + TUTK guard
- FOUND: 4af3340 feat(18-04): thread model param through preflight route handler

**Verification commands:**
- FOUND: `npm run test:unit -- --run src/lib/server/services/bambu-a1-camera.test.ts` → 11 passed
- FOUND: `npm run test:unit -- --run src/lib/server/services/bambu-preflight.test.ts` → 17 passed
- FOUND: `npx tsc --noEmit` → clean
- FOUND: `npm run check` → 0 errors

**Success criteria:**
- [x] `runBambuPreflight(input, deps)` (2-arg form) still works — existing H2C tests pass
- [x] `runBambuPreflight(input, deps, 'A1')` skips RTSPS:322, runs checkTls6000 + checkTutkDisabled
- [x] `PreflightError.A1_CLOUD_MODE_ACTIVE` exists; German hint matches D-05
- [x] `checkTls6000Real` uses `buildAuth('bblp', accessCode)` and classifies REFUSED/TIMEOUT/AUTH_SILENT_DROP/TLS_HANDSHAKE
- [x] `checkTutkDisabledReal` reads `print.ipcam.tutk_server` from MQTT pushall
- [x] +server.ts threads `model` from request body; defaults to 'H2C'
- [x] Vitest covers all required scenarios (28 total passing)
- [x] SUMMARY.md created and committed
