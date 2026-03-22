---
phase: 01-foundation-and-proxmox-integration
plan: 02
subsystem: infra
tags: [proxmox, lxc, vaapi, rest-api, sveltekit]

# Dependency graph
requires:
  - phase: 01-01
    provides: "SvelteKit project, SQLite + Drizzle schema (containers table), settings service, proxmox validate function"
provides:
  - "Full Proxmox LXC container lifecycle: create, configureVaapi, start, stop, restart, delete"
  - "Container list and status merged from Proxmox API + local SQLite"
  - "REST API endpoints for all container operations"
  - "Idempotent container creation (update if VMID exists)"
affects: [01-03, 02-mobotix-pipeline, 03-loxone-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: ["proxmox-api chainable client pattern", "VAAPI dev0 passthrough with as-any type assertion", "API+DB merge pattern for container metadata"]

key-files:
  created:
    - src/lib/server/services/proxmox.test.ts
    - src/routes/api/proxmox/containers/+server.ts
    - src/routes/api/proxmox/containers/[vmid]/+server.ts
    - src/routes/api/proxmox/containers/[vmid]/start/+server.ts
    - src/routes/api/proxmox/containers/[vmid]/stop/+server.ts
    - src/routes/api/proxmox/containers/[vmid]/restart/+server.ts
  modified:
    - src/lib/server/services/proxmox.ts

key-decisions:
  - "Used as-any type assertion for dev0 VAAPI parameter since proxmox-api types lack PVE 8.1 device passthrough"
  - "Added direct fetch fallback for VAAPI config in case proxmox-api client fails on dev0"
  - "Cached node name in module-level variable to avoid repeated nodes.$get() calls"

patterns-established:
  - "Proxmox service pattern: get client + get node name + API call + DB update"
  - "Container REST route pattern: parse vmid, call service, return JSON, catch errors with 500"
  - "Idempotent creation: check existing list, update config if found, create if not"

requirements-completed: [LXC-01, LXC-02, LXC-05, LXC-06, LXC-07]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 01 Plan 02: Proxmox LXC Management Summary

**Full Proxmox LXC lifecycle service with VAAPI passthrough, idempotent creation, and REST API endpoints for container operations**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T13:08:45Z
- **Completed:** 2026-03-22T13:11:41Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Complete Proxmox service with 10 exported functions: getProxmoxClient, getNodeName, createContainer, configureVaapi, startContainer, stopContainer, restartContainer, deleteContainer, listContainers, getContainerStatus
- VAAPI device passthrough configures /dev/dri/renderD128 with mode 0666 (PVE 8.1+ dev0 parameter) with direct API fallback
- Idempotent container creation: existing VMID updates config instead of duplicating
- 10 unit tests with fully mocked proxmox-api covering all operations
- 5 REST API route files exposing all container operations

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for Proxmox LXC management** - `cf56214` (test)
2. **Task 1 GREEN: Implement Proxmox LXC container management service** - `7fd782a` (feat)
3. **Task 2: Container REST API routes** - `802838e` (feat)

_Note: Task 1 followed TDD with RED (failing tests) then GREEN (implementation) commits._

## Files Created/Modified
- `src/lib/server/services/proxmox.ts` - Extended with full LXC lifecycle: create, vaapi, start, stop, restart, delete, list, status
- `src/lib/server/services/proxmox.test.ts` - 10 unit tests with mocked proxmox-api and db
- `src/routes/api/proxmox/containers/+server.ts` - GET list, POST create
- `src/routes/api/proxmox/containers/[vmid]/+server.ts` - GET status, DELETE container
- `src/routes/api/proxmox/containers/[vmid]/start/+server.ts` - POST start
- `src/routes/api/proxmox/containers/[vmid]/stop/+server.ts` - POST stop
- `src/routes/api/proxmox/containers/[vmid]/restart/+server.ts` - POST restart

## Decisions Made
- Used `as any` type assertion for dev0 VAAPI parameter because proxmox-api types were generated before PVE 8.1 added device passthrough (Pitfall 1 from research)
- Added direct fetch fallback for VAAPI config to handle case where proxmox-api client itself rejects the dev0 parameter
- Cached node name in module-level variable (resetNodeCache exported for testing) to avoid O(n) API calls per operation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Proxmox LXC management fully operational (with mocked tests)
- Ready for Plan 03 (UI dashboard) to consume container REST API endpoints
- Ready for Phase 02 (Mobotix pipeline) which needs createContainer + configureVaapi

## Self-Check: PASSED

All 7 files verified present. All 3 commits verified in git log.

---
*Phase: 01-foundation-and-proxmox-integration*
*Completed: 2026-03-22*
