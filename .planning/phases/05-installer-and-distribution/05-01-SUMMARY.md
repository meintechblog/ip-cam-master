---
phase: 05-installer-and-distribution
plan: 01
subsystem: auth
tags: [scrypt, session, yolo, svelte, sveltekit]

requires:
  - phase: 01-foundation
    provides: settings service, db client, schema, AppShell layout
provides:
  - Auth service with scryptSync password hashing and in-memory sessions
  - Hooks middleware protecting all routes except /setup, /login, /api/auth, /api/settings
  - Setup page for first-run user creation with YOLO bypass
  - Login page with credential verification
  - Settings Zugangsschutz tab for password change, auth removal, YOLO toggle
  - Sidebar user info display and logout button
affects: [05-installer-and-distribution]

tech-stack:
  added: []
  patterns: [scryptSync password hashing with salt, in-memory session Map, YOLO mode via DB setting]

key-files:
  created:
    - src/lib/server/services/auth.ts
    - src/lib/server/services/auth.test.ts
    - src/routes/setup/+page.svelte
    - src/routes/setup/+page.server.ts
    - src/routes/login/+page.svelte
    - src/routes/login/+page.server.ts
    - src/routes/api/auth/logout/+server.ts
  modified:
    - src/lib/server/db/schema.ts
    - src/lib/server/db/client.ts
    - src/hooks.server.ts
    - src/app.d.ts
    - src/routes/+layout.server.ts
    - src/routes/+layout.svelte
    - src/routes/settings/+page.svelte
    - src/routes/settings/+page.server.ts
    - src/lib/components/layout/Sidebar.svelte

key-decisions:
  - "scryptSync for password hashing (consistent with existing crypto.ts KDF pattern)"
  - "In-memory session Map (sessions lost on restart, acceptable for homelab)"
  - "YOLO mode via auth_yolo setting in DB (skip all auth when user opts out)"
  - "Single users table with upsert (D-27: only one user ever)"
  - "/api/settings kept public for installer curl POST on fresh install"

patterns-established:
  - "Auth middleware in hooks.server.ts with public path whitelist"
  - "Standalone layout for auth pages (no AppShell) via pathname check"

requirements-completed: [INST-04]

duration: 6min
completed: 2026-03-23
---

# Phase 05 Plan 01: App Authentication Summary

**scryptSync auth with setup/login pages, YOLO bypass mode, in-memory sessions, and settings credential management**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-23T21:32:28Z
- **Completed:** 2026-03-23T21:38:35Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Auth service with scryptSync hashing, in-memory session management, and YOLO mode bypass
- Setup page for first-run user creation with YOLO option, login page with credential verification
- Hooks middleware protecting all routes with public path exceptions for /setup, /login, /api/auth, /api/settings
- Settings Zugangsschutz tab with password change, auth removal, and YOLO toggle

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth service, users table, hooks middleware, and app.d.ts** - `c32ab98` (feat)
2. **Task 2: Setup page, login page, and settings auth section** - `7d61e28` (feat)

## Files Created/Modified
- `src/lib/server/services/auth.ts` - Password hashing (scryptSync), session management, YOLO mode, user CRUD
- `src/lib/server/services/auth.test.ts` - 13 tests covering all auth behaviors
- `src/lib/server/db/schema.ts` - Added users table definition
- `src/lib/server/db/client.ts` - Auto-migration for users table
- `src/hooks.server.ts` - Auth middleware with public path whitelist
- `src/app.d.ts` - Locals interface with user session typing
- `src/routes/setup/+page.svelte` - First-run setup with user creation and YOLO option
- `src/routes/setup/+page.server.ts` - Setup actions: create user, enable YOLO
- `src/routes/login/+page.svelte` - Login form with error display
- `src/routes/login/+page.server.ts` - Login action with password verification
- `src/routes/+layout.server.ts` - Added user and isYolo to layout data
- `src/routes/+layout.svelte` - Conditional standalone layout for auth pages
- `src/routes/settings/+page.svelte` - Added Zugangsschutz tab
- `src/routes/settings/+page.server.ts` - Added changePassword, deleteAuth, toggleYolo actions
- `src/routes/api/auth/logout/+server.ts` - Logout endpoint (delete session, clear cookie)
- `src/lib/components/layout/Sidebar.svelte` - User info display, logout button, YOLO badge

## Decisions Made
- scryptSync for password hashing (consistent with existing crypto.ts KDF pattern)
- In-memory session Map (sessions lost on restart, acceptable for homelab)
- YOLO mode via auth_yolo setting in DB (skip all auth when user opts out)
- Single users table with upsert (D-27: only one user ever)
- /api/settings kept public for installer curl POST on fresh install before user exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auth foundation complete for all app routes
- Install script (05-02) can POST credentials to /api/settings without auth (public path)
- YOLO mode available for users who prefer no access control

## Self-Check: PASSED

All 10 key files verified present. Both task commits (c32ab98, 7d61e28) verified in git log.

---
*Phase: 05-installer-and-distribution*
*Completed: 2026-03-23*
