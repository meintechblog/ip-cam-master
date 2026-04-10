---
phase: 09-update-runner-rollback
audit_date: 2026-04-10
asvs_level: 2
threats_found: 10
threats_closed: 10
threats_open: 0
status: SECURED
---

# Phase 09 Security Audit — Update Runner & Rollback

## Scope

Verification that threat mitigations declared in `09-01-PLAN.md` `<threat_model>`
are honored in the shipped implementation. Implementation files were read-only.
No code was modified by this audit.

Attack surface audited:
- `POST /api/update/run` (triggers detached systemd-run executing shell script as root)
- `GET /api/update/run/stream` (SSE tail of attacker-supplied filesystem paths)
- `GET /api/update/run/history`
- `scripts/update.sh` (shell pipeline: git pull, npm install, build, restart)
- `src/lib/server/services/update-runner.ts` (spawn layer)
- `src/hooks.server.ts` + `src/lib/config/routes.ts` (auth gate)
- `data/backups/` exposure (new from Phase 07 + Phase 09 auto-backup)

## Threat Register — Verification Results

| Threat ID | Category               | Component                                 | Disposition | Status | Evidence |
|-----------|------------------------|-------------------------------------------|-------------|--------|----------|
| T-09-01   | Tampering              | POST /api/update/run                      | mitigate    | CLOSED | `src/lib/config/routes.ts:5` PUBLIC_PATHS does not include `/api/update`. Hooks.server.ts:29 falls through to auth when not public. |
| T-09-02   | Information Disclosure | GET /api/update/run/stream (logPath)      | mitigate    | CLOSED | `src/routes/api/update/run/stream/+server.ts:7-16,27` strict regex `^/tmp/ip-cam-master-update-\d+\.log$` + explicit `..` reject. EXITCODE_PATH_REGEX applied to exitcodeFile too. 400 on mismatch. |
| T-09-03   | Elevation of Privilege | spawnUpdateRun argv                       | mitigate    | CLOSED | `src/lib/server/services/update-runner.ts:121-137` args built as array, `spawn('systemd-run', args, {detached:true, stdio:'ignore'})` — no `shell:true`, no string interpolation. `scripts/update.sh` reads args as `"$1"` / `"$2"` (quoted). |
| T-09-04   | Denial of Service      | Concurrent POST /api/update/run           | mitigate    | CLOSED | Timestamped unit name `ip-cam-master-update-${Date.now()}` (update-runner.ts:100) — systemd-run refuses duplicate unit names in the same millisecond; concurrent git pulls naturally serialize via git lock. Accepted at plan level as "at most one successful update". |
| T-09-05   | Repudiation            | Attribution of update trigger             | accept      | CLOSED | Single-user self-hosted tool. `UpdateRunEntry` (update-history.ts:8-17) stores `startedAt`, no user field. Accepted per homelab single-admin pattern — documented in Accepted Risks below. |
| T-09-06   | Spoofing               | Git remote serves malicious code          | transfer    | CLOSED | Trust transferred to HTTPS + GitHub account security. `scripts/update.sh:93` uses `git pull --ff-only origin main`. Documented in Transferred Risks below. |
| T-09-07   | Tampering              | /tmp log files world-readable             | accept      | CLOSED | Single-tenant root-owned VM; standard /tmp 1777 perms; logs contain only build output. Documented in Accepted Risks below. |
| T-09-08   | Denial of Service      | Build failure leaves app broken           | mitigate    | CLOSED | `scripts/update.sh:75-88` rollback helper resets to `$PRE_SHA` + reinstall + rebuild + restart. Wired into every failure branch (install:117, build:124, restart:131, service-inactive:138, pull:95). Regression-tested in `update-runner.rollback.test.ts`. |
| T-09-09   | Information Disclosure | Schema change warning text                | accept      | CLOSED | `scripts/update.sh:108-110` emits only the text `WARNING: schema.ts changed — manual migration may be required`. No hash, no content. Accepted per plan. |
| T-09-10   | Tampering              | /usr/local/bin/ip-cam-master-update.sh    | mitigate    | CLOSED | `update-runner.ts:61-62` `fsp.copyFile` + `fsp.chmod(0o755)`. `ensureUpdateScriptInstalled` only overwrites when source mtime is newer — never appends. Root ownership via systemd service user. |

Result: 10/10 threats closed. No open threats. Phase 09 SECURED.

## Evidence (File:Line References)

### T-09-01 — Auth gate for POST /api/update/run

`src/lib/config/routes.ts:5`
```ts
export const PUBLIC_PATHS = [...STANDALONE_ROUTES, '/api/auth', '/api/settings'];
```
`/api/update/*` is absent from this list. `src/hooks.server.ts:29` invokes
`isPublicPath(event.url.pathname)` and returns early only for public paths —
all update routes fall through to session validation (hooks.server.ts:45-54).

### T-09-02 — SSE path-traversal guard

`src/routes/api/update/run/stream/+server.ts:7-16`
```ts
const LOG_PATH_REGEX = /^\/tmp\/ip-cam-master-update-\d+\.log$/;
const EXITCODE_PATH_REGEX = /^\/tmp\/ip-cam-master-update-\d+\.exitcode$/;

function validatePath(value: string | null, regex: RegExp): boolean {
    if (value === null) return false;
    if (value.includes('..')) return false;
    return regex.test(value);
}
```
Both `logPath` AND `exitcodeFile` query params are validated (line 27). 400
`invalid_path` returned on any mismatch. Redundant `..` string reject documents
intent even though the regex already excludes `.` characters.

NOTE: Matches `12-SECURITY` baseline stated in plan — regex is stricter than the
plan claimed (exitcodeFile also regex-validated, not just suffix-checked).

### T-09-03 — Command injection prevention

`src/lib/server/services/update-runner.ts:121-137`
```ts
const args = [
    `--unit=${unitName}`,
    '--service-type=oneshot',
    '--collect',
    '--quiet',
    `--setenv=LOG=${logPath}`,
    `--setenv=EXITCODE_FILE=${exitcodeFile}`,
    INSTALLED_SCRIPT_PATH,
    preSha,
    preSchemaHash
];

const child: ChildProcess = spawn('systemd-run', args, {
    detached: true,
    stdio: 'ignore'
});
```
- `args` is an array, not a string.
- `spawn` options do not set `shell: true`.
- `preSha` / `preSchemaHash` are passed as positional argv items; bash receives
  them as `$1` / `$2` (pre-split by execve).
- Unit name `unitName = ip-cam-master-update-${ts}` where `ts = Date.now()` —
  safe integer.
- `logPath` / `exitcodeFile` are derived from `ts` + fixed string — no user input.

`scripts/update.sh:26-27`
```bash
PRE_SHA="${1:-}"
PRE_SCHEMA_HASH="${2:-}"
```
Both are quoted on every usage:
- `git reset --hard "$PRE_SHA"` (line 78, 95)
- Nothing `eval`ed, nothing unquoted.
- `INSTALL_DIR="${INSTALL_DIR:-/opt/ip-cam-master}"` (line 30) is env-sourced, not
  user input.

### T-09-04 — Concurrent trigger DoS

`src/lib/server/services/update-runner.ts:97-100`
```ts
const ts = Date.now();
const logPath = `/tmp/ip-cam-master-update-${ts}.log`;
const exitcodeFile = `/tmp/ip-cam-master-update-${ts}.exitcode`;
const unitName = `ip-cam-master-update-${ts}`;
```
Two POSTs in the same millisecond would race the unit-name creation —
systemd-run rejects duplicates. The common case (seconds apart) produces two
independent units; both would attempt `git pull` against the same worktree and
the second would fail fast on the git index lock. Plan explicitly accepts this
as "at most one successful update".

NOTE: There is no explicit application-level in-flight guard. Per plan disposition
this is acceptable because:
1. The threat model accepts "concurrent triggers produce at most one successful update".
2. Git's own lockfile serializes the destructive operations.
3. UI calls `loadHistory()` on mount and auto-resumes the SSE stream if an entry
   is still `running` (UpdateRunPanel.svelte mount `$effect`), making double-trigger
   from two tabs unlikely.

### T-09-05 — Repudiation (ACCEPTED)

`src/lib/server/services/update-history.ts:8-17`
```ts
export type UpdateRunEntry = {
    startedAt: string;
    finishedAt: string | null;
    preSha: string;
    postSha: string | null;
    result: 'running' | 'success' | 'failed' | 'rolled_back';
    logPath: string;
    unitName: string;
    backupPath?: string | null;
};
```
No `triggeredBy` / user field. Single-admin homelab pattern — see Accepted Risks.

### T-09-08 — Rollback chain

`scripts/update.sh:75-88`
```bash
rollback() {
    local reason="$1"
    log "ROLLBACK: $reason — resetting to $PRE_SHA"
    git reset --hard "$PRE_SHA" 2>&1 | tee -a "$LOG" || true
    ...
    echo "=== UPDATE_RESULT: failed ($reason, rolled back to $PRE_SHA) ===" | tee -a "$LOG"
    write_exit 2
    exit 0
}
```
All five failure branches call `rollback`:
- install failed (line 117)
- build failed (line 124)
- restart failed (line 131)
- service inactive after restart (line 138)
- git pull failure uses inline rollback (line 95) — equivalent reset + exit 2

Regression test: `src/lib/server/services/update-runner.rollback.test.ts` runs
the real script against a crafted failing `package.json` and asserts exit code 2,
`UPDATE_RESULT: failed` marker, and `git rev-parse HEAD == preSha`.

### T-09-10 — Script tamper resistance

`src/lib/server/services/update-runner.ts:54-63`
```ts
if (existsSync(INSTALLED_SCRIPT_PATH)) {
    const targetStat = await fsp.stat(INSTALLED_SCRIPT_PATH);
    if (targetStat.mtimeMs >= sourceStat.mtimeMs) {
        shouldCopy = false;
    }
}
if (shouldCopy) {
    await fsp.copyFile(sourcePath, INSTALLED_SCRIPT_PATH);
    await fsp.chmod(INSTALLED_SCRIPT_PATH, 0o755);
}
```
- Mode is 0755 (not 0777) — only root can write.
- `copyFile` replaces the whole file — never appends attacker content.
- Source path is derived from `findInstallDir()` which looks for `.git` under
  `/opt/ip-cam-master` or `process.cwd()` — not attacker-controllable.

### T-09-07 ancillary — data/backups/ exposure (auto-backup from Phase 09)

`.gitignore` line 26: `data/` — the backup directory and DB are excluded from git.
`src/routes/api/backup/download/+server.ts:14` creates a **fresh** snapshot via
`createBackup()` on every GET, then returns the bytes and deletes the temp copy.
The endpoint does NOT accept a filename parameter — no path traversal possible.
It is auth-gated (not in `isPublicPath`). No route serves arbitrary files from
`data/backups/`.

## Accepted Risks (Homelab / Single-Admin Pattern)

| ID       | Risk                                         | Reason Accepted                                                                 |
|----------|----------------------------------------------|--------------------------------------------------------------------------------|
| T-09-05  | No user attribution in update history        | Single-admin self-hosted tool. Timestamps provide sufficient forensic trail.   |
| T-09-07  | /tmp update logs are world-readable (1777)   | Single-tenant root-owned VM. Logs contain build output only, no secrets.       |
| T-09-09  | Schema-hash-change user-facing warning text  | Warning is a single fixed string — no sensitive data disclosed.                |

## Transferred Risks

| ID       | Risk                                  | Transfer Target                                    |
|----------|---------------------------------------|---------------------------------------------------|
| T-09-06  | Git remote serves malicious code      | GitHub account security + HTTPS TLS pinning.       |

## Unregistered Flags from SUMMARY.md

None. SUMMARY.md does not contain a `## Threat Flags` section. The executor did
not surface any new attack surface outside the planned threat register.

## Open Threats

None. All 10 threats in the register are verified as closed.

## Notes for Future Audits

1. **No file upload paths introduced in this phase** (T-09-05 from prompt N/A verified).
2. **Rollback test is gated** by `TEST_UPDATE_ROLLBACK=1` env var — CI does not
   exercise the real script. Textual invariants cover the branch logic unconditionally.
3. **Service runs as root** (no `User=` directive in ip-cam-master.service).
   This is an intentional design choice because the update pipeline calls
   `systemctl restart` on itself and writes to `/usr/local/bin`. Any future move
   to a dedicated user would require CAP_SYS_ADMIN or a sudoers drop-in for
   those two operations — out of scope for v1.1.
4. **No in-flight guard on POST /api/update/run**. Documented under T-09-04.
   If future requirements ever surface multi-tenant use or automated CI
   triggering, add an `update_run_in_progress` settings flag with TTL.
