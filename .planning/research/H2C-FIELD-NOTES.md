---
status: validated
validated_date: 2026-04-15
firmware_version: 01.01.05.00
---

> **STATUS: validated against real H2C on 2026-04-15**

# Bambu Lab H2C — Field Notes

| Field | Value |
|-------|-------|
| Tested date | 2026-04-15 |
| Printer IP | 192.168.3.109 |
| Printer serial | 31B8BP611201453 |
| Printer name | "Bob the Builder" |
| Firmware version | `01.01.05.00` (DevVersion.bambu.com) |
| Internal model code | **`O1C2`** (DevModel.bambu.com — H2C reports as O1C2) |
| Tester | chrissi |
| Printer state during capture | actively printing (layer 4 of 703) |

## SSDP

- **Port observed**: NOTIFY broadcast on **UDP 2021** (src and dst). The HTTP `Host:` header advertises `239.255.255.250:1990` but the actual UDP packet flows on **2021** (src=printer:2021 → dst=255.255.255.255:2021, broadcast). Port **1990** is referenced in the headers but NO traffic observed on 1990 in 10s window.
- **Service type string** (URN): `urn:bambulab-com:device:3dprinter:1` ✅ **matches X1C/P1S assumption**
- **Re-broadcast cadence**: ~3–5 seconds between NOTIFYs (3 packets in 10s).
- **USN** = printer serial directly (no `uuid:` prefix): `USN: 31B8BP611201453`
- **Sample packet** (from tcpdump, source: 192.168.3.109:2021 → 255.255.255.255:2021):
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
- **Bonus capture** — an A1 printer at 192.168.3.195 broadcast on the standard SSDP port pair (1900→2021), confirming Bambu uses non-standard 2021 *destination* universally; H2C uses 2021 as both src AND dst (broadcast loop).

## RTSPS (port 322)

- **Cert subject**: `CN=31B8BP611201453` (CN is the **serial number**, not the IP — surprising)
- **Cert issuer**: `C=CN, O=BBL Technologies Co. Ltd, CN=BBL Device CA O1C2-V2`
- **Cert SHA-256 fingerprint**: `05:5E:1C:A4:64:02:4B:BD:26:2E:47:F6:92:73:4F:52:84:D7:B7:C1:D8:5C:C1:15:EE:B9:32:C8:BF:AD:80:A6`
- **Cert validity**: `2026-01-12 → 2036-01-10` (10 years, freshly minted Jan 2026)
- **Live/1 (`/streaming/live/1`)** ✅
  - Codec: **h264 (High profile)**, yuv420p
  - Resolution: **1680x1080**
  - FPS: **30** (30 tbr, 90k tbn)
  - Audio: **none** (no audio stream advertised)
  - Server banner: `title: rtsp stream server`
- **Live/2 Bird's-Eye (`/streaming/live/2`)** ❌
  - Present: **NO** — server returns `404 Stream Not Found`
  - H2C does not expose the second-camera path that X1C does (or uses a different path; not investigated further — out of v1.2 scope)

## MQTT (port 8883)

- **Auth**: `bblp` + Access Code (TLS, self-signed cert)
- **TLS handshake**:
  - `mosquitto_sub 2.0.21` with `--insecure --cafile /dev/null` → fails (`Problem setting TLS options: File not found`)
  - `mosquitto_sub 2.0.21` with `--insecure --cafile /etc/ssl/certs/ca-certificates.crt` → fails (`Protocol error` — system CA cannot validate the BBL Device CA)
  - **Working approach**: Python `paho-mqtt` with `ssl.CERT_NONE` + `check_hostname=False` → connects cleanly (`rc=Success`)
- **Topics observed** in 45s window (printer printing):
  - `device/<SERIAL>/report` — high-frequency telemetry (every ~1s), large JSON payload (multi-kB)
  - No other topics seen in window — the H2C in LAN Mode appears to publish only `report`. (X1C-style `request`/`info` topics not observed; printer was not commanded during capture.)
- **Print-state field path** (drives Phase 14 Adaptive Stream Mode):
  - **`print.gcode_state`** ← **canonical field**, value `'RUNNING'` while printing
  - Supporting fields: `print.mc_print_stage='2'`, `print.mc_stage=2`, `print.state=4` (numeric variants — less stable; prefer string `gcode_state`)
  - Likely values per Bambu convention: `IDLE`, `PREPARE`, `RUNNING`, `PAUSE`, `FINISH`, `FAILED` (need to verify the IDLE value when printer next idles)
- **Sample active-print message** (sanitized, top-level keys, `print.gcode_state` highlighted):
  ```json
  {
    "print": {
      "gcode_state": "RUNNING",
      "mc_print_stage": "2",
      "mc_stage": 2,
      "print_type": "cloud",
      "state": 4,
      "3D": { "layer_num": 4, "total_layer_num": 703 },
      "bed_temper": "<temp>",
      "ams": [ ... ],
      "device": { "bed": {"state": 2}, "extruder": {"state": 2}, ... },
      "ipcam": { "bs_state": 0, ... },
      "command": "<...>",
      "...": "..."
    }
  }
  ```
- **Sample idle message** (captured post-print-completion, 2026-04-15):
  ```
  print.gcode_state   = 'FINISH'   ← post-completion sentinel (sustains for a while after print ends)
  print.mc_print_stage= '1'        ← was '2' during RUNNING
  print.mc_stage      = 1          ← was 2 during RUNNING
  print.state         = 6          ← was 4 during RUNNING
  print.print_type    = ''         ← was 'cloud' during RUNNING
  ```
  Note: `FINISH` is observed immediately after print completion; `IDLE` is likely the sentinel after user clears the job or after further timeout. For Adaptive Mode purposes, treat any of `FINISH | IDLE | FAILED` as the same idle group (→ Snapshot). `RUNNING | PREPARE | PAUSE` as the live group (→ Live stream).
- **Note**: `print.print_type = 'cloud'` is reported even with LAN Mode active and no internet pull from the cloud — this is metadata about *the originating slicer*, not the active connection mode.

## go2rtc Smoketest

- **Config YAML used** (`rtspx://` scheme — skips TLS verification for self-signed cert):
  ```yaml
  api:
    listen: ":1984"
  rtsp:
    listen: ":8554"
  streams:
    bambu:
      - rtspx://bblp:<REDACTED>@192.168.3.109:322/streaming/live/1
  log:
    level: info
  ```
- **Restream URL**: `rtsp://127.0.0.1:8554/bambu`
- **`#video=copy` (passthrough via `rtspx://`) works**: ✅ **YES** — go2rtc 1.9.14 passed the H264 stream through unchanged. No transcode needed for adoption.
- **`:1984/api/streams` response**:
  ```json
  {
    "bambu": {
      "producers": [
        { "url": "rtspx://bblp:<REDACTED>@192.168.3.109:322/streaming/live/1" }
      ],
      "consumers": null
    }
  }
  ```
- **ffprobe of restream** (`rtsp://127.0.0.1:8554/bambu`):
  ```
  Input #0, rtsp, from 'rtsp://127.0.0.1:8554/bambu':
    Metadata:
      title           : go2rtc/1.9.14
    Duration: N/A, start: 0.030244, bitrate: N/A
    Stream #0:0: Video: h264 (High), yuv420p(progressive), 1680x1080, 30 fps, 30 tbr, 90k tbn
  ```
  (initial `461 Unsupported transport` from ffprobe trying UDP first — go2rtc only serves TCP; fallback succeeded — non-issue)
- **go2rtc startup log**: clean — `[rtsp] listen addr=:8554`, `[api] listen addr=:1984`, `[webrtc]` listening on 8555 (unused for this smoketest).

## Known Issues / Surprises

- **DevModel = `O1C2`** — H2C reports its internal model code as `O1C2`, not `H2C`. Phase 11 discovery should match on `O1C2` (and probably allowlist `H2C`/`H2D` for forward compatibility).
- **SSDP destination port is 2021, not 1990** — the `Host:` header advertises 1990 but actual UDP traffic flows on **2021** (src=2021, dst=2021 broadcast). Phase 11 SSDP listener MUST bind UDP **2021**, not 1990.
- **Cert CN = serial, not IP/hostname** — atypical TLS cert. `rtspx://` (skip verify) is mandatory; no SAN match is possible.
- **Cert issuer is model-versioned**: `BBL Device CA O1C2-V2`. Different printer models likely have different CA names (PITFALLS heads-up: don't pin issuer CN).
- **Bird's-Eye `/streaming/live/2` returns 404** — H2C either doesn't expose it or uses a different path. Confirms v1.2 scope decision to defer.
- **MQTT `--insecure` on mosquitto_sub 2.0.21 is broken** — both `/dev/null` and system CA approaches fail. Phase 11 MQTT subscriber MUST use a real TLS library with CERT_NONE (Node.js `tls` with `rejectUnauthorized: false`, or `mqtt.js` equivalent), NOT shell out to mosquitto_sub.
- **Only `device/<SERIAL>/report` topic observed** in 45s window — H2C in LAN Mode appears to publish less than X1C/P1S; no `info`/`request` traffic without commands.
- **`print.print_type = 'cloud'`** even in LAN-only operation — this is slicer-origin metadata, not connection state. Do NOT use it as a LAN-mode signal.

## Recommendations for Phases 11-14

1. **Phase 11 SSDP listener**: bind UDP **2021** (NOT 1990 as STACK.md suggested). Filter by `NT: urn:bambulab-com:device:3dprinter:1`. Identify Bambu rows by `DevModel.bambu.com` header value (allowlist `O1C2` for H2C; add `X1C`, `P1S`, `A1`, `H2D` for forward-compat). Use `USN:` value as the printer serial (no UUID prefix).
2. **Phase 11 pre-flight RTSPS URL template**: `rtsps://bblp:<CODE>@<IP>:322/streaming/live/1` ✅ **confirmed working as written**. ffprobe with `-rtsp_transport tcp -tls_verify 0` succeeds in <1s when LAN Mode + Access Code are correct → ideal pre-flight probe. A 401-class failure indicates wrong/rotated Access Code; a connection-refused indicates LAN Mode OFF or wrong port.
3. **Phase 12 go2rtc YAML**: use `rtspx://bblp:<CODE>@<IP>:322/streaming/live/1` directly — **NO `#video=copy` flag needed** (passthrough is the default for `rtspx://` and produces a clean 1680x1080 h264@30fps restream). VAAPI re-encode is **NOT** required for the H2C — codec is already h264 High @ standard resolution. This means the existing LXC template VAAPI passthrough is unnecessary for Bambu cameras (still required for Mobotix MJPEG transcoding).
4. **Phase 14 Adaptive Stream Mode**: subscribe to `device/<SERIAL>/report` (TLS, `bblp`/Access Code, `rejectUnauthorized: false`). Trigger on field **`print.gcode_state`** as a string. Live mode = value `'RUNNING'` (and likely `'PREPARE'`, `'PAUSE'` — to be confirmed). Snapshot mode = value `'IDLE'` (and likely `'FINISH'`, `'FAILED'`). **Open item before Phase 14 build**: capture a 60s MQTT sample while the printer is idle to confirm the exact IDLE-state sentinel value(s) — currently inferred from convention.
5. **Phase 11 MQTT client choice**: do NOT shell out to `mosquitto_sub` — it cannot connect to the H2C's self-signed cert in mosquitto-clients 2.0.21. Use a Node.js MQTT library (`mqtt` package) with `tls.connect({ rejectUnauthorized: false })`. The Phase 10 spike used `paho-mqtt` (Python) successfully — same pattern in Node works.
6. **Pitfalls additions**: (a) Bambu's TLS certs have **model-versioned issuer CNs** — don't pin the issuer; (b) the H2C reports `print.print_type = 'cloud'` even in LAN-only mode — don't use it as a LAN-mode signal; (c) `O1C2` is the H2C's wire-protocol model code — that string, not "H2C", appears in SSDP and the cert issuer.

## Raw Log

`.planning/research/h2c-spike-20260415-042608.log` (sanitized — Access Code redacted; includes appended Phase 3 MQTT re-run via paho-mqtt)
