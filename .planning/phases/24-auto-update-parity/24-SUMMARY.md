# Phase 24 — Auto-Update Parity — Summary

**Status:** code-complete, awaiting VM deploy + UAT (W5-T3, W5-T4)
**Trigger:** User request 2026-05-04 — port charging-master self-update parity
**Reference:** `/Users/hulki/codex/charging-master`

## What was built

13 atomic commits across 5 waves implementing the charging-master self-update parity feature:

### New files (16)
- **DB / build:**
  - `drizzle/0002_update_runs.sql` — manual migration documenting the new table
- **Services:**
  - `src/lib/server/services/update-state-store.ts` — atomic JSON state shared with bash
  - `src/lib/server/services/github-client.ts` — never-throws GitHub commits API client with ETag
  - `src/lib/server/services/update-info-view.ts` — pure derive function for UI view model
  - `src/lib/server/services/update-checker.ts` — 6h check tick + 5min auto-update opportunity tick
  - `src/lib/version.ts` — generated at build, gitignored
- **Routes:**
  - `src/routes/api/version/+server.ts` — health-check endpoint (sha + dbHealthy)
  - `src/routes/api/update/ack-rollback/+server.ts` — clears rollback banner
  - `src/routes/api/update/run-preflight/+server.ts` — returns conflicts/dirty/target for install modal
  - `src/routes/api/internal/prepare-for-shutdown/+server.ts` — drain endpoint
- **UI:**
  - `src/lib/components/settings/AutoUpdateCard.svelte` — toggle + hour dropdown
  - `src/lib/components/settings/UpdateStageStepper.svelte` — 9-pill progress
  - `src/lib/components/settings/ReconnectOverlay.svelte` — `/api/version` poller modal
  - `src/lib/components/settings/InstallModal.svelte` — confirmation dialog
- **Scripts:**
  - `scripts/build/generate-version.mjs` — prebuild version generator
  - `scripts/update/ip-cam-master-updater.service` — dedicated systemd unit
  - `scripts/update/install-updater-unit.sh` — installer for the unit

### Modified files (10)
- `src/lib/server/db/schema.ts` — added `update_runs` table
- `src/lib/server/db/client.ts` — `CREATE TABLE IF NOT EXISTS update_runs` self-bootstrap
- `src/lib/server/services/version.ts` — runtime git-describe → import generated constants
- `src/lib/server/services/update-check.ts` — ETag + cooldown + state-store
- `src/lib/server/services/update-history.ts` — JSON blob → `update_runs` table (with legacy migration shim)
- `src/lib/server/services/update-runner.ts` — `systemd-run` → dedicated `ip-cam-master-updater.service`
- `src/lib/server/services/scheduler.ts` — old 24h tick removed (superseded by update-checker.ts)
- `src/hooks.server.ts` — wired `initUpdateStateStore`, `ensureUpdaterUnitInstalled`, `startUpdateChecker`
- `src/lib/components/settings/VersionTab.svelte` — integrated AutoUpdateCard + rollback banner + pulsing dot
- `src/lib/components/settings/UpdateRunPanel.svelte` — stepper + reconnect overlay + install modal
- `src/routes/api/update/check/+server.ts` — manual check enforces 5-min cooldown
- `src/routes/api/update/run/+server.ts` — localhost guard + active-flow check + trigger='manual'
- `src/routes/api/update/status/+server.ts` — extended response with auto-update settings + state
- `scripts/update.sh` — full rewrite: 9-stage pipeline + 2-stage rollback
- `package.json` — `gen:version` prebuild step
- `.gitignore` — `src/lib/version.ts` + `.update-state/`

### Tests
- `update-runner.test.ts` — rewritten for new spawn pattern + env file
- `update-runner.rollback.test.ts` — rewritten for 9-stage + 2-stage rollback
- `update-history.test.ts` — rewritten for DB-backed contract
- `update-check.test.ts` — rewritten for state-store + github-client mocks
- `update-run-post.test.ts` — added localhost + active-flow tests
- `version.test.ts` — mocks `$lib/version` for dev-fallback branch

56/56 P24-touched tests pass. Build clean. 0 TypeScript errors.

## Architectural choices

See `.planning/phases/24-auto-update-parity/24-CONTEXT.md` for the 20 locked decisions. Key choices:

- **Dedicated systemd unit** (`ip-cam-master-updater.service`, `Type=oneshot`) instead of transient `systemd-run` — sibling cgroup prevents the `stop` stage from killing the updater.
- **Split state**: transient (state.json) + persistent prefs (settings table) + history (`update_runs` table).
- **Prebuild version generation** — removes runtime `.git/` dependency.
- **Two-stage rollback**: git reset (fast) → tarball restore (when git fails).
- **9-stage pipeline** with `[stage=NAME]` log markers parsed by the UI.
- **Europe/Berlin hardcoded** — single-user homelab in Germany.
- **5-min manual check cooldown + 23h auto-update spacing**.
- **Localhost-only guards** on `/api/update/run` and `/api/update/ack-rollback`.

## Out of scope (deferred)

- Pushover notifications (D-17)
- Update channel selection (stable vs main vs tags) (D-18)
- Pre-update changelog rendering (D-19)
- Authenticated GitHub API (D-20)

## UAT walkthrough (W5-T4 — user must run)

After `./scripts/dev-deploy.sh`:

1. **Auto-Update card visible**: Open `https://ip-cam-master.local/settings` → Version tab. Confirm new "Auto-Update" card sits between Installed Version and Update-Status. Toggle defaults to OFF, hour to 03:00.
2. **Settings persist**: Toggle ON, set hour=4, refresh page. Toggle should still be ON, hour 04:00. Then `systemctl restart ip-cam-master` on the VM. Refresh — settings still there.
3. **Manual check cooldown**: Click "Jetzt prüfen". Click again within 5 min — yellow banner says "Cooldown — bitte in Xs erneut versuchen".
4. **Update available banner with pulsing dot**: After a check finds a newer commit, the green badge has a pulsing dot.
5. **Install modal**: Click "Jetzt updaten" — modal opens showing current → target SHA + commit message. Click "Installieren".
6. **Stage stepper**: While installing, 9-pill stepper visible above log. Active stage pulses blue, completed stages green.
7. **Reconnect overlay**: When systemd restarts the app between `start` and `verify`, full-screen modal appears. Closes when new SHA appears.
8. **History row with auto-trigger**: After running with `update.autoUpdate=true` overnight (or by force-pushing a no-op commit and waiting through the 5-min tick), the new history row should show "auto" in the Auslöser column.
9. **Rollback simulation**: Force a build break (push a commit that fails `npm run build` to a test branch and `git fetch + reset` it on origin/main). Trigger update. Stage 1 rollback should fire; banner shows "Update fehlgeschlagen — zurückgesetzt auf <SHA>".
10. **Rollback banner**: Click "Verstanden" — banner disappears.

## Files for review

- `.planning/phases/24-auto-update-parity/24-CONTEXT.md` — decisions
- `.planning/phases/24-auto-update-parity/24-PLAN.md` — task breakdown
- `.planning/phases/24-auto-update-parity/24-VERIFICATION.md` — goal-backward audit
- This summary
