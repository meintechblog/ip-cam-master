# Spike Manifest

## Idea

Add Bambu Lab **A1** support to the web app alongside the already-working **H2C** branch.
The A1 is a lower-spec machine in the Bambu line — known to share the MQTT LAN control
protocol with H2C/X1/P1/H2D, but suspected to diverge on the camera-stream side (A1 has
only a toolhead camera, not the chamber camera that exposes RTSPS on port 322).

These spikes probe a real A1 on the local network (IP / SN / access code held in
`.env.a1`, gitignored) to answer: **can we reuse the H2C native RTSPS branch, or do we
need a go2rtc transcoding branch like the Mobotix S15 path?**

Ground truth for every spike is the live A1 — no assumptions, no community hearsay.

## Spikes

| # | Name | Validates | Verdict | Tags |
|---|------|-----------|---------|------|
| 001 | a1-port-surface | TCP port surface exposed by A1 vs H2C | ✓ VALIDATED — 322 closed, 6000 open, 8883 open | bambu, a1, reconnaissance |
| 002 | a1-rtsps-native | Whether A1 shares H2C's RTSPS:322 camera path | ✗ INVALIDATED — ECONNREFUSED; current preflight mis-maps this to "LAN_MODE_OFF" | bambu, a1, rtsps, camera, preflight |
| 003 | a1-mqtt-lan | MQTT LAN control + telemetry shape on A1 | ✓ VALIDATED — byte-for-byte compatible with H2C; `print.ipcam` exposes 1080p + `tutk_server: disable` | bambu, a1, mqtt, control, telemetry |
| 004 | a1-stream-fallback | JPEG-over-TLS on :6000 as the A1 ingestion path | ✓ VALIDATED — 40/40 valid 1536×1080 JPEGs, ~0.45 fps idle, ~150 LOC Node client | bambu, a1, go2rtc, fallback, critical-path |

## Consolidated Verdict

**Feasibility: CONFIRMED.** Adding A1 support is a targeted add-on to the existing
H2C branch — not a parallel rewrite.

### What reuses 1:1 from the H2C branch

| Subsystem                                                     | Reuse |
|---------------------------------------------------------------|-------|
| SSDP discovery (`bambu-discovery.ts`) — A1 already allowlisted | ✓     |
| MQTT subscriber (`bambu-mqtt.ts`) — auth, topics, state shape  | ✓     |
| Adaptive stream mode (gcode_state → live/idle groups)          | ✓     |
| Preflight TCP check on 8883                                    | ✓     |
| Preflight MQTT auth check                                      | ✓     |
| FTPS:990 SD-card access (if/when used)                         | ✓     |
| go2rtc RTSP-output side + UniFi Protect adoption flow          | ✓     |
| Credential storage (`bambu-credentials.ts`)                    | ✓     |

### What needs a new, A1-specific implementation

| Subsystem | Change | Size |
|-----------|--------|------|
| Preflight: skip RTSPS:322, probe :6000 instead | Small branch in `bambu-preflight.ts:57` keyed on printer model | ~40 LOC |
| Camera ingestion: JPEG-over-TLS :6000 client | New service module (`bambu-a1-camera.ts`) — auth, frame parse, pipe to ffmpeg | ~150 LOC |
| go2rtc yaml generator: A1 variant | New `generateBambuA1Go2rtcYaml` next to existing H2C variant in `go2rtc.ts` | ~40 LOC |
| UI gating: hide `chamber_temper` + AMS panel on A1, stream "snapshot mode" label | Small | ~30 LOC |

### Sharp edges uncovered (must be baked into the plan)

1. **Auth byte layout is silently-failing.** `u32 LE 0x3000` at offset 4 ≠
   single byte `0x30` at offset 4. Need a unit test that asserts the exact
   80-byte output of the auth builder (spike 004 §2).
2. **Idle-state frame rate is ~0.45 fps.** UX risk: looks like a static image
   in UniFi. Plan for "snapshot mode" labeling or ffmpeg `-vsync cfr` frame
   padding (spike 004 §Signal #3). Worth measuring fps during an active
   print as a follow-up UAT.
3. **Preflight currently mis-diagnoses A1.** ECONNREFUSED on :322 fires
   `LAN_MODE_OFF` hint — wrong for A1. Preflight must accept model as input
   (spike 002 §Signal).
4. **`chamber_temper: 5`** on A1 is a sentinel, not real temp. UI must
   model-gate its display (spike 003 §3).
5. **`tutk_server: disable`** is the gate for LAN-only streaming. If a user
   has cloud mode active, :6000 may not be reachable — surface this as a
   helpful preflight message rather than a cryptic timeout (spike 003
   §Signal #4).

