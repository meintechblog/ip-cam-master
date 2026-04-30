---
phase: 19-data-model-protect-catalog
plan: 03
subsystem: protect-catalog
tags: [unifi-protect, drizzle, sqlite, vitest, tdd, lib-boundary, classification, idempotent-upsert, sveltekit-api]

# Dependency graph
requires:
  - phase: 19-data-model-protect-catalog
    plan: 02
    provides: cameras +7 columns; protect_stream_catalog table; CameraSource/CameraKind type unions; unifi-protect@^4.29.0 + yaml@^2.6.0 deps pinned
  - phase: 19-data-model-protect-catalog
    plan: 01
    provides: TLS_SCHEME spike result (BLOCKED tonight — placeholder 'rtspx' shipped instead, see Deviations §1)
provides:
  - "src/lib/server/services/protect-bridge.ts — lib boundary: getProtectClient, resetProtectClient, fetchBootstrap (tagged Result), classifyKind (uses isThirdPartyCamera per amended D-CLASS-01), deriveManufacturerHint, normalizeMac, protectStreamUrl, TLS_SCHEME"
  - "src/lib/server/orchestration/protect-hub/catalog.ts — discover() and loadCatalog(); single-transaction upsert with idempotent UPSERT-by-MAC + delete-then-insert catalog rebuild; MAC-NOT-NULL invariant enforced (rolls back transaction)"
  - "POST /api/protect-hub/discover — thin auth-gated wrapper; status mapping 200/401/503/500"
  - "28 new unit + integration tests covering all P19 success criteria reachable server-side"
affects: [19-04-protect-hub-tab, 21-reconciler, 22-cameras-list-integration, 23-share-toggle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tagged-Result pattern for I/O failures (no exceptions across module boundaries) — fetchBootstrap and discover both return discriminated-union results"
    - "delete-then-insert idempotency for cache tables — simpler than channel diffing; correct because protect_stream_catalog is cache, not source of truth"
    - "Sentinel values for legacy NOT-NULL columns on cameras (vmid=0, username='', cameraType='mobotix') — managed-cam code paths filter on source='managed' and never read them"
    - "Hoisted vi.hoisted() refs for in-memory DB binding via $lib/server/db/client mock"

key-files:
  created:
    - src/lib/server/services/protect-bridge.ts
    - src/lib/server/services/protect-bridge.test.ts
    - src/lib/server/services/__fixtures__/protect-bootstrap-first-party-3-channel.json
    - src/lib/server/services/__fixtures__/protect-bootstrap-third-party-1-channel.json
    - src/lib/server/services/__fixtures__/protect-bootstrap-third-party-isThirdPartyCamera-true.json
    - src/lib/server/services/__fixtures__/protect-bootstrap-empty.json
    - src/lib/server/orchestration/protect-hub/catalog.ts
    - src/lib/server/orchestration/protect-hub/catalog.test.ts
    - src/routes/api/protect-hub/discover/+server.ts
  modified: []

key-decisions:
  - "TLS_SCHEME hardcoded to 'rtspx' as placeholder. Plan 19-01 (TLS spike) is human-blocked tonight; once it runs and writes the findings file, this const can be re-confirmed (or flipped to 'rtsps-tls-verify-0'). The catalog discover path does not consume TLS_SCHEME — it's stored for P21 yaml-builder. Safe placeholder for v1.3 plan-set; documented inline + here."
  - "Test files colocated with source per project convention (no tests/ directory exists; project uses *.test.ts beside .ts and __fixtures__/ subfolders). The plan's tests/server/... paths were a planning-doc convention not matched by the repo; PATTERNS.md guidance ('use whichever the project actually does') applied."
  - "import 'server-only' shim removed from protect-bridge.ts — package isn't installed in this repo and SvelteKit's $lib/server/** convention is the established pattern (no sibling service uses it)."
  - "Catalog row idempotency uses delete-then-insert per cam, not channel-by-channel diff. Catalog is a cache; the rebuild cost is irrelevant. Simpler invariant + smaller code surface."
  - "MAC NOT NULL invariant enforced inside the transaction by throwing — better-sqlite3's synchronous transaction wrapper rolls back automatically on throw. Test 5 (MAC NOT NULL) verifies zero partial rows survive."
  - "discover() and loadCatalog() are both async-typed even though all DB calls are sync — keeps signatures stable for P21 reconciler which may want to await async work."

patterns-established:
  - "Lib boundary module pattern: protect-bridge.ts wraps unifi-protect, holds singleton client + TTL refresh, exposes typed primitives (fetchBootstrap, classifyKind). Plan 04 will mirror for any UI-side server-load helpers."
  - "Orchestration module pattern: orchestration/<feature>/<concern>.ts. catalog.ts is the first inhabitant; P21 will add reconcile.ts, P23 share-toggle.ts."
  - "Per-route server.test.ts colocated with +server.ts (already established by Phase 18)."

requirements-completed: [HUB-CAT-02, HUB-CAT-03, HUB-CAT-05, HUB-CAT-06]

# Metrics
duration: 6m 12s
completed: 2026-04-30
---

# Phase 19 Plan 03: Protect Bridge + Catalog Discovery (Read-Only)

**Built the lib boundary (`protect-bridge.ts`), the orchestration upsert (`catalog.ts`), the API endpoint (`/api/protect-hub/discover`), and 28 Vitest cases that prove the contracts — all driven RED→GREEN, classification per amended D-CLASS-01 (uses `cam.isThirdPartyCamera` boolean, NOT a manufacturer regex).**

## Performance

- **Duration:** ~6 min 12 sec
- **Started:** 2026-04-30T00:08:35Z
- **Completed:** 2026-04-30
- **Tasks:** 4 (all autonomous, TDD-paired RED→GREEN)
- **Files created:** 9 (3 source, 2 test, 4 fixture)

## Test Results

| Suite                                                      | Cases | RED at start | GREEN at end |
| ---------------------------------------------------------- | ----- | ------------ | ------------ |
| `src/lib/server/services/protect-bridge.test.ts`           | 20    | yes (no module) | yes |
| `src/lib/server/orchestration/protect-hub/catalog.test.ts` | 8     | yes (no module) | yes |
| **Total new tests**                                        | **28** | —            | **28/28 pass** |

Full suite: `248 pass / 12 fail (5 pre-existing failed files)`. Pre-existing failures match the baseline reported in Plan 02 SUMMARY (proxmox.test.ts, ssh.test.ts, etc. — unrelated to schema or Protect work). **Zero regressions** caused by this plan.

`npm run check` (svelte-check + tsc): `0 ERRORS` (pre-existing Svelte component warnings unchanged).

## Task Commits

| # | Task | Type | Commit |
|---|------|------|--------|
| 01 | RED: fixtures + protect-bridge.test.ts (19 it blocks) | test | `56e8c7e` |
| 02 | GREEN: protect-bridge.ts (TLS_SCHEME='rtspx' placeholder) | feat | `66e8b9f` |
| 03 | RED: catalog.test.ts (8 it blocks; in-memory SQLite) | test | `1bbc2ac` |
| 04 | GREEN: catalog.ts + /api/protect-hub/discover/+server.ts | feat | `ba71b57` |

## Exact `classifyKind` Implementation

Per amended D-CLASS-01 (verified against `protect-types.ts:788`):

```ts
export function classifyKind(camera: ProtectCameraConfig): CameraKind {
  if (camera.isThirdPartyCamera === false) return 'first-party';
  if (camera.isThirdPartyCamera === true) return 'third-party';
  return 'unknown'; // defensive — handles undefined/null
}
```

Negative-grep checks pass:

```
$ grep -F "Ubiquiti|UniFi" src/lib/server/services/protect-bridge.ts
(no matches — no manufacturer regex)
$ grep -F "manufacturer.match" src/lib/server/services/protect-bridge.ts
(no matches)
$ grep -F "isThirdPartyCamera" src/lib/server/services/protect-bridge.ts
// The lib's `isThirdPartyCamera` boolean is the verified discriminator
        if (camera.isThirdPartyCamera === false) return 'first-party';
        if (camera.isThirdPartyCamera === true) return 'third-party';
```

`deriveManufacturerHint(cam, kind)`:
- `kind==='first-party'` → `'Ubiquiti'`
- `kind==='third-party'` → first whitespace-delimited token of `cam.marketName` (`'Mobotix S15'`→`'Mobotix'`, `'Hikvision DS-2CD2143G2'`→`'Hikvision'`)
- otherwise `'Unknown'`

## TLS_SCHEME Placeholder

```ts
// TODO(p19-01): Lock this const based on the spike findings file
// .planning/research/v1.3/spikes/p19-tls-rtspx.md once Plan 01 runs.
// Until then, defaulting to 'rtspx' per meintechblog 2025-11-07 working recipe.
export const TLS_SCHEME: TlsScheme = 'rtspx';
```

This is a documented deviation (see §Deviations). Plan 19-01 is human-blocked tonight (the user must enable a Protect share-toggle in the UDM UI before the spike can probe). When that runs, the spike produces `.planning/research/v1.3/spikes/p19-tls-rtspx.md` with a `Result: <scheme>` line — a follow-up patch can either confirm `'rtspx'` or flip to `'rtsps-tls-verify-0'`. Critically, **`catalog.ts` and `discover()` do NOT consume `TLS_SCHEME` directly** — it only flows into `protectStreamUrl()` rows in `protect_stream_catalog.rtsp_url`, which P21 yaml-builder will rebuild from scratch on every reconcile pass anyway. So a flip in P21 era is not blocked by what we cache today.

## API Endpoint Contract

`POST /api/protect-hub/discover` — auth-gated by global `hooks.server.ts` (path is NOT in `PUBLIC_PATHS`):

| Outcome | Status | Body |
|---|---|---|
| `discover()` ok | 200 | `{ ok: true, insertedCams, updatedCams, insertedChannels }` |
| UDM unreachable | 503 | `{ ok: false, reason: 'controller_unreachable', error: '<message>' }` |
| Creds not configured | 401 | `{ ok: false, reason: 'auth_failed', error: '<message>' }` |
| Other errors | 500 | `{ ok: false, reason: 'unknown', error: '<message>' }` |
| Unhandled throw in handler | 500 | `{ ok: false, error: '<message>' }` |

## Boundary Constraint: `protect.ts` Untouched

`git diff src/lib/server/services/protect.ts` produces a 0-line diff across all 4 commits. Verified after every task. The legacy v1.0 hand-rolled client is byte-identical to its pre-plan state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] TLS_SCHEME placeholder (Plan 19-01 blocked tonight)**
- **Found during:** Task 02 (Step 1 — read spike result)
- **Issue:** Plan 19-01 (TLS spike) is human-blocked tonight per the executor objective. The spike produces `.planning/research/v1.3/spikes/p19-tls-rtspx.md` with a `Result: <rtspx|rtsps-tls-verify-0>` line that the plan tells me to grep-extract and substitute into `TLS_SCHEME`. The file does not exist — `find .planning/research/v1.3/spikes` shows the directory itself doesn't exist.
- **Fix:** Hardcoded `TLS_SCHEME: TlsScheme = 'rtspx'` per the executor-prompt workaround (the meintechblog 2025-11-07 working recipe). Added a `TODO(p19-01):` comment block explaining what to update once the spike runs. The catalog discover path does NOT consume TLS_SCHEME directly (only `protectStreamUrl()` does, and only when caching `rtsp_url` strings that P21 yaml-builder will overwrite anyway), so a future flip is non-breaking.
- **Files modified:** `src/lib/server/services/protect-bridge.ts`
- **Verification:** Test "TLS_SCHEME is exported and is one of the locked values" passes (rtspx is allowed); the rtspx-specific URL-shape test (`protectStreamUrl` returns `rtspx://...`) passes; the rtsps-fallback test gates on the const value and stays a no-op.
- **Committed in:** `66e8b9f` (Task 02)

**2. [Rule 3 - Blocker] `import 'server-only'` removed**
- **Found during:** Task 02 (first test run after implementing protect-bridge.ts)
- **Issue:** RESEARCH.md skeleton mandates `import 'server-only';` as the first line. Vitest fails with `Cannot find package 'server-only'` because the npm shim is not installed in this repo. No sibling service in `src/lib/server/services/` uses it — the established convention is "files inside `src/lib/server/` are server-only by SvelteKit framework rule".
- **Fix:** Replaced the `import 'server-only';` line with a comment block explaining why it's intentionally absent. Module remains server-only via `$lib/server/` path semantics.
- **Files modified:** `src/lib/server/services/protect-bridge.ts`
- **Verification:** All 20 protect-bridge tests pass; `npm run check` exits 0.
- **Committed in:** `66e8b9f` (Task 02)

**3. [Rule 3 - Convention] Test layout: colocated, not under `tests/`**
- **Found during:** Task 01 (read_first checked the existing test layout)
- **Issue:** Plan paths assume `tests/server/services/protect-bridge.test.ts` and `tests/fixtures/*.json`. The repo has no `tests/` directory; the established pattern (Phase 18 + earlier) is colocated `*.test.ts` files beside source, with fixtures under `__fixtures__/` subfolders.
- **Fix:** Placed the test file at `src/lib/server/services/protect-bridge.test.ts` and fixtures at `src/lib/server/services/__fixtures__/protect-bootstrap-*.json`. Catalog test at `src/lib/server/orchestration/protect-hub/catalog.test.ts`. The plan's `<read_first>` for Task 01 explicitly anticipates this ("use whichever the project actually does").
- **Files modified:** all 5 Task-01 fixture/test paths and the Task-03 catalog test path.
- **Verification:** Vitest auto-discovers `*.test.ts` from cwd; all 28 tests run.
- **Committed in:** `56e8c7e`, `1bbc2ac`

**Total deviations:** 3 auto-fixed (1 blocker on missing spike file, 1 blocker on missing npm package, 1 convention divergence). All within Rule 3 scope. Zero architectural changes.

## In-Memory DB Performance Sanity Check

`src/lib/server/orchestration/protect-hub/catalog.test.ts` total runtime:

```
Test Files  1 passed (1)
     Tests  8 passed (8)
  Duration  395ms (transform 47ms, setup 0ms, import 287ms, tests 17ms, environment 0ms)
```

`tests 17ms` covers 8 integration cases each running their own `freshDb()` + `discover()` cycle on an in-memory SQLite. Per-cycle median is well under 5 ms for the 1-cam / 3-channel case. **discover() round-trip is < 100 ms even with library-import overhead.**

## Issues Encountered

- **Pre-existing test failures preserved:** `npm run test` reports `5 failed | 24 passed` files / `12 failed | 248 passed` tests — exactly the baseline Plan 02 documented. Failures are in `proxmox.test.ts`, `ssh.test.ts`, `update-runner.*.test.ts`, `bambu-mqtt.test.ts`, `update-history.test.ts`. None are in the Protect/catalog code paths. Out-of-scope per deviation rules; carried forward as the SUMMARY-level baseline note.

## Self-Check: PASSED

- **Files exist:**
  - `src/lib/server/services/protect-bridge.ts` ✓ FOUND
  - `src/lib/server/services/protect-bridge.test.ts` ✓ FOUND (20 it blocks)
  - `src/lib/server/services/__fixtures__/protect-bootstrap-first-party-3-channel.json` ✓ FOUND
  - `src/lib/server/services/__fixtures__/protect-bootstrap-third-party-1-channel.json` ✓ FOUND
  - `src/lib/server/services/__fixtures__/protect-bootstrap-third-party-isThirdPartyCamera-true.json` ✓ FOUND
  - `src/lib/server/services/__fixtures__/protect-bootstrap-empty.json` ✓ FOUND
  - `src/lib/server/orchestration/protect-hub/catalog.ts` ✓ FOUND
  - `src/lib/server/orchestration/protect-hub/catalog.test.ts` ✓ FOUND (8 it blocks)
  - `src/routes/api/protect-hub/discover/+server.ts` ✓ FOUND
- **Commits exist:**
  - `56e8c7e` (Task 01 — RED protect-bridge tests + 4 fixtures) ✓ FOUND
  - `66e8b9f` (Task 02 — GREEN protect-bridge.ts) ✓ FOUND
  - `1bbc2ac` (Task 03 — RED catalog tests) ✓ FOUND
  - `ba71b57` (Task 04 — GREEN catalog.ts + endpoint) ✓ FOUND
- **Boundary constraint:**
  - `git diff src/lib/server/services/protect.ts` is empty across all 4 commits ✓
- **TDD gate compliance:**
  - RED commits exist for both modules (test → fail) ✓
  - GREEN commits follow each RED ✓
  - No REFACTOR commits needed (skeleton already clean)

## TDD Gate Compliance

The plan is a TDD plan (4 tasks paired RED→GREEN→RED→GREEN). All 4 gates committed in the canonical order:

```
56e8c7e test(19-03): RED — failing protect-bridge tests + 4 fixtures   ← RED 1
66e8b9f feat(19-03): protect-bridge.ts — lib boundary, classifyKind…    ← GREEN 1
1bbc2ac test(19-03): RED — failing catalog.ts integration tests         ← RED 2
ba71b57 feat(19-03): catalog.ts + /api/protect-hub/discover endpoint    ← GREEN 2
```

Each RED commit produces a non-zero test exit on the new file (verified at commit time). Each GREEN commit makes the new file pass its full suite without weakening any tests.

## Threat Flags

None — all new server-side surfaces (POST /api/protect-hub/discover) align with `<threat_model>` mitigations: the route is auth-gated by default-deny `hooks.server.ts`, the upsert is wrapped in a single SQLite transaction, and the MAC-NOT-NULL invariant is enforced before any write commits.

## Next Phase Readiness

- **Plan 19-04 (Settings Hub-Tab UI):** Can call `POST /api/protect-hub/discover` from the browser, can `loadCatalog()` from a server-load function, can render `kind` / `manufacturer` / `model_name` / per-channel rows. The `controller_unreachable` 503 and the `lastDiscoveredAt` timestamp from `loadCatalog()` give the UI everything it needs for HUB-CAT-05's "Anzeige aus Cache" banner.
- **Phase 21 (reconciler):** Can call `discover()` directly from the 5-min tick (no scheduler tick added in P19 per D-REFRESH-01). The yaml-builder can then read `protect_stream_catalog.rtsp_url` and decide whether to honour or rewrite based on the locked TLS_SCHEME.
- **Phase 23 (share-toggle):** `protect-bridge.ts` already exports `getProtectClient()` — extending it with `enableCameraRtsp()` is a one-import-add away.

---
*Phase: 19-data-model-protect-catalog*
*Plan: 03*
*Completed: 2026-04-30*
