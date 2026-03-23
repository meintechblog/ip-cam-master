---
plan: retroactive
phase: 03-loxone-pipeline-and-network-discovery
status: complete
started: 2026-03-22
completed: 2026-03-23
---

# Phase 3: Loxone Pipeline and Network Discovery — Retroactive Summary

## What Was Built (during Phase 2 execution, ahead of schedule)

### Loxone Intercom Pipeline
- nginx auth-proxy: strips Basic Auth, proxies MJPEG stream to localhost:8081
- go2rtc reads from nginx (not directly from camera — single stream limit)
- ONVIF server with Loxone-specific naming (Manufacturer: name, Model: Loxone)
- 7-step wizard for Loxone (extra nginx step vs 6 for Mobotix)
- Snapshot via ffmpeg frame grab from MJPEG stream
- Connection test handles MJPEG timeout (curl exit 28)

### Network Discovery
- Auto-discovery: scans subnet for Mobotix (HTTP redirect + "mobotix") and Loxone Intercoms (@VERSION 1.0)
- Filters out non-camera Loxone devices (Audioserver 2.x, Miniserver)
- ONVIF detection: probes /onvif/device_service (405 = native ONVIF)
- Camera names read from page titles using saved credentials
- Discovery results sorted by IP, already-onboarded cameras filtered

### Credential Presets
- Settings > Credentials: CRUD for standard login presets
- Auto-matching: credentials tried against camera during onboarding
- Pre-fills wizard: IP, name, username, password all auto-populated
- Supports both Mobotix (/record/current.jpg) and Loxone (/mjpg/video.mjpg)

### Native ONVIF Support
- Cameras with built-in ONVIF detected and registered without containers
- Simple registration flow (no wizard needed)
- Dashboard card with camera info but no LXC/pipeline sections

## Key Commits
- feat(02): ONVIF server in onboarding
- feat(02): auto-discovery of Mobotix/Loxone cameras
- feat: credential presets in Settings
- feat: native ONVIF camera support
- feat: Loxone Intercom onboarding with nginx auth-proxy
- feat: nginx as separate onboarding step for Loxone
