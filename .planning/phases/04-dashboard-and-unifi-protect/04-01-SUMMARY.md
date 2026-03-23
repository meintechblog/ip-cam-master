---
phase: 04-dashboard-and-unifi-protect
plan: 01
subsystem: api
tags: [unifi-protect, events, ssh, sqlite, drizzle, fetch]

requires:
  - phase: 01-foundation
    provides: "DB schema (cameras, settings, credentials), settings service, crypto service, SSH service"
provides:
  - "Protect API client with session management and 30s cache"
  - "Event storage/retrieval with filtering, pagination, flapping detection"
  - "UDM SSH log parser for disconnect/reconnect/error events"
  - "Events table in DB schema"
  - "ProtectCamera, ProtectCameraMatch, ProtectStatus, CameraEvent types"
affects: [04-02, 04-03]

tech-stack:
  added: []
  patterns: ["Cookie-based Protect API session with 401 retry", "Module-level cache with TTL", "SSH log parsing with noise filtering"]

key-files:
  created:
    - src/lib/server/services/protect.ts
    - src/lib/server/services/events.ts
    - src/lib/server/services/udm-logs.ts
  modified:
    - src/lib/server/db/schema.ts
    - src/lib/types.ts

key-decisions:
  - "Direct fetch() to Protect REST API instead of unifi-protect npm package (simpler, no WebSocket overhead)"
  - "30s cache TTL for Protect status to prevent API overload from 10s frontend poll"
  - "SQLite datetime() functions for flapping/cleanup instead of JS date math"

patterns-established:
  - "Protect API session: module-level session variable with auto-refresh on expiry and 401 retry"
  - "Camera matching: containerIp for pipeline cameras, camera IP for native ONVIF"
  - "Event storage: drizzle insert/select with typed filters and pagination"
  - "UDM SSH: connect per scan, dispose in finally, parse with regex patterns, filter noise"

requirements-completed: [DASH-03, DASH-06, ONBD-05]

duration: 3min
completed: 2026-03-23
---

# Phase 4 Plan 1: Protect API, Events, and UDM Logs Summary

**UniFi Protect API client with cookie auth and 30s cache, SQLite event system with flapping detection, and UDM SSH log parser for disconnect/error monitoring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-23T12:13:33Z
- **Completed:** 2026-03-23T12:16:22Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Protect API service authenticates with UDM via cookie-based sessions, fetches cameras, matches them to our DB by IP, and caches status for 30s
- Events service stores/retrieves events with filtering (camera, severity, type, date range), pagination, flapping detection (>3 disconnects in 10min), and 30-day cleanup
- UDM log parser connects via SSH, reads cameras.thirdParty.log, extracts structured events with noise filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Add events table to DB schema and Protect/Event types** - `a812dd9` (feat)
2. **Task 2: Create Protect API service with session management, camera matching, and 30s cache** - `7efbbd3` (feat)
3. **Task 3: Create events service and UDM log parser** - `80958b1` (feat)

## Files Created/Modified
- `src/lib/server/db/schema.ts` - Added events table (id, cameraId, cameraName, eventType, severity, message, source, timestamp)
- `src/lib/types.ts` - Added ProtectCamera, ProtectCameraMatch, ProtectStatus, CameraEvent interfaces and EventType/Severity/Source union types. Extended CameraCardData with protectStatus and flapping fields.
- `src/lib/server/services/protect.ts` - Protect API client: login with cookie auth, protectFetch with 401 retry, getProtectCameras, matchCamerasToProtect (by IP), getProtectStatus (30s cache), verifyOnvifServer
- `src/lib/server/services/events.ts` - Event CRUD: storeEvent/storeEvents, getEvents (filtered/paginated), detectFlapping, getFlappingCameras, cleanupOldEvents (30-day retention)
- `src/lib/server/services/udm-logs.ts` - UDM SSH log parser: scanUdmLogs (tail -500, parse, filter noise), parseLogLines (regex for disconnect/reconnect/stream_failed/adoption/aiport_error), fetchRawProtectLogs (on-demand raw logs)

## Decisions Made
- Used direct fetch() to Protect REST API instead of unifi-protect npm package -- simpler, no WebSocket overhead, only 3 endpoints needed
- 30s cache TTL for Protect status so the 10s frontend poll does not overwhelm the Protect API
- Used SQLite datetime() functions for flapping detection and cleanup queries instead of JS date math

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-kit push requires interactive TTY**
- **Found during:** Task 1 (schema push)
- **Issue:** `npx drizzle-kit push` failed in non-interactive shell (requires TTY for column conflict prompts)
- **Fix:** Created events table directly via better-sqlite3 SQL (CREATE TABLE IF NOT EXISTS)
- **Files modified:** None (runtime database only)
- **Verification:** Table created successfully with all 8 columns confirmed via pragma table_info

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Workaround for non-interactive shell. Table schema matches drizzle schema definition exactly.

## Issues Encountered
None beyond the drizzle-kit TTY issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three backend services ready for API routes in Plan 02 (protect/cameras, protect/events, logs/protect endpoints)
- Types and schema ready for UI enhancements in Plan 03 (CameraCardData.protectStatus, flapping)
- Events table created in database, ready for event storage

---
*Phase: 04-dashboard-and-unifi-protect*
*Completed: 2026-03-23*
