---
phase: 01-foundation-and-proxmox-integration
plan: 03
subsystem: ui
tags: [sveltekit, svelte5, tailwind, dark-theme, sidebar, settings, containers, lucide]

# Dependency graph
requires:
  - phase: 01-foundation-and-proxmox-integration
    provides: "Settings API (GET/PUT /api/settings), Proxmox validate endpoint, types (ContainerInfo, ProxmoxSettings, UnifiSettings)"
  - phase: 01-foundation-and-proxmox-integration
    provides: "Container API (CRUD + lifecycle), listContainers service, containers DB schema"
provides:
  - "Dark-themed app shell with sidebar navigation (Dashboard, Kameras, Settings, Logs)"
  - "Settings page with Proxmox/UniFi/Credentials tabs wired to settings API"
  - "Container card grid with status badges and lifecycle action buttons"
  - "Delete confirmation dialog for container removal"
  - "Configuration banner when Proxmox is not configured"
  - "Reusable UI components: Banner, InlineAlert, StatusBadge"
affects: [phase-02-camera-discovery, phase-04-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Svelte 5 runes ($state, $derived, $props) for all component state"
    - "Dark theme using CSS custom properties (bg-primary, bg-secondary, bg-card, etc.)"
    - "SvelteKit +page.server.ts for server-side data loading"
    - "Client-side fetch to API routes for mutations (settings save, container actions)"
    - "invalidateAll() for data refresh after mutations"

key-files:
  created:
    - src/lib/components/layout/Sidebar.svelte
    - src/lib/components/layout/AppShell.svelte
    - src/lib/components/ui/Banner.svelte
    - src/lib/components/ui/InlineAlert.svelte
    - src/lib/components/ui/StatusBadge.svelte
    - src/lib/components/settings/ProxmoxTab.svelte
    - src/lib/components/settings/UnifiTab.svelte
    - src/lib/components/settings/CredentialsTab.svelte
    - src/lib/components/containers/ContainerCard.svelte
    - src/lib/components/containers/ContainerGrid.svelte
    - src/lib/components/containers/DeleteConfirmDialog.svelte
    - src/routes/+layout.server.ts
    - src/routes/settings/+page.svelte
    - src/routes/settings/+page.server.ts
    - src/routes/kameras/+page.svelte
    - src/routes/kameras/+page.server.ts
    - src/routes/logs/+page.svelte
  modified:
    - src/routes/+layout.svelte
    - src/routes/+page.svelte
    - src/app.html

key-decisions:
  - "Used simple custom tab implementation instead of bits-ui Tabs for lower complexity"
  - "Stored camera credentials as settings with credential_ prefix for Phase 1 simplicity"
  - "Used $derived for dynamic icon component in InlineAlert (Svelte 5 pattern)"

patterns-established:
  - "Component directory structure: layout/, ui/, settings/, containers/"
  - "Form pattern: $state for fields, async handleSave with fetch, InlineAlert feedback"
  - "Container action pattern: onAction callback, fetch POST/DELETE, invalidateAll refresh"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03, INFRA-04, LXC-05, LXC-06]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 01 Plan 03: Web UI Summary

**Dark-themed SvelteKit app shell with sidebar navigation, tabbed settings page (Proxmox/UniFi/Credentials), and container card grid with lifecycle actions -- all wired to backend APIs from Plans 01 and 02**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T13:13:49Z
- **Completed:** 2026-03-22T13:17:47Z
- **Tasks:** 3 (of 3 auto tasks; checkpoint pending)
- **Files modified:** 20

## Accomplishments

- App shell with fixed sidebar navigation (4 areas: Dashboard, Kameras, Settings, Logs) with active link highlighting
- Settings page with 3 tabs: Proxmox (6 fields with auto-validation), UniFi (3 fields), Credentials (add/list)
- Container card grid with status badges (running/stopped/error), CPU/RAM display, and action buttons (start/stop/restart/delete)
- Delete confirmation dialog with German-language text
- Configuration banner shown when Proxmox is not configured

## Task Commits

Each task was committed atomically:

1. **Task 1: App shell layout with sidebar navigation and placeholder pages** - `2254f3f` (feat)
2. **Task 2: Tabbed settings page with Proxmox, UniFi, and Credentials forms** - `28cad70` (feat)
3. **Task 3: Container card grid with status badges and lifecycle actions** - `b666c47` (feat)

## Files Created/Modified

- `src/lib/components/layout/Sidebar.svelte` - Fixed left sidebar with 4 nav links and active highlighting
- `src/lib/components/layout/AppShell.svelte` - Flex layout wrapping sidebar + main content
- `src/lib/components/ui/Banner.svelte` - Info banner with message and link
- `src/lib/components/ui/InlineAlert.svelte` - Success/error/info inline feedback
- `src/lib/components/ui/StatusBadge.svelte` - Color-coded container status pill
- `src/lib/components/settings/ProxmoxTab.svelte` - 6-field form with validation feedback
- `src/lib/components/settings/UnifiTab.svelte` - 3-field form for UDM connection
- `src/lib/components/settings/CredentialsTab.svelte` - Credential add form and saved list
- `src/lib/components/containers/ContainerCard.svelte` - Card with status, info, action buttons
- `src/lib/components/containers/ContainerGrid.svelte` - Responsive grid with delete dialog management
- `src/lib/components/containers/DeleteConfirmDialog.svelte` - Modal confirmation for container deletion
- `src/routes/+layout.svelte` - Updated with AppShell and configuration Banner
- `src/routes/+layout.server.ts` - Server load for config status (proxmox/unifi)
- `src/routes/+page.svelte` - Dashboard placeholder
- `src/routes/logs/+page.svelte` - Logs placeholder
- `src/routes/settings/+page.svelte` - Tabbed settings page
- `src/routes/settings/+page.server.ts` - Server load for settings data
- `src/routes/kameras/+page.svelte` - Container grid page with error handling
- `src/routes/kameras/+page.server.ts` - Server load calling listContainers
- `src/app.html` - Added dark background class to body

## Decisions Made

- Used simple custom tab implementation (div with role=tablist, button tabs) instead of bits-ui Tabs -- simpler setup, fewer dependencies
- Stored camera credentials as settings with `credential_` prefix for Phase 1 simplicity -- can be refactored to dedicated credentials table later
- Used `$derived` for dynamic icon component in InlineAlert instead of deprecated `<svelte:component>`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed svelte:component deprecation for Svelte 5 runes mode**
- **Found during:** Task 2 (InlineAlert component)
- **Issue:** `<svelte:component>` is deprecated in Svelte 5 runes mode
- **Fix:** Used `$derived` to create dynamic Icon variable, render directly as `<Icon />`
- **Files modified:** src/lib/components/ui/InlineAlert.svelte
- **Verification:** Build passes without deprecation warning
- **Committed in:** b666c47 (Task 3 commit, along with InlineAlert fix)

**2. [Rule 1 - Bug] Fixed @const invalid placement in InlineAlert**
- **Found during:** Task 3 (build verification)
- **Issue:** `{@const}` cannot be a direct child of a plain `<div>`, only allowed in specific blocks
- **Fix:** Moved dynamic icon resolution to `$derived` in script block
- **Files modified:** src/lib/components/ui/InlineAlert.svelte
- **Verification:** Build passes
- **Committed in:** b666c47 (Task 3 commit)

**3. [Rule 1 - Bug] Fixed a11y nav element with interactive role**
- **Found during:** Task 2 (settings page)
- **Issue:** Non-interactive `<nav>` element cannot have role="tablist"
- **Fix:** Changed to `<div>` with role="tablist"
- **Files modified:** src/routes/settings/+page.svelte
- **Verification:** Build passes without a11y warning
- **Committed in:** 28cad70 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All auto-fixes necessary for Svelte 5 compatibility and a11y. No scope creep.

## Known Stubs

None -- all components are fully wired to backend APIs.

## Issues Encountered

- Svelte 5 `state_referenced_locally` warnings appear for props destructured into `$state()` -- these are intentional (we want initial values captured once, not reactive to parent changes). These are warnings, not errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1 UI is complete and wired to all backend APIs from Plans 01 and 02
- Ready for Phase 2 (camera discovery) which will add cameras to the container grid
- Dashboard and Logs pages are placeholders, to be filled in later phases

---
*Phase: 01-foundation-and-proxmox-integration*
*Completed: 2026-03-22*
