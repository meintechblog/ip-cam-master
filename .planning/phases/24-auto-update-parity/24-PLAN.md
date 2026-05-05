---
phase: 24-auto-update-parity
plan: 00
type: master
autonomous: true
requirements:
  - UPD-AUTO-01
  - UPD-AUTO-02
  - UPD-AUTO-03
  - UPD-AUTO-04
  - UPD-AUTO-05
  - UPD-AUTO-06
  - UPD-AUTO-07
  - UPD-AUTO-08
  - UPD-AUTO-09
  - UPD-AUTO-10
  - UPD-AUTO-11
  - UPD-AUTO-12
  - UPD-AUTO-13
---

# Phase 24 Master Plan — Auto-Update Parity

**Format:** Single consolidated plan covering all 5 waves. Each task = one atomic commit. Reference implementation: `/Users/hulki/codex/charging-master/`. CONTEXT.md has the 20 locked decisions; this plan tracks execution.

## Wave 1 — Foundation (parallel-safe)

- [x] **24-01-W1-T1** — DB migration: add `update_runs` table to schema. Columns: id PK auto, started_at TEXT NOT NULL (ISO), finished_at TEXT, pre_sha TEXT, post_sha TEXT, target_sha TEXT, status TEXT NOT NULL ('running' | 'success' | 'failed' | 'rolled_back'), stage TEXT, error_message TEXT, rollback_stage TEXT ('stage1' | 'stage2'), unit_name TEXT, log_path TEXT, backup_path TEXT, trigger TEXT NOT NULL ('manual' | 'auto'). `npm run db:push`.
- [x] **24-01-W1-T2** — Generated version file: `scripts/build/generate-version.mjs` writes `src/lib/version.ts` with `CURRENT_SHA`, `CURRENT_SHA_SHORT`, `BUILD_TIME`. Add `gen:version` to `package.json` scripts; chain into `dev` and `build`. Add `src/lib/version.ts` to `.gitignore`. Initial generation with placeholders for fresh checkout.
- [x] **24-01-W1-T3** — `update-state-store.ts`: atomic JSON file at `.update-state/state.json`. Functions: `init()`, `read()`, `write(patch)`. Atomic via `writeFileSync(tmp)` + `renameSync(tmp, final)`. Default state seeded on init with `currentSha = CURRENT_SHA`. `.update-state/` to `.gitignore`.
- [x] **24-01-W1-T4** — `github-client.ts`: `checkLatestCommit({ etag?, timeoutMs? })` returns `{ result: LastCheckResult, etag: string | null }`. Never throws. Maps 200/304/403/429/timeouts/parse-errors to discriminated union. AbortController 10s default. UA: `ip-cam-master-self-update/<SHORT_SHA>`.
- [x] **24-01-W1-T5** — Drain endpoint: `src/routes/api/internal/prepare-for-shutdown/+server.ts`. POST, localhost-only (Host header check 127.0.0.1/::1/localhost). Stops scheduler intervals, runs `PRAGMA wal_checkpoint(TRUNCATE)`, returns 200 within 30s. Idempotent.

## Wave 2 — Backend logic (depends on W1)

- [x] **24-02-W2-T1** — `update-info-view.ts`: pure derive function `deriveUpdateInfoView(state, currentSha, currentShaShort)` → UI view model. Handles all `LastCheckResult` discriminants.
- [x] **24-02-W2-T2** — Refactor `update-check.ts`: persist ETag to state.json `lastCheckEtag`; on next call send `If-None-Match`. Map 304 to `unchanged` (preserves prior `ok`). Add 5min server-side cooldown (`lastCheckAt` in state).
- [x] **24-02-W2-T3** — `update-checker.ts`: scheduler decision engine. `start()` registers two intervals — 6h check tick + 5min auto-update tick. `maybeAutoUpdate()` reads `update.autoUpdate` + `update.autoUpdateHour` settings, checks current Europe/Berlin hour, validates no active flows (Hub `hub_state` IN ('starting','stopping'), no in-flight onboarding), enforces 23h spacing via `update.lastAutoUpdateAt`, dedupes skip-reasons. On all-clear: write state.json `updateStatus='installing'` + `targetSha`, spawn `systemctl start --no-block ip-cam-master-updater.service`.
- [x] **24-02-W2-T4** — Refactor `update-history.ts`: rewrite against `update_runs` Drizzle table. Migration shim reads legacy `update_run_history` JSON blob from settings on first call, inserts each entry into `update_runs`, then deletes the settings row. Preserve same external API (`appendUpdateRun`, `updateUpdateRun`, `readUpdateRuns`, `reconcileRunningEntries`).
- [x] **24-02-W2-T5** — Refactor `update-runner.ts`: switch from `systemd-run` transient unit to `systemctl start --no-block ip-cam-master-updater.service`. Keep auto-backup + log/exitcode files. New env passing via `systemctl set-environment` (or write to a state file the unit reads). Localhost-only guard added in route handler.
- [x] **24-02-W2-T6** — Replace `version.ts` runtime git-describe with import from generated `src/lib/version.ts`. Keep `getCurrentVersion()` API contract; back it with the constants. Add `dbHealthy` field to `/api/version` response (run `SELECT 1`).
- [x] **24-02-W2-T7** — New routes: `POST /api/update/ack-rollback` (localhost guard, clears rollback fields in state.json). Update `/api/update/check` with cooldown. Update `/api/update/run` with localhost guard + active-flow conflict check (returns 409 with `conflicts: []`).
- [x] **24-02-W2-T8** — Wire scheduler ticks into `hooks.server.ts`: `startUpdateChecker()`. Call `UpdateStateStore.init()` before. Call `ensureUpdaterUnitInstalled()` (replaces old `ensureUpdateScriptInstalled`).

## Wave 3 — `update.sh` rewrite (depends on W2)

- [x] **24-03-W3-T1** — `scripts/update/ip-cam-master-updater.service` (systemd unit, Type=oneshot, WorkingDirectory=/opt/ip-cam-master, ExecStart=/usr/local/bin/ip-cam-master-update.sh, User=root, TimeoutStartSec=900, StandardOutput=journal). NOT BindsTo/PartOf the main service.
- [x] **24-03-W3-T2** — `scripts/update/install-updater-unit.sh`: copies the unit into `/etc/systemd/system/`, runs `daemon-reload` + `enable`. Best-effort idempotent.
- [x] **24-03-W3-T3** — Rewrite `scripts/update.sh` → 9-stage pipeline with `[stage=<name>]` markers. Stages: preflight (disk ≥500MB, node ≥22, npm, git tree clean, flock), snapshot (`tar -czf .update-state/snapshots/<PRE_SHA>.tar.gz` excluding node_modules/.svelte-kit/build/.update-state/data; retain 3), drain (`curl POST /api/internal/prepare-for-shutdown` 30s timeout), stop (`systemctl stop`), fetch (`git fetch origin main`), install (`git reset --hard origin/main` + `npm ci` if lockfile changed, else skip), build (`npm run build`), start (`systemctl start ip-cam-master`), verify (`curl /api/version` 60s, require sha match + dbHealthy). State-json mutations via Python3 inline tmp+rename.
- [x] **24-03-W3-T4** — Two-stage rollback in `update.sh`. On any error from `fetch` onward → `rollback_stage1` (git reset PRE_SHA + npm ci + build + start + verify); if stage1 verify fails → `rollback_stage2` (tar extract from `.update-state/snapshots/<PRE_SHA>.tar.gz` + start + verify). Both write `rollbackStage` to state.json + `update_runs` row. Final-failure exit 3.
- [x] **24-03-W3-T5** — Hooks update: `ensureUpdaterUnitInstalled()` in `update-runner.ts` runs on app boot; copies/updates unit + script if mtime newer. Best-effort.

## Wave 4 — UI (depends on W2)

- [x] **24-04-W4-T1** — `AutoUpdateCard.svelte`: toggle bound to `update.autoUpdate` setting via PUT /api/settings; hour dropdown 0-23 bound to `update.autoUpdateHour`; "Letztes Auto-Update: <relative>" line; "Nächste mögliche Prüfung: <today/tomorrow at HH:00 Europe/Berlin>" preview line. Auto-save on change with 300ms debounce.
- [x] **24-04-W4-T2** — `UpdateStageStepper.svelte`: 9 horizontal pills, color-coded (pending/running/done/failed/rolled_back). Parses `[stage=]` markers from log line stream. Props: `currentStage`, `stageStatuses: Record<Stage, StageStatus>`. Visible only when `updateStatus === 'installing'` OR most recent run status is `failed` | `rolled_back`.
- [x] **24-04-W4-T3** — `ReconnectOverlay.svelte`: full-screen modal, non-dismissable. Polls `/api/version` every 2s. Closes when SHA changes AND `dbHealthy=true`. 90s timeout shows manual "Erneut versuchen" button. Mounted by `UpdateRunPanel` when SSE drops mid-install.
- [x] **24-04-W4-T4** — `InstallModal.svelte`: confirmation dialog before triggering install. Shows current SHA → target SHA, commit message/author/date. Conflict detection: fetches from `/api/update/run-preflight` (new endpoint, returns conflicts array). Red warning bar if conflicts present. ESC-dismissable, focus-trap.
- [x] **24-04-W4-T5** — Add `GET /api/update/run-preflight` endpoint: returns `{ conflicts: [{ kind: 'hub_starting' | 'hub_stopping' | 'wizard_active' | 'onboarding_active', detail: string }] }`. Read DB for `protect_hub_bridges.hub_state`, `hub_onboarding_state`, in-flight onboarding jobs.
- [x] **24-04-W4-T6** — Refactor `VersionTab.svelte`: insert AutoUpdateCard between Installed Version and Update Status; integrate UpdateStageStepper (mounted between Status and Run Panel); insert update-available banner with green pulsing dot; show 10 history entries instead of 5.
- [x] **24-04-W4-T7** — Refactor `UpdateRunPanel.svelte`: parse `[stage=]` markers, drive UpdateStageStepper via prop. Mount InstallModal on "Update jetzt" click. Mount ReconnectOverlay on SSE drop while `updateStatus === 'installing'`. Show "Auto-Update gestartet um HH:MM" header tag if run was auto-triggered.

## Wave 5 — Deploy + UAT (depends on W1-W4)

- [x] **24-05-W5-T1** — Pre-deploy verification: `npm run check`, `npm run build`, `npm run test:unit -- --run`. Fix any breakage.
- [x] **24-05-W5-T2** — Commit summary file `24-SUMMARY.md` covering what was built, deviations from plan, known limitations.
- [x] **24-05-W5-T3** — Deploy via `./scripts/dev-deploy.sh`. Watch journalctl for boot. Verify: settings tab loads, auto-update card visible, version endpoint returns SHA + dbHealthy. Toggle auto-update ON, set hour=3. Restart service. Verify settings persisted.
- [x] **24-05-W5-T4** — Manual UAT: trigger manual update install (no remote change → "already up-to-date"). Then make a no-op commit on main, push, trigger install via UI, observe stepper progress, verify completion.
- [x] **24-05-W5-T5** — Mark phase complete in ROADMAP.md, write VERIFICATION.md against the 10 success criteria.

## Acceptance — ✅ Complete (2026-05-05)

All 13 UPD-AUTO-* requirements addressed. All 10 success criteria from ROADMAP.md verified — 9 structurally pre-deploy, SC-10 live against the running VM (UAT-1 through UAT-10 + ETag round-trip + rollback fault injection). Deployed to running VM (VMID 104). No regressions in v1.3 work.

**Live UAT findings + fixes** (commits beyond the planned 24 atomic ones):
- `b3d93ab` — `generate-version.mjs` unsets `GIT_DIR` before spawning git (caught: empty `CURRENT_SHA` after first deploy because the post-receive hook's git env leaked into the script's exec)
- `9dd9da6` — `AutoUpdateCard.svelte` sends correct flat `{key:val}` PUT body (caught: settings weren't persisting because envelope-shape body was being saved as two literal `key`+`value` rows)
- `ed2e36c` — `/api/update/ack-rollback` also resets `updateStatus` to idle (caught: terminal state was sticking; harmless but stale)

**Live UAT data fix** (no code change):
- 2 legacy `update_runs` rows with `status='abandoned'` (v1.1 artifact, not in P24's `UpdateRunStatus` enum) normalized to `'failed'` so the UI no longer renders them as "Läuft".
