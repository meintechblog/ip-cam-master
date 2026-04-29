# Stack Research — v1.3 Protect Stream Hub

**Domain:** UniFi Protect → MJPEG/RTSP bridge (Loxone + Frigate-ready)
**Researched:** 2026-04-30
**Confidence:** HIGH

> Scope: This file lists ONLY new dependencies / version bumps / configuration patterns
> required for v1.3. The base stack (SvelteKit 2.55 / Svelte 5 / Node 22 / TS 5.9 /
> better-sqlite3 / Drizzle / Tailwind / proxmox-api / node-ssh / mqtt) is unchanged
> and lives in `.planning/research/STACK.md` (root, milestone-agnostic).

---

## TL;DR — What's actually new

| Capability | Verdict |
|---|---|
| Per-camera Protect stream catalog (channels with codec/res/fps) | **Add `unifi-protect@^4.29.0` npm dep** — replaces hand-rolled `protect.ts` `fetch()` calls for *write* operations; existing `protect.ts` is kept for *read* (already works, no need to rip out). |
| Toggle "RTSP sharing" per camera via API | **`unifi-protect.enableRtsp(camera)` covers it** — emits `PATCH /proxy/protect/api/cameras/{id}` with `{ channels: [...] }`. No raw API needed. |
| Single bridge container hosting n streams (MJPEG + RTSP simultaneously) | **No new dep — existing go2rtc covers it natively.** Pin to `go2rtc >= 1.9.10` (we use latest already). One process, one yaml, both APIs (`:1984` HTTP + `:8554` RTSP) live side-by-side. |
| YAML generation for go2rtc.yaml | **Add `yaml@^2.6.0` (eemeli/yaml).** Cleaner than string-templating; preserves comments; TS 5.9 compatible. |
| Frigate consumability of our `rtsp://bridge:8554/<cam>-high` | **No code change — passthrough h264 copy is exactly what Frigate's `preset-rtsp-restream` expects.** Documentation snippet only. |
| Loxone consumability of our `http://bridge:1984/api/stream.mjpeg?src=<cam>-low` | **No code change — single MJPEG @ 640×360@10fps via Custom Intercom ("Benutzerdefinierte Intercom") is the validated contract** (meintechblog 2025-11-07). NOT Motion Shape Extreme. |

---

## 1. UniFi Protect — `unifi-protect` npm lib (NEW dep)

### 1.1 What we have today

`src/lib/server/services/protect.ts` does:
- Manual login → cookie + `x-csrf-token` capture (8-min session cache)
- `protectFetch(path)` → GET `/proxy/protect/api/{path}` with retry-on-401
- `getProtectCameras()` → returns array of cameras (read-only)

This works for v1.0/v1.1/v1.2 use cases (status monitoring of *adopted* cameras). It does **not** expose:
- Per-channel structure (low/medium/high with codec/res/fps/bitrate/rtspAlias)
- Any write/PATCH path
- Real-time WebSocket events on adoption changes

### 1.2 Recommended addition

| Library | Version | Purpose | Why |
|---|---|---|---|
| `unifi-protect` | `^4.29.0` | Typed Protect API client | First-class `enableRtsp(camera)` call. Bootstrap returns `camera.channels[]` with all fields we need. Built on `undici` (no axios). Active maintenance (hjdhjd, ships ~monthly). Same author as `homebridge-unifi-protect` — battle-tested in HomeKit production. |
| `undici` | (transitive, `8.0.2`) | HTTP/2 client | Pinned by `unifi-protect`. Already part of Node 22 std lib but the lib brings its own pinned undici for stable behavior. |

**Engine requirement:** `node >= 22` — we already meet this.

### 1.3 The exact API surface we need

Verified by reading [src/protect-api.ts](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts) (lines 1090–1212):

```typescript
import { ProtectApi } from "unifi-protect";

const protect = new ProtectApi();
await protect.login("192.168.3.1", "admin", "<password>");
await protect.getBootstrap();

const cameras = protect.bootstrap?.cameras ?? [];

for (const camera of cameras) {
  // 1. Read the catalog (already populated by getBootstrap)
  for (const ch of camera.channels) {
    console.log({
      idx: ch.id,
      isRtspEnabled: ch.isRtspEnabled,   // <-- the toggle
      rtspAlias: ch.rtspAlias,           // <-- "yb7VcjRqgo6ax63b" (per-channel GUID)
      width: ch.width, height: ch.height,
      fps: ch.fps,
      codec: ch.codec,                   // "h264" | "h265"
      bitrate: ch.bitrate,
    });
    // RTSP URL: rtsp://<NVR_IP>:7447/<rtspAlias>
  }

  // 2. Toggle RTSP sharing on (writes ALL channels at once)
  const updated = await protect.enableRtsp(camera);
  // Internally PATCHes /proxy/protect/api/cameras/{id}
  // with body { channels: [...all channels with isRtspEnabled:true] }
}
```

**Key facts** (verified against source):

- Protect RTSP server runs on port **`:7447`** (NOT 7441 / NOT `rtsps:`). The `rtsps://*:7441/...?enableSrtp` URL is for the *encrypted* variant; for go2rtc passthrough we want the plain one on `:7447`. (The meintechblog post confirms this URL transformation.)
- `enableRtsp()` is idempotent — early-returns if all channels already enabled.
- `enableRtsp()` flips ALL channels at once. There is NO documented per-channel toggle in the lib. If we want fine-grained control (e.g., only enable High, not Medium/Low), we use `updateDevice(camera, { channels: [...selected...] })` directly.
- Auth: `login()` handles cookie + CSRF dance internally — replaces our hand-rolled session in `protect.ts`.
- Permissions: requires Super Admin / Administrator role on the Protect user. Returns `403` otherwise; lib logs and falls back gracefully.

### 1.4 Migration pattern (don't rip out protect.ts)

| Existing read path | v1.3 plan |
|---|---|
| `getProtectCameras()` for `/cameras` page status | **Keep** — already cached 30s, no need to change. |
| `protectFetch(path)` for misc reads | **Keep** for v1.3 reads not yet covered by lib. |
| RTSP enable + channel catalog | **NEW** — add `src/lib/server/services/protect-bridge.ts` that uses `ProtectApi`. |

Two clients side-by-side is fine. Long-term we can collapse, but v1.3 should NOT take that risk.

### 1.5 Sources

- [`unifi-protect` on GitHub](https://github.com/hjdhjd/unifi-protect) — v4.29.0, hjdhjd, 2026-04
- [`ProtectApi.md` documentation](https://github.com/hjdhjd/unifi-protect/blob/main/docs/ProtectApi.md) — full method signatures
- [Source: `src/protect-api.ts` lines 1090–1212](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts) — verified `enableRtsp` + `updateCameraChannels` PATCH behavior
- [`unifi-protect` on npm](https://www.npmjs.com/package/unifi-protect) — published versions

**Confidence: HIGH** — verified against library source, not just docs.

---

## 2. go2rtc — version pinning + multi-output (no new dep)

### 2.1 Verdict

**No code change. No new lib. We already deploy go2rtc to LXC containers via SSH** (existing pattern from v1.0 Phase 02). For v1.3 we reuse the exact same deploy mechanism, but with a different yaml shape (n streams in one container instead of 1 stream per container).

### 2.2 Version to pin

| Component | Version | Reason |
|---|---|---|
| go2rtc binary | `>= 1.9.10`, recommend pinning to `1.9.14` (current latest, 2026-01-19) | 1.9.10 is what the Frigate restream docs reference as the stable contract; 1.9.14 has bug fixes for RTSP keepalive that matter when one bridge serves multiple long-lived consumers. |

We can keep "latest tag from GitHub releases" install pattern from v1.0 — just bump the version variable.

### 2.3 Confirmed: one process, two server endpoints, n streams

Single yaml file, single binary process, both endpoints active:

```yaml
api:
  listen: ":1984"        # HTTP API + MJPEG + WebRTC + snapshot
rtsp:
  listen: ":8554"        # native RTSP server

streams:
  # Loxone-bound: low-quality MJPEG via ffmpeg transcode
  spielturm-low:
    - "exec:ffmpeg -hide_banner -loglevel error -rtsp_transport tcp \
        -i rtsp://192.168.3.1:7447/yb7VcjRqgo6ax63b \
        -an -vf scale=640:360,fps=10 -q:v 5 -f mpjpeg pipe:1"

  # Frigate-bound: high-quality h264 passthrough (no transcode)
  spielturm-high:
    - "rtsp://192.168.3.1:7447/9F2pK3LzM0qXr4Bh"

  # Optional: medium for HomeAssistant later
  spielturm-medium:
    - "rtsp://192.168.3.1:7447/4A1nQ8WtV2sYf6Jp"
```

This produces:
- `http://<bridge>:1984/api/stream.mjpeg?src=spielturm-low` → Loxone consumer
- `rtsp://<bridge>:8554/spielturm-high` → Frigate consumer
- `rtsp://<bridge>:8554/spielturm-medium` → other consumers

Multiple consumers of the same stream do **not** cause duplicate upstream pulls — go2rtc fans out internally.

### 2.4 Hardware acceleration (VAAPI)

For the Loxone-bound MJPEG transcode we DON'T need VAAPI (640×360@10fps software is ~2% CPU per stream — negligible up to ~20 streams on the existing hardware).

For any future re-encode path (e.g., transcoding 4K H.265 → H.264 for HomeAssistant), use the existing VAAPI pattern from v1.0:

```yaml
streams:
  cam-transcoded:
    - "ffmpeg:rtsp://192.168.3.1:7447/<alias>#video=h264#hardware=vaapi"
```

Requires `/dev/dri/renderD128` passthrough into the LXC (already wired for v1.0/v1.2 containers — reuse the same template).

**Important caveat:** go2rtc's `#hardware` flag covers H.264 only (`#video=h265` not supported via `#hardware` per the wiki). For h265 sources from Protect we'd `#video=copy` (passthrough) rather than transcode. For v1.3 this is fine — Loxone gets MJPEG (always transcoded), Frigate gets RTSP copy (no codec restriction).

### 2.5 Programmatic yaml generation

| Library | Version | Purpose |
|---|---|---|
| `yaml` (eemeli/yaml) | `^2.6.0` | Stringify a TS object → go2rtc.yaml |

Why this over hand-templating:
- We have ~6+ keys per stream entry, multi-line `exec:` strings, optional sections (`api`, `rtsp`, `log`). Hand-templating produces fragile escapes.
- `yaml` library preserves block-scalar formatting (`|` for `exec:` commands) cleanly.
- Min TS version 5.9 (we're at 5.9.3 — compatible).
- Zero runtime dependencies.
- Round-trip safe: we can `parse()` a deployed yaml, diff against desired state, and `stringify()` back. Critical for the auto-reconciliation loop ("did someone hand-edit the yaml in the container?").

Why NOT `js-yaml`: also fine, but `yaml` (eemeli) has better TS types and is the actively-maintained choice in the ecosystem (see Deno docs, which use it). No strong reason to mix them.

Why NOT a "go2rtc-specific schema lib": none exists with critical mass. We define our own typed shape in TS and validate the output ourselves (we don't need to validate user-supplied yaml — we generate it).

### 2.6 Sources

- [go2rtc README on GitHub](https://github.com/AlexxIT/go2rtc) — supports RTSP, MJPEG, WebRTC, HLS, HomeKit; one process, n streams
- [go2rtc MJPEG module README](https://github.com/AlexxIT/go2rtc/blob/master/internal/mjpeg/README.md) — endpoint pattern `/api/stream.mjpeg?src=<name>` confirmed
- [go2rtc Hardware-acceleration wiki](https://github.com/AlexxIT/go2rtc/wiki/Hardware-acceleration) — `#hardware=vaapi` flag, h265 limitation
- [go2rtc multi-output discussion #426](https://github.com/AlexxIT/go2rtc/issues/426) — fan-out from one source to n consumers
- [meintechblog Loxone howto, 2025-11-07](https://meintechblog.de/2025/11/07/howto-unifi-protect-videofeed-in-loxone-einbinden/) — verbatim go2rtc config that works in production
- [eemeli/yaml on GitHub](https://github.com/eemeli/yaml) — `yaml` npm v2.x, parse/stringify
- [`yaml` on npm](https://www.npmjs.com/package/yaml)

**Confidence: HIGH** — config pattern verified against meintechblog post (which the user himself authored / consumed).

---

## 3. Frigate compatibility (no code change in our app)

### 3.1 Verdict

**Our `rtsp://bridge:8554/<cam>-high` is exactly what Frigate's `preset-rtsp-restream` is designed to consume.** This is a *documentation* deliverable in v1.3 — we add a "Frigate snippet" to the cam detail page. No app code or new lib.

### 3.2 The contract Frigate expects

Frigate consumes external go2rtc-restreamed RTSP via:

```yaml
# Frigate config.yml on the Frigate host
go2rtc:
  streams:
    spielturm:
      - rtsp://<bridge-ip>:8554/spielturm-high   # <-- our bridge URL

cameras:
  spielturm:
    ffmpeg:
      inputs:
        - path: rtsp://127.0.0.1:8554/spielturm
          input_args: preset-rtsp-restream
          roles: [detect, record]
```

Constraints we must honor on the bridge side:
- **Codec:** Frigate works best with **H.264**. H.265 works but causes browser playback issues in Frigate's live UI. → Pass through H.264 unchanged (cheapest), and add a UI hint when a Protect channel is H.265 ("Frigate compatibility: limited — consider transcoding").
- **Transport:** RTSP/TCP is preferred for stability over UDP (Frigate's `preset-rtsp-restream` defaults to TCP via `-rtsp_transport tcp`).
- **Audio:** AAC required for Frigate's recording/restream. UniFi Protect cameras emit AAC by default (Talkback/two-way audio is separate). For Loxone (MJPEG, no audio) this is irrelevant; for Frigate-bound RTSP we pass through whatever Protect sends — almost always AAC.
- **Reconnection:** go2rtc handles auto-reconnect on the upstream RTSP; Frigate's `preset-rtsp-restream` has built-in `-stimeout` and reconnect args. No tuning needed on our side.

### 3.3 What about `#video=copy`?

For the high-quality Frigate stream we pass through the source URL without an `ffmpeg:` prefix:

```yaml
streams:
  spielturm-high:
    - "rtsp://192.168.3.1:7447/<alias>"   # passthrough, no transcode
```

`#video=copy` becomes relevant only when we want to RE-CONTAINER (e.g., RTSP → WebRTC) without re-encoding. For the Frigate path we're RTSP-in / RTSP-out, so the simpler "no ffmpeg layer at all" is correct and uses the least CPU.

### 3.4 Sources

- [Frigate Restream docs](https://docs.frigate.video/configuration/restream/) — codec passthrough rationale
- [Frigate "Configuring go2rtc" guide](https://docs.frigate.video/guides/configuring_go2rtc/) — `preset-rtsp-restream`, H.264 preference
- [Frigate FFmpeg presets](https://docs.frigate.video/configuration/ffmpeg_presets/) — `preset-rtsp-restream` body
- [Frigate discussion #19395 — chained Frigate→Frigate via go2rtc](https://github.com/blakeblackshear/frigate/discussions/19395) — same pattern as our bridge→Frigate setup

**Confidence: HIGH** — Frigate documents this exact pattern (Frigate↔Frigate via go2rtc); our case is identical with a non-Frigate publisher.

---

## 4. Loxone Motion Shape Extreme — what's the actual contract?

### 4.1 Verdict

**Loxone uses "Benutzerdefinierte Intercom" (Custom Intercom), NOT the "Motion Shape Extreme" component, for arbitrary MJPEG cameras.** "Motion Shape Extreme" is the camera *hardware* product (the Loxone-branded outdoor cam); it is unrelated to the integration component for *external* cameras.

This is a milestone-language clarification more than a stack issue — we should rename internal docs/UI labels accordingly.

### 4.2 The exact stream contract (from meintechblog 2025-11-07, validated)

| Property | Value | Source |
|---|---|---|
| Protocol | HTTP | meintechblog |
| Encoding | MJPEG (multipart/x-mixed-replace) | meintechblog |
| Resolution | **640×360** (low) | meintechblog (matches Loxone's iOS/web app sizing) |
| Frame rate | **10 fps** | meintechblog |
| JPEG quality | `-q:v 5` (medium) | meintechblog |
| URL format | `http://<bridge>:1984/api/stream.mjpeg?src=<cam>-low` | go2rtc native |
| Auth | None (LAN-trusted, no embedded creds) | meintechblog + chromium-creds-deprecation note |
| Stream count | **Single low stream** — same URL for "intern" and "extern" fields in Loxone Config | meintechblog |

**Authoritative go2rtc config for the Loxone path** (verbatim from the blog post):

```yaml
streams:
  spielturm: "exec:ffmpeg -hide_banner -loglevel error -rtsp_transport tcp \
    -i rtsp://192.168.3.1:7447/yb7VcjRqgo6ax63b \
    -an -vf scale=640:360,fps=10 -q:v 5 -f mpjpeg pipe:1"
```

Key flag justifications:
- `-rtsp_transport tcp` — Protect's RTSP-on-`:7447` is reliable on TCP, UDP causes frame drops over the LAN.
- `-an` — drop audio (Loxone Custom Intercom doesn't render audio from the MJPEG endpoint).
- `-vf scale=640:360,fps=10` — match Loxone's expected pixel budget; higher rates cause stutter in the Loxone iOS app.
- `-q:v 5` — JPEG quality 5 (1=best, 31=worst). 5 is a good battery vs. quality tradeoff for the small Loxone viewport.
- `-f mpjpeg pipe:1` — produce multipart-MJPEG to stdout, which go2rtc's `exec:` source ingests.

### 4.3 Single vs dual stream — INFERENCE

**Inference (LOW-MEDIUM confidence):** The blog post uses a single low stream and confirms it works. We have no contradicting source from official Loxone docs that would mandate a dual-stream setup. Loxone's Custom Intercom UI exposes "URL Videostream (intern)" and "URL Videostream (extern)" as **two text fields**, but these are about *network reachability* (LAN-internal vs WAN-external URL), not low-quality vs high-quality.

**Recommendation for v1.3:** Ship single-stream as the default, design the data model to *allow* a future high-stream URL but don't expose it in the wizard. If future feedback shows Loxone's tablet interface wants higher quality, we add a second go2rtc entry — zero rework needed because the bridge already supports it.

### 4.4 Sources

- [meintechblog UniFi → Loxone howto, 2025-11-07](https://meintechblog.de/2025/11/07/howto-unifi-protect-videofeed-in-loxone-einbinden/) — verbatim working config (PRIMARY)
- [meintechblog Loxone Intercom → UniFi howto, 2025-10-07](https://meintechblog.de/2025/10/07/howto-loxone-intercom-videofeed-in-unifi-protect-einbinden/) — confirms the existing reverse-direction `mjpg/video.mjpg` URL pattern
- [LoxWiki — Webcams/Videokameras](https://loxwiki.atlassian.net/wiki/spaces/LOX/pages/1517355534/Webcams+Videokameras) — Loxone door station accepts MJPEG, no explicit res/fps cap
- [Loxone forum — Intercom Livestream als URL?](https://www.loxforum.com/forum/german/software-konfiguration-programm-und-visualisierung/405858-loxone-intercom-livestream-als-url) — community confirmation of MJPEG-over-HTTP requirement
- [LoxWiki — Kamera ohne MJPEG Stream im Türsteuerungsbaustein](https://loxwiki.atlassian.net/wiki/spaces/LOX/pages/1524105222) — fallback pattern (FFmpeg conversion server) when source is RTSP-only
- [Lukas Klein — Using your Unifi cameras in Loxone](https://medium.com/@lukas.klein/using-your-unifi-cameras-in-loxone-a777a17c139c) — alternative recipe (cvlc-based, 15fps), independent confirmation that single-MJPEG works

**Confidence:**
- "Single MJPEG, 640×360, 10fps, Custom Intercom component" → **HIGH** (meintechblog post, the user's own reference)
- "No dual-stream needed" → **MEDIUM (inferred)** — flag for confirmation during the wizard build

---

## Full Dependency Delta (vs current `package.json`)

```bash
# Add (production)
npm install unifi-protect@^4.29.0 yaml@^2.6.0
```

**That's it.** Two new dependencies for the entire milestone:

| Package | Why | Replaces |
|---|---|---|
| `unifi-protect@^4.29.0` | Channel catalog, `enableRtsp()` | Hand-rolled write paths only — existing read-side `protect.ts` stays |
| `yaml@^2.6.0` | go2rtc.yaml stringify/parse | Hand-templated yaml strings (none exist yet for multi-stream config) |

No version bumps required for any existing dep — Node 22 / Svelte 5 / Drizzle 0.45 / better-sqlite3 12.6 / proxmox-api 1.1.1 / node-ssh 13.2 / mqtt 5.15 are all current and compatible.

---

## What NOT to add

| Avoid | Why | Use Instead |
|---|---|---|
| `js-yaml` | Older API, weaker TS types | `yaml` (eemeli) |
| `axios` for Protect calls | `unifi-protect` brings undici; Node 22 has fetch | Lib's built-in HTTP client |
| Embedding go2rtc as a Node child process | Shipped binary in LXC is the existing pattern, debuggable, cgroup-isolated | Keep deploying go2rtc inside the LXC bridge container |
| A separate "Loxone integration" lib | None of substance exists; the contract is just MJPEG-over-HTTP | Plain go2rtc URL — Loxone consumes it directly |
| Schema-validated go2rtc.yaml lib | No critical-mass community lib; we own the config shape | Internal TS types + `yaml.stringify()` |
| `unifi-cam-proxy` | Solves a different problem (adopt non-Ubiquiti cams INTO Protect) | We're going the other direction (Protect OUT to Loxone/Frigate) |
| `homebridge-unifi-protect` | HomeKit-specific bridge, not for our use | Use `unifi-protect` lib directly (same author, same Protect API surface) |

---

## Stack Patterns by Variant

**If a Protect cam reports H.265 codec on its high channel:**
- Pass through to Frigate as-is (Frigate accepts H.265 with caveats for browser playback).
- For Loxone-MJPEG path the source codec is irrelevant (we always transcode to MJPEG).
- Surface in UI: "Frigate compatibility: H.265 — browser live view in Frigate may stutter."

**If a Protect cam has only 1 RTSP channel enabled (some old cams):**
- `enableRtsp()` is a no-op for already-enabled channels and enables all available — handles this transparently.
- Catalog will show fewer entries. UI gracefully shows "1/3 channels available."

**If the user's UniFi user lacks Super Admin:**
- `enableRtsp()` returns `null` (we read this as "permission denied").
- UI fallback: "Auto-enable failed — please enable RTSP manually in Protect: Settings → Camera → RTSP. Or use a Super Admin account."

**If go2rtc upstream connection drops (Protect NVR reboot):**
- go2rtc auto-reconnects with exponential backoff (built-in, no tuning).
- Bridge container itself stays up; downstream consumers (Loxone/Frigate) see a momentary frame stall, then recover.

---

## Version Compatibility Matrix

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `unifi-protect@4.29.0` | `node >= 22` | We have Node 22 LTS | Single transitive: `undici@8.0.2` — coexists with Node 22's built-in fetch fine |
| `yaml@2.6.0` | `typescript >= 5.9` | We have TS 5.9.3 | Zero runtime deps |
| `go2rtc 1.9.14` | UniFi Protect 5.x RTSP on `:7447` | Tested in production by user (meintechblog) | h265 source: `#video=copy` only, no `#hardware` accel for h265 encode |
| Existing `protect.ts` (manual fetch) | Coexists with `unifi-protect` lib | Two clients side-by-side OK | Same Protect REST surface |

---

## Sources Index (de-duplicated)

**UniFi Protect:**
- [`unifi-protect` GitHub repo](https://github.com/hjdhjd/unifi-protect)
- [`unifi-protect` npm](https://www.npmjs.com/package/unifi-protect)
- [`ProtectApi.md`](https://github.com/hjdhjd/unifi-protect/blob/main/docs/ProtectApi.md)
- [Source: `protect-api.ts`](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts) (verified `enableRtsp` + `updateCameraChannels`)

**go2rtc:**
- [go2rtc README](https://github.com/AlexxIT/go2rtc)
- [go2rtc MJPEG module](https://github.com/AlexxIT/go2rtc/blob/master/internal/mjpeg/README.md)
- [go2rtc Hardware-acceleration wiki](https://github.com/AlexxIT/go2rtc/wiki/Hardware-acceleration)
- [Multi-output discussion #426](https://github.com/AlexxIT/go2rtc/issues/426)

**Frigate:**
- [Frigate Restream docs](https://docs.frigate.video/configuration/restream/)
- [Frigate "Configuring go2rtc"](https://docs.frigate.video/guides/configuring_go2rtc/)
- [Frigate FFmpeg presets](https://docs.frigate.video/configuration/ffmpeg_presets/)
- [Frigate discussion #19395](https://github.com/blakeblackshear/frigate/discussions/19395)

**Loxone:**
- [meintechblog UniFi→Loxone howto, 2025-11-07](https://meintechblog.de/2025/11/07/howto-unifi-protect-videofeed-in-loxone-einbinden/) — PRIMARY source for the working contract
- [meintechblog Loxone Intercom→UniFi howto, 2025-10-07](https://meintechblog.de/2025/10/07/howto-loxone-intercom-videofeed-in-unifi-protect-einbinden/)
- [LoxWiki Webcams/Videokameras](https://loxwiki.atlassian.net/wiki/spaces/LOX/pages/1517355534/Webcams+Videokameras)
- [LoxWiki Kamera ohne MJPEG fallback](https://loxwiki.atlassian.net/wiki/spaces/LOX/pages/1524105222)
- [Lukas Klein on Medium — Unifi cameras in Loxone](https://medium.com/@lukas.klein/using-your-unifi-cameras-in-loxone-a777a17c139c)

**Tooling:**
- [`yaml` (eemeli/yaml) GitHub](https://github.com/eemeli/yaml)
- [`yaml` on npm](https://www.npmjs.com/package/yaml)

---

## Open Questions for spec/discuss phase

1. **Scope of `enableRtsp()` granularity.** Do we want all-channels-on (lib default) or per-channel control (use `updateDevice` with hand-built `channels[]`)? Recommendation: ship all-on for v1.3, document per-channel as a v1.4 feature if user demand surfaces.

2. **Loxone dual-stream confirmation.** During the wizard's first-cam setup, ask the user to test the live feed in the Loxone app. If they report stutter, we know we need a higher-quality option. Otherwise, single-stream stays the default.

3. **`unifi-protect` lib vs hand-rolled `protect.ts` long-term posture.** v1.3 keeps both. Question for a future roadmap: deprecate `protect.ts` reads in v1.4 once the lib has proven stable in production. Not a v1.3 decision.
