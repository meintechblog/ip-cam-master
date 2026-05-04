# Phase 24 — Auto-Update Parity — CONTEXT

**Mode:** autonomous (`--auto`) — Claude picked recommended option for every gray area; no AskUserQuestion. User will review final result via UAT post-deploy.

## Domain

Bring ip-cam-master self-update to charging-master `/settings` parity. Reference implementation: `/Users/hulki/codex/charging-master/`. Current ip-cam-master already has manual check + manual install + SSE logs + auto-backup + simple rollback (v1.1) — this phase adds the productized layer on top: scheduling, atomic state, visual stepper, reconnect resilience, two-stage rollback, dedicated history table.

## Canonical Refs

Every downstream agent (researcher, planner, executor) MUST read these:

- `/Users/hulki/codex/charging-master/src/modules/self-update/` — full reference implementation (update-checker.ts, github-client.ts, update-state-store.ts, update-info-view.ts, types.ts)
- `/Users/hulki/codex/charging-master/scripts/update/run-update.sh` — 9-stage bash pipeline with two-stage rollback
- `/Users/hulki/codex/charging-master/scripts/update/charging-master-updater.service` — dedicated `oneshot` systemd unit
- `/Users/hulki/codex/charging-master/src/app/settings/` — UI components (update-banner, update-stage-stepper, update-log-panel, reconnect-overlay, install-modal, update-history)
- `/Users/hulki/codex/charging-master/src/components/settings/auto-update-settings.tsx` — auto-update settings card
- `/Users/hulki/codex/charging-master/src/app/api/update/` — API routes (check, trigger, status, log, history, ack-rollback)
- `/Users/hulki/codex/charging-master/scripts/build/generate-version.mjs` — prebuild version generator
- `/Users/hulki/codex/ip-cam-master/.planning/ROADMAP.md` (§ Phase 24) — 13 UPD-AUTO-* requirements + 10 success criteria — LOCKED, do not re-derive
- `/Users/hulki/codex/ip-cam-master/src/lib/server/services/update-runner.ts` — current implementation, will be refactored
- `/Users/hulki/codex/ip-cam-master/src/lib/server/services/update-check.ts` — current GitHub check, will be extended with ETag
- `/Users/hulki/codex/ip-cam-master/src/lib/server/services/update-history.ts` — JSON-blob-in-settings impl, will be replaced with `update_runs` table
- `/Users/hulki/codex/ip-cam-master/scripts/update.sh` — current 1-stage rollback, will be extended to 2-stage + 9 named stages
- `/Users/hulki/codex/ip-cam-master/ip-cam-master.service` — main service unit
- `/Users/hulki/codex/ip-cam-master/src/lib/components/settings/VersionTab.svelte` — settings tab, will host new auto-update card + stepper + overlay

## Locked Requirements (from ROADMAP.md Phase 24)

```
UPD-AUTO-01: Auto-update toggle + 0-23 hour dropdown (Europe/Berlin)
UPD-AUTO-02: Background scheduler — 6h GitHub check + 5min auto-update tick
UPD-AUTO-03: ETag-based polling (If-None-Match → 304 = no rate-limit)
UPD-AUTO-04: 9-stage pipeline stepper UI (preflight → snapshot → drain → stop → fetch → install → build → start → verify)
UPD-AUTO-05: Reconnect overlay polls /api/version every 2s, 90s timeout
UPD-AUTO-06: Install confirmation modal (current → target SHA, commit metadata, conflict warning)
UPD-AUTO-07: Two-stage rollback in update.sh (git → tarball)
UPD-AUTO-08: 23h minimum between auto-updates
UPD-AUTO-09: Atomic state.json (.update-state/state.json, tmp+rename, cross-process)
UPD-AUTO-10: update_runs table (Drizzle schema)
UPD-AUTO-11: 5min server-side cooldown for POST /api/update/check
UPD-AUTO-12: Localhost-only guard on POST /api/update/run + ack-rollback
UPD-AUTO-13: Generated src/lib/version.ts via prebuild step
```

10 success criteria are in ROADMAP.md §"Phase 24" → "Success Criteria". Read them before planning.

## Decisions

### Architecture

**D-01 — Service unit pattern: dedicated `ip-cam-master-updater.service` (`Type=oneshot`), NOT transient `systemd-run`.**
Why: charging-master's pattern. Sibling cgroup prevents the `stop` stage from killing the updater (which is exactly what happens with `systemd-run --scope` if the parent service is stopped from inside the same cgroup). The unit will be installed by `scripts/update/install-updater-unit.sh` (called from `ensureUpdateScriptInstalled` at boot) into `/etc/systemd/system/`, then `systemctl daemon-reload` + `systemctl enable` (no start — it's oneshot, started on-demand via `systemctl start --no-block`).

**D-02 — State storage: split between `.update-state/state.json` (transient) and `settings` table (persistent prefs).**
- `.update-state/state.json` (atomic tmp+rename, shared between Node and bash): `currentSha`, `rollbackSha`, `lastCheckAt`, `lastCheckEtag`, `lastCheckResult`, `updateStatus`, `targetSha`, `updateStartedAt`, `rollbackHappened`, `rollbackReason`, `rollbackStage`.
- `settings` table (Drizzle, current pattern): `update.autoUpdate` (bool), `update.autoUpdateHour` (0-23), `update.lastAutoUpdateAt` (epoch ms).
- `update_runs` table (new, Drizzle): per-run history. Replaces JSON blob in `settings.update_run_history`.

**D-03 — Version generation: prebuild `src/lib/version.ts` via `scripts/build/generate-version.mjs`.**
Replaces runtime `git describe` in `version.ts` service. Runs in `npm run dev` and `npm run build` via `package.json` scripts. Output is .gitignored (each build re-generates). Removes `.git` filesystem dependency at runtime — also fixes a class of "git not present in container" issues post-deploy.

**D-04 — Drain stage: add `/api/internal/prepare-for-shutdown` (localhost-only).**
Called by `update.sh` between `snapshot` and `stop`. Stops:
- `protectHubReconcileInterval` (v1.3 — set a flag so the next tick exits without re-arming)
- SSH log scan scheduler (60s tick from v1.0)
- Bambu MQTT watch (v1.2)
- WAL checkpoint on SQLite via `PRAGMA wal_checkpoint(TRUNCATE)` (clean shutdown)
Returns 200 within 30s or 503. Idempotent.

**D-05 — Active-flow conflict warning in install modal:**
Show red warning if any of:
- `protect_hub_bridges.hub_state IN ('starting', 'stopping')` (v1.3)
- `hub_onboarding_state` has a non-completed wizard run (v1.3)
- An onboarding job is in flight (v1.0 wizard against external cams)
- A v1.2 Bambu pre-flight handshake is in progress
User must explicitly confirm to override (charging-master's "active sessions" analog).

### UI

**D-06 — Settings tab structure: extend existing `VersionTab.svelte`, do not split into multiple tabs.**
Sections (vertical stack):
1. Installed Version Card (existing — minor cleanup)
2. **NEW** Auto-Update Card — toggle + hour dropdown + last-auto-update timestamp + next-trigger preview
3. Update Status Card (existing — extend with green pulsing dot when available)
4. **NEW** Update Stage Stepper (visible only during running install)
5. Update Run Panel (existing UpdateRunPanel.svelte — refactor to drive stepper from `[stage=]` log markers)
6. Update History Card (existing — replace JSON-blob source with `update_runs` table query, raise visible limit from 5 → 10)

**D-07 — Reconnect overlay: full-screen modal, non-dismissable while update in flight.**
Polls `/api/version` every 2s, succeeds when SHA changes AND `dbHealthy=true`. 90s timeout shows manual "Retry" button. Implementation: separate `ReconnectOverlay.svelte` component, mounted by `UpdateRunPanel` when SSE drops while `updateStatus === 'installing'`.

**D-08 — Stage stepper: 9 horizontal pills (charging-master pattern), color-coded.**
States: pending (grey), running (blue, pulsing), done (green), failed (red), rolled_back (amber). Driven by regex `\[stage=(preflight|snapshot|drain|stop|fetch|install|build|start|verify)\]` in SSE log lines.

### Backend

**D-09 — Scheduler: add to existing `scheduler.ts`, not a new service.**
Two new ticks alongside the existing health probe and SSH log scan:
- `updateCheckInterval` — 6h, calls `checkForUpdate()`, persists ETag (or honors 304)
- `updateAutoApplyInterval` — 5min, calls `maybeAutoUpdate()`: reads settings, checks hour-of-day in Europe/Berlin, dedupes against last auto-update, validates no active flows (D-05), spawns updater unit on-block

**D-10 — Hour-of-day timezone: hardcoded `Europe/Berlin`.**
Project is single-user homelab in Germany (per PROJECT.md, user CLAUDE.md). No env var needed. Use `Intl.DateTimeFormat('de-DE', { hour: 'numeric', timeZone: 'Europe/Berlin', hour12: false })` to extract the wall-clock hour.

**D-11 — GitHub client: extract to dedicated `github-client.ts`, never throws.**
All errors mapped to `LastCheckResult` discriminated union (ok | unchanged | rate_limited | error). 10s timeout via AbortController. ETag persisted in state.json `lastCheckEtag` for next-call `If-None-Match`.

**D-12 — Manual check cooldown: 5min server-side.**
Same as charging-master. Returns `{ status: 'cooldown', retryAfterSeconds }` with HTTP 429.

**D-13 — Auto-update minimum spacing: 23h.**
Read `update.lastAutoUpdateAt` from settings; skip if delta < 23h. Logged with deduped reason (don't spam every 5min tick).

### Update Pipeline (`update.sh`)

**D-14 — 9 stages with `[stage=<name>]` log markers:**
1. `preflight` — disk space, node ≥22, npm, git tree clean, no concurrent flock
2. `snapshot` — `tar.gz` of `/opt/ip-cam-master` (excluding `node_modules`, `.update-state`, `data`) → `.update-state/snapshots/<PRE_SHA>.tar.gz`. Retain last 3.
3. `drain` — `curl -sf POST http://127.0.0.1/api/internal/prepare-for-shutdown` (timeout 30s)
4. `stop` — `systemctl stop ip-cam-master`
5. `fetch` — `git fetch origin main`
6. `install` — `git reset --hard origin/main` then `npm ci` (skipped if `package.json` + `package-lock.json` unchanged)
7. `build` — `rm -rf .svelte-kit build` then `npm run build` (which now also runs `gen:version`)
8. `start` — `systemctl start ip-cam-master`
9. `verify` — health probe `curl http://127.0.0.1/api/version` 60s timeout, requires `sha === NEW_SHA && dbHealthy === true`

**D-15 — Two-stage rollback (charging-master pattern):**
- **Stage 1** (any failure from `fetch` onwards): `git reset --hard PRE_SHA` → `npm ci` → `npm run build` → `systemctl start` → verify. If verify passes, write `rolled_back / stage1`.
- **Stage 2** (Stage 1 fails): tar-extract `.update-state/snapshots/<PRE_SHA>.tar.gz` over `/opt/ip-cam-master` → `systemctl start` → verify. Write `rolled_back / stage2`. Final-failure path: write `failed`, exit code 3, journal logs are the diagnostic record.

**D-16 — Lock file: keep existing `/run/ip-cam-master-deploy.lock`, shared with `dev-deploy.sh` post-receive hook.**
No change. Updater unit acquires the same flock; concurrent dev-push or duplicate auto-trigger gets a fast 409.

### Out of Scope (Deferred)

Explicit non-goals for Phase 24, captured to prevent scope creep:

- **D-17 — Pushover notifications**: charging-master sends Pushover on success/failure. ip-cam-master has no Pushover credentials wired up. Defer; user can add later as a quick task.
- **D-18 — Update-channel selection** (e.g., stable vs main vs tags): out of scope. Always `origin/main`.
- **D-19 — Pre-update PR review / changelog rendering**: out of scope. Commit message + author + date only.
- **D-20 — Authenticated GitHub API** (raises rate-limit from 60 → 5000 req/h): unauthenticated 60 req/h is plenty for 6h-interval polling. Defer.

## Code Context

### Files that already exist (will be modified)

- `src/lib/server/services/update-check.ts` — extend with ETag (`If-None-Match`/`If-Modified-Since`), persist `lastCheckEtag` to state.json
- `src/lib/server/services/update-runner.ts` — switch from `systemd-run` to dedicated unit; emit `[stage=]` markers parser
- `src/lib/server/services/update-history.ts` — rewrite against `update_runs` Drizzle table; keep migration shim that ingests legacy JSON blob on first read
- `src/lib/server/services/version.ts` — replace runtime git-describe with import from generated `src/lib/version.ts`
- `src/lib/server/services/backup.ts` — no changes (pre-update backup keeps working)
- `src/lib/server/services/settings.ts` — no changes (auto-update settings live as new keys with `update.` prefix)
- `src/lib/server/db/schema.ts` — add `update_runs` table
- `src/lib/components/settings/VersionTab.svelte` — add auto-update card + stepper + overlay slots
- `src/lib/components/settings/UpdateRunPanel.svelte` — drive stepper from log markers; mount overlay on SSE drop
- `src/routes/api/update/check/+server.ts` — add 5min cooldown
- `src/routes/api/update/run/+server.ts` — keep, add localhost guard, switch to dedicated unit spawn
- `src/routes/api/update/run/stream/+server.ts` — keep
- `src/routes/api/update/run/history/+server.ts` — switch source to `update_runs` table
- `src/routes/api/update/status/+server.ts` — keep (read state.json + settings)
- `src/routes/api/version/+server.ts` — currently returns `git describe`; switch to import from generated `version.ts`; add `dbHealthy: SELECT 1`
- `scripts/update.sh` — major rewrite to 9-stage pipeline + 2-stage rollback
- `src/hooks.server.ts` — register two new scheduler ticks

### Files that will be created

- `src/lib/server/services/github-client.ts` — typed GitHub commits API client with ETag, never throws
- `src/lib/server/services/update-state-store.ts` — atomic JSON file (tmp + rename), shared with bash
- `src/lib/server/services/update-checker.ts` — 6h check tick + 5min auto-update opportunity decision engine
- `src/lib/server/services/update-info-view.ts` — pure function: state + version → UI view model
- `src/routes/api/update/ack-rollback/+server.ts` — clear rollback banner
- `src/routes/api/internal/prepare-for-shutdown/+server.ts` — drain endpoint, localhost-only
- `src/lib/components/settings/AutoUpdateCard.svelte` — toggle + hour dropdown
- `src/lib/components/settings/UpdateStageStepper.svelte` — 9-pill progress UI
- `src/lib/components/settings/ReconnectOverlay.svelte` — modal polling /api/version
- `src/lib/components/settings/InstallModal.svelte` — confirm dialog with conflict warning
- `src/lib/version.ts` — generated, gitignored
- `scripts/build/generate-version.mjs` — prebuild version generator
- `scripts/update/ip-cam-master-updater.service` — dedicated systemd unit
- `scripts/update/install-updater-unit.sh` — installs the unit + reload + enable
- `drizzle/<NNNN>_update_runs.sql` — migration for new table

### Patterns to reuse

- **Encrypted settings storage** (`settings.ts`) — auto-update prefs are non-sensitive, NOT encrypted
- **In-memory 30s TTL settings cache** — auto-update settings change rarely, cache OK
- **Drizzle migrations** — same `drizzle-kit push` pattern as v1.3 schema lock
- **SSE log streaming with 15s heartbeat** — already in `update/run/stream` route, keep as-is
- **`/run/ip-cam-master-deploy.lock` flock** — already shared with post-receive; updater unit uses same
- **Scheduler additions** (`scheduler.ts`) — pattern is `setInterval` started in `hooks.server.ts`; new `updateCheckInterval` and `updateAutoApplyInterval` follow same shape

## Plan Wave Sketch (for planner)

Likely 5 waves; planner will refine:

- **Wave 1 — Foundation (parallel-safe):** DB migration (`update_runs` table), version-generator prebuild script, `update-state-store.ts`, `github-client.ts` (ETag), drain endpoint
- **Wave 2 — Backend logic (depends on W1):** `update-checker.ts` (scheduler decision engine), `update-info-view.ts`, refactor `update-check.ts` + `update-history.ts` + `update-runner.ts`, install dedicated systemd unit, hooks.server.ts wiring
- **Wave 3 — update.sh rewrite (depends on W2):** 9-stage pipeline, 2-stage rollback, drain call, `[stage=]` markers, snapshot tar
- **Wave 4 — UI (depends on W2):** `AutoUpdateCard`, `UpdateStageStepper`, `ReconnectOverlay`, `InstallModal`, `VersionTab` integration, `UpdateRunPanel` refactor
- **Wave 5 — Deploy + UAT (depends on W1-W4):** `./scripts/dev-deploy.sh`, manual UAT against live VM (toggle persists, manual install completes, history visible, simulate failure → rollback works)

## Risk Watch

- **Schema migration on auto-update**: the auto-update path calls `npm run build` but does NOT call `drizzle-kit push`. If a future auto-update commit ships a schema change, the verify stage will fail (`dbHealthy=false` after migration drift). Mitigation: `update.sh` runs `npm run db:push` before `start` if `package.json` includes a `db:push` script and the schema hash differs (extend existing schema-hash check from current `update.sh`).
- **WS-reconnect on Protect Hub during install**: P19 onboarding may have a live UniFi Protect WS connection. Drain stage MUST disconnect cleanly to avoid the 5-min reconnect-storm timer charging-master ran into.
- **First-time install of dedicated unit**: `ensureUpdateScriptInstalled` runs at app boot, so the unit appears AFTER the first restart following the deploy of Phase 24 itself. The very first auto-update will use whatever path was installed by the previous boot — verify this in UAT.
- **Build artifact size**: SvelteKit's `.svelte-kit/` + `build/` artifacts are ~50MB. The `.update-state/snapshots/<sha>.tar.gz` should exclude them (only source needs snapshotting; build is regenerated). This shrinks snapshots from ~250MB → ~5MB.

## Notes for Researcher

Phase 24 is a **port + extend**, not a green-field design. Researcher's job is **NOT** to evaluate whether to do this — it's to:
1. Verify the 9-stage pipeline order is sound for ip-cam-master's specific runtime (npm vs pnpm, SvelteKit `.svelte-kit/` vs Next.js `.next/`)
2. Identify any pitfalls specific to better-sqlite3 vs PostgreSQL (charging-master uses PG; we use SQLite WAL — checkpointing during drain is SQLite-specific)
3. Confirm `Intl.DateTimeFormat` timezone hour extraction works correctly on Debian 13 LXC (tzdata installed?)
4. Confirm `tar` exclusion patterns for SvelteKit builds match what's needed
5. Validate that the existing `/run/ip-cam-master-deploy.lock` flock works correctly with the dedicated systemd-unit pattern (different process tree)

Use charging-master as the canonical reference for everything else — researcher should not re-derive design choices that are already settled.

## Notes for Planner

- Plan as 5 waves above. W1 fully parallelizable across 4 agents. W3 sequential (one bash file). W4 mostly parallel (separate Svelte components).
- Each wave ends with a verification checkpoint (typecheck, build, tests).
- Final wave (deploy) is `autonomous=false` — user must observe the running VM.
- All commits atomic per task. Conventional commits format: `feat(24)`, `fix(24)`, `docs(24)`, etc.
- Total scope: ~25-30 task units, ~12-15 plan files.
