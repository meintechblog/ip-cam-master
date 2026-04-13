# Phase 10 Context — H2C Hardware Validation Spike

**Phase:** 10 — H2C Hardware Validation Spike
**Milestone:** v1.2 — Bambu Lab H2C Kamera-Integration
**Requirements covered:** BAMBU-01, BAMBU-02
**Created:** 2026-04-13

## Goal (from ROADMAP.md)

Confirm H2C protocol assumptions against real hardware before any production code is written. Deliverable is `.planning/research/H2C-FIELD-NOTES.md` — subsequent phases (11–14) treat it as ground truth.

## Decisions

### Execution Environment

- **Spike runs on the production App-VM (192.168.3.233)** — not on the dev Mac, not in a throwaway container. Same network segment as the H2C, same tooling the production code will use.
- **Access via passwordless SSH as root** (user has confirmed this is already set up — to be verified on first connection attempt).
- **Everything the spike writes stays on the VM and gets committed back as field notes** — no ephemeral test setup.

### LXC Strategy — "Ein System für alles"

- The user explicitly wants **no separate test/dev setup**. Once Phase 10 confirms protocol assumptions, Phase 11+ wire up a real Bambu LXC on the existing production Proxmox host.
- This is consistent with the existing `one-LXC-per-camera` pattern (Mobotix, Loxone).
- **Implication for Phase 10:** the spike does NOT spin up a dedicated go2rtc test LXC. It runs tooling (openssl, ffprobe, mosquitto-pub/sub) directly on the App-VM, or inside a temporary lightweight container created only for Phase 10 if isolation is needed.

### Scope of Spike — "Alles"

The user explicitly selected full end-to-end scope. Phase 10 covers:

1. **SSDP discovery verification**
   - Listen on UDP 1990 and 2021 (both documented in research)
   - Confirm Bambu-specific packets: service type (`urn:bambulab-com:device:3dprinter:1` assumed) and payload format (model string — `H2C`-specific? or generic)
   - Capture a raw SSDP packet sample in the field notes

2. **RTSPS stream verification**
   - `openssl s_client -connect <ip>:322` → capture cert fingerprint + subject (confirm IP-only cert)
   - `ffprobe -rtsp_transport tcp -tls_verify 0 rtsps://bblp:<code>@<ip>:322/streaming/live/1` → confirm codec (H.264 expected), resolution, fps, audio presence
   - **Also probe `/streaming/live/2` (Bird's-Eye camera)** — if H2C exposes it, record codec + resolution; feature deferred to v1.3, but field notes must capture reality
   - Capture exact RTSPS URL pattern that works

3. **MQTT verification**
   - `mosquitto_sub -h <ip> -p 8883 --cafile /dev/null --insecure -u bblp -P <code> -t 'device/<serial>/#' -v` → capture topic names and a 60s sample of messages
   - Identify the field(s) that indicate **active print state** (needed for Adaptive Stream Mode in Phase 14) — candidates: `print.gcode_state`, `print.mc_print_stage`, `print.print_type`
   - Confirm TLS handshake behavior with self-signed cert

4. **End-to-end go2rtc smoketest**
   - Install go2rtc on App-VM (or ephemeral Phase-10 LXC — TBD in plan)
   - Deploy config with `rtspx://bblp:<code>@<ip>:322/streaming/live/1#video=copy`
   - Verify `http://<host>:1984/api/streams` returns a live stream
   - Pull the restream (`rtsp://<host>:8554/bambu`) with ffprobe — confirm Protect-adoption-ready output
   - **Do NOT actually adopt in Protect during Phase 10** — that's Phase 13

### What User Needs to Provide (when home)

| Info | Where to find it | Notes |
|------|------------------|-------|
| Printer IP | Bambu Handy App → Device → Device Info → IP, OR router DHCP list | Static-IP recommendation will go in Phase 15 docs |
| Serial Number | Bambu Handy → Device Info → SN, OR printer sticker | Needed for MQTT topic `device/<serial>/report` |
| Access Code (8-digit) | **Printer display** → Settings → WLAN → LAN Mode. Bambu Handy MAY also show it on some firmware | Printer-local only on older firmware |
| LAN Mode enabled | Printer display → Settings → WLAN → LAN Mode toggle ON | Required — without this, RTSPS + MQTT both refuse auth |

### What Claude Pre-Prepares (before user is home)

- Install required tooling on the App-VM: `openssl`, `ffmpeg` (ffprobe), `mosquitto-clients`, `tcpdump`, `socat`
- Write a spike script (`scripts/spike-h2c.sh` or similar) that takes `IP`, `SERIAL`, `CODE` as args and runs all four verification steps end-to-end, writing output to a timestamped log
- Download go2rtc binary, prepare a config template
- Draft the `H2C-FIELD-NOTES.md` template with empty slots to be filled from the spike run

### Output Artifact

`.planning/research/H2C-FIELD-NOTES.md` — committed to git. Structure:

```
# H2C Field Notes

**Tested:** <date>
**Printer:** H2C @ <ip>, serial <serial>, firmware <version>
**Tester:** <user>

## SSDP
- Port observed: 1990 / 2021
- Service type string: <actual>
- Sample packet: <hexdump or text>

## RTSPS (port 322)
- Cert subject: <from openssl>
- Live/1 stream: codec=<h264>, resolution=<WxH>, fps=<n>, audio=<yes/no>
- Live/2 (Bird's Eye): <present/absent>, if present: codec/res/fps

## MQTT (port 8883)
- Auth: bblp / <code>
- Topics observed: <list>
- Print-state field: <path in JSON>
- Sample active-print message: <excerpt>
- Sample idle message: <excerpt>

## go2rtc Smoketest
- Config used: <yaml>
- Restream URL: <rtsp://.../bambu>
- ffprobe of restream: <codec/res>
- Works with #video=copy: yes/no

## Known Issues / Surprises
- <anything that diverged from X1C/P1S assumptions>

## Recommendations for Phases 11-14
- <field-note-driven corrections to research assumptions>
```

## Specifics

- User flagged the **24/7 resource load concern** explicitly — Phase 10 must capture idle-vs-print MQTT messages so Phase 14 can implement Adaptive Stream Mode correctly.
- User used phrase **"ein System für alles"** — spike uses production VM, results deploy to production LXC. No separate test rig.
- User is not home right now — **pre-preparation is the name of the game for this session**. Executable spike script ready, step-by-step run guide ready, so the actual run-against-hardware takes ~15 minutes when user is back.

## Claude's Discretion

- Exact tooling choices (mosquitto-clients vs MQTT.js CLI, tcpdump vs tshark)
- Spike script language (bash likely — keep it simple, no Node tooling before Phase 11 actually adds the mqtt dep)
- Log format for the spike run (plain text vs structured)
- Whether to run the go2rtc smoketest on the App-VM directly (fastest) or in a Phase-10-only throwaway LXC (cleaner) — planner decides

## Deferred Ideas

- **Cloud-mode Access Code retrieval** via Bambu Handy API reverse-engineering — user asked if remote is possible. Deferred to v1.3 Cloud-Auth milestone.
- **Bird's-Eye Camera as a supported feed in v1.2** — Phase 10 probes it for field notes, but remains deferred per REQUIREMENTS.md.
- **Firmware detection** — nice to record which firmware the H2C is on for future correlation, but not in-scope as a feature.

## Success for Phase 10

- [ ] Spike script written and reviewed on App-VM
- [ ] User provides IP, Serial, Access Code; LAN Mode confirmed ON
- [ ] All 4 verification areas run against real H2C
- [ ] `.planning/research/H2C-FIELD-NOTES.md` written and committed
- [ ] Any divergences from X1C/P1S assumptions flagged for Phase 11+ plan revision
