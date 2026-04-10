---
phase: 07-backup-restore
plan: 01
subsystem: backup
tags: [backup, sqlite, settings, safety-net]
requirements: [BACKUP-01, BACKUP-02, BACKUP-03]
dependency-graph:
  requires:
    - src/lib/server/db/client.ts (raw sqlite handle + DB_ABS_PATH)
  provides:
    - createBackup() / validateAndRestore() service
    - GET /api/backup/download
    - POST /api/backup/restore
    - Settings -> Backup tab
  affects:
    - src/routes/settings/+page.svelte (new tab)
    - src/lib/server/db/client.ts (exports added)
tech-stack:
  added: []
  patterns:
    - "Pure validation service returning staged path (no side effects on live DB)"
    - "Response-then-exit: build Response, setTimeout(exit, 500), return response"
    - "POSIX atomic rename via staging path on same filesystem"
key-files:
  created:
    - src/lib/server/services/backup.ts
    - src/lib/server/services/backup.test.ts
    - src/routes/api/backup/download/+server.ts
    - src/routes/api/backup/restore/+server.ts
    - src/lib/components/settings/BackupTab.svelte
    - .planning/phases/07-backup-restore/deferred-items.md
  modified:
    - src/lib/server/db/client.ts
    - src/routes/settings/+page.svelte
decisions:
  - "Split validation from rename/exit: validateAndRestore() is side-effect-free so it is unit-testable without killing the test runner. The API route owns the final write+rename+exit."
  - "Staging path lives next to the live DB (DB_ABS_PATH + '.restore-pending') to guarantee the renameSync() is POSIX-atomic — rename() is only atomic on the same filesystem."
  - "Use browser-native <a href download> for the download flow instead of a JS fetch+blob roundtrip. Simpler, and the Content-Disposition header is authoritative for the filename."
  - "100 MB MAX_BACKUP_BYTES sanity limit — typical ip-cam-master.db is <1 MB; 100 MB is generous headroom without accepting obvious garbage uploads."
metrics:
  duration: ~15min
  completed: "2026-04-10"
  tasks: 4
  files: 8
---

# Phase 7 Plan 1: Backup & Restore Summary

SQLite backup download + upload-restore flow exposed via a new Settings -> Backup tab, gated by an explicit German confirmation modal, using POSIX atomic rename and a scheduled `process.exit(0)` that relies on systemd to bring the service back up with the new DB. Safety net prerequisite for the Phase 9 in-app updater.

## What Shipped

| File | Purpose |
|------|---------|
| `src/lib/server/db/client.ts` | Export raw `sqlite` handle + `DB_ABS_PATH` so backup service can call better-sqlite3's online backup API and stage restores on the same filesystem. |
| `src/lib/server/services/backup.ts` | `createBackup(destDir?)`, `validateAndRestore()`, `formatBackupTimestamp()`, `REQUIRED_TABLES`, `MAX_BACKUP_BYTES`. Pure service — no rename/exit side effects. |
| `src/lib/server/services/backup.test.ts` | 14 unit tests covering timestamp padding, size limit, corrupt file, wrong-schema rejection, happy path, staged-path-not-written invariant, createBackup integrity. |
| `src/routes/api/backup/download/+server.ts` | GET endpoint. Snapshot via createBackup(), streams with timestamped Content-Disposition, unlinks on-disk copy. |
| `src/routes/api/backup/restore/+server.ts` | POST endpoint. `confirmed=true` gate, write-to-staging, atomic renameSync over DB_ABS_PATH, setTimeout(process.exit(0), 500) AFTER response is built. |
| `src/lib/components/settings/BackupTab.svelte` | Download button + file input + confirmation modal (fixed overlay) + error/success banners. Svelte 5 runes. |
| `src/routes/settings/+page.svelte` | Adds 'Backup' tab between Credentials and Zugangsschutz, routes to `<BackupTab />`. |
| `.planning/phases/07-backup-restore/deferred-items.md` | Logs 9 pre-existing svelte-check errors in unrelated files (onboarding.ts, cameras/status, etc.) discovered during verify. |

## Requirements Coverage

| Req | How met |
|-----|---------|
| BACKUP-01 | GET /api/backup/download streams `data/ip-cam-master.db` as a single file. |
| BACKUP-02 | POST /api/backup/restore requires `confirmed=true` (UI surfaces a modal); validates filename, size, integrity, required tables; atomically replaces DB; restarts service via systemd. |
| BACKUP-03 | Download filename is `ip-cam-master-YYYYMMDD-HHMM.db` in local time (see `formatBackupTimestamp`). |

## Verification

- `npx vitest run src/lib/server/services/backup.test.ts` — 14/14 pass
- `npm run build` — clean (adapter-node, 11.8s)
- `npm run check` — 9 pre-existing errors in unrelated files (logged to deferred-items.md); 0 new errors from Phase 07 files
- No new npm dependencies (git diff on package.json + package-lock.json is empty)
- No routes created outside `/api/backup/*` and the settings page modification

## Deviations from Plan

Plan executed as written. Minor clarifying additions only:
- BackupTab.svelte includes an `io_error` mapping in `errorMessage()` (plan's switch block listed all other error codes but omitted io_error; added for completeness since the API route can return it on staging write failures).
- BackupTab.svelte shows the selected filename + size under the file input for user confidence — not in the plan but a small UX polish consistent with other settings tabs.

## systemd Unit File Assumption

The restore endpoint's `process.exit(0)` flow requires the `ip-cam-master.service` systemd unit to have `Restart=on-failure` or `Restart=always`. Per the installer script convention noted in the plan, this is the expected configuration. The unit file is NOT present in this worktree to grep directly, so verify on the VM during Task 4:

```bash
ssh ip-cam-master.local "grep -i restart /etc/systemd/system/ip-cam-master.service"
```

Expected output should contain `Restart=on-failure` or `Restart=always`. If missing, the VM operator must add it before exercising the restore flow, otherwise `process.exit(0)` will leave the service dead instead of restarted.

## Task 4 — Manual VM Verification (deferred)

Per the orchestrator contract, Task 4 is documentation-only in this worktree. The code pieces the checkpoint requires are all in place and have been grep-verified:

| Requirement | Location | Confirmed |
|-------------|----------|-----------|
| `process.exit(0)` fires after response | `src/routes/api/backup/restore/+server.ts:99` (inside `setTimeout`, scheduled AFTER `const response = json(...)` at line 97) | yes |
| Atomic `renameSync` over live DB | `src/routes/api/backup/restore/+server.ts:77` | yes |
| `PRAGMA integrity_check` on uploads | `src/lib/server/services/backup.ts:107` | yes |
| `REQUIRED_TABLES` enforcement | `src/lib/server/services/backup.ts:117` | yes |
| Staging path on same filesystem as DB | `src/lib/server/services/backup.ts:131` (`${DB_ABS_PATH}.restore-pending`) | yes |
| `confirmed=true` gate on POST | `src/routes/api/backup/restore/+server.ts:43` | yes |

### VM verification steps (run by operator)

1. **Deploy to VM** (rsync excluding `data/` to preserve the live DB):
   ```bash
   rsync -avz --delete --exclude='data/' --exclude='node_modules/' --exclude='.svelte-kit/' \
     ./ root@ip-cam-master.local:/opt/ip-cam-master/
   ssh root@ip-cam-master.local "cd /opt/ip-cam-master && npm install && npm run build && systemctl restart ip-cam-master"
   ```

2. **Visual smoke test**
   - Open https://ip-cam-master.local -> Settings -> confirm "Backup" tab appears between "Credentials" and "Zugangsschutz".

3. **Download**
   - Click "Jetzt herunterladen".
   - Confirm the browser downloads a file named `ip-cam-master-YYYYMMDD-HHMM.db` where the timestamp matches the VM's local time (not UTC).
   - Locally: `sqlite3 ~/Downloads/ip-cam-master-*.db '.tables'` — must list `cameras`, `containers`, `credentials`, `events`, `settings`, `users`.

4. **Restore UI flow**
   - Back in the Backup tab, upload the file you just downloaded.
   - Confirm the "Wiederherstellen" button is DISABLED until a file is picked.
   - Click "Wiederherstellen" — modal appears with title "Daten wirklich ersetzen?" and body "Diese Aktion ersetzt alle aktuellen Daten...".
   - Click "Abbrechen" — modal closes, network tab shows NO POST to `/api/backup/restore`.
   - Click "Wiederherstellen" -> "Ja, wiederherstellen".
     - UI shows "Restore erfolgreich. Server startet neu..."
     - Browser loses connection briefly.
     - On the VM: `systemctl status ip-cam-master` shows a recent restart (check Active: line timestamp).
     - After ~10 s the page reloads automatically and the app is responsive.

5. **Negative tests**
   - Upload a random non-SQLite file renamed to `.db` (e.g. `dd if=/dev/urandom of=fake.db bs=4096 count=1`): expect red banner "Datei ist keine gültige SQLite-Datenbank".
   - Upload a file named `test.txt`: expect "Datei muss auf .db enden".
   - From a terminal on the VM: `curl -k -X POST https://ip-cam-master.local/api/backup/restore -F file=@/tmp/backup.db` — expect HTTP 400 and body `{"error":"confirmation_required",...}`. (Must include a valid session cookie, or run with YOLO mode enabled.)

6. **systemd unit check**
   - `cat /etc/systemd/system/ip-cam-master.service | grep -i restart` — must show `Restart=on-failure` or `Restart=always`.

## Known Stubs

None. All UI components are wired to real endpoints and real service logic.

## Deferred Issues

Pre-existing svelte-check errors in unrelated files — see `.planning/phases/07-backup-restore/deferred-items.md`. These do not block the build and are out of scope for this plan per the GSD deviation scope rule.

## Commits

- `4d3b789` feat(07-01): backup service with validation helpers
- `e1bbc43` feat(07-01): GET /api/backup/download + POST /api/backup/restore
- `6e7bb8e` feat(07-01): Backup settings tab with download + restore modal

## Self-Check

Files confirmed on disk (all absolute paths verified with `ls`):
- `src/lib/server/services/backup.ts` — FOUND
- `src/lib/server/services/backup.test.ts` — FOUND
- `src/routes/api/backup/download/+server.ts` — FOUND
- `src/routes/api/backup/restore/+server.ts` — FOUND
- `src/lib/components/settings/BackupTab.svelte` — FOUND
- `src/routes/settings/+page.svelte` — MODIFIED (Backup added to tabs tuple + {:else if} block)
- `src/lib/server/db/client.ts` — MODIFIED (exports `sqlite`, `DB_ABS_PATH`)
- `.planning/phases/07-backup-restore/deferred-items.md` — FOUND

Commits confirmed in git log:
- `4d3b789` — FOUND
- `e1bbc43` — FOUND
- `6e7bb8e` — FOUND

## Self-Check: PASSED
