# Requirements — Milestone v1.1 Self-Maintenance & Polish

**Goal:** Make the running app maintainable without SSH. Every routine operation a self-hoster might need — updating, backing up, inspecting logs, checking health — reachable from the web UI.

**Derived from:** v1.0 production feedback (user deployed the app via rsync from a dev machine for every bugfix; no self-hoster without dev setup could keep it updated).

---

## Active Requirements

### UPDATE — In-App Self-Update via GitHub

Primary feature of this milestone. Professional software expects a one-click update flow with safety and transparency.

- [ ] **UPDATE-01**: User can see the current installed version in the app UI (format: `v<tag> (<short-sha>)` if a git tag exists, otherwise `main @ <short-sha>`)
- [ ] **UPDATE-02**: User can manually trigger an update check via a button that queries the GitHub API for the latest commit on the `main` branch of `meintechblog/ip-cam-master`
- [ ] **UPDATE-03**: App automatically checks for updates once per 24 hours in the background and shows a badge in the header when an update is available
- [ ] **UPDATE-04**: User can trigger an update from the UI, which runs `git pull && npm install && npm run build && systemctl restart ip-cam-master` as a detached `systemd-run --transient` unit so the app's own restart does not kill the update process
- [ ] **UPDATE-05**: Update progress (stdout/stderr of each step) streams live to the UI while running, and the last update log is viewable afterwards
- [ ] **UPDATE-06**: Update refuses to run when uncommitted local changes exist in the installation directory, with a clear error message showing the dirty files
- [ ] **UPDATE-07**: If `npm install`, `npm run build`, or `systemctl restart` fails, the update runner automatically rolls back via `git reset --hard <pre-update-sha>` and re-runs the build so the previous working version is restored
- [ ] **UPDATE-08**: Update detects schema changes by comparing a hash of `src/lib/server/db/schema.ts` before and after `git pull`; if the schema changed, the user sees a warning before the build+restart step runs

### BACKUP — SQLite Backup & Restore

Prerequisite for safe self-updates and disaster recovery. Users need to be able to grab their config (cameras, credentials, settings) before risky operations.

- [ ] **BACKUP-01**: User can download a backup of the SQLite database (`data/ip-cam-master.db`) from the UI as a single file
- [ ] **BACKUP-02**: User can upload a backup file through the UI to restore the database, with explicit "this will replace current data" confirmation before the restore runs
- [ ] **BACKUP-03**: Downloaded backup files include a timestamp in the filename (e.g. `ip-cam-master-20260410-1430.db`)

### LOGS — Logs Viewer

Self-hosters currently need `journalctl -u ip-cam-master -f` via SSH to debug anything. Bringing this into the UI closes the SSH loop.

- [ ] **LOGS-01**: User can view the systemd journal output for the `ip-cam-master` service directly in the UI (last N lines, scrollable)
- [ ] **LOGS-02**: User can filter the log view by severity level (error / warning / info / all)
- [ ] **LOGS-03**: Log view auto-refreshes with new entries while open (polling or SSE — implementation free)

### HEALTH — Health Dashboard

One-glance status for the host VM and the service itself. Answers "is everything OK right now?" without SSH.

- [ ] **HEALTH-01**: User can see VM disk space (used / total / percent) on the main dashboard
- [ ] **HEALTH-02**: User can see VM RAM usage (used / total / percent) on the main dashboard
- [ ] **HEALTH-03**: User can see the `ip-cam-master.service` systemd status (active / inactive / failed) and service uptime

---

## Future Requirements

Deferred to a later milestone — valuable but not required for v1.1:

- Tag-based release channel: let users opt into stable tagged releases instead of rolling `main`
- Real Drizzle migration system (currently schema is direct — schema-hash check is a stopgap for v1.1)
- Remote backup target: S3/WebDAV push of nightly backups
- Log export (download as file for sharing in bug reports)
- Alert notifications: push / email when service goes down

## Out of Scope

Explicitly not this milestone, with reasons:

- **Update rollback via ZFS/LVM snapshots** — overkill for a config-heavy app, git-reset is sufficient
- **Multi-version installations side-by-side** — homelab tool, only one version needs to run
- **Web-based shell access** — too much security surface, defeats the "no SSH needed" goal by reintroducing root shell in the UI
- **Automatic unattended updates** — user should always confirm, even if auto-check finds an update

---

## Traceability

*Filled in by roadmapper after phase breakdown.*

| REQ-ID | Phase | Plan | Status |
|--------|-------|------|--------|
| UPDATE-01 | — | — | Active |
| UPDATE-02 | — | — | Active |
| UPDATE-03 | — | — | Active |
| UPDATE-04 | — | — | Active |
| UPDATE-05 | — | — | Active |
| UPDATE-06 | — | — | Active |
| UPDATE-07 | — | — | Active |
| UPDATE-08 | — | — | Active |
| BACKUP-01 | — | — | Active |
| BACKUP-02 | — | — | Active |
| BACKUP-03 | — | — | Active |
| LOGS-01 | — | — | Active |
| LOGS-02 | — | — | Active |
| LOGS-03 | — | — | Active |
| HEALTH-01 | — | — | Active |
| HEALTH-02 | — | — | Active |
| HEALTH-03 | — | — | Active |
