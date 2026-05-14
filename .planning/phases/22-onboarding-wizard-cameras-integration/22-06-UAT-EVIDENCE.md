---
phase: 22
plan: 06
slug: live-vm-uat
status: in_progress
started: 2026-05-07T13:30:00Z
---

# Phase 22 — Live VM UAT Evidence

## Pre-flight (Task 1, automated)

**Date:** 2026-05-07T13:30:00Z

| Check | Result |
|---|---|
| Local SHA == VM SHA | ✅ `6e4af7f83a38ac9e4927c300719b545b4bba8747` |
| VM service status | ✅ `active (running)` |
| VM HTTP probe `/kameras` | ✅ `HTTP/1.1 200 OK` (12814 bytes) |
| `hub_onboarding_state` schema on VM | ✅ Table exists with 5 columns (id PK default 1, step, status default 'in_progress', last_activity_at, error) |
| Wizard state reset | ✅ `hub_onboarding_state` empty; `settings.protect_hub_enabled=false` |
| Bridge LXC vmid 2014 @ 192.168.3.139 | ✅ go2rtc :1984 listed 7 active streams (P21 Loxone-MJPEG + Frigate-RTSP outputs still flowing) |
| `/api/protect-hub/health` (P22 Wave 2 new endpoint) | ✅ `bridgeHealthy: true, go2rtcReady: true, streamCount: 7, reconcilerBusy: false` |

**Note:** Plan 06 originally said `192.168.3.178:3000` and `data/db.sqlite`; actual deployment serves on port 80 and the DB lives at `data/ip-cam-master.db`. Pre-flight adjusted accordingly. Mac cannot probe VM directly (LAN topology); UAT browser session runs from a host on the same LAN.

## Wizard end-to-end (Task 2 — human verify)

(awaiting user UAT)

## /kameras + external cam detail (Task 3 — human verify)

(awaiting user UAT)

## /settings/protect-hub/all-urls + Hub-Tab status panel (Task 4 — human verify)

(awaiting user UAT)

## Final evidence file commit (Task 5)

(pending)
