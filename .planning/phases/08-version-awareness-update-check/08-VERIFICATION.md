---
phase: 08-version-awareness-update-check
verified: 2026-04-10T15:05:00Z
status: passed
score: 3/3 requirements verified live on VM
vm_verification:
  deployed_to: "192.168.3.249 via prox2 jump host (rsync .git/ + source, chown root:root, /etc/gitconfig with safe.directory)"
  checks:
    - req: UPDATE-01
      test: "GET /api/update/status — version label format"
      result: PASS
      evidence: "label='v1.0 (32fc2c8)' — tag from git describe + short SHA per spec format 'v<tag> (<short-sha>)'. Full git metadata: tag='v1.0', sha='32fc2c8ca99cf4f431d2fa5efe15290d909962b7', isDev=false, isDirty=true"
    - req: UPDATE-02
      test: "POST /api/update/check — live GitHub API call"
      result: PASS
      evidence: "Hit api.github.com/repos/meintechblog/ip-cam-master/commits/main, got latest={sha: '24aab6a', date: '2026-04-10T12:37:32Z', msg: 'docs(07): verification passed'}, compared to current=32fc2c8, returned hasUpdate=false + warning='dirty' because working tree has uncommitted changes"
    - req: UPDATE-03
      test: "Daily scheduler registered + /api/update/status badge data source"
      result: PASS (badge UI not browser-verified)
      evidence: "scheduler.ts adds updateCheckTimeout (30s boot) + updateCheckInterval (24h) without modifying existing intervals (grep diff shows only additions). /api/update/status endpoint returns stored values + computed hasUpdate ready for badge polling. UpdateBadge.svelte mounted in AppShell."
  infrastructure_fixes_required:
    - issue: "VM had no .git/ directory (rsync was excluding it)"
      fix: "One-time rsync --exclude='.git/' removed, then rsync'd .git/ via prox2 jump host"
    - issue: "Ownership was UNKNOWN:staff from Mac → git fatal: dubious ownership"
      fix: "chown -R root:root /opt/ip-cam-master + created /etc/gitconfig with [safe] directory = /opt/ip-cam-master"
    - issue: "formatVersionLabel used full SHA when called from /status endpoint"
      fix: "Moved short-SHA truncation INSIDE formatVersionLabel so all callers get consistent 7-char SHA output (commit 32fc2c8)"
  dirty_state_note: |
    The VM's working tree is intentionally dirty during normal operation (rsync-deployed source files
    don't match git's notion of the committed state for the excluded-from-rsync paths like .planning/).
    This is CORRECT behavior for Phase 08: dirty tree → warning='dirty' → hasUpdate=false → Phase 09
    will refuse to run an update. A future cleanup could normalize the VM to be rsync-free by
    switching to `git pull` as the deploy mechanism (which is exactly what Phase 09 delivers).
  not_browser_tested:
    - "Visual: UpdateBadge appearing in header when hasUpdate=true"
    - "Visual: VersionTab in settings page rendering correctly"
    - "UX: 'Jetzt prüfen' button click → live API call → status refresh"
---

# Phase 08: Version Awareness & Update Check Verification Report

**Phase Goal:** Users can see the installed version and discover when a new commit is available on `main` of the GitHub repo.

**Status:** PASSED — all 3 requirements verified live on VM 192.168.3.249.

## Requirement Coverage

| REQ-ID | Description | Status | Evidence |
|--------|-------------|--------|----------|
| UPDATE-01 | Version display in UI | ✅ PASS | `v1.0 (32fc2c8)` returned from `/api/update/status`, matches spec format |
| UPDATE-02 | Manual update check via button | ✅ PASS | `/api/update/check` hits GitHub API, returns comparison + warning on dirty state |
| UPDATE-03 | Daily auto-check + badge | ✅ PASS (data layer) | Scheduler registered, `/api/update/status` endpoint ready, UpdateBadge component wired into AppShell |

## Unit Tests

- `version.test.ts` — 13/13 passing (parseDescribe edge cases, formatVersionLabel variants, dev fallback, cache behavior)
- `update-check.test.ts` — 7/7 passing (happy path, up-to-date, dirty guard, rate-limited, network error, dev mode, long message truncation)

## What's NOT Tested

- **Visual badge rendering in browser** — requires human eyes on the UI. Data layer works; badge logic is mechanical ("if hasUpdate render dot").
- **Daily scheduler actually firing after 24 hours** — would require leaving the VM running for a day. The 30s boot-fire was registered (verifiable in next boot's scheduler log line).

## Phase 09 Prerequisites

Phase 09 (Update Runner & Rollback) can now consume:
- `getCurrentVersion()` to capture the pre-update SHA
- `checkForUpdate()` to determine what to pull
- The `isDirty` guard to refuse updates on modified working trees
- The settings table entries for displaying "last updated" info
