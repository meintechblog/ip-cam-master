---
spike: 001
name: a1-port-surface
validates: "Given a live A1 at $A1_IP, when we TCP-probe Bambu-relevant ports (80, 443, 322, 554, 990, 1984, 6000, 8883, 8553, 8554), then we map which ports A1 exposes and can compare to H2C's surface"
verdict: VALIDATED
related: []
tags: [bambu, a1, reconnaissance]
---

# Spike 001: A1 Port Surface

## What This Validates

Given a live Bambu Lab A1 on the local network, when we probe Bambu-relevant TCP
ports with a 2s timeout each, then we learn which protocol endpoints A1 actually
exposes and can compare that surface to the H2C's known surface (RTSPS:322 +
MQTT:8883 + FTPS:990 + HTTP:80).

This is the reconnaissance that decides whether the rest of the branch can reuse
the H2C path 1:1 or needs a different camera-ingestion strategy.

## How to Run

```bash
set -a; source .env.a1; set +a
./.planning/spikes/001-a1-port-surface/probe.sh "$A1_IP"
```

Credentials stay in the gitignored `.env.a1` at repo root. The script only uses
`$A1_IP` for this spike.

## What to Expect

One line per port with `OPEN` or `closed`. `OPEN` means TCP SYN/ACK completed
within 2 seconds. A printer powered off or on a different network will show all
ports closed.

## Results

**Captured 2026-04-20 against real A1 (see `probe-output.txt` for raw run):**

| Port | State  | Notes                                                                 |
|------|--------|-----------------------------------------------------------------------|
| 80   | closed | No HTTP admin UI (H2C also has no HTTP UI — consistent)               |
| 443  | closed | No HTTPS admin UI                                                     |
| 322  | **closed** | **Critical**: A1 does NOT expose the Bambu RTSPS chamber camera    |
| 554  | closed | No standard RTSP                                                      |
| 990  | OPEN   | FTPS (Bambu SD-card access — same as H2C)                             |
| 1984 | closed | No go2rtc on printer (expected — printer doesn't run go2rtc)          |
| 6000 | **OPEN**   | **Matches community reports**: A1 proprietary stream endpoint     |
| 8883 | OPEN   | Bambu MQTT LAN mode — same as H2C                                     |
| 8553 | closed | —                                                                     |
| 8554 | closed | No RTSP alt                                                           |

### A1 vs H2C surface diff

| Port | H2C   | A1     | Meaning                                                      |
|------|-------|--------|--------------------------------------------------------------|
| 322  | OPEN  | closed | **A1 has no native RTSPS camera endpoint**                   |
| 6000 | —     | OPEN   | A1-only proprietary stream port (not on H2C)                 |
| 8883 | OPEN  | OPEN   | MQTT LAN control is identical                                |
| 990  | OPEN  | OPEN   | FTPS SD-card access is identical                             |

### Signal for the build

- Kill the "reuse H2C RTSPS branch 1:1" idea — the port isn't even open.
- **The A1 camera path must go through port 6000.** This is where Spike 004 goes.
- MQTT LAN control on 8883 appears unchanged → Spike 003 should find the same
  `bblp`+access-code auth working identically.
- FTPS:990 being open means if we ever want to read/write gcode on the SD card
  for either printer, the code path is shared.
