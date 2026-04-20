---
phase: 18-bambu-a1-camera-integration
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - drizzle/0001_add_camera_model.sql
  - lxc-assets/bambu-a1-camera.mjs
  - src/lib/components/cameras/CameraDetailCard.svelte
  - src/lib/components/onboarding/OnboardingWizard.svelte
  - src/lib/components/onboarding/StepBambuCredentials.svelte
  - src/lib/components/onboarding/StepBambuPreflight.svelte
  - src/lib/server/db/client.ts
  - src/lib/server/db/schema.ts
  - src/lib/server/services/bambu-a1-auth.ts
  - src/lib/server/services/bambu-a1-camera.ts
  - src/lib/server/services/bambu-discovery.ts
  - src/lib/server/services/bambu-mqtt.ts
  - src/lib/server/services/bambu-preflight.ts
  - src/lib/server/services/go2rtc.ts
  - src/lib/server/services/onboarding.ts
  - src/lib/types.ts
  - src/routes/api/cameras/[id]/a1-snapshot/+server.ts
  - src/routes/api/cameras/status/+server.ts
  - src/routes/api/onboarding/bambu/preflight/+server.ts
  - src/routes/api/onboarding/bambu/save-camera/+server.ts
  - src/routes/kameras/onboarding/+page.svelte
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-04-20
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 18 adds A1 JPEG-over-TLS camera support alongside the existing H2C RTSPS flow. Architecture is sound: capability-matrix gating (`PRINTER_CAPABILITIES`), backward-compat model fallback (null → H2C), defence-in-depth allowlist enforcement at both the preflight route and save-camera route, and per-camera 2-second cache on the snapshot endpoint. The TUTK edge-trigger logic in `bambu-mqtt.ts` correctly implements all four documented behaviors (edge-trigger, auto-clear, conditional-reset-skip, undefined-no-op).

Two critical findings concern **shell-context injection via the generated `go2rtc.yaml` `exec:` line**: `printerIp` and `accessCode` are interpolated into a command string with no escaping or character-set validation. Both values flow from user input (save-camera POST body) through the DB into `generateGo2rtcConfigBambuA1`. A crafted access code or IP containing whitespace or shell meta-characters would inject arbitrary tokens into the `node /opt/ipcm/bambu-a1-camera.mjs` invocation that go2rtc parses. While the LXC is a minimal-privilege sandbox and only the operator can POST these endpoints today, this is the kind of latent sink that shows up in future threat models if anything ever drops credentials from discovery.

Warnings cover: an inflight-dedup race on the snapshot cache, a VMID collision pattern in the discovery batch flow, and a minor type-system drift between `types.ts::CameraType` and `schema.ts::CameraType`. Info items are non-blocking.

## Critical Issues

### CR-01: Unescaped access code + printer IP injected into go2rtc exec: command line

**File:** `src/lib/server/services/go2rtc.ts:214-215`
**Issue:**
`generateGo2rtcConfigBambuA1` builds a shell-like exec string by raw string interpolation:

```ts
const execCmd = `exec:env A1_ACCESS_CODE=${accessCode} node /opt/ipcm/bambu-a1-camera.mjs --ip=${printerIp}#killsignal=15#killtimeout=5`;
```

Neither `accessCode` nor `printerIp` is validated for shell/YAML-safe characters at any layer:
- `POST /api/onboarding/bambu/save-camera` (route handler) only checks `accessCode.length === 8` — no character-set check.
- `POST /api/onboarding/bambu/save-camera` accepts `ip` as an arbitrary string — no IPv4/IPv6 format validation at all.
- The DB column is plain `text`; nothing downstream re-validates before interpolation.

A whitespace-bearing access code splits the env var assignment (`A1_ACCESS_CODE=foo bar` → `bar` becomes a new exec token). A `#` in the IP prematurely terminates the go2rtc pipe-options segment. A backtick or `$(...)` would be harmless inside go2rtc's own parser but leaks into any downstream shell that processes the go2rtc.yaml (there isn't one today, but this is the kind of contract you don't want to rely on).

Even if every real A1 access code is alphanumeric, the server-side invariant isn't enforced — if the Bambu firmware ever widens the code alphabet, or an attacker uses a stolen operator session to POST, the injection sink is present.

**Fix:**
Validate both fields at the API boundary and refuse non-safe inputs. Add this to `src/routes/api/onboarding/bambu/save-camera/+server.ts` just after the length check:

```ts
// Access code: Bambu uses 8-char alphanumeric only. Enforce server-side so
// this cannot flow into the go2rtc exec: line as a shell-injection sink
// (see generateGo2rtcConfigBambuA1).
if (!/^[A-Za-z0-9]{8}$/.test(accessCode)) {
    return json(
        { success: false, error: 'Access Code muss 8 alphanumerische Zeichen sein' },
        { status: 400 }
    );
}

// IP: IPv4 dotted-quad only (LAN scope). Refuse anything that could carry
// shell/YAML meta-characters into the go2rtc config.
if (typeof ip !== 'string' || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return json(
        { success: false, error: 'IP muss eine gültige IPv4-Adresse sein' },
        { status: 400 }
    );
}
```

Apply the same IP regex to `/api/onboarding/bambu/preflight/+server.ts` (the route currently only checks `ip.trim().length > 0`). For belt-and-braces, also assert the same invariants in `generateGo2rtcConfigBambuA1` itself so a future caller that bypasses the route can't reintroduce the bug:

```ts
export function generateGo2rtcConfigBambuA1(params: {...}): string {
    const { streamName, printerIp, accessCode, rtspAuth } = params;
    if (!/^[A-Za-z0-9]{8}$/.test(accessCode)) {
        throw new Error('A1 access code must be 8 alphanumeric characters');
    }
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(printerIp)) {
        throw new Error('A1 printer IP must be IPv4 dotted-quad');
    }
    // ...existing code
}
```

---

### CR-02: Access code flows into go2rtc.yaml twice (exec env + RTSP password) without rotation logging

**File:** `src/lib/server/services/go2rtc.ts:208-223` + `src/lib/server/services/onboarding.ts:43-50`
**Issue:**
When `rtspAuthEnabled` is true for a Bambu camera, the generated YAML contains the decrypted access code in two places:
1. `env A1_ACCESS_CODE=<code>` on the exec: line
2. `rtsp: password: '<code>'` in the rtspServerBlock (via `buildRtspAuth`)

Written to `/etc/go2rtc/go2rtc.yaml` at mode 644 inside the LXC (default `pushFileToContainer` mode). Any process on the container can `cat` it. This is a deliberate choice (documented at `onboarding.ts:24-29`) but two downstream risks are not mitigated:

- **No file-mode hardening.** `/etc/go2rtc/go2rtc.yaml` should be owned by the go2rtc service user with mode 600. Today it's root:root 644.
- **No rotation/rewrite hook when access code changes.** `addBambuSubscriber` (bambu-mqtt.ts:262) rebuilds the MQTT client after an access-code update, but nothing rewrites `go2rtc.yaml` inside the LXC or restarts go2rtc. After a rotation the container holds the old code on disk until the next manual reprovision.

The T-18-07 / T-18-12 threat model in the phase docs specifically calls out "access code must not leak via `ps ax`" — the env-var path handles that, but on-disk exposure is left unaddressed.

**Fix:**
1. Tighten the file mode when pushing A1 configs. Extend `pushFileToContainer` to accept a mode, or follow-up with `chmod 600 /etc/go2rtc/go2rtc.yaml` after the write in `configureGo2rtc`:

```ts
await pushFileToContainer(ssh, camera.vmid, yamlContent, '/etc/go2rtc/go2rtc.yaml');
if (camera.cameraType === 'bambu') {
    await executeOnContainer(ssh, camera.vmid, 'chmod 600 /etc/go2rtc/go2rtc.yaml');
}
```

2. When the user updates the access code via `PATCH /api/cameras/:id/bambu-credentials` (see `CameraDetailCard.svelte:207`), re-run `configureGo2rtc(cameraId, skipInstall=true)` so the YAML gets regenerated with the new code. This is a separate endpoint, so the hook belongs in that route handler — flag for phase-18 follow-up rather than this batch.

## Warnings

### WR-01: Snapshot cache does not deduplicate concurrent misses

**File:** `src/routes/api/cameras/[id]/a1-snapshot/+server.ts:57-75`
**Issue:**
The 2-second cache is keyed per camera id (correct). But concurrent requests on a cache miss all race past the `cached && cached.expiresAt > Date.now()` check and each call `fetchA1SnapshotJpeg` independently. The printer sees N simultaneous TLS sessions, and the DoS-mitigation invariant ("printer sees ≤1 TLS session per 2s per camera") is violated during the first request window. The dashboard's `refreshSnapshot()` polls every 10s per card (CameraDetailCard.svelte:307), so under normal load this is quiet — but the comment at line 56 promises a guarantee it does not deliver.

**Fix:**
Add an inflight promise map keyed by camera id so concurrent misses share one TLS session:

```ts
const inflight = new Map<number, Promise<Buffer | null>>();

// ...inside GET handler, replacing the direct fetchA1SnapshotJpeg call:
let pending = inflight.get(id);
if (!pending) {
    pending = fetchA1SnapshotJpeg(cam.ip, accessCode, 8000).finally(() => {
        inflight.delete(id);
    });
    inflight.set(id, pending);
}
const buf = await pending;
```

### WR-02: Batch onboarding can reuse VMIDs on concurrent discovery runs

**File:** `src/routes/kameras/onboarding/+page.svelte:659`
**Issue:**
In the batch pipeline flow, `vmid: testData.nextVmid || data.nextVmid + idx` uses the page-load `data.nextVmid` plus the loop index as a fallback. `data.nextVmid` is computed at page load by `getNextVmid()` — if the server-side `testData.nextVmid` is missing on any iteration, the fallback derives a VMID from the stale page-load value. Two back-to-back batches (user reloads, starts a new batch while an earlier container is still provisioning) can compute overlapping VMIDs because `getNextVmid()` filters by `cameras.vmid` in the DB, but pending batch cameras may not yet be in the DB when the second page loads.

The Bambu branch (line 777-794) is immune — `save-camera/bambu` uses `BAMBU_PENDING_VMID = 0` as a sentinel and the real VMID gets assigned later.

**Fix:**
Always call `getNextVmid()` fresh per camera in `batchOnboardPipeline`, or fail the batch if `testData.nextVmid` is missing rather than silently falling back:

```ts
if (!testData.nextVmid) throw new Error('VMID konnte nicht ermittelt werden');
// use testData.nextVmid directly, no +idx fallback
```

### WR-03: CameraType type system drift between types.ts and schema.ts

**File:** `src/lib/types.ts:2` vs `src/lib/server/db/schema.ts:3`
**Issue:**
`types.ts` declares `export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'onvif' | 'bambu' | 'other';` (six variants), while `schema.ts` declares `export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu';` (four variants). The DB column is `text` with no check constraint, so either wider or narrower is possible at runtime. Callers that import `CameraType` get different answers depending on which file they reach first. Nothing in Phase 18 breaks from this, but the `'onvif'` and `'other'` branches in view logic are unreachable under the DB schema and should be removed or centralized.

**Fix:**
Remove the duplicate declaration in `types.ts` and re-export from `schema.ts`:

```ts
// src/lib/types.ts
export type { CameraType } from '$lib/server/db/schema';
```

Then audit all consumers — Phase 18 doesn't introduce new `'onvif'`/`'other'` checks, but older callers may. Consider deferring to a follow-up commit to keep this phase narrow.

### WR-04: bambu-mqtt.ts `error` handler uses short-circuit-operator precedence that is easy to misread

**File:** `src/lib/server/services/bambu-mqtt.ts:181`
**Issue:**
```ts
if (msg.includes('not authorized') || msg.includes('bad user') || msg.includes('connack') && msg.includes('4') || msg.includes('connack') && msg.includes('5')) {
```
This parses as `A || B || (C && D) || (E && F)` — which is the intent — but the code is cryptic and `connack` + `5` can match text like `connack version 5` on future MQTT v5 broker errors, producing a false `WRONG_ACCESS_CODE` verdict. MQTT return codes 4/5 are documented constants; matching them via substring is fragile.

**Fix:**
Parse the underlying error's reason code rather than string-matching. The `mqtt` library surfaces `err.code`:

```ts
client.on('error', (err: Error & { code?: number }) => {
    if (err.code === 4 || err.code === 5 || /bad user|not authorized/i.test(err.message)) {
        sub.lastError = 'WRONG_ACCESS_CODE';
        sub.client.end(true);
        // ...
    }
    // ...
});
```

Low severity because today's behaviour is correct on the MQTT v3 broker the A1 runs.

### WR-05: bambu-a1-camera.mjs frame-size guard does not cap pathological header-only flood

**File:** `lxc-assets/bambu-a1-camera.mjs:91-105`
**Issue:**
The frame parser reads `size` from the first 4 bytes and only aborts if `size === 0 || size > 5_000_000`. It's missing a buffer-growth cap: a hostile printer (compromised firmware on the LAN) could send a stream of 16-byte headers claiming large-but-legal sizes (say 4MB each) and the parser would accumulate up to 4MB of `buf` before discarding each frame. On a repeat loop the process can pin hundreds of MB of Node heap. The guard at line 93 covers absurd sizes but not sustained mid-size ones.

**Fix:**
Drop the accumulated buffer once it passes a sane threshold without a valid JPEG start-of-image having arrived:

```js
if (buf.length > 10_000_000) {
    process.stderr.write(`[a1-cam] buffer runaway (${buf.length} bytes); abort\n`);
    socket.destroy();
    return;
}
```

Place this check at the top of the `while (buf.length >= 16)` loop body. Also an SOI (FF D8) quick-scan at the payload offset to bail before a full `size` commit would be more robust, but this patch is sufficient to close the DoS vector.

## Info

### IN-01: Access code length validation weaker than needed on preflight route

**File:** `src/routes/api/onboarding/bambu/preflight/+server.ts:10`
**Issue:**
The preflight route only checks `accessCode.trim()` length > 0. save-camera enforces exactly 8 characters. Preflight should match:

**Fix:**
```ts
if (!ip || !serialNumber || !accessCode || accessCode.length !== 8) {
    return json({ ok: false, error: 'INVALID_INPUT', hint: '...' }, { status: 400 });
}
```

### IN-02: `OnboardingWizard.svelte` uses Mobotix-branch `name` as fallback for Bambu camera name

**File:** `src/lib/components/onboarding/OnboardingWizard.svelte:71`
**Issue:**
`name: name || \`Bambu Lab ${bambuSerial.slice(-6)}\`` — the `name` variable is the Mobotix-branch form state. In a Bambu-only flow it's usually empty, but if the user enters a name in the Mobotix form, backs out, and switches to manual-add Bambu, that name leaks across. No functional bug but confusing state sharing.

**Fix:**
Introduce a dedicated `bambuName` state and wire it through:

```ts
let bambuName = $state(prefillName);
// ...
name: bambuName || `Bambu Lab ${bambuSerial.slice(-6)}`
```

### IN-03: `client.ts` migrations run unconditionally on every process start

**File:** `src/lib/server/db/client.ts:44-54`
**Issue:**
`ensureColumn` does a `PRAGMA table_info` query per column on every app boot. For the 5 columns here it's trivial, but pattern will scale poorly as the schema grows. drizzle-kit migrations exist in `drizzle/` but are not wired into the boot path (line 5 of `drizzle/0001_add_camera_model.sql` does the same ALTER that line 51 of client.ts does). Pick one system.

**Fix:**
Out of scope for Phase 18 review — flag as a migration-strategy cleanup task for a later phase.

### IN-04: `bambu-a1-camera.mjs` does not clamp socket.write on back-pressure

**File:** `lxc-assets/bambu-a1-camera.mjs:103`
**Issue:**
`process.stdout.write(jpeg)` is fire-and-forget. If go2rtc's consumer side stalls (rare but possible during magic.Open() re-detection), the Node process buffers JPEGs in the stdout pipe. No flow control, no drop policy. At 1080p/5fps this is ~100-500KB/s sustained — recoverable, but worth noting.

**Fix:**
Respect the `write()` return value:

```js
if (!process.stdout.write(jpeg)) {
    // Pause socket reads until the pipe drains.
    socket.pause();
    process.stdout.once('drain', () => socket.resume());
}
```

Not a correctness bug today — the go2rtc pipe-exec transport rarely stalls — but the idiom is standard for Node TCP→pipe bridges.

---

_Reviewed: 2026-04-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
