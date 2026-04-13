# Architecture Research — Bambu Lab H2C Integration (v1.2)

**Domain:** New camera type integration into existing IP-Cam-Master pipeline
**Researched:** 2026-04-13
**Confidence:** HIGH for fit & reuse; MEDIUM for go2rtc RTSPS specifics; LOW for resource sizing

## Executive Summary

The Bambu H2C integrates as a **third `camera_type`** ("bambu") alongside `mobotix` and `loxone`. The architecture is already type-aware (DB column, branching in `configureGo2rtc`/`configureOnvif`, discovery `type` enum), so the milestone is mostly **additive**: a new discovery probe, a new go2rtc YAML generator, a credential-shape extension, and one new wizard step variant. **No new modules; schema migration is structurally optional if we reuse `username`/`password` columns by convention** (username = "bblp", password = access code, with serial deferred). Cleaner alternative: add nullable columns. LXC provisioning, ONVIF wrapper, Protect adoption, container template, status flow — all reused unchanged.

## Existing Architecture (verified from source)

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  SvelteKit App (VM 192.168.3.249)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ /kameras/    │  │ /api/        │  │ /api/onboarding/       │  │
│  │ onboarding   │  │ discovery    │  │ {test-connection,      │  │
│  │ (wizard UI)  │  │              │  │  create-container,     │  │
│  │              │  │              │  │  configure-go2rtc,     │  │
│  │              │  │              │  │  configure-nginx,      │  │
│  │              │  │              │  │  configure-onvif,      │  │
│  │              │  │              │  │  verify-stream,        │  │
│  │              │  │              │  │  save-camera}          │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         └─────────────────┴─────────────────────┘                │
│                           │                                       │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │  src/lib/server/services/                                  │  │
│  │  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────┐  │  │
│  │  │onboarding│ │ go2rtc  │ │proxmox │ │   ssh   │ │crypto│  │  │
│  │  └──────────┘ └─────────┘ └────────┘ └─────────┘ └──────┘  │  │
│  │  ┌──────────┐ ┌─────────┐                                  │  │
│  │  │ protect  │ │ events  │                                  │  │
│  │  └──────────┘ └─────────┘                                  │  │
│  └──────────────┬─────────────────────────────────────────────┘  │
│                 │                                                 │
│  ┌──────────────┴────────────┐                                   │
│  │  SQLite (Drizzle)         │   schema.ts: cameras,             │
│  │  cameras.camera_type      │   containers, credentials,        │
│  │  ('mobotix'|'loxone'|...) │   settings, events                │
│  └───────────────────────────┘                                   │
└────────────────────────┬─────────────────────────────────────────┘
                         │ SSH (node-ssh) → Proxmox host
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Proxmox host (proxi3, 192.168.3.16)                             │
│  ┌─────────────────────────┐   ┌─────────────────────────┐       │
│  │  LXC per camera         │   │  LXC per camera         │       │
│  │  ┌───────┐ ┌─────────┐  │   │  ┌───────┐ ┌─────────┐  │       │
│  │  │ go2rtc│ │  ONVIF  │  │   │  │ go2rtc│ │  ONVIF  │  │       │
│  │  │ :8554 │ │ wrapper │  │   │  │ :8554 │ │ wrapper │  │       │
│  │  │ :1984 │ │ :8899   │  │   │  │ :1984 │ │ :8899   │  │       │
│  │  └───┬───┘ └─────────┘  │   │  └───┬───┘ └─────────┘  │       │
│  │      │ (+nginx :8081    │   │      │                  │       │
│  │      │  for Loxone)     │   │      │                  │       │
│  └──────┼──────────────────┘   └──────┼──────────────────┘       │
└─────────┼─────────────────────────────┼──────────────────────────┘
          │ pulls source stream         │
          ▼                             ▼
   Mobotix/Loxone                Bambu H2C (rtsps://:322)  ← NEW
   (RTSP/HTTP MJPEG)
                                       │
                                       ▼ (RTSP :8554)
                              UniFi Dream Machine / Protect
```

### Component Responsibilities (verified)

| Component | File | Type-aware today? |
|-----------|------|-------------------|
| Discovery probe | `src/routes/api/discovery/+server.ts` | YES — emits `mobotix`/`mobotix-onvif`/`loxone`/`unknown` |
| Credential store | `src/lib/server/db/schema.ts` (`cameras`, `credentials`) | NO — assumes `username`/`password` |
| Connection test | `src/lib/server/services/onboarding.ts` `testMobotixConnection` | NO — Mobotix-specific (also `routes/api/onboarding/test-connection`) |
| LXC create / clone | `src/lib/server/services/proxmox.ts` (called by `createCameraContainer`) | NO — generic |
| go2rtc YAML gen | `src/lib/server/services/go2rtc.ts` `generateGo2rtcConfig`/`...Loxone` | YES — two functions today |
| go2rtc deploy | `onboarding.ts` `configureGo2rtc` | YES — `if camera.cameraType === 'loxone'` branch |
| nginx auth-proxy | `go2rtc.ts` `generateNginxConfig` + `onboarding.ts` `configureNginx` | Loxone only |
| ONVIF wrapper | `onboarding.ts` `configureOnvif` + `go2rtc.ts` `generateOnvifConfig` | YES — `isLoxone` branch (audio patch skipped) |
| Stream verify | `go2rtc.ts` `checkStreamHealth` | NO — generic (HTTP GET on :1984) |
| Wizard UI | `src/routes/kameras/onboarding/` | Type-aware step routing |

## What Changes for Bambu H2C

### 1. Stream Pipeline — go2rtc handles RTSPS directly

**Verdict:** No nginx pre-proxy needed. go2rtc speaks RTSPS natively (it bundles ffmpeg with TLS). Auth is in the URL.

**Source URL:** `rtsps://bblp:<access_code>@<printer_ip>:322/streaming/live/1`

**Concrete YAML** (new generator `generateGo2rtcConfigBambu` in `src/lib/server/services/go2rtc.ts`):

```yaml
streams:
  cam-2003:
    - ffmpeg:rtsps://bblp:12345678@192.168.3.50:322/streaming/live/1#video=copy#raw=-rtsp_transport tcp#raw=-tls_verify 0#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 5
  cam-2003-low:
    - ffmpeg:rtsps://bblp:12345678@192.168.3.50:322/streaming/live/1#video=h264#hardware=vaapi#width=640#height=360#raw=-rtsp_transport tcp#raw=-tls_verify 0#raw=-maxrate 800k#raw=-bufsize 1600k

ffmpeg:
  bin: ffmpeg

log:
  level: info
```

**Differences vs Mobotix generator:**
- Source is `rtsps://` (not HTTP MJPEG)
- `-tls_verify 0` because Bambu uses a self-signed cert (printer firmware, no CA chain). Scoped to ffmpeg only — do NOT touch system CAs.
- `-rtsp_transport tcp` — RTSPS over UDP is unreliable across the LXC bridge.
- No separate audio source (H2C has no audio).
- The H2C stream is **already H.264** — recommend **`#video=copy` for HQ** (zero CPU/GPU, native H.264 already), VAAPI re-encode only for the LQ downscale. *Confidence MEDIUM — verify in Phase B; fall back to `#video=h264#hardware=vaapi` if Protect rejects the SPS/PPS.*

### 2. Discovery Integration

**Existing scanner** (`src/routes/api/discovery/+server.ts`) is a single bash script that probes `http://<ip>/` per IP in subnet, fingerprints by HTML content. It is **not** mDNS-based.

**Bambu signal options:**

| Signal | Reliability | Implementation cost |
|--------|-------------|---------------------|
| mDNS `_bambulab._tcp.local` | HIGH (printers advertise this) | New npm dep (mdns/bonjour-service); breaks pure-bash pattern |
| Port 322 open + TLS handshake → cert subject contains "Bambu" | HIGH | One `openssl s_client` per IP — fits current bash script pattern |
| Port 990 (FTP) + 8883 (MQTT) open combo | MEDIUM | No content fingerprint |

**Recommendation:** Extend the existing bash scan with a TLS probe block:

```bash
# Bambu H2C: RTSPS on 322 with self-signed cert containing 'Bambu'
CERT=$(timeout 2 openssl s_client -connect "$FULL:322" -servername "$FULL" </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)
if echo "$CERT" | grep -qi "bambu"; then
  echo "bambu:$FULL"
fi
```

Self-contained, no new npm dep, matches existing pattern, ~2s per host (in parallel).

**Type enum extension** (`DiscoveredCamera['type']` line 36): add `'bambu'`.

### 3. Credentials — Schema Implications

The `cameras` table has `username` (required) and `password` (required, encrypted via `crypto.encrypt`). Bambu LAN auth is:

- **Username:** always literal `"bblp"`
- **Password:** Access Code (8-digit, from printer screen)
- **Serial Number:** required only for cloud fallback — NOT for LAN RTSPS

**Two options:**

**Option A (zero-migration, recommended for v1.2 if LAN-only ships first):**
- `username` = `"bblp"` (set automatically by `saveCameraRecord`, hidden in UI)
- `password` = access code (encrypted as today)
- Serial: store in a `settings` row keyed `bambu.serial.<vmid>` OR omit until cloud fallback ships.

Pros: no schema change. Cons: serial is orphaned; semantics murky.

**Option B (cleaner, recommended if cloud fallback also ships in v1.2):** Add nullable columns to `cameras`:
```ts
serialNumber: text('serial_number'),     // nullable, Bambu only
accessCode: text('access_code'),         // nullable, encrypted, Bambu only
authMode: text('auth_mode'),             // 'lan' | 'cloud' | null
```
Keep `username`/`password` for legacy types.

**Decision driver:** PROJECT.md lists "Cloud-Auth als Fallback" in v1.2 scope. If both LAN + cloud ship together → **Option B**. If LAN-only ships first → **Option A**, defer columns.

The `credentials` table (priority-ordered for Mobotix discovery name lookup) is unaffected.

**Wizard UI implication:** type-specific credential step. Bambu shows "Access Code" (8-char monospace input) + optional "Serial". Mobotix shows username/password as today. The wizard already routes per type (Loxone vs Mobotix) — extend with a third branch.

### 4. Camera Type Abstraction — Modules to Touch

`camera_type` is already a first-class concept (column `cameras.camera_type`, default `'mobotix'`, branched in `onboarding.ts:284` and `:363`). Adding `'bambu'`:

| Module | File | Action |
|--------|------|--------|
| Type literal | `src/lib/types.ts` | Add `'bambu'` to camera type union |
| Discovery enum | `src/routes/api/discovery/+server.ts:36` | Add `'bambu'` to `DiscoveredCamera['type']` |
| Discovery probe | same file, bash script lines 53-77 | Add openssl-based Bambu detection block |
| Connection test | `src/lib/server/services/onboarding.ts` (alongside `testMobotixConnection`) | Add new `testBambuConnection(ip, accessCode)` — ffprobe over RTSPS via SSH |
| Test endpoint | `src/routes/api/onboarding/test-connection/+server.ts` | Branch on `cameraType` to dispatch the right test fn |
| go2rtc YAML | `src/lib/server/services/go2rtc.ts` | Add `generateGo2rtcConfigBambu(...)` |
| go2rtc deploy branch | `src/lib/server/services/onboarding.ts:282-306` (`configureGo2rtc`) | Add `else if (cameraType === 'bambu')` branch |
| nginx | `configureNginx` | NOT NEEDED — skip for Bambu |
| ONVIF wrapper | `configureOnvif` | Reuse as-is. Currently uses `isLoxone` to skip the audio patch — rename to `hasAudio` (false for both Loxone and Bambu) for clarity. |
| Status flow | `CAMERA_STATUS` constants, `verifyStream`, Protect adoption | Reuse unchanged |
| Wizard UI | `src/routes/kameras/onboarding/` | New step variant for Bambu credentials |

**Net new files (suggested):** None required. Optionally `src/lib/server/services/bambu.ts` to host `testBambuConnection` + `generateGo2rtcConfigBambu` if Bambu logic crosses ~50 LOC, to keep `onboarding.ts` from ballooning.

### 5. LXC Provisioning — Identical, with caveats

**Reuse 100%:** template clone path (`getTemplateVmid` → `cloneFromTemplate`), DHCP wait, container startup, VAAPI device passthrough, ffmpeg/go2rtc install commands. The current template (built from first Mobotix container) already has ffmpeg + go2rtc + Node.js + onvif-server, all of which Bambu also needs.

**Caveats:**
- **Self-signed TLS cert:** handled at ffmpeg level (`-tls_verify 0`). No system CA store changes in the LXC. Do NOT pin the cert (firmware updates rotate it).
- **No extra env vars** required.
- **VAAPI:** same `/dev/dri/renderD128` passthrough. With `#video=copy` for HQ, GPU is only touched for LQ — even less load than Mobotix.

### 6. Resource Concern — FLAG ONLY

**Architecture flag, not a solve:** UniFi Protect pulls 24/7. Mobotix path = MJPEG-in → H.264-out (heavy CPU/GPU). Bambu path with `#video=copy` = passthrough = ~zero CPU; LQ stream re-encode is light.

**Open questions for phase-time research:**
- Bambu H2C native bitrate / resolution? (impacts Protect storage planning, downstream of architecture)
- Does the H2C stream survive 24/7, or does the printer drop the RTSPS connection during print idle? `#raw=-reconnect 1` covers transient drops, but a stream the printer actively closes may need keepalive logic.
- Default LXC sizing (1 vCPU / 512MB) is sufficient if `#video=copy` works. If forced to re-encode HQ, match Mobotix sizing.

### 7. Build Order — Phase Slicing

Dependencies dictate order: schema first, then deploy pipeline, then UI on top.

**Phase A — Foundation (credentials + discovery)**
- Decide credential strategy (Option A vs B) and apply schema if B
- Add `'bambu'` to type unions across `types.ts`, `DiscoveredCamera['type']`
- Extend discovery scanner with TLS-cert probe
- Add `testBambuConnection` (mirrors `testMobotixConnection` — ffprobe over RTSPS via existing SSH-to-Proxmox pattern)
- Branch `/api/onboarding/test-connection` on `cameraType`
- Smoke test: discovery returns Bambu IP; manual API call to `test-connection` returns success

**Phase B — Stream Pipeline (LXC + go2rtc)**
- Add `generateGo2rtcConfigBambu` in `go2rtc.ts`
- Add `'bambu'` branch in `configureGo2rtc`
- Skip nginx (no `configureNginx` for Bambu)
- Reuse `configureOnvif` with no-audio flag (rename `isLoxone` → `hasAudio`)
- End-to-end via existing API endpoints: create container → configure go2rtc → configure ONVIF → verify-stream returns active
- **Gate:** stream visible at `rtsp://<container_ip>:8554/cam-<vmid>` AND adopted in Protect

**Phase C — Wizard UI + Polish**
- New Bambu credential step component (Access Code input, optional Serial)
- Wire wizard router to detect `type === 'bambu'` from discovery and route to the new step
- Type-specific labels/help-text in summary screens
- (Optional) Cloud fallback toggle if Option B + cloud RTSPS path is in scope

**Phase D (optional) — Extraction refactor**
- If Bambu logic spans >50 LOC across 3+ files, extract to `src/lib/server/services/bambu.ts` to mirror an emerging `services/<type>.ts` convention (would also justify back-extracting Mobotix/Loxone helpers in v1.3).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adding nginx for RTSPS auth-stripping

**What people do:** Mirror the Loxone pattern and put nginx (or stunnel) in front of go2rtc to terminate TLS.
**Why wrong:** ffmpeg (and thus go2rtc) speaks TLS natively. Adding stunnel/nginx adds a process, a config surface, and a failure mode for zero benefit.
**Do instead:** Pass `rtsps://` directly to ffmpeg with `-tls_verify 0`.

### Anti-Pattern 2: Hardcoding `username='bblp'` everywhere

**What people do:** Force the username column to be `'bblp'` for Bambu, leaving downstream code confused why a "username" field exists.
**Why wrong:** Conflates protocol-required magic strings with user-managed credentials.
**Do instead:** With Option A, set `username='bblp'` automatically inside `saveCameraRecord` and hide the field in the wizard. With Option B, drop `username` for Bambu rows.

### Anti-Pattern 3: Re-encoding the H.264 stream when passthrough works

**What people do:** Copy the Mobotix VAAPI re-encode template wholesale.
**Why wrong:** Wastes GPU cycles and risks degraded image quality. The Bambu stream is already H.264 in a Protect-friendly profile.
**Do instead:** `#video=copy` for HQ, VAAPI only for the LQ downscale.

## Integration Points

### External Services

| Service | Integration | Notes |
|---------|-------------|-------|
| Bambu printer LAN API | RTSPS :322 (TLS, self-signed) | URL: `rtsps://bblp:<code>@<ip>:322/streaming/live/1` |
| Bambu printer mDNS (optional) | `_bambulab._tcp` | Skip — TLS-cert probe is simpler |
| Bambu Cloud (out of LAN scope) | MQTT bridge + cloud RTSPS | Defer to Phase C optional |

### Internal Boundaries

| Boundary | Communication | Notes for Bambu |
|----------|---------------|-----------------|
| Wizard UI ↔ /api/onboarding/* | HTTP JSON (existing) | Add `cameraType: 'bambu'` to existing payloads |
| onboarding.ts ↔ go2rtc.ts | Function calls | New `generateGo2rtcConfigBambu` export |
| onboarding.ts ↔ ssh.ts | Existing (Proxmox SSH) | No changes |
| go2rtc service ↔ Bambu printer | RTSPS over LAN | New egress flow from LXC |
| go2rtc ↔ Protect | RTSP :8554 (existing) | No changes |

## Files Where New Code Lands (verified paths)

- `src/lib/types.ts` — type union extension
- `src/lib/server/db/schema.ts` — (Option B only) add `serialNumber`, `accessCode`, `authMode`
- `src/routes/api/discovery/+server.ts` — bash probe + enum
- `src/lib/server/services/onboarding.ts` — `testBambuConnection`, branches in `configureGo2rtc`/`configureOnvif`, conditional skip of `configureNginx`
- `src/lib/server/services/go2rtc.ts` — `generateGo2rtcConfigBambu`
- `src/routes/api/onboarding/test-connection/+server.ts` — type-branch dispatcher
- `src/routes/kameras/onboarding/*` — new credential step component
- (optional new) `src/lib/server/services/bambu.ts` — extraction target

## Sources

- Verified: `src/lib/server/db/schema.ts`, `src/lib/server/services/go2rtc.ts`, `src/lib/server/services/onboarding.ts`, `src/routes/api/discovery/+server.ts`, `.planning/PROJECT.md`
- [go2rtc source formats — RTSP/RTSPS support](https://github.com/AlexxIT/go2rtc#source-rtsp) — `rtsps://` is a supported source scheme
- [HA Bambu Lab integration — LAN RTSPS URL pattern](https://github.com/greghesp/ha-bambulab) — confirms `rtsps://bblp:<code>@<ip>:322/streaming/live/1`
- ffmpeg `-tls_verify 0` for self-signed TLS sources — ffmpeg TLS protocol docs

---
*Architecture research for: IP-Cam-Master v1.2 Bambu H2C integration*
*Researched: 2026-04-13*
