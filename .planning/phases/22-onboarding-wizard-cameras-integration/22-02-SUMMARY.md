---
phase: 22-onboarding-wizard-cameras-integration
plan: 02
subsystem: api
tags: [protect-hub, api, types, p22, wizard, slug, derived-state]

# Dependency graph
requires:
  - phase: 22-onboarding-wizard-cameras-integration
    provides: hub_onboarding_state table + wizard-state.ts service (Plan 01 — required by /wizard/state, /wizard/[step], /wizard/reset, /wizard/complete, hub-state.ts)
  - phase: 21-multi-cam-yaml-reconciliation-loop
    provides: reconcile.ts:isReconcilerBusy() (consumed by /api/protect-hub/health); yaml-builder.ts:deriveSlug (mirrored byte-identical in browser slug.ts)
  - phase: 19-protect-stream-hub-data-model
    provides: cameras.{source,kind,manufacturer,modelName,externalId,hubBridgeId} columns + protect_stream_catalog + camera_outputs tables (consumed by extended /api/cameras/status)
  - phase: 20-protect-bridge-provisioning
    provides: bridge-lifecycle.ts:getBridgeStatus (consumed by hub-state.ts + /api/protect-hub/health)

provides:
  - "GET /api/cameras/status response now includes 8 hub fields per cam (6 scalars + streamCatalog + outputs)"
  - "Browser-shareable slug + URL utils at $lib/protect-hub/slug.ts (deriveSlug, deriveStreamUrl, OutputType)"
  - "Server-only derived-state service at orchestration/protect-hub/hub-state.ts (getHubState → 5-state L-18 enum)"
  - "POST /api/protect-hub/wizard/[step] — strict 1..6 validation, 400 on invalid (T-22-03 mitigation)"
  - "POST /api/protect-hub/wizard/complete — atomic flag-flip + completePointer; T-22-07 mitigation tested"
  - "GET /api/protect-hub/wizard/state, POST /api/protect-hub/wizard/reset (thin wrappers)"
  - "GET /api/protect-hub/health — composite bridge + go2rtc reachability + reconciler-busy probe (2000 ms timeout)"
  - "GET /api/protect-hub/events?limit=N (capped at 200) — source='protect_hub' scope (T-22-08 mitigation)"
  - "GET /api/protect-hub/drift — P22 stub returning { driftDetected:false, checkedAt:null } until P23"
  - "events.ts:getEvents() filter union extended with source?: string (additive, non-breaking)"
  - "yaml-builder.ts:deriveSlug exported (was private) so the browser-side parity test can drift-check it"

affects:
  - phase 22 plan 03 — `/kameras` ExternalCamCard reads cam.streamCatalog + cam.outputs from /api/cameras/status; reads source/kind/manufacturer/modelName for badges; uses deriveStreamUrl for URL rendering
  - phase 22 plan 04 — wizard host page POSTs /wizard/[step], /wizard/reset, /wizard/complete; Step 5 polls /health at 1500 ms; resume banner reads /wizard/state
  - phase 22 plan 05 — HubStatusPanel polls /health, /events, /drift at 10 s; ProtectHubTab reads getHubState() to gate toggle-flap-protection (L-18)
  - phase 22 plan 06 — UAT validates /kameras partition + wizard end-to-end against the live VM

# Tech tracking
tech-stack:
  added: []  # Pure feature/type extensions; no new libraries
  patterns:
    - "Browser+server byte-identical slug derivation (parity-tested at CI; refactor exposes server-side `deriveSlug` so the test can import the canonical path)"
    - "Pure async derived-state service (`getHubState`) as alternative to a `hub_state` column — single source of truth = three input signals"
    - "Atomic two-step state transition with strict ordering (saveSetting → completePointer); failure of step 1 prevents step 2 (test-asserted)"
    - "Composite health probe with bounded timeout (`AbortSignal.timeout(2000)`) — bounded request pile-up at 1500 ms client cadence"
    - "Batched WHERE-IN load for per-cam relational arrays (catalog + outputs) instead of N+1 fetches"

key-files:
  created:
    - "src/lib/protect-hub/slug.ts"
    - "src/lib/protect-hub/slug.test.ts"
    - "src/lib/server/orchestration/protect-hub/hub-state.ts"
    - "src/lib/server/orchestration/protect-hub/hub-state.test.ts"
    - "src/routes/api/cameras/status/server.test.ts"
    - "src/routes/api/protect-hub/wizard/state/+server.ts"
    - "src/routes/api/protect-hub/wizard/[step]/+server.ts"
    - "src/routes/api/protect-hub/wizard/reset/+server.ts"
    - "src/routes/api/protect-hub/wizard/complete/+server.ts"
    - "src/routes/api/protect-hub/wizard/complete/server.test.ts"
    - "src/routes/api/protect-hub/health/+server.ts"
    - "src/routes/api/protect-hub/events/+server.ts"
    - "src/routes/api/protect-hub/drift/+server.ts"
    - "src/lib/server/services/events.test.ts"
    - ".planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md"
  modified:
    - "src/lib/types.ts"
    - "src/routes/api/cameras/status/+server.ts"
    - "src/lib/server/orchestration/protect-hub/yaml-builder.ts"
    - "src/lib/server/services/events.ts"

key-decisions:
  - "Honored real `saveSetting` async signature instead of plan's documented sync signature: handler awaits it. Plan text was outdated; live code in services/settings.ts:60 is `export async function saveSetting`. Without `await`, the cache-invalidation + protect-client-reset side-effects would race the completePointer call."
  - "Exported yaml-builder.ts:deriveSlug (was private function) so the browser-side parity test imports it directly. Drift between server YAML key and browser-rendered URL is now caught at CI time instead of failing silently in production. Non-breaking refactor — no callers modified."
  - "getHubState is async (returns Promise<HubState>) because getSetting is async. Pure function semantics preserved (no side effects, no DB writes), only the call signature is async to match the input dependency."
  - "Drift endpoint is a stub returning `driftDetected:false` per RESEARCH §Pitfall #10 — full implementation lands in P23 (5-min scheduler tick + on-demand SSH probe + protect_hub_bridges.driftDetected column write)."
  - "Batched `inArray()` load of catalog + outputs in /api/cameras/status (one SELECT per relation, not N+1). Managed cams short-circuit via Map miss → []."

patterns-established:
  - "Browser-shareable shared util pattern for code that MUST stay byte-identical with a server-side implementation: place at `src/lib/<domain>/<name>.ts` (no `$lib/server/*` import), parity-test via direct import of the server-side path under `vi.config()` node environment."
  - "Two-step atomic state transition pattern (`saveSetting → completePointer`): always test both sad paths (step 1 fails → step 2 NOT called; step 2 fails → step 1 already persisted, retry safe)."

requirements-completed:
  - HUB-WIZ-09  # /wizard/state + /wizard/reset enable resume-banner UX
  - HUB-WIZ-10  # /wizard/complete is the gated atomic flip of protect_hub_enabled
  - HUB-UI-01   # /api/cameras/status now includes the 8 fields ExternalCamCard needs
  - HUB-UI-08   # /health, /events, /drift + getHubState() unblock the Hub-Tab status panel + toggle gates

# Metrics
duration: ~25min
completed: 2026-05-07
---

# Phase 22 Plan 02: API Extensions and Shared Utils Summary

**Eight new API surfaces (6 endpoints + 2 modified) plus shared slug/state utils land the entire data layer Plans 03/04/05 consume — `/api/cameras/status` now exposes the 8 fields ExternalCamCard needs; the four `/wizard/*` endpoints atomically gate the HUB-WIZ-10 protect_hub_enabled flip; `/health`, `/events`, `/drift` complete the Hub-Tab status panel data plane.**

## Performance

- **Duration:** ~25 minutes (4 tasks, 4 commits)
- **Started:** 2026-05-07T14:25:00Z (approx)
- **Completed:** 2026-05-07T14:35:00Z
- **Tasks:** 4 (all complete)
- **Files created/modified:** 19 (15 created, 4 modified)
- **Commits:** 4 (one per task) + final docs commit
- **Test count delta:** +30 unit tests (2 status, 15 slug+parity, 8 hub-state, 3 complete-atomicity, 2 events-source-filter)
- **Test suite:** 99/99 protect-hub tests passing (up from 83 baseline); 30/30 Plan 22-02 tests pass
- **Type-check:** 0 errors after every commit (svelte-check)

## Accomplishments

- **CameraCardData type expansion (Task 1):** added 6 hub scalar fields (`source`, `kind`, `manufacturer`, `modelName`, `externalId`, `hubBridgeId`) plus two new array types `StreamCatalogRow[]` and `CameraOutputRow[]`. Closes RESEARCH §"Three critical gaps" #2.
- **/api/cameras/status response shape change:** maps the 6 hub scalars from cam rows directly; loads `streamCatalog` + `outputs` for external cams via two batched `inArray()` SELECTs (no N+1). Managed cams short-circuit to empty arrays via Map miss.
- **Browser-shareable slug util:** `src/lib/protect-hub/slug.ts` exports `deriveSlug` + `deriveStreamUrl` + `OutputType`. Parity test imports server-side `deriveSlug` from `yaml-builder.ts` and asserts byte-identical output for 5 sample MACs × 2 output types (10 parity assertions). Closes Pitfall #9.
- **Refactor:** `yaml-builder.ts:deriveSlug` exported (was private) so the parity test can import the canonical server-side function. Non-breaking — no caller changes needed.
- **Derived hub_state service:** `hub-state.ts` exports async `getHubState(): Promise<HubState>` composing settings/bridge/pointer signals into the L-18 5-state enum. 8 truth-table tests cover the priority order (error > starting > enabled > stopping > disabled). Resolves RESEARCH Open Question 1 + Pitfall #3 by deriving in code, not adding a column.
- **4 wizard pointer endpoints:** `/wizard/state` (GET), `/wizard/[step]` (POST with strict 1..6 validation, T-22-03), `/wizard/reset` (POST), `/wizard/complete` (POST atomic flip + completePointer with strict ordering, T-22-07). 3 atomicity tests on `/wizard/complete` cover happy path + both sad paths + invocation order (`saveSetting` before `completePointer`).
- **Composite health probe:** `/api/protect-hub/health` returns bridge metadata + go2rtcReady (HTTP probe with 2000 ms `AbortSignal.timeout`) + streamCount + reconcilerBusy. T-22-05 (DoS) mitigation explicit. Returns `{ ok:false, stage:'no_bridge' }` when bridge row absent.
- **Filtered events endpoint:** `/api/protect-hub/events?limit=N` returns last 50 (default) `source='protect_hub'` events; hard-capped at 200 (T-22-08). Reads via the extended `getEvents()` helper.
- **Drift endpoint stub:** `/api/protect-hub/drift` returns `{ driftDetected:false, checkedAt:null }` per RESEARCH §Pitfall #10. P23 will replace the body with a cached read of `protect_hub_bridges.driftDetected`.
- **events.ts service extension:** `getEvents()` filter union accepts `source?: string`; SQL appends `eq(events.source, value)` when provided. Single-line additive change. 2-test smoke verifies the new branch and the no-filter path.

## Task Commits

1. **Task 1 — extend CameraCardData + /api/cameras/status with hub fields:** `869737a`
2. **Task 2 — slug.ts util + hub-state.ts derived-state:** `f7fec77`
3. **Task 3 — wizard pointer endpoints (state/[step]/reset/complete):** `270c5a8`
4. **Task 4 — health/events/drift endpoints + getEvents source filter:** `16e7872`

**Plan-metadata commit:** to follow this summary.

## Files Created/Modified

### Created (15)

- `src/lib/protect-hub/slug.ts` — browser+server importable; deriveSlug + deriveStreamUrl + OutputType
- `src/lib/protect-hub/slug.test.ts` — 5 unit tests + 10 parity assertions
- `src/lib/server/orchestration/protect-hub/hub-state.ts` — async getHubState pure-derive
- `src/lib/server/orchestration/protect-hub/hub-state.test.ts` — 8 truth-table tests
- `src/routes/api/cameras/status/server.test.ts` — 2 tests covering hub-field expansion + regression
- `src/routes/api/protect-hub/wizard/state/+server.ts` — GET pointer wrapper
- `src/routes/api/protect-hub/wizard/[step]/+server.ts` — POST step validator + setPointer
- `src/routes/api/protect-hub/wizard/reset/+server.ts` — POST resetPointer
- `src/routes/api/protect-hub/wizard/complete/+server.ts` — POST atomic flag-flip + completePointer
- `src/routes/api/protect-hub/wizard/complete/server.test.ts` — 3 atomicity tests
- `src/routes/api/protect-hub/health/+server.ts` — composite probe with 2000 ms timeout
- `src/routes/api/protect-hub/events/+server.ts` — filtered + capped events read
- `src/routes/api/protect-hub/drift/+server.ts` — P22 stub
- `src/lib/server/services/events.test.ts` — 2 smoke tests for new source filter
- `.planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md` — pre-existing baseline failures

### Modified (4)

- `src/lib/types.ts` — CameraCardData +8 fields; new StreamCatalogRow + CameraOutputRow exported types
- `src/routes/api/cameras/status/+server.ts` — batched catalog/outputs load + per-cam projection
- `src/lib/server/orchestration/protect-hub/yaml-builder.ts` — deriveSlug exported (was private)
- `src/lib/server/services/events.ts` — getEvents filter union + source? branch in WHERE builder

## Decisions Made

- **`saveSetting` is async, not sync:** plan documented `saveSetting(key, value): void` but live code is `export async function saveSetting(key, value): Promise<void>` (services/settings.ts:60). Handler `await`s it. Without await, the cache-invalidation + dynamic-import-side-effect (`resetProtectClient` on unifi_*) would race the completePointer call. Plan-text vs. live-source mismatch resolved in favor of the live source.
- **Export `yaml-builder.ts:deriveSlug`:** was a private function. The plan called this out as an acceptable one-line refactor; doing so means the slug parity test imports the canonical server-side path directly, so any future drift between the two implementations breaks CI (instead of failing silently in production). Non-breaking — no existing callers were modified.
- **`getHubState` is async** because `getSetting` is async. Pure-function semantics preserved (no side effects, no DB writes); only the call signature returns a Promise to match the input dependency.
- **Drift endpoint is a stub** per RESEARCH §Pitfall #10 — full implementation requires the P23 5-min scheduler + SSH probe + a new `driftDetected` column on `protect_hub_bridges`. P22 ships the response shape only so Plan 05's HubStatusPanel can wire its conditional render against the contract.
- **Batched `inArray()` load** for streamCatalog + outputs in /api/cameras/status: two SELECTs per request (one per relation), filtering by the external-cam ID list. Managed cams short-circuit to empty arrays via Map miss with no extra DB cost. The batched approach is the documented pattern in the plan's `<action>` block.
- **Drift cap on events**: `Math.min(200, Math.max(1, ...))` — T-22-08 mitigation. Default 50 if no `?limit=` query parameter present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `saveSetting` documented as sync; live code is async**
- **Found during:** Task 3 (wizard/complete handler implementation)
- **Issue:** Plan's `<interfaces>` block documented `saveSetting(key, value): void` but `src/lib/server/services/settings.ts:60` declares it as `export async function saveSetting(...): Promise<void>`. Without `await`, the cache-invalidation + dynamic `resetProtectClient` side-effect would race `completePointer`, breaking the strict-ordering atomicity guarantee.
- **Fix:** Handler `await`s `saveSetting` before calling `completePointer`. Test mocks declare `mockSaveSetting.mockResolvedValue(...)` to match.
- **Files affected:** `src/routes/api/protect-hub/wizard/complete/+server.ts`, `src/routes/api/protect-hub/wizard/complete/server.test.ts`
- **Committed in:** `270c5a8` (Task 3 commit)

**2. [Rule 3 — Refactor] yaml-builder.ts:deriveSlug was private**
- **Found during:** Task 2 (slug parity test setup)
- **Issue:** Plan's action block called this out as a permissible inline refactor. The function was a `function` (not `export function`), so the parity test couldn't import it.
- **Fix:** Added `export` keyword. Single-line change with no caller modifications. The benefit is CI-time drift detection between the browser-side slug util and the canonical server-side YAML key generator.
- **Files affected:** `src/lib/server/orchestration/protect-hub/yaml-builder.ts`
- **Committed in:** `f7fec77` (Task 2 commit)

### Out-of-Scope / Deferred

**3. [Out of scope] Pre-existing test failures in proxmox.test.ts (4) + onboarding.test.ts (8)**
- **Found during:** full-suite run after Task 4
- **Issue:** 12 tests fail on baseline (verified with `git stash`). Both test files unchanged by Plan 22-02.
- **Action:** Logged to `.planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md`. Recommend a separate `/gsd:debug` session targets the SSH-mock-chain regression in those two files.
- **Impact on plan:** None. Plan 22-02's `<verification>` block specifies plan-specific test files (events.test.ts + npm run check); both pass cleanly.

---

**Total deviations:** 2 auto-fixed (Rule 3 — both signature/visibility fixes for downstream-test setup) + 1 out-of-scope item documented for future debug session.

## Threat Surface Scan

All threats from the plan's `<threat_model>` register are mitigated as designed:

- **T-22-03 (Tampering on /wizard/[step]):** `Number.isInteger(step) && 1 <= step <= 6` guard returns 400 on invalid input. Cannot poison pointer with arbitrary step values. Verified in `[step]/+server.ts:13-14`.
- **T-22-05 (DoS on /health):** `AbortSignal.timeout(2000)` bounds go2rtc fetch (max 1.33 r/s pile-up at 1500 ms client cadence). Verified in `health/+server.ts:21`.
- **T-22-07 (Tampering on /wizard/complete atomicity):** Strict sequential write order with both-sad-path tests. `saveSetting` failure → `completePointer` not called; `completePointer` failure → `saveSetting` already persisted, retry safe (idempotent). Verified in `complete/server.test.ts` 3 tests.
- **T-22-08 (DoS on /events limit):** `Math.min(200, Math.max(1, Number(limit)))` hard-caps at 200. Default 50. Verified in `events/+server.ts:18`.

Accepted threats T-22-04 (Spoofing — LAN-trust per L-23) and T-22-06 (Information Disclosure — events table contains operational metadata only, no creds) per the plan's stated posture; no code changes needed.

**No new threat surface introduced beyond the plan's register.**

## Known Stubs

- **/api/protect-hub/drift returns hardcoded `{ driftDetected:false, checkedAt:null }`** — intentional per plan + RESEARCH §Pitfall #10. Drift detection (5-min scheduler tick + on-demand SSH probe + `protect_hub_bridges.driftDetected` column write) is owned by Phase 23. The endpoint shape is stable so Plan 05's HubStatusPanel can wire its conditional render against the contract today; the body will be replaced (not deleted) when P23 lands.

No other stubs.

## TDD Gate Compliance

The plan declared `tdd="true"` on all 4 tasks but used a "ship test alongside source" approach (not strict RED-then-GREEN gate commits per task) — the plan's `<action>` blocks describe writing source + test in one task each, and the per-task verify command runs the new test file. All tests were authored alongside their source and run green at commit time. Commits use `feat()` (not `test()`+`feat()` pairs) because each task ships both source and test in one logical change.

## Issues Encountered

- **`saveSetting` async signature mismatch with plan text** — resolved per Deviation 1 above.
- **Pre-existing baseline test failures in unrelated files** — out of scope; logged to deferred-items.md.

## User Setup Required

None. All endpoints are read-only or upsert single-row tables. No new external service config. The live VM at `192.168.3.178:3000` will pick up the changes automatically on the next git-push deploy.

## Next Phase Readiness

Plans 03, 04, 05 can now consume the full data plane:

- **Plan 03 `/kameras` partition + ExternalCamCard:** reads `cam.source`, `cam.kind`, `cam.manufacturer`, `cam.modelName`, `cam.externalId`, `cam.hubBridgeId`, `cam.streamCatalog`, `cam.outputs` from `/api/cameras/status`. Renders URLs via `deriveStreamUrl(bridgeIp, mac, outputType)` from `$lib/protect-hub/slug`.
- **Plan 04 wizard host page + Steps 3-6:** GET `/wizard/state` for resume banner; POST `/wizard/[step]` on each step; POST `/wizard/reset` on banner Reset; POST `/wizard/complete` on Step 6; Step 5 polls `/health` at 1500 ms.
- **Plan 05 Hub-Tab status panel + event log:** polls `/health` at 10 s; polls `/events` at 10 s; reads `/drift` once per render; gates toggle-flap-protection on `getHubState()` ∈ {starting, stopping}.

All endpoint contracts validated by tests. 99/99 protect-hub tests still green. Type-check 0 errors.

## Self-Check: PASSED

**Files claimed:**
- ✅ FOUND: `src/lib/protect-hub/slug.ts`
- ✅ FOUND: `src/lib/protect-hub/slug.test.ts`
- ✅ FOUND: `src/lib/server/orchestration/protect-hub/hub-state.ts`
- ✅ FOUND: `src/lib/server/orchestration/protect-hub/hub-state.test.ts`
- ✅ FOUND: `src/routes/api/cameras/status/server.test.ts`
- ✅ FOUND: `src/routes/api/protect-hub/wizard/state/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/wizard/[step]/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/wizard/reset/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/wizard/complete/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/wizard/complete/server.test.ts`
- ✅ FOUND: `src/routes/api/protect-hub/health/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/events/+server.ts`
- ✅ FOUND: `src/routes/api/protect-hub/drift/+server.ts`
- ✅ FOUND: `src/lib/server/services/events.test.ts`
- ✅ FOUND: `src/lib/types.ts` (modified — CameraCardData +8 fields at lines 174-198 incl. new StreamCatalogRow + CameraOutputRow exports)
- ✅ FOUND: `src/routes/api/cameras/status/+server.ts` (modified — batched load + per-cam projection)
- ✅ FOUND: `src/lib/server/orchestration/protect-hub/yaml-builder.ts` (modified — deriveSlug exported)
- ✅ FOUND: `src/lib/server/services/events.ts` (modified — source filter)

**Commits claimed:**
- ✅ FOUND: 869737a (Task 1 — types + cameras/status)
- ✅ FOUND: f7fec77 (Task 2 — slug + hub-state)
- ✅ FOUND: 270c5a8 (Task 3 — wizard endpoints)
- ✅ FOUND: 16e7872 (Task 4 — health/events/drift + getEvents)

**Test counts:**
- ✅ Plan-specific: 30/30 pass (2 cameras-status + 15 slug+parity + 8 hub-state + 3 complete-atomicity + 2 events-source-filter)
- ✅ Protect-hub suite: 99/99 pass (was 83 baseline; +16 from this plan)
- ✅ Type-check: 0 errors

---
*Phase: 22-onboarding-wizard-cameras-integration*
*Completed: 2026-05-07*
