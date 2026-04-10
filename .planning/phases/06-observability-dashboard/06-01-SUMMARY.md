---
phase: 06-observability-dashboard
plan: 01
subsystem: observability
tags: [host-metrics, health, dashboard, svelte5, systemctl, proc-meminfo]
requires: []
provides:
  - host-metrics service layer (getDiskUsage, getMemoryUsage, getServiceStatus)
  - GET /api/host/metrics endpoint
  - HealthWidgets component (disk/RAM/service cards)
  - Dashboard wiring for 10s host-vitals polling
affects:
  - src/routes/+page.svelte (adds three new cards + one fetch in Promise.all)
tech-stack:
  added: []
  patterns:
    - execFile promisified (no shell string, argv array)
    - /proc/meminfo parsing (prefer MemAvailable over MemFree)
    - systemctl show key=value parser (first-equals split)
    - Svelte 5 runes ($state, $props, $derived)
key-files:
  created:
    - src/lib/server/services/host-metrics.ts
    - src/lib/server/services/host-metrics.test.ts
    - src/routes/api/host/metrics/+server.ts
    - src/lib/components/host/HealthWidgets.svelte
  modified:
    - src/routes/+page.svelte
decisions:
  - Piggyback on existing 10s dashboard poll — no scheduler changes (per 06-RESEARCH §7)
  - Use Math.round(x*10)/10 for percent (1 decimal) rather than toFixed (string)
  - Strip weekday/TZ from ActiveEnterTimestamp before Date.parse for cross-platform dev parity
  - Render HealthWidgets above loading/empty/populated branches so host health shows with zero cameras
metrics:
  tasks: 3
  commits: 3
  tests-added: 10
  tests-passing: 10
  completed: 2026-04-10
---

# Phase 06 Plan 01: Host Vitals Widgets Summary

One-liner: Added a three-card host-vitals surface (disk, RAM, ip-cam-master.service) to the main dashboard by introducing a `host-metrics` service that shells out to `df`, reads `/proc/meminfo`, and parses `systemctl show` — zero new dependencies, no scheduler changes.

## What Was Built

### 1. `src/lib/server/services/host-metrics.ts`

Three pure service functions and three exported types:

```ts
export type DiskUsage = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  percentUsed: number;
};

export type MemoryUsage = {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  percentUsed: number;
};

export type ServiceStatus = {
  state: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'unknown';
  subState: string;
  uptimeSeconds: number | null;
  mainPid: number | null;
  result: string;
};

export async function getDiskUsage(path = '/'): Promise<DiskUsage>;
export async function getMemoryUsage(): Promise<MemoryUsage>;
export async function getServiceStatus(): Promise<ServiceStatus>;
```

Implementation notes:
- `execFile` is promisified and always called with an argv array — no shell, no injection surface.
- `getDiskUsage` runs `df -B1 --output=size,used,avail,pcent <path>`; parses last non-empty line.
- `getMemoryUsage` reads `/proc/meminfo` and **prefers `MemAvailable`** over `MemFree` (old-kernel fallback) — rejects `os.freemem()` per 06-RESEARCH §6 because `MemFree` is near-zero on a healthy Linux system.
- `getServiceStatus` runs `systemctl show ip-cam-master --property=ActiveState,SubState,ActiveEnterTimestamp,MainPID,Result --no-pager` and splits each line on the *first* `=` so values containing `=` survive.
- Uptime is computed only when `state === 'active'` AND `ActiveEnterTimestamp` is non-empty AND parseable. A small helper `parseSystemdTimestamp` first tries `Date.parse(raw)`, then strips the weekday prefix (`Thu`) and trailing timezone abbreviation (`CEST`) and retries — this makes the parser portable across glibc Linux (works directly) and BSD libc / macOS (needs stripping).

### 2. `src/lib/server/services/host-metrics.test.ts` (10 tests, all passing)

Uses a vitest mock factory that stubs `node:child_process` (translating the callback-style `execFile` into promise-resolved stdout) and `node:fs/promises.readFile`. Covers:

- `getDiskUsage` parses stdout, defaults to `/`, sends the correct argv.
- `getMemoryUsage` uses `MemAvailable`, falls back to `MemFree`, handles zero totals.
- `getServiceStatus` active path with uptime, inactive path with null uptime, failed-state null uptime, unknown-state fallback, and the "value contains `=`" edge case.

### 3. `src/routes/api/host/metrics/+server.ts`

```ts
export const GET: RequestHandler = async () => {
  try {
    const [disk, memory, service] = await Promise.all([
      getDiskUsage('/'),
      getMemoryUsage(),
      getServiceStatus()
    ]);
    return json({ disk, memory, service });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 500 });
  }
};
```

Single consolidated endpoint — halves HTTP chatter vs three separate endpoints, which matters because the main dashboard polls every 10 s.

### 4. `src/lib/components/host/HealthWidgets.svelte`

Svelte 5 runes, typed `$props()`, three cards in a responsive `md:grid-cols-3` grid:

- **Festplatte** (`HardDrive` icon): big percent, `used / total` detail, progress bar.
- **Arbeitsspeicher** (`MemoryStick` icon): big percent, `used / total`, progress bar.
- **ip-cam-master.service** (`Activity` icon): German state label — "Aktiv" (success), "Fehler" (danger), "Inaktiv" (warning), "Wechselt" (secondary), "—" (unknown); detail line shows "Läuft seit 2d 4h 17m".

Self-contained `formatBytes` and `formatUptime` helpers — no cross-file coupling with `+page.svelte`. Progress-bar thresholds (≥90 danger, ≥75 warning, else accent) match existing dashboard convention. The component is null-safe in all three prop slots and renders `—` placeholders until the first poll lands.

### 5. `src/routes/+page.svelte` (modified)

- Added imports for `HealthWidgets` and the three host-metrics types (`import type { ... }` — erased at build time, safe to import from `$lib/server/**`).
- Added `disk`, `memory`, `service` as `$state<... | null>(null)` next to the existing `lastUpdate`.
- Extended the existing `Promise.all` inside `fetchCameras()` with a third `fetch('/api/host/metrics')` call; parses the response when `metricsRes.ok`.
- Rendered `<HealthWidgets {disk} {memory} {service} />` directly under the dashboard header, **above** the `{#if loading} / {:else if total === 0} / {:else}` branches — so host health is visible in all three states (zero cameras is the most important one for day-one installs).
- Left the existing LXC "Ressourcen" card untouched — that still shows container resources, HealthWidgets shows VM host resources.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Cross-platform `ActiveEnterTimestamp` parsing**
- **Found during:** Task 1, GREEN phase
- **Issue:** 06-RESEARCH §5 claimed `Date.parse('Thu 2026-04-10 14:32:11 CEST')` would work because "Node uses the system locale". It works on glibc Linux (the deployment target) but returns `NaN` on macOS/BSD libc (the dev host), which broke one unit test.
- **Fix:** Added a small `parseSystemdTimestamp(raw)` helper in `host-metrics.ts` that first tries the raw string, then strips the weekday prefix (`/^[A-Za-z]{3}\s+/`) and the trailing timezone abbreviation (`/\s+[A-Z]{2,5}$/`) before retrying. Zero runtime cost on Linux (raw parse succeeds on the first try), and the dev host now matches production behavior.
- **Files modified:** `src/lib/server/services/host-metrics.ts`
- **Commit:** c170ee2 (folded into Task 1 commit)

### No other deviations

Plan was executed exactly as written for Tasks 2 and 3. No architectural changes, no auth gates, no new dependencies.

## Verification

```
$ npx vitest run src/lib/server/services/host-metrics.test.ts
Test Files  1 passed (1)
     Tests  10 passed (10)
```

```
$ npx svelte-check --threshold error --fail-on-warnings false
COMPLETED 4464 FILES 9 ERRORS 19 WARNINGS 11 FILES_WITH_PROBLEMS
```

The 9 errors and 11 files-with-problems are all **pre-existing** on the base commit (`CameraStatus` union mismatches, `onboarding.ts` StreamInfo shape, `cameras/status` CameraCardData, `cameras/[id]/snapshot` Buffer types). **Zero errors** are in the files created or modified by this plan. Out-of-scope items are logged in `.planning/phases/06-observability-dashboard/deferred-items.md`.

```
$ NEW_HASH=$(git hash-object src/lib/server/services/scheduler.ts)
ORIGINAL=ba78bae6ea682483feae3e00089aad0eab476de8
CURRENT =ba78bae6ea682483feae3e00089aad0eab476de8
MATCH: scheduler.ts is unchanged ✓
```

```
$ git diff HEAD -- package.json package-lock.json | wc -l
0   ✓ zero dependency changes
```

Manual verification (requires VM):

```bash
# Expected shape
curl -s http://192.168.3.233:3000/api/host/metrics | jq
# { "disk": {...}, "memory": {...}, "service": {...} }

# Live service flip
ssh root@192.168.3.233 systemctl stop ip-cam-master
# Dashboard card flips to "Inaktiv" within 10 s on next poll
ssh root@192.168.3.233 systemctl start ip-cam-master
```

## Requirements Satisfied

- **HEALTH-01** — VM disk used/total/percent visible on main dashboard ✓
- **HEALTH-02** — VM RAM used/total/percent visible on main dashboard (via `MemAvailable`) ✓
- **HEALTH-03** — `ip-cam-master.service` state + uptime visible on main dashboard ✓

## Commits

| Task | Hash    | Subject                                                               |
| ---- | ------- | --------------------------------------------------------------------- |
| 1    | c170ee2 | feat(06-01): add host-metrics service with df + meminfo + systemctl   |
| 2    | ea72de3 | feat(06-01): add /api/host/metrics endpoint + HealthWidgets component |
| 3    | cf9ee9d | feat(06-01): wire HealthWidgets into dashboard poll loop              |

## Known Stubs

None. All three widgets render live data from real system sources; nothing is placeholder or hardcoded.

## Self-Check: PASSED

Created files verified present:
- `src/lib/server/services/host-metrics.ts` — FOUND
- `src/lib/server/services/host-metrics.test.ts` — FOUND
- `src/routes/api/host/metrics/+server.ts` — FOUND
- `src/lib/components/host/HealthWidgets.svelte` — FOUND
- `.planning/phases/06-observability-dashboard/06-01-SUMMARY.md` — FOUND (this file)
- `.planning/phases/06-observability-dashboard/deferred-items.md` — FOUND

Commits verified in git log:
- c170ee2 — FOUND
- ea72de3 — FOUND
- cf9ee9d — FOUND

Invariants verified:
- `src/lib/server/services/scheduler.ts` unchanged (hash match) — PASS
- `package.json` + `package-lock.json` unchanged — PASS
- `host-metrics.test.ts` 10/10 passing — PASS
- No new svelte-check errors in HealthWidgets / host-metrics / api/host — PASS
