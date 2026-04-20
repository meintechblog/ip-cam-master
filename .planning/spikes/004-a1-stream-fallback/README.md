---
spike: 004
name: a1-stream-fallback
validates: "Given port 6000 open on A1 (per spike 001) and port 322 closed (per spike 002), when we TLS-connect to :6000 and send the Bambu proprietary 80-byte auth packet (bblp + access code), then the printer streams valid JPEG frames we can decode and feed into a transcoder — proving a go2rtc- or ffmpeg-based ingestion branch is feasible"
verdict: VALIDATED
related: [001, 002, 003]
tags: [bambu, a1, go2rtc, fallback, camera, critical-path]
---

# Spike 004: A1 Stream Fallback (Port 6000 JPEG-over-TLS)

## What This Validates

This is the **critical-path** spike for the A1 build. Spike 002 killed the
"reuse H2C RTSPS branch" dream; the remaining question is whether we can
actually get pixels out of the A1's toolhead camera at all.

Given port 6000 open on A1 (spike 001) and port 322 closed (spike 002), when we
TLS-connect to `:6000` and send the Bambu proprietary 80-byte auth packet
(`bblp` + access code, exact byte layout per ha-bambulab `pybambu/bambu_client.py`
`ChamberImageThread.run()`), then the printer streams valid JPEG frames
prefixed with a 16-byte frame header. If we can decode even one frame
end-to-end (TLS + auth + frame parse + JPEG magic + dimensions), the entire
transcoding branch is proven feasible.

## How to Run

```bash
set -a; source .env.a1; set +a
node .planning/spikes/004-a1-stream-fallback/probe.mjs           # 1 frame
FRAMES=40 node .planning/spikes/004-a1-stream-fallback/probe.mjs # FPS measurement
```

The script saves the first and last JPEG frames to
`frame-001.jpg` / `frame-NNN.jpg` for visual confirmation.

## What to Expect

1. TLS handshake succeeds on TLSv1.2 with a self-signed cert
   (`CN = <printer-SN>`, issuer `BBL CA`).
2. After sending the 80-byte auth packet, the first frame arrives within
   ~1 second.
3. Each frame: 16-byte header (first u32 LE = payload size) + N-byte JPEG
   payload starting `FF D8` and ending `FF D9`.
4. Dimensions: 1536×1080 (matches `ipcam.resolution: "1080p"` from spike 003).

## Results

**Captured 2026-04-20 against real A1:**

### 1. TLS handshake

```
[probe] TLS up (authorized=false, protocol=TLSv1.2)
[probe] peer cert subject: {"CN":"03919A3B0100254"}
[probe] peer cert issuer:  {"C":"CN","O":"BBL Technologies Co., Ltd","CN":"BBL CA"}
[probe] peer cert valid:   Nov  5 11:05:21 2023 GMT → Nov  2 11:05:21 2033 GMT
```

Subject CN is the printer serial number. Issuer "BBL Technologies Co., Ltd" →
"BBL CA" is Bambu's internal PKI. Cert is self-signed from our CA's
perspective → `rejectUnauthorized: false` is mandatory.

### 2. Auth handshake

The *correct* byte layout — confirmed working today against A1 FW currently
shipping on this unit:

```
offset 0  : 0x40 0x00 0x00 0x00   (u32 LE = 0x40, packet type)
offset 4  : 0x00 0x30 0x00 0x00   (u32 LE = 0x3000, subtype)
offset 8  : 0x00 0x00 0x00 0x00
offset 12 : 0x00 0x00 0x00 0x00
offset 16 : "bblp" + 28 null bytes       (32-byte username field)
offset 48 : <access_code ascii> + nulls  (32-byte password field)
total     : 80 bytes
```

**Gotcha captured here**: the author's first attempt wrote `buf[4] = 0x30`,
which gives bytes `30 00 00 00` at offset 4 — that's u32 LE = `0x30`, *not*
`0x3000`. The printer silently drops the connection (12 s timeout, no bytes
sent back). Correct encoding is `buf.writeUInt32LE(0x3000, 4)` → bytes
`00 30 00 00`. **Must-document for the build.**

### 3. Frame format

The printer prefixes every JPEG with a 16-byte header:

```
offset 0  : u32 LE = JPEG payload size in bytes
offset 4  : u32 LE = 0x00000000
offset 8  : u32 LE = 0x00000001  (sequence flag — per ha-bambulab notes)
offset 12 : u32 LE = 0x00000000
```

Then the JPEG payload: starts `FF D8`, ends `FF D9`, SOF0 marker inside gives
dimensions.

### 4. Live capture metrics (40 frames, idle state)

| Metric                 | Value                            |
|------------------------|----------------------------------|
| Frames received        | 40 / 40                          |
| JPEG magic + EOI valid | 40 / 40                          |
| Dimensions (all)       | **1536×1080**                    |
| Frame size range       | 148 KB – 222 KB (avg ~185 KB)    |
| Capture duration       | 87.45 s                          |
| **Frame rate (idle)**  | **~0.45 fps (1 frame / 2.2 s)**  |
| Connection stability   | 87 s continuous, no drops        |
| Protocol               | TLSv1.2                          |

Sample saved: `frame-001.jpg` (first), `frame-040.jpg` (after ~87 s).
Visual inspection shows A1's build plate from the toolhead-mounted camera —
user's workshop visible in background, PEI sheet in foreground. Real,
continuous stream.

### Verdict: VALIDATED

A fully-working, locally-reproducible JPEG-over-TLS client for the A1 camera
fits in ~150 lines of Node.js. No external daemon required to *pull* frames.

### Signal for the build

**1. Native Node implementation is viable.** We don't need to shell out to
go2rtc for ingestion — pulling frames with the existing `mqtt`-era Node
dependencies is sufficient. That keeps the "one deployment artifact" property
of the app intact.

**2. But we still need go2rtc for the *output* side.** UniFi Protect expects
RTSP. The cleanest pipeline is:

```
  A1 :6000 ──(TLS+JPEG)──▶ ffmpeg (stdin: mjpeg) ──(RTSP)──▶ go2rtc ──▶ Protect
```

ffmpeg with `-f mjpeg -i -` accepts a stream of concatenated JPEGs on stdin.
We wrap the raw JPEGs from port 6000 into an MJPEG stream (just concatenate —
no boundary delimiter needed because each JPEG self-delimits with `FF D8`
start and `FF D9` end). ffmpeg then re-packages as H.264 + RTSP and either
publishes to go2rtc or exposes RTSP directly.

Alternative: generate a go2rtc yaml whose source is `exec:` pointing at our
own Node script, which spits MJPEG bytes to stdout. This reuses the exact
output wiring already in `src/lib/server/services/go2rtc.ts:111-127` (see the
Loxone-nginx pattern).

**3. Frame rate is the real UX risk.** 0.45 fps at idle will look like a
static image, not a live feed, in UniFi Protect. Three mitigations worth
planning:

  - **Accept it and label the stream "snapshot mode".** H2C already has an
    `adaptive` / `always_snapshot` mode split; extend to A1 so idle shows
    low-fps, live-print shows whatever the A1 gives us.
  - **Measure fps during an active print.** Community reports suggest A1
    ramps up to ~1–2 fps while printing. Worth confirming before shipping,
    but not blocking for this spike. Open a follow-up UAT item.
  - **If truly unacceptable, ffmpeg can pad with `-r 5 -vsync cfr`** —
    duplicates the most recent frame to synthesize a higher output rate.
    Keeps UniFi happy. Not ideal but available.

**4. Adoption path = same as H2C.** Once ffmpeg is producing RTSP, the
existing container provisioning, go2rtc config wiring, and UniFi Protect
adoption flow apply unchanged. **Only the `source:` line in the generated
go2rtc.yaml changes.**

**5. The 80-byte auth layout is *the* sharp edge.** The `u32 LE 0x3000`
encoding at offset 4 is non-obvious and silently fails (no error response)
if wrong. Unit test the exact byte output of the auth builder.

**6. Cert subject CN = printer SN.** If we ever want to *verify* we're
talking to the right printer (defense-in-depth beyond `rejectUnauthorized:
false`), we can pin the peer cert CN to the stored `serialNumber` in the
`cameras` table. Nice-to-have; not required for feasibility.
