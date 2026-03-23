---
phase: 05-installer-and-distribution
plan: 01
subsystem: infra, auth
tags: [systemd, bash-installer, scrypt, session-auth, sveltekit-hooks]

requires:
  - phase: 01-proxmox-and-settings
    provides: DB schema, settings service, crypto service, settings UI
  - phase: 02-mobotix-camera-pipeline
    provides: camera and container tables in schema

provides:
  - One-line curl|bash installer for fresh install and updates
  - systemd service file running on port 80 with auto-restart
  - Auth service with scrypt password hashing and in-memory sessions
  - Server hooks enforcing auth on all routes
  - Setup page for first-run credential creation or YOLO skip
  - Login page with session cookie authentication
  - Settings Zugangsschutz management section

affects: []

tech-stack:
  added: [node-crypto-scrypt, systemd]
  patterns: [server-hooks-auth-middleware, in-memory-session-map, yolo-mode-flag]

key-files:
  created:
    - install.sh
    - ip-cam-master.service
    - src/lib/server/services/auth.ts
    - src/lib/server/services/auth.test.ts
    - src/hooks.server.ts
    - src/routes/setup/+page.svelte
    - src/routes/setup/+page.server.ts
    - src/routes/login/+page.svelte
    - src/routes/login/+page.server.ts
    - src/routes/api/auth/+server.ts
  modified:
    - src/lib/server/db/schema.ts
    - src/app.d.ts
    - src/routes/+layout.server.ts
    - src/routes/settings/+page.svelte
    - src/routes/settings/+page.server.ts

key-decisions:
  - "scryptSync for password hashing (consistent with existing crypto.ts KDF pattern)"
  - "In-memory session Map (sessions lost on restart = acceptable for homelab, forces re-login after updates)"
  - "YOLO mode via auth_yolo setting in DB (skip all auth when user opts out)"
  - "Single users table with upsert (D-27: only one user ever)"

patterns-established:
  - "Auth middleware: hooks.server.ts checks session cookie, sets locals.authenticated"
  - "YOLO mode: settings flag bypasses all auth checks"
  - "Setup-first redirect: all routes redirect to /setup until user exists or YOLO set"

requirements-completed: [INST-01, INST-02, INST-03, INST-04, INST-05]

duration: 5min
completed: 2026-03-23
---

# Phase 5 Plan 1: Installer and Auth Summary

**One-line curl|bash installer with systemd service, scrypt-based auth with setup/login/YOLO flow, and settings-based credential management**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-23T01:26:46Z
- **Completed:** 2026-03-23T01:32:40Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- Auth service with scrypt password hashing, session management, and YOLO mode passing 11 tests
- Server hooks enforcing auth on all routes with setup-first redirect pattern
- Setup page offering username/password creation or YOLO skip
- Login page with session cookie authentication
- Settings page Zugangsschutz section for changing username, password, or removing auth
- install.sh handling fresh install (Node.js 22, clone, build, migrate, systemd) and updates (pull, rebuild, migrate, restart)
- systemd service file running on port 80 with auto-restart on failure
- Optional SSH key setup for Proxmox host during installation

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth service, DB schema, hooks, and API routes** - `4831746` (test: RED), `feccfe6` (feat: GREEN)
2. **Task 2: Install script and systemd service** - `83373f2` (feat)

## Files Created/Modified
- `install.sh` - One-line installer/updater for Debian/Ubuntu VMs
- `ip-cam-master.service` - systemd unit file running node build/index.js on port 80
- `src/lib/server/services/auth.ts` - Auth service: hashPassword, verifyPassword, createSession, validateSession, YOLO mode
- `src/lib/server/services/auth.test.ts` - 11 tests for auth service
- `src/hooks.server.ts` - Server hooks: auth middleware, setup-first redirect, YOLO bypass
- `src/app.d.ts` - App.Locals type with authenticated, setupComplete, username
- `src/lib/server/db/schema.ts` - Added users table
- `src/routes/+layout.server.ts` - Added authenticated/setupComplete/username to layout data
- `src/routes/setup/+page.svelte` - First-run setup with username/password or YOLO
- `src/routes/setup/+page.server.ts` - Setup actions: create user or enable YOLO
- `src/routes/login/+page.svelte` - Login form with error display
- `src/routes/login/+page.server.ts` - Login action: validate credentials, set session cookie
- `src/routes/api/auth/+server.ts` - Logout API endpoint
- `src/routes/settings/+page.svelte` - Added Zugangsschutz section
- `src/routes/settings/+page.server.ts` - Added changePassword, changeUsername, removeAuth actions

## Decisions Made
- Used scryptSync for password hashing (consistent with existing crypto.ts KDF pattern)
- In-memory session Map instead of DB sessions (acceptable for homelab, forces re-login after restart)
- YOLO mode via auth_yolo setting in settings table (checked in hooks.server.ts)
- Single users table with delete-then-insert for upsert (only one user per D-27)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vitest mock hoisting issue in auth tests**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** vi.mock factory referenced variables declared after the mock (hoisted above declarations)
- **Fix:** Moved all mock functions inside the vi.mock factory callbacks
- **Verification:** All 11 auth tests pass
- **Committed in:** feccfe6 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Standard test infrastructure issue, no scope creep.

## Issues Encountered
- Pre-existing proxmox test failures (SSH key path doesn't exist on dev machine) -- out of scope, unrelated to this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Installer and auth system complete
- App can be deployed to a fresh Proxmox VM via curl|bash
- Auth flow protects web UI with optional YOLO bypass

## Self-Check: PASSED

All 10 created files verified present. All 3 commit hashes (4831746, feccfe6, 83373f2) verified in git log.

---
*Phase: 05-installer-and-distribution*
*Completed: 2026-03-23*
