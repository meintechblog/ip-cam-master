# Stack Research — v1.2 Bambu Lab H2C Integration

**Domain:** Bambu Lab 3D-printer camera integration into existing IP-Cam-Master (SvelteKit + Proxmox LXC + go2rtc + UniFi Protect)
**Researched:** 2026-04-13
**Confidence:** MEDIUM-HIGH (RTSPS-via-go2rtc proven by community; bambu-node npm lib stale → cautious adoption)

## Scope

This is a **delta on the existing v1.0/v1.1 stack** — only additions for the Bambu H2C camera type are listed. Everything else (SvelteKit, Drizzle, proxmox-api, node-ssh, unifi-protect, AES-256-GCM credential store) is unchanged and re-used.

## Recommended Additions

### Stream Transcoding (go2rtc — already installed, new config pattern)

| Item | Version | Purpose | Why |
|------|---------|---------|-----|
| go2rtc `rtspx://` URL scheme | go2rtc ≥ 1.8 (already deployed) | Consume Bambu RTSPS stream on port 322 with self-signed cert | go2rtc's `rtsps://` scheme verifies the TLS cert against the URL host; Bambu's printer cert has no SAN matching the IP/hostname → handshake fails. The `rtspx://` scheme is the documented community workaround that performs an RTSPS connection but **skips certificate verification** (analogue to UniFi NVR pattern). Confirmed in HA `ha-bambulab` issue #1798 and Frigate/go2rtc community guides. |
| ffmpeg+VAAPI in existing LXC template | (already installed) | Transcode Bambu H.264 stream to constrained baseline for UniFi Protect adoption | Bambu's stream is already H.264 (unlike Mobotix MJPEG). May only need re-mux, not full re-encode — saves CPU. Keep VAAPI path as fallback if Protect rejects the bitstream profile. |

**Reference go2rtc.yaml stanza (template the app will generate):**

```yaml
streams:
  bambu_h2c:
    # rtspx = RTSPS without TLS verification (self-signed cert workaround)
    - rtspx://bblp:{{ACCESS_CODE}}@{{PRINTER_IP}}:322/streaming/live/1
    # Try copy first; fall back to VAAPI re-encode if Protect rejects profile
    - "ffmpeg:bambu_h2c#video=copy#audio=copy"
```

If UniFi Protect rejects the copied stream, fall back to the same VAAPI ffmpeg pattern already used for Mobotix:

```yaml
    - "ffmpeg:bambu_h2c#video=h264#hardware=vaapi#raw=-r 15#raw=-g 30"
```

**Critical detail:** Use the printer's **IP address**, not hostname/mDNS name. Even with `rtspx://`, hostname-vs-cert mismatches have caused connector confusion in some go2rtc builds (HA issue #1798).

---

### Bambu LAN-Mode MQTT Client

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **`mqtt`** (npm) | 5.10+ | Generic MQTT 3.1.1 client over TLS to printer port 8883 | **Recommended over `bambu-node`.** Bambu's LAN protocol is plain MQTT-over-TLS with username `bblp` + password = Access Code; topics `device/<serial>/request` (publish) and `device/<serial>/report` (subscribe). The `mqtt` package is the de-facto Node.js MQTT client (8M+ weekly downloads), actively maintained, supports `rejectUnauthorized: false` for the printer's self-signed cert. We need only ~5 message types (push_status, info, optional control) — wrapping these directly is ~150 LOC and avoids a dead-weight dependency. |
| ~~`bambu-node`~~ | last publish ≈ April 2025 (~12 months stale) | Typed Bambu LAN/cloud MQTT wrapper | **Do NOT adopt as direct dependency.** Last published ~1 year ago; only a handful of dependents; no 1.0 release. **Use as a reference implementation** (TypeScript types for the JSON message schema are gold) but vendor the relevant types into `src/lib/bambu/types.ts` rather than depending on an unmaintained package — the same discipline applied to Mobotix/Loxone in v1.0. |

**Why not the alternatives:**
- `@hiv3d/bambu-node` — fork, even less traction, not visibly maintained.
- `Evan-2007/bambu-link` — early-stage, no npm publish, GitHub-only.
- `cryptiklemur/node-bambu` — abandoned.
- Python `pybambu` (greghesp/ha-bambulab core) — best-maintained reference but wrong runtime; use **only** as protocol documentation source.

**Integration point:** New module `src/modules/bambu/lan-client.ts` — sits next to existing camera-type adapters. Connection life-cycle (connect, subscribe, JSON parse, status emit) hooks into the same camera status SSE bus already used by Mobotix/Loxone in v1.1.

---

### Cloud-Mode Fallback (deferred, design hook only)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **`mqtt`** (same lib, different broker URL) | 5.10+ | Connect to `mqtts://us.mqtt.bambulab.com:8883` with JWT-as-password | Same MQTT client; cloud differs only in (a) broker hostname, (b) auth = JWT obtained via Bambu account REST login + 2FA email code. Library coverage in JS/TS for the **auth flow** is essentially zero — `pybambu` is the only complete reference. |
| built-in `fetch` | Node 22 LTS | Bambu Connect REST endpoints (`/api/sign-in/form`, `/api/sign-in/tfa`) | No extra dep needed. |

**Recommendation:** Ship v1.2 with **LAN mode only.** Cloud mode is a much larger surface (account auth, JWT refresh, region routing, captcha risk) for a minority use-case (the user explicitly has LAN access). Mark cloud mode in PROJECT.md as v1.3+ candidate. The design hook should be a `BambuTransport` interface so cloud can plug in later without refactoring the LAN client.

---

### Discovery (extension to existing scanner)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Custom UDP listener** (`node:dgram`) | built-in | Listen for Bambu's non-standard SSDP-ish announcements on **UDP ports 1990 / 2021** (NOT standard 1900) | Bambu printers broadcast NOTIFY messages with service type `urn:bambulab-com:device:3dprinter:1` on non-standard ports. `node-ssdp` will not work out of the box because of port mismatch — recommend a **~40 LOC custom UDP listener** in the existing scanner module (`src/modules/discovery/`), reusing the dgram pattern already in place for ARP-based discovery. References: `psychoticbeef/BambuLabOrcaSlicerDiscovery` and `Alex-Schaefer` gist (Python implementations to mirror). |
| ~~`bonjour-service` / `multicast-dns`~~ | — | mDNS lookup of `_bambulab._tcp` | **Skip.** Investigation shows Bambu does NOT publish a stable `_bambulab._tcp` mDNS service. Bambu Studio's "auto-discovery" is the SSDP mechanism above; references to mDNS in PROJECT.md are misattributions. Adding mDNS would yield false confidence. |
| Existing port-scanner | (already in repo) | Probe TCP **322 (RTSPS)** and **8883 (MQTTS)** alongside existing 554/80/443 probes | One-line addition. MAC OUI for Bambu Lab varies by SKU; safest path is **port + SSDP signature**, not OUI. |

**Integration point:** Add a `bambu-ssdp.ts` to the existing `src/modules/discovery/` directory. Emits to the same `DiscoveredDevice` event the Mobotix/Loxone scanners use. UI badge: "Bambu Lab H2C — LAN Mode required".

---

### Credential Storage (no new lib)

The existing AES-256-GCM credential store handles arbitrary string blobs. New row schema additions (in Drizzle):

| Field | Type | Notes |
|-------|------|-------|
| `bambuAccessCode` | encrypted text | 8-digit code from printer LCD → Settings → WLAN → Access Code |
| `bambuSerial` | text (not secret) | Printed on device + visible via SSDP NOTIFY payload |
| `bambuTransport` | enum `'lan'` | `'cloud'` reserved for v1.3 |

No new dependency.

---

## Installation Delta

```bash
# Only one new runtime dep:
npm install mqtt@^5.10.0

# That's it. Everything else is either:
#   - already installed (better-sqlite3, ssh2, proxmox-api, unifi-protect, go2rtc binary in LXC)
#   - a code-only addition (Bambu types vendored from bambu-node, custom SSDP listener)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `mqtt` + vendored types | `bambu-node` npm | Only if upstream resumes maintenance & cuts a 1.0 release |
| `mqtt` + vendored types | `pybambu` via Python sidecar | Never — would force a Python runtime into a Node-only deployment |
| `rtspx://` in go2rtc | Resolve hostname → IP, then `rtsps://` | If a future go2rtc release deprecates `rtspx://` (no signal of this) |
| Re-mux first (`#video=copy`) | Always full VAAPI re-encode | If Protect adoption errors out on the original H.264 profile |
| Custom SSDP listener on UDP 1990/2021 | `node-ssdp` library | Library targets standard port 1900; not worth a fork |
| LAN-only v1.2 | LAN+Cloud at launch | Defer — cloud auth is a significant separate milestone |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `bambu-node` as a direct dependency | ~12 months stale, no 1.0, tiny dependent count | Vendor the type definitions, use plain `mqtt` |
| Python `pybambu` bridge | Adds Python runtime to a Node-only one-line installer | Re-implement the ~5 message handlers in TS from `pybambu` reference |
| `rtsps://` with strict TLS | Bambu cert has no matching SAN → handshake fails | `rtspx://` (verification disabled) |
| mDNS / `_bambulab._tcp` service browsing | Service does not exist on Bambu printers | SSDP listener on UDP 1990/2021 |
| `node-ssdp` library default config | Hard-coded to standard port 1900 | Hand-rolled `node:dgram` listener on Bambu's non-standard ports |
| `unifi-cam-proxy` for Bambu | Designed for non-RTSP cameras; Bambu already speaks RTSP(S) | Standard go2rtc → RTSP :8554 → Protect adoption flow |
| Embedding go2rtc in app process | Existing pattern is "app generates yaml, deploys via SSH to LXC" | Keep that pattern; only the YAML template changes |
| A second MQTT client (e.g. `async-mqtt`, `mqtt-packet` directly) | `mqtt` already provides promises via `.connectAsync()` and a clean event API | Single `mqtt@5.x` for both LAN now and cloud later |

## Integration Map (where each piece slots into the existing architecture)

```
src/
├── modules/
│   ├── discovery/
│   │   ├── (existing arp + onvif scanners)
│   │   └── bambu-ssdp.ts            ← NEW: UDP 1990/2021 listener
│   ├── cameras/
│   │   └── adapters/
│   │       ├── mobotix.ts           (existing)
│   │       ├── loxone.ts            (existing)
│   │       └── bambu.ts             ← NEW: glue (credentials → go2rtc YAML)
│   └── bambu/                       ← NEW module
│       ├── lan-client.ts            (mqtt over TLS, port 8883)
│       ├── types.ts                 (vendored from bambu-node)
│       └── go2rtc-template.ts       (rtspx URL + ffmpeg stanza generator)
├── lib/
│   └── crypto/                      (existing — reused for access code)
└── routes/
    └── (onboarding/+page.svelte)    (extend to ask for serial + access code)
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `mqtt@5.10` | Node.js 22 LTS (already in stack) | Pure JS, no native bindings → safe for the one-line installer |
| `mqtt@5.10` | TLS `rejectUnauthorized: false` | Required for printer's self-signed cert on port 8883 |
| go2rtc current build | `rtspx://` scheme | Documented community workaround; verify on the deployed go2rtc binary version during Phase 1 |

## Confidence by Area

| Area | Confidence | Reason |
|------|------------|--------|
| RTSPS via go2rtc `rtspx://` | HIGH | Multiple community sources (HA issue #1798, go2rtc tutorials, Bambu wiki) confirm the pattern works for Bambu cameras |
| LAN MQTT auth (`bblp` + access code) | HIGH | Documented in Bambu wiki, ha-bambulab, multiple community projects |
| `mqtt` over `bambu-node` | HIGH | Empirical: bambu-node not updated in ~12 months; protocol surface is small enough to vendor |
| SSDP discovery on ports 1990/2021 | MEDIUM | Confirmed by 3+ community projects, but Bambu has changed firmware behavior in past — verify on real H2C device during Phase 1 |
| `_bambulab._tcp` does NOT exist | MEDIUM | Negative claim — derived from absence in community implementations rather than official Bambu confirmation |
| Cloud-mode deferral | HIGH | User has LAN access; cloud is a clearly-larger separate workstream |

## Open Questions for Phase Research

- **H2C-specific quirks:** The H2C is a newer SKU than the X1C/P1S that most community work targets. Verify on a real device that (a) RTSPS stream path is `/streaming/live/1` (not `/streaming/live/2` or H2-specific), (b) MQTT topics use the same `device/<serial>/...` pattern, (c) SSDP service type matches `urn:bambulab-com:device:3dprinter:1`.
- **Stream codec/profile compatibility with UniFi Protect:** Does Protect accept the Bambu H.264 stream as-is via re-mux, or is full VAAPI re-encode required? Resolve in onboarding test phase.
- **Access Code rotation:** Does the printer rotate the access code on firmware update / factory reset? UI must support re-entering it without recreating the LXC.

## Sources

- [bambu-node on npm](https://www.npmjs.com/package/bambu-node) — last publish ~12 months ago, low dependent count → not recommended as direct dep
- [bambu-node GitHub (THE-SIMPLE-MARK)](https://github.com/THE-SIMPLE-MARK/bambu-node) — typed message schema reference (vendor types only)
- [synman/bambu-go2rtc](https://github.com/synman/bambu-go2rtc) — community go2rtc + bambu pattern (Python wrapper, but useful template structure)
- [HA ha-bambulab issue #1798](https://github.com/greghesp/ha-bambulab/issues/1798) — confirms self-signed TLS issue and the IP-vs-hostname workaround
- [Frigate discussion #19832](https://github.com/blakeblackshear/frigate/discussions/19832) — Bambu via go2rtc, garbled-stream debugging context
- [WolfWithSword: Bambulabs X1C Camera in HA](https://www.wolfwithsword.com/bambulabs-x1c-camera-in-home-assistant/) — community RTSPS URL format reference
- [Bambu Lab Wiki: Printer Network Ports](https://wiki.bambulab.com/en/general/printer-network-ports) — official port list (322, 8883, 990 FTPS, 1990/2021 SSDP)
- [Bambu Lab Wiki: Streaming Video](https://wiki.bambulab.com/en/software/bambu-studio/virtual-camera) — official RTSPS URL format
- [Bambu Lab Wiki: Third-party Integration](https://wiki.bambulab.com/en/software/third-party-integration) — official sanction of LAN MQTT
- [greghesp/ha-bambulab](https://github.com/greghesp/ha-bambulab) — protocol reference (Python, but authoritative on message schema)
- [psychoticbeef/BambuLabOrcaSlicerDiscovery](https://github.com/psychoticbeef/BambuLabOrcaSlicerDiscovery) — SSDP discovery reference (confirms ports 1990/2021 + service URN)
- [Alex-Schaefer SSDP gist](https://gist.github.com/Alex-Schaefer/72a9e2491a42da2ef99fb87601955cc3) — fake-SSDP packet structure
- [TomWis97/bs-lan-discovery](https://github.com/TomWis97/bs-lan-discovery) — VLAN-bridging discovery, confirms non-standard SSDP behavior
- [nuxx.net Bambu P1S on IoT VLAN](https://nuxx.net/blog/2024/12/19/bambu-lab-p1s-on-iot-vlan/) — confirms ports + SSDP service-type string
- [mqtt npm](https://www.npmjs.com/package/mqtt) — recommended generic MQTT client, v5.x

---
*Stack research delta for: v1.2 Bambu Lab H2C integration*
*Researched: 2026-04-13*
