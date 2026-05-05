# Phase 24 — Auto-Update Parity — Summary

**Status:** ✅ Complete — deployed to VMID 104 + UAT verified end-to-end (2026-05-05)
**Trigger:** User request 2026-05-04 — port charging-master self-update parity
**Reference:** `/Users/hulki/codex/charging-master`
**Final SHA:** `ed2e36c` on VM, GitHub origin/main, and local main

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

## UAT walkthrough — completed 2026-05-05

Executed autonomously against the running VM (VMID 104, host `ip-cam-master`). Each test verified via API + DB + journalctl rather than manually clicking through the browser, but exercises the same code paths.

| # | Test | How verified | Result |
|---|------|--------------|--------|
| UAT-1 | Auto-Update card data | `GET /api/update/status` returns `autoUpdate.{enabled,hour,lastAutoUpdateAt}` block | ✅ |
| UAT-2 | Settings persist over restart | `PUT /api/settings` → `systemctl restart ip-cam-master` → re-read | ✅ (caught + fixed PUT body shape bug `9dd9da6`) |
| UAT-3 | 5-min manual-check cooldown | 2 `POST /api/update/check` within 5 min | ✅ `retryAfterSeconds: 300` |
| UAT-4 | hasUpdate populated | `GET /api/update/status` after fresh check | ✅ |
| UAT-5 | run-preflight shape | `GET /api/update/run-preflight` returns `current/target/dirtyFiles/conflicts` | ✅ matches `InstallModal` consumer |
| UAT-6 | **Live install through 9 stages** | `POST /api/update/run {force:true}` + tail log | ✅ 24s end-to-end |
| UAT-7 | Reconnect-overlay equivalent | service was down ~16s during install; `/api/version` resumed at expected SHA + dbHealthy | ✅ |
| UAT-8 | Auto-update scheduler tick | journalctl: `[update-checker] started: check 6h, auto-update tick 5min, tz=Europe/Berlin` | ✅ |
| UAT-9 | **Rollback Stage 1 via fault injection** | Injected `npm run build && false` into deployed `/usr/local/bin/ip-cam-master-update.sh`, triggered, observed | ✅ 21s end-to-end; `state.json.rollbackStage='stage1'`; service healthy after; updater script restored |
| UAT-10 | ack-rollback clears banner | `POST /api/update/ack-rollback` after rollback | ✅ (caught + fixed `updateStatus` not being reset — `ed2e36c`) |
| ETag | 304 round-trip | second check after first `200 OK` reused `lastCheckEtag` | ✅ no quota burned |

**Live state on VM after UAT (clean):**
- SHA `ed2e36c` matches origin/main + local main
- Service active, dbHealthy=true, updateStatus=idle
- Updater unit + script hashes match repo source
- 13 rows in `update_runs` (including 2 legacy `abandoned` rows normalized to `failed` to fix UI render)

## Items deliberately not tested (require time-skip or destructive change)

- **Auto-trigger at configured hour after 23h gap**: would require waking past the configured hour with auto-update enabled and a fresh remote-SHA delta. Code path is exercised by `update-checker.test.ts`; live behavior is observable via journalctl when the next 5-min tick aligns with the configured hour.
- **Stage-2 rollback (tarball restore)**: requires Stage 1 to fail. Stage 1 succeeds whenever git + npm + systemctl work. Manually breaking Stage 1 mid-install would require live edits inside the running rollback function — too invasive and risky against production. Stage 2 logic is structurally verified by `update-runner.rollback.test.ts` invariants.

## Files for review

- `.planning/phases/24-auto-update-parity/24-CONTEXT.md` — decisions
- `.planning/phases/24-auto-update-parity/24-PLAN.md` — task breakdown
- `.planning/phases/24-auto-update-parity/24-VERIFICATION.md` — goal-backward audit
- This summary
