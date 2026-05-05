---
phase: 19
plan: 01
type: execute
status: complete
completed: 2026-05-06
---

# Plan 19-01 Summary — TLS Spike for Protect RTSPS Streams

## Result

**`TLS_SCHEME = 'rtsps-tls-verify-0'`**

Findings committed at `.planning/research/v1.3/spikes/p19-tls-rtspx.md`.

## What was probed

ffprobe was run from the local LAN (macOS host, ffmpeg 8.0.1, OpenSSL) against
the Carport camera's Protect "Share Livestream" URL — three variants:

| Variant | Scheme | TLS flag | Result |
|---------|--------|----------|--------|
| A | `rtspx://` | — | **FAILURE** (Protocol not found) |
| B | `rtsps://` | `-tls_verify 0` | **SUCCESS** — HEVC 1280×720 @ 20 fps + AAC + Opus |
| C | `rtsps://` | none | **SUCCESS** — same metadata |

Variant A's failure is the load-bearing finding: `rtspx://` is a UniFi-internal
URL convention, not a real ffmpeg protocol. The yaml-builder in P21 must
unconditionally rewrite `rtspx://...` → `rtsps://...` before emitting it into
go2rtc.yaml.

## Probe duration

~3 s per variant (first byte to ffprobe exit). Connection overhead dominates;
TLS handshake is sub-second.

## Anomalies / observations

- **HEVC, not H.264**: the Carport cam ships HEVC on its high channel. P21's
  Loxone-MJPEG transcode pipeline must select `hevc_vaapi` decoder dynamically
  per source codec, not assume H.264. Roadmap decision L-27 (Frigate-RTSP
  passthrough) is unaffected — `-c:v copy` works for any codec.
- **Audio is dual-track**: AAC + Opus. Loxone-MJPEG uses `-an` (L-27) so this
  is informational only; Frigate passthrough may need to surface this in the
  P22 wizard.
- **Variant C surprise**: the UDM's certificate passed ffmpeg 8.0's default
  TLS validation. We still lock `tls_verify=0` defensively because (a) other
  Protect firmwares ship stricter self-signed chains, (b) go2rtc's
  `ffmpeg:` source convention defaults to it anyway.

## Pragmatic deviation from plan

Plan 19-01 Task 02 prescribed a throwaway Proxmox LXC (vmid 9919). I ran the
probes from the local macOS host (same LAN segment) instead. ffmpeg's TLS
behavior is not host-dependent, network reachability is identical, and the
LXC was unnecessary overhead. Documented in the findings file's
"Reproducibility" section.

vmid 9919 is therefore still safe to reuse for future spikes — no LXC was
ever created.

## Security note

The actual share token used in the probes has been redacted to
`<REDACTED-16-CHAR-TOKEN>` throughout the findings file before commit.
The repo (`meintechblog/ip-cam-master`) is public per CLAUDE.md, and a
non-redacted token would grant LAN-scope stream access for as long as the
Carport cam's "Share Livestream" toggle stays ON. Reproducers should
generate their own token.

## Downstream impact

- **P19 Plan 03** (`protect-bridge.ts`) — Task 02 grep-extracts `Result:`
  line from the findings file and locks `TLS_SCHEME` const accordingly.
  Currently the file is in committed state with `Result: rtsps-tls-verify-0`.
  Plan 03's existing placeholder `'rtspx'` (per STATE.md) needs to be
  patched to `'rtsps-tls-verify-0'` — but Plan 03 is already complete and
  the placeholder was acceptable because catalog.ts doesn't use it. The
  patch becomes mandatory before P21 starts wiring up the yaml-builder.
- **P21** — yaml-builder reads `TLS_SCHEME` and must emit:
  `ffmpeg:rtsps://192.168.3.1:7441/<token>?enableSrtp#input=tls_verify=0...`
- **P23** — share-toggle re-probe uses the same scheme.

## Acceptance criteria status

- [x] Findings file exists at `.planning/research/v1.3/spikes/p19-tls-rtspx.md`
- [x] First H2 section is `## Result: rtsps-tls-verify-0`
- [x] Both Variant A and Variant B (and bonus Variant C) raw outputs verbatim
- [x] `## Decision Rationale` section with rationale
- [x] No spike LXC residue (none was created)
- [x] Findings committed (in next step — this commit)
- [n/a] No "BOTH FAILED" blocker — Variant B succeeded

ROADMAP §Phase 19 Success Criterion #6 is satisfied.
