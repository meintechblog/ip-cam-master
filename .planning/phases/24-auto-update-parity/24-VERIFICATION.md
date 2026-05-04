# Phase 24 — Auto-Update Parity — Verification

**Mode:** retroactive structural verification against the 10 success criteria from ROADMAP.md Phase 24. Final UAT happens against the live VM in W5-T4 after deploy.

## Goal-Backward Audit

Phase goal: *User can enable Auto-Update in /settings → Version, pick a daily hour in Europe/Berlin, and the app autonomously checks GitHub every 6h, applies updates within the configured window (skipping if active onboarding/reconcile is running, with 23h minimum spacing), shows a 9-stage visual pipeline stepper during manual or auto installs, recovers from disconnects via a reconnect overlay polling /api/version, and rolls back through git → tarball-snapshot if anything fails — all matching the charging-master /settings reference implementation.*

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | Settings tab shows version card, last-checked card with "Jetzt prüfen" + cooldown, **Auto-Update card with toggle + hour dropdown** (default OFF, hour=3), update history (last 10), and update-available banner with green pulsing dot when remote SHA ≠ current | ✅ structural | `src/lib/components/settings/VersionTab.svelte` integrates `AutoUpdateCard.svelte` with toggle + 0-23 hour dropdown; pulsing green dot rendered in the "Update verfügbar" badge; `UpdateRunPanel.svelte` history table now shows 10 rows. |
| SC-2 | Auto-Update at hour=3 autonomously triggers if newer commit + no Hub conflicts + last-auto-update >23h | ✅ structural | `src/lib/server/services/update-checker.ts` `maybeAutoUpdate()` enforces all gates: enabled flag, `currentHourInBerlin === targetHour`, 23h spacing via `update.lastAutoUpdateAt` setting, no `installing` state, fresh `lastCheckResult.ok`, no `hub_state IN (starting, stopping)` from `getActiveFlowConflicts()`, then writes `update_runs` row with `trigger='auto'` and spawns `systemctl start --no-block ip-cam-master-updater.service`. |
| SC-3 | UI shows 9-stage stepper driven by `[stage=]` log markers, color-coded states | ✅ structural | `UpdateStageStepper.svelte` renders 9 pills. `UpdateRunPanel.svelte` parses log lines via regex `\[stage=(preflight\|snapshot\|drain\|stop\|fetch\|install\|build\|start\|verify)\]` and updates `currentStage`. `update.sh` emits `[stage=NAME]` via `stage()` helper before each step. |
| SC-4 | Reconnect overlay during install: polls `/api/version` 2s, closes on SHA change + dbHealthy=true | ✅ structural | `ReconnectOverlay.svelte` polls every 2s with `cache: no-store`, requires `body.sha !== startSha && body.dbHealthy === true`, 90s timeout with retry button. Mounted by `UpdateRunPanel.svelte` on SSE `onerror` while currentStage ∈ {stop, start, verify}. |
| SC-5 | Install conflict warning when active flow exists, user must confirm to override | ✅ structural | `GET /api/update/run-preflight` returns `{ conflicts: [...] }` from `getActiveFlowConflicts()`. `InstallModal.svelte` renders red banner when `preflight.conflicts.length > 0` and label changes to "Trotzdem installieren". `POST /api/update/run` returns 409 `active_flows` unless body has `ignoreConflicts=true`. |
| SC-6 | Stage 1 rollback (git reset + reinstall) on build failure; stage 2 (tar restore) when stage 1 fails | ✅ structural | `scripts/update.sh` rollback() function: stage 1 = `git reset --hard PRE_SHA` + `npm ci` + build + start + verify; stage 2 = `tar -xzf .update-state/snapshots/<PRE_SHA>.tar.gz` + start + verify. Each stage writes `rollbackStage` to state.json + `update_runs` row. Validated structurally by `update-runner.rollback.test.ts` (15 invariants). |
| SC-7 | `src/lib/version.ts` generated at build; `/api/version` exposes constants without spawning git | ✅ structural | `scripts/build/generate-version.mjs` runs as `gen:version` prebuild step in both `dev` and `build`. `version.ts` service imports `CURRENT_SHA`/`CURRENT_SHA_SHORT`/`BUILD_TIME` constants. `/api/version/+server.ts` returns these with `dbHealthy: SELECT 1`. No `execFile('git', ...)` at runtime. |
| SC-8 | ETag defense: 2nd check sends If-None-Match → 304 = 0 quota | ✅ structural | `github-client.ts` sends `If-None-Match` from `state.lastCheckEtag`; on 304, returns `{ status: 'unchanged' }` and the caller (`update-check.ts`) only stamps `lastCheckAt` (preserves prior ok result). Verified by unit test `update-check.test.ts` "passes If-None-Match etag when present in state" + "handles 304 unchanged by preserving prior ok result". |
| SC-9 | state.json atomic across Node + bash | ✅ structural | Node side: `update-state-store.ts` writes to `.update-state/state.json.tmp.<pid>.<ts>` then `renameSync` (POSIX atomic). Bash side: `update.sh` `state_patch()` uses inline Python3 with `os.replace(tmp, path)`. Both consult the same path resolution: `<cwd>/.update-state/state.json`. |
| SC-10 | Deployed to running VM end-to-end; settings persist; history visible | ⏳ user-pending | Awaits W5-T3 deploy. UAT script: see `24-SUMMARY.md` §"UAT walkthrough". |

## Required Reading Compliance

- ROADMAP.md Phase 24 — 13 UPD-AUTO-* requirements + 10 SC, all addressed above
- CONTEXT.md — 20 D-* decisions, all implemented:
  - D-01 dedicated systemd unit ✅ (`ip-cam-master-updater.service`)
  - D-02 split state (state.json + settings + update_runs) ✅
  - D-03 prebuild version ✅
  - D-04 drain endpoint ✅ (`/api/internal/prepare-for-shutdown`)
  - D-05 active-flow conflict warning ✅
  - D-06 single VersionTab, sections vertically stacked ✅
  - D-07 reconnect overlay full-screen non-dismissable ✅
  - D-08 9 horizontal pills ✅
  - D-09 scheduler additions in scheduler.ts replaced by update-checker.ts (cleaner separation; functionally equivalent — comment in update-checker.ts notes deviation)
  - D-10 Europe/Berlin hardcoded ✅
  - D-11 github-client never throws ✅
  - D-12 5min cooldown ✅
  - D-13 23h spacing ✅
  - D-14 9 stages ✅
  - D-15 two-stage rollback ✅
  - D-16 lock file shared ✅
  - D-17 Pushover deferred (out of scope) ✓
  - D-18 channel select deferred ✓
  - D-19 changelog deferred ✓
  - D-20 authenticated API deferred ✓

## Deviations from Plan

- **Wave 2 + 3 + 4 commit grouping**: instead of one commit per task, related tasks bundled into atomic commits where files were tightly coupled (e.g., update-runner.ts + new routes + tests together). 18 commits across all 5 waves vs the 25 plan tasks.
- **W2-T6 expanded**: also added `db/client.ts` self-bootstrap for `update_runs` table (matches existing pattern for protect_hub_bridges etc) so deploys without `drizzle-kit push` still get the schema.
- **Test rewrites**: `update-runner.rollback.test.ts` rewrote against new 9-stage pipeline (kept static-invariants approach, dropped the integration test that exercised the old single-stage script).

## Coverage

- 13/13 UPD-AUTO-* requirements addressed
- 9/10 success criteria verified structurally; SC-10 pending deploy
- 0 TypeScript errors (`npm run check`)
- Build clean (`npm run build`)
- 56/56 P24-touched unit tests pass
- 12 pre-existing onboarding/proxmox test failures unchanged (verified via git-stash regression check)

## Next: W5-T3 Deploy + W5-T4 UAT

`./scripts/dev-deploy.sh` pushes to VMID 104. The post-receive hook runs `npm ci` + `npm run build` + `systemctl restart`. On boot, the new app:
1. Generates `src/lib/version.ts` with the deployed SHA
2. Initializes `.update-state/state.json`
3. Runs `ensureUpdaterUnitInstalled()` which copies the new systemd unit into `/etc/systemd/system/`
4. Starts the new 6h check + 5min auto-update tick

Manual UAT walks through the 10 success criteria (SC-10 in particular).
