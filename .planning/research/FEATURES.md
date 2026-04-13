# Feature Landscape — Bambu Lab H2C Camera Integration (v1.2)

**Domain:** Self-hosted IP-camera onboarding tool, new device class = Bambu Lab H2C 3D-printer cameras
**Researched:** 2026-04-13
**Scope:** ONLY camera-feed integration into UniFi Protect. Print control, AMS, telemetry are explicitly out of scope.
**Reuse target:** ~80% of the existing Mobotix/Loxone pipeline (LXC + go2rtc + adoption flow). The Bambu-specific work is in **discovery, credential model, stream URL shape, and pre-flight validation**.

---

## Domain Primer (one-screen briefing)

The Bambu Lab H2C is a multi-material 3D printer launched 2025-11-18. It carries an **AI quad-camera vision system** (chamber/toolhead cams used by the printer's own diagnostics) plus an optional **Bird's Eye Camera** accessory mounted in the lid. From a network-integration standpoint:

- **Stream protocol:** `rtsps://bblp:<access_code>@<printer_ip>:322/streaming/live/1` — same scheme used by all current Bambu printers since firmware 01.06.x. Codec is **H.264 in RTSPS (TLS)**, *not* MJPEG. (This is a key difference from Mobotix.)
- **Auth model:** Single shared password called the **Access Code**, displayed on the printer's 5" touchscreen under *Settings → WLAN/General → Access Code* (8 digits). Username is always literal `bblp`. The **Serial Number** (e.g. `0309CA...`) is shown on the same screen and is needed for MQTT/SSDP correlation, not for the RTSPS stream itself.
- **Required toggle:** `LAN Mode Liveview` must be enabled in the printer's network settings. This is *separate* from full LAN-Only Mode — Liveview can be on while the printer still uses Bambu Cloud for slicer connectivity. Without this toggle, port 322 refuses connections.
- **Discovery:** Printers broadcast SSDP `NOTIFY` packets every ~5 s on UDP 2021 (Bambu's quirky variant of SSDP/mDNS). USN field carries the serial. There is no `_bambulab._tcp` mDNS record — that was an assumption in the milestone goal; **the actual mechanism is SSDP**.
- **Authorization Control System (Jan 2025+):** Bambu's firmware now blocks third-party *control* operations, but **explicitly permits remote video access via LAN Mode Liveview**. So our read-only camera use case is on the supported side of the firewall — no Developer Mode required.

This means our existing Mobotix pipeline needs four delta-changes: SSDP scanner, two-field credential form, RTSPS source string, and a preflight that checks "is LAN Liveview on?". Everything downstream (LXC, go2rtc YAML deploy, UniFi Protect adoption, status polling) reuses the existing modules unchanged.

---

## Table Stakes

Features users *expect*. Missing = product feels broken or "Bambu support" is a lie.

| Feature | Why Expected | Complexity | Depends On (existing modules) | Notes |
|---|---|---|---|---|
| **SSDP-based Bambu discovery on the dashboard scanner** | Users assume "click Scan, see my printer" — same UX as Mobotix today | Medium | Existing network-scanner module (extend with SSDP listener on UDP 2021) | Listen for ~10s, parse `USN` for serial, `LOCATION` for IP, model field for `H2C` substring. Also add a manual-IP fallback because SSDP fails across VLANs. |
| **Onboarding form: Access Code + Serial Number, both required** | Bambu's documented auth model — copy/paste from printer screen | Simple | Existing credential store (AES-256-GCM in SQLite) — just two new string fields on the camera record | Mask Access Code input. Validate Serial against `^[0-9A-Z]{15}$` (Bambu format). |
| **Pre-flight RTSPS handshake before LXC provisioning** | Users hit "Onboard" expecting clear error if creds wrong, *not* a half-built container that fails silently | Medium | New utility `bambu-preflight.ts` using ffprobe in a child process; called from existing onboarding flow | If TLS handshake works but auth fails → "Wrong Access Code". If TCP refused on :322 → "Enable LAN Mode Liveview on printer". If host unreachable → "Check IP/network". These three messages are the entire onboarding-debugging UX. |
| **go2rtc config template for Bambu RTSPS source** | Camera must actually appear in UniFi Protect | Simple | Existing go2rtc-config-generator + SSH deploy modules | Source line: `streams: bambu_<id>: ffmpeg:rtsps://bblp:{{access_code}}@{{ip}}:322/streaming/live/1#video=copy#audio=copy`. **Skip transcoding** — H.264 is already what UniFi wants. Pass-through saves CPU/VAAPI. |
| **`-rtsp_transport tcp` + `-allowed_media_types video` ffmpeg flags** | Bambu's RTSPS implementation is finicky over UDP and reliably stalls on audio negotiation; community widely reports garbled feeds without these | Simple | go2rtc YAML template extension | Frigate/HA users hit this exact issue (GH discussion #19832). Set as default for the Bambu profile. |
| **Encrypt Access Code at rest** | Same security promise as Mobotix/Loxone passwords | Simple | Existing AES-256-GCM credential store — zero new code, just route the new field through it | Non-negotiable per project security constraint. |
| **Online/offline status via TCP probe to `:322`** | Dashboard already shows online/offline for other cameras | Simple | Existing status-poller module (port-probe variant) | 5 s interval, 2 s timeout. Don't open the RTSPS stream for health checks — that triggers Bambu's "in use" lockout where the next real client gets refused. |
| **Manual-IP add as fallback when discovery fails** | Cross-VLAN, mDNS-blocking switches, "I just want it to work" | Simple | Existing manual-add path (already in app for Loxone) | Document SSDP cross-subnet limitation in the help text. |
| **One Bambu camera = one LXC container** | Architectural consistency with Mobotix/Loxone | Simple | Existing LXC provisioner — Bambu uses the same go2rtc-only template (no nginx auth-proxy needed; RTSPS handles auth natively) | Even cheaper than Loxone (no nginx layer). |

---

## Differentiators

Features that elevate the product. **Defer all of these to v1.3 unless cheap.**

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---|---|---|---|---|
| **Auto-detect H2C model variant from SSDP** | UI shows "Bambu Lab H2C" not "Unknown printer" — feels polished | Simple | SSDP parser already extracts the model field | Cheap if we're already parsing SSDP. Map `3DPrinter-H2C` → friendly name. Do it in v1.2 if it's literally a one-line lookup table. |
| **Bird's Eye Camera as a second adoptable stream** | Power users with the accessory get both viewpoints in Protect | Medium | Same go2rtc template, second LXC container OR second `streams:` entry | Bird's Eye exposes a second RTSPS path on the same printer (`/streaming/live/2` per community reports — verify before shipping). Architect for it but ship as v1.3 unless a tester actually has the accessory. |
| **"Test Stream" button in UI that opens a 5 s preview** | Lets the user verify before adoption — huge confidence boost | Medium | New module: ffmpeg snapshot to JPEG, served once via dashboard | Reuse for all camera types eventually. Probably worth its own phase. |
| **Auto-detect "LAN Mode Liveview is OFF" and link to the printer's web UI / show step-by-step screenshot** | Top support question for every Bambu integration (HA, Frigate, SimplyPrint all document it) | Simple | Preflight already detects this — just polish the error UI | Cheap polish. Worth doing. |
| **Detect Authorization Control firmware version and warn if user is on a build that broke video access** | Future-proofing against Bambu firmware regressions | Complex | Need MQTT subscription (auth required) OR HTTP probe to extract firmware version | Skip unless we hear of an actual regression. Bambu has *promised* to keep video unrestricted — taking them at their word until proven otherwise. |
| **Reuse Access Code across multiple Bambu printers in the same household** | Most users have one access code per *printer*, but UI could remember the last-used one as a default | Simple | UI-only convenience | Nice but not essential. |

---

## Anti-Features (Explicitly NOT in v1.2)

These come up constantly in HA/bambu-farm/SimplyPrint discussions. We say "no" loudly and document why in the README to set expectations.

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| **Print job control (start/pause/cancel)** | Out of scope (camera tool, not printer manager). Also requires MQTT auth + survives Bambu's Authorization Control firmware as a *restricted* operation. Whole different threat & API surface. | Direct user to Bambu Handy / Bambu Studio / Home Assistant `bambu_lab` integration. Link in docs. |
| **AMS (filament) status, temperature, progress %** | Same reason — printer telemetry isn't a camera concern | Same redirect. |
| **Cloud-mode authentication / Bambu account login / `mqtt://us.mqtt.bambulab.com:8883`** | (1) Adds OAuth + token-refresh complexity. (2) Cloud streams use a different transport (TUTK P2P, not RTSPS). (3) The whole reason a self-hosted user picked our tool is *to avoid the cloud*. | LAN Mode Liveview only. The milestone PROJECT.md mentions "cloud auth as fallback" — recommend dropping that from scope. If LAN Liveview is off, the right answer is "turn it on", not "fall back to cloud". |
| **Embedding/running go2rtc inside our app process** | Already a settled architectural pattern: we generate config, ship it to the per-camera LXC, go2rtc runs there | Existing go2rtc-config-generator handles this. |
| **Re-encoding the H.264 stream "just in case"** | Wastes CPU/VAAPI for zero quality gain. Bambu already ships H.264 baseline that UniFi Protect accepts | Use `#video=copy`. Only fall back to transcode if a specific firmware ships H.265 (none have). |
| **Polling the RTSPS stream for health** | Bambu's RTSPS server only allows ~1 concurrent client; a polling probe will steal the slot from go2rtc | TCP probe to port 322 only. Trust go2rtc's own connection state for richer status. |
| **Ingesting the AI vision system's per-frame metadata (defect detection, spaghetti detection)** | Cool, but it's a printer-internal feature with no public API | N/A. |
| **Supporting the older P1S/A1/X1C in v1.2** | Even though the protocol is identical, "scope creep" risk. Adding them is one config switch — but test matrix explodes (different firmware quirks per model) | Mention in roadmap as v1.3 "free win" once H2C is solid. The same code path already works; only model-string handling and tester access differ. |

---

## Feature Dependencies

```
SSDP discovery ──► Auto-detect H2C model (differentiator)
       │
       ▼
Onboarding form (Access Code + Serial) ──► Encrypt at rest (existing module)
       │
       ▼
Pre-flight RTSPS handshake ──► "LAN Liveview off" diagnostic UI (differentiator)
       │
       ▼
LXC provisioning (existing) ──► go2rtc config with Bambu template ──► UniFi adoption (existing)
       │
       ▼
TCP :322 status probe (existing poller, new port)
```

Manual-IP fallback short-circuits SSDP discovery and feeds directly into the onboarding form.

Bird's Eye second stream (differentiator) branches off the same LXC after primary adoption succeeds.

---

## MVP Recommendation (v1.2 Scope)

Ship these 9 table-stakes items. Nothing else.

1. SSDP scanner extension (new) — **medium**
2. Manual-IP fallback wired to Bambu profile (existing path, new device type) — **simple**
3. Onboarding form: Access Code + Serial, both encrypted (existing store) — **simple**
4. Pre-flight RTSPS handshake with three clear error states — **medium**
5. go2rtc Bambu YAML template (`#video=copy#audio=copy` + `-rtsp_transport tcp`) — **simple**
6. LXC provisioning reuses existing Mobotix template (no nginx) — **simple**
7. UniFi Protect adoption monitoring reuses existing module — **zero new code**
8. TCP :322 health probe (existing poller, new port number) — **simple**
9. Documentation: "How to find Access Code on H2C", "Enable LAN Mode Liveview" with screenshots — **simple**

**Defer to v1.3:**
- Bird's Eye Camera as a second stream
- "Test Stream" preview button (worth its own milestone)
- Older Bambu model support (P1S/A1/X1C)
- Firmware version detection / Authorization Control warnings

**Drop from PROJECT.md scope:**
- Cloud-Auth Fallback. It's a 5-10× complexity multiplier (OAuth + TUTK P2P + token refresh) for a feature that contradicts the product positioning. If LAN Liveview can't be enabled, the printer probably can't be supported in v1.2.

---

## Sources

- [Bambu Wiki — Streaming video of Bambu Printer](https://wiki.bambulab.com/en/software/bambu-studio/virtual-camera) — HIGH (official)
- [Bambu Wiki — Live View Troubleshooting](https://wiki.bambulab.com/en/software/bambu-studio/faq/live-view) — HIGH (official, covers H2D/H2S/H2C LAN Mode Liveview toggle)
- [Bambu Wiki — Printer Network Ports](https://wiki.bambulab.com/en/general/printer-network-ports) — HIGH (official, port 322 RTSPS confirmed)
- [Bambu Forum — How to access camera on LAN (firmware 01.06+)](https://forum.bambulab.com/t/how-to-access-camera-on-lan-firmware-01-06/23500) — HIGH (canonical RTSPS URL format)
- [Bambu Lab H2C Specs](https://bambulab.com/en/h2c/specs) — HIGH (quad-camera vision system, launched 2025-11-18)
- [Bambu Blog — Authorization Control System](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/) — HIGH (confirms remote video access remains permitted)
- [ha-bambulab Setup Docs (greghesp)](https://docs.page/greghesp/ha-bambulab/setup) — HIGH (proven HA integration, validates RTSPS approach)
- [TomWis97/bs-lan-discovery](https://github.com/TomWis97/bs-lan-discovery) — MEDIUM (SSDP packet structure, USN/serial mapping)
- [Frigate GH discussion #19832 — Bambu garbled feed](https://github.com/blakeblackshear/frigate/discussions/19832) — MEDIUM (real-world go2rtc gotchas: rtsp_transport tcp, audio strip)
- [BambuBoard VIDEO_STREAMING_SETUP.md](https://github.com/t0nyz0/BambuBoard/blob/main/VIDEO_STREAMING_SETUP.md) — MEDIUM (community reference setup)
- [Wolf's Armoury — X1C Camera in HA](https://www.wolfwithsword.com/bambulabs-x1c-camera-in-home-assistant/) — MEDIUM (LAN Mode Liveview gotcha + reboot requirement after enabling)
- [BambuStudio Issue #2146 — RTSP feed URL](https://github.com/bambulab/BambuStudio/issues/2146) — MEDIUM (URL format community confirmation)
- [SimplyPrint — Bambu webcam guide](https://help.simplyprint.io/en/article/bambu-lab-webcam-not-working-guide-pw6z3q/) — MEDIUM (common failure modes catalogued)

**Confidence note:** H2C-specific RTSPS behaviour is extrapolated from documented X1C/H2D behaviour. The Bambu Wiki's Live View Troubleshooting page explicitly groups H2D/H2S together and uses the same LAN Mode Liveview toggle; community sources treat the protocol as identical across the current generation. **MEDIUM confidence on H2C specifically; HIGH on the protocol family.** First H2C tester onboarding will validate the secondary Bird's Eye stream URL and any quad-camera quirks.
