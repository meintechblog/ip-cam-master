# Plan 10-04 SUMMARY — Field run against real H2C

**Date**: 2026-04-15
**Printer**: Bambu Lab H2C ("Bob the Builder"), 192.168.3.109, serial 31B8BP611201453
**Firmware observed**: `01.01.05.00`
**Internal model code (DevModel)**: `O1C2`
**Printer state during capture**: actively printing (layer 4 of 703)

## One-line verdict per phase

| Phase | Verdict |
|-------|---------|
| **SSDP** | ✅ confirmed — but **port 2021 (not 1990)** is where traffic actually flows; URN `urn:bambulab-com:device:3dprinter:1` matches assumption |
| **RTSPS** | ✅ confirmed — `rtsps://bblp:<CODE>@<IP>:322/streaming/live/1` works, h264 1680x1080@30fps; **Live/2 returns 404** (no Bird's-Eye on H2C) |
| **MQTT** | ✅ topics captured (`device/<SERIAL>/report` only), **print-state field = `print.gcode_state`** (value `RUNNING` during print) — but mosquitto_sub broken, must use mqtt.js/paho |
| **go2rtc** | ✅ `rtspx://` passthrough works perfectly — restream at `rtsp://127.0.0.1:8554/bambu` is clean h264, no transcode needed |

## Top 3 divergences from X1C/P1S that Phase 11 must honor

1. **SSDP listener bind UDP 2021** (not 1900 or 1990) — actual broadcast traffic uses 2021 as both src and dst port
2. **DevModel reports as `O1C2`** — Phase 11 device-type detection must allowlist `O1C2` (and forward-compat `H2C`/`H2D`)
3. **MQTT TLS via real TLS library** — `mosquitto_sub --insecure` is broken on Debian 13 (mosquitto-clients 2.0.21); Phase 11 must use Node `mqtt` package with `rejectUnauthorized: false`

## Blockers for Phase 11

**None blocking.** One follow-up data gap:

- **Idle MQTT sample not captured** — printer was printing during the spike; Phase 14 needs to confirm the IDLE-state sentinel value of `print.gcode_state` (likely `IDLE` per Bambu convention but unverified). Recommendation: rerun a 60s MQTT capture once the current print finishes (~12h from spike) and append to H2C-FIELD-NOTES.md before Phase 14 starts. Not a Phase 11 blocker.

## Bonus finding

A second Bambu printer (A1 at 192.168.3.195) was visible in the SSDP capture — useful evidence that Bambu's SSDP convention is consistent across models (URN identical, broadcast pattern similar but A1 broadcasts on 1900→2021 while H2C uses 2021→2021).

## Artifacts committed

- `.planning/research/H2C-FIELD-NOTES.md` — `status: validated`, every placeholder replaced with observed data
- `.planning/research/h2c-spike-20260415-042608.log` — sanitized raw log (Access Code redacted, includes appended Phase 3 paho-mqtt re-run)
