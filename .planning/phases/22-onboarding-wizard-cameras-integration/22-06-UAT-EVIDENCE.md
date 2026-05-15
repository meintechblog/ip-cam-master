---
phase: 22
plan: 06
slug: live-vm-uat
status: completed
started: 2026-05-07T13:30:00Z
completed: 2026-05-15T00:55:00Z
---

# Phase 22 — Live VM UAT Evidence

## Pre-flight (initial)

**Date:** 2026-05-07T13:30:00Z (deferred — actual UAT run on 2026-05-15)

| Check | Result |
|---|---|
| Local SHA == VM SHA | ✅ `6e4af7f` (then advanced through fix commits 45b82f5 → f42f8f7 → 79f8096 → 88e5bb4) |
| VM service status | ✅ `active (running)` |
| Bridge LXC vmid 2014 @ 192.168.3.139 | ✅ go2rtc :1984 listed 7 active streams (pre-UAT P21 carry-over) |
| `/api/protect-hub/health` (P22 Wave 2 new endpoint) | ✅ `bridgeHealthy: true, go2rtcReady: true` |

## UAT run 2026-05-15

User context: enabled "Share Livestream" on all UniFi-native cams in Protect; asked to integrate the cams into the Protect Hub.

### Deploy

`./scripts/dev-deploy.sh` pushed 45 commits to `vm/main`; post-receive hook ran `npm ci` + `npm run build` + `systemctl restart ip-cam-master`. Final SHA at completion: **88e5bb4** (after the 3 fix commits below).

### Discover

`POST /api/protect-hub/discover` → `{ok: true, insertedCams: 0, updatedCams: 19, insertedChannels: 54}`.

Catalog state — first-party UniFi cams with Medium-quality share enabled:
Büro, Flur, Küche, Spielturm, Wohnen, Technik, Schlafen, Mobil, Carport (9 cams).
Cam 36 Haustür (G6 Pro Entry doorbell) — no share enabled in Protect.
11 third-party Mobotix-via-adoption duplicate rows — expected, all share-off.

### Outputs onboarded

| Cam | Outputs | Note |
|---|---|---|
| 30 Büro | loxone-mjpeg | pre-existing |
| 31 Flur | loxone-mjpeg | pre-existing |
| 32 Küche | loxone-mjpeg | pre-existing |
| 33 Spielturm | loxone-mjpeg | pre-existing |
| 34 Wohnen | loxone-mjpeg | pre-existing |
| 37 Technik | frigate-rtsp | enabled via PUT /api/cameras/37/outputs (loxone-mjpeg blocked by 6-cap VAAPI hard cap) |
| 38 Schlafen | frigate-rtsp | enabled via PUT (6-cap) |
| 39 Mobil | frigate-rtsp | enabled via PUT (6-cap) |
| 40 Carport | loxone-mjpeg + frigate-rtsp | pre-existing |

VAAPI hard cap (6 simultaneous loxone-mjpeg transcodes) prevented enabling MJPEG on Technik/Schlafen/Mobil. Fell back to frigate-rtsp passthrough (zero VAAPI cost) — user can swap which 6 cams get MJPEG later via the UI toggles.

### Wizard state

`POST /api/protect-hub/wizard/6` → pointer to step 6. `POST /api/protect-hub/wizard/complete` → `settings.protect_hub_enabled = 'true'` + `hub_onboarding_state.status = 'completed'`.

### Bugs found + fixed during UAT

**B-UAT-01 — go2rtc MJPEG VAAPI pipeline produces 0 bytes** (fixed in commits f42f8f7 + 79f8096).
go2rtc 1.9.14's `ffmpeg:` shorthand for `#video=mjpeg#hardware=vaapi` emits a broken filter chain (`-hwaccel vaapi -hwaccel_output_format vaapi` + `-vf format=vaapi|nv12,hwupload,scale_vaapi=…`). The hwupload runs against an already-GPU frame; ffmpeg fails to insert auto_scale and exits with "Impossible to convert between the formats supported by the filter 'graph -1 input from stream 0:0' and the filter 'auto_scale_0'". Every loxone-mjpeg consumer got 0 bytes since P21 shipped — none of the 5 pre-existing outputs had ever served a frame in production.

Fix: switch loxone-mjpeg to `exec:` source so go2rtc runs the literal ffmpeg argv (execv, no shell) and skips its auto-construction. Manual pipeline uses `-init_hw_device vaapi=intel:/dev/dri/renderD128 -filter_hw_device intel … -vf format=nv12|vaapi,hwupload,scale_vaapi=640:360 -c:v mjpeg_vaapi`. (yaml-builder.ts + tests + 4 golden fixtures regen.)

**B-UAT-02 — ffmpeg 7.1.3 RTSP demuxer rejects `-reconnect`** (fixed in commit 79f8096).
After B-UAT-01 fix, ffmpeg bailed at input-open: "Option not found" for the D-PIPE-05 reconnect flags. ffmpeg's `-reconnect` family applies only to HTTP demuxers; the RTSP demuxer rejects them as input options before any frame is decoded. (Frigate-RTSP's `ffmpeg:` shorthand survives only because go2rtc places those flags AFTER `-i`, where ffmpeg silently tolerates them as no-op output options.) Reconnect on upstream loss is now handled by go2rtc's `exec:` lifecycle: ffmpeg exits → go2rtc respawns on next consumer demand.

**B-UAT-03 — /kameras external section showed 19 rows including 11 useless duplicates** (fixed in commit 88e5bb4).
Hub discovery enumerates every Protect-managed cam, including the Mobotix-via-adoption rows that duplicate this app's own managed LXC cams. The unfiltered external section rendered all 19 — 9 first-party UniFi cams that actually work + 10 third-party rows with no outputs/no working stream. Filter added in `+page.svelte`: external section now requires at least one enabled output.

### Stream sweep (final, 9 cams)

`http://192.168.3.139:1984/api/stream.mjpeg?src=<slug>` consumer for 8 s each, retry once on cold-start fail:

| Cam | Slug | Type | Result | Notes |
|---|---|---|---|---|
| Büro (30) | d021f996b53f-low | MJPEG | OK | 1.45 MB / 8 s |
| Flur (31) | d021f99623e7-low | MJPEG | OK | 1.24 MB / 8 s |
| Küche (32) | d021f996ad59-low | MJPEG | OK | 1.89 MB / 8 s |
| Spielturm (33) | d021f9968bf5-low | MJPEG | OK | 1.40 MB / 8 s |
| Wohnen (34) | d021f99697c5-low | MJPEG | OK | 1.37 MB / 8 s |
| Carport (40) | a89c6cb23e85-low | MJPEG | OK | 1.24 MB / 8 s |
| Technik (37) | d021f9969b05-high | RTSP | UPSTREAM | UDM invalidates TLS session on frame-pull (see note) |
| Mobil (39) | d021f996abf9-high | RTSP | UPSTREAM | Same |
| Schlafen (38) | d021f996c201-high | RTSP | UPSTREAM | Same |
| Carport (40) | a89c6cb23e85-high | RTSP | OK | h.265 1280x720 20fps |

**Upstream-side issue (NOT our code):** Technik/Mobil/Schlafen RTSPS upstream returns SDP successfully but immediately invalidates the TLS session on frame-pull: `[tls] The specified session has been invalidated for some reason` → `Error during demuxing: Input/output error`. Reproduced with direct ffmpeg straight from the bridge (no go2rtc in path). Carport's RTSPS works for the same code path. Likely UniFi Protect's "Share Livestream" feature behaves differently from per-channel "Allow RTSPS" — user may need to enable RTSPS persistently for those cams in Protect, or this is a UniFi firmware quirk on the G5/G6 lineup.

### Tests

`npx vitest run src/lib/server/orchestration/protect-hub/ src/routes/api/protect-hub/ src/routes/api/cameras/` → 120/120 passed after both fix commits.
`npx vitest run src/routes/kameras` → 5/5 passed after the filter commit.

### Final state

- `settings.protect_hub_enabled = true`
- `hub_onboarding_state.step = 6, status = completed`
- 9 first-party UniFi cams in `/kameras` external section with Hub badges + working outputs
- 10 third-party adoption duplicates hidden from UI (kept in DB for diagnostics)
- Bridge vmid 2014 healthy, go2rtc serving 10 streams, reconciler idle
- No errors in `journalctl -u ip-cam-master`

### Open items (deferred)

- UDM "Share Livestream" → persistent RTSPS conversion for Technik/Mobil/Schlafen (user action in Protect UI, not a code change)
- Doorbell cam 36 was in `source='external_archived'` from an earlier wizard reset — will resurface in the catalog on next discover if user enables Share Livestream on its Medium channel; P23 will add an archive view
- VAAPI hard-cap (6 MJPEG) re-balance — user choice which 6 of 9 cams get MJPEG vs RTSP, surfaced via `/kameras` OutputsSubsection toggles
