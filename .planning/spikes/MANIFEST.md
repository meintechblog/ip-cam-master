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
