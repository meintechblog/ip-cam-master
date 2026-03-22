---
phase: 02-mobotix-camera-pipeline
plan: 01
subsystem: api
tags: [ssh, go2rtc, proxmox, lxc, rtsp, vaapi, onboarding, drizzle]

requires:
  - phase: 01-proxmox-foundation
    provides: Proxmox API client, settings service, containers table, crypto module
provides:
  - cameras table with transcode parameters (width/height/fps/bitrate)
  - SSH service for Proxmox host command execution and file transfer
  - go2rtc config generation with VAAPI hardware transcoding
  - Onboarding orchestration (probe, container, configure, verify)
  - 4 POST API routes for onboarding pipeline steps
affects: [02-02-PLAN, 02-03-PLAN, 03-loxone-intercom-pipeline]

tech-stack:
  added: [node-ssh]
  patterns: [pct-exec-ssh-bridge, go2rtc-yaml-generation, onboarding-pipeline-steps]

key-files:
  created:
    - src/lib/server/services/ssh.ts
    - src/lib/server/services/ssh.test.ts
    - src/lib/server/services/go2rtc.ts
    - src/lib/server/services/go2rtc.test.ts
    - src/lib/server/services/onboarding.ts
    - src/lib/server/services/onboarding.test.ts
    - src/routes/api/onboarding/test-connection/+server.ts
    - src/routes/api/onboarding/create-container/+server.ts
    - src/routes/api/onboarding/configure-go2rtc/+server.ts
    - src/routes/api/onboarding/verify-stream/+server.ts
  modified:
    - src/lib/server/db/schema.ts
    - src/lib/types.ts
    - src/lib/server/services/settings.ts

key-decisions:
  - "SSH bridge via pct exec for container commands instead of direct container SSH"
  - "go2rtc config uses hash-param syntax for ffmpeg options per go2rtc conventions"
  - "Camera passwords encrypted at DB layer using existing crypto module"

patterns-established:
  - "SSH-to-container pattern: connectToProxmox -> executeOnContainer/pushFileToContainer"
  - "Onboarding pipeline: testConnection -> createContainer -> configureGo2rtc -> verifyStream"
  - "go2rtc YAML template with VAAPI hardware acceleration flags"

requirements-completed: [LXC-03, G2R-01, G2R-04, G2R-05, G2R-06]

duration: 5min
completed: 2026-03-22
---

# Phase 02 Plan 01: Backend Services Summary

**SSH/go2rtc/onboarding services for Mobotix camera pipeline with pct exec bridge and VAAPI transcoding config**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T17:56:58Z
- **Completed:** 2026-03-22T18:02:20Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- cameras table with full transcode parameters (1280x720, 20fps, 5000kbit/s defaults)
- SSH service bridging to LXC containers via Proxmox host pct exec/push commands
- go2rtc YAML config generation with VAAPI hardware acceleration for Mobotix MJPEG-to-H264
- Onboarding orchestration: camera probe via ffprobe, container provisioning, go2rtc install+config, stream health verification
- 4 API routes exposing each pipeline step as POST endpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: DB schema + types + SSH/go2rtc services** - `5336e15` (feat)
2. **Task 2: Onboarding orchestration + API routes** - `935c58f` (feat)

## Files Created/Modified
- `src/lib/server/db/schema.ts` - Added cameras table with transcode params
- `src/lib/types.ts` - Added Camera, TranscodeParams, OnboardingState, StreamInfo types
- `src/lib/server/services/settings.ts` - Added proxmox_ssh_password to SENSITIVE_KEYS
- `src/lib/server/services/ssh.ts` - SSH connection, pct exec, pct push, readiness polling
- `src/lib/server/services/ssh.test.ts` - 7 tests for SSH service
- `src/lib/server/services/go2rtc.ts` - YAML config gen, systemd unit, install commands, health check
- `src/lib/server/services/go2rtc.test.ts` - 10 tests for go2rtc service
- `src/lib/server/services/onboarding.ts` - 5-step pipeline orchestration
- `src/lib/server/services/onboarding.test.ts` - 10 tests for onboarding service
- `src/routes/api/onboarding/test-connection/+server.ts` - POST camera probe
- `src/routes/api/onboarding/create-container/+server.ts` - POST container creation
- `src/routes/api/onboarding/configure-go2rtc/+server.ts` - POST go2rtc setup
- `src/routes/api/onboarding/verify-stream/+server.ts` - POST stream verification

## Decisions Made
- SSH bridge via pct exec: commands execute on Proxmox host which proxies into containers, avoiding direct container SSH config
- go2rtc config uses hash-param syntax (#video=h264#hardware=vaapi) matching go2rtc native format
- Camera passwords encrypted at DB layer using existing crypto module before storage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed NodeSSH mock in test**
- **Found during:** Task 1 (SSH test execution)
- **Issue:** vi.fn().mockImplementation() with arrow function not usable as constructor; vi.hoisted needed for class mock
- **Fix:** Used vi.hoisted() with inline class definition for NodeSSH mock
- **Files modified:** src/lib/server/services/ssh.test.ts
- **Verification:** All 7 SSH tests pass
- **Committed in:** 5336e15

---

**Total deviations:** 1 auto-fixed (1 bug in test setup)
**Impact on plan:** Minimal -- test mock pattern fix only. No scope creep.

## Issues Encountered
None beyond the test mock fix documented above.

## Known Stubs
None -- all services are fully implemented with real logic, not placeholder data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All backend services ready for the wizard UI (Plan 02) to call
- API routes follow established SvelteKit patterns from Phase 1
- 56 total tests passing, build clean

---
*Phase: 02-mobotix-camera-pipeline*
*Completed: 2026-03-22*
