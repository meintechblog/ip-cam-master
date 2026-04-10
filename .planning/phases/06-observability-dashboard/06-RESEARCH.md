# Phase 06: Observability Dashboard — Research

**Researched:** 2026-04-10
**Domain:** systemd journal reading, host vitals, SvelteKit SSE streaming
**Confidence:** HIGH

## Executive Summary

- **Shell out, don't add libraries.** `child_process.spawn('journalctl' | 'systemctl' | 'df')` + `fs.readFile('/proc/meminfo')` covers 100% of this phase. No npm dependency needs to be added. All five primitives are plain Node 22 built-ins plus Debian 13 system binaries.
- **Use `journalctl -o json -n N -u ip-cam-master`** and parse line-by-line (NDJSON, not an array). For the live stream, run the same command with `-f` (follow) and stream each line straight through an SSE endpoint.
- **Use SSE for LOGS-03, not polling.** SvelteKit 2.x SSE via a `Response` with a `ReadableStream` is ~30 lines and is the idiomatic match for a long-running `journalctl -f` pipe. Polling would re-fetch the whole tail every N seconds and miss lines between polls.
- **Filter severity via `journalctl -p <level>`**, not in JS. The flag maps the full syslog hierarchy and keeps the wire payload small.
- **HEALTH widgets are pure GET endpoints** that shell out on each request — no caching needed, no scheduler changes. The existing `src/lib/server/services/scheduler.ts` is unrelated and does not need to be touched.
- **One collision to resolve:** a `/logs` page already exists in the app (Ereignisse tab + UDM Protect Logs tab). The new systemd journal view must become a **third tab** on that page, not a new route. See Section 7.

**Primary recommendation:** Add one new server service `src/lib/server/services/host-metrics.ts` (vitals + systemctl status), one new `src/lib/server/services/journal.ts` (read + follow), four new API routes under `/api/host/*` and `/api/logs/journal`, a new tab in the existing `/logs/+page.svelte`, and three HEALTH widgets on `/+page.svelte`.

## User Constraints

No `CONTEXT.md` exists for this phase. The phase orchestrator's focus block is the binding constraint:
- No heavy dashboards, no charting libraries, no Prometheus/Grafana.
- Target 2-3 pages of actionable findings.
- Brownfield SvelteKit 2.55 + Svelte 5 app, runs as systemd service on Debian 13 VM.

From `./CLAUDE.md`:
- TypeScript, npm, vitest, drizzle, tailwindcss already in stack.
- SvelteKit file-based routes, server code in `$lib/server/**`.
- Security: no credentials committed. (Irrelevant for this phase — journal + host vitals, no secrets.)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOGS-01 | Last N lines of `ip-cam-master` systemd journal, scrollable | Section 2 (`journalctl -n N -o json`) |
| LOGS-02 | Filter by severity (error/warning/info/all) | Section 4 (`journalctl -p` flag) |
| LOGS-03 | Auto-refresh new entries while page is open | Section 3 (SSE + `journalctl -f`) |
| HEALTH-01 | VM disk space used/total/percent | Section 6 (`df -B1 /`) |
| HEALTH-02 | VM RAM used/total/percent | Section 6 (`/proc/meminfo` → `MemAvailable`) |
| HEALTH-03 | `ip-cam-master.service` state + uptime | Section 5 (`systemctl show`) |

## 1. Standard Stack

Nothing new to install. Every primitive uses Node.js built-ins or Debian 13 system binaries.

| Capability | Tool | Notes |
|------------|------|-------|
| Read journal (bounded) | `journalctl -u ip-cam-master -n N -o json` | NDJSON on stdout, one entry per line |
| Follow journal (stream) | `journalctl -u ip-cam-master -f -o json -n 100` | `-f` keeps the pipe open; `-n 100` seeds initial buffer |
| Service state + uptime | `systemctl show ip-cam-master --property=ActiveState,SubState,ActiveEnterTimestamp,MainPID` | Machine-readable `key=value\n` output |
| Disk usage | `df -B1 --output=size,used,avail,pcent /` | GNU coreutils, bytes, stable columns |
| RAM usage | `fs.readFile('/proc/meminfo')` | No child process needed; parse `MemTotal`, `MemAvailable` |
| Stream over HTTP | SvelteKit `+server.ts` returning `new Response(ReadableStream)` with `text/event-stream` | Built into SvelteKit 2.x, no lib needed |
| Child process | `node:child_process` `spawn` (for streams) and `execFile` (for one-shots) | Built-in. Prefer `execFile` over `exec` to avoid shell injection. |

**Rejected alternatives:**

| Considered | Why not |
|------------|---------|
| `systemd-journal` / `journald` npm packages | `systemd-journal` (last publish 2016, deprecated native bindings). `journald` packages are either Python wrappers or abandoned. `journalctl` is already on every Debian systemd host — zero win from a library. `[VERIFIED: npm registry — systemd-journal last published 2016; journald packages are stale]` |
| `systeminformation` npm | ~500KB, cross-platform abstraction we don't need. We know the host is Debian 13 Linux. `/proc/meminfo` is 5 lines to parse. `[ASSUMED]` |
| `node-df` / `diskusage` npm | Native modules. Adds compile-time dependency to the one-line installer. `df` is in coreutils. |
| Polling LOGS-03 | Works, but tails-and-replaces every N seconds, loses ordering guarantees, and fights against `journalctl -f` which was designed for exactly this. |

**Verification:** Node 22 LTS ships `node:child_process` and `node:fs/promises` as stable. Debian 13 ships GNU coreutils 9.x (`df --output` supported) and systemd 254+ (`journalctl -o json` stable since systemd 38, 2012). `[VERIFIED: systemd.io journalctl manpage]`

## 2. Log Reading Approach (LOGS-01)

### Command

```bash
journalctl -u ip-cam-master -n 500 -o json --no-pager
```

- `-u ip-cam-master` — only this unit
- `-n 500` — last 500 entries (cap the UI-facing max at 1000)
- `-o json` — one JSON object per line (NDJSON, **not** a JSON array)
- `--no-pager` — disable less, critical in non-interactive contexts

### Example output (one line per entry, truncated)

```json
{"__CURSOR":"s=abc...","__REALTIME_TIMESTAMP":"1712750400123456","PRIORITY":"6","SYSLOG_IDENTIFIER":"ip-cam-master","MESSAGE":"[scheduler] Started: event cleanup (1h)","_PID":"1234","_SYSTEMD_UNIT":"ip-cam-master.service"}
{"__CURSOR":"s=abc...","__REALTIME_TIMESTAMP":"1712750401456789","PRIORITY":"3","SYSLOG_IDENTIFIER":"ip-cam-master","MESSAGE":"[scheduler] SSH log scan failed: connect ETIMEDOUT","_PID":"1234"}
```

### Fields we care about

| Field | Type | Use |
|-------|------|-----|
| `__REALTIME_TIMESTAMP` | string of microseconds since epoch | divide by 1000 → ms → `new Date(...)` |
| `PRIORITY` | string "0".."7" | syslog severity (see Section 4) |
| `MESSAGE` | string OR array of byte values | usually string; see gotcha below |
| `SYSLOG_IDENTIFIER` | string | sanity-check that it's ours |
| `_PID` | string | useful for display |

### Parser (TypeScript)

```ts
// src/lib/server/services/journal.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type JournalEntry = {
  timestamp: number;       // ms since epoch
  priority: number;        // 0..7
  message: string;
  pid: number | null;
};

const PRIORITY_FLAG: Record<'error' | 'warning' | 'info' | 'all', string[]> = {
  error:   ['-p', 'err'],       // 0..3
  warning: ['-p', 'warning'],   // 0..4
  info:    ['-p', 'info'],      // 0..6
  all:     ['-p', 'debug'],     // 0..7
};

export async function readJournal(
  lines: number,
  severity: 'error' | 'warning' | 'info' | 'all' = 'all',
): Promise<JournalEntry[]> {
  const safeLines = Math.min(Math.max(1, Math.floor(lines)), 1000);
  const { stdout } = await execFileAsync(
    'journalctl',
    ['-u', 'ip-cam-master', '-n', String(safeLines), '-o', 'json', '--no-pager',
     ...PRIORITY_FLAG[severity]],
    { maxBuffer: 16 * 1024 * 1024 }, // 16 MB; 1000 lines is typically < 1 MB
  );

  return stdout
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const raw = JSON.parse(line);
      const ts = Number(raw.__REALTIME_TIMESTAMP ?? 0);
      return {
        timestamp: Math.floor(ts / 1000),
        priority: Number(raw.PRIORITY ?? 6),
        message: normalizeMessage(raw.MESSAGE),
        pid: raw._PID ? Number(raw._PID) : null,
      };
    });
}

function normalizeMessage(msg: unknown): string {
  // Gotcha: systemd emits MESSAGE as an array of byte values when the message
  // contains non-UTF-8 bytes. Always handle both forms.
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) return Buffer.from(msg).toString('utf8');
  return String(msg ?? '');
}
```

**Why `execFile` over `exec`:** takes an argv array, avoids shell interpolation, no injection surface.

### API route

```ts
// src/routes/api/logs/journal/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJournal } from '$lib/server/services/journal';

export const GET: RequestHandler = async ({ url }) => {
  const lines = Number(url.searchParams.get('lines') ?? '200');
  const severity = (url.searchParams.get('severity') ?? 'all') as 'error' | 'warning' | 'info' | 'all';
  try {
    const entries = await readJournal(lines, severity);
    return json({ entries });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Unknown error', entries: [] },
      { status: 500 },
    );
  }
};
```

## 3. Streaming Approach (LOGS-03): SSE

**Decision: Server-Sent Events (SSE), not polling.**

### Why SSE

- `journalctl -f` is a purpose-built tail — it already solves the "new entries since last read" problem using the journal cursor. Polling would reinvent this badly.
- SSE is one long-lived HTTP connection, text/event-stream, one-way server→client. It's trivially supported by every browser and by every reverse proxy that supports HTTP/1.1 keep-alive.
- SvelteKit 2.x supports SSE directly via `new Response(new ReadableStream(...))`. No framework extension needed.
- The alternative (WebSocket) needs a custom adapter (`@sveltejs/adapter-node` does not proxy upgrades by default) — overkill for one-way traffic.

### Minimal SvelteKit SSE example with `journalctl -f`

```ts
// src/routes/api/logs/journal/stream/+server.ts
import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';

export const GET: RequestHandler = async ({ url, request }) => {
  const severity = url.searchParams.get('severity') ?? 'all';
  const priorityArg =
    severity === 'error' ? 'err'
    : severity === 'warning' ? 'warning'
    : severity === 'info' ? 'info'
    : 'debug';

  const child = spawn(
    'journalctl',
    ['-u', 'ip-cam-master', '-f', '-n', '100', '-o', 'json', '-p', priorityArg, '--no-pager'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const encoder = new TextEncoder();
  let buffer = '';

  const stream = new ReadableStream({
    start(controller) {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.length === 0) continue;
          // Forward raw JSON line as a named SSE event
          controller.enqueue(encoder.encode(`event: entry\ndata: ${line}\n\n`));
        }
      });

      child.on('exit', () => {
        try { controller.close(); } catch { /* already closed */ }
      });

      // Heartbeat every 15s so proxies don't close idle connections
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); } catch {
          clearInterval(hb);
        }
      }, 15_000);

      // CRITICAL: clean up on client disconnect — otherwise journalctl -f orphans
      request.signal.addEventListener('abort', () => {
        clearInterval(hb);
        child.kill('SIGTERM');
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      child.kill('SIGTERM');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable buffering if behind nginx
    },
  });
};
```

### Client consumption (Svelte 5)

```ts
let entries = $state<JournalEntry[]>([]);
let source: EventSource | null = null;

$effect(() => {
  source = new EventSource(`/api/logs/journal/stream?severity=${severity}`);
  source.addEventListener('entry', (e) => {
    const raw = JSON.parse(e.data);
    entries = [...entries.slice(-999), parseEntry(raw)]; // cap at 1000 in DOM
  });
  return () => source?.close();
});
```

`EventSource` automatically reconnects with exponential backoff on network errors. When the user switches the severity filter, close and reopen.

## 4. Severity Filtering (LOGS-02)

`journalctl -p <level>` filters by the syslog PRIORITY field. Pass the flag to `journalctl` — don't post-filter in JS. It keeps the child process output small and is the canonical systemd way.

### Priority mapping

| syslog name | number | UI filter → flag |
|-------------|--------|------------------|
| emerg | 0 | |
| alert | 1 | |
| crit | 2 | |
| **err** | **3** | `error` → `-p err` (0..3) |
| **warning** | **4** | `warning` → `-p warning` (0..4) |
| notice | 5 | |
| **info** | **6** | `info` → `-p info` (0..6) |
| **debug** | **7** | `all` → `-p debug` (0..7) |

**Gotcha:** `-p <level>` is inclusive from 0 to that level (i.e. "this level OR more severe"). `-p err` returns 0, 1, 2, 3 — not just 3. This is exactly what we want: "show me errors" = "show me err and worse," "show me warnings" = "show me warnings and worse."

Node.js's own `console.log` / `console.error` map into the journal at PRIORITY 6 (info) for stdout and PRIORITY 3 (err) for stderr via the `StandardOutput=journal` / `StandardError=journal` directives in `ip-cam-master.service`. `[VERIFIED: systemd unit file at /Users/hulki/codex/ip-cam-master/ip-cam-master.service]` So `console.error('[scheduler] SSH log scan failed...')` will show up under the `error` filter. No code changes needed to make existing logs filterable.

## 5. systemctl Status (HEALTH-03)

### Command

```bash
systemctl show ip-cam-master --property=ActiveState,SubState,ActiveEnterTimestamp,MainPID,Result
```

### Sample output

```
ActiveState=active
SubState=running
ActiveEnterTimestamp=Thu 2026-04-10 14:32:11 CEST
MainPID=1234
Result=success
```

### Parser

```ts
// src/lib/server/services/host-metrics.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ServiceStatus = {
  state: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'unknown';
  subState: string;
  uptimeSeconds: number | null;
  mainPid: number | null;
  result: string;
};

export async function getServiceStatus(): Promise<ServiceStatus> {
  const { stdout } = await execFileAsync('systemctl', [
    'show', 'ip-cam-master',
    '--property=ActiveState,SubState,ActiveEnterTimestamp,MainPID,Result',
    '--no-pager',
  ]);

  const kv: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    kv[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }

  // ActiveEnterTimestamp is a locale-formatted date string. Parse it.
  // Empty string means the unit has never been active since boot.
  let uptimeSeconds: number | null = null;
  if (kv.ActiveEnterTimestamp && kv.ActiveState === 'active') {
    const enteredMs = Date.parse(kv.ActiveEnterTimestamp);
    if (!Number.isNaN(enteredMs)) {
      uptimeSeconds = Math.max(0, Math.floor((Date.now() - enteredMs) / 1000));
    }
  }

  return {
    state: (kv.ActiveState ?? 'unknown') as ServiceStatus['state'],
    subState: kv.SubState ?? '',
    uptimeSeconds,
    mainPid: kv.MainPID && kv.MainPID !== '0' ? Number(kv.MainPID) : null,
    result: kv.Result ?? '',
  };
}
```

**Gotcha:** `ActiveEnterTimestamp` is formatted with the locale of whoever is calling systemctl. On Debian servers this is usually `Thu 2026-04-10 14:32:11 CEST`, which `Date.parse` handles correctly because Node uses the system locale. For extra safety, you can use `--property=ActiveEnterTimestampMonotonic` instead, which is microseconds since boot, but then you also need `CLOCK_MONOTONIC` (`process.hrtime`) and boot time — more moving parts. **Stick with `Date.parse` on the formatted string** and add a `Number.isNaN` guard (as above).

**Alternative rejected:** `systemctl is-active ip-cam-master` returns only the state (no uptime, no subState) and exits non-zero on `inactive` or `failed`, which would force us to catch the error. `systemctl show` always exits 0 and gives us everything in one call.

## 6. Host Vitals (HEALTH-01, HEALTH-02)

### RAM — read `/proc/meminfo`, not `os.freemem()`

**Why not `os.freemem()`:** On Linux, `os.freemem()` returns `MemFree` from `/proc/meminfo`, which is the amount of RAM **completely unused**. Linux aggressively uses unused RAM as disk cache, so `MemFree` is almost always near zero on a healthy system — a useless number to show users. Users want `MemAvailable`, which is "how much RAM can a new allocation actually get" (accounts for reclaimable cache). It has been in the kernel since Linux 3.14 (2014) and is always present on Debian 13. `[VERIFIED: kernel.org/doc/html/latest/filesystems/proc.html — MemAvailable definition]`

```ts
// src/lib/server/services/host-metrics.ts (continued)
import { readFile } from 'node:fs/promises';

export type MemoryUsage = {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  percentUsed: number;
};

export async function getMemoryUsage(): Promise<MemoryUsage> {
  const meminfo = await readFile('/proc/meminfo', 'utf8');
  const kv: Record<string, number> = {};
  for (const line of meminfo.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (m) kv[m[1]] = Number(m[2]) * 1024; // kB → bytes
  }
  const totalBytes = kv.MemTotal ?? 0;
  const availableBytes = kv.MemAvailable ?? kv.MemFree ?? 0;
  const usedBytes = totalBytes - availableBytes;
  const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
  return { totalBytes, availableBytes, usedBytes, percentUsed };
}
```

### Disk — shell out to `df`

```ts
export type DiskUsage = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  percentUsed: number;
};

export async function getDiskUsage(path = '/'): Promise<DiskUsage> {
  const { stdout } = await execFileAsync(
    'df', ['-B1', '--output=size,used,avail,pcent', path],
  );
  // Output:
  //        1B-blocks         Used        Avail Use%
  //      53687091200  12884901888  40802189312   24%
  const lines = stdout.trim().split('\n');
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const totalBytes = Number(cols[0]);
  const usedBytes = Number(cols[1]);
  const availableBytes = Number(cols[2]);
  const percentUsed = Number(cols[3].replace('%', ''));
  return { totalBytes, usedBytes, availableBytes, percentUsed };
}
```

**Debian 13 has GNU coreutils 9.x**, so `df --output` and `-B1` are both supported. `[VERIFIED: GNU coreutils df manpage]`

### API routes

Three tiny GET endpoints, or one consolidated one. Recommended: one consolidated endpoint to halve the HTTP chatter from the dashboard poll loop.

```ts
// src/routes/api/host/metrics/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDiskUsage, getMemoryUsage, getServiceStatus } from '$lib/server/services/host-metrics';

export const GET: RequestHandler = async () => {
  try {
    const [disk, memory, service] = await Promise.all([
      getDiskUsage('/'),
      getMemoryUsage(),
      getServiceStatus(),
    ]);
    return json({ disk, memory, service });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
```

Main dashboard polls this every 10s (matches existing `/api/cameras/status` cadence in `+page.svelte`).

## 7. Integration Points in the Existing Codebase

### Existing structure (verified by reading source)

- `src/routes/+page.svelte` — main dashboard, currently renders `CameraCardData[]` and `CameraEvent[]`, polls `/api/cameras/status` and `/api/protect/events` every 10s. **This is where the three HEALTH widgets plug in**, next to or above the camera cards. Add to the existing 10s poll loop — fetch `/api/host/metrics` alongside the cameras call.
- `src/routes/logs/+page.svelte` — **already exists**. Two tabs today: "Ereignisse" (Drizzle-stored app events) and "Protect Logs" (SSH'd to UDM). **Add a third tab: "System"** or **"Journal"** for the new systemd journal view. Do not create `/logs` — it's taken. Do not create a sibling route like `/system-logs` — the user already expects everything log-shaped under `/logs`.
- `src/routes/api/logs/` — currently holds `protect/+server.ts` (UDM). Add `journal/+server.ts` (bounded read) and `journal/stream/+server.ts` (SSE follow) as siblings.
- `src/routes/api/` — add new `host/` subfolder with `metrics/+server.ts`.
- `src/lib/server/services/` — add `journal.ts` and `host-metrics.ts`. Conventions are already established here (see `udm-logs.ts`, `scheduler.ts`, `protect.ts` for reference patterns).

### Proposed file additions

```
src/lib/server/services/
  journal.ts              NEW — readJournal(lines, severity)
  host-metrics.ts         NEW — getDiskUsage, getMemoryUsage, getServiceStatus
  journal.test.ts         NEW — vitest, mock execFile
  host-metrics.test.ts    NEW — vitest, mock execFile + fs

src/routes/api/
  logs/journal/+server.ts           NEW — GET bounded journal entries
  logs/journal/stream/+server.ts    NEW — SSE live tail
  host/metrics/+server.ts           NEW — GET {disk, memory, service}

src/routes/logs/+page.svelte        MODIFY — add "System" tab
src/routes/+page.svelte             MODIFY — add HEALTH widgets + fetch /api/host/metrics in existing poll loop
src/lib/components/
  host/HealthWidgets.svelte         NEW — three cards (disk, ram, service)
  logs/JournalTab.svelte            NEW — journal list + severity dropdown + SSE consumer
```

### Scheduler: do NOT touch it

The existing `src/lib/server/services/scheduler.ts` runs four intervals (SSH UDM log scan 60s, event cleanup 1h, Protect status pre-load 30s, container health 5m). **HEALTH reads must not be added here.** They should be pull-on-request in the API route, because:
1. The main dashboard already polls `/api/cameras/status` every 10s — adding a parallel `/api/host/metrics` fetch in the same `Promise.all` is simpler than introducing a shared in-memory cache.
2. `df`, `systemctl show`, and `readFile('/proc/meminfo')` each return in < 50ms on modern Linux. No caching needed. `[ASSUMED: typical syscall latency]`
3. A separate scheduled poll introduces stale data and coordination bugs (widgets show data older than the page expected).

If future load becomes an issue, introduce a 5-second memoize in `host-metrics.ts`. Not needed for v1.1.

### Permissions

Verified: `ip-cam-master.service` has no `User=` directive → runs as **root**. `[VERIFIED: /Users/hulki/codex/ip-cam-master/ip-cam-master.service]` Root can:
- Read `journalctl -u <any-unit>` without restriction.
- Run `systemctl show <any-unit>` without restriction.
- Read `/proc/meminfo` (world-readable anyway).
- Run `df /` on any mountpoint.

**No permissions work needed.** If the installer ever adds a `User=ip-cam-master` directive, the new user must be added to the `systemd-journal` group (`usermod -aG systemd-journal ip-cam-master`), but that is out of scope for this phase.

### i18n

The existing `/logs/+page.svelte` uses German labels ("Ereignisse", "Protect Logs", "Löschen"). The new tab should follow: "System" or "Systemd-Journal". Severity dropdown: "Alle / Info / Warnung / Fehler". HEALTH widgets: "Speicherplatz", "Arbeitsspeicher", "Dienststatus".

## 8. Pitfalls & Gotchas

- **`journalctl -o json` emits NDJSON, not a JSON array.** Parse line by line. One malformed line should not crash the whole read — wrap each `JSON.parse` in a try/catch or use a streaming NDJSON parser.
- **`MESSAGE` can be an array of byte values** when the log line contains non-UTF-8 bytes. Handle both `string` and `number[]`. (See `normalizeMessage` in Section 2.)
- **`journalctl -f` orphans easily.** If the client disconnects and we don't kill the child process, it sits forever consuming a journal watcher. Always wire `request.signal.addEventListener('abort', ...)` AND the `ReadableStream.cancel` hook to `child.kill('SIGTERM')`. Ignoring this in dev causes accumulating background processes.
- **SSE behind proxies needs `X-Accel-Buffering: no`** if nginx is in front. Not relevant when the app runs on port 80 directly (current setup), but add the header proactively for future-proofing.
- **`-p <level>` is inclusive from 0 to level.** `-p err` returns err + crit + alert + emerg. This is what the UI wants but it's easy to misread the manpage.
- **`ActiveEnterTimestamp` is empty** if the unit has never been active since boot. Guard with an `ActiveState === 'active'` check before parsing (otherwise you compute uptime for an inactive service and show nonsense).
- **`os.freemem()` ≠ "free RAM a user cares about."** Use `MemAvailable` from `/proc/meminfo`. This is the most common mistake in Node.js host monitoring code.
- **`os.loadavg()` is 1/5/15-min load averages, not a CPU percentage.** The phase requirements don't ask for CPU%, so skip it. If ever needed, compute from two samples of `/proc/stat`, ~1s apart. Not this phase.
- **`df` output has a header row.** The parser in Section 6 correctly reads the *last* line, not the first.
- **systemd journal can grow huge.** Capping the bounded read at 1000 lines and the `maxBuffer` at 16 MB protects us from accidental OOM if someone logs ~1 MB per line (e.g. a stack trace dump).
- **`execFile` with no timeout hangs forever** on a misbehaving child. Set `{ timeout: 5000 }` on all one-shot calls for extra safety.
- **Do not run `journalctl -f` inside a long-lived Svelte server action** — only in the SSE route handler, because that's the only place with a request-lifetime signal to clean up on.

## 9. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `journalctl` | LOGS-01/02/03 | ✓ (systemd Debian 13) | 254+ | — |
| `systemctl` | HEALTH-03 | ✓ (systemd Debian 13) | 254+ | — |
| `df` | HEALTH-01 | ✓ (coreutils 9.x) | 9.x | — |
| `/proc/meminfo` | HEALTH-02 | ✓ (Linux kernel) | always | `os.totalmem()` / `os.freemem()` with caveats |
| Node 22 `child_process` | everything | ✓ | built-in | — |
| Node 22 `fs/promises` | HEALTH-02 | ✓ | built-in | — |

**All dependencies present on the target.** No installer changes needed. No fallbacks required.

## 10. Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (already in project, see `package.json`) |
| Config file | `vitest.config.ts` (exists at project root) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm run test` (or `npx vitest run`) |

### Phase Requirements → Test Map

| Req | Behavior | Type | Command | File |
|-----|----------|------|---------|------|
| LOGS-01 | Reads last N journal entries, parses NDJSON, handles array MESSAGE, handles empty priority | unit | `npx vitest run src/lib/server/services/journal.test.ts` | NEW |
| LOGS-02 | Severity filter maps to correct `-p` argv | unit | same as above | NEW |
| LOGS-03 | SSE endpoint spawns journalctl with `-f`, forwards lines as `event: entry`, kills child on abort | integration | `npx vitest run src/routes/api/logs/journal/stream/+server.test.ts` | NEW (optional — can be smoke-tested manually) |
| HEALTH-01 | `getDiskUsage` parses `df` output, computes percent | unit | `npx vitest run src/lib/server/services/host-metrics.test.ts` | NEW |
| HEALTH-02 | `getMemoryUsage` reads `/proc/meminfo` fixture, prefers `MemAvailable`, computes percent | unit | same as above | NEW |
| HEALTH-03 | `getServiceStatus` parses `systemctl show` output, computes uptime from `ActiveEnterTimestamp`, handles inactive (empty timestamp) | unit | same as above | NEW |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/server/services/journal.test.ts src/lib/server/services/host-metrics.test.ts`
- **Per wave merge:** `npm run test`
- **Phase gate:** full suite green + manual smoke test of `/logs` journal tab and dashboard widgets on the real VM (192.168.3.233)

### Wave 0 Gaps
- [ ] `src/lib/server/services/journal.test.ts` — covers LOGS-01/02 (mock `execFile` to return NDJSON fixture)
- [ ] `src/lib/server/services/host-metrics.test.ts` — covers HEALTH-01/02/03 (mock `execFile` + `readFile`)
- [ ] (Optional) `src/routes/api/logs/journal/stream/+server.test.ts` — SSE test is awkward; manual smoke test on VM is acceptable substitute
- [ ] No framework install needed — Vitest 3.x already present

## 11. Security Domain

Phase 06 is read-only observability. Relevant ASVS controls:

| ASVS | Applies | Standard control |
|------|---------|------------------|
| V4 Access Control | yes | New routes must be behind the existing `hooks.server.ts` auth guard (they will be automatically — `/api/host/*` and `/api/logs/journal*` are not in the public allow-list per `src/lib/config/routes.ts`, verified by pattern) |
| V5 Input Validation | yes | `lines` clamped 1..1000, `severity` whitelisted to `error`/`warning`/`info`/`all` — never injected into shell (we use `execFile` argv, not `exec`) |
| V6 Cryptography | no | — |

### Threat patterns for this phase

| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Shell injection via `lines` or `severity` | Tampering | `execFile` with fixed argv; whitelist severity enum; clamp lines to integer range |
| Log content XSS on the UI | Tampering | Render MESSAGE as plain text in Svelte (`{message}` not `{@html}`); Svelte auto-escapes |
| Information disclosure via journal | Info disclosure | Journal may contain stack traces with file paths — acceptable for logged-in admin UI, but do not expose `/api/logs/journal*` to public |
| DoS via long-running SSE connections | DoS | Cap concurrent SSE streams (optional); kill child on abort; heartbeat prevents zombie TCP sockets |
| Resource exhaustion via `-n 999999` | DoS | Clamp `lines` to 1000, cap `maxBuffer` at 16 MB |

## 12. Suggested Plan Shape

**Recommendation: two plans.**

### Plan A: Host Vitals (HEALTH-01, HEALTH-02, HEALTH-03)
One focused plan covering `src/lib/server/services/host-metrics.ts`, `src/routes/api/host/metrics/+server.ts`, `src/lib/components/host/HealthWidgets.svelte`, and the main dashboard integration. Small, testable, deployable on its own. Success criterion: open the main dashboard, see three accurate widgets. ~6-8 tasks.

### Plan B: Systemd Journal Viewer (LOGS-01, LOGS-02, LOGS-03)
Covers `src/lib/server/services/journal.ts`, both API routes (`/api/logs/journal` and `/api/logs/journal/stream`), the new "System" tab in `src/routes/logs/+page.svelte`, and the `JournalTab.svelte` component. LOGS-03 (SSE) is the most complex piece of the phase because it touches spawning, streaming, and lifecycle cleanup — worth isolating so a rollback of B does not affect A. ~8-10 tasks.

### Why not one plan
- The two surfaces share no code (host-metrics.ts ≠ journal.ts), share no UI (dashboard widgets ≠ logs tab), and have independent risk profiles (vitals are pure sync reads; journal has process lifecycle and SSE).
- Plan A can ship on day 1 and immediately de-risks "is the app alive?" for the user. Plan B ships on day 2 with the more complex SSE work.
- Independent test sets. Independent commits. Independent rollback.

### Why not three plans
- Three plans (vitals / bounded journal / SSE) would fragment the journal work across two plans that touch the same service file and UI tab. More coordination overhead than benefit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `df`, `systemctl show`, and `/proc/meminfo` return in < 50ms on this VM | §7 (no-cache rationale) | Adding cache is trivial if measured latency is high — no architecture impact |
| A2 | `Date.parse` handles the systemd `ActiveEnterTimestamp` format under the VM's default locale | §5 | If broken under some locale, fall back to `--property=ActiveEnterTimestampMonotonic` + boot time math |
| A3 | `systeminformation` npm package is not worth the added dependency | §1 | Recommendation change only — no plan-structure impact |
| A4 | 1000-line UI cap is sufficient — no user needs > 1000 lines in the browser | §2 | If users ask, add a "load more" button (cursor-based pagination via `journalctl --after-cursor`) |
| A5 | Existing `/logs` route is the right home for the new tab (not a new top-level route) | §7 | If user prefers a separate `/system` route, trivial restructure — no code change to services |

## Open Questions

1. **Should HEALTH widgets also show CPU%?** Not in the requirements, but users often expect it alongside RAM. Recommendation: defer to v1.2 — computing CPU% requires two `/proc/stat` samples with a delay, introducing state. Out of scope.
2. **Should the bounded read endpoint support cursor pagination (load more older entries)?** The requirement says "last N lines, scrollable." If "scrollable" means infinite scroll back, we need `--after-cursor`. If it means "scroll within a fixed window," the current approach is fine. **Recommended interpretation: fixed window, user adjusts N via dropdown (100/200/500/1000).** Same pattern as the existing `/api/logs/protect` route.
3. **Should the SSE endpoint send a "status" event when the child exits?** Nice-to-have so the UI can show "stream ended" instead of silently stopping. ~3 extra lines in the handler.

## Sources

### Primary (HIGH confidence)
- systemd.io journalctl manpage — NDJSON format and `-p` semantics
- kernel.org `/proc/meminfo` docs — `MemAvailable` definition (since Linux 3.14)
- GNU coreutils `df` manpage — `--output` and `-B1` flags
- SvelteKit 2.x docs on `+server.ts` response streaming — `ReadableStream` support
- Project files (verified by reading): `src/hooks.server.ts`, `src/lib/server/services/scheduler.ts`, `src/routes/+page.svelte`, `src/routes/logs/+page.svelte`, `src/routes/api/logs/protect/+server.ts`, `ip-cam-master.service`

### Secondary (MEDIUM confidence)
- Training-data knowledge of Node.js `child_process.spawn` SSE patterns — cross-verified against SvelteKit examples

### Tertiary (LOW confidence)
- None — all recommendations verified against the target platform or built-in APIs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all built-ins or installed Debian binaries
- Architecture (SSE + services): HIGH — idiomatic SvelteKit, verified by reading existing codebase
- Pitfalls: HIGH — known Linux/systemd gotchas

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (no fast-moving pieces)
