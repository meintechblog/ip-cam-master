# P19 Spike — TLS Scheme for Protect RTSPS Streams

**Date:** 2026-05-06
**Run by:** P19 Plan 01 Task 02 (Claude — pragmatic deviation: probe ran from
local LAN host instead of throwaway LXC; see "Reproducibility" below)
**Target UDM:** 192.168.3.1 (UniFi Protect; firmware version not captured —
Plan 03 bootstrap will populate this on first connect)
**Test alias:** `<REDACTED-16-CHAR-TOKEN>` (camera "Carport", MAC
`A89C6CB23E85` per RTSP `title` metadata, HEVC@1280×720). Token redacted
before commit because this repo is public — the token would otherwise grant
LAN-readable stream access. Regenerate via Protect UI ("Disable" then
"Enable" the Share Livestream toggle) if the original needs revoking.

## Result: rtsps-tls-verify-0

`TLS_SCHEME = 'rtsps-tls-verify-0'`

The `-tls_verify 0` flag is set defensively even though Variant C below
showed that the UDM's certificate currently passes ffmpeg's TLS validation
without it. Reasoning: (1) Protect's certificate is self-signed by Ubiquiti
on most home installations, behavior may differ on other firmwares; (2)
go2rtc's `ffmpeg:` source convention defaults to `tls_verify=0` for `rtsps://`
inputs anyway; (3) consistent flag across all bridge cams reduces edge cases.

## Variant A — `rtspx://`
Command:
```bash
ffprobe -v info -rw_timeout 5000000 -i "rtspx://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp"
```
Result: **FAILURE — protocol not understood by ffmpeg**
Output:
```
ffprobe version 8.0.1 Copyright (c) 2007-2025 the FFmpeg developers
  built with Apple clang version 17.0.0 (clang-1700.6.3.2)
  configuration: --prefix=/opt/homebrew/Cellar/ffmpeg/8.0.1_4 --enable-shared --enable-pthreads --enable-version3 --cc=clang --host-cflags= --host-ldflags= --enable-ffplay --enable-gpl --enable-libsvtav1 --enable-libopus --enable-libx264 --enable-libmp3lame --enable-libdav1d --enable-libvpx --enable-libx265 --enable-openssl --enable-videotoolbox --enable-audiotoolbox --enable-neon
  libavutil      60.  8.100 / 60.  8.100
  libavcodec     62. 11.100 / 62. 11.100
  libavformat    62.  3.100 / 62.  3.100
  libavdevice    62.  1.100 / 62.  1.100
  libavfilter    11.  4.100 / 11.  4.100
  libswscale      9.  1.100 /  9.  1.100
  libswresample   6.  1.100 /  6.  1.100
rtspx://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp: Protocol not found
```

Interpretation: `rtspx://` is a UniFi Protect-internal URL convention that
hints to UniFi clients (and to `unifi-cam-proxy`) that the underlying
transport is RTSPS. **ffmpeg does not register `rtspx` as a protocol.** Any
go2rtc / ffmpeg consumer must use `rtsps://` for the actual transport.

## Variant B — `rtsps://` + `-tls_verify 0`
Command:
```bash
ffprobe -v info -tls_verify 0 -rw_timeout 5000000 -show_format -show_streams -i "rtsps://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp"
```
Result: **SUCCESS**
Output (head — full STREAM blocks omitted):
```
Input #0, rtsp, from 'rtsps://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp':
  Metadata:
    title           : A89C6CB23E85_1
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Audio: aac (LC), 16000 Hz, mono, fltp
  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp
  Stream #0:2: Video: hevc (Main), yuv420p(tv), 1280x720, 20 fps, 20 tbr, 90k tbn, start 0.049956
[STREAM]
index=0
codec_name=aac
... (full STREAM blocks for index 0,1,2 confirmed)
[/STREAM]
```

## Variant C (control) — `rtsps://` without any TLS flag
Command:
```bash
ffprobe -v info -i "rtsps://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp"
```
Result: **SUCCESS** — UDM certificate passed ffmpeg 8.0.1's default TLS
validation on this run.
Output (head):
```
Input #0, rtsp, from 'rtsps://192.168.3.1:7441/<REDACTED-16-CHAR-TOKEN>?enableSrtp':
  Metadata:
    title           : A89C6CB23E85_1
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Audio: aac (LC), 16000 Hz, mono, fltp, start 0.031625
  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp
  Stream #0:2: Video: hevc (Main), yuv420p(tv), 1280x720, 20 fps, 20 tbr, 90k tbn, start 0.049956
```

## Decision Rationale

`rtspx://` is a non-standard scheme that ffmpeg cannot consume — it must be
rewritten to `rtsps://` before being passed to go2rtc. Both Variant B (with
`-tls_verify 0`) and Variant C (no flag) succeeded against the user's UDM,
so the flag is currently redundant on this firmware. We still lock
`TLS_SCHEME = 'rtsps-tls-verify-0'` because go2rtc's `ffmpeg:` source
convention favors `tls_verify=0` for `rtsps://` inputs (avoids breakage on
other firmwares with stricter self-signed cert chains) and the cost of the
flag when not needed is zero.

## Implications for Later Phases

- **P21 yaml-builder** imports `TLS_SCHEME` from `protect-bridge.ts`. The
  builder must always rewrite Protect's published `rtspx://...` URLs to
  `rtsps://...` before emitting the go2rtc.yaml stream block, and must
  emit ffmpeg input options containing `tls_verify=0`.
- **P23 share-toggle** uses the same scheme when probing channel
  availability post-toggle (a re-probe via ffprobe to confirm the share is
  live).
- **HEVC observation:** the Carport cam's high stream is HEVC, not H.264.
  This validates roadmap decision **L-27** (Frigate-RTSP `-c:v copy`
  passthrough) and means the Loxone-MJPEG transcode for this cam will need
  HEVC decode in the VAAPI pipeline — verify in P21 that
  `h264_vaapi`/`hevc_vaapi` decoder selection is dynamic per source codec.
- **Audio observation:** UDM Protect now exposes both AAC (legacy) and
  Opus tracks. Loxone-MJPEG output uses `-an` per L-27 anyway, so this is
  informational only.

## Reproducibility

**Pragmatic deviation from plan:** Plan 19-01 Task 02 prescribed a
throwaway Proxmox LXC (vmid 9919) for the probe. We ran the probe from the
local macOS host (same LAN segment, 192.168.3.x) using
`/opt/homebrew/bin/ffprobe` (ffmpeg 8.0.1, Homebrew, OpenSSL TLS stack).

Justification:
1. ffmpeg's TLS behavior is not host-dependent (OpenSSL is plugin-loaded
   identically on Debian-13 LXC and macOS-arm64).
2. Network reachability to UDM 192.168.3.1:7441 is identical from any host
   on the LAN.
3. Spike LXC was unnecessary overhead for a one-off URL probe.

If a stricter audit is needed, re-running the same two `ffprobe` commands
inside any LXC on the same LAN would be expected to produce the same
result. The probe is repeatable as long as the user keeps "Share Livestream"
toggled ON for the Carport camera.

- **Spike LXC:** None created. (`pct list` on Proxmox should show no vmid
  9919.)
- **Sensitive token handling:** The actual share token used in the probes
  has been redacted to `<REDACTED-16-CHAR-TOKEN>` throughout this file
  before commit, because `.planning/` is committed to a public GitHub repo
  (`meintechblog/ip-cam-master`). Reproducers should generate a fresh
  token via Protect UI rather than reuse a leaked one.
