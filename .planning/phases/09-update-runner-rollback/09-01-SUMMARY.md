---
phase: 09-update-runner-rollback
plan: 01
subsystem: update-runner
tags: [update, self-update, systemd, sse, rollback, git]
requirements: [UPDATE-04, UPDATE-05, UPDATE-06, UPDATE-07, UPDATE-08]
dependency-graph:
  requires:
    - src/lib/server/services/version.ts
    - src/lib/server/services/update-check.ts
    - src/lib/server/services/settings.ts
    - src/lib/components/settings/VersionTab.svelte
    - src/routes/api/logs/journal/stream/+server.ts
    - src/hooks.server.ts
  provides:
    - scripts/update.sh
    - src/lib/server/services/update-runner.ts
    - src/lib/server/services/update-history.ts
    - src/routes/api/update/run/+server.ts
    - src/routes/api/update/run/stream/+server.ts
    - src/routes/api/update/run/history/+server.ts
    - src/lib/components/settings/UpdateRunPanel.svelte
  affects:
    - src/hooks.server.ts
    - src/lib/components/settings/VersionTab.svelte
tech-stack:
  added: []
  patterns:
    - Detached systemd-run --service-type=oneshot --collect unit survives app's own restart
    - Script lives in repo, installed to /usr/local/bin on startup via ensureUpdateScriptInstalled
    - Progress communicated via log file (not pipe) so EventSource reconnects cleanly after the app restart
    - --setenv=LOG=... --setenv=EXITCODE_FILE=... pre-computed by Node, read from env by bash (no timestamp races)
    - Completion marker protocol: UPDATE_RESULT line + exitcode file
    - Poll-based async generator (500ms) for tailing the log — simpler than fs.watch, works on every filesystem
    - SSE path-traversal regex allowlist for logPath / exitcodeFile query params
    - Persistent run detection on mount: history[0].result === 'running' auto-resumes the EventSource
    - Route-handler unit tests live in src/lib/server/routes-tests/ to avoid SvelteKit's reserved `+` prefix collision
key-files:
  created:
    - scripts/update.sh
    - src/lib/server/services/update-runner.ts
    - src/lib/server/services/update-runner.test.ts
    - src/lib/server/services/update-runner.rollback.test.ts
    - src/lib/server/services/update-history.ts
    - src/lib/server/services/update-history.test.ts
    - src/routes/api/update/run/+server.ts
    - src/routes/api/update/run/stream/+server.ts
    - src/routes/api/update/run/history/+server.ts
    - src/lib/server/routes-tests/update-run-post.test.ts
    - src/lib/server/routes-tests/update-run-stream.test.ts
    - src/lib/components/settings/UpdateRunPanel.svelte
  modified:
    - src/hooks.server.ts
    - src/lib/components/settings/VersionTab.svelte
decisions:
  - "Detached systemd-run --service-type=oneshot --collect unit (not --scope) so the update survives the parent app's restart and is queryable via systemctl status"
  - "Script lives in repo at scripts/update.sh committed with 100755 mode, installed to /usr/local/bin/ip-cam-master-update.sh via ensureUpdateScriptInstalled at boot — survives worktree swap during git pull"
  - "LOG + EXITCODE_FILE paths computed by Node (timestamped from Date.now()), passed to systemd-run via --setenv so bash script and server agree on paths without a timestamp race"
  - "Async generator polls every 500ms — simpler than fs.watch and works across tmpfs/ext4/overlayfs"
  - "Path-traversal protection on SSE stream endpoint: strict regex ^/tmp/ip-cam-master-update-\\d+\\.(log|exitcode)$ + explicit `..` reject (T-09-02 mitigation)"
  - "Route-handler tests moved to src/lib/server/routes-tests/ because SvelteKit reserves files prefixed with + in the routes tree"
  - "Rollback integration test gated by TEST_UPDATE_ROLLBACK=1 env var — always-on textual invariant tests cover every branch for CI reliability"
metrics:
  duration: ~15min
  completed: "2026-04-10"
  tasks: 5
  files_created: 12
  files_modified: 2
  tests_added: 49
---

# Phase 09 Plan 01: Update Runner & Rollback Summary

## One-liner

In-app self-update flow using a detached `systemd-run --service-type=oneshot --collect` unit that runs `scripts/update.sh` (git pull → schema-hash warn → npm install → npm run build → systemctl restart with rollback to PRE_SHA on any failure), tailed via SSE into a live log panel that reconnects cleanly across the app's own restart. Closes milestone v1.1.

## What Shipped

### Task 1: `scripts/update.sh` + update-runner service (commit f1db6a2)

**`scripts/update.sh`** (committed 100755 via `git update-index --chmod=+x`):

- Reads `LOG` and `EXITCODE_FILE` from env (with timestamped defaults for standalone use)
- Preflight: validates args, presence of `.git`, cd into install dir
- Rollback helper: `git reset --hard "$PRE_SHA"` + best-effort `npm install` + `npm run build` + `systemctl restart ip-cam-master` — so the previous version comes back online automatically
- Pipeline:
  1. `git pull --ff-only origin main` — on failure: reset to PRE_SHA, `UPDATE_RESULT: failed (pull failed, reset to ...)`, exit code 2
  2. `sha256sum src/lib/server/db/schema.ts` vs `PRE_SCHEMA_HASH` — on mismatch: `WARNING: schema.ts changed — manual migration may be required` (non-blocking per UPDATE-08)
  3. `npm install` — on failure: rollback with reason `install failed`
  4. `npm run build` — on failure: rollback with reason `build failed`
  5. `systemctl restart ip-cam-master` — on failure: rollback with reason `restart failed`
  6. `sleep 3 && systemctl is-active --quiet ip-cam-master` — on failure: rollback with reason `service inactive after restart`
  7. Success: `UPDATE_RESULT: success (PRE_SHA -> POST_SHA)`, exit code 0
- Every branch writes both the `UPDATE_RESULT:` marker line to `$LOG` and an integer to `$EXITCODE_FILE` (0 = success, 1 = pre-flight error, 2 = rolled back). Rollback paths `exit 0` after writing the exitcode so systemd-run marks the unit successful (unit failure would mask the rollback signal).

**`src/lib/server/services/update-runner.ts`** exports:

- `ensureUpdateScriptInstalled()` — finds the install dir by the same candidate strategy as `version.ts` (`/opt/ip-cam-master` then `process.cwd()`), compares mtime of `scripts/update.sh` vs `/usr/local/bin/ip-cam-master-update.sh`, copies with `fsp.copyFile` + `fsp.chmod(0o755)` when target missing or older. Silent no-op when the source is not found (dev mode).
- `spawnUpdateRun(preSha, preSchemaHash)` — computes `ts = Date.now()`, `logPath = /tmp/ip-cam-master-update-${ts}.log`, `exitcodeFile = /tmp/ip-cam-master-update-${ts}.exitcode`, `unitName = ip-cam-master-update-${ts}`. Spawns `systemd-run` with the exact argv: `['--unit=...', '--service-type=oneshot', '--collect', '--quiet', '--setenv=LOG=...', '--setenv=EXITCODE_FILE=...', INSTALLED_SCRIPT_PATH, preSha, preSchemaHash]`. No `{shell:true}`, no string interpolation. Options `{detached:true, stdio:'ignore'}` + `child.unref()`.
- `tailUpdateLog(logPath, exitcodeFile, signal)` — async generator. Polls every 500ms: opens the log file handle, reads new bytes from current position, splits buffer on `\n`, yields `{type:'log', line}` per complete line. Between polls checks `existsSync(exitcodeFile)` — when found, drains remaining content, reads exit code, yields `{type:'done', exitCode, result}`, and returns. Respects `AbortSignal` via `sleepAbortable` helper.
- `getDirtyFiles()` — `execFile('git', ['status', '--porcelain'], {cwd:installDir})`, splits stdout, returns trimmed non-empty lines. Returns `[]` on any error (never throws).

**12 unit tests** cover: argv array construction (no shell interpolation), `child.unref()` called, argv contains all setenv flags + script path + positional args, logPath/exitcodeFile share timestamp suffix, tail yields line-by-line as content is appended, exit code mapping (0→success, 1→failed, 2→rolled_back), AbortSignal promptly stops the loop, `getDirtyFiles` parse and error cases, `ensureUpdateScriptInstalled` is a no-op in dev mode, and scripts/update.sh contains every required marker + env read.

### Task 2: `update-history` persistence service (commit d3f8e91)

**`src/lib/server/services/update-history.ts`**:

- `type UpdateRunEntry = { startedAt, finishedAt, preSha, postSha, result, logPath, unitName }`
- `appendUpdateRun(entry)` — loads array from `settings['update_run_history']`, pushes, trims to last 10 entries (`slice(-10)`), persists.
- `updateUpdateRun(unitName, patch)` — finds entry by `unitName`, `Object.assign` shallow merge, persists. No-op if not found (no throw).
- `readUpdateRuns(limit = 10)` — loads, defensively parses (`try/catch` + `Array.isArray` guard), returns reversed newest-first, sliced to limit.

**9 unit tests** with an in-memory `Map`-backed mock of `./settings`. Covers: store format, 10-entry bound (oldest dropped), reverse-chronological order, empty key, invalid JSON, non-array JSON, shallow-merge patch, no-op on missing unitName.

### Task 3: API routes + hooks.server.ts wire-up (commit f3a40a0)

**`POST /api/update/run`** — parses body `{force?:boolean}`, then in order:

1. `getCurrentVersion()` — `isDev` → 400 `{error:'dev_mode'}`
2. `isDirty` → `getDirtyFiles()` → 409 `{error:'dirty_tree', dirtyFiles}`
3. `getStoredUpdateStatus()` — `!hasUpdate && !force` → 400 `{error:'already_up_to_date'}`
4. Compute `preSchemaHash = sha256(await readFile('src/lib/server/db/schema.ts'))` via `crypto.createHash` (candidate-dir lookup same as version.ts)
5. `spawnUpdateRun(current.sha, preSchemaHash)` → `{logPath, exitcodeFile, unitName, startedAt}`
6. `appendUpdateRun({..., result:'running'})`
7. Return 202 with run info

**`GET /api/update/run/stream?logPath=...&exitcodeFile=...`** — SSE endpoint following the journal-stream pattern exactly:

- **Path-traversal guard**: `!validatePath(logPath, /^\/tmp\/ip-cam-master-update-\d+\.log$/)` OR includes `..` OR `!validatePath(exitcodeFile, /\.exitcode$/)` → 400 `{error:'invalid_path'}`. Explicit `..` reject is redundant with the regex but documents intent.
- `ReadableStream` with `start()` + `cancel()`. `start()` registers `request.signal` abort listener, starts 15s heartbeat (`: heartbeat\n\n`), iterates `for await` over `tailUpdateLog`:
  - `{type:'log'}` → enqueue `event: log\ndata: {line}\n\n`, also tracks `lastResultLine` for any line containing `UPDATE_RESULT:` so postSha can be parsed from the success marker
  - `{type:'done'}` → parses `lastResultLine` with `/UPDATE_RESULT: success \([0-9a-f]+ -> ([0-9a-f]+)\)/` for postSha, derives `unitName` from `path.basename(logPath).replace(/\.log$/, '')`, calls `updateUpdateRun(unitName, {finishedAt, result, postSha})`, enqueues `event: done\ndata: {exitCode, result, postSha}\n\n`, cleans up, closes controller.
- `cancel()` and client `abort` both call `cleanup()` which aborts the tail controller and clears heartbeat
- Response headers identical to journal stream

**`GET /api/update/run/history`** — returns `json(await readUpdateRuns(5))`

**`hooks.server.ts`** — adds `ensureUpdateScriptInstalled().catch(err => console.error(...))` after `startScheduler()` at module load. Fire-and-forget to avoid blocking boot.

**13 tests** (split across `src/lib/server/routes-tests/update-run-post.test.ts` and `update-run-stream.test.ts`):

- POST: dev_mode guard, dirty_tree guard with dirtyFiles array, already_up_to_date guard, force bypass, happy path (202 + correct args to spawnUpdateRun + appendUpdateRun), malformed JSON body treated as `{}`
- Stream: rejects `..` traversal, `/etc/passwd`, shell metacharacters, non-numeric timestamp, missing logPath, exitcodeFile escape out of `/tmp`, accepts valid path pair and returns `text/event-stream` content type

Tests live in `src/lib/server/routes-tests/` (not inside the routes tree) because SvelteKit reserves files prefixed with `+` — having `+server.test.ts` files triggers a build warning and risks misclassification as route handlers.

### Task 4: UI — `UpdateRunPanel.svelte` + `VersionTab.svelte` third card (commit 0d7270c)

**`src/lib/components/settings/UpdateRunPanel.svelte`** — Svelte 5 runes component:

- Props: `{status: StoredUpdateStatusShape}` from parent
- State (runes): `runState`, `logLines` (bounded to 1000), `runInfo`, `doneResult`, `errorBanner`, `history`, `logPanel` (auto-scroll target, wrapped in `$state` to silence the Svelte 5 non-reactive-update warning), plus a non-reactive `eventSource` module-scope ref
- `startUpdate()`: POST `/api/update/run` → on non-ok: maps `{dev_mode, dirty_tree, already_up_to_date}` to German banners → `runState = 'idle'`. On ok: captures `runInfo` and calls `openStream(runInfo)`.
- `openStream(info)`: closes any existing EventSource, clears `logLines`, opens `new EventSource(/api/update/run/stream?logPath=...&exitcodeFile=...)`. Listeners:
  - `open` → clear `logLines`, `runState = 'running'`. Clearing on every reconnect is the correct behavior because the server tails from position 0 — it replays the full log each time.
  - `log` → parse JSON, append line, `.slice(-1000)`
  - `done` → parse JSON, set `doneResult`, set `runState` to result, close stream, `loadHistory()`
  - `onerror` → no-op (browser auto-reconnects on transient disconnects, which is exactly what we want during the systemctl restart mid-update)
- Mount `$effect`: calls `loadHistory()` then, if `history[0]?.result === 'running'`, reconstructs `runInfo` (deriving `exitcodeFile` via `logPath.replace(/\.log$/, '.exitcode')`) and calls `openStream(resumedInfo)` — this handles the "user reloaded the page mid-update" case. Cleanup closes any open EventSource.
- Auto-scroll `$effect` sets `logPanel.scrollTop = logPanel.scrollHeight` whenever `logLines.length` changes
- Layout: header "Update ausführen" → (when `!isDev`) "Jetzt updaten" button disabled with tooltip per rules → optional red error banner → (when `runState !== 'idle'`) log `<pre>` + result banner → (when `history.length > 0`) "Letzte Updates" table with last 5 entries (timestamp, pre→post short SHA, status badge with lucide icon per result)
- Icons: `Download` (start), `Loader2` (animate-spin running), `CheckCircle2` (success), `RotateCcw` (rolled_back), `XCircle` (failed), `AlertTriangle` (error banner)

**`VersionTab.svelte`** — strictly additive change:
- Added `import UpdateRunPanel from './UpdateRunPanel.svelte';`
- Added third card `<div class="bg-bg-card rounded-lg border border-border p-6"><UpdateRunPanel {status} /></div>` after card 2
- Card 1 (installed version) and card 2 (update-status with "Jetzt prüfen") are byte-identical to Phase 08

### Task 5: Rollback regression test (commit 7112fae)

**`src/lib/server/services/update-runner.rollback.test.ts`** — 15 tests in two groups:

**14 textual invariant tests** (always run) — read `scripts/update.sh` once in `beforeAll` and grep for:
- `set -o pipefail`
- `UPDATE_RESULT: success` marker
- `UPDATE_RESULT: failed .+rolled back` pattern
- `write_exit 2` (rollback) and `write_exit 0` (success) both present
- `git reset --hard "$PRE_SHA"` literal
- `sha256sum src/lib/server/db/schema.ts` + `WARNING: schema.ts changed`
- `LOG="${LOG:-` and `EXITCODE_FILE="${EXITCODE_FILE:-` env reads
- Every labeled rollback branch: `rollback "install failed"`, `rollback "build failed"`, `rollback "restart failed"`, `rollback "service inactive after restart"`
- `UPDATE_RESULT: failed .*pull failed` for the pre-rollback pull-failure branch

**1 integration test** (gated by `TEST_UPDATE_ROLLBACK=1`) — exercises the real script:
1. Creates a bare origin + workdir clone in a tmpdir
2. Initial commit has `package.json` with `"build": "node -e 'process.exit(1)'"` and a dummy `schema.ts`, pushed to origin
3. Stubs `npm` and `systemctl` on `PATH` via a local bin dir so install succeeds and restart no-ops
4. Pushes an upstream commit so `git pull origin main` actually fast-forwards
5. Spawns `bash scripts/update.sh PRE_SHA deadbeef` with `env: {PATH, LOG, EXITCODE_FILE, INSTALL_DIR}`
6. Asserts: exitcode file `== 2`, log matches `/UPDATE_RESULT: failed \(build failed.+rolled back/`, log matches `/ROLLBACK: build failed/`, `git rev-parse HEAD == preSha`

**Verified locally**: `TEST_UPDATE_ROLLBACK=1 npx vitest run src/lib/server/services/update-runner.rollback.test.ts` → 15/15 pass including the real-script integration against a local git repo + stubbed npm/systemctl.

### Task 6: VM verification (deferred for on-VM execution)

This task is a `checkpoint:human-verify` — the plan explicitly notes that Task 6 MUST NOT be executed end-to-end in the worktree. The checkpoint scenarios are documented below and must be run by the VM operator before the milestone is approved.

## Deviations from Plan

**[Rule 3 - Blocking] SvelteKit `+` prefix collision with route-handler tests.**

The plan specified creating the POST route test at `src/routes/api/update/run/+server.test.ts`. Vitest printed a warning (`Files prefixed with + are reserved`) and SvelteKit's routing tree may misclassify `.test.ts` files named with the `+` prefix as route handlers at build time. To keep the CI signal clean and the SvelteKit build reliable, both route-handler tests were moved to `src/lib/server/routes-tests/` with direct relative imports into the route module. No coverage loss — all 13 POST + stream validation tests still run in the unit suite.

**[Rule 2 - Missing critical functionality] Extra pre-flight failure paths in `update.sh`.**

The plan template described 4 rollback reasons: install, build, restart, schema warning. Added a 5th explicit rollback branch `service inactive after restart` for the `systemctl is-active --quiet` check after the 3-second sleep, because the plan's success criteria require "the previous version comes back online without user action" — a silently-dead-after-restart service is exactly the failure mode this branch catches. Also added three pre-flight `UPDATE_RESULT: failed (... nothing changed)` branches (missing args, not-a-git-tree, cd-failed) that write exit code 1 so the UI always sees a terminal event instead of the SSE hanging on an empty log.

**[Rule 2 - Missing] `logPanel` variable wrapped in `$state()`.**

The plan described the auto-scroll via `bind:this + $effect`. Svelte 5's runes mode warns when a `bind:this` target is a plain `let` variable (`non_reactive_update`). Wrapping `logPanel` in `$state<HTMLPreElement | null>(null)` silences the warning without changing behavior. This was a one-line fix after running svelte-check.

No architectural changes. No Rule 4 issues.

## Known Stubs

None. Every UI path is wired to a real endpoint, and every endpoint is wired to a real service. The history table reads from the settings table, the SSE stream reads from real log files, and the POST endpoint actually spawns systemd-run.

## Deferred Issues

None introduced by this plan. Pre-existing svelte-check errors in unrelated files (onboarding.ts, cameras/status, etc.) from Phase 07/08 are still present per the deferred-items pattern but are out of scope.

## One-Time VM Migration (CRITICAL prerequisite for Phase 09)

Existing rsync-deployed VMs have a dirty working tree because rsync does not track git state. Before Phase 09 works end-to-end, the VM operator MUST run this migration ONCE:

```bash
ssh root@ip-cam-master.local << 'EOF'
  cd /opt/ip-cam-master
  git fetch origin
  git reset --hard origin/main
  npm install
  npm run build
  systemctl restart ip-cam-master
  sleep 3
  systemctl status ip-cam-master --no-pager | head -5
EOF
```

Expected outcome: `Active: active (running)` and `git status --porcelain` is empty. After this migration, the VM has a clean git tree and the self-update flow can take over — no more rsync deploys needed.

## Task 6 — Manual VM Verification (deferred)

Six scenarios to run on the VM (192.168.3.249) after deploying the Phase 09 code.

### Prerequisites

```bash
ssh root@ip-cam-master.local "cat /etc/systemd/system/ip-cam-master.service | grep -i restart"
# Expected: Restart=on-failure or Restart=always (from Phase 07 assumption)

ssh root@ip-cam-master.local "which systemd-run && systemd-run --version"
# Expected: present and functional
```

### Deploy

```bash
# Apply one-time migration (see above) if not already applied
git push origin main
ssh root@ip-cam-master.local "cd /opt/ip-cam-master && git pull && npm install && npm run build && systemctl restart ip-cam-master"

# Confirm the installer script got copied at boot
ssh root@ip-cam-master.local "ls -la /usr/local/bin/ip-cam-master-update.sh"
# Expected: -rwxr-xr-x, recent mtime
```

### Scenario 1 — Happy path (visual smoke test)

1. Open `https://ip-cam-master.local` → Settings → Version tab
2. "Installierte Version" card shows the current label
3. Scroll to the new "Update ausführen" card — "Jetzt updaten" button visible
4. If there is no update available, the button is disabled with tooltip "Keine Updates verfügbar"
5. Push a trivial commit to `main`, click "Jetzt prüfen", wait for badge. Button becomes enabled.
6. Click "Jetzt updaten". Observe the log panel populate with lines: `[HH:MM:SS] Starting update from <sha>`, `Running git pull...`, `Pulled to <sha>`, `Running npm install...`, `Running npm run build...`, `Restarting ip-cam-master.service...`
7. Final banner: green "Update erfolgreich (preSha → postSha)"
8. History section shows the new entry at the top
9. VM check: `git rev-parse HEAD` matches the post-update SHA; `systemctl is-active ip-cam-master` == `active`

### Scenario 2 — Dirty-tree guard (negative)

1. On VM: `echo "" >> /opt/ip-cam-master/README.md`
2. Reload Settings → Version in browser
3. "Jetzt updaten" button must be disabled with tooltip "Lokale Änderungen — Update blockiert"
4. Revert: `ssh root@ip-cam-master.local "cd /opt/ip-cam-master && git checkout README.md"`

### Scenario 3 — Rollback on build failure (CRITICAL)

1. On dev machine: make a commit that breaks the build, e.g. `echo "export default { syntaxError" >> src/routes/+page.svelte && git commit -am "broken" && git push`
2. In the VM UI: "Jetzt prüfen" → "Jetzt updaten"
3. Observe the log panel: git pull succeeds, npm install succeeds, npm run build FAILS, then `ROLLBACK: build failed — resetting to <sha>`, then second npm install + npm run build + systemctl restart
4. Final banner: red "Update fehlgeschlagen — zurückgesetzt auf <old-sha>"
5. VM check: `git rev-parse HEAD` == PRE-update SHA; `systemctl is-active ip-cam-master` == `active`
6. Clean up the broken commit: `git reset --hard HEAD~1 && git push --force-with-lease origin main` (user must authorize force-push)

### Scenario 4 — Schema-change warning (non-blocking)

1. On dev machine: add a comment to `src/lib/server/db/schema.ts`, commit, push
2. In the VM UI: "Jetzt updaten"
3. Log shows `WARNING: schema.ts changed — manual migration may be required` between `Pulled to <sha>` and `Running npm install...`
4. Update still completes with green banner (non-blocking per UPDATE-08)

### Scenario 5 — Reconnect mid-restart (most important)

1. Kick off any update (even a no-op whitespace commit push)
2. Open browser devtools → Network tab → find the EventSource stream
3. When `Restarting ip-cam-master.service...` appears, observe the stream close and reconnect automatically within ~5s
4. The log panel clears on reconnect and replays the full log from the file (confirming the on-disk log survives the app restart and the SSE tailer resumes from position 0)
5. Final `done` banner appears normally

### Scenario 6 — History persistence

1. Reload Version tab in a fresh browser window
2. "Letzte Updates" section shows the last 5 runs from scenarios 1, 3, 4, 5 with timestamps, SHA pairs, and result badges
3. Direct DB check: `ssh root@ip-cam-master.local "sqlite3 /opt/ip-cam-master/data/ip-cam-master.db 'SELECT value FROM settings WHERE key = \"update_run_history\"'"` — JSON array of entries matches the UI

## Requirement Coverage

| Req | How met |
|-----|---------|
| UPDATE-04 | POST `/api/update/run` spawns a detached `systemd-run --service-type=oneshot --collect` unit running `scripts/update.sh` with the full git-pull + build + restart chain. Detached unit survives the parent app's own restart. |
| UPDATE-05 | UpdateRunPanel opens an `EventSource` to `/api/update/run/stream` on "Jetzt updaten" click. Log lines stream live via SSE. EventSource auto-reconnects across the app's restart (log file persists on disk; server re-tails from position 0). History section persists the last 5 runs via `update_run_history` setting. |
| UPDATE-06 | `getCurrentVersion().isDirty` → POST returns 409 with `dirtyFiles: string[]`. UI banners the list in red. Button is disabled with tooltip as a first line of defense. |
| UPDATE-07 | `scripts/update.sh` rolls back via `git reset --hard $PRE_SHA` + best-effort rebuild + restart on every failure (pull, install, build, restart, service-inactive). Verified by the rollback regression test (14 static invariants, 1 gated integration test that actually spawns the script against a local git repo + stubbed npm/systemctl and asserts exit code 2 + git HEAD restored). |
| UPDATE-08 | `scripts/update.sh` computes `sha256sum src/lib/server/db/schema.ts` after git pull, compares to `PRE_SCHEMA_HASH`, writes `WARNING: schema.ts changed` on mismatch. Non-blocking — build and restart proceed. Warning appears in the live log panel. |

## Phase Verification

All verification checks from the plan pass:

1. **All unit tests green**:
   ```
   npx vitest run src/lib/server/services/update-runner.test.ts src/lib/server/services/update-history.test.ts src/lib/server/services/update-runner.rollback.test.ts src/lib/server/routes-tests/
   ```
   → 48 passed | 1 skipped (integration rollback gated by env var), 5 files, 348ms

2. **tsc clean in new/modified files**: `npx tsc --noEmit 2>&1 | grep -E "(update-runner|update-history|update/run|UpdateRunPanel|VersionTab|routes-tests|hooks.server)"` → empty

3. **svelte-check clean in new/modified components**: same filter → empty

4. **`ensureUpdateScriptInstalled` in hooks**: `grep -n ensureUpdateScriptInstalled src/hooks.server.ts` → 2 hits (import + call)

5. **"Jetzt updaten" in UI**: `grep -rn "Jetzt updaten" src/lib/components/settings/` → UpdateRunPanel.svelte:250

6. **`systemd-run` in update-runner**: `grep -n "systemd-run" src/lib/server/services/update-runner.ts` → 4 hits (comment + spawn call)

7. **`UPDATE_RESULT` in every branch of update.sh**: `grep -n "UPDATE_RESULT" scripts/update.sh` → 6 hits (3 preflight + 1 success + 2 failure)

8. **`git reset --hard` in rollback branches**: `grep -n "git reset --hard" scripts/update.sh` → 2 hits (rollback helper + pull-failure branch)

9. **`sha256sum src/lib/server/db/schema.ts`**: `grep -n "sha256sum src/lib/server/db/schema.ts" scripts/update.sh` → 1 hit

10. **Auth gate verified**: `grep -n "update/run" src/lib/config/routes.ts` → empty (route is NOT in `isPublicPath`, so hooks.server.ts auth-gates it — T-09-01 mitigation)

11. **Zero new dependencies**: `git diff bfd70f7..HEAD -- package.json package-lock.json` → empty

12. **VM checkpoint (Task 6) — pending operator execution** (see the 6 scenarios above)

## Milestone v1.1 Status

This plan closes the last open requirement of milestone v1.1. After Task 6 VM verification passes:

- **UPDATE-04/05/06/07/08** — done (this plan)
- **UPDATE-01/02/03** — done (Phase 08)
- **BACKUP-01/02/03** — done (Phase 07)
- **LOGS-01** — done (Phase 06)
- **ACCESS-01/02** — done (Phase 05)

Milestone v1.1 complete once the Task 6 checkpoint is approved.

## Commits

| Hash    | Task | Message                                                               |
|---------|------|-----------------------------------------------------------------------|
| f1db6a2 | 1    | feat(09-01): update runner service + update.sh with rollback chain    |
| d3f8e91 | 2    | feat(09-01): update history persistence service                       |
| f3a40a0 | 3    | feat(09-01): update run API routes + hooks.server wire-up             |
| 0d7270c | 4    | feat(09-01): UpdateRunPanel with live SSE log + history + resume-on-mount |
| 7112fae | 5    | test(09-01): rollback regression tests for scripts/update.sh          |

## Self-Check

All 12 created files verified present:
- scripts/update.sh — FOUND (mode 100755)
- src/lib/server/services/update-runner.ts — FOUND
- src/lib/server/services/update-runner.test.ts — FOUND
- src/lib/server/services/update-runner.rollback.test.ts — FOUND
- src/lib/server/services/update-history.ts — FOUND
- src/lib/server/services/update-history.test.ts — FOUND
- src/routes/api/update/run/+server.ts — FOUND
- src/routes/api/update/run/stream/+server.ts — FOUND
- src/routes/api/update/run/history/+server.ts — FOUND
- src/lib/server/routes-tests/update-run-post.test.ts — FOUND
- src/lib/server/routes-tests/update-run-stream.test.ts — FOUND
- src/lib/components/settings/UpdateRunPanel.svelte — FOUND

Modified files verified:
- src/hooks.server.ts — MODIFIED (ensureUpdateScriptInstalled import + call after startScheduler)
- src/lib/components/settings/VersionTab.svelte — MODIFIED (import + third card, strictly additive)

All 5 task commits verified in `git log bfd70f7..HEAD`:
- f1db6a2 — FOUND
- d3f8e91 — FOUND
- f3a40a0 — FOUND
- 0d7270c — FOUND
- 7112fae — FOUND

## Self-Check: PASSED
