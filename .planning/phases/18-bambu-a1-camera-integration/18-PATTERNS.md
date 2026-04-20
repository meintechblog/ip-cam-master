# Phase 18: Bambu Lab A1 Camera Integration - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 18 (8 new, 10 modified/extended)
**Analogs found:** 18 / 18 (100%)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/server/services/bambu-a1-auth.ts` | utility (pure fn) | transform | `src/lib/server/services/bambu-credentials.ts` (export + crypto) / spike 004 `probe.mjs:38-46` `buildAuth` | exact (code lifted from spike) |
| `src/lib/server/services/bambu-a1-auth.test.ts` | test (unit) | n/a | `src/lib/server/services/bambu-credentials.test.ts` | exact |
| `src/lib/server/services/__fixtures__/a1-auth-packet.bin` | fixture (binary) | n/a | none — new pattern, generator is `buildAuth('bblp','20633520')` | fresh (generator-driven) |
| `src/lib/server/services/bambu-a1-camera.ts` | service (TLS client helpers) | request-response | `src/lib/server/services/bambu-preflight.ts:91-124` `checkTcpReal` / `:126-184` `checkRtspsReal` | exact (same Promise shape + settled guard + timer.unref) |
| `src/lib/server/services/bambu-a1-camera.test.ts` | test (unit) | n/a | `src/lib/server/services/bambu-preflight.test.ts` (dep-injection + mock pattern) | exact |
| `lxc-assets/bambu-a1-camera.mjs` | runtime script (ingestion) | streaming (TLS→stdout) | `.planning/spikes/004-a1-stream-fallback/probe.mjs` | exact (lifted, production-hardened) |
| `src/routes/api/cameras/[id]/a1-snapshot/+server.ts` | route handler (GET) | request-response | `src/routes/api/cameras/[id]/snapshot/+server.ts:62-107` | role+flow match (different source: TLS:6000 vs go2rtc) |
| `src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts` | test (endpoint) | n/a | no direct test for snapshot endpoint today — closest: `bambu-state/+server.ts` pattern + `go2rtc.test.ts` mocking | partial (fresh endpoint test — Vitest+fetch-mock pattern from `go2rtc.test.ts:122-157`) |
| **MODIFIED:** `src/lib/server/services/bambu-discovery.ts` (+ `PRINTER_CAPABILITIES`) | config/constant | n/a | `MODEL_LABELS` (lines 32-39) immediately above | exact (sibling export) |
| **MODIFIED:** `src/lib/server/services/bambu-preflight.ts` (error enum + model-split) | service extension | request-response | existing `runBambuPreflight` at `:57-84` + `PreflightError` at `:15-19` + `PREFLIGHT_HINTS_DE` at `:25-34` | exact (same file — extend existing pattern) |
| **MODIFIED:** `src/lib/server/services/bambu-mqtt.ts` (TUTK watch) | service extension | event-driven | existing message handler at `:104-117` (gcode_state watch) | exact (same file — parallel field watch) |
| **MODIFIED:** `src/lib/server/services/go2rtc.ts` (+ `generateGo2rtcConfigBambuA1`) | yaml generator | transform | `generateGo2rtcConfigBambu` at `:142-166` + `generateGo2rtcConfigLoxone` at `:105-133` | exact (same file — sibling function) |
| **MODIFIED:** `src/lib/server/services/onboarding.ts` (A1 branch in `configureGo2rtc`) | orchestration | request-response | existing `configureGo2rtc` at `:311-384` | exact (add branch) |
| **MODIFIED:** `src/lib/server/db/schema.ts` (+ `model` column on cameras) | schema/model | n/a | existing Bambu columns `accessCode`/`serialNumber` at `:48-49` | exact (follow nullable additive migration pattern) |
| **MODIFIED:** drizzle migration `drizzle/NNNN_*.sql` | migration (SQL) | n/a | `drizzle/0000_flippant_apocalypse.sql` (ALTER TABLE additive pattern) | exact |
| **MODIFIED:** `src/routes/api/onboarding/bambu/preflight/+server.ts` (thread `model`) | route handler | request-response | itself (`:5-35`) — extend input shape | exact |
| **MODIFIED:** `src/lib/components/onboarding/StepBambuCredentials.svelte` and/or `StepBambuPreflight.svelte` (A1-aware copy) | component | UI state | `StepBambuCredentials.svelte:4-12` props shape | role-match (add `model` prop + capabilities-driven copy) |
| **MODIFIED:** `src/lib/components/cameras/CameraDetailCard.svelte` (capability-gated render) | component | UI state | existing `camera.cameraType === 'bambu'` branches at `:445`, `:851`, `:856` | role-match (switch `model`-hardcoded → `capabilities.*` checks) |

## Pattern Assignments

---

### `src/lib/server/services/bambu-a1-auth.ts` (utility, pure transform)

**Analog (primary):** `.planning/spikes/004-a1-stream-fallback/probe.mjs` lines 30-46 — proven-on-hardware byte layout
**Analog (module style):** `src/lib/server/services/bambu-credentials.ts` — named constants + pure exports

**Lift code directly (probe.mjs:38-46):**
```typescript
// Byte layout per ha-bambulab pybambu/bambu_client.py ChamberImageThread.run():
//   struct.pack("<I", 0x40)    → 40 00 00 00
//   struct.pack("<I", 0x3000)  → 00 30 00 00   (little-endian!)
//   struct.pack("<I", 0)       → 00 00 00 00  (reserved)
//   struct.pack("<I", 0)       → 00 00 00 00  (reserved)
//   username   ascii, null-padded to 32 bytes
//   accessCode ascii, null-padded to 32 bytes
// Total 80 bytes.
export function buildAuth(username: string, accessCode: string): Buffer {
    const buf = Buffer.alloc(80, 0);
    buf.writeUInt32LE(0x40, 0);
    buf.writeUInt32LE(0x3000, 4);  // NOT 0x30 — silent-fail pitfall
    // bytes 8..15 stay zero
    buf.write(username, 16, 32, 'ascii');
    buf.write(accessCode, 48, 32, 'ascii');
    return buf;
}
```

**Export pattern** — mirror `bambu-credentials.ts:8`:
```typescript
// Canonical Bambu LAN username. Shared constant; do not re-declare.
// (Currently exported from bambu-credentials.ts; re-import here.)
import { BAMBU_USERNAME } from './bambu-credentials';
```

**Placement:** new file; no I/O imports (keeps it Vitest-friendly without needing `$env` mocks).

---

### `src/lib/server/services/bambu-a1-auth.test.ts` (test, unit)

**Analog:** `src/lib/server/services/bambu-credentials.test.ts` (full file, 35 lines)

**Imports + describe scaffold** (from `bambu-credentials.test.ts:1-12`):
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAuth } from './bambu-a1-auth';
```
(No `$env/dynamic/private` mock needed — `buildAuth` is pure.)

**Byte-by-byte assertion pattern** (new, but research doc §Gap 8 specifies the exact layout):
```typescript
describe('buildAuth', () => {
  it('produces the exact 80-byte layout documented in spike 004', () => {
    const actual = buildAuth('bblp', '20633520');
    expect(actual.length).toBe(80);
    // Catches the 0x30 vs 0x3000 silent-fail regression (Pitfall 1)
    expect([...actual.subarray(0, 16)]).toEqual([
      0x40, 0, 0, 0,     // u32 LE = 0x40
      0, 0x30, 0, 0,     // u32 LE = 0x3000 (NOT 0x30)
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    expect(actual.subarray(16, 20).toString('ascii')).toBe('bblp');
    expect(actual.subarray(20, 48).every(b => b === 0)).toBe(true);
    expect(actual.subarray(48, 56).toString('ascii')).toBe('20633520');
    expect(actual.subarray(56, 80).every(b => b === 0)).toBe(true);
  });

  it('matches the committed golden fixture', () => {
    const fixture = readFileSync('src/lib/server/services/__fixtures__/a1-auth-packet.bin');
    expect(buildAuth('bblp', '20633520').equals(fixture)).toBe(true);
  });
});
```

---

### `src/lib/server/services/__fixtures__/a1-auth-packet.bin` (binary fixture)

**Analog:** none in repo today — Phase 18 introduces the `__fixtures__/` pattern.

**Generation procedure** (one-time, dev-only — NOT run in CI):
```bash
# Committed to repo; regenerate only if buildAuth's byte layout changes intentionally.
node --eval "
  import('./src/lib/server/services/bambu-a1-auth.ts').then(({ buildAuth }) => {
    require('fs').writeFileSync(
      'src/lib/server/services/__fixtures__/a1-auth-packet.bin',
      buildAuth('bblp', '20633520')
    );
  });
"
```

**Placement:** create directory `src/lib/server/services/__fixtures__/` (first fixture in the repo).

---

### `src/lib/server/services/bambu-a1-camera.ts` (service, TLS helpers)

**Analog (primary):** `src/lib/server/services/bambu-preflight.ts:91-124` `checkTcpReal` — TLS/TCP probe Promise pattern
**Analog (secondary):** `src/lib/server/services/bambu-preflight.ts:126-184` `checkRtspsReal` — same settled-guard + timer.unref shape

**Imports pattern** (from `bambu-preflight.ts:1-4`):
```typescript
import tls from 'node:tls';
import { BAMBU_USERNAME } from './bambu-credentials';
import { buildAuth } from './bambu-a1-auth';
```

**TLS probe pattern** — copy-and-adapt from `checkTcpReal` (`bambu-preflight.ts:91-124`), switch `net.connect` → `tls.connect`:
```typescript
// Mirrors checkTcpReal shape exactly: Promise + settled guard + timer.unref + resolved-once
export type Tls6000Fail = {
  ok: false;
  reason: 'REFUSED' | 'TIMEOUT' | 'AUTH_SILENT_DROP' | 'TLS_HANDSHAKE';
};

export async function checkTls6000Real(
  ip: string,
  accessCode: string,
  timeoutMs: number
): Promise<CheckOk | Tls6000Fail> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: ip,
      port: 6000,
      rejectUnauthorized: false,  // self-signed BBL CA; H2C already does this
      timeout: timeoutMs
    });
    let authSent = false;
    let settled = false;
    const finish = (r: CheckOk | Tls6000Fail): void => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish(authSent
        ? { ok: false, reason: 'AUTH_SILENT_DROP' }
        : { ok: false, reason: 'TLS_HANDSHAKE' }),
      timeoutMs
    );
    timer.unref();  // don't keep event loop alive
    socket.on('secureConnect', () => {
      socket.write(buildAuth(BAMBU_USERNAME, accessCode));
      authSent = true;
    });
    socket.on('data', () => {
      // ≥1 byte back within timeout = auth accepted (see spike 004 §2)
      clearTimeout(timer);
      finish({ ok: true });
    });
    socket.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err?.code === 'ECONNREFUSED') return finish({ ok: false, reason: 'REFUSED' });
      if (err?.code === 'ETIMEDOUT') return finish({ ok: false, reason: 'TIMEOUT' });
      finish({ ok: false, reason: 'TLS_HANDSHAKE' });
    });
  });
}
```

**Snapshot helper (one-shot JPEG fetch)** — reuse the frame parser loop from `probe.mjs:101-141`. New addition but pattern is spike-proven:
```typescript
export async function fetchA1SnapshotJpeg(
  ip: string,
  accessCode: string,
  timeoutMs = 8000
): Promise<Buffer | null> {
  // Connect → send auth → buffer until first full 16-byte header + N-byte JPEG → destroy socket.
  // Returns null on timeout / bad frame.
  // Implementation: same settled-guard pattern as checkTls6000Real, but resolves with Buffer.
}
```

**Error handling** — reuse `bambu-preflight.ts:115-123` `NodeJS.ErrnoException` pattern (check `err.code`).

**Placement:** new file next to `bambu-preflight.ts`. Keep `buildAuth` import so auth-packet regressions trip the shared test.

---

### `src/lib/server/services/bambu-a1-camera.test.ts` (test, unit)

**Analog:** `src/lib/server/services/bambu-preflight.test.ts:1-108` — dep-injection + vi.fn mocks

**Scaffold pattern** (from `bambu-preflight.test.ts:1-17`):
```typescript
import { describe, it, expect, vi } from 'vitest';
// No $env mock needed — TLS helpers are I/O but take plain args; use mocks, not env.
```

**SIGTERM test pattern** (fresh — use `child_process.spawn`):
```typescript
import { spawn } from 'node:child_process';
describe('bambu-a1-camera.mjs SIGTERM behavior', () => {
  it('exits cleanly within 1s of receiving SIGTERM', async () => {
    const proc = spawn('node', ['lxc-assets/bambu-a1-camera.mjs', '--ip=127.0.0.1'], {
      env: { A1_ACCESS_CODE: 'placeholder', ...process.env }
    });
    await new Promise(r => setTimeout(r, 200));  // let it start
    const exitPromise = new Promise<number>(r => proc.on('exit', code => r(code ?? -1)));
    proc.kill('SIGTERM');
    const code = await Promise.race([
      exitPromise,
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))
    ]);
    expect(code).toBe(0);
  });
});
```

**Frame-parser roundtrip test** (synthesize 16-byte header + tiny JPEG, feed to parser, assert output):
```typescript
// Synthetic frame: 16 bytes header (size=N LE u32 + 12 bytes padding) + N-byte payload starting FF D8 ... FF D9
// Pure function test — no network.
```

---

### `lxc-assets/bambu-a1-camera.mjs` (runtime ingestion script)

**Analog:** `.planning/spikes/004-a1-stream-fallback/probe.mjs` (full file, 159 lines) — lift directly, add SIGTERM + env-var creds + stdout emit

**Lift imports + buildAuth + frame loop verbatim from `probe.mjs:20-46, 101-141`.** Changes vs spike:

**1. Creds source** — change from `probe.mjs:23-28` (env-var both) to hybrid (IP from `--ip=` arg, code from env):
```javascript
// Research doc Anti-Pattern §4: access code via env-var, NOT CLI arg — ps ax leaks
const ip = process.argv.find(a => a.startsWith('--ip='))?.slice(5);
const code = process.env.A1_ACCESS_CODE;
if (!ip || !code) {
  console.error('Missing --ip or A1_ACCESS_CODE');
  process.exit(2);
}
```

**2. SIGTERM handler** — new (spike has no shutdown path). Research §Gap 4 specifies:
```javascript
let socket = null;
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { socket?.end(); } catch {}
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**3. Stdout emit** — change `probe.mjs:128-129` (`fs.writeFileSync` to disk) to `process.stdout.write(jpeg)`. research §Gap 1 specifies raw concatenated JPEGs, no multipart headers.

**4. Remove spike-only diagnostics** — drop cert logging (probe.mjs:86-93), drop dimension parser (probe.mjs:49-63), drop log buffer + `probe-log.txt`.

**Frame-parser kernel to keep verbatim (`probe.mjs:103-113`):**
```javascript
while (buf.length >= 16) {
  const size = buf.readUInt32LE(0);
  if (size === 0 || size > 5_000_000) {
    process.stderr.write(`[a1-cam] suspicious size=${size}; abort\n`);
    socket.destroy();
    return;
  }
  if (buf.length < 16 + size) return;  // wait for full frame
  const jpeg = buf.subarray(16, 16 + size);
  buf = buf.subarray(16 + size);
  if (jpeg[0] === 0xff && jpeg[1] === 0xd8) {
    process.stdout.write(jpeg);
  }
}
```

**5. Error handler** — `socket.on('error')` and `socket.on('close')` both `process.exit(1)` so go2rtc respawns (research §Gap 4).

**Placement:** new top-level directory `lxc-assets/` (research §Recommended Structure). Committed to repo; read via `readFileSync` + `import.meta.url` in `onboarding.ts`.

---

### `src/routes/api/cameras/[id]/a1-snapshot/+server.ts` (route handler, GET)

**Analog (primary):** `src/routes/api/cameras/[id]/snapshot/+server.ts:62-107` — existing snapshot endpoint; same lookup + decrypt + response pattern
**Analog (secondary):** `src/routes/api/cameras/[id]/bambu-state/+server.ts:1-19` — simpler Bambu-only route with `cameraType` guard

**Imports pattern** (from `snapshot/+server.ts:1-7`):
```typescript
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { fetchA1SnapshotJpeg } from '$lib/server/services/bambu-a1-camera';
```

**JPEG headers constant** (copy verbatim from `snapshot/+server.ts:8`):
```typescript
const JPEG_HEADERS = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' };
```

**Cache pattern** — research §Don't Hand-Roll specifies trivial in-memory Map (not in existing code; new but small):
```typescript
// 2-second cache per camera ID — research §D-04 + §Gap 10 DoS mitigation
const cache = new Map<number, { buf: Buffer; expiresAt: number }>();
const CACHE_TTL_MS = 2000;
```

**Camera lookup + type guard** (lift from `bambu-state/+server.ts:9-13`):
```typescript
export const GET: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id);
  const cam = db.select().from(cameras).where(eq(cameras.id, id)).get() as any;
  if (!cam || cam.cameraType !== 'bambu') {
    return new Response('Not a Bambu camera', { status: 404 });
  }
  if (cam.model !== 'A1') {
    return new Response('Not an A1 printer', { status: 400 });
  }
```

**Cache-check + fetch + response** (follows `snapshot/+server.ts:70-107` return shape):
```typescript
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(new Uint8Array(cached.buf), { headers: JPEG_HEADERS });
  }
  const accessCode = decrypt(cam.accessCode);
  const buf = await fetchA1SnapshotJpeg(cam.ip, accessCode, 8000);
  if (!buf) return new Response('Snapshot unavailable', { status: 502 });
  cache.set(id, { buf, expiresAt: Date.now() + CACHE_TTL_MS });
  return new Response(new Uint8Array(buf), { headers: JPEG_HEADERS });
};
```

**Error handling** (from `snapshot/+server.ts:103-106`):
```typescript
// Wrap the fetch body in try/catch → 504 on timeout (same pattern as existing snapshot)
```

---

### `src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts` (test, endpoint)

**Analog (closest):** `src/lib/server/services/go2rtc.test.ts:122-157` — fetch-mock + Response shape assertions
**Analog (db mock):** `src/lib/server/services/go2rtc.test.ts:10-17` — `vi.mock('$lib/server/db/client')`

**Scaffold** (from `go2rtc.test.ts:1-19`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));
vi.mock('$lib/server/db/client', () => ({ db: { /* stub */ } }));
vi.mock('$lib/server/services/bambu-a1-camera', () => ({
  fetchA1SnapshotJpeg: vi.fn()
}));

import { GET } from './+server';
```

**Cache-hit test pattern**:
```typescript
it('serves from 2s cache on consecutive requests', async () => {
  // Wire db mock to return A1 camera record
  // First call → hits fetchA1SnapshotJpeg
  // Second call within 2s → does NOT call fetchA1SnapshotJpeg again
});
```

---

### `src/lib/server/services/bambu-discovery.ts` (MODIFY — add `PRINTER_CAPABILITIES`)

**Target file:** extend existing file at line 39 (right after `MODEL_LABELS` closes)

**Existing sibling pattern** (`bambu-discovery.ts:27-39`):
```typescript
export const BAMBU_MODEL_ALLOWLIST = ['O1C2', 'H2C', 'H2D', 'X1C', 'P1S', 'A1'] as const;

// Map DevModel wire code → display label. O1C2 is the H2C's internal code
// (H2C-FIELD-NOTES.md §Known Issues). Unknown-but-allowlisted codes fall
// back to "Bambu Lab <code>" so forward-compat devices still show sensibly.
const MODEL_LABELS: Record<string, string> = {
    O1C2: 'Bambu Lab H2C',
    H2C: 'Bambu Lab H2C',
    H2D: 'Bambu Lab H2D',
    X1C: 'Bambu Lab X1C',
    P1S: 'Bambu Lab P1S',
    A1: 'Bambu Lab A1'
};
```

**New addition (insert at line 40, following same `Record<string, ...>` shape)** — shape locked by CONTEXT.md D-07:
```typescript
/**
 * Per-model capability matrix. Frontend reads these to hide/show panels
 * (chamber-temp, AMS, xcam toggles) without hardcoded model checks. Adding
 * a future model = one entry here; UI auto-adapts.
 */
export const PRINTER_CAPABILITIES: Record<string, {
    chamberHeater: boolean;
    ams: 'none' | 'lite' | 'full';
    xcamFeatures: readonly string[];
    cameraResolution: '480p' | '1080p' | '4k';
    cameraTransport: 'rtsps-322' | 'jpeg-tls-6000';
}> = {
    O1C2: { chamberHeater: true,  ams: 'full', xcamFeatures: [/* H2C full */], cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    H2C:  { chamberHeater: true,  ams: 'full', xcamFeatures: [/* H2C full */], cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    H2D:  { chamberHeater: true,  ams: 'full', xcamFeatures: [/* H2C full */], cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    X1C:  { chamberHeater: true,  ams: 'full', xcamFeatures: [/* X1C full */], cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    P1S:  { chamberHeater: false, ams: 'full', xcamFeatures: [],               cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    A1:   { chamberHeater: false, ams: 'lite', xcamFeatures: ['buildplateMarkerDetector'], cameraResolution: '1080p', cameraTransport: 'jpeg-tls-6000' }
};
```

**Export — must be named export `PRINTER_CAPABILITIES`** (unlike `MODEL_LABELS` which is currently module-private at `:32`). CONTEXT.md D-07 requires it be importable by preflight, snapshot, UI.

---

### `src/lib/server/services/bambu-preflight.ts` (MODIFY — extend enum + hints + branch `runBambuPreflight`)

**Target file:** 3 edits in existing file

**Edit 1:** Extend `PreflightError` enum at `:15-19`:
```typescript
// Before (bambu-preflight.ts:15-19):
export type PreflightError =
    | 'PRINTER_UNREACHABLE'
    | 'LAN_MODE_OFF'
    | 'WRONG_ACCESS_CODE'
    | 'RTSPS_HANDSHAKE_HUNG';

// After — add one variant:
export type PreflightError =
    | 'PRINTER_UNREACHABLE'
    | 'LAN_MODE_OFF'
    | 'WRONG_ACCESS_CODE'
    | 'RTSPS_HANDSHAKE_HUNG'
    | 'A1_CLOUD_MODE_ACTIVE';  // NEW (D-05)
```

**Edit 2:** Extend `PREFLIGHT_HINTS_DE` at `:25-34` — match existing tone (short, actionable, points to specific screen):
```typescript
// Existing pattern (bambu-preflight.ts:25-34):
export const PREFLIGHT_HINTS_DE: Record<PreflightError, string> = {
    PRINTER_UNREACHABLE:
        'Drucker nicht erreichbar. IP-Adresse und Netzwerkverbindung prüfen.',
    LAN_MODE_OFF:
        'LAN Mode scheint deaktiviert. Am Drucker: Einstellungen → Netzwerk → LAN Mode aktivieren.',
    WRONG_ACCESS_CODE:
        'Access Code abgelehnt. Am Drucker-Display aktuellen Code ablesen (Einstellungen → Netzwerk → Access Code).',
    RTSPS_HANDSHAKE_HUNG:
        'RTSPS-Server antwortet nicht (Live555 hängt). Drucker bitte kurz aus- und wieder einschalten.',
    // NEW (D-05):
    A1_CLOUD_MODE_ACTIVE:
        'Cloud-Modus ist aktiv. Bambu Handy App → Gerät → "LAN Mode only" aktivieren und Cloud-Verbindung deaktivieren.'
};
```

**Edit 3:** Branch `runBambuPreflight` at `:57-84` — add `model` param, `PreflightDeps` gets new methods:

**Existing pattern to extend (`bambu-preflight.ts:47-51`):**
```typescript
export interface PreflightDeps {
    checkTcp(ip: string, port: number, timeoutMs: number): Promise<CheckOk | TcpFail>;
    checkRtsps(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | RtspsFail>;
    checkMqtt(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | MqttFail>;
}
```

**Extend to:**
```typescript
export type Tls6000Fail = { ok: false; reason: 'REFUSED' | 'TIMEOUT' | 'AUTH_SILENT_DROP' | 'TLS_HANDSHAKE' };
export type TutkFail = { ok: false; reason: 'ENABLED' | 'TIMEOUT' };

export interface PreflightDeps {
    checkTcp(ip: string, port: number, timeoutMs: number): Promise<CheckOk | TcpFail>;
    checkRtsps(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | RtspsFail>;
    checkMqtt(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | MqttFail>;
    checkTls6000(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | Tls6000Fail>;  // NEW
    checkTutkDisabled(ip: string, accessCode: string, serial: string, timeoutMs: number): Promise<CheckOk | TutkFail>;  // NEW
}
```

**Branch pattern** — add `model` param (research Pattern 2):
```typescript
// Existing runBambuPreflight at bambu-preflight.ts:57-84 becomes model-aware:
import { PRINTER_CAPABILITIES } from './bambu-discovery';

export async function runBambuPreflight(
    input: PreflightInput,
    deps: PreflightDeps,
    model: string = 'H2C'  // default preserves existing H2C behavior for callers that don't pass it
): Promise<PreflightResult> {
    const caps = PRINTER_CAPABILITIES[model] ?? PRINTER_CAPABILITIES['H2C'];

    // Phase 1: TCP reachability — MQTT port is universal
    const tcpMqtt = await deps.checkTcp(input.ip, 8883, 3000);
    if (!tcpMqtt.ok) return fail('PRINTER_UNREACHABLE');

    // Phase 2: camera-transport-specific probe
    if (caps.cameraTransport === 'rtsps-322') {
        // Existing H2C path — keep bambu-preflight.ts:61-75 sequence intact
        const tcp = await deps.checkTcp(input.ip, 322, 3000);
        if (!tcp.ok) {
            if (tcp.reason === 'REFUSED') return fail('LAN_MODE_OFF');
            return fail('PRINTER_UNREACHABLE');
        }
        const rtsps = await deps.checkRtsps(input.ip, input.accessCode, 12000);
        if (!rtsps.ok) {
            if (rtsps.reason === 'AUTH') return fail('WRONG_ACCESS_CODE');
            if (rtsps.reason === 'REFUSED') return fail('LAN_MODE_OFF');
            return fail('RTSPS_HANDSHAKE_HUNG');
        }
    } else if (caps.cameraTransport === 'jpeg-tls-6000') {
        const tls6000 = await deps.checkTls6000(input.ip, input.accessCode, 6000);
        if (!tls6000.ok) {
            if (tls6000.reason === 'REFUSED') return fail('PRINTER_UNREACHABLE');
            if (tls6000.reason === 'AUTH_SILENT_DROP') return fail('WRONG_ACCESS_CODE');
            return fail('PRINTER_UNREACHABLE');
        }
    }

    // Phase 3: MQTT auth — universal
    const mqtt = await deps.checkMqtt(input.ip, input.accessCode, 5000);
    if (!mqtt.ok) return mqtt.reason === 'AUTH' ? fail('WRONG_ACCESS_CODE') : fail('LAN_MODE_OFF');

    // Phase 4: A1-only — TUTK cloud-mode guard (D-05)
    if (caps.cameraTransport === 'jpeg-tls-6000') {
        const tutk = await deps.checkTutkDisabled(input.ip, input.accessCode, input.serialNumber, 5000);
        if (!tutk.ok) return fail('A1_CLOUD_MODE_ACTIVE');
    }

    return { ok: true };
}
```

**Real-dep implementations** — add `checkTls6000Real` (mirrors `checkTcpReal` at `:91-124` — see `bambu-a1-camera.ts` analog above) and `checkTutkDisabledReal` (mirrors `checkMqttReal` at `:186-217`, subscribes + reads one pushall response, asserts `print.ipcam.tutk_server !== 'enable'`).

**Update `realDeps` export at `:219-223`:**
```typescript
export const realDeps: PreflightDeps = {
    checkTcp: checkTcpReal,
    checkRtsps: checkRtspsReal,
    checkMqtt: checkMqttReal,
    checkTls6000: checkTls6000Real,        // NEW
    checkTutkDisabled: checkTutkDisabledReal  // NEW
};
```

---

### `src/lib/server/services/bambu-mqtt.ts` (MODIFY — TUTK watch + error enum)

**Target file:** 2 edits in existing file

**Edit 1:** Extend `BambuConnectionError` at `:25-29` — add one variant:
```typescript
// Before (bambu-mqtt.ts:25-29):
type BambuConnectionError =
    | 'WRONG_ACCESS_CODE'
    | 'LAN_MODE_OFF'
    | 'PRINTER_UNREACHABLE'
    | 'MQTT_DISCONNECTED';

// After (D-06):
type BambuConnectionError =
    | 'WRONG_ACCESS_CODE'
    | 'LAN_MODE_OFF'
    | 'PRINTER_UNREACHABLE'
    | 'MQTT_DISCONNECTED'
    | 'A1_CLOUD_MODE_ACTIVE';
```

**Edit 2:** Extend `client.on('message', ...)` handler at `:104-117`. **Critical:** the existing handler unconditionally clears `lastError = null` on every message (`:106`) — this must change to preserve the printer-state TUTK flag across messages.

**Existing pattern (bambu-mqtt.ts:104-117):**
```typescript
client.on('message', (_topic, payload) => {
    sub.lastMessageAt = Date.now();
    sub.lastError = null;  // <-- UNCONDITIONAL clear — must become conditional
    let msg: any;
    try {
        msg = JSON.parse(payload.toString());
    } catch {
        return;
    }
    const gcodeState = msg?.print?.gcode_state;
    if (typeof gcodeState === 'string' && gcodeState) {
        void handleStateChange(sub, gcodeState);
    }
});
```

**After (research §Gap 6):**
```typescript
client.on('message', (_topic, payload) => {
    sub.lastMessageAt = Date.now();
    // Conditional clear — preserve A1_CLOUD_MODE_ACTIVE across message arrival;
    // only explicit ipcam.tutk_server='disable' transition should clear it.
    if (sub.lastError && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') {
        sub.lastError = null;
    }
    let msg: any;
    try {
        msg = JSON.parse(payload.toString());
    } catch {
        return;
    }

    // Existing: gcode_state → adaptive-mode transition
    const gcodeState = msg?.print?.gcode_state;
    if (typeof gcodeState === 'string' && gcodeState) {
        void handleStateChange(sub, gcodeState);
    }

    // NEW: TUTK runtime watch (D-06 / research §Gap 6)
    const tutkServer = msg?.print?.ipcam?.tutk_server;
    if (typeof tutkServer === 'string') {
        if (tutkServer === 'enable' && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') {
            sub.lastError = 'A1_CLOUD_MODE_ACTIVE';
            console.log(`[bambu-mqtt] cam=${sub.cameraId} tutk_server=enable → CLOUD_MODE_ACTIVE`);
        } else if (tutkServer === 'disable' && sub.lastError === 'A1_CLOUD_MODE_ACTIVE') {
            sub.lastError = null;
            console.log(`[bambu-mqtt] cam=${sub.cameraId} tutk_server=disable → cleared`);
        }
    }
});
```

**`getBambuState()` at `:220-246`** — no code change needed; the returned `error` field already surfaces `A1_CLOUD_MODE_ACTIVE` through `sub.lastError`.

---

### `src/lib/server/services/go2rtc.ts` (MODIFY — add `generateGo2rtcConfigBambuA1`)

**Target file:** add sibling function between `generateGo2rtcConfigBambu` (`:142-166`) and `generateNginxConfig` (`:171`)

**Existing sibling pattern** (`go2rtc.ts:142-166`):
```typescript
export function generateGo2rtcConfigBambu(params: {
    streamName: string;
    printerIp: string;
    accessCode: string;
    rtspAuth?: RtspAuth;
}): string {
    const { streamName, printerIp, accessCode, rtspAuth } = params;
    const sourceUrl = `rtspx://bblp:${accessCode}@${printerIp}:322/streaming/live/1`;
    return `streams:
  ${streamName}:
    - ${sourceUrl}#video=copy#audio=copy#reconnect_timeout=30
  ${streamName}-low:
    - ffmpeg:rtsp://127.0.0.1:8554/${streamName}#video=h264#hardware=vaapi#width=840#height=540#raw=-g 30#raw=-maxrate 500k#raw=-bufsize 1000k
${rtspServerBlock(rtspAuth)}
ffmpeg:
  bin: ffmpeg

log:
  level: info
`;
}
```

**Loxone exec-pattern sibling** (`go2rtc.ts:105-133`) — closer conceptually but uses nginx proxy not `exec:`. The new A1 generator parallels the Bambu signature exactly:

**New addition** (research §Code Examples — `generateBambuA1Go2rtcYaml`):
```typescript
/**
 * Generates go2rtc YAML config for a Bambu Lab A1 printer.
 *
 * Unlike H2C (which exposes RTSPS:322), A1 uses a proprietary JPEG-over-TLS
 * stream on port 6000. We spawn a Node ingestion script via go2rtc's exec:
 * pipe transport; the script emits raw concatenated JPEGs on stdout, go2rtc's
 * magic.Open() auto-detects MJPEG, and the same :8554 RTSP server applies.
 *
 * `#killsignal=15#killtimeout=5` is MANDATORY — go2rtc's 2024-era default is
 * SIGKILL, which leaves the printer holding a stale TLS session for ~30s
 * (research §Gap 4 / Pitfall 2). Access code is passed via env var, NOT CLI
 * arg, so it doesn't leak via `ps ax` (research §Anti-Pattern 4).
 *
 * Script deployment: lxc-assets/bambu-a1-camera.mjs → /opt/ipcm/bambu-a1-camera.mjs
 * via pushFileToContainer() in onboarding.ts.
 */
export function generateGo2rtcConfigBambuA1(params: {
    streamName: string;
    printerIp: string;
    accessCode: string;
    rtspAuth?: RtspAuth;
}): string {
    const { streamName, printerIp, accessCode, rtspAuth } = params;
    const execCmd = `exec:env A1_ACCESS_CODE=${accessCode} node /opt/ipcm/bambu-a1-camera.mjs --ip=${printerIp}#killsignal=15#killtimeout=5`;
    return `streams:
  ${streamName}:
    - ${execCmd}
${rtspServerBlock(rtspAuth)}
log:
  level: info
`;
}
```

**Matching test** in `go2rtc.test.ts` — follow the snapshot-style pattern at `:28-46`:
```typescript
describe('generateGo2rtcConfigBambuA1', () => {
  it('emits exec: with env-var access code and kill signals', () => {
    const yaml = generateGo2rtcConfigBambuA1({
      streamName: 'bambu_a1_test',
      printerIp: '192.168.3.195',
      accessCode: 'abc12345'
    });
    expect(yaml).toContain('bambu_a1_test:');
    expect(yaml).toContain('exec:env A1_ACCESS_CODE=abc12345 node /opt/ipcm/bambu-a1-camera.mjs --ip=192.168.3.195');
    expect(yaml).toContain('#killsignal=15');
    expect(yaml).toContain('#killtimeout=5');
    // Access code must NOT appear as --access-code= (CLI arg leak via ps)
    expect(yaml).not.toContain('--access-code=');
  });
});
```

**Node install hoist** (research §Pitfall 5 + Open Question 1) — modify `getInstallCommands()` at `:93-100` OR branch `configureGo2rtc` ordering in `onboarding.ts` for A1. **Planner picks**; recommendation is to hoist Node install:
```typescript
// go2rtc.ts:93-100 extension (option A — recommended):
export function getInstallCommands(forBambuA1 = false): string[] {
    const base = [
        'apt-get update -qq && apt-get install -y -qq ffmpeg intel-media-va-driver wget',
        'wget -q https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 -O /usr/local/bin/go2rtc && chmod +x /usr/local/bin/go2rtc',
        'mkdir -p /etc/go2rtc'
    ];
    if (forBambuA1) {
        // A1 ingestion script needs Node; installed here so exec: child can start.
        base.push('curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs');
    }
    return base;
}
```

---

### `src/lib/server/services/onboarding.ts` (MODIFY — A1 branch in `configureGo2rtc`)

**Target file:** extend branch at `:332-342` (existing `cameraType === 'bambu'` case)

**Existing branch to extend (`onboarding.ts:332-342`):**
```typescript
if (camera.cameraType === 'bambu') {
    // Bambu: go2rtc pulls RTSPS from the printer (rtspx:// skips TLS verify),
    // passthrough h264. Access Code is stored in access_code, not password.
    const accessCode = camera.accessCode ? decrypt(camera.accessCode) : '';
    if (!accessCode) throw new Error('Bambu camera missing access_code');
    yamlContent = generateGo2rtcConfigBambu({
        streamName: camera.streamName,
        printerIp: camera.ip,
        accessCode,
        rtspAuth
    });
}
```

**After — model-split with A1 branch** (add `import { generateGo2rtcConfigBambuA1 } from './go2rtc'` at line 2):
```typescript
if (camera.cameraType === 'bambu') {
    const accessCode = camera.accessCode ? decrypt(camera.accessCode) : '';
    if (!accessCode) throw new Error('Bambu camera missing access_code');

    if (camera.model === 'A1') {
        // A1: deploy ingestion script to /opt/ipcm/, use exec: go2rtc source
        const scriptContent = readFileSync(
            new URL('../../../../lxc-assets/bambu-a1-camera.mjs', import.meta.url),
            'utf8'
        );
        await executeOnContainer(ssh, camera.vmid, 'mkdir -p /opt/ipcm');
        await pushFileToContainer(ssh, camera.vmid, scriptContent, '/opt/ipcm/bambu-a1-camera.mjs');

        yamlContent = generateGo2rtcConfigBambuA1({
            streamName: camera.streamName,
            printerIp: camera.ip,
            accessCode,
            rtspAuth
        });
    } else {
        // H2C / O1C2 / H2D / X1C / P1S — existing RTSPS:322 path
        yamlContent = generateGo2rtcConfigBambu({
            streamName: camera.streamName,
            printerIp: camera.ip,
            accessCode,
            rtspAuth
        });
    }
}
```

**Import add at top of file** (line 1 area):
```typescript
import { readFileSync } from 'node:fs';
```

**Node install hoist** — at `configureGo2rtc:315-322`, change `getInstallCommands()` to `getInstallCommands(camera.model === 'A1')` so fresh-install A1 LXCs get Node pre-installed. **Template-clone path** (`skipInstall=true`) already has Node from prior ONVIF step, so no change there.

---

### `src/lib/server/db/schema.ts` (MODIFY — add `model` column)

**Target file:** `cameras` table at `:31-59` — add one column

**Existing additive pattern** (Phase 11 added `accessCode` + `serialNumber` at `:48-49`):
```typescript
// bambu-related columns are nullable + optional; Mobotix rows leave them null
accessCode: text('access_code'),
serialNumber: text('serial_number'),
printState: text('print_state'),
```

**New column — same shape** (after `serialNumber` at `:49`):
```typescript
// Bambu model code from SSDP (e.g. 'A1', 'H2C', 'O1C2'). Nullable:
// null = assume H2C for backward-compat with pre-Phase-18 rows.
// Used by preflight model-split and UI capability gating (BAMBU-A1-02).
model: text('model'),
```

**Migration file — `drizzle/NNNN_*_add_camera_model.sql`** (auto-generated via `npm run db:generate`):

**Analog (additive ALTER pattern):** `drizzle/0000_flippant_apocalypse.sql` — mirror exactly:
```sql
-- Phase 18: Bambu A1 integration — additive model column on `cameras`.
-- Nullable; null rows (existing H2C adoptions) get assume-H2C behavior at
-- read-time via PRINTER_CAPABILITIES fallback. No destructive ops, no backfill.

ALTER TABLE `cameras` ADD `model` text;
```

**SSDP-adoption write path** — `saveCameraRecord` in `onboarding.ts:160-201` currently doesn't write `model`. **Planner action:** thread `model` from the Bambu discovery pipeline through to this insert (add optional `model?: string` param, default null).

---

### `src/routes/api/onboarding/bambu/preflight/+server.ts` (MODIFY — thread `model`)

**Target file:** 3 small edits in existing 35-line file

**Edit 1:** Extract `model` from request body (after `:9`):
```typescript
const model = typeof body?.model === 'string' ? body.model.trim() : 'H2C';
```

**Edit 2:** Pass to `runBambuPreflight` (at `:23`):
```typescript
// Before:
const result = await runBambuPreflight({ ip, serialNumber, accessCode }, realDeps);
// After:
const result = await runBambuPreflight({ ip, serialNumber, accessCode }, realDeps, model);
```

**Edit 3:** Validate model against allowlist — reuse `BAMBU_MODEL_ALLOWLIST` from `bambu-discovery.ts` (optional hardening; if model is unknown, `runBambuPreflight` already falls back to H2C).

---

### `src/lib/components/onboarding/StepBambuCredentials.svelte` + `StepBambuPreflight.svelte` (MODIFY — A1-aware copy)

**Target files:** extend both components to accept `model` prop and show A1-specific copy

**Existing props pattern** (`StepBambuCredentials.svelte:4-12`):
```typescript
let {
    ip,
    prefillSerial = '',
    onSubmit
}: {
    ip: string;
    prefillSerial?: string;
    onSubmit: (result: { serialNumber: string; accessCode: string }) => void;
} = $props();
```

**Add `model` prop** (new):
```typescript
let {
    ip,
    prefillSerial = '',
    model = 'H2C',  // default preserves existing H2C behavior
    onSubmit
}: {
    ip: string;
    prefillSerial?: string;
    model?: string;
    onSubmit: (result: { serialNumber: string; accessCode: string }) => void;
} = $props();
```

**Capabilities-driven copy** — fetch from API or import `PRINTER_CAPABILITIES`. Since components are client-side, expose via API response or serialize into the onboarding state object. Example A1-specific notice:
```svelte
{#if model === 'A1'}
  <p class="text-xs text-text-secondary">
    Hinweis: A1 streamt nur während des Drucks (Toolhead-Kamera, 1080p).
    Dashboard zeigt im Idle ein letztes Standbild.
  </p>
{/if}
```

**Preflight error handling** — extend `StepBambuPreflight.svelte:4` `PreflightError` type with `'A1_CLOUD_MODE_ACTIVE'`, and add to `HINTS_DE` map at `:22-28`:
```typescript
type PreflightError = 'PRINTER_UNREACHABLE' | 'LAN_MODE_OFF' | 'WRONG_ACCESS_CODE' | 'RTSPS_HANDSHAKE_HUNG' | 'A1_CLOUD_MODE_ACTIVE' | 'INVALID_INPUT';

const HINTS_DE: Record<PreflightError, string> = {
    // ... existing ...
    A1_CLOUD_MODE_ACTIVE:
        'Cloud-Modus ist aktiv. Bambu Handy App → Gerät → "LAN Mode only" aktivieren und Cloud-Verbindung deaktivieren.'
};
```

---

### `src/lib/components/cameras/CameraDetailCard.svelte` (MODIFY — capability-gated render)

**Target file:** extend existing `camera.cameraType === 'bambu'` branches at `:445`, `:851`, `:856`

**Existing pattern** (`:445`):
```svelte
{#if camera.cameraType === 'bambu'}
  <!-- Bambu-specific UI block -->
{/if}
```

**New pattern** — gate specific fields via `camera.capabilities` (shape matches `PRINTER_CAPABILITIES` entry):
```svelte
{#if camera.cameraType === 'bambu'}
  {#if camera.capabilities?.chamberHeater}
    <!-- Kammertemperatur panel (hidden for A1 + P1S) -->
  {/if}
  {#if camera.capabilities?.ams && camera.capabilities.ams !== 'none'}
    <!-- AMS panel — label "AMS" vs "AMS Lite" based on capabilities.ams value -->
  {/if}
  {#if camera.capabilities?.xcamFeatures?.includes('buildplateMarkerDetector')}
    <!-- A1-specific xcam toggle -->
  {/if}
{/if}
```

**API response plumbing** — the camera GET endpoint(s) that feed `CameraCardData` must include `model` and derive `capabilities` from `PRINTER_CAPABILITIES[model]`. Type `CameraCardData` in `src/lib/types.ts` needs new optional field `capabilities?: CapabilitySet`.

---

## Shared Patterns

### Pattern: Settled-guard Promise for TLS/TCP probes

**Source:** `src/lib/server/services/bambu-preflight.ts:91-124` `checkTcpReal`
**Apply to:** `checkTls6000Real` (new), `fetchA1SnapshotJpeg` (new)

```typescript
return new Promise((resolve) => {
    // ... connect ...
    let settled = false;
    const finish = (result): void => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* noop */ }
        resolve(result);
    };
    const timer = setTimeout(() => finish(/* timeout result */), timeoutMs);
    timer.unref();  // don't keep event loop alive
    sock.once('connect', () => { clearTimeout(timer); finish(/* success */); });
    sock.once('error', (err) => { clearTimeout(timer); finish(/* error */); });
});
```

---

### Pattern: Access-code decrypt at use-site

**Source:** `src/lib/server/services/onboarding.ts:335` + `:299` + `bambu-mqtt.ts:154`
**Apply to:** A1 snapshot endpoint, A1 ingestion script deployment, any new Bambu service

```typescript
import { decrypt } from './crypto';
// ...
const accessCode = camera.accessCode ? decrypt(camera.accessCode) : '';
if (!accessCode) throw new Error('Bambu camera missing access_code');
```

**Never log plaintext access code** — research §Security Threat Model confirmed. Use the decrypted value only inside the function scope; do not pass through logs, responses, or error messages.

---

### Pattern: Camera lookup + type guard in route handlers

**Source:** `src/routes/api/cameras/[id]/bambu-state/+server.ts:9-13`
**Apply to:** `/api/cameras/[id]/a1-snapshot/+server.ts`

```typescript
export const GET: RequestHandler = async ({ params }) => {
    const id = parseInt(params.id);
    const cam = db.select().from(cameras).where(eq(cameras.id, id)).get() as any;
    if (!cam || cam.cameraType !== 'bambu') {
        return json({ error: 'Not a Bambu camera' }, { status: 404 });
    }
    // ... handler logic ...
};
```

---

### Pattern: SSH deploy of asset → LXC

**Source:** `src/lib/server/services/onboarding.ts:298-302` (nginx.conf deploy) + `:370` (go2rtc.yaml deploy)
**Apply to:** `lxc-assets/bambu-a1-camera.mjs` deploy in A1 branch of `configureGo2rtc`

```typescript
// Always connect via connectToProxmox(), pushFileToContainer, then ssh.dispose() in finally
const ssh = await connectToProxmox();
try {
    await executeOnContainer(ssh, camera.vmid, 'mkdir -p /opt/ipcm');
    await pushFileToContainer(ssh, camera.vmid, scriptContent, '/opt/ipcm/bambu-a1-camera.mjs');
    // ... other ssh ops ...
} finally {
    ssh.dispose();
}
```

---

### Pattern: Vitest `$env` mock guard

**Source:** `src/lib/server/services/go2rtc.test.ts:4-17` + `bambu-credentials.test.ts:3-9`
**Apply to:** `bambu-a1-camera.test.ts`, `a1-snapshot/+server.test.ts`

Any test file that imports code which pulls `$env/dynamic/private` (crypto.ts, db/client.ts) MUST mock before imports:
```typescript
vi.mock('$env/dynamic/private', () => ({
    env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));
vi.mock('$lib/server/db/client', () => ({ db: {} }));
vi.mock('$lib/server/db/schema', () => ({ cameras: {}, settings: {}, containers: {} }));

import { /* subject under test */ } from './module';
```

---

### Pattern: Drizzle additive migration

**Source:** `drizzle/0000_flippant_apocalypse.sql` (full file, 10 lines)
**Apply to:** New `cameras.model` column migration

- Always **additive** `ALTER TABLE ... ADD column`, nullable, no backfill.
- Header comment explaining phase + rationale.
- Use `--> statement-breakpoint` separator between statements (drizzle-kit convention).
- Generated via `npm run db:generate`; hand-edit only for comments.

---

## No Analog Found

All files in this phase have at least a partial analog in the codebase or a spike artifact. One fresh pattern is introduced:

| File | Role | Why no analog | What to do |
|------|------|---------------|------------|
| `src/lib/server/services/__fixtures__/a1-auth-packet.bin` | binary test fixture | First `__fixtures__/` directory in repo — no prior binary test asset | Create directory; file contents derived deterministically from `buildAuth('bblp', '20633520')` per research §Gap 8 |
| Cache-Map module-scope pattern in `/a1-snapshot/+server.ts` | in-memory cache | No existing endpoint caches per-resource — existing snapshot endpoint is stateless | Research §Don't Hand-Roll specifies `Map<id, {buf, expiresAt}>` — trivial pattern, no external lib |

## Metadata

**Analog search scope:**
- `src/lib/server/services/` (all .ts files)
- `src/lib/server/db/` (schema + migrations)
- `src/routes/api/cameras/[id]/*` (all endpoints)
- `src/routes/api/onboarding/bambu/*` (all routes)
- `src/lib/components/onboarding/` + `src/lib/components/cameras/`
- `.planning/spikes/004-a1-stream-fallback/probe.mjs`
- `drizzle/` migrations + `drizzle.config.ts`

**Files scanned:** 24 source files + 3 spike artifacts

**Pattern extraction date:** 2026-04-20

**Key conventions enforced across new files:**
1. Named exports (no default exports) — matches `bambu-*.ts` convention
2. `.test.ts` suffix co-located next to source — matches all existing tests
3. German UI copy in `HINTS_DE` / wizard components — matches Phase 11 pattern
4. AES-256-GCM for access codes at rest; decrypt at use-site — matches `bambu-credentials.ts`
5. `connectToProxmox` → `try { ... } finally { ssh.dispose() }` — matches every SSH caller
6. Preflight deps exposed via `PreflightDeps` interface for test injection — matches `bambu-preflight.test.ts` scaffold
7. `rejectUnauthorized: false` for all printer TLS (H2C MQTT, H2C RTSPS, A1 port 6000) — LAN trust boundary
