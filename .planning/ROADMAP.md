# Roadmap: IP-Cam-Master

## Completed Milestones

- **v1.0** — One-click camera onboarding for Mobotix/Loxone into UniFi Protect (5 phases, 11 plans) — [Archive](milestones/v1.0-ROADMAP.md)

## Current Milestone

**v1.1 — Self-Maintenance & Polish**

Make the running app maintainable without SSH. Every routine operation a self-hoster might need — updating, backing up, inspecting logs, checking health — reachable from the web UI.

**Granularity:** standard
**Phases:** 4 (numbered 06–09, continuing from v1.0)
**Requirements:** 17 Active (UPDATE ×8, BACKUP ×3, LOGS ×3, HEALTH ×3)
**Coverage:** 17/17 mapped ✓

## Phases

- [x] **Phase 06: Observability Dashboard** — Logs viewer and health vitals reachable from the UI, no SSH required (completed 2026-04-10)
- [x] **Phase 07: Backup & Restore** — Users can download and restore the SQLite database from the UI as a safety net before risky operations (completed 2026-04-10)
- [x] **Phase 08: Version Awareness & Update Check** — Users can see the installed version and discover when a new commit is available on `main` (completed 2026-04-10)
- [ ] **Phase 09: Update Runner & Rollback** — Users can trigger an in-app update with live progress, safety guards, and automatic rollback on failure

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 06. Observability Dashboard | 2/2 | Complete   | 2026-04-10 |
| 07. Backup & Restore | 1/1 | Complete   | 2026-04-10 |
| 08. Version Awareness & Update Check | 1/1 | Complete   | 2026-04-10 |
| 09. Update Runner & Rollback | 0/1 | In progress | — |

## Phase Details

### Phase 06: Observability Dashboard
**Goal**: Users can inspect live systemd journal output and VM vitals (disk, RAM, service status) directly from the web UI without ever opening an SSH session.
**Depends on**: Nothing (first phase of v1.1, builds on v1.0 foundation)
**Requirements**: LOGS-01, LOGS-02, LOGS-03, HEALTH-01, HEALTH-02, HEALTH-03
**Success Criteria** (what must be TRUE):
  1. User opens a Logs page and sees the last N lines of the `ip-cam-master` systemd journal, scrollable
  2. User filters the log view by severity (error / warning / info / all) and only matching lines remain visible
  3. While the Logs page is open, new journal entries appear without a manual refresh
  4. The main dashboard shows current VM disk usage and RAM usage as used/total/percent values
  5. The main dashboard shows whether `ip-cam-master.service` is active, inactive, or failed, along with its current uptime
**Plans**: TBD
**UI hint**: yes

**Sequencing rationale**: Observability is read-only and low-risk, so it is a safe first phase that immediately unblocks the user's ability to debug from the browser. It also builds the foundational server-side primitives for reading `journalctl`, `systemctl`, and host vitals — primitives that Phase 09 will reuse for streaming live update progress and verifying service status after a restart.

### Phase 07: Backup & Restore
**Goal**: Users can download a timestamped copy of the SQLite database and restore from an uploaded backup file, giving them a manual safety net before any risky operation.
**Depends on**: Phase 06 (optional — shares no code, but backup download/restore is a sensible UI addition alongside the observability surface)
**Requirements**: BACKUP-01, BACKUP-02, BACKUP-03
**Plans**: 1 plan
**Success Criteria** (what must be TRUE):
  1. User clicks a download button and receives the current `data/ip-cam-master.db` file as a single download
  2. The downloaded filename contains a human-readable timestamp (e.g. `ip-cam-master-20260410-1430.db`)
  3. User uploads a previously downloaded backup file through the UI and, after an explicit confirmation dialog warning that current data will be replaced, the database is restored
Plans:
- [x] 07-01-PLAN.md — Backup service, download/restore API routes, settings Backup tab with confirmation modal
**UI hint**: yes

**Sequencing rationale**: Backup/restore is the safety prerequisite for in-app self-update. It must ship before Phase 09 so the first time a user clicks "update," they can first grab a backup with one click. Scope is small enough to stand alone without being folded into the update phase.

### Phase 08: Version Awareness & Update Check
**Goal**: Users can see what version of IP-Cam-Master is currently installed and learn — on demand or automatically — when a newer commit is available on GitHub.
**Depends on**: Phase 07 (logical only — user should have a backup mechanism available before they even think about updating)
**Requirements**: UPDATE-01, UPDATE-02, UPDATE-03
**Success Criteria** (what must be TRUE):
  1. User sees the currently installed version in the UI, formatted as `v<tag> (<short-sha>)` when a git tag exists or `main @ <short-sha>` otherwise
  2. User clicks an "Check for updates" button and the UI shows whether the local commit matches the latest `main` commit on `meintechblog/ip-cam-master`
  3. Without user action, the app queries GitHub at most once per 24 hours in the background
  4. When a new commit is available, a badge appears in the header alerting the user
**Plans**: TBD
**UI hint**: yes

**Sequencing rationale**: Version display and update-check are read-only GitHub API integrations with zero execution risk. Shipping them before the update runner lets users trust the version metadata and validate the GitHub API path in isolation. It also establishes the data model (current SHA, latest SHA, last-checked-at) that Phase 09's runner will reuse.

### Phase 09: Update Runner & Rollback
**Goal**: Users can trigger an in-app update that pulls, installs, builds, and restarts the app as a detached process with live progress, safety guards against dirty checkouts and schema drift, and automatic rollback to the previous commit if any step fails.
**Depends on**: Phase 06 (live log streaming infrastructure), Phase 07 (backup safety net), Phase 08 (version + latest-SHA data)
**Requirements**: UPDATE-04, UPDATE-05, UPDATE-06, UPDATE-07, UPDATE-08
**Success Criteria** (what must be TRUE):
  1. User clicks "Update now" and the update runs as a detached `systemd-run --transient` unit so the subsequent `systemctl restart ip-cam-master` does not kill the update itself
  2. While the update is running, the user sees live stdout/stderr from each step (pull, install, build, restart) streaming into the UI, and after completion the last run's log remains viewable
  3. If uncommitted local changes exist in the install directory, the update refuses to start and the UI shows the list of dirty files with a clear error
  4. If `npm install`, `npm run build`, or `systemctl restart` fails, the runner automatically executes `git reset --hard <pre-update-sha>`, rebuilds, and the previous working version is back online without user intervention
  5. When `git pull` changes the hash of `src/lib/server/db/schema.ts`, the user sees a schema-change warning before the build+restart step proceeds
**Plans**: 1 plan
Plans:
- [ ] 09-01-PLAN.md — Update runner service, SSE streaming, rollback logic, VersionTab integration
**UI hint**: yes

**Sequencing rationale**: This is the highest-risk phase of the milestone — it executes shell commands against the live installation and can leave the app in a broken state if done wrong. It comes last so it can lean on (a) Phase 06's log-streaming and service-status primitives for live progress and post-restart verification, (b) Phase 07's backup as a user-visible safety net before the first click, and (c) Phase 08's already-validated GitHub integration to find the target commit.
