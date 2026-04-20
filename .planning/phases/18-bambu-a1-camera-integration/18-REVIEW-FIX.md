---
phase: 18-bambu-a1-camera-integration
fixed_at: 2026-04-20T19:20:00Z
review_path: .planning/phases/18-bambu-a1-camera-integration/18-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 18: Code Review Fix Report

**Fixed at:** 2026-04-20T19:20:00Z
**Source review:** .planning/phases/18-bambu-a1-camera-integration/18-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (2 critical + 5 warning)
- Fixed: 7
- Skipped: 0
- Info findings (IN-01..IN-04): deferred — out of scope (critical_warning)

## Fixed Issues

### CR-01: Unescaped access code + printer IP injected into go2rtc exec: command line

**Files modified:** `src/routes/api/onboarding/bambu/save-camera/+server.ts`, `src/routes/api/onboarding/bambu/preflight/+server.ts`, `src/lib/server/services/go2rtc.ts`, `src/lib/server/services/go2rtc.test.ts`
**Commit:** 1c4d4ac
**Applied fix:** Two-layer validation. Route layer: save-camera rejects non-8-digit access codes and non-IPv4 IPs (per-octet 0-255 check) with HTTP 400 before anything touches the DB. Preflight route mirrors the same gates. Generator layer: `generateGo2rtcConfigBambuA1` re-asserts both invariants and throws so any future caller that bypasses the route still cannot reintroduce the injection sink. Added 5 new test cases covering the reject paths (alphanumeric, whitespace, short, shell meta, bad octet).

### CR-02: Access code flows into go2rtc.yaml at mode 644

**Files modified:** `src/lib/server/services/onboarding.ts`
**Commit:** 8861cb4
**Applied fix:** After `pushFileToContainer` writes `/etc/go2rtc/go2rtc.yaml` for a Bambu camera, issue `chmod 600 /etc/go2rtc/go2rtc.yaml` over SSH on the LXC. Limited to `camera.cameraType === 'bambu'` so the existing Mobotix/Loxone flows remain unchanged. go2rtc runs as root in the container, so 600 keeps the secret on disk without breaking the service. Rotation hook (regenerate yaml on access-code update) left as a separate follow-up per the guidance.

### WR-01: Snapshot cache does not deduplicate concurrent misses

**Files modified:** `src/routes/api/cameras/[id]/a1-snapshot/+server.ts`, `src/routes/api/cameras/[id]/a1-snapshot/server.test.ts`
**Commit:** 26d84d6
**Applied fix:** Per-camera `inflight` Map<number, Promise<Buffer | null>> coalesces simultaneous cache misses onto a single `fetchA1SnapshotJpeg` call. Cache population moved inside the `.then` handler so it only happens once for the shared promise. `.finally` clears the inflight entry regardless of outcome. Added test: two overlapping GETs must trigger exactly one fetch call.

### WR-02: Batch onboarding can reuse VMIDs on concurrent discovery runs

**Files modified:** `src/routes/kameras/onboarding/+page.svelte`
**Commit:** 9249dda
**Applied fix:** The `testData.nextVmid || data.nextVmid + idx` fallback in `batchOnboardPipeline` is now an explicit guard: throw `VMID konnte nicht ermittelt werden` if `testData.nextVmid` is missing. Removes the stale page-load fallback so back-to-back batches cannot collide on the same VMID. Bambu branch was already immune via `BAMBU_PENDING_VMID = 0`.

### WR-03: CameraType type system drift between types.ts and schema.ts

**Files modified:** `src/lib/types.ts`
**Commit:** b2d04f5
**Applied fix:** Replaced the local 6-variant declaration in `types.ts` with a type-only re-export of the 4-variant `CameraType` from `$lib/server/db/schema`. Type-only imports are erased at compile time, so no server-only runtime code leaks into client bundles. svelte-check passes with 0 errors.

### WR-04: bambu-mqtt.ts error handler uses fragile substring precedence

**Files modified:** `src/lib/server/services/bambu-mqtt.ts`
**Commit:** bc0fd7e
**Applied fix:** Switched auth-failure detection to prefer the mqtt library's numeric `err.code` (4 = bad user/password, 5 = not authorized). Fallback textual matches now use word-boundary patterns for `not authorized` and `bad user name or password` so strings like "connack version 5" can no longer spuriously match. All 10 existing bambu-mqtt tests continue to pass. _Requires human verification: logic change. Live traffic on the A1 LAN broker should still flag wrong access codes after the next reconnect attempt._

### WR-05: bambu-a1-camera.mjs buffer growth cap

**Files modified:** `lxc-assets/bambu-a1-camera.mjs`
**Commit:** 8565d39
**Applied fix:** Added `BUF_RUNAWAY_CAP = 10_000_000` and a top-of-loop check that destroys the socket when accumulated buffer exceeds the cap without a valid frame commit. Defends against header-only floods where a compromised printer sends mid-size size headers (say 4 MB each) that never resolve to a valid JPEG. Cap is well above the 5 MB per-frame ceiling so legitimate single frames still pass. Node syntax check passes.

## Skipped Issues

None.

---

_Fixed: 2026-04-20T19:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
