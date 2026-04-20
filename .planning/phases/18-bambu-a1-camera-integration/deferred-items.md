# Phase 18 — Deferred Items

Items discovered during execution that are out-of-scope for the current task.

## Pre-existing test failures (discovered in Plan 18-01)

**Found during:** Plan 18-01 full `npm test` run
**Not caused by:** any Phase 18 change — reproduced at base commit b240cc7

Failing test files (12 tests across 2 files):
- `src/lib/server/services/onboarding.test.ts` — 8 failing tests
  - `testMobotixConnection > calls SSH ffprobe with correct RTSP URL`
  - `createCameraContainer > calls createContainer + startContainer + waitForContainerReady`
  - `createCameraContainer > discovers container IP via hostname -I`
  - `createCameraContainer > updates camera status to container_created`
  - `configureGo2rtc > runs install commands, pushes config + unit, restarts service`
  - `configureGo2rtc > updates camera status to configured`
  - `verifyStream > calls checkStreamHealth and updates rtspUrl on success`
  - `verifyStream > returns success=false when stream not active`
- `src/lib/server/services/proxmox.test.ts` — 4 failing tests
  - `getProxmoxClient > returns a configured proxmox-api instance`
  - `create > creates a new container via Proxmox API and inserts DB record`
  - `vaapi > configures VAAPI passthrough with dev0 parameter`
  - `delete > stops and deletes a container, removes DB record`

**Disposition:** OUT OF SCOPE for Phase 18. Pre-existing pattern; do not fix in this phase.
Files relevant to Phase 18 (`src/lib/server/db/schema.ts`, `src/lib/server/services/bambu-discovery.ts`, `src/lib/server/services/bambu-discovery.test.ts`) are green — all 10 bambu-discovery tests pass, plus svelte-check reports 0 errors.

## Plan 18-05 re-verification (2026-04-20)

Re-confirmed during Plan 18-05 execution that the same set of pre-existing failures
(plus additional failures in `backup.test.ts`, `update-runner.test.ts`,
`proxmox-validate.test.ts` — totalling 22 failing tests across 6 files at base commit
4494099) reproduces without any Plan 18-05 changes. After Plan 18-05 GREEN:
**12 failed / 171 passed** (added 10 new green Bambu MQTT TUTK tests; net regression = 0).
All five Bambu-specific test files (bambu-mqtt, bambu-preflight, bambu-a1-auth,
bambu-discovery, bambu-credentials) pass 38/38. `tsc --noEmit` exits clean.
