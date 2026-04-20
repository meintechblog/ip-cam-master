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
