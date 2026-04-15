---
phase: 11-foundation-discovery-credentials-preflight
plan: 03
type: execute
wave: 2
depends_on:
  - 01
files_modified:
  - src/routes/api/onboarding/bambu/preflight/+server.ts
  - src/lib/server/services/bambu-preflight.ts
  - src/lib/server/services/bambu-preflight.test.ts
  - package.json
  - package-lock.json
autonomous: true
requirements:
  - BAMBU-10
user_setup: []

must_haves:
  truths:
    - "POST `/api/onboarding/bambu/preflight` with `{ ip, serialNumber, accessCode }` runs three sequential checks (never parallel — H2C single-connection limit per PITFALLS §1) and returns either `{ ok: true }` or `{ ok: false, error, hint }`"
    - "Error taxonomy is exactly four codes: `PRINTER_UNREACHABLE`, `LAN_MODE_OFF`, `WRONG_ACCESS_CODE`, `RTSPS_HANDSHAKE_HUNG`"
    - "TCP :322 check uses `net.connect` with a 3 s hard timeout"
    - "RTSPS check spawns `ffprobe` with `-rtsp_transport tcp -tls_verify 0` against `rtsps://bblp:<code>@<ip>:322/streaming/live/1` with a 12 s hard timeout; the process is killed on timeout"
    - "MQTT check uses the `mqtt` npm package with `rejectUnauthorized: false` and `connectTimeout: 5000`; a successful connect immediately calls `end(true)` (force-close) and the code does NOT shell out to mosquitto_sub"
    - "Unit tests cover each of the four error codes + the ok path by injecting mock check functions (no real network calls in tests)"
  artifacts:
    - path: "src/lib/server/services/bambu-preflight.ts"
      provides: "runBambuPreflight({ip,serialNumber,accessCode}, deps?) — orchestrator; pure check functions checkTcp, checkRtsps, checkMqtt are injectable via deps for testing"
      exports: ["runBambuPreflight", "PreflightError", "PREFLIGHT_HINTS_DE"]
    - path: "src/routes/api/onboarding/bambu/preflight/+server.ts"
      provides: "POST handler — thin wrapper around runBambuPreflight; returns JSON result"
      contains: "runBambuPreflight"
    - path: "src/lib/server/services/bambu-preflight.test.ts"
      provides: "Vitest suite covering all 4 error codes + ok path via dep-injected mocks"
      contains: "describe"
    - path: "package.json"
      provides: "Adds `mqtt` to dependencies"
      contains: "\"mqtt\""
  key_links:
    - from: "src/routes/api/onboarding/bambu/preflight/+server.ts"
      to: "src/lib/server/services/bambu-preflight.ts"
      via: "import { runBambuPreflight }"
      pattern: "from '\\$lib/server/services/bambu-preflight'"
    - from: "bambu-preflight.ts checkMqtt"
      to: "mqtt npm package"
      via: "connectAsync('mqtts://<ip>:8883', { rejectUnauthorized: false })"
      pattern: "connectAsync"
---

<objective>
Ship a new API route `POST /api/onboarding/bambu/preflight` that runs three sequential connectivity checks against a Bambu printer and returns a structured verdict the wizard UI (Plan 04) can map to a German-language hint.

Purpose: BAMBU-10 — user must see *which* thing is wrong (LAN Mode off vs wrong Access Code vs unreachable vs Live555 hung) before we provision an LXC. Opaque "connection failed" is the anti-goal. The taxonomy is derived from PITFALLS.md §1/§4 (Live555 hang, Access Code rotation) and H2C-FIELD-NOTES.md §RTSPS/§MQTT (confirmed working URL template + MQTT TLS approach).

Output:
- Pure orchestrator `runBambuPreflight(input, deps?)` with dep-injected check functions (so tests don't hit the network)
- Route handler `POST /api/onboarding/bambu/preflight`
- Vitest suite exercising all five outcomes
- `mqtt` npm package added as a production dependency (the only new dep allowed in Phase 11 per 11-CONTEXT)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/11-foundation-discovery-credentials-preflight/11-CONTEXT.md
@.planning/research/H2C-FIELD-NOTES.md
@.planning/research/PITFALLS.md
@src/routes/api/onboarding/test-connection/+server.ts
@src/lib/server/services/crypto.ts

<interfaces>
Request contract:
```ts
POST /api/onboarding/bambu/preflight
body: { ip: string; serialNumber: string; accessCode: string }
```

Response contract (all responses return HTTP 200 — error classification lives in the body):
```ts
type PreflightResult =
  | { ok: true }
  | { ok: false; error: PreflightError; hint: string };

type PreflightError =
  | 'PRINTER_UNREACHABLE'
  | 'LAN_MODE_OFF'
  | 'WRONG_ACCESS_CODE'
  | 'RTSPS_HANDSHAKE_HUNG';
```

HTTP 400 reserved for input-validation failures (missing ip / serialNumber / accessCode). HTTP 500 for truly unexpected exceptions (every expected failure mode should map to one of the four codes).

Existing pattern reference: `src/routes/api/onboarding/test-connection/+server.ts` — same `json()` helper, same `POST` export, same camelCase JSON body.

From Plan 01: `import { BAMBU_USERNAME } from '$lib/server/services/bambu-credentials'` — use this constant, do NOT hardcode `'bblp'` in this plan.
</interfaces>

**Ground truth citations:**
- RTSPS URL template: `rtsps://bblp:<CODE>@<IP>:322/streaming/live/1` — "✅ **confirmed working as written**" (H2C-FIELD-NOTES.md §Recommendations #2).
- ffprobe flags: `-rtsp_transport tcp -tls_verify 0` — from H2C-FIELD-NOTES.md §Recommendations #2.
- MQTT approach: "do NOT shell out to `mosquitto_sub` — it cannot connect to the H2C's self-signed cert in mosquitto-clients 2.0.21. Use a Node.js MQTT library (`mqtt` package) with `tls.connect({ rejectUnauthorized: false })`" (H2C-FIELD-NOTES.md §Recommendations #5).
- Single-connection limit: "H2C single-connection limit → never run RTSPS + MQTT probes in parallel" (11-CONTEXT.md §Pitfalls; PITFALLS.md §1).
- Hard timeouts mandatory: "ALL ffprobe calls in pre-flight need hard `timeout` (10–15s)" (11-CONTEXT §Pitfalls).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure orchestrator + error taxonomy + tests</name>
  <files>src/lib/server/services/bambu-preflight.ts, src/lib/server/services/bambu-preflight.test.ts</files>
  <behavior>
    - `runBambuPreflight({ ip, serialNumber, accessCode }, deps)` runs checkTcp → checkRtsps → checkMqtt **in sequence, never parallel**, returning on the first failure.
    - If TCP check returns `{ ok: false }`: result is `{ ok: false, error: 'PRINTER_UNREACHABLE', hint: <DE string> }`.
    - If RTSPS check returns `{ ok: false, reason: 'AUTH' }`: result is `WRONG_ACCESS_CODE`.
    - If RTSPS check returns `{ ok: false, reason: 'TIMEOUT' }`: result is `RTSPS_HANDSHAKE_HUNG`.
    - If RTSPS check returns `{ ok: false, reason: 'REFUSED' }`: result is `LAN_MODE_OFF`.
    - If MQTT check returns `{ ok: false, reason: 'AUTH' }`: result is `WRONG_ACCESS_CODE`.
    - If MQTT check returns `{ ok: false, reason: 'TIMEOUT' }`: result is `LAN_MODE_OFF` (port 8883 blocked when LAN Mode off, per 11-CONTEXT §3).
    - If all three checks return `{ ok: true }`: result is `{ ok: true }`.
    - Tests use dep-injected mocks; NO real sockets or child processes are spawned in the test suite.
  </behavior>
  <action>
    Create `src/lib/server/services/bambu-preflight.ts`:

    ```ts
    import { BAMBU_USERNAME } from './bambu-credentials';

    export type PreflightError =
      | 'PRINTER_UNREACHABLE'
      | 'LAN_MODE_OFF'
      | 'WRONG_ACCESS_CODE'
      | 'RTSPS_HANDSHAKE_HUNG';

    export type PreflightResult =
      | { ok: true }
      | { ok: false; error: PreflightError; hint: string };

    export const PREFLIGHT_HINTS_DE: Record<PreflightError, string> = {
      PRINTER_UNREACHABLE:
        'Drucker nicht erreichbar. IP-Adresse und Netzwerkverbindung prüfen.',
      LAN_MODE_OFF:
        'LAN Mode scheint deaktiviert. Am Drucker: Einstellungen → Netzwerk → LAN Mode aktivieren.',
      WRONG_ACCESS_CODE:
        'Access Code abgelehnt. Am Drucker-Display aktuellen Code ablesen (Einstellungen → Netzwerk → Access Code).',
      RTSPS_HANDSHAKE_HUNG:
        'RTSPS-Server antwortet nicht (Live555 hängt). Drucker bitte kurz aus- und wieder einschalten.',
    };

    export interface PreflightInput {
      ip: string;
      serialNumber: string;
      accessCode: string;
    }

    export type CheckOk = { ok: true };
    export type RtspsFail = { ok: false; reason: 'AUTH' | 'TIMEOUT' | 'REFUSED' };
    export type MqttFail = { ok: false; reason: 'AUTH' | 'TIMEOUT' };
    export type TcpFail = { ok: false };

    export interface PreflightDeps {
      checkTcp(ip: string, port: number, timeoutMs: number): Promise<CheckOk | TcpFail>;
      checkRtsps(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | RtspsFail>;
      checkMqtt(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | MqttFail>;
    }

    function fail(error: PreflightError): PreflightResult {
      return { ok: false, error, hint: PREFLIGHT_HINTS_DE[error] };
    }

    export async function runBambuPreflight(
      input: PreflightInput,
      deps: PreflightDeps,
    ): Promise<PreflightResult> {
      const tcp = await deps.checkTcp(input.ip, 322, 3000);
      if (!tcp.ok) return fail('PRINTER_UNREACHABLE');

      const rtsps = await deps.checkRtsps(input.ip, input.accessCode, 12000);
      if (!rtsps.ok) {
        if (rtsps.reason === 'AUTH') return fail('WRONG_ACCESS_CODE');
        if (rtsps.reason === 'REFUSED') return fail('LAN_MODE_OFF');
        return fail('RTSPS_HANDSHAKE_HUNG');
      }

      const mqtt = await deps.checkMqtt(input.ip, input.accessCode, 5000);
      if (!mqtt.ok) {
        if (mqtt.reason === 'AUTH') return fail('WRONG_ACCESS_CODE');
        return fail('LAN_MODE_OFF');
      }

      return { ok: true };
    }
    ```

    Note: `BAMBU_USERNAME` is re-exported context for the real check implementations (Task 2) — the orchestrator itself does not use it, the checks do.

    Create `src/lib/server/services/bambu-preflight.test.ts` with six tests, each using a fresh mock `deps` object:
    1. **ok path** — all three checks resolve `{ ok: true }` → result `{ ok: true }`.
    2. **PRINTER_UNREACHABLE** — checkTcp resolves `{ ok: false }`; assert checkRtsps and checkMqtt are NEVER called (spy count).
    3. **WRONG_ACCESS_CODE via RTSPS** — tcp ok, rtsps `{ ok: false, reason: 'AUTH' }` → error='WRONG_ACCESS_CODE'; checkMqtt not called.
    4. **LAN_MODE_OFF via RTSPS REFUSED** — tcp ok, rtsps `{ ok: false, reason: 'REFUSED' }` → error='LAN_MODE_OFF'.
    5. **RTSPS_HANDSHAKE_HUNG** — tcp ok, rtsps `{ ok: false, reason: 'TIMEOUT' }` → error='RTSPS_HANDSHAKE_HUNG' + hint contains 'Live555' or 'aus- und wieder einschalten'.
    6. **LAN_MODE_OFF via MQTT TIMEOUT** — tcp+rtsps ok, mqtt `{ ok: false, reason: 'TIMEOUT' }` → error='LAN_MODE_OFF'.

    All tests are synchronous-feeling (mocks return resolved Promises immediately) — the suite runs in <500ms.
  </action>
  <verify>
    <automated>npx vitest run src/lib/server/services/bambu-preflight.test.ts</automated>
  </verify>
  <done>runBambuPreflight orchestrator exported; PREFLIGHT_HINTS_DE contains all four keys with German copy; all six tests pass; checkRtsps/checkMqtt are not invoked when an earlier check fails (verified via mock spy counts); tests use NO real sockets or child processes.</done>
</task>

<task type="auto">
  <name>Task 2: Real check implementations + route handler + mqtt dep</name>
  <files>src/lib/server/services/bambu-preflight.ts (append realDeps), src/routes/api/onboarding/bambu/preflight/+server.ts, package.json, package-lock.json</files>
  <action>
    **Part A — add `mqtt` dependency:**

    Run `npm install mqtt@^5` (the current major). This is the ONLY new npm dep introduced in Phase 11 per 11-CONTEXT §3. Commit `package.json` + `package-lock.json`.

    **Part B — append real check implementations to `bambu-preflight.ts`:**

    Append a `realDeps: PreflightDeps` export that wires the three checks to actual network/subprocess calls:

    ```ts
    import net from 'node:net';
    import { spawn } from 'node:child_process';
    import mqtt from 'mqtt';

    async function checkTcpReal(ip: string, port: number, timeoutMs: number): Promise<CheckOk | TcpFail> {
      return new Promise((resolve) => {
        const sock = net.connect({ host: ip, port });
        const finish = (ok: boolean): void => {
          try { sock.destroy(); } catch { /* noop */ }
          resolve(ok ? { ok: true } : { ok: false });
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        timer.unref();
        sock.once('connect', () => { clearTimeout(timer); finish(true); });
        sock.once('error', () => { clearTimeout(timer); finish(false); });
      });
    }

    async function checkRtspsReal(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | RtspsFail> {
      // ffprobe with -rtsp_transport tcp -tls_verify 0 per H2C-FIELD-NOTES §Recommendations #2.
      // URL: rtsps://bblp:<CODE>@<IP>:322/streaming/live/1 — confirmed working.
      const url = `rtsps://${BAMBU_USERNAME}:${encodeURIComponent(accessCode)}@${ip}:322/streaming/live/1`;
      return new Promise((resolve) => {
        const proc = spawn('ffprobe', [
          '-hide_banner', '-loglevel', 'error',
          '-rtsp_transport', 'tcp',
          '-tls_verify', '0',
          '-timeout', String(timeoutMs * 1000),   // ffmpeg expects microseconds
          '-i', url,
        ]);
        let stderr = '';
        proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* noop */ }
          resolve({ ok: false, reason: 'TIMEOUT' });
        }, timeoutMs);
        timer.unref();
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) return resolve({ ok: true });
          const lower = stderr.toLowerCase();
          if (lower.includes('401') || lower.includes('unauthorized')) {
            return resolve({ ok: false, reason: 'AUTH' });
          }
          if (lower.includes('connection refused') || lower.includes('econnrefused')) {
            return resolve({ ok: false, reason: 'REFUSED' });
          }
          // Unknown non-zero exit → treat as TIMEOUT/hang class (safer than AUTH)
          resolve({ ok: false, reason: 'TIMEOUT' });
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve({ ok: false, reason: 'TIMEOUT' });
        });
      });
    }

    async function checkMqttReal(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | MqttFail> {
      // Use Node mqtt pkg per H2C-FIELD-NOTES §Recommendations #5 — mosquitto_sub 2.0.21
      // cannot talk to H2C's self-signed cert. rejectUnauthorized: false is mandatory.
      try {
        const client = await mqtt.connectAsync(`mqtts://${ip}:8883`, {
          username: BAMBU_USERNAME,
          password: accessCode,
          rejectUnauthorized: false,
          connectTimeout: timeoutMs,
          reconnectPeriod: 0,   // one-shot probe, no retry storm per PITFALLS §7
        });
        await client.endAsync(true);  // force-close immediately — no subscribe
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
        if (msg.includes('not authorized') || msg.includes('bad user name') || msg.includes('connack')) {
          return { ok: false, reason: 'AUTH' };
        }
        return { ok: false, reason: 'TIMEOUT' };
      }
    }

    export const realDeps: PreflightDeps = {
      checkTcp: checkTcpReal,
      checkRtsps: checkRtspsReal,
      checkMqtt: checkMqttReal,
    };
    ```

    **Part C — create route handler `src/routes/api/onboarding/bambu/preflight/+server.ts`:**

    ```ts
    import { json } from '@sveltejs/kit';
    import type { RequestHandler } from './$types';
    import { runBambuPreflight, realDeps } from '$lib/server/services/bambu-preflight';

    export const POST: RequestHandler = async ({ request }) => {
      const body = await request.json();
      const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
      const serialNumber = typeof body?.serialNumber === 'string' ? body.serialNumber.trim() : '';
      const accessCode = typeof body?.accessCode === 'string' ? body.accessCode.trim() : '';
      if (!ip || !serialNumber || !accessCode) {
        return json(
          { ok: false, error: 'INVALID_INPUT', hint: 'IP, Seriennummer und Access Code sind erforderlich.' },
          { status: 400 },
        );
      }
      try {
        const result = await runBambuPreflight({ ip, serialNumber, accessCode }, realDeps);
        return json(result);
      } catch (err) {
        return json(
          { ok: false, error: 'PRINTER_UNREACHABLE', hint: err instanceof Error ? err.message : 'Unbekannter Fehler' },
          { status: 500 },
        );
      }
    };
    ```

    **Guardrails:**
    - `serialNumber` is validated-present but NOT used by the checks — it's stored in the wizard flow (Plan 04) and exists here for API symmetry + future cert-fingerprint validation.
    - Access Code is URL-encoded when inlined into the RTSPS URL (codes can contain characters that would otherwise break the URL parser).
    - `reconnectPeriod: 0` on the MQTT client is non-negotiable — PITFALLS §7 warns that tight-loop reconnect hammers the printer's shared-CPU MQTT daemon.
    - Checks run **sequentially** via the orchestrator — do NOT parallelize RTSPS+MQTT.
    - Every external subprocess (ffprobe) has a hard `SIGKILL` on timeout.
  </action>
  <verify>
    <automated>npx vitest run src/lib/server/services/bambu-preflight.test.ts &amp;&amp; npm run check &amp;&amp; node -e "require('mqtt')"</automated>
  </verify>
  <done>`mqtt` package installed (only new Phase-11 dep); `bambu-preflight.ts` exports both `runBambuPreflight` and `realDeps`; `/api/onboarding/bambu/preflight/+server.ts` responds 400 on missing fields and returns `runBambuPreflight` output on valid input; `npm run check` passes; unit tests from Task 1 still pass (the appended real deps do not touch the tested orchestrator).</done>
</task>

</tasks>

<verification>
1. Unit tests: `npx vitest run src/lib/server/services/bambu-preflight.test.ts` — six tests, all pass.
2. `npm run check` — no new type errors.
3. `package.json` shows `mqtt` in `dependencies`.
4. Manual smoketest (deferred to Plan 04 UI checkpoint): POST with real H2C + correct code → `{ ok: true }` within ~5s; POST with deliberately wrong code → `{ ok: false, error: 'WRONG_ACCESS_CODE' }`.
5. Code review: grep confirms the checks run sequentially (no `Promise.all` between checkTcp/checkRtsps/checkMqtt in the orchestrator).
</verification>

<success_criteria>
- Error taxonomy exactly matches 11-CONTEXT §3: PRINTER_UNREACHABLE / LAN_MODE_OFF / WRONG_ACCESS_CODE / RTSPS_HANDSHAKE_HUNG
- Every external call (net.connect / ffprobe / mqtt.connectAsync) has a hard timeout and is cleaned up on timeout
- ffprobe is killed with SIGKILL when the timer fires (no orphan processes)
- MQTT uses `mqtt` npm package with `rejectUnauthorized: false` and `reconnectPeriod: 0`
- No shellout to mosquitto_sub anywhere in the codebase (grep must come up empty)
- German-language hints present for all four error codes
- Single new npm dep: `mqtt` (no others)
- Tests do not hit the network
</success_criteria>

<output>
After completion, create `.planning/phases/11-foundation-discovery-credentials-preflight/11-03-SUMMARY.md` capturing:
- Vitest output (6/6)
- `mqtt` package version installed + rationale (link to H2C-FIELD-NOTES.md §Recommendations #5)
- grep confirmation that `mosquitto_sub` appears nowhere in `src/` (`grep -r mosquitto src/ | wc -l` should be 0)
- Any surprises (e.g., ffprobe exit-code taxonomy differing on the App-VM, mqtt@5 API deviations)
- An explicit note that the live against-hardware test belongs to Plan 04's checkpoint and is NOT a gate for this plan
</output>
