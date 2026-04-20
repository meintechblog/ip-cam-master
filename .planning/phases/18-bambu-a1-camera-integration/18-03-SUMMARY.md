---
phase: 18-bambu-a1-camera-integration
plan: 03
subsystem: streaming
tags: [bambu, a1, go2rtc, lxc, onboarding, tls, mjpeg, runtime-ingestion]

requires:
  - phase: 18-bambu-a1-camera-integration
    plan: 01
    provides: cameras.model column + PRINTER_CAPABILITIES export (reads model for the A1 branch split)
  - phase: 18-bambu-a1-camera-integration
    plan: 02
    provides: src/lib/server/services/bambu-a1-auth.ts + golden fixture (mirrored byte-for-byte in the inline buildAuth of the .mjs — pipeline regression guard)
  - phase: 12
    provides: configureGo2rtc + pushFileToContainer + getInstallCommands scaffolding this plan extends

provides:
  - lxc-assets/bambu-a1-camera.mjs — stdlib-only JPEG-over-TLS ingestion, SIGTERM-safe, raw-JPEG stdout
  - generateGo2rtcConfigBambuA1 — exec:env yaml generator with mandatory killsignal/killtimeout
  - getInstallCommands(forBambuA1) — optional NodeSource Node 22 install hoist
  - configureGo2rtc A1 branch — deploys .mjs + emits A1 yaml via pushFileToContainer
  - 4 new go2rtc.test.ts cases asserting yaml structural shape + install hoist semantics

affects:
  - 18-04-bambu-a1-preflight (independent of this plan; no code-level interaction)
  - 18-05-bambu-a1-mqtt-watch (independent)
  - 18-06-bambu-a1-snapshot-ui (snapshot endpoint is separate; this plan handles the continuous ingestion path only)

tech-stack:
  added: []
  patterns:
    - "go2rtc exec: pipe transport with #killsignal=15#killtimeout=5 — SIGKILL-default workaround (RESEARCH Pitfall 2)"
    - "Env-var cred passing in exec: yaml (env A1_ACCESS_CODE=<code> node ...) instead of CLI arg — prevents ps-ax leak (Anti-Pattern 4)"
    - "Repo-shipped .mjs runtime asset deployed via readFileSync(import.meta.url) + pushFileToContainer — parallels the existing nginx/onvif config-push pattern"
    - "Conditional install-command hoist keyed on a domain-level predicate (camera.cameraType === 'bambu' && camera.model === 'A1') — one-line branch, zero impact on non-A1 paths"

key-files:
  created:
    - lxc-assets/bambu-a1-camera.mjs
  modified:
    - src/lib/server/services/go2rtc.ts
    - src/lib/server/services/go2rtc.test.ts
    - src/lib/server/services/onboarding.ts
    - src/lib/server/services/onboarding.test.ts
    - src/lib/types.ts

key-decisions:
  - "Added `model: string | null` to the hand-written Camera interface in src/lib/types.ts. Rule 3 (Blocking): required for camera.model === 'A1' to type-check. Mirrors the Drizzle schema column landed in Plan 18-01."
  - "Kept the A1 yaml generator minimal — no ffmpeg block, no -low alias stream. go2rtc's magic.Open auto-detects MJPEG from the FF D8 SOI; RTSPS-on-:8554 fan-out and any downstream transcoding are go2rtc-internal concerns (RESEARCH §Gap 1)."
  - "Used relative-URL `import.meta.url` resolution for the .mjs asset (not a $lib/ alias), matching the Loxone nginx deploy already in this file."

patterns-established:
  - "Binary-payload capture-to-stdout runtime asset pattern: a stdlib-only .mjs shipped from the repo, deployed on-demand to the LXC, and invoked by go2rtc's exec: — no systemd unit, no npm install in the LXC, no wrapper."
  - "SIGTERM lifecycle for go2rtc child processes: explicit `#killsignal=15#killtimeout=5` on the yaml + matching `process.on('SIGTERM')` + 500ms exit delay in the child — reusable for any future TLS-heavy producer."

requirements-completed: [BAMBU-A1-08, BAMBU-A1-09]

duration: 9min
completed: 2026-04-20
---

# Phase 18 Plan 03: Bambu A1 Runtime Ingestion Summary

**go2rtc spawns a 116-LOC Node.js JPEG-over-TLS ingestion script inside the camera LXC; the stdout pipe becomes an MJPEG stream auto-detected by go2rtc and re-exposed as RTSP :8554. A1 adoption is now functionally wired end-to-end except for the preflight and UI surfaces.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-20T15:32:27Z
- **Tasks:** 3 (one TDD split into RED + GREEN commits)
- **Commits:** 4

## Task Commits

| # | Task | Type | Hash | Files |
|---|------|------|------|-------|
| 1 | Create lxc-assets/bambu-a1-camera.mjs ingestion script | feat | `67ffbc3` | lxc-assets/bambu-a1-camera.mjs (new, 116 LOC) |
| 2a | RED: add failing tests for A1 generator + install hoist | test | `224ca1a` | src/lib/server/services/go2rtc.test.ts |
| 2b | GREEN: implement generateGo2rtcConfigBambuA1 + hoist | feat | `e806527` | src/lib/server/services/go2rtc.ts |
| 3 | Branch configureGo2rtc for A1 — deploy .mjs + hoist Node | feat | `c206083` | onboarding.ts + onboarding.test.ts + types.ts |

## Final LOC & Diff vs Spike 004

| File | LOC | Delta vs spike/probe.mjs |
|------|-----|---------------------------|
| `.planning/spikes/004-a1-stream-fallback/probe.mjs` | 158 | (baseline) |
| `lxc-assets/bambu-a1-camera.mjs` | 116 | −42 lines |

**Changes vs probe.mjs** (per PATTERNS §"lxc-assets/bambu-a1-camera.mjs"):

1. Dropped `fs` import and all disk I/O — stdout replaces `fs.writeFileSync`.
2. Dropped `readJpegDimensions` (diagnostic only).
3. Dropped peer-cert logging (diagnostic only).
4. Dropped log buffer / probe-log.txt writeback.
5. IP now comes from `--ip=` CLI arg instead of `A1_IP` env var (the env var is reserved exclusively for the access code).
6. Added SIGTERM / SIGINT handler (`shutdown` fn with `shuttingDown` guard + 500ms exit delay).
7. Added `socket.on('error'/'close') → process.exit(1)` so go2rtc respawns on transient failures.
8. Kept frame-parser kernel (probe.mjs:103-113) byte-for-byte.
9. Kept `buildAuth` byte-for-byte (with the u32 LE 0x3000 guard comment carried over).

## Example Output: `generateGo2rtcConfigBambuA1(...)`

With dummy creds (`streamName: 'cam-2001'`, `printerIp: '192.168.3.195'`, `accessCode: 'demo1234'`, `rtspAuth: { username: 'bambu', password: 'demo1234' }`):

```yaml
streams:
  cam-2001:
    - exec:env A1_ACCESS_CODE=demo1234 node /opt/ipcm/bambu-a1-camera.mjs --ip=192.168.3.195#killsignal=15#killtimeout=5

rtsp:
  listen: ":8554"
  username: 'bambu'
  password: 'demo1234'

log:
  level: info
```

Structural invariants enforced by tests:
- `exec:env A1_ACCESS_CODE=<code>` (env-var cred — no CLI leak)
- `node /opt/ipcm/bambu-a1-camera.mjs` (script path matches pushFileToContainer destination)
- `--ip=<ip>` (IP passed via argv; safe to appear in `ps ax`)
- `#killsignal=15` + `#killtimeout=5` (mandatory per Pitfall 2)
- **NO** `--access-code=` anywhere (negative test — prevents ps-ax leak)

## `configureGo2rtc` Branch Decision Table

| `camera.cameraType` | `camera.model` | Install hoist | Generator | Extra deploy steps |
|---------------------|---------------|---------------|-----------|-------------------|
| `bambu` | `'A1'` | `getInstallCommands(true)` — adds NodeSource install | `generateGo2rtcConfigBambuA1` | `mkdir -p /opt/ipcm` + `pushFileToContainer(…, '/opt/ipcm/bambu-a1-camera.mjs')` |
| `bambu` | `'H2C'` / `'O1C2'` / `'H2D'` / `'X1C'` / `'P1S'` | `getInstallCommands(false)` | `generateGo2rtcConfigBambu` (existing) | none |
| `bambu` | `null` (pre-Phase-18 row) | `getInstallCommands(false)` | `generateGo2rtcConfigBambu` (existing) | none — null = assume H2C for back-compat |
| `mobotix` / `loxone` | (ignored) | `getInstallCommands(false)` | existing per-type generator | unchanged |

The install hoist fires only on fresh-install paths (`skipInstall === false`); template-clone paths already have Node from a prior camera's ONVIF step, so no change there.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added `model: string | null` to the `Camera` interface in `src/lib/types.ts`.**

- **Found during:** Task 3 (configureGo2rtc branch writes `camera.model === 'A1'`).
- **Issue:** The plan's Task 3 action #2 says "Confirm `camera.model` is accessible on the `camera` argument type — Plan 01 added it to the schema, so the inferred type now includes `model: string | null`." In practice, the `Camera` interface in `src/lib/types.ts` is **hand-written**, not inferred from the Drizzle schema, so Plan 01's schema change did not automatically flow through. `camera.model === 'A1'` would have been a TS error.
- **Fix:** Added a single nullable `model: string | null` field to the interface (between `serialNumber` and `printState`) with a comment pointing at the Plan 18-01 schema column it mirrors. No runtime behavior change — just unblocks the type check.
- **Files modified:** `src/lib/types.ts`.
- **Committed in:** `c206083` (Task 3 commit).
- **Verification:** `npm run check` reports **0 errors** (23 pre-existing warnings unchanged).

**2. [Rule 3 — Blocking] Extended the `./go2rtc` vi.mock in `onboarding.test.ts` with `generateGo2rtcConfigBambu` and `generateGo2rtcConfigBambuA1`.**

- **Found during:** Task 3 (running onboarding.test.ts after the onboarding.ts edit).
- **Issue:** The mock was missing both the existing `generateGo2rtcConfigBambu` and the new `generateGo2rtcConfigBambuA1` exports; the A1 branch (and the H2C branch) would throw at import time when the tests exercised Bambu paths.
- **Fix:** Added both as `vi.fn().mockReturnValue(…)`.
- **Files modified:** `src/lib/server/services/onboarding.test.ts`.
- **Committed in:** `c206083`.
- **Verification:** `onboarding.test.ts` shows **2 passed | 8 pre-existing failures** — identical to the baseline measured before any edits in this plan (see "Pre-existing Issues" below).

---

**Total deviations:** 2 auto-fixed (both blocking type-/mock-correctness fixes). **No architectural changes required** — neither touched the external interface of the plan or the threat-model surface.

## Pre-existing Issues (Not Caused by This Plan)

`src/lib/server/services/onboarding.test.ts` has 8 pre-existing failing tests, all in unrelated areas (`createCameraContainer`, `configureGo2rtc` for Mobotix, `verifyStream`, `saveCameraRecord`, `getNextVmid`). These are documented in Plan 18-01's SUMMARY (§Issues Encountered) as pre-existing at base commit `b240cc7` before Phase 18 started. This plan's edits did not add to the failure count; baseline and post-plan counts both show `8 failed | 2 passed`.

Also `.planning/phases/18-bambu-a1-camera-integration/deferred-items.md` already tracks these.

## Verification

- **`node --check lxc-assets/bambu-a1-camera.mjs`** → exits 0 (script parses as ES module).
- **`npm run test:unit -- --run src/lib/server/services/go2rtc.test.ts`** → **13 passed (9 existing + 4 new)**, 0 failures.
- **`npm run test:unit -- --run src/lib/server/services/onboarding.test.ts`** → **2 passed | 8 pre-existing failures** (matches baseline).
- **`npm run check`** (svelte-check) → **0 errors, 23 pre-existing warnings** (matches baseline).
- **Smoke run** (`A1_ACCESS_CODE=PLACEHOLDER node lxc-assets/bambu-a1-camera.mjs --ip=127.0.0.1`) → TLS connect to 127.0.0.1:6000 refused; `[a1-cam] socket error: connect ECONNREFUSED 127.0.0.1:6000` on stderr; exit 1; `PLACEHOLDER` never appears in any output (confirming T-18-12 mitigation).
- **Missing-args smoke** (`node lxc-assets/bambu-a1-camera.mjs`) → `[a1-cam] Missing --ip or A1_ACCESS_CODE` on stderr; exit 2.

### Structural Grep Audit

All plan-specified assertions pass:

```
PASS: import tls from 'node:tls'
PASS: no fs import (stdlib-only but no unnecessary stdlib)
PASS: writeUInt32LE(0x3000, 4)
PASS: process.env.A1_ACCESS_CODE
PASS: no --access-code= anywhere in the script
PASS: rejectUnauthorized: false
PASS: process.on('SIGTERM'
PASS: process.stdout.write
PASS: no multipart / boundary / content-type artifacts

go2rtc.ts:
PASS: export function generateGo2rtcConfigBambuA1
PASS: exec:env A1_ACCESS_CODE=
PASS: #killsignal=15#killtimeout=5
PASS: forBambuA1 = false
PASS: nodesource.com/setup_22.x

onboarding.ts:
PASS: import { readFileSync } from 'node:fs'
PASS: generateGo2rtcConfigBambuA1 imported and used
PASS: camera.model === 'A1'
PASS: /opt/ipcm/bambu-a1-camera.mjs path
PASS: mkdir -p /opt/ipcm
PASS: getInstallCommands(isBambuA1)
```

## Security / Threat-Model Coverage

All mitigations declared in the plan's `<threat_model>` are implemented in the committed code:

- **T-18-07 (access code via `ps ax`)** — mitigated. Yaml emits `env A1_ACCESS_CODE=…` prefix; generator test `expect(yaml).not.toContain('--access-code=')` is green.
- **T-18-10 (SIGKILL-default → orphaned TLS session)** — mitigated. Yaml emits `#killsignal=15#killtimeout=5`; script handles SIGTERM with `socket.end()` + 500ms exit delay.
- **T-18-12 (access code leak in error paths)** — mitigated. No `A1_ACCESS_CODE` reference in any error path; only `err.message` is stderr-written; smoke run confirms `PLACEHOLDER` never leaks.
- **T-18-13 (malformed frame DoS)** — mitigated. `size === 0 || size > 5_000_000` sanity guard kept verbatim from spike; triggers `socket.destroy()` + `process.exit(1)` → go2rtc respawn.

Accept-disposition threats (T-18-08, T-18-09, T-18-11) are unchanged from the existing H2C trust model.

## Downstream Consumers Unblocked

- **Live A1 onboarding UAT (Plan 18-06 §manual verification):** a real A1 printer at `192.168.3.195` can now be onboarded end-to-end through the existing wizard → LXC is provisioned → Node is installed → `/opt/ipcm/bambu-a1-camera.mjs` is deployed → go2rtc starts → TLS:6000 handshake → first JPEG on stdout → RTSP:8554 consumable by Protect/VLC. Only the Plan 04 (preflight) and Plan 06 (UI/snapshot) surfaces remain.
- **Plan 18-04 (preflight model-split):** no direct code dependency; this plan does not alter `bambu-preflight.ts`. Plan 04 can run independently once Wave 2 clears.
- **Plan 18-05 (MQTT TUTK watch):** no direct code dependency; same.
- **Plan 18-06 (snapshot + UI):** snapshot endpoint uses a separate code path (`bambu-a1-camera.ts` service + `/api/cameras/:id/a1-snapshot/+server.ts`), not this one. UI capability gating uses `PRINTER_CAPABILITIES` from Plan 01. No coupling to this plan beyond the capabilities map which is already landed.

## Next Phase Readiness

- Wave 2 ingestion-path plan is complete on the runtime axis.
- Plans 18-04 and 18-05 in the same wave are independent and can run in parallel to this one.
- Wave 3 (Plan 06) depends only on Plans 04 + 05 landing, not on this plan's onboarding edits.
- No blockers, no open concerns.

## Self-Check: PASSED

- `lxc-assets/bambu-a1-camera.mjs` — FOUND (116 LOC, parses, all structural checks green)
- `src/lib/server/services/go2rtc.ts` — FOUND (A1 generator + hoist)
- `src/lib/server/services/go2rtc.test.ts` — FOUND (4 new tests added)
- `src/lib/server/services/onboarding.ts` — FOUND (A1 branch + readFileSync import)
- `src/lib/server/services/onboarding.test.ts` — FOUND (mock extended)
- `src/lib/types.ts` — FOUND (model field added to Camera)
- Commit `67ffbc3` — FOUND (Task 1: .mjs)
- Commit `224ca1a` — FOUND (Task 2 RED)
- Commit `e806527` — FOUND (Task 2 GREEN)
- Commit `c206083` — FOUND (Task 3)

---

*Phase: 18-bambu-a1-camera-integration*
*Completed: 2026-04-20*
