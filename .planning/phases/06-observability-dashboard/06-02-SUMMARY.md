---
phase: 06-observability-dashboard
plan: 02
subsystem: observability
tags: [logs, journal, sse, svelte, systemd]
requires:
  - SvelteKit 2.55 + Svelte 5 runes
  - journalctl (systemd 254+ on Debian 13)
  - node:child_process (execFile, spawn)
provides:
  - readJournal(lines, severity) bounded snapshot
  - JournalEntry type
  - GET /api/logs/journal snapshot endpoint
  - GET /api/logs/journal/stream SSE live tail with abort cleanup
  - JournalTab component
  - Systemd Journal third tab on /logs page
affects:
  - src/routes/logs/+page.svelte (tab union extended, new tab button + block)
tech-stack:
  added: []
  patterns:
    - Shell out to journalctl via execFile (NDJSON parse) for bounded reads
    - Shell out to journalctl -f via spawn + ReadableStream for SSE live tail
    - request.signal 'abort' + ReadableStream cancel() belt-and-suspenders child process cleanup
key-files:
  created:
    - src/lib/server/services/journal.ts
    - src/lib/server/services/journal.test.ts
    - src/routes/api/logs/journal/+server.ts
    - src/routes/api/logs/journal/stream/+server.ts
    - src/lib/components/logs/JournalTab.svelte
  modified:
    - src/routes/logs/+page.svelte
decisions:
  - Filter severity at journalctl -p flag, never post-filter in JS (keeps wire payload small and uses canonical syslog hierarchy)
  - Forward raw JSON lines as SSE data; parse on client (no double-parse overhead on server)
  - Cap DOM entries at 1000 via entries.slice(-999) to keep the list lightweight
  - Auto-scroll only when user is within 50px of the bottom (prevents jump-while-reading)
  - Idempotent killChild() wrapper guarded by 'killed' flag so abort + cancel can both fire without double-kill
metrics:
  duration: ~15 minutes
  tasks: 5
  files-created: 5
  files-modified: 1
  tests-added: 15
  completed: 2026-04-10
requirements:
  - LOGS-01
  - LOGS-02
  - LOGS-03
---

# Phase 06 Plan 02: Systemd Journal Viewer Summary

Added a third tab "Systemd Journal" to the existing `/logs` page that reads and live-tails the `ip-cam-master` systemd journal directly via `journalctl`, with SSE streaming and CRITICAL orphan-child cleanup.

## What was built

**Server service** (`src/lib/server/services/journal.ts`)
- `readJournal(lines, severity)` shells out to `journalctl` via `execFile` (argv array — never shell interpolation)
- Clamps `lines` to `[1, 1000]` via `Math.floor(Math.min(Math.max(1, lines), 1000))`
- Maps severity to `-p` flag: `error → err`, `warning → warning`, `info → info`, `all → debug`
- Parses NDJSON: splits stdout on `\n`, filters blanks, `JSON.parse` each line
- Normalizes `MESSAGE` field: handles both string and byte-array forms (systemd emits byte arrays for non-UTF-8 payloads)
- Converts `__REALTIME_TIMESTAMP` microseconds → milliseconds via `Math.floor(ts / 1000)`
- 16 MB `maxBuffer` so 1000 long lines never truncate

**Snapshot endpoint** (`src/routes/api/logs/journal/+server.ts`)
- `GET /api/logs/journal?lines=N&severity=X`
- Validates `severity` against `Set<Severity>(['error','warning','info','all'])` allowlist → falls back to `'all'` on any invalid value
- Delegates lines clamping to `readJournal`
- Returns `{ entries }` on success, `{ error, entries: [] }` + 500 on failure

**SSE stream endpoint** (`src/routes/api/logs/journal/stream/+server.ts`)
- `GET /api/logs/journal/stream?severity=X`
- `spawn('journalctl', ['-u', 'ip-cam-master', '-f', '-n', '100', '-o', 'json', '-p', priorityArg, '--no-pager'])`
- `ReadableStream` buffers stdout, splits on `\n`, emits `event: entry\ndata: <rawJsonLine>\n\n`
- 15s heartbeat comment lines (`: heartbeat\n\n`) keep idle proxies from timing out
- **CRITICAL orphan prevention:**
  - `request.signal.addEventListener('abort', ...)` → calls `killChild()`, closes controller
  - `ReadableStream.cancel()` → calls `killChild()` (belt-and-suspenders since different runtimes trigger one or the other)
  - `child.on('exit', ...)` → closes controller
  - `killChild()` is idempotent (guarded by `killed` flag) and clears the heartbeat interval before sending SIGTERM
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`

**Client component** (`src/lib/components/logs/JournalTab.svelte`)
- Svelte 5 runes, self-contained (no props)
- Reactive `$effect` re-fetches snapshot and reopens EventSource whenever `severity`, `lines`, or `liveTail` change
- Cleanup callback closes the `EventSource`, which triggers the server-side abort listener, which kills `journalctl -f`
- Client-side `normalizeMessage` mirrors the server's handling (string-or-byte-array → string)
- DOM cap at 1000 entries via `entries.slice(-999)` push pattern
- Auto-scroll only when the user is within 50px of the bottom (tracked via `onscroll` handler updating `isPinnedToBottom`)
- German UI labels: Schweregrad, Zeilen, Live, Neu laden, Alle/Info/Warnung/Fehler, Keine Einträge
- Severity badge classes: priority ≤3 red, ==4 yellow, ≥5 neutral

**Page wiring** (`src/routes/logs/+page.svelte`)
- Extended `activeTab` state union: `'events' | 'protect' | 'journal'`
- Added third tab button after "Protect Logs" matching existing button styling
- Added `{#if activeTab === 'journal'}<JournalTab />{/if}` block at the end
- Tab order unchanged: Ereignisse → Protect Logs → Systemd Journal
- Existing events auto-refresh (`setInterval` every 10s gated by `activeTab === 'events'`) untouched

## Exact journalctl argv used

**Snapshot** (Task 1, via `execFile`):
```
journalctl -u ip-cam-master -n <clamped_lines> -o json --no-pager -p <flag>
```
where `<flag>` ∈ `{err, warning, info, debug}` per severity.

**Stream** (Task 3, via `spawn`):
```
journalctl -u ip-cam-master -f -n 100 -o json -p <flag> --no-pager
```

## Commits

| Task | Hash      | Message                                                              |
| ---- | --------- | -------------------------------------------------------------------- |
| 1    | 8614d45   | feat(06-02): add readJournal service with NDJSON parsing             |
| 2    | a3500ff   | feat(06-02): add GET /api/logs/journal snapshot endpoint             |
| 3    | 8218641   | feat(06-02): add SSE /api/logs/journal/stream endpoint with cleanup  |
| 4    | 80a2b1b   | feat(06-02): add JournalTab component with snapshot + SSE live tail  |
| 5    | a56aab7   | feat(06-02): add Systemd Journal as third tab on /logs page          |

## Verification

- `npx vitest run src/lib/server/services/journal.test.ts` → **15/15 green** (execFile argv, severity flag mapping, line clamping, NDJSON parsing, byte-array MESSAGE, microseconds-to-ms conversion, missing _PID, whitespace tolerance, error propagation)
- `npx svelte-check --threshold error` for new files → **0 errors** (`journal.ts`, `+server.ts` x2, `JournalTab.svelte`, `logs/+page.svelte` all clean)
- `git diff package.json` → **empty** (no new npm dependencies)
- No new route under `src/routes/logs/` → the journal UI is a tab on the existing `/logs` page, not a new route

## Pending manual VM verification

The following can only be verified on the Debian 13 VM with an actual systemd unit. These are captured in the plan's `<verification>` block (items 4–8) and should be run by the verifier agent during the phase verification pass:

1. `curl -s 'http://localhost:3000/api/logs/journal?lines=20&severity=error' | jq '.entries | length'` ≤ 20, every entry with `priority ≤ 3`
2. `curl -N 'http://localhost:3000/api/logs/journal/stream?severity=all'` → observe `event: entry` lines + `: heartbeat` every 15s
3. `pgrep -af 'journalctl.*-f'` after each SSE disconnect → ZERO (repeat 5 times, still zero)
4. UI smoke test: open http://192.168.3.233:3000/logs, click "Systemd Journal", change severity to "Fehler", trigger `systemd-cat -t ip-cam-master echo 'test message'` on VM, see entry appear within 1s while Live is on
5. Confirm `SYSLOG_IDENTIFIER` / `_SYSTEMD_UNIT` spot-check — only `ip-cam-master.service` entries

## Deviations from 06-RESEARCH.md

**None.** The implementation follows Section 2 (execFile + NDJSON parser) and Section 3 (spawn + ReadableStream + abort cleanup) verbatim, with the following minor hardening:

1. Added an idempotent `killChild()` wrapper in the SSE endpoint guarded by a `killed` flag. Rationale: both `request.signal.addEventListener('abort', ...)` and `ReadableStream.cancel()` can fire, and `setInterval` heartbeat errors can also trigger cleanup — without the idempotency guard, we would try to clear the heartbeat interval and `kill()` the child twice. This is strictly additive to the research — the research's cleanup logic still runs, just wrapped.
2. Client-side `normalizeMessage` in `JournalTab.svelte` mirrors the server-side version (handles string and byte-array `MESSAGE`). Not explicitly called out in the research, but necessary because the SSE raw JSON lines contain the same variants.
3. Included `-n 100` in the stream argv (matches research Section 3 example) to seed the initial buffer so the client gets immediate context when the stream opens.
4. Snapshot endpoint's severity allowlist uses a `Set<Severity>` (typed) rather than an untyped `Set<string>` — defensive typing, no behavioral change.

## Note for Phase 09

The SSE pattern established here — `spawn` a long-running child, pipe its stdout through a `ReadableStream`, wire both `request.signal` abort AND `ReadableStream.cancel()` to an idempotent `killChild()` helper, and send a 15s heartbeat comment line to keep proxies open — is the template to reuse for streaming live update progress. The key invariant is: **never rely on a single cleanup path**. Belt-and-suspenders `abort` + `cancel` is what guarantees zero orphan processes across different SvelteKit runtime versions and reverse-proxy setups.

## Known Stubs

None. All data paths are wired end to end.

## Deferred Issues (out of scope for this plan)

Pre-existing TypeScript/svelte-check errors in unrelated files surfaced during verification but are NOT caused by this plan's changes:

- `src/lib/server/services/onboarding.ts` — `audioCodec` missing, `Promise<Api>.nodes` access
- `src/routes/api/cameras/[id]/snapshot/+server.ts` — `Buffer<ArrayBufferLike>` / `BodyInit` mismatch
- `src/routes/api/cameras/status/+server.ts` — `CameraCardData` missing `cameraModel`, `firmwareVersion`, `liveFps`
- `src/lib/components/cameras/CameraDetailCard.svelte` + `src/routes/+page.svelte` — `CameraStatus` vs `'native-onvif'` comparison

These are tracked for a separate cleanup plan.

## Self-Check: PASSED

Created files verified present:
- `src/lib/server/services/journal.ts` — FOUND
- `src/lib/server/services/journal.test.ts` — FOUND
- `src/routes/api/logs/journal/+server.ts` — FOUND
- `src/routes/api/logs/journal/stream/+server.ts` — FOUND
- `src/lib/components/logs/JournalTab.svelte` — FOUND

Modified files verified:
- `src/routes/logs/+page.svelte` — CHANGED (import JournalTab, activeTab union extended, third tab button, third tab block)

Commits verified in `git log`:
- 8614d45 — FOUND
- a3500ff — FOUND
- 8218641 — FOUND
- 80a2b1b — FOUND
- a56aab7 — FOUND
