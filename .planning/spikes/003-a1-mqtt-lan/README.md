---
spike: 003
name: a1-mqtt-lan
validates: "Given MQTT:8883 open on A1 (per spike 001), when we authenticate as 'bblp' with the access code, subscribe to device/<SN>/report, and publish a 'pushall' request, then we confirm LAN control auth matches H2C and capture the complete telemetry schema for UI parity"
verdict: VALIDATED
related: [001, 004]
tags: [bambu, a1, mqtt, control, telemetry]
---

# Spike 003: A1 MQTT LAN Control

## What This Validates

Given port 8883 open on A1 (spike 001), when we use the *exact* MQTT config the
production client uses (`bambu-mqtt.ts:155-177`) — `mqtts://<ip>:8883`, user
`bblp`, password = access code, `rejectUnauthorized: false` — then:

1. Does CONNACK succeed? (= auth model is identical to H2C)
2. Does `device/<serial>/report` work as the subscribe topic?
3. Does `device/<serial>/request` + `pushing.pushall` force a full-state dump?
4. What fields does the A1 publish that we can surface in the UI, and are any
   A1-specific vs H2C?

## How to Run

```bash
set -a; source .env.a1; set +a
node .planning/spikes/003-a1-mqtt-lan/probe.mjs
```

Writes the first (full) pushall response to `pushall-full.json` and streams
all subsequent deltas to stdout for 15 s. Access code is redacted in all
outputs.

## What to Expect

- `[probe] CONNACK ok` within ~1 s on first attempt
- `[msg 1]` carries the full state (~240 lines of JSON)
- Deltas (msg 2+) arrive every ~1–2 s with a subset of fields that changed

## Results

**Captured 2026-04-20 against real A1 (see `pushall-full.json` and `mqtt-capture.txt`):**

### 1. Auth & connection — IDENTICAL to H2C

```
[probe] CONNACK ok — subscribing to device/03919A3B0100254/report
```

No TLS issues, no auth retries, `bblp` + raw access code works on first try.
The production client config in `bambu-mqtt.ts:157-165` transfers to A1 with
zero modification.

### 2. Topic scheme — identical

- `device/<SN>/report` for state
- `device/<SN>/request` accepts `pushall` and returns full state in ~100 ms

### 3. Telemetry schema — a proper superset for the UI

Top-level: `print` (single root key, same as H2C).

**Shared fields with H2C (drive existing features):**

| Field                    | Value (idle A1) | Notes                                                      |
|--------------------------|-----------------|------------------------------------------------------------|
| `gcode_state`            | `"IDLE"`        | Drives adaptive stream mode (`bambu-mqtt.ts:14-23`) ✓       |
| `nozzle_temper`          | `29`            | Live temp                                                  |
| `nozzle_target_temper`   | `0`             | Target temp                                                |
| `bed_temper`             | `28.46875`      | Live bed temp                                              |
| `bed_target_temper`      | `0`             | Target bed temp                                            |
| `mc_percent`             | `0`             | Progress %                                                 |
| `mc_remaining_time`      | `0`             | ETA in minutes                                             |
| `layer_num` / `total_layer_num` | `0` / `0` | Per-layer progress                                       |
| `gcode_file` / `subtask_name` | `""` / `""` | Active job name                                           |
| `wifi_signal`            | `"-53dBm"`      | Signal strength                                            |
| `sdcard`                 | `true`          | SD card inserted                                           |
| `print_error`            | `0`             | Error code (0 = none)                                      |
| `hms`                    | `[]`            | Health-monitoring codes (empty when no faults)             |

**A1-specific quirks worth knowing:**

- `chamber_temper: 5` — **sentinel value**. A1 has no heated chamber. Do NOT
  display this in the UI without a model-aware guard; 5 °C is not a real
  measurement.
- `ams_status: 0` + `filam_bak: []` — A1 has no AMS by default (it uses AMS
  lite). Safe to show as "no AMS configured" rather than hiding.
- `ipcam` object (see below) — **present on A1**, contains camera metadata.
  Gold for the build.

**New A1 camera metadata under `print.ipcam`:**

```json
"ipcam": {
  "ipcam_dev": "1",          // camera present
  "ipcam_record": "enable",  // timelapse recording on
  "timelapse": "disable",    // active timelapse session off
  "resolution": "1080p",     // ← A1 camera is 1080p
  "tutk_server": "disable",  // ← TUTK P2P relay OFF = LAN-only mode
  "mode_bits": 3             // bitfield, purpose TBD
}
```

The most important signal here is `tutk_server: "disable"`. Bambu's TUTK is the
cloud P2P relay used when LAN mode is off or when the Handy app connects
remotely. With TUTK disabled, the printer exposes its camera on a local-only
channel — this is the port 6000 endpoint spike 001 found open, and is what
spike 004 will test.

`resolution: "1080p"` means once we *do* get a stream flowing, it's full HD —
good enough for UniFi Protect recording without upscaling.

**New A1 fields under `print.xcam`:**

```json
"xcam": { "buildplate_marker_detector": true }
```

A1 lacks H2C's AI vision features (first-layer inspection, spaghetti
detection). Only the build-plate marker detector runs. UI should gate xcam
feature toggles by model.

### 4. Delta behavior — identical

After the pushall burst, deltas arrive every ~1–2 s containing only changed
fields — same pattern as H2C. The production subscriber's `msg.print.gcode_state`
path (`bambu-mqtt.ts:113`) works unmodified.

### Verdict: VALIDATED

A1's MQTT LAN control, authentication model, topic scheme, pushall behavior,
and delta cadence are byte-for-byte compatible with the H2C branch.
**The entire `bambu-mqtt.ts` subscriber works on A1 with zero code changes.**

### Signal for the build

1. **`bambu-mqtt.ts` needs zero changes** to support A1 subscribers. The
   adaptive stream mode, state-group mapping, and error classifier all apply.

2. **UI must model-gate display logic** for:
   - `chamber_temper` (hide on A1 or show with an "—" placeholder)
   - `ams_status` / AMS panel (hide by default on A1 unless AMS lite attached)
   - `xcam` toggles (only expose `buildplate_marker_detector` on A1)

3. **Auto-configure stream quality** from `ipcam.resolution` — A1 reports
   `"1080p"` here, H2C reports higher. Read this once at adoption and bake it
   into the go2rtc yaml.

4. **`tutk_server: "disable"` is the gating precondition** for local-only
   streaming. If a user's A1 reports `tutk_server: "enable"`, our LAN-only
   stream path may not be reachable — surface this as a helpful preflight
   message rather than a cryptic timeout.

5. **Preflight's MQTT check (`bambu-preflight.ts:186-217`) works on A1
   unchanged.** The only preflight change needed is removing/branching the
   RTSPS:322 check (see spike 002).
