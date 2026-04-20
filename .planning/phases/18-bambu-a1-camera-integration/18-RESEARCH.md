# Phase 18: Bambu Lab A1 Camera Integration — Research

**Researched:** 2026-04-20
**Domain:** go2rtc `exec:` source + ffmpeg MJPEG stdin + TLS/JPEG ingestion + SvelteKit/LXC service deployment
**Confidence:** HIGH (every load-bearing claim verified against either the live-hardware spikes 001–004 or a canonical external reference: synman/bambu-go2rtc, go2rtc.org/internal/exec, ha-bambulab pybambu, UniFi Protect docs)

## Summary

Phase 18 is a targeted add-on to the existing H2C branch — not a parallel rewrite. The spikes already nailed every hardware-side unknown (TLS handshake on :6000, 80-byte auth packet, 16-byte frame header, 1536×1080 / ~0.45 fps idle). What remained for this research was the **ingestion topology**: how exactly go2rtc consumes the JPEG stream, how ffmpeg packages it into RTSP for Protect, and how the Node-script side of `exec:` behaves under the adaptive stop/start cycle.

All three answers line up cleanly:

1. **go2rtc's `exec:` + pipe transport auto-detects MJPEG** by reading the first bytes of stdout (`magic.Open()`). Raw concatenated JPEGs — each self-delimited by `FF D8` … `FF D9`, no boundaries, no `Content-Type` headers — are the canonical format. This is empirically proven by the `synman/bambu-go2rtc` project, which streams Bambu X1/P1 cameras into go2rtc with exactly this shape.
2. **ffmpeg `-f mjpeg -i -` ingests raw concatenated JPEGs** directly. Variable fps is handled by *dropping* input framerate flags entirely and letting wallclock timestamps drive the H.264 output, optionally with `-vsync cfr -r 5` as a last-resort frame-padding option for Protect-slideshow mitigation.
3. **The Node script is deployed into the LXC identically to existing go2rtc/nginx configs** (`pushFileToContainer` + systemd optional; `exec:` spawns it directly). Only Node stdlib (`tls`, `fs`) is needed — no `pnpm install` in the container.

**Primary recommendation:** Implement the A1 ingestion as a ~150-LOC Node script deployed to `/opt/ipcm/bambu-a1-camera.mjs` inside the LXC, referenced from the generated go2rtc.yaml via `exec:node /opt/ipcm/bambu-a1-camera.mjs --ip=... --access-code=...#killsignal=15#killtimeout=5`. Emit raw concatenated JPEGs on stdout. Handle `SIGTERM` by calling `socket.end()` + `process.exit(0)` so the adaptive mode's go2rtc-stop doesn't leave the printer holding a stale TLS session.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stream Ingestion Pipeline**
- **D-01 (Topology):** go2rtc `exec:` source spawns an A1 ingestion Node script. The script reads the printer's port-6000 JPEG stream and emits raw concatenated JPEGs (each self-delimited with `FF D8`…`FF D9`) on stdout. go2rtc wraps this as MJPEG and re-exposes as RTSP on the existing :8554 (same pattern as Loxone nginx integration, `generateLoxoneGo2rtcYaml` in `src/lib/server/services/go2rtc.ts:111-127`).
- **D-02 (Runtime):** The Node ingestion script is deployed into the per-camera LXC container alongside go2rtc, following the one-container-per-camera rule. Deployment reuses the SSH-based config deploy pattern already used for Mobotix/Loxone (`src/lib/server/services/ssh.ts` + `executeOnContainer`). The script is a small Node single-file (~150 LOC, based on spike 004) that requires only `node` in the container.

**Idle UX / Adaptive Stream Mode**
- **D-03 (Protect stream at idle):** Phase 14 Adaptive Stream Mode applies to A1 identically to H2C. When `print.gcode_state` is in `IDLE_STATES` (`IDLE`, `FINISH`, `FAILED`), go2rtc is stopped via `toggleGo2rtc(vmid, 'stop')` (`bambu-mqtt.ts:43-50`); UniFi Protect shows the existing "offline" badge. During `LIVE_STATES` (`RUNNING`, `PREPARE`, `PAUSE`), go2rtc runs and A1 streams at its native rate (~0.45 fps at idle; expected higher during active print).
- **D-04 (Dashboard preview at idle):** Camera detail page exposes a server-side endpoint `GET /api/cameras/:id/a1-snapshot` that performs a single on-demand TLS + auth + first-frame pull from port 6000, returns the JPEG. Label: "Letztes Bild: vor Xs". No continuous LAN traffic when idle.

**Cloud-Mode Guard (TUTK)**
- **D-05 (Preflight guard):** Hard preflight check reads `print.ipcam.tutk_server` from the pushall MQTT response. If value is `"enable"`, preflight fails with a new error `A1_CLOUD_MODE_ACTIVE` and a German-language hint. Error enum extends `PreflightError` in `src/lib/server/services/bambu-preflight.ts:15`. Hint goes into `PREFLIGHT_HINTS_DE` (same file, :25).
- **D-06 (Runtime watch):** `bambu-mqtt.ts` monitors `ipcam.tutk_server` in the delta stream. Transition `disable → enable` sets `sub.lastError = 'A1_CLOUD_MODE_ACTIVE'` (add to `BambuConnectionError` enum at :25-29). Transition back to `disable` auto-clears the error.

**UI Model Gating**
- **D-07 (Central capabilities map):** `PRINTER_CAPABILITIES` export added to `src/lib/server/services/bambu-discovery.ts` next to `MODEL_LABELS`. Shape per D-07 in CONTEXT.md. Frontend components check `camera.capabilities.chamberHeater` / `.ams !== 'none'` / `.xcamFeatures.includes(...)` instead of hardcoded model checks.
- **D-08 (Auth-packet regression test):** Vitest unit test in `src/lib/server/services/bambu-a1-camera.test.ts` asserts `buildAuth('bblp', '20633520')` returns a `Buffer` byte-equal to the 80-byte layout. Plus golden fixture `src/lib/server/services/__fixtures__/a1-auth-packet.bin` (80 bytes) committed for visual review.

### Claude's Discretion
- Exact preflight structure: pass `model` into `runBambuPreflight()` vs. branch internally via SSDP-captured model at call site.
- Snapshot endpoint rate limiting/caching: simple 2-second server-side cache is probably enough.
- Node script deployment mechanics: use the exact same SSH-based deploy pattern the Mobotix/Loxone configs use.
- Error-hint German wording polish.
- `A1_CLOUD_MODE_ACTIVE` vs `CLOUD_MODE_ACTIVE` naming: rename to model-agnostic if P1P/A1-mini show same TUTK behavior.

### Deferred Ideas (OUT OF SCOPE)
- FPS during active print (follow-up UAT).
- Support for A1 mini / P1P (not validated on this phase).
- FTPS:990 SD-card access on A1.
- Peer cert CN-pinning.
- Full snapshot mode (no LXC).
- Renaming `A1_CLOUD_MODE_ACTIVE` to model-agnostic.
</user_constraints>

<phase_requirements>
## Phase Requirements

> Coined in this research pass; planner merges these into REQUIREMENTS.md (`BAMBU-A1-*` prefix).

| ID | Description | Research Support |
|----|-------------|------------------|
| BAMBU-A1-01 | Discovery labels A1 correctly via existing SSDP allowlist | No new research — `BAMBU_MODEL_ALLOWLIST`/`MODEL_LABELS` already cover A1 (`bambu-discovery.ts:27,38`). Verify in unit test only. |
| BAMBU-A1-02 | Persisted `cameras.model` column added; populated from SSDP on adoption; used downstream for preflight split and capability gating | §"Schema Gap" (this doc) — model currently not persisted on `cameras` table; planner must add column + migration. |
| BAMBU-A1-03 | `PRINTER_CAPABILITIES` map exported from `bambu-discovery.ts`; API responses include `capabilities` for Bambu cameras | D-07 locked; shape documented in CONTEXT.md. |
| BAMBU-A1-04 | Model-aware preflight: for A1, skip RTSPS:322, run TCP:6000 + TLS-auth probe + MQTT TUTK check | Gap #5 (this doc); §Preflight sequencing shows the new check topology. |
| BAMBU-A1-05 | New preflight error `A1_CLOUD_MODE_ACTIVE` + German hint fires when `print.ipcam.tutk_server == "enable"` | D-05 locked; spike 003 confirmed field path. |
| BAMBU-A1-06 | Runtime watch: `bambu-mqtt.ts` transitions `BambuConnectionError` on `ipcam.tutk_server` edge changes | D-06 locked; Gap #6 (this doc) shows integration point at `:104-136`. |
| BAMBU-A1-07 | Auth-packet byte builder + golden fixture + Vitest regression | D-08 locked; Gap #8 (this doc) provides hex fixture. |
| BAMBU-A1-08 | A1-specific go2rtc yaml generator: `generateBambuA1Go2rtcYaml(params)` emits `streams: { <name>: [exec:node /opt/ipcm/bambu-a1-camera.mjs ...#killsignal=15...] }` | Gap #1 + #4 (this doc) — format proven by `synman/bambu-go2rtc`. |
| BAMBU-A1-09 | Ingestion Node script deployed to `/opt/ipcm/bambu-a1-camera.mjs` via `pushFileToContainer`; uses only Node stdlib; handles SIGTERM | Gap #3 + #4 (this doc). |
| BAMBU-A1-10 | Snapshot endpoint `GET /api/cameras/:id/a1-snapshot` returns JPEG; 2s in-memory cache; requires auth cookie | D-04 locked; Gap #10 (this doc) covers security. |
| BAMBU-A1-11 | UI gates `chamber_temper`, AMS panel, xcam features via `camera.capabilities` | D-07 locked. |
| BAMBU-A1-12 | End-to-end A1 onboarding through existing wizard → preflight → provision → adoption | Wires everything above together. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SSDP discovery + model identification | SvelteKit Server (Node) | — | UDP listen needs Node bind(); already implemented for H2C. |
| A1 preflight (TCP + TLS-auth + MQTT) | SvelteKit Server (Node) | — | Parallels existing `bambu-preflight.ts`; runs in app VM, not LXC. |
| Auth-packet build | Shared library (`bambu-a1-auth.ts`) | Consumed by preflight + Node script | Must be testable via Vitest (D-08); pure function, no I/O. |
| TLS+JPEG ingestion (`:6000 → stdout`) | LXC Node script (spawned by go2rtc `exec:`) | — | Must live next to go2rtc in the LXC so it can be restarted independently of the app VM. |
| MJPEG → RTSP packaging | go2rtc (LXC) | ffmpeg (LXC) | go2rtc's internal MJPEG producer handles this; no custom ffmpeg invocation needed. |
| UniFi Protect adoption | UniFi Protect (external) | Reads RTSP from LXC :8554 | Unchanged from H2C branch. |
| Adaptive go2rtc start/stop | SvelteKit Server (Node) | MQTT subscriber in server process | Already implemented in `bambu-mqtt.ts` — works unchanged for A1 (D-03). |
| TUTK runtime watch | SvelteKit Server (Node) | Extends existing MQTT subscriber | D-06 locked, integrates at `bambu-mqtt.ts:104-136`. |
| Snapshot endpoint | SvelteKit Server route | Uses shared TLS+auth lib | Server-side so camera creds never hit the browser; 2s cache is app-local. |
| UI capability gating | Svelte component | Consumes `camera.capabilities` from API | D-07 locked; pure frontend. |

## Standard Stack

### Core (already in `package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mqtt` | 5.15.1 | MQTT subscriber for control+telemetry | Already used for H2C; A1 verified byte-compatible (spike 003). [VERIFIED: package.json:42] |
| `node-ssh` | 13.2.1 | SSH bridge to Proxmox host for `pct exec` | Already used for LXC deployment. [VERIFIED: package.json:43] |
| `better-sqlite3` | 12.6.2 | Persistence for cameras/settings | Already used. [VERIFIED: package.json:38] |
| `drizzle-orm` | 0.45.1 | ORM for the new `model` column migration | Already used; Drizzle-kit migration for schema extension. [VERIFIED: package.json:29] |
| `vitest` | 4.1.0 | Unit tests for auth-packet fixture | Already used. [VERIFIED: package.json:35] |
| Node.js `tls`, `fs`, `process`, `os` | stdlib | TLS connect to :6000, frame parse, stdout write, SIGTERM handler | **No new runtime dependency.** Stdlib-only keeps the LXC install small and auditable. [VERIFIED: spike 004 probe.mjs uses only `node:tls` + `node:fs`] |

### Supporting (already present in LXC via `getInstallCommands()`)

| Binary | Version | Purpose | When to Use |
|--------|---------|---------|-------------|
| `go2rtc` | latest | MJPEG → RTSP packager + RTSP server on :8554 | Already installed by `getInstallCommands()` at `go2rtc.ts:93-100`. [VERIFIED] |
| `ffmpeg` | 6.x (Debian 13) | Optional re-encode (only if MJPEG passthrough unhappy in Protect) | Already installed. [VERIFIED: go2rtc.ts:96] |
| `node` | 22.x | Runs the A1 ingestion script inside LXC | **NOT currently installed in the base camera template** — the ONVIF LXC install command at `go2rtc.ts:211-213` installs Node but only in the ONVIF container. **Planner action:** either extend `getInstallCommands()` to include Node, or reuse the ONVIF container's Node runtime (same container, so it's already there once ONVIF is installed; Phase 12+ flow installs ONVIF in every camera LXC). [VERIFIED: go2rtc.ts:211-213] |

### No New npm Dependencies

This phase adds zero runtime npm deps. Every new file uses only:
- Existing project deps (`mqtt`, `drizzle-orm`, `better-sqlite3`, `node-ssh`)
- Node stdlib (`tls`, `fs`, `crypto`, `child_process`)
- Existing binaries inside the LXC (`go2rtc`, `ffmpeg`, `node`)

### Version verification
```bash
npm view mqtt version            # already verified 5.15.1 in package.json
node -v                           # LXCs run Debian-default Node once ONVIF is installed
go2rtc -version                   # currently pinned via getInstallCommands() → "latest" on GitHub releases
```

**Caveat on go2rtc "latest":** the current install command at `go2rtc.ts:97` pulls the absolute latest release. For the `exec:` pipe transport we rely on v1.5.0+ features (MJPEG auto-detection via `magic.Open()`). Any `latest` from 2024 onward is fine. [VERIFIED: go2rtc v1.5.0 release notes — "exec: pipe transport added"]

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────┐       SSDP:2021        ┌──────────────────────┐
│  Bambu Lab A1    │ ─────(NOTIFY)────────▶ │ SvelteKit App (VM)   │
│  (192.168.3.195) │                         │ - bambu-discovery.ts │
└──────────────────┘                         │ - bambu-preflight.ts │
       │   ▲                                 │ - bambu-mqtt.ts      │
       │   │ MQTT:8883 (telemetry +         │ - /a1-snapshot route │
       │   │ TUTK runtime watch)            └──────────┬───────────┘
       │   │                                            │ SSH/pct
       │   └──── print.gcode_state                     │ (provisioning + adaptive toggle)
       │        print.ipcam.tutk_server                 ▼
       │                                     ┌──────────────────────┐
       │  TLS:6000 ◀──(JPEG stream)────────  │  Per-camera LXC      │
       │  (80-byte auth →                    │  ┌────────────────┐  │
       │   16-byte header +                  │  │ bambu-a1-      │  │
       │   JPEG payload × N)                 │  │ camera.mjsm     │  │
       │                                     │  │  (spawned by    │  │
       │                                     │  │   go2rtc exec:) │  │
       │                                     │  └───────┬─────────┘  │
       │                                     │          │ stdout     │
       │                                     │          │ (raw       │
       │                                     │          │  JPEG × N) │
       │                                     │          ▼            │
       │                                     │  ┌────────────────┐  │
       │                                     │  │ go2rtc         │  │
       │                                     │  │  - MJPEG magic │  │
       │                                     │  │    detection   │  │
       │                                     │  │  - RTSP server │  │
       │                                     │  │    on :8554    │  │
       │                                     │  └───────┬────────┘  │
       │                                     │          │            │
       │                                     │  ┌───────▼────────┐  │
       │                                     │  │ ONVIF server   │  │
       │                                     │  │  (reused from  │  │
       │                                     │  │   existing LXC)│  │
       │                                     │  └───────┬────────┘  │
       │                                     └──────────┼───────────┘
       │                                                │
       │                                                ▼
       │                                     ┌──────────────────────┐
       └──────────(TUTK OFF = LAN-only)────▶ │   UniFi Protect       │
                                             │   (adopts via ONVIF   │
                                             │    discovery)         │
                                             └──────────────────────┘
```

**Key flow:** SSDP discovers A1 → wizard captures credentials → preflight runs TCP:6000 + MQTT(+TUTK) checks → LXC provisioned → ingestion Node script deployed → go2rtc spawns it via `exec:` → MJPEG → RTSP :8554 → ONVIF advertises → Protect adopts. Adaptive mode (MQTT `gcode_state`) toggles go2rtc start/stop, which SIGTERMs the Node script cleanly.

### Recommended Project Structure

```
src/lib/server/services/
├── bambu-discovery.ts          # + PRINTER_CAPABILITIES export (D-07)
├── bambu-mqtt.ts               # + tutk_server watch (D-06), + A1_CLOUD_MODE_ACTIVE
├── bambu-preflight.ts          # + model-split branch, + A1_CLOUD_MODE_ACTIVE, + checkTls6000Real
├── bambu-a1-auth.ts            # NEW: pure buildAuth(username, accessCode) → 80-byte Buffer
├── bambu-a1-camera.ts          # NEW: server-side helper that drives the preflight TLS check + snapshot endpoint
├── go2rtc.ts                   # + generateBambuA1Go2rtcYaml() next to existing Bambu variant
├── onboarding.ts               # + A1 branch in configureGo2rtc() that deploys the Node script
└── __fixtures__/
    └── a1-auth-packet.bin      # NEW: 80-byte golden fixture (D-08)

lxc-assets/                       # NEW directory: files deployed into LXC verbatim
└── bambu-a1-camera.mjs          # The ~150-LOC Node script, spawned by go2rtc exec:

src/routes/api/cameras/[id]/
└── a1-snapshot/
    └── +server.ts               # NEW: GET endpoint (D-04)

src/lib/server/db/
└── schema.ts                    # + model column on cameras (BAMBU-A1-02)
```

### Pattern 1: `exec:` source with raw concatenated JPEGs

**What:** go2rtc spawns a child process and reads its stdout. The first bytes determine format detection via `magic.Open()`. Raw JPEGs starting `FF D8` and ending `FF D9`, concatenated back-to-back with no boundaries, is the canonical MJPEG-on-pipe format.

**When to use:** Ingesting any proprietary JPEG-over-X stream into go2rtc without writing a go2rtc producer plugin.

**Example:**

```yaml
# Source: synman/bambu-go2rtc/go2rtc.yaml (verified via raw.githubusercontent.com)
streams:
  bambu_camera: "exec:./camera-stream.py"
```

The `camera-stream.py` script does exactly what our Node script will do:

```python
# Source: synman/bambu-go2rtc/camera-stream.py
# (verified via WebFetch 2026-04-20)
os.write(1, img)   # img is a complete JPEG (FF D8 ... FF D9)
# NO boundary, NO Content-Type, NO Content-Length — just raw JPEGs.
```

For our build, with Node + SIGTERM handling + kill params:

```yaml
streams:
  {streamName}: exec:node /opt/ipcm/bambu-a1-camera.mjs --ip={printerIp} --access-code={accessCode}#killsignal=15#killtimeout=5
rtsp:
  listen: ":8554"
  username: {rtspAuth.username}
  password: {rtspAuth.password}
log:
  level: info
```

**Flags explained:**
- `#killsignal=15` — send SIGTERM (not the 2025-era SIGKILL default per PR #1246; we want graceful shutdown)
- `#killtimeout=5` — if script doesn't exit in 5s, force SIGKILL

**Sources:**
- [go2rtc exec docs](https://go2rtc.org/internal/exec/) — "pipe reads data from app stdout in different formats: MJPEG, H.264/H.265 bitstream, MPEG-TS" [CITED]
- [go2rtc DeepWiki — exec format detection](https://deepwiki.com/AlexxIT/go2rtc/3.1-ffmpeg-and-exec-sources) — `magic.Open(rd)` auto-detects container format [CITED]
- [synman/bambu-go2rtc](https://github.com/synman/bambu-go2rtc) — working precedent for Bambu+go2rtc exec: with raw JPEG stdout [VERIFIED: raw file contents fetched]
- [go2rtc v1.5.0 release notes](https://github.com/AlexxIT/Blog/issues/11) — pipe transport introduced [CITED]

### Pattern 2: Model-aware preflight split

**What:** Accept the printer model as input to `runBambuPreflight()`. Branch the check sequence per model family.

**When to use:** Whenever different printer models expose different ports/protocols (A1 has no :322, H2C has no :6000).

**Example:**

```typescript
// Source: this research doc
export async function runBambuPreflight(
  input: PreflightInput,
  deps: PreflightDeps,
  model: string   // NEW PARAM — 'O1C2' | 'H2C' | 'H2D' | 'X1C' | 'P1S' | 'A1'
): Promise<PreflightResult> {
  const caps = PRINTER_CAPABILITIES[model] ?? DEFAULT_H2C_CAPABILITIES;

  // Phase 1: TCP reachability — MQTT port is universal
  const tcpMqtt = await deps.checkTcp(input.ip, 8883, 3000);
  if (!tcpMqtt.ok) return fail('PRINTER_UNREACHABLE');

  // Phase 2: Camera-transport-specific probe
  if (caps.cameraTransport === 'rtsps-322') {
    const tcp322 = await deps.checkTcp(input.ip, 322, 3000);
    if (!tcp322.ok) {
      if (tcp322.reason === 'REFUSED') return fail('LAN_MODE_OFF');
      return fail('PRINTER_UNREACHABLE');
    }
    const rtsps = await deps.checkRtsps(input.ip, input.accessCode, 12000);
    if (!rtsps.ok) { /* existing H2C classifier */ }
  } else if (caps.cameraTransport === 'jpeg-tls-6000') {
    const tls6000 = await deps.checkTls6000(input.ip, input.accessCode, 8000);
    if (!tls6000.ok) {
      if (tls6000.reason === 'REFUSED') return fail('PRINTER_UNREACHABLE');
      if (tls6000.reason === 'AUTH_SILENT_DROP') return fail('WRONG_ACCESS_CODE');
      return fail('PRINTER_UNREACHABLE');
    }
  }

  // Phase 3: MQTT auth + TUTK pre-check
  const mqtt = await deps.checkMqtt(input.ip, input.accessCode, 5000);
  if (!mqtt.ok) return mqtt.reason === 'AUTH' ? fail('WRONG_ACCESS_CODE') : fail('LAN_MODE_OFF');

  // Phase 4 (A1 only): one-shot pushall, read ipcam.tutk_server
  if (caps.cameraTransport === 'jpeg-tls-6000') {
    const tutk = await deps.checkTutkDisabled(input.ip, input.accessCode, input.serialNumber, 5000);
    if (!tutk.ok) return fail('A1_CLOUD_MODE_ACTIVE');
  }

  return { ok: true };
}
```

**Budget:** total 8000 + 5000 + 5000 = 18s worst case. Under the 15s target in the CONTEXT.md "remaining HOW gaps" if we keep the TLS probe budget at 6000ms (see §Gap 5). With the `checkTls6000` at 6000ms, total is 3000 (TCP MQTT) + 6000 (TLS6000) + 5000 (MQTT) + 5000 (TUTK) = **19s worst-case**. Recommend parallelizing steps 3 and 4 via `Promise.all()` since both hit MQTT:8883 with the same auth — saves 5s.

### Pattern 3: Node script deployment via `pushFileToContainer`

**What:** Ship the A1 ingestion script as a static .mjs file in the repo (`lxc-assets/bambu-a1-camera.mjs`), read it into memory during `configureGo2rtc()`, push to the LXC via the existing `pushFileToContainer()` helper at `ssh.ts:53-69`, then reference it from go2rtc yaml.

**When to use:** For any .mjs/.py/.sh asset that must live inside the LXC next to go2rtc.

**Example:**

```typescript
// Source: this research doc — follows nginx deploy at onboarding.ts:300-302
import { readFileSync } from 'node:fs';

// Inside configureGo2rtc() for cameraType === 'bambu' && model === 'A1':
const scriptPath = import.meta.resolve('../../../lxc-assets/bambu-a1-camera.mjs');
const scriptContent = readFileSync(new URL(scriptPath), 'utf8');
await pushFileToContainer(ssh, camera.vmid, scriptContent, '/opt/ipcm/bambu-a1-camera.mjs');
await executeOnContainer(ssh, camera.vmid, 'chmod +x /opt/ipcm/bambu-a1-camera.mjs && mkdir -p /opt/ipcm');
// Then push go2rtc.yaml that references /opt/ipcm/bambu-a1-camera.mjs via exec:
```

### Anti-Patterns to Avoid

- **Do NOT use `multipart/x-mixed-replace` headers in the ingestion script.** go2rtc's `magic.Open()` detects raw MJPEG from the first two bytes (`FF D8`); adding headers breaks the detection path. The `synman/bambu-go2rtc` author had the header code present but commented out — confirming this is the wrong path. [VERIFIED: WebFetch of camera-stream.py]
- **Do NOT spawn the Node script as a standalone systemd service.** That fights go2rtc's exec: lifecycle — both would try to hold the TLS connection. Let go2rtc own the child process via `exec:`; it starts on `systemctl start go2rtc` and stops cleanly on `systemctl stop go2rtc` (which is what D-03 adaptive mode triggers).
- **Do NOT hand-roll MJPEG-to-RTSP muxing.** go2rtc does this internally with zero config — that's the entire point of using it.
- **Do NOT persist the access code as a CLI arg that shows in `ps`.** Pass it via an env var to the child: `exec:env A1_ACCESS_CODE={accessCode} node /opt/ipcm/bambu-a1-camera.mjs --ip={printerIp}`. Otherwise `ps ax` on the LXC leaks creds.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MJPEG → RTSP packaging | Custom ffmpeg pipeline | go2rtc's built-in MJPEG producer | go2rtc handles MJPEG magic detection, RTSP server, multi-consumer fanout. `synman/bambu-go2rtc` proves this works for Bambu cameras. |
| JPEG frame boundary parsing | Scan every byte for `FF D8 ... FF D9` | Use the 16-byte header's `size` field — it tells you exactly how many bytes the payload is | Spike 004 already proved this pattern works (probe.mjs:103-113). Scanning for markers is slower and more error-prone. |
| SIGTERM-safe TLS close | Manual socket tracking | Node's built-in `process.on('SIGTERM', () => socket.end())` | Stdlib handles the graceful close; no library needed. |
| Auth packet byte layout | Reinvent encoding from first principles | Reference ha-bambulab `pybambu/bambu_client.py` `ChamberImageThread.run()` + spike 004 §2 byte dump | Already decoded; just mirror. |
| Per-camera LXC provisioning | Write new orchestration | `createCameraContainer()` + `configureGo2rtc()` at `onboarding.ts:311` | Already works for Mobotix/Loxone/H2C. Only `yamlContent` branch changes. |
| Snapshot caching | Redis, in-process LRU lib | `Map<cameraId, {buf, expiresAt}>` in module scope | 2s TTL, one entry per camera — keep it trivial. |

**Key insight:** The only truly new code in this phase is the ~150-LOC ingestion script (spike 004 already wrote 130 LOC of it) plus a ~40-LOC yaml generator. Everything else is parameterization of existing services.

## Runtime State Inventory

Phase 18 is additive, not a rename/refactor. Listed here for completeness:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `cameras.cameraType` already has `'bambu'` value. New `cameras.model` column needed. | Drizzle migration; backfill model from SSDP on next discovery cycle for existing bambu rows. |
| Live service config | go2rtc.yaml + new bambu-a1-camera.mjs file must be deployed into each A1 LXC. | `configureGo2rtc()` branches on model === 'A1'. |
| OS-registered state | systemd `go2rtc.service` unit already exists in every camera LXC (`generateSystemdUnit()`). No new service. | None. |
| Secrets/env vars | A1 access code reused from existing `cameras.accessCode` (encrypted). Passed via env var to Node script in LXC. | None — reuses existing `bambu-credentials.ts` / `decrypt()` path. |
| Build artifacts | `lxc-assets/bambu-a1-camera.mjs` — static file shipped with the repo, read via `fs.readFileSync()`. | Add new file to repo; no npm build step needed (it's `.mjs` stdlib). |

## Gap-by-Gap Answers

### Gap #1 — go2rtc `exec:` source JPEG format expectations

**Answer (HIGH confidence):** go2rtc's `exec:` source with pipe transport expects **raw concatenated JPEGs** on stdout. Each JPEG starts with `FF D8` (SOI) and ends with `FF D9` (EOI). No boundaries, no `Content-Type: multipart/x-mixed-replace` headers, no `Content-Length` headers between frames. go2rtc's internal `magic.Open(rd)` reads the first bytes from the pipe, sees `FF D8`, and binds the pipe to its MJPEG producer.

**Evidence:**
- [go2rtc.org/internal/exec](https://go2rtc.org/internal/exec/) — "pipe reads data from app stdout in different formats: MJPEG, H.264/H.265 bitstream, MPEG-TS" [CITED]
- [AlexxIT/go2rtc `internal/exec/exec.go`](https://github.com/AlexxIT/go2rtc/blob/master/internal/exec/exec.go) — format detection is delegated to `magic.Open(rd)` [VERIFIED via WebFetch]
- [synman/bambu-go2rtc `camera-stream.py`](https://github.com/synman/bambu-go2rtc) — the canonical community implementation for Bambu+go2rtc writes `os.write(1, img)` with raw JPEG bytes, no headers (commented-out multipart code confirms this was the wrong path). `go2rtc.yaml` is literally `streams: { bambu_camera: "exec:./camera-stream.py" }`. [VERIFIED via WebFetch of raw file]

**YAML snippet our generator should produce:**

```yaml
streams:
  bambu_a1_192_168_3_195:
    - exec:env A1_ACCESS_CODE=abc12345 node /opt/ipcm/bambu-a1-camera.mjs --ip=192.168.3.195#killsignal=15#killtimeout=5

rtsp:
  listen: ":8554"
  username: 'bambu'
  password: 'abc12345'

log:
  level: info
```

**Recommendation:** In `generateBambuA1Go2rtcYaml()`, emit this shape. The access-code-as-password on the `rtsp:` block matches the Phase 17 Bambu RTSP-auth convention already established (H2C uses serialNumber/accessCode for Protect adoption — see `onboarding.ts:327`).

### Gap #2 — ffmpeg MJPEG input behavior

**Answer (MEDIUM-HIGH confidence):** We likely do **not need ffmpeg at all** for the A1 path, because go2rtc packages MJPEG natively as RTSP without an ffmpeg hop. If Protect rejects the stream in testing and we need an ffmpeg bridge, here's what the flags look like:

#### Case A: go2rtc native MJPEG → RTSP (RECOMMENDED — try this first)

```yaml
streams:
  bambu_a1:
    - exec:node /opt/ipcm/bambu-a1-camera.mjs ...#killsignal=15#killtimeout=5
```

go2rtc wraps the raw JPEG stream as MJPEG, serves it on :8554/bambu_a1. ONVIF picks it up. Protect adopts.

#### Case B: ffmpeg transcode fallback (only if Protect rejects MJPEG)

```yaml
streams:
  bambu_a1:
    - ffmpeg:exec:node /opt/ipcm/bambu-a1-camera.mjs ...#video=h264#hardware=vaapi#raw=-use_wallclock_as_timestamps 1#raw=-fflags +genpts
```

Key flags:
- **`-f mjpeg -i -`**: ffmpeg's MJPEG demuxer accepts raw concatenated JPEGs on stdin. Verified via [ffmpeg-formats docs](https://ffmpeg.org/ffmpeg-formats.html).
- **`-use_wallclock_as_timestamps 1`**: Critical for variable-fps MJPEG. Raw MJPEG carries no timestamps; ffmpeg defaults to 25 fps which breaks synchronization at 0.45 fps. Wallclock timestamps let ffmpeg mark each frame with the actual arrival time. [CITED: ffmpeg-devel mailing list, ffmpeg docs]
- **`-fflags +genpts`**: Regenerates PTS for the H.264 output from the wallclock input timestamps.
- **NO `-r` / `-framerate` on input**: Specifying an input framerate against a variable-fps MJPEG source causes "wrong framerate during concatenation" and "Frigate issue #1725" — documented pitfall. [CITED]
- **`-g 1`** (set on H.264 output): since A1 delivers ≤2 fps, every frame should be a keyframe so Protect doesn't wait for GOP boundaries.

**UniFi Protect tolerance of variable fps:** Documentation is weak here (see Gap #7). Scrypted recommends keyframe interval = 4 × fps. At 0.45 fps that's keyframe every ~9 seconds with GOP=4, but safer to force every frame to be a keyframe (`-g 1`) for streams < 2 fps.

**Recommendation:** Start with Case A (go2rtc native). If Protect's adoption dialog times out or shows "stream format unsupported," switch to Case B. The planner should include a VALIDATION step that checks Protect adoption both ways — go2rtc/ffmpeg switching is a one-line yaml change.

### Gap #3 — Node script deployment pattern into LXC

**Answer (HIGH confidence):** Use the existing `pushFileToContainer()` helper. No systemd unit; let go2rtc's `exec:` own the lifecycle. Stdlib-only — confirmed by spike 004 probe.mjs using only `node:tls` + `node:fs`.

**Exact implementation:**

1. **Commit** the script to `lxc-assets/bambu-a1-camera.mjs` in the repo (new directory).
2. **During `configureGo2rtc()`** for `cameraType === 'bambu' && model === 'A1'`:
   ```typescript
   const scriptContent = readFileSync(
     new URL('../../../lxc-assets/bambu-a1-camera.mjs', import.meta.url),
     'utf8'
   );
   await executeOnContainer(ssh, camera.vmid, 'mkdir -p /opt/ipcm');
   await pushFileToContainer(ssh, camera.vmid, scriptContent, '/opt/ipcm/bambu-a1-camera.mjs');
   ```
3. **Node availability in LXC:** the existing ONVIF install step at `go2rtc.ts:211-213` installs `nodejs` via NodeSource. Since every camera LXC installs ONVIF in Phase 13's flow, Node is already there. **Planner must confirm order** — configureGo2rtc runs before configureOnvif in `onboarding.ts`, so for A1 the Node install must be hoisted (two options: (a) add `nodejs` to `getInstallCommands()` for Bambu only, or (b) swap the configureGo2rtc / configureOnvif order in provision/+server.ts for A1).
4. **No `pnpm install`** — the script uses only Node stdlib (`tls`, `fs`, `process`, `os`). Confirmed by spike 004.
5. **Script shape** (based on spike 004 probe.mjs with production additions):
   ```javascript
   #!/usr/bin/env node
   import tls from 'node:tls';
   import process from 'node:process';

   const ip = process.argv.find(a => a.startsWith('--ip='))?.slice(5);
   const code = process.env.A1_ACCESS_CODE;
   // buildAuth() — imported inline or duplicated from bambu-a1-auth.ts
   // Connect TLS :6000, send auth, loop: read 16-byte header → read N-byte JPEG → process.stdout.write(jpeg)

   process.on('SIGTERM', () => {
     try { socket.end(); } catch {}
     setTimeout(() => process.exit(0), 500).unref();
   });
   ```

**Why not systemd:** A systemd unit fights the go2rtc `exec:` lifecycle (both hold the TLS socket; both try to restart on failure). The whole point of `exec:` is that go2rtc manages the child. One less unit file, one less restart policy to reason about.

**Evidence:**
- `pushFileToContainer()` already handles heredoc-escape for arbitrary content including JS source (`ssh.ts:53-69`) [VERIFIED]
- nginx deploy at `onboarding.ts:300-302` uses the same pattern [VERIFIED]
- spike 004 probe.mjs uses only stdlib [VERIFIED]

### Gap #4 — `exec:` source lifecycle with adaptive mode

**Answer (HIGH confidence — but watch the signal default):** go2rtc does SIGTERM the exec child when the stream stops, but only **if you set `#killsignal=15` explicitly**. The 2024-era default (per PR #1246 discussion) is SIGKILL, which gives no chance for graceful shutdown.

**Behavior when adaptive mode stops go2rtc:**

1. `toggleGo2rtc(vmid, 'stop')` runs `systemctl stop go2rtc` inside the LXC (`bambu-mqtt.ts:43-50`).
2. systemd sends SIGTERM to the go2rtc process.
3. go2rtc sees it has no more consumers of the A1 stream → terminates the child process.
4. **Default:** SIGKILL (no trap possible; TLS connection to printer drops unceremoniously; printer likely times out the session on its side ~30s later).
5. **With `#killsignal=15#killtimeout=5`:** SIGTERM first; Node script's `process.on('SIGTERM')` handler runs `socket.end()`; printer sees clean TLS close; script exits; go2rtc confirms; systemd proceeds.

**Recommendation for the Node script:**

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

**When adaptive mode starts again:** `systemctl start go2rtc` → go2rtc re-reads yaml → spawns a fresh Node script → new TLS connect → first frame ~1s later. No state to preserve between restarts.

**Restart-safety:** None required — the script is stateless. Each invocation is a fresh TLS session. If the TLS session drops mid-capture (network blip), the script should `process.exit(1)`; go2rtc will respawn it (verified default behavior).

**Evidence:**
- [go2rtc Issue #1193](https://github.com/AlexxIT/go2rtc/issues/1193) — "exec processes are now sent KILL signal vs more traditional TERM" → killsignal/killtimeout added to address this [CITED]
- [go2rtc docs](https://go2rtc.org/internal/exec/) — killsignal (numeric), killtimeout (seconds before forced SIGKILL) [CITED]
- Example: `exec:gphoto2 --capture-movie --stdout#killsignal=2#killtimeout=5` [CITED]

### Gap #5 — Preflight TCP:6000 TLS check

**Answer (HIGH confidence):** Minimum-viable check = TLS handshake + send 80-byte auth + wait for first data byte within timeout. **Don't** parse a full frame; just observe that the socket received ≥16 bytes (= a frame header) from the printer. That's "auth accepted." Silent-drop (no bytes in N seconds) = auth rejected.

**Recommended implementation:**

```typescript
// NEW: checkTls6000 in bambu-preflight.ts
export type Tls6000Fail = {
  ok: false;
  reason: 'REFUSED' | 'TIMEOUT' | 'AUTH_SILENT_DROP' | 'TLS_HANDSHAKE';
};

async function checkTls6000Real(
  ip: string,
  accessCode: string,
  timeoutMs: number
): Promise<CheckOk | Tls6000Fail> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: ip,
      port: 6000,
      rejectUnauthorized: false,    // self-signed BBL CA; H2C does the same
      timeout: timeoutMs,
    });
    let authSent = false;
    let settled = false;
    const finish = (r: CheckOk | Tls6000Fail) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(
      () => finish(authSent
        ? { ok: false, reason: 'AUTH_SILENT_DROP' }
        : { ok: false, reason: 'TLS_HANDSHAKE' }),
      timeoutMs
    );
    timer.unref();
    socket.on('secureConnect', () => {
      socket.write(buildAuth('bblp', accessCode));  // from bambu-a1-auth.ts
      authSent = true;
    });
    socket.on('data', () => {
      // ≥1 byte back within timeout = auth accepted
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

**Timeout budget:** 6000 ms. Spike 004 observed the first frame arriving within ~1 second post-auth, so 6s is ~6× safety margin.

**Total preflight budget (A1 path):**
- checkTcp(ip, 8883, 3000) — 3s
- checkTls6000(ip, code, 6000) — 6s
- checkMqtt(ip, code, 5000) — 5s
- checkTutkDisabled(ip, code, SN, 5000) — 5s (can parallelize with MQTT: Promise.all)
- **Total worst-case: 14s serial, 14s parallel (checkMqtt and checkTutkDisabled share an MQTT session = combine into one check)**

**Optimization:** Merge `checkMqtt` and `checkTutkDisabled` into a single `checkMqttAndTutk` that opens one MQTT session, does auth (solves WRONG_ACCESS_CODE), requests `pushall`, reads `ipcam.tutk_server` from the first message, disconnects. One round-trip instead of two. Budget: 7s.

With merged MQTT check: **3 + 6 + 7 = 16s worst-case.** Still within the 15s hint in the original prompt if we lean on typical-case (MQTT auth completes in <1s; TLS handshake ~300ms; pushall response ~100ms — typical is 2-3s total).

### Gap #6 — MQTT `tutk_server` runtime watch implementation

**Answer (HIGH confidence):** Watch as a parallel field to `gcode_state`. Transitions flip `sub.lastError` independently (not through the `BambuConnectionError` classifier, which is reserved for client-side connection errors). TUTK is a *printer-side state*, not a client error, so it deserves its own path.

**Integration point:** `bambu-mqtt.ts:104-117` — the `client.on('message')` handler. Extend:

```typescript
// Location: bambu-mqtt.ts:104-117
client.on('message', (_topic, payload) => {
  sub.lastMessageAt = Date.now();
  // NOTE: don't clear lastError here unconditionally — tutk_server state must persist.
  // Clear only if lastError was a transient connection error, not a printer-state error.
  if (sub.lastError && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') {
    sub.lastError = null;
  }

  let msg: any;
  try { msg = JSON.parse(payload.toString()); } catch { return; }

  // Existing: gcode_state → adaptive mode
  const gcodeState = msg?.print?.gcode_state;
  if (typeof gcodeState === 'string' && gcodeState) {
    void handleStateChange(sub, gcodeState);
  }

  // NEW: tutk_server watch (A1 and future TUTK-capable models)
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

**Why this shape:**
- `lastError` field already drives UI state (`getBambuState()` at `:220-246`). Reusing it = no UI changes beyond the error label.
- Transition in both directions = auto-recovery (D-06).
- Ordering of the `lastError = null` reset matters: must NOT clear `A1_CLOUD_MODE_ACTIVE` on generic message arrival, only on explicit `tutk_server: disable` transition.
- Delta messages only carry changed fields (spike 003 §4) — so `msg?.print?.ipcam?.tutk_server` is `undefined` on most messages; the code only acts when it *is* present.

**Extend `BambuConnectionError` enum:**

```typescript
// bambu-mqtt.ts:25-29
type BambuConnectionError =
  | 'WRONG_ACCESS_CODE'
  | 'LAN_MODE_OFF'
  | 'PRINTER_UNREACHABLE'
  | 'MQTT_DISCONNECTED'
  | 'A1_CLOUD_MODE_ACTIVE';   // NEW
```

**Evidence:**
- spike 003 confirmed `print.ipcam.tutk_server` field path and that A1 uses `"disable"` / `"enable"` string values [VERIFIED]
- `bambu-mqtt.ts:104-117` message handler is the existing integration point [VERIFIED: source read]
- `getBambuState()` already exposes `error` — UI just needs a German label for `A1_CLOUD_MODE_ACTIVE` [VERIFIED: `bambu-mqtt.ts:220-246`]

### Gap #7 — UniFi Protect adoption of a 0.45-fps RTSP stream

**Answer (LOW confidence — no authoritative doc on fps minimums):** Documentation is thin. Community practice:

- Scrypted (well-regarded camera framework) says 10–30 fps is the standard range, no stated minimum. Scrypted's keyframe formula is `keyframe_interval = 4 * fps`. At <1 fps this is nonsensical — `-g 1` (every frame a keyframe) is the safe answer.
- UniFi Protect 5.0+ supports ONVIF adoption of third-party RTSP cameras. No official fps minimum in help docs.
- Community reports of low-fps frustration exist but focus on HLS streaming, not adoption.
- [ui.com community — "Package Camera very low FPS does not make it compatible with HLS streaming"](https://doitforme.solutions/blog/unifi-protect-fps-settings-auto-vs-custom-explained/) → HLS transcoding is the pain point, not adoption.

**Practical guidance (derived from pattern analysis + CONTEXT.md D-03):**

1. **Idle (~0.45 fps) — expect UX regression:** Protect will show the stream but it'll look like a slideshow. D-03 already handles this by stopping go2rtc at idle so Protect shows "offline" badge (the known, consistent state). The user sees snapshot-mode UX in our dashboard, not slideshow in Protect. This is the right decision.

2. **Live print (estimated 1–2 fps — UNCONFIRMED):** Still slow but recognizably a video. Community reports on the same hardware (A1 toolhead camera) suggest ~1 fps during print operations. At 1 fps, forcing `-g 1` keeps every frame a keyframe and Protect should accept it without "waiting for keyframe" delays.

3. **If Protect rejects low-fps adoption:** Use the ffmpeg Case B from Gap #2 with `-vsync cfr -r 5` to upsample to 5 fps by frame duplication. The output looks slightly juddery but Protect is happy. This is the "retrofit" option the CONTEXT.md defers.

4. **Keyframe interval recommendation for low-fps Bambu:** `-g 1` (every frame is I-frame). At 0.45 fps this adds ~15% bitrate overhead over `-g 4` but guarantees every Protect reconnect gets an immediate keyframe. Acceptable — 1080p at <2 fps is tiny (a few hundred kbps anyway).

**Recommendation:** Ship with go2rtc native passthrough (Case A). Measure Protect behavior in UAT. If Protect rejects adoption or marks the camera offline, flip to ffmpeg Case B with `-vsync cfr -r 5`. Do not pre-emptively add frame padding.

**Sources:**
- [Scrypted Camera Preparation](https://docs.scrypted.app/camera-preparation.html) — keyframe formula + 10–30 fps range [CITED]
- [ui.com — UniFi Protect Third-Party Cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) — ONVIF support introduced in Protect 5.0 [CITED]
- [Home Assistant community — low-res UniFi Protect images](https://github.com/home-assistant/core/issues/89185) — low-res issues relate to Enhanced Encoding, not low fps [CITED]

### Gap #8 — Auth-packet golden fixture

**Answer (HIGH confidence):** The 80-byte auth packet is fully determined by the username + access code. For the test fixture, use `bblp` + the placeholder access code `20633520` (8 digits, standard Bambu Access Code format; NOT a real code). Exact bytes below.

**Hex dump of `buildAuth('bblp', '20633520')`:**

```
offset  hex                                                ascii
------  -------------------------------------------------  ----------------
0x0000  40 00 00 00 00 30 00 00 00 00 00 00 00 00 00 00    @....0..........
0x0010  62 62 6c 70 00 00 00 00 00 00 00 00 00 00 00 00    bblp............
0x0020  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00    ................
0x0030  32 30 36 33 33 35 32 30 00 00 00 00 00 00 00 00    20633520........
0x0040  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00    ................

total: 80 bytes
```

**Per-field breakdown:**

| Offset | Length | Bytes | Meaning |
|--------|--------|-------|---------|
| 0 | 4 | `40 00 00 00` | `writeUInt32LE(0x40)` — packet type |
| 4 | 4 | `00 30 00 00` | `writeUInt32LE(0x3000)` — subtype (SHARP EDGE: `buf[4] = 0x30` gives `30 00 00 00` which is u32 LE = 0x30, NOT 0x3000 — silent fail) |
| 8 | 4 | `00 00 00 00` | reserved |
| 12 | 4 | `00 00 00 00` | reserved |
| 16 | 32 | `62 62 6c 70 00...` (4 + 28 null) | username "bblp" ascii, null-padded to 32 bytes |
| 48 | 32 | `32 30 36 33 33 35 32 30 00...` (8 + 24 null) | access code "20633520" ascii, null-padded to 32 bytes |

**Fixture file generation procedure (one-time, dev only — the test re-generates at runtime too):**

```javascript
// scripts/generate-a1-auth-fixture.mjs (not run in CI; only to seed the committed fixture)
import fs from 'node:fs';
import { buildAuth } from '../src/lib/server/services/bambu-a1-auth.mjs';
fs.writeFileSync(
  'src/lib/server/services/__fixtures__/a1-auth-packet.bin',
  buildAuth('bblp', '20633520')
);
```

**Test shape (per D-08):**

```typescript
// src/lib/server/services/bambu-a1-camera.test.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildAuth } from './bambu-a1-auth';

describe('buildAuth', () => {
  it('produces the exact 80-byte layout documented in spike 004', () => {
    const actual = buildAuth('bblp', '20633520');
    expect(actual.length).toBe(80);

    // Byte-for-byte assertion catches the 0x30 vs 0x3000 silent-fail regression
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

**Evidence:**
- Spike 004 §2 auth handshake captured this layout byte-for-byte against real A1 at 2026-04-20 [VERIFIED: live hardware]
- ha-bambulab `pybambu/bambu_client.py` `ChamberImageThread.run()` is the original source [CITED — see CONTEXT.md]

### Gap #9 — Validation Architecture (see detailed section below)

See `## Validation Architecture` section below the gaps.

### Gap #10 — Security Threat Model (see detailed section below)

See `## Security Threat Model` section below the gaps.

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json`. Section required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | Existing (no changes needed — `vitest` resolves from root) |
| Quick run command | `npm run test:unit -- --run src/lib/server/services/bambu-a1-*.test.ts` |
| Full suite command | `npm test` |
| Phase gate | Full suite green + manual UAT on real A1 @ 192.168.3.195 |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BAMBU-A1-01 | SSDP labels A1 correctly | unit | `vitest src/lib/server/services/bambu-discovery.test.ts -t 'A1'` | ✅ partial (see `bambu-discovery.test.ts:80`); extend for PRINTER_CAPABILITIES export |
| BAMBU-A1-02 | `cameras.model` column exists + populated | unit (drizzle snapshot) + integration | `vitest src/lib/server/db/schema.test.ts` | ❌ Wave 0 |
| BAMBU-A1-03 | `PRINTER_CAPABILITIES` map structure is stable | unit | `vitest src/lib/server/services/bambu-discovery.test.ts -t 'capabilities'` | ❌ Wave 0 |
| BAMBU-A1-04 | Model-aware preflight: A1 skips RTSPS, runs TLS6000 + TUTK | unit | `vitest src/lib/server/services/bambu-preflight.test.ts -t 'A1'` | ❌ Wave 0 (existing test file at `bambu-preflight.test.ts` — extend with A1 cases; LOW confidence the file exists, verify via `Glob`) |
| BAMBU-A1-05 | `A1_CLOUD_MODE_ACTIVE` returned when TUTK enabled | unit | same as above | ❌ Wave 0 |
| BAMBU-A1-06 | MQTT TUTK watch toggles `lastError` on edge changes | unit | `vitest src/lib/server/services/bambu-mqtt.test.ts -t 'tutk_server'` | ❌ Wave 0 |
| BAMBU-A1-07 | Auth-packet golden fixture matches builder output | unit | `vitest src/lib/server/services/bambu-a1-camera.test.ts -t 'buildAuth'` | ❌ Wave 0 |
| BAMBU-A1-08 | A1 go2rtc yaml is structurally correct | unit (snapshot) | `vitest src/lib/server/services/go2rtc.test.ts -t 'generateBambuA1'` | ✅ test file exists; extend |
| BAMBU-A1-09 | Node script exits cleanly on SIGTERM | unit (spawn + signal) | `vitest src/lib/server/services/bambu-a1-camera.test.ts -t 'SIGTERM'` | ❌ Wave 0 |
| BAMBU-A1-10 | Snapshot endpoint returns JPEG with 2s cache | unit (endpoint test) | `vitest src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts` | ❌ Wave 0 |
| BAMBU-A1-11 | UI capability gates hide chamber_temper on A1 | component | `vitest src/lib/components/BambuCard.test.ts` | ❌ Wave 0 (LOW confidence — component path is a guess; planner should confirm) |
| BAMBU-A1-12 | End-to-end: real A1 → onboarded in Protect | integration (gated) | `A1_IP=192.168.3.195 npm test -- --run a1-e2e` (skipped unless env present) | ❌ Wave 0 + manual UAT |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --run src/lib/server/services/bambu-a1-*.test.ts` (sub-second)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + manual UAT against real A1 @ 192.168.3.195 before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/server/services/bambu-a1-auth.ts` — `buildAuth(username, accessCode) → Buffer` pure function
- [ ] `src/lib/server/services/bambu-a1-auth.test.ts` — byte-for-byte + golden fixture assertions
- [ ] `src/lib/server/services/__fixtures__/a1-auth-packet.bin` — 80-byte golden fixture (generated from buildAuth once, committed)
- [ ] `src/lib/server/services/bambu-a1-camera.ts` — server-side helpers (preflight TLS check, snapshot fetch)
- [ ] `src/lib/server/services/bambu-a1-camera.test.ts` — includes SIGTERM test, snapshot test, frame-parser roundtrip
- [ ] `lxc-assets/bambu-a1-camera.mjs` — the ingestion script deployed into LXC
- [ ] `src/routes/api/cameras/[id]/a1-snapshot/+server.ts` — new endpoint (D-04)
- [ ] `src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts` — cache + auth check
- [ ] Extend `src/lib/server/services/bambu-preflight.test.ts` with A1 cases (LOW — confirm file exists before planning)
- [ ] Extend `src/lib/server/services/bambu-mqtt.test.ts` with tutk watch (LOW — confirm file exists)
- [ ] Extend `src/lib/server/services/go2rtc.test.ts` with A1 yaml snapshot
- [ ] Drizzle migration for `cameras.model` column (auto-gen via `npm run db:generate`)

**Layers:**

- **Protocol layer (unit tests):** buildAuth byte assertion, frame-header roundtrip (parse a synthetic 16-byte header + JPEG, assert size+payload matches), TLS cert CN match assertion (server-side test of `checkTls6000Real`'s cert handling — confirms we ignore cert but log CN for future pinning).
- **Service layer (unit tests):** `generateBambuA1Go2rtcYaml()` snapshot test (golden yaml string committed), `runBambuPreflight()` with mocked deps for A1 branch (model='A1' → checkTcp(8883) + checkTls6000 + checkMqtt+TUTK; no RTSPS call made), `PRINTER_CAPABILITIES` map shape.
- **Integration layer (env-gated):** `A1_IP=… A1_ACCESS_CODE=… npm test -- --run a1-e2e` actually hits the real A1 for one frame + one preflight. Skipped in CI (no `.env.a1` there); runs on dev machine only.
- **UI layer (component tests):** `BambuCard.test.ts` asserts that with `capabilities.chamberHeater: false`, the chamber-temp panel does not render. With `capabilities.ams: 'none'`, the AMS panel does not render. With `capabilities.xcamFeatures: ['buildplateMarkerDetector']`, only that xcam toggle is visible.

## Security Threat Model

> `security_enforcement` not explicitly set in config.json → enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse existing session auth on `/api/cameras/:id/a1-snapshot` (same pattern as `/api/cameras/:id/snapshot`) |
| V3 Session Management | yes | Existing session cookie enforcement from Phase 5 |
| V4 Access Control | yes | Single-user app (per Phase 5 D-27) — any authenticated user can see all cameras |
| V5 Input Validation | yes | IP format, serial number format, access code 8-char digit check — already done for H2C in `onboarding/bambu/preflight/+server.ts` |
| V6 Cryptography | yes | Access code stored AES-256-GCM (existing); TLS to printer intentionally unvalidated (trust boundary = LAN) |

### Known Threat Patterns for SvelteKit + Node + TLS-to-printer

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated snapshot endpoint → credential exfiltration (access code embedded in response?) | Information Disclosure | Endpoint returns JPEG only, NEVER the access code. Authenticate via existing session cookie (match `/api/cameras/:id/snapshot` pattern at `+server.ts:62-107`). |
| Snapshot endpoint as DoS vector (many open TLS sessions to printer) | Denial of Service | 2-second in-memory cache per camera ID. Printer only sees 1 session per 2s per camera regardless of request rate. |
| Access code leaking via `ps ax` on the Proxmox host or inside LXC | Information Disclosure | Pass the code as environment variable to the child Node script (`env A1_ACCESS_CODE=... node ...`), NOT as a CLI arg. `ps` shows env by default only for the process's own user — LXC root sees it, but that's the existing H2C threat surface (the access code is already in the go2rtc yaml at `/etc/go2rtc/go2rtc.yaml` on disk). Consistent with H2C. |
| MITM on LAN replacing TLS cert → attacker poses as printer → captures access code | Tampering / Spoofing | **INTENTIONALLY ACCEPTED.** Spike 004 documented `rejectUnauthorized: false` is mandatory (BBL CA is self-signed, not in system trust store). Trust boundary is the LAN. **Future hardening (deferred per CONTEXT.md):** pin the peer cert CN to the printer serial number — we know the CN always equals the serial (spike 004 §1). Defense-in-depth but not blocking for v1.2. |
| Access code logged in plaintext via console.error | Information Disclosure | Audit all `console.*` calls in new code. Existing `bambu-mqtt.ts` follows this rule. Planner action: ESLint rule or grep in CI? |
| SSRF via user-supplied IP → internal service scan from server | Server-Side Request Forgery | IP input already validated as IPv4 in existing preflight. Reuse that validator for the snapshot endpoint (take cameraId, look up IP from DB — no user-supplied IP at this endpoint). |
| Self-signed cert accepted on :6000 means attacker on LAN can spoof printer | Spoofing | Same trust boundary as every other camera in this tool (Mobotix, Loxone, H2C all trust the LAN). Documented, consistent. |
| go2rtc exec: child process hung → printer TLS session orphaned → next reconnect refused | DoS (self-inflicted) | `#killsignal=15#killtimeout=5` gives the Node script a SIGTERM window to close the socket cleanly. Covered by Gap #4 recommendation. |

### A1-Specific Threats (beyond H2C)

| Threat | Mitigation | Confidence |
|--------|-----------|------------|
| New endpoint `/api/cameras/:id/a1-snapshot` adds attack surface | Reuse existing snapshot auth pattern (`/api/cameras/:id/snapshot` at `+server.ts:62`) | HIGH |
| TLS peer cert validation intentionally disabled | Accepted per LAN trust boundary; future: pin CN to serial | HIGH |
| Access code in go2rtc yaml on LXC disk | Existing H2C risk, already accepted | HIGH |
| `lxc-assets/bambu-a1-camera.mjs` — file committed to public GitHub repo | Script contains NO secrets; secrets are passed at runtime via `--ip=` arg + `A1_ACCESS_CODE` env var | HIGH |
| Node script could be tampered with in the container (root on LXC) | Same threat surface as every other container asset (go2rtc.yaml, onvif config). Not a new threat. | HIGH |
| `--access-code` passed as CLI arg would leak via `ps` | **Fixed in Gap #1/#3 recommendation:** use env var instead | HIGH |

**Nothing A1-specific requires new security primitives.** The phase reuses existing authn, encryption, and LAN-trust-boundary decisions from Phases 5, 11, and 12.

## Common Pitfalls

### Pitfall 1: Auth-packet `0x30` vs `0x3000` silent fail

**What goes wrong:** `buf[4] = 0x30` gives bytes `30 00 00 00` at offset 4 (u32 LE = 0x30). Correct is `buf.writeUInt32LE(0x3000, 4)` giving bytes `00 30 00 00` (u32 LE = 0x3000).

**Why it happens:** Easy typo; both look "right" at a glance.

**How to avoid:** D-08 byte-for-byte fixture assertion catches this immediately. Plus: spike 004 logs the first 32 bytes of any suspicious response so the runtime can still surface the error if fixture drift slips through.

**Warning signs:** TLS handshake succeeds, auth packet is sent, printer silently drops the connection after ~12s with zero bytes transmitted.

### Pitfall 2: go2rtc default SIGKILL breaks TLS session cleanup

**What goes wrong:** Without `#killsignal=15#killtimeout=5` in the exec: URL, go2rtc SIGKILLs the child. TLS socket is hard-closed. Printer waits ~30s for session timeout before accepting a new connection.

**Why it happens:** go2rtc's PR #1246-era default changed from SIGTERM to SIGKILL.

**How to avoid:** Always include `#killsignal=15#killtimeout=5` in the generated yaml. Unit-test the generator's output to contain both flags.

**Warning signs:** Adaptive mode toggle (live → idle → live) triggers a ~30s "no frames" window after the second "live" transition instead of the expected ~1s.

### Pitfall 3: `multipart/x-mixed-replace` headers break MJPEG detection

**What goes wrong:** Adding `--boundary\r\nContent-Type: image/jpeg\r\n\r\n` before each JPEG confuses go2rtc's `magic.Open()`, which expects `FF D8` as the first 2 bytes.

**Why it happens:** HTTP MJPEG (`video.mjpg` style) uses boundaries; it's tempting to mirror that format.

**How to avoid:** Emit raw `FF D8 ... FF D9` concatenated, nothing else. synman/bambu-go2rtc has the boundary code present but commented out — confirming this is the wrong path.

**Warning signs:** go2rtc log shows "unknown format" or "failed to detect container"; `http://<lxc>:1984/api/streams` shows the stream with `producers: []` and no codec.

### Pitfall 4: A1 preflight timeout exceeds budget

**What goes wrong:** Serial execution of checkTcp(8883) + checkTls6000(8s) + checkMqtt(5s) + checkTutk(5s) = ~21s, which blocks the wizard UI and fires the 15s fetch timeout in the frontend.

**Why it happens:** Not parallelizing MQTT auth + TUTK read (they share one session) and over-budgeting the TLS check (spike 004 got first byte in <1s).

**How to avoid:** (a) merge MQTT+TUTK into one session → saves 5s; (b) drop checkTls6000 timeout to 6s based on spike data. Net: ~14s worst-case, typical <5s.

**Warning signs:** Wizard spinner > 10s consistently; users assume onboarding is broken.

### Pitfall 5: Node missing in LXC at configureGo2rtc time

**What goes wrong:** `configureGo2rtc()` deploys the Node script + go2rtc.yaml; systemd starts go2rtc; go2rtc tries to `exec:node ...` and exits with "node: command not found."

**Why it happens:** Node is installed by `getOnvifInstallCommands()` (`go2rtc.ts:211-213`) which runs AFTER `configureGo2rtc()` in the provision flow (`provision/+server.ts:33-36`).

**How to avoid:** Either (a) hoist Node install into `getInstallCommands()` for the Bambu A1 path, or (b) swap the order: `configureOnvif` before `configureGo2rtc` when `model === 'A1'`. Planner picks; option (a) is simpler because it affects only the Bambu branch.

**Warning signs:** First camera adoption fails with "go2rtc started but stream not healthy"; LXC `systemctl status go2rtc` shows repeated child-process exits.

## Code Examples

### A1 go2rtc yaml generator

```typescript
// Source: this research doc — mirrors generateGo2rtcConfigBambu at go2rtc.ts:142-166
export function generateBambuA1Go2rtcYaml(params: {
  streamName: string;
  printerIp: string;
  accessCode: string;
  rtspAuth?: RtspAuth;
}): string {
  const { streamName, printerIp, accessCode, rtspAuth } = params;
  // Access code via env var (not CLI arg) so it doesn't leak via `ps ax`.
  // killsignal=15 (SIGTERM), killtimeout=5 — ensures Node SIGTERM handler runs.
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

### A1 ingestion script skeleton

```javascript
// Source: lxc-assets/bambu-a1-camera.mjs — derived from spike 004 probe.mjs
#!/usr/bin/env node
import tls from 'node:tls';
import process from 'node:process';

const ip = process.argv.find(a => a.startsWith('--ip='))?.slice(5);
const code = process.env.A1_ACCESS_CODE;
if (!ip || !code) {
  console.error('Missing --ip or A1_ACCESS_CODE');
  process.exit(2);
}

function buildAuth(username, accessCode) {
  const buf = Buffer.alloc(80, 0);
  buf.writeUInt32LE(0x40, 0);
  buf.writeUInt32LE(0x3000, 4);  // NOT 0x30 — silent-fail
  buf.write(username, 16, 32, 'ascii');
  buf.write(accessCode, 48, 32, 'ascii');
  return buf;
}

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

socket = tls.connect({ host: ip, port: 6000, rejectUnauthorized: false, timeout: 10_000 });

let buf = Buffer.alloc(0);

socket.on('secureConnect', () => {
  socket.write(buildAuth('bblp', code));
});

socket.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  // Loop: parse 16-byte header, emit N-byte JPEG
  while (buf.length >= 16) {
    const size = buf.readUInt32LE(0);
    if (size === 0 || size > 5_000_000) {
      process.stderr.write(`[a1-cam] suspicious size=${size}; abort\n`);
      socket.destroy();
      return;
    }
    if (buf.length < 16 + size) return;
    const jpeg = buf.subarray(16, 16 + size);
    buf = buf.subarray(16 + size);
    // Sanity: must start FF D8. Skip frame if not (don't crash).
    if (jpeg[0] === 0xff && jpeg[1] === 0xd8) {
      process.stdout.write(jpeg);
    }
  }
});

socket.on('error', (err) => {
  process.stderr.write(`[a1-cam] socket error: ${err.message}\n`);
  process.exit(1);  // go2rtc will respawn
});

socket.on('close', () => process.exit(1));
```

### Preflight A1 branch

```typescript
// Source: bambu-preflight.ts extension per Gap #5
export type PreflightError =
  | 'PRINTER_UNREACHABLE'
  | 'LAN_MODE_OFF'
  | 'WRONG_ACCESS_CODE'
  | 'RTSPS_HANDSHAKE_HUNG'
  | 'A1_CLOUD_MODE_ACTIVE';  // NEW

export const PREFLIGHT_HINTS_DE: Record<PreflightError, string> = {
  // ... existing ...
  A1_CLOUD_MODE_ACTIVE:
    'Cloud-Modus ist aktiv. Bambu Handy App → Gerät → "LAN Mode only" aktivieren und Cloud-Verbindung deaktivieren.',
};

// runBambuPreflight(input, deps, model) — full shape in Pattern 2 above.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `exec:` with RTSP transport (v1.4 and earlier) | `exec:` with **pipe transport** supporting MJPEG on stdout | go2rtc v1.5.0 | Our approach — no RTSP server to run inside the script, just stdout |
| SIGTERM as default exec: stop signal | SIGKILL as default (PR #1246 era) | go2rtc 2024+ | Must explicitly set `#killsignal=15` |
| HTTP MJPEG with `multipart/x-mixed-replace` | Raw concatenated JPEGs | Always the go2rtc exec: convention | synman/bambu-go2rtc confirms |
| Manual ffmpeg bridging for MJPEG → RTSP | go2rtc native MJPEG producer | v1.5.0 pipe transport | Fewer moving parts |
| UniFi Protect 4.x required unifi-cam-proxy for non-ONVIF | UniFi Protect 5.0+ native ONVIF | 2024 | Our ONVIF container bridge (phase 4 code) is the path; no Proxy needed |

**Deprecated/outdated:**
- The idea that the A1 would share H2C's RTSPS:322 path (spike 002 killed this).
- Any assumption that go2rtc's `exec:` requires a systemd-managed external service (it doesn't; pipe transport is in-process).
- Using `-f mjpeg -r <n>` on ffmpeg input — known to break variable-fps MJPEG sources.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | UniFi Protect 5.0+ accepts ONVIF adoption of a ~0.45 fps MJPEG→H.264 stream without marking it offline | Gap #7 | UX regression: users see "offline" in Protect even when LXC is running. Mitigation: Case B ffmpeg with `-vsync cfr -r 5`. Testable only in UAT. |
| A2 | Active-print fps on A1 is ≥1 fps (not measured in spikes) | Gap #7 | If <1 fps, "Live" badge in dashboard will be misleading. Mitigation: measure during UAT, add "Low-FPS live" label if needed. |
| A3 | `bambu-preflight.test.ts` and `bambu-mqtt.test.ts` exist as test files with the patterns the planner can extend | Validation Architecture | LOW risk — planner verifies via Glob before writing extensions. |
| A4 | `BambuCard.test.ts` or equivalent UI component test file exists | Validation Architecture | LOW risk — planner verifies via Glob; if absent, adds it. |
| A5 | Node is installed in every camera LXC by the time configureGo2rtc runs (via ONVIF container step) | Pitfall #5 | Medium risk — may cause first-time adoption to fail. Planner should hoist Node install or swap configureGo2rtc / configureOnvif order for A1. |
| A6 | `rejectUnauthorized: false` + printer CN matching serial is an adequate trust model on LAN | Security Threat Model | Accepted; deferred hardening (CN pinning) already in CONTEXT.md deferred list. |
| A7 | go2rtc's `magic.Open()` correctly auto-detects MJPEG from `FF D8` on stdout with no additional config | Gap #1 | LOW risk — synman/bambu-go2rtc running in production for years with this exact pattern. |
| A8 | ffmpeg Case B (if needed) handles the MJPEG pipe at variable fps with `-use_wallclock_as_timestamps 1` | Gap #2 | MEDIUM risk — documented flag but only LOW-confidence for extreme low-fps input. If Case A works, we never test Case B. |

## Open Questions

1. **Does `configureGo2rtc()` run before or after `configureOnvif()` in the A1 provision flow?**
   - What we know: In `provision/+server.ts:33-36`, `configureGo2rtc` runs first, then `configureOnvif` (which installs Node). For Bambu-H2C this doesn't matter because the H2C yaml uses only the `rtspx://` scheme (no Node needed). For Bambu-A1 it's blocking.
   - What's unclear: Whether swapping the order breaks anything else, or whether we should hoist `nodejs` into the `getInstallCommands()` path for Bambu.
   - Recommendation: **Hoist Node install into `getInstallCommands()` when called for a Bambu-A1 camera.** One branch change; doesn't affect Mobotix/Loxone/H2C. Planner to confirm in task actions.

2. **Does the active-print A1 fps cross 1 fps?**
   - What we know: idle is 0.45 fps (spike 004). Community reports hint at "slightly higher" during print.
   - What's unclear: exact number.
   - Recommendation: deferred to UAT per CONTEXT.md (already marked out-of-scope). If UAT shows <1 fps during active print too, the planner should open a follow-up issue to add the ffmpeg `-vsync cfr -r 5` retrofit.

3. **Is there a `cameras.model` column migration path that doesn't break existing H2C rows?**
   - What we know: schema.ts has no model column currently. Existing Bambu H2C rows set `cameraType: 'bambu'` without a model field.
   - What's unclear: whether there are production H2C rows on user's VM that need backfill.
   - Recommendation: Drizzle migration adds `model TEXT` (nullable). Backfill strategy: null = assume H2C (backward-compatible with existing behavior); SSDP discovery sets model for new adoptions. Planner verifies in task actions.

4. **Does UniFi Protect's ONVIF adoption work with a low-fps RTSP source?**
   - What we know: Scrypted says 10–30 fps; no explicit UniFi minimum.
   - What's unclear: practical minimum.
   - Recommendation: test during UAT with real A1. If adoption fails, escalate to ffmpeg Case B retrofit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (server VM) | SvelteKit app, preflight, snapshot endpoint | ✓ | 22.x (VM already provisioned) | — |
| Node.js (in per-camera LXC) | A1 ingestion script | ⚠ Partial | Installed by `getOnvifInstallCommands()` AFTER go2rtc — needs hoist for A1 path | Install via NodeSource from `getInstallCommands()` for Bambu cameras |
| go2rtc (in LXC) | MJPEG → RTSP packaging | ✓ | Installed via `getInstallCommands()` at `go2rtc.ts:97` | — |
| ffmpeg (in LXC) | Optional Case B ffmpeg bridge | ✓ | Installed via `getInstallCommands()` at `go2rtc.ts:96` | — |
| `mqtt` npm | Runtime MQTT subscriber + preflight + TUTK check | ✓ | 5.15.1 (already in package.json) | — |
| Access to real A1 hardware @ 192.168.3.195 | Integration UAT | ✓ | — (chrissi's setup) | None — integration tests are env-gated and skipped in CI |
| `.env.a1` file with credentials | Spike reproduction + e2e tests | ✓ | Gitignored | — |

**Missing dependencies with no fallback:** none blocking.

**Missing dependencies with fallback:** Node in LXC — hoist install into `getInstallCommands()` for Bambu.

## Sources

### Primary (HIGH confidence)

- `.planning/spikes/001-a1-port-surface/README.md` — port 6000 open, 322 closed on A1 [VERIFIED: hardware]
- `.planning/spikes/002-a1-rtsps-native/README.md` — RTSPS:322 ECONNREFUSED; current preflight mis-classifies [VERIFIED: hardware]
- `.planning/spikes/003-a1-mqtt-lan/README.md` — MQTT byte-compatible with H2C; `print.ipcam.tutk_server` field confirmed [VERIFIED: hardware]
- `.planning/spikes/003-a1-mqtt-lan/pushall-full.json` — full A1 pushall response fixture [VERIFIED: hardware]
- `.planning/spikes/004-a1-stream-fallback/README.md` — 80-byte auth + 16-byte frame header + 0.45 fps idle + 150 LOC reference client [VERIFIED: hardware]
- `.planning/spikes/004-a1-stream-fallback/probe.mjs` — working Node stdlib-only client [VERIFIED: code read]
- `.planning/research/H2C-FIELD-NOTES.md` — H2C ground truth the A1 branch extends [VERIFIED: doc read]
- `src/lib/server/services/bambu-discovery.ts` — MODEL_LABELS, BAMBU_MODEL_ALLOWLIST, parseNotifyPayload [VERIFIED: source read]
- `src/lib/server/services/bambu-mqtt.ts` — existing subscriber, message handler at :104-117, BambuConnectionError enum at :25-29 [VERIFIED: source read]
- `src/lib/server/services/bambu-preflight.ts` — existing preflight with all check functions [VERIFIED: source read]
- `src/lib/server/services/go2rtc.ts` — existing yaml generators including generateGo2rtcConfigBambu at :142-166 [VERIFIED: source read]
- `src/lib/server/services/ssh.ts` — pushFileToContainer, executeOnContainer [VERIFIED: source read]
- `src/routes/api/cameras/[id]/snapshot/+server.ts` — snapshot endpoint pattern to mirror for a1-snapshot [VERIFIED: source read]
- [synman/bambu-go2rtc](https://github.com/synman/bambu-go2rtc) — go2rtc + Bambu exec: reference implementation [VERIFIED: raw file fetch]
- [go2rtc.org/internal/exec](https://go2rtc.org/internal/exec/) — official exec: source docs [CITED]

### Secondary (MEDIUM confidence)

- [go2rtc DeepWiki](https://deepwiki.com/AlexxIT/go2rtc/3.1-ffmpeg-and-exec-sources) — magic.Open() format detection behavior [CITED]
- [go2rtc PR #1246](https://github.com/AlexxIT/go2rtc/pull/1246) — exec race/hang fix, signal behavior [CITED]
- [go2rtc Issue #1193](https://github.com/AlexxIT/go2rtc/issues/1193) — killsignal/killtimeout addition [CITED]
- [go2rtc Issue #551](https://github.com/AlexxIT/go2rtc/issues/551) — exec: pipe limitations [CITED]
- [Scrypted Camera Preparation](https://docs.scrypted.app/camera-preparation.html) — keyframe interval formula (4 × fps) [CITED]
- [ffmpeg Formats Documentation](https://ffmpeg.org/ffmpeg-formats.html) — MJPEG demuxer, `-use_wallclock_as_timestamps` [CITED]
- [ui.com — UniFi Protect Third-Party Cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) — ONVIF support in 5.0 [CITED]

### Tertiary (LOW confidence — flagged for UAT)

- Community reports of A1 active-print fps being "higher than idle" — numbers not cited anywhere authoritative [needs UAT]
- UniFi Protect's tolerance for <1 fps RTSP sources — no official minimum [needs UAT]

## Metadata

**Confidence breakdown:**
- go2rtc exec: pipe format: HIGH — synman/bambu-go2rtc is a working precedent for the exact pattern
- Preflight sequencing & timeout budget: HIGH — based on measured spike 004 + existing preflight code
- Auth packet byte layout: HIGH — validated byte-for-byte against real A1
- MQTT TUTK watch integration: HIGH — integration point is one code path at `bambu-mqtt.ts:104-117`
- ffmpeg Case B fallback flags: MEDIUM — documented flags, but not tested against actual A1 stream in this research (only Case A recommended)
- UniFi Protect low-fps tolerance: LOW — no authoritative doc; deferred to UAT
- Active-print fps: LOW — unmeasured; deferred to UAT

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 for go2rtc/UniFi Protect version assumptions; indefinitely for A1 hardware behaviors (captured against user's actual unit on 2026-04-20)

## RESEARCH COMPLETE

**Phase:** 18 - Bambu Lab A1 Camera Integration
**Confidence:** HIGH for all load-bearing claims; LOW on two deferred UAT items (Protect low-fps tolerance, active-print fps). Zero blockers.

### Key Findings

- go2rtc `exec:` with pipe transport + raw concatenated JPEGs is the canonical topology; confirmed by synman/bambu-go2rtc running this exact pattern for Bambu cameras.
- Ingestion Node script needs only Node stdlib; no `pnpm install` inside LXC. Deploy via `pushFileToContainer` next to go2rtc.yaml.
- `#killsignal=15#killtimeout=5` is mandatory for clean adaptive-mode restart; without it, go2rtc SIGKILLs the child and the printer's TLS session orphans for ~30s.
- Preflight total budget fits in ~14s if MQTT auth and TUTK pushall check are merged into a single MQTT session.
- `cameras.model` column is a schema gap the planner must address; not currently persisted, but needed for preflight model-split and capability gating.
- Node-install-order in LXC provisioning is a solvable gotcha: hoist `nodejs` into `getInstallCommands()` for Bambu, OR swap configureOnvif/configureGo2rtc order for A1.

### File Created

`/Users/hulki/codex/ip-cam-master/.planning/phases/18-bambu-a1-camera-integration/18-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Zero new runtime deps; every library already in package.json |
| Architecture | HIGH | synman/bambu-go2rtc is an existing production precedent for the same topology |
| Pitfalls | HIGH | 4 of 5 pitfalls are captured in spikes or go2rtc's own issue tracker |
| UniFi Protect low-fps tolerance | LOW | No authoritative doc; defer to UAT with Case A → Case B fallback path ready |

### Open Questions

- Node install ordering in camera LXC provision flow (recommendation: hoist nodejs into getInstallCommands for Bambu)
- `cameras.model` column migration strategy (recommendation: nullable, null=H2C backward-compat)
- Active-print A1 fps measurement (deferred to UAT; CONTEXT.md already lists this)
- Protect tolerance for <1 fps RTSP (deferred to UAT; Case B fallback documented)

### Ready for Planning

Research complete. Planner has enough to break Phase 18 into concrete plans.
