---
phase: 08-version-awareness-update-check
plan: 01
subsystem: version-awareness
tags: [version, update-check, scheduler, settings-ui, github-api]
dependency_graph:
  requires:
    - src/lib/server/services/settings.ts
    - src/lib/server/services/scheduler.ts
    - src/lib/components/layout/AppShell.svelte
    - src/routes/settings/+page.svelte
  provides:
    - src/lib/server/services/version.ts
    - src/lib/server/services/update-check.ts
    - src/routes/api/update/status/+server.ts
    - src/routes/api/update/check/+server.ts
    - src/lib/components/settings/VersionTab.svelte
    - src/lib/components/layout/UpdateBadge.svelte
  affects:
    - src/lib/server/services/scheduler.ts
    - src/lib/components/layout/AppShell.svelte
    - src/routes/settings/+page.svelte
tech-stack:
  added: []
  patterns:
    - node:child_process.execFile promisified for git shell-out
    - In-process module-level cache for version info
    - Discriminated union for UpdateCheckResult (success vs. 3 error variants)
    - Settings table used as key/value persistence for cross-request state
    - SvelteKit API routes returning 200 with error in body (no HTTP error codes for checks)
    - Svelte 5 runes ($state, $effect, $derived) with cleanup returned from $effect
    - setTimeout(30s) -> setInterval(24h) scheduler pattern for delayed-start periodic jobs
key-files:
  created:
    - src/lib/server/services/version.ts
    - src/lib/server/services/version.test.ts
    - src/lib/server/services/update-check.ts
    - src/lib/server/services/update-check.test.ts
    - src/routes/api/update/status/+server.ts
    - src/routes/api/update/check/+server.ts
    - src/lib/components/settings/VersionTab.svelte
    - src/lib/components/layout/UpdateBadge.svelte
  modified:
    - src/lib/server/services/scheduler.ts
    - src/routes/settings/+page.svelte
    - src/lib/components/layout/AppShell.svelte
decisions:
  - Zero new npm dependencies — node:child_process + built-in fetch cover everything
  - Module-level in-process cache for getCurrentVersion() (not settings-backed) since it never changes after boot
  - Rate-limit and network errors return 200 with error in body so badge polling never shows HTTP errors
  - Badge polls /api/update/status every 5 minutes from the layout — does NOT call GitHub live
  - Scheduler skips the update check entirely in dev mode rather than calling fetch and getting dev_mode error
  - UpdateBadge links to /settings (not /settings?tab=Version) since the page does not read query params
metrics:
  duration: "~8 minutes"
  tasks: 5
  files_created: 8
  files_modified: 3
  tests_added: 20
  date_completed: 2026-04-10
---

# Phase 08 Plan 01: Version Awareness & Update Check Summary

## One-liner

Read-only version awareness and daily GitHub update-check using node:child_process git shell-out, built-in fetch, and settings-table persistence — wired into a settings Version tab and a header badge.

## What Was Built

### Task 1: Version service (commit 77f19fb)

`src/lib/server/services/version.ts` exports `getCurrentVersion()`, `parseDescribe()`, `formatVersionLabel()`, `resetVersionCacheForTests()`, and `type VersionInfo`. It shells out to `git describe --tags --always --dirty --abbrev=7` and `git rev-parse HEAD` via promisified `execFile`, picking the first candidate dir (`/opt/ip-cam-master`, then `process.cwd()`) whose `.git` exists. Result is cached in a module-level variable after the first call. If no `.git` directory is reachable or any git command throws, it falls back to a `{ isDev: true, version: 'dev', sha: 'unknown' }` shape — it never throws.

13 vitest cases cover parse (tag+commits+sha, tag-only, bare sha, dirty suffix, garbage), format (all 5 branches), and dev-mode fallback + cache behavior. `existsSync` is mocked via `vi.mock('node:fs', ...)` to drive the dev fallback test.

### Task 2: Update-check service (commit 39cd057)

`src/lib/server/services/update-check.ts` exports `checkForUpdate()`, `getStoredUpdateStatus()`, and the `UpdateCheckResult` discriminated union. `checkForUpdate()` calls the unauthenticated `https://api.github.com/repos/meintechblog/ip-cam-master/commits/main` endpoint with a 10-second AbortController timeout.

Behavior:
- Success → persists 5 settings keys (`update_last_checked_at`, `update_latest_sha`, `update_latest_commit_date`, `update_latest_commit_message`, `update_last_error=''`) and returns `{ error: null, ... }`.
- `hasUpdate = current.sha !== latestSha && !current.isDirty`.
- Dirty working tree → still persists latest values but sets `hasUpdate=false` and `warning='dirty'`.
- 403 + `x-ratelimit-remaining=0` → parses `x-ratelimit-reset` (unix seconds), returns `{ error: 'rate_limited', resetAt }`, and persists ONLY `update_last_error=rate_limited:<iso>`. Does not overwrite latest-sha.
- Fetch throws or non-200 non-403 → `{ error: 'network', message }` and persists ONLY `update_last_error='network'`.
- Dev mode → returns `{ error: 'dev_mode' }` without calling fetch or settings.
- Commit message is truncated to first line, max 200 chars.

`getStoredUpdateStatus()` reads via `getSettings('update_')` in parallel with `getCurrentVersion()` and composes the display shape.

7 vitest cases with mocked `./version`, `./settings`, and stubbed global `fetch` cover all branches.

### Task 3: API endpoints (commit 07c9891)

- `GET /api/update/status` reads `getStoredUpdateStatus()` and serializes it with a `current.label` computed via `formatVersionLabel`.
- `POST /api/update/check` calls `checkForUpdate()` then re-reads `getStoredUpdateStatus()` so the UI gets a single canonical shape regardless of success/error.

Both return 200 even on check errors — the error is expressed in the body so the badge polling never surfaces HTTP failures. Both endpoints are auth-gated via the existing `hooks.server.ts` (they are not in `isPublicPath`).

### Task 4: Settings Version tab UI (commit 54cd702)

`src/lib/components/settings/VersionTab.svelte` renders two cards:
1. **Installierte Version** — big `current.label` (e.g. `main @ abc1234`), full sha below, conditional red dirty notice / yellow dev notice.
2. **Update-Status** — relative "Zuletzt geprüft", "Neueste Version auf main" (short sha), optional commit message (italic) + commit date, and a status badge branching on dev / dirty / hasUpdate / latestSha / none.

The "Jetzt prüfen" button is disabled while loading or in dev mode. On click it POSTs to `/api/update/check`, then refreshes `status` from the response and maps `checkResult.error` to localized German error banners (rate limit, network, dev mode).

`src/routes/settings/+page.svelte` was edited to add `VersionTab` import, extend the tabs array to include `'Version'` between `'Backup'` and `'Zugangsschutz'`, and add the conditional `{:else if activeTab === 'Version'}` block.

### Task 5: Scheduler job + header UpdateBadge (commit 4082c49)

**Scheduler additions** (existing intervals untouched):
- Two new module-level vars `updateCheckTimeout` and `updateCheckInterval`.
- New block at the end of `startScheduler()`: `setTimeout(... , 30_000)` → runs `checkForUpdate()` once (skipping dev mode), then arms `setInterval(... , 86_400_000)` for the 24h cadence.
- Final log line updated to end with `, update check (24h)`.
- `stopScheduler()` clears both the timeout and the interval.

**UpdateBadge component** (`src/lib/components/layout/UpdateBadge.svelte`):
- `$state<StatusShape | null>(null)` with a `$effect` that fires `load()` on mount and `setInterval(load, 5 * 60_000)`, returning a cleanup closure that clears the interval.
- `$derived` gate: only renders when `status.hasUpdate === true`.
- Renders an `<a href="/settings">` with a Bell icon and a green dot indicator.

**AppShell integration**:
- Desktop: new thin `hidden md:flex items-center justify-end` top bar above `<main>`, rendering `<UpdateBadge />`.
- Mobile: `<UpdateBadge />` pushed to the right via `ml-auto` wrapper at the end of the existing mobile header row.

## Deviations from Plan

None — plan executed exactly as written. All behaviors, types, commit-message conventions, settings keys, and file paths match the plan.

## Deferred Issues

Pre-existing TypeScript errors surfaced during `tsc --noEmit` and `svelte-check` runs. None are in files touched by this plan. Logged to `deferred-items.md` in this phase directory:

- `src/lib/server/services/onboarding.ts` — `audioCodec` missing in `StreamInfo` (2 locations), `Promise<Api>.nodes` access
- `src/routes/api/cameras/[id]/snapshot/+server.ts` — `Buffer` vs `BodyInit` mismatch
- `src/routes/api/cameras/status/+server.ts` — `CameraCardData` missing `cameraModel/firmwareVersion/liveFps` (2 locations)
- `src/routes/+page.svelte` — `CameraStatus` vs `'native-onvif'` comparison (2 locations)
- `src/lib/components/cameras/CameraDetailCard.svelte` — same native-onvif comparison

These should be addressed in a dedicated type-cleanup plan or by the subsystem owner.

## Authentication Gates

None — no auth gates encountered during execution.

## Verification

Phase-level checks performed:

1. **Unit tests green** — `npx vitest run src/lib/server/services/version.test.ts src/lib/server/services/update-check.test.ts` → 20/20 passing (13 version + 7 update-check).
2. **TypeScript clean in new files** — `npx tsc --noEmit` shows zero errors in any of the 11 files touched by this plan (8 new + 3 modified). Pre-existing errors in unrelated files are logged to `deferred-items.md`.
3. **svelte-check clean in new components** — `VersionTab.svelte`, `UpdateBadge.svelte`, `AppShell.svelte`, and `+page.svelte` compile with zero new errors/warnings.
4. **Zero new dependencies** — `git diff 3d9fd6d...HEAD -- package.json` is empty.
5. **Scheduler additions only** — `git diff` on `scheduler.ts` confirms existing intervals (log-scan, cleanup, protect-poll, health-check) are byte-identical; only imports, new state vars, new interval block, new stopScheduler clears, and the console.log label are additions.
6. **No update execution code** — grep confirms no `git pull`, no `npm install`, no `systemctl restart`, no child-process spawn beyond `git describe` / `git rev-parse` in the version service.

## Requirement Coverage

- **UPDATE-01** (show installed version): Task 1 `version.ts` + Task 4 `VersionTab.svelte` card 1.
- **UPDATE-02** (manual update check): Task 2 `checkForUpdate()` + Task 3 `POST /api/update/check` + Task 4 "Jetzt prüfen" button.
- **UPDATE-03** (auto-check + badge): Task 5 24h scheduler + `UpdateBadge` component in `AppShell.svelte`.

## Commits

| Hash    | Task | Message                                                              |
| ------- | ---- | -------------------------------------------------------------------- |
| 77f19fb | 1    | feat(08-01): version service with git describe parsing and dev fallback |
| 39cd057 | 2    | feat(08-01): update-check service with GitHub API and settings persistence |
| 07c9891 | 3    | feat(08-01): GET /api/update/status and POST /api/update/check endpoints |
| 54cd702 | 4    | feat(08-01): Version tab in settings with 'Jetzt prüfen' button     |
| 4082c49 | 5    | feat(08-01): daily update-check scheduler + header UpdateBadge       |

## Self-Check: PASSED

All 12 created/modified files verified present on disk. All 5 task commits verified in git history.
