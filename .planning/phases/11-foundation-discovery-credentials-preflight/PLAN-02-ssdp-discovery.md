---
phase: 11-foundation-discovery-credentials-preflight
plan: 02
type: execute
wave: 2
depends_on:
  - 01
files_modified:
  - src/lib/server/services/bambu-discovery.ts
  - src/lib/server/services/bambu-discovery.test.ts
  - src/routes/api/discovery/+server.ts
autonomous: true
requirements:
  - BAMBU-03
  - BAMBU-04
  - BAMBU-06
user_setup: []

must_haves:
  truths:
    - "A UDP socket bound to port 2021 listens for Bambu SSDP NOTIFY broadcasts for 6 seconds and returns a de-duplicated device list"
    - "The parser extracts IP, USN (=serial), `DevModel.bambu.com` header, and `DevName.bambu.com` from a NOTIFY packet"
    - "Only packets whose `NT:` matches `urn:bambulab-com:device:3dprinter:1` are accepted"
    - "Only packets whose `DevModel.bambu.com` is in the allowlist (`O1C2`, `H2C`, `H2D`, `X1C`, `P1S`, `A1`) are surfaced"
    - "`/api/discovery` runs the existing HTTP-probe scan AND the SSDP listener in parallel via `Promise.all`, merges results, deduplicates by IP, and annotates Bambu rows with `type: 'bambu'` + `lanModeHint: 'likely_on'` + `serialNumber` + `model` fields"
    - "Unit tests parse the exact NOTIFY payload from H2C-FIELD-NOTES.md §SSDP and assert the parsed fields"
  artifacts:
    - path: "src/lib/server/services/bambu-discovery.ts"
      provides: "discoverBambuDevices() — opens UDP:2021, listens 6s, returns BambuDevice[]. parseNotifyPayload() for unit testing."
      exports: ["discoverBambuDevices", "parseNotifyPayload", "BAMBU_MODEL_ALLOWLIST"]
    - path: "src/lib/server/services/bambu-discovery.test.ts"
      provides: "Pure-parser tests against the H2C-FIELD-NOTES sample payload + a synthetic A1 payload + a rejected non-Bambu NOTIFY"
      contains: "describe"
    - path: "src/routes/api/discovery/+server.ts"
      provides: "Existing scanner + SSDP listener merged via Promise.all; Bambu rows have type='bambu' and lanModeHint"
      contains: "discoverBambuDevices"
  key_links:
    - from: "src/routes/api/discovery/+server.ts"
      to: "src/lib/server/services/bambu-discovery.ts"
      via: "import { discoverBambuDevices }"
      pattern: "from '\\$lib/server/services/bambu-discovery'"
    - from: "bambu-discovery.ts UDP socket"
      to: "LAN broadcast traffic on :2021"
      via: "dgram.createSocket('udp4'), bind(2021), SO_REUSEADDR"
      pattern: "dgram\\.createSocket"
---

<objective>
Add a Bambu SSDP discovery service and merge its output into the existing `/api/discovery` response so Bambu printers surface alongside Mobotix/Loxone/ONVIF cameras in the onboarding scan.

Purpose: Without this plan, BAMBU-03/04/06 cannot ship — the app has no way to see a Bambu printer on the network. The existing HTTP-probe scan in `+server.ts` doesn't find Bambus (they don't serve HTTP on :80) so we add a parallel UDP listener and merge results.

Output:
- `bambu-discovery.ts` service exporting `discoverBambuDevices()` (live UDP listener) and `parseNotifyPayload()` (pure function for testing).
- Unit tests covering the exact H2C payload from the Phase-10 field notes.
- `/api/discovery/+server.ts` augmented to run both scanners in parallel and merge results.
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
@src/routes/api/discovery/+server.ts

<interfaces>
Existing discovery response shape (DiscoveredCamera in +server.ts):
```ts
export interface DiscoveredCamera {
  ip: string;
  type: 'mobotix' | 'mobotix-onvif' | 'loxone' | 'unknown';
  alreadyOnboarded: boolean;
  name: string | null;
}
```
This plan WIDENS the union to include `'bambu'` and adds OPTIONAL fields (`serialNumber?: string`, `model?: string`, `lanModeHint?: 'likely_on'`) — wizard code (Plan 04) reads these when `type === 'bambu'`.

Existing endpoint: `GET /api/discovery?subnet=192.168.3&start=1&end=254` returns `{ cameras: DiscoveredCamera[] }` (or `{ cameras: [], error }`).

Node built-in `dgram` is available; no new npm dependencies.

Cameras table import (already used) — used to mark `alreadyOnboarded`.
</interfaces>

**Ground truth (H2C-FIELD-NOTES.md §SSDP, verbatim citations):**
- Port: "**UDP 2021** (src and dst) … The HTTP `Host:` header advertises `239.255.255.250:1990` but the actual UDP packet flows on **2021**." **Bind UDP 2021, NOT 1990.**
- URN: `urn:bambulab-com:device:3dprinter:1`
- Re-broadcast cadence: `~3–5 seconds between NOTIFYs (3 packets in 10s)` → 6-second listen window captures ≥1 packet per device with margin.
- USN is serial directly, no `uuid:` prefix.
- DevModel for H2C = `O1C2` (NOT "H2C"). Forward-compat allowlist per 11-CONTEXT §2: `O1C2`, `H2C`, `H2D`, `X1C`, `P1S`, `A1`.
- Display label for `O1C2` is `"Bambu Lab H2C"` (map model code → human label).

**Sample H2C NOTIFY payload (from H2C-FIELD-NOTES.md §SSDP — use this as the canonical test fixture):**
```
NOTIFY * HTTP/1.1
Host: 239.255.255.250:1990
Server: UPnP/1.0
Location: 192.168.3.109
NT: urn:bambulab-com:device:3dprinter:1
NTS: ssdp:alive
USN: 31B8BP611201453
Cache-Control: max-age=1800
DevModel.bambu.com: O1C2
DevName.bambu.com: Bob the Builder
DevConnect.bambu.com: cloud
DevBind.bambu.com: occupied
Devseclink.bambu.com: secure
DevInf.bambu.com: wlan0
DevVersion.bambu.com: 01.01.05.00
DevCap.bambu.com: 1
```
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure parser + allowlist + tests</name>
  <files>src/lib/server/services/bambu-discovery.ts (parser + exports only), src/lib/server/services/bambu-discovery.test.ts</files>
  <behavior>
    - `parseNotifyPayload(raw: string, sourceIp: string): BambuDevice | null`:
      - Returns `null` if `NT:` header is missing or ≠ `urn:bambulab-com:device:3dprinter:1`.
      - Returns `null` if `DevModel.bambu.com` is absent OR not in `BAMBU_MODEL_ALLOWLIST`.
      - Returns `{ ip, serialNumber, model, modelLabel, name }` for the H2C sample payload (ip='192.168.3.109', serialNumber='31B8BP611201453', model='O1C2', modelLabel='Bambu Lab H2C', name='Bob the Builder').
    - `BAMBU_MODEL_ALLOWLIST` = `['O1C2', 'H2C', 'H2D', 'X1C', 'P1S', 'A1']`.
    - Unit tests cover: canonical H2C payload parses; a synthetic A1 payload parses (model='A1', label='Bambu Lab A1'); a non-Bambu NOTIFY (different `NT:`) returns null; a Bambu NOTIFY with DevModel='Z9Z9' returns null.
  </behavior>
  <action>
    Create `src/lib/server/services/bambu-discovery.ts` with the parser, types, and allowlist — leave the UDP socket implementation to Task 2.

    Structure:
    ```ts
    export interface BambuDevice {
      ip: string;
      serialNumber: string;
      model: string;            // raw DevModel.bambu.com value (e.g., 'O1C2')
      modelLabel: string;       // human label (e.g., 'Bambu Lab H2C')
      name: string | null;      // DevName.bambu.com (e.g., 'Bob the Builder')
    }

    export const BAMBU_MODEL_ALLOWLIST = ['O1C2', 'H2C', 'H2D', 'X1C', 'P1S', 'A1'] as const;

    // Map DevModel wire code → display label. O1C2 is the H2C's internal code
    // (H2C-FIELD-NOTES.md §Known Issues). Unknown-but-allowlisted codes fall
    // back to "Bambu Lab <code>" so forward-compat devices still show.
    const MODEL_LABELS: Record<string, string> = {
      O1C2: 'Bambu Lab H2C',
      H2C: 'Bambu Lab H2C',
      H2D: 'Bambu Lab H2D',
      X1C: 'Bambu Lab X1C',
      P1S: 'Bambu Lab P1S',
      A1: 'Bambu Lab A1',
    };

    const BAMBU_URN = 'urn:bambulab-com:device:3dprinter:1';

    export function parseNotifyPayload(raw: string, sourceIp: string): BambuDevice | null {
      const headers: Record<string, string> = {};
      for (const line of raw.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (!headers[key]) headers[key] = value; // first wins
      }
      if (headers['nt'] !== BAMBU_URN) return null;
      const model = headers['devmodel.bambu.com'];
      if (!model || !(BAMBU_MODEL_ALLOWLIST as readonly string[]).includes(model)) return null;
      const serialNumber = headers['usn'];
      if (!serialNumber) return null;
      return {
        ip: sourceIp,
        serialNumber,
        model,
        modelLabel: MODEL_LABELS[model] ?? `Bambu Lab ${model}`,
        name: headers['devname.bambu.com'] ?? null,
      };
    }
    ```

    Then create `src/lib/server/services/bambu-discovery.test.ts` with four tests:
    1. **H2C canonical**: paste the exact payload from H2C-FIELD-NOTES.md §SSDP (as a template literal) and assert the full parsed object (ip='192.168.3.109', serialNumber='31B8BP611201453', model='O1C2', modelLabel='Bambu Lab H2C', name='Bob the Builder').
    2. **A1 synthetic**: same payload shape but DevModel=`A1`, USN=`AAAAAAA0000001`, DevName=`TestA1`, called with sourceIp='192.168.3.195' (the A1 observed in the field notes' Bonus capture). Assert model='A1', modelLabel='Bambu Lab A1'.
    3. **Non-Bambu rejected**: a generic UPnP NOTIFY with `NT: urn:schemas-upnp-org:device:MediaServer:1` → returns `null`.
    4. **Unknown model rejected**: a Bambu-URN NOTIFY with `DevModel.bambu.com: Z9Z9` → returns `null`.

    All tests are pure (no sockets, no timers). Use vitest `describe`/`it`/`expect`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/server/services/bambu-discovery.test.ts</automated>
  </verify>
  <done>parseNotifyPayload + BAMBU_MODEL_ALLOWLIST + BambuDevice interface exported; all four unit tests pass; the H2C assertion uses the verbatim payload from H2C-FIELD-NOTES.md §SSDP.</done>
</task>

<task type="auto">
  <name>Task 2: UDP listener + /api/discovery integration</name>
  <files>src/lib/server/services/bambu-discovery.ts (append discoverBambuDevices), src/routes/api/discovery/+server.ts</files>
  <action>
    **Part A — append to `bambu-discovery.ts`:**

    Add the live listener (kept in the same file as the parser so tests can stub by importing from one place):

    ```ts
    import dgram from 'node:dgram';

    export interface DiscoverOptions {
      listenMs?: number;   // default 6000
      port?: number;       // default 2021
    }

    /**
     * Opens a UDP socket on port 2021 (per H2C-FIELD-NOTES.md §SSDP — NOT 1990,
     * the Host: header is misleading) and collects Bambu NOTIFY broadcasts for
     * the listen window. De-duplicates by IP (later packets overwrite earlier).
     * Always resolves; never rejects — errors are logged and produce an empty list.
     */
    export async function discoverBambuDevices(opts: DiscoverOptions = {}): Promise<BambuDevice[]> {
      const listenMs = opts.listenMs ?? 6000;
      const port = opts.port ?? 2021;
      const byIp = new Map<string, BambuDevice>();

      return new Promise((resolve) => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const done = (): void => {
          try { sock.close(); } catch { /* already closed */ }
          resolve([...byIp.values()]);
        };
        sock.on('error', () => done());
        sock.on('message', (msg, rinfo) => {
          const parsed = parseNotifyPayload(msg.toString('utf8'), rinfo.address);
          if (parsed) byIp.set(parsed.ip, parsed);
        });
        sock.bind(port, () => {
          try { sock.setBroadcast(true); } catch { /* non-fatal */ }
        });
        setTimeout(done, listenMs).unref();
      });
    }
    ```

    **Part B — modify `src/routes/api/discovery/+server.ts`:**

    1. Widen the `DiscoveredCamera` interface union to `'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu' | 'unknown'` and add three OPTIONAL fields: `serialNumber?: string; model?: string; lanModeHint?: 'likely_on';`
    2. Import `discoverBambuDevices` from `$lib/server/services/bambu-discovery`.
    3. Inside the `GET` handler, wrap the existing scan (lines ~52-112 of the current file — the bash-script block + the parsing + the name-lookup) into an async IIFE so it can run in parallel with the SSDP listener:
       ```ts
       const [httpScanResult, bambuDevices] = await Promise.all([
         runExistingHttpScan(),             // factored out of current code
         discoverBambuDevices({ listenMs: 6000 }),
       ]);
       ```
       `runExistingHttpScan()` returns the same `DiscoveredCamera[]` the current code already produces (preserve existing behavior bit-for-bit — do NOT rewrite the bash scanner logic, just wrap it).
    4. Map `bambuDevices` → `DiscoveredCamera` rows:
       ```ts
       const bambuRows: DiscoveredCamera[] = bambuDevices.map((d) => ({
         ip: d.ip,
         type: 'bambu',
         alreadyOnboarded: onboarded.has(d.ip),
         name: d.name,
         serialNumber: d.serialNumber,
         model: d.model,
         lanModeHint: 'likely_on',   // SSDP only fires when LAN Mode is on; NOT authoritative
       }));
       ```
    5. Merge: concat `httpScanResult` + `bambuRows`, then de-dupe by IP (prefer the Bambu row when both scanners saw the same IP — the Bambu annotation is strictly more informative). Keep the existing ascending-by-last-octet sort.
    6. Do NOT remove or rewrite the existing Mobotix/Loxone/ONVIF logic. Do NOT remove the saved-credentials name-lookup block. Leave the `catch` → `{ cameras: [], error }` shape intact.

    **Guardrails:**
    - No new npm deps — `dgram` is Node built-in.
    - All external process calls keep their existing `timeout: 60000` / `--max-time 1` safeguards.
    - The SSDP listener MUST not throw into the handler — it only resolves (empty list on error). The existing HTTP scan staying intact is more important than perfect Bambu discovery.
    - If UDP bind(2021) fails (EADDRINUSE — something else bound it on the App-VM), log and return empty. The SSDP device-list gap is recoverable via Manual Add (Plan 04).
  </action>
  <verify>
    <automated>npx vitest run src/lib/server/services/bambu-discovery.test.ts &amp;&amp; npm run check</automated>
  </verify>
  <done>discoverBambuDevices exported and implemented; `/api/discovery` GET handler runs the existing HTTP scan and the SSDP listener via Promise.all, merges + de-dupes by IP, and annotates Bambu rows with type/serialNumber/model/lanModeHint; `npm run check` passes; no new npm dependencies; Mobotix/Loxone rows in the response are byte-identical to pre-change behavior when the subnet has no Bambu devices.</done>
</task>

</tasks>

<verification>
1. Unit tests (`npx vitest run src/lib/server/services/bambu-discovery.test.ts`) — four cases, all pass.
2. `npm run check` — no new type errors.
3. Manual smoketest (deferred to execute-phase, not a gate here): `curl http://localhost:5173/api/discovery?subnet=192.168.3` on the App-VM returns a response that includes the user's H2C at 192.168.3.109 with type='bambu' within ~7 seconds.
4. `/api/discovery` with no Bambu device on the subnet returns within 6-7s (SSDP listen window) and still surfaces Mobotix/Loxone results (the SSDP listener doesn't starve the HTTP scan because they run in parallel).
</verification>

<success_criteria>
- `bambu-discovery.ts` exports `discoverBambuDevices`, `parseNotifyPayload`, `BAMBU_MODEL_ALLOWLIST`, `BambuDevice`
- Parser tests cover H2C canonical, A1 synthetic, non-Bambu rejection, unknown-model rejection — all pass
- `/api/discovery` augmented with parallel SSDP listener; response shape extended with optional Bambu fields
- Existing Mobotix/Loxone/ONVIF discovery behavior unchanged when no Bambu device is present
- Listener binds UDP port **2021** (not 1990 — cite H2C-FIELD-NOTES.md §SSDP)
- No new npm dependencies
</success_criteria>

<output>
After completion, create `.planning/phases/11-foundation-discovery-credentials-preflight/11-02-SUMMARY.md` capturing:
- Parser tests + vitest output
- The exact diff applied to `/api/discovery/+server.ts` (which block moved into `runExistingHttpScan`, which merge logic was added)
- Any surprises (e.g., `setBroadcast(true)` failing on a particular kernel, `reuseAddr` needed in dev, timing of first packet seen in a live run)
- Confirmation that Mobotix/Loxone paths still work: either a captured response from the App-VM or a `npm run check` line
</output>
