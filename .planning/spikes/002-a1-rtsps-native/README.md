---
spike: 002
name: a1-rtsps-native
validates: "Given port 322 status from spike 001, when we attempt ffprobe with the exact URL template that works for H2C (rtsps:// and rtspx://) against A1, then we confirm whether A1 reuses the H2C RTSPS camera branch and capture the canonical error for preflight messaging"
verdict: INVALIDATED
related: [001, 004]
tags: [bambu, a1, rtsps, camera, preflight]
---

# Spike 002: A1 RTSPS Native Path

## What This Validates

Given the port surface from spike 001 (322 closed on A1), when we still attempt
the exact ffprobe command the production code runs for the H2C
(`bambu-preflight.ts:134`, `go2rtc.ts:149`), then we get two answers:

1. **Hard verdict**: does A1 reuse H2C's RTSPS camera branch 1:1?
2. **Canonical error string**: what exactly does ffprobe print when attempting
   the H2C URL against an A1? This matters for building a correct preflight
   error classifier — the existing one misclassifies ECONNREFUSED as
   "LAN_MODE_OFF", which is *wrong* for A1 (A1's LAN mode IS on; port 322 is
   simply not an A1 endpoint).

## How to Run

```bash
set -a; source .env.a1; set +a
./.planning/spikes/002-a1-rtsps-native/probe.sh
# or reproduce directly:
ffprobe -hide_banner -rtsp_transport tcp -tls_verify 0 \
  -i "rtsps://bblp:${A1_ACCESS_CODE}@${A1_IP}:322/streaming/live/1"
```

## What to Expect

H2C produces `ffprobe exit 0` + stream info. A1 is expected to fail. We care
about the *class* of failure so we can build the right preflight classifier
branch.

## Results

**Captured 2026-04-20 (see `ffprobe-output.txt` for raw):**

### Scheme `rtsps://` (production preflight scheme)

```
[tcp @ …] Connection to tcp://192.168.3.195:322?timeout=0 failed: Connection refused
rtsps://bblp:<ACCESS_CODE>@192.168.3.195:322/streaming/live/1: Connection refused
Exit: 1
```

### Scheme `rtspx://` (go2rtc source scheme)

```
rtspx://bblp:<ACCESS_CODE>@192.168.3.195:322/streaming/live/1: Protocol not found
Exit: 1
```

ffprobe/ffmpeg's CLI doesn't know `rtspx://` — that scheme is a go2rtc-internal
extension. Irrelevant for preflight; noted for completeness.

### Verdict: INVALIDATED — A1 does NOT share H2C's RTSPS camera branch

### Signal for the build

**1. Model-branched preflight is mandatory.** The current
`runBambuPreflight()` (`src/lib/server/services/bambu-preflight.ts:57`) runs
`checkRtsps` unconditionally after `checkTcp(322)`. For an A1:

- `checkTcp(ip, 322, 3000)` returns `{ ok: false, reason: 'REFUSED' }`
- → `fail('LAN_MODE_OFF')` fires
- → user sees **"LAN Mode scheint deaktiviert"** — which is **wrong**

The A1's LAN mode is on (MQTT 8883 accepts us), but 322 simply doesn't exist on
A1. The preflight must:
  - Either accept the `PrinterModel` as input and skip the 322/RTSPS checks for A1
  - Or run preflight checks that are correct *per model family*

**2. Camera branch needs a second implementation.** Since native RTSPS is gone,
the camera side of A1 has to be handled via port 6000 (spike 004 target) —
either through go2rtc's `bambu:` source type or a custom transcoding wrapper
like the Mobotix branch (`go2rtc.ts:43-62`).

**3. The error classifier in `bambu-preflight.ts:170-177` is correct *for H2C*
but the *mapping* in `runBambuPreflight` (:66-74) is what needs the model split
— not the low-level `checkRtspsReal`.
