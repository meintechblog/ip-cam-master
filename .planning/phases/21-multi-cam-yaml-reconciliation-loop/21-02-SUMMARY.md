---
phase: 21-multi-cam-yaml-reconciliation-loop
plan: 02
status: complete
subsystem: protect-hub-orchestration

tags: [yaml, pure-function, golden-file, canonical-hash, sha256, token-redaction, vitest, public-repo-safety]

requires:
  - phase: 21-multi-cam-yaml-reconciliation-loop
    plan: 01
    provides: yaml-builder.test.ts stub + protectHubReconcileRuns schema (Wave-0 foundation)
  - lib: yaml@2.6.0
    provides: stringify({sortMapEntries:true}) + parse — already in package.json
provides:
  - buildBridgeYaml(outputs, reconcileId) pure function — multi-cam go2rtc YAML for the bridge LXC
  - canonicalHash(yamlText) — sha256 of stamp-stripped + sortMapEntries-normalised YAML; the dedupe primitive for D-RCN-01
  - STAMP_REGEX exported constant (matches the L-8 first-line stamp comment)
  - OutputRow + OutputType public types — wire contract for the upcoming Plan 03 reconcile.ts
  - 4 golden-file YAML fixtures (loxone-only-1cam, frigate-only-1cam, mixed-2cams, empty-bridge) under __fixtures__/yaml-builder/
  - Empirical verification of Assumption A1 (sortMapEntries:true applies recursively in yaml@2.6.0)
affects: [21-03 (consumes buildBridgeYaml + canonicalHash), 21-04, 22-protect-hub-ui]

tech-stack:
  added: []
  patterns:
    - "Pure-function YAML emission: structured config object → yaml.stringify({sortMapEntries:true}) for deterministic key order"
    - "Canonical hashing: strip dynamic stamp regex → yaml.parse → yaml.stringify (sorted) → sha256 → stable digest immune to cosmetic differences but sensitive to data changes"
    - "Golden-file regression via canonicalHash equality (not raw byte equality) — exercises the dedupe code path AND avoids time-flake from the per-render ISO timestamp in the stamp"
    - "Public-repo token redaction: hardcoded <TEST-TOKEN-...> placeholders in tests + fixtures + automated scan for any 32+ char alphanumeric run that could resemble a real Protect rtspAlias"

key-files:
  created:
    - src/lib/server/orchestration/protect-hub/yaml-builder.ts
    - src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/loxone-only-1cam.yaml
    - src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/frigate-only-1cam.yaml
    - src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/mixed-2cams.yaml
    - src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/empty-bridge.yaml
    - .planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md
  modified:
    - src/lib/server/orchestration/protect-hub/yaml-builder.test.ts

key-decisions:
  - "Slug suffix wording: `low` (loxone-mjpeg) and `high` (frigate-rtsp) per Open Question 2 in 21-RESEARCH — matches existing `generateGo2rtcConfigLoxone` / `generateGo2rtcConfigBambu` convention in go2rtc.ts"
  - "Static WARNING comment on line 2 (after the dynamic stamp) — included in canonicalHash for defense-in-depth against accidental edits without destabilising the hash (line is identical across renders)"
  - "Only the dynamic stamp line is stripped before hashing; the WARNING + body are part of the canonical form"
  - "Golden-file regression via canonicalHash equality (NOT vi.useFakeTimers + raw bytes) — exercises the dedupe primitive once per fixture AND avoids time-flake; option (b) from Plan task instructions"
  - "Tests assert against parsed ffmpeg source strings (yaml.parse round-trip) instead of raw YAML text, so yaml@2.6's folded-scalar line-wrapping at 80 cols cannot break D-PIPE-02/04 substring checks"
  - "Plan 03 reconcile.ts will call normalizeMac() on its OutputRow.mac inputs; yaml-builder MUST NOT re-normalise (single-source-of-truth lives in protect-bridge.ts:normalizeMac())"

requirements-completed:
  - HUB-OUT-02
  - HUB-OUT-03
  - HUB-OUT-06
  - HUB-OUT-07
  - HUB-RCN-05

metrics:
  duration_minutes: 7
  task_count: 2
  files_count: 6
  tests_added: 19
  tests_passing: 19
completed: 2026-05-06
---

# Phase 21 Plan 02: YAML Builder + Golden Fixtures Summary

**`yaml-builder.ts` shipped as a pure function emitting D-PIPE-02 / D-PIPE-04 verbatim ffmpeg sources, wrapped in a deterministic-key-ordered `yaml.stringify({sortMapEntries:true})` body, with `canonicalHash()` proven to be stable across cosmetic differences and sensitive to token rotation. 19 vitest assertions and 4 token-redacted golden fixtures lock the wire format for the downstream Plan 03 reconcile loop.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-06T05:58:Z
- **Completed:** 2026-05-06T06:06:Z
- **Tasks:** 2 (atomic per-task commits)
- **Files created:** 6 (1 implementation + 4 fixtures + 1 deferred-items log)
- **Files modified:** 1 (test stub → real test file)

## Accomplishments

1. **`yaml-builder.ts` (179 lines)** — exports `buildBridgeYaml`, `canonicalHash`, `STAMP_REGEX`, `OutputRow`, `OutputType`. Pure function (no I/O, no DB, no SSH). Implements:
   - L-8 stamp + WARNING comment + `yaml.stringify({sortMapEntries:true})` body
   - D-PIPE-02 verbatim Loxone-MJPEG ffmpeg source (`#video=mjpeg#width=640#height=360#raw=-r 10#raw=-an#hardware=vaapi` + D-PIPE-05 reconnect flags)
   - D-PIPE-04 verbatim Frigate-RTSP ffmpeg source (`#video=copy#raw=-an` + D-PIPE-05 reconnect flags)
   - D-PIPE-06 slug pattern `<mac>-<low|high>` (mac NOT re-normalised)
   - L-9 / D-API-BIND-01 config block (api/listen, ui_editor:false, rtsp/listen, ffmpeg/bin, log/level)
   - canonicalHash: STAMP_REGEX strip → yaml.parse → yaml.stringify({sortMapEntries:true}) → sha256
   - Empty `outputs[]` produces `streams: {}` (does NOT throw — bridge can run dry between reconciles)
   - Unknown outputType throws typed Error (defensive for future P22+ types)
2. **`yaml-builder.test.ts` (19 tests, all green)** — replaces the Plan 01 stub. Covers:
   - HUB-OUT-02: D-PIPE-02 fragments present in parsed Loxone source
   - HUB-OUT-03: D-PIPE-04 fragments present in parsed Frigate source; VAAPI absent (passthrough)
   - HUB-OUT-06: slug stable across calls; mac NOT re-normalised
   - HUB-OUT-07: slug pattern `<mac>-<low|high>` per D-PIPE-06
   - HUB-RCN-05: canonicalHash stable across reconcileId changes; token rotation rotates hash
   - Empty bridge: round-trip parse succeeds, streams map empty
   - Unknown outputType throws
   - L-8 stamp on line 1; static WARNING on line 2
   - **Assumption A1 verified**: sortMapEntries:true normalises nested map ordering in yaml@2.6.0
   - canonicalHash idempotent on stamp-less input (raw user-edited file)
   - 4 golden-file regression tests (canonicalHash equality)
   - **SECURITY test**: scans every fixture for any 32+ char alphanumeric run that could resemble a real Protect rtspAlias — fails loudly if a developer ever pastes a real token
3. **4 golden-file fixtures** under `__fixtures__/yaml-builder/`:
   - `loxone-only-1cam.yaml` — 1× Loxone Carport (D-PIPE-02 path)
   - `frigate-only-1cam.yaml` — 1× Frigate Carport (D-PIPE-04 path)
   - `mixed-2cams.yaml` — 1× Loxone Carport + 1× Frigate Frontdoor (cross-type cohabitation)
   - `empty-bridge.yaml` — 0 outputs (dry-bridge path)
4. **`deferred-items.md`** documenting 12 pre-existing test failures in unrelated services (proxmox / onboarding / backup), confirmed on the wave base.

## Task Commits

1. **Task 1: yaml-builder.ts pure function** — `96a3875` (feat)
2. **Task 2: real tests + 4 golden-file fixtures** — `8f94cad` (test)

## Wire Format Decisions Locked

### Slug suffix wording (Open Question 2 in 21-RESEARCH.md)

Resolved to **`low` for loxone-mjpeg** and **`high` for frigate-rtsp**. Rationale: matches the existing `generateGo2rtcConfigLoxone` and `generateGo2rtcConfigBambu` naming convention in `src/lib/server/services/go2rtc.ts:130-165`. NOT prefixed with the source type (no `loxone-low` / `frigate-high`) — keeps URLs short and consistent with existing patterns.

Final pattern: `${normalizedMac}-${suffix}` where `suffix ∈ {'low', 'high'}`.

Example slugs (token-redacted): `aabbccddee01-low`, `aabbccddee02-high`.

### Assumption A1 verification — sortMapEntries:true applies recursively in yaml@2.6.0

**Verified RUNTIME-TRUE.** The dedicated test "sortMapEntries normalizes nested map ordering" hand-builds two YAMLs from objects with deliberately reordered keys at every nesting level (top-level config keys + nested `streams` keys + nested `api: {listen, ui_editor}` keys), then asserts their `canonicalHash` is identical. Test passes — confirms the assumption holds in practice. **Plan 03 reconcile.ts can rely on this without a fallback comparator.**

### Golden-file equality strategy (Plan task step 5: choose option (a) or (b))

**Chose option (b)** — compare via `canonicalHash` equality, not raw bytes with frozen system time. Rationale captured in code comment in `yaml-builder.test.ts`: option (b) exercises the dedupe primitive once per fixture (extra coverage of the canonicalHash code path) AND avoids time-flake from the per-render ISO timestamp embedded in the L-8 stamp. The 4 fixtures are still committed verbatim — they remain inspectable + diff-friendly for future maintainers — but the pass/fail signal comes from canonicalHash equality.

### Token redaction — confirmation no real Protect tokens are in committed fixtures

**Confirmed.** Every fixture either:
- Contains a `<TEST-TOKEN-CARPORT>` / `<TEST-TOKEN-FRONTDOOR>` placeholder (visible to grep), OR
- Is the empty-bridge fixture (no token references at all)

The SECURITY test in `yaml-builder.test.ts` reads every committed fixture file at test time and asserts no 32+ char alphanumeric run exists in any of them. This is belt-and-suspenders defense — even if a developer pastes a real token while regenerating fixtures in the future, CI will block the commit.

## OutputRow inputs that produced each fixture

```typescript
const RECONCILE_ID = '00000000-0000-0000-0000-000000000001';
const CARPORT_TOKEN = '<TEST-TOKEN-CARPORT>';
const FRONTDOOR_TOKEN = '<TEST-TOKEN-FRONTDOOR>';
const CARPORT_MAC = 'aabbccddee01';
const FRONTDOOR_MAC = 'aabbccddee02';

// loxone-only-1cam.yaml
buildBridgeYaml([
  { cameraId: 1, mac: CARPORT_MAC, outputType: 'loxone-mjpeg',
    rtspUrl: `rtsps://192.168.3.1:7441/${CARPORT_TOKEN}?enableSrtp` }
], RECONCILE_ID);

// frigate-only-1cam.yaml
buildBridgeYaml([
  { cameraId: 2, mac: CARPORT_MAC, outputType: 'frigate-rtsp',
    rtspUrl: `rtsps://192.168.3.1:7441/${CARPORT_TOKEN}?enableSrtp` }
], RECONCILE_ID);

// mixed-2cams.yaml
buildBridgeYaml([
  { cameraId: 1, mac: CARPORT_MAC,   outputType: 'loxone-mjpeg',
    rtspUrl: `rtsps://192.168.3.1:7441/${CARPORT_TOKEN}?enableSrtp` },
  { cameraId: 2, mac: FRONTDOOR_MAC, outputType: 'frigate-rtsp',
    rtspUrl: `rtsps://192.168.3.1:7441/${FRONTDOOR_TOKEN}?enableSrtp` }
], RECONCILE_ID);

// empty-bridge.yaml
buildBridgeYaml([], RECONCILE_ID);
```

## Decisions Made

- **Static WARNING line on line 2 (after the L-8 dynamic stamp).** Per CONTEXT "Claude's Discretion". Plain `# WARNING: do not edit by hand …`. Static across renders → does NOT destabilise canonicalHash; serves as defense-in-depth against accidental edits and a clear hint for foreign editors that the file is reconciler-managed.
- **Only the dynamic stamp regex is stripped before hashing.** WARNING line stays inside the canonical form (it's invariant). Stamp regex: `/^# managed by ip-cam-master, reconcile-id [^\n]+\n/`.
- **Tests parse YAML before substring assertions.** yaml@2.6's `stringify` folds long lines at 80 cols (the ffmpeg source string is ~280 chars), so `yamlText.toContain('#raw=-r 10')` would fail when the wrap boundary lands inside the fragment. Solution: call `yaml.parse(text)` and assert against the round-tripped source string. The wire form is what go2rtc receives anyway — line wrapping is purely a cosmetic encoding choice.
- **canonicalHash idempotent on stamp-less input.** A dedicated test passes the stamp-stripped form and confirms hash equals the with-stamp form. Matters because reconcile.ts in Plan 03 may compute canonicalHash on remote files that have been touched by a foreign editor (no longer carries our stamp).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Generated `src/lib/version.ts` so `npm run check` could run**
- **Found during:** Pre-Task 1 environment setup (npm install in fresh worktree)
- **Issue:** Build-time generated file `src/lib/version.ts` is `.gitignore`d and was missing in the fresh worktree (same issue Plan 01 hit; documented in 21-01-SUMMARY.md).
- **Fix:** `npm run gen:version` (existing project script).
- **Files modified:** `src/lib/version.ts` (gitignored, not committed).
- **Verification:** `npm run check` reports 0 errors after.

**2. [Rule 3 — Blocking] Created `data/` directory before any DB-touching code path**
- **Found during:** Pre-Task 1 setup
- **Issue:** Same as Plan 01 — `data/` is gitignored and missing in fresh worktree.
- **Fix:** `mkdir -p data`.
- **Files modified:** None committed (`data/` stays gitignored).

**3. [Rule 1 — Test bug] First test pass had two failures because yaml@2.6 folds long lines**
- **Found during:** Task 2 first vitest run
- **Issue:** Two assertions (`#raw=-r 10` and `#raw=-reconnect 1`) used `expect(yaml).toContain(...)` against the raw YAML text. yaml@2.6's `stringify` folds long scalar values at 80 cols by default, splitting the substring across `\n      ` indentation — `toContain` fails even though the data is correct.
- **Fix:** Refactored those tests to call `yaml.parse(yamlText).streams[slug][0]` and assert against the round-tripped source string. Wire form is what go2rtc receives, so this is the correct level of abstraction. yaml-builder.ts itself is unchanged.
- **Files modified:** `yaml-builder.test.ts` only.
- **Commit:** `8f94cad` (folded into the same Task 2 commit).

---

**Total deviations:** 3 — all auto-fixed (2× Rule 3 environment setup, 1× Rule 1 test bug). Implementation file `yaml-builder.ts` shipped exactly as planned; ZERO deviation from D-PIPE-02 / D-PIPE-04 / D-PIPE-05 / D-PIPE-06 wire format.

## Issues Encountered (out of scope — see deferred-items.md)

- **12 pre-existing test failures in unrelated services** (`proxmox.test.ts`, `onboarding.test.ts`, `backup.test.ts`, `proxmox-validate.test.ts`). Reproduced on the wave-base commit before any 21-02 changes. Logged in `.planning/phases/21-multi-cam-yaml-reconciliation-loop/deferred-items.md`. Not auto-fixed per SCOPE BOUNDARY rule — surface for separate stabilization plan.

## Verification

- `npx vitest --run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` → 19/19 pass
- `npm run check` → 0 errors (30 pre-existing warnings in unrelated `.svelte` files)
- 4 golden fixtures inspectable + diff-friendly under `__fixtures__/yaml-builder/`
- SECURITY test confirms no 32+ char alphanumeric run in any fixture

## Next Plan Readiness

- **Plan 03 (reconcile.ts)** can import `buildBridgeYaml`, `canonicalHash`, `STAMP_REGEX`, `OutputRow`, `OutputType` directly. Wire format locked; OutputRow contract documented.
- **Plan 03 dedupe primitive ready.** canonicalHash proven stable across reconcileId changes (the only dynamic-by-design field) and sensitive to URL/token rotation (D-RCN-05 token-rotation behaviour).
- **No fallback comparator needed.** Assumption A1 verified at runtime.

## Self-Check: PASSED

- `src/lib/server/orchestration/protect-hub/yaml-builder.ts` — created (commit `96a3875` ✓)
- `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` — modified (commit `8f94cad` ✓)
- `src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/loxone-only-1cam.yaml` — created (commit `8f94cad` ✓)
- `src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/frigate-only-1cam.yaml` — created (commit `8f94cad` ✓)
- `src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/mixed-2cams.yaml` — created (commit `8f94cad` ✓)
- `src/lib/server/orchestration/protect-hub/__fixtures__/yaml-builder/empty-bridge.yaml` — created (commit `8f94cad` ✓)
- 19/19 vitest assertions pass ✓
- 0 errors from `npm run check` ✓
- 0 real Protect tokens in any committed fixture (SECURITY test enforces) ✓

---
*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Plan: 02 — yaml-builder pure function + golden fixtures*
*Completed: 2026-05-06*
