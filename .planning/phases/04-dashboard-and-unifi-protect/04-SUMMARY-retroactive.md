---
plan: retroactive
phase: 04-dashboard-and-unifi-protect
status: complete
started: 2026-03-22
completed: 2026-03-23
---

# Phase 4: Dashboard and UniFi Protect — Retroactive Summary

## What Was Built

### Camera Dashboard
- Full-width camera cards with live snapshot (10s refresh, flicker-free preload)
- Pipeline visualization: Kamera ► go2rtc ► ONVIF ► UniFi Protect with status badges
- LXC panel: CPU/RAM bars, IP, MAC, hostname, start/stop/restart/delete buttons
- Camera probe: model (MOBOTIX S15D-Sec), firmware (MX-V4.4.2.73), live FPS, codec
- go2rtc details: transcode info, VAAPI, bitrate, connected clients
- Container actions: start, stop, restart, delete with confirmation
- Editable camera names (pencil icon, updates DB + LXC hostname)
- Cameras sorted alphabetically
- Greyed out when container stopped

### UniFi Protect Integration
- ONVIF server per container: correct naming (Manufacturer, Model, ONVIF name)
- UniFi Protect connection detected via GStreamer user agent in go2rtc consumers
- Status shown: "verbunden (N Streams)" or "wartend"
- RTSP URL with copy button
- External links: camera web UI (with credentials), go2rtc web UI
- Successful adoption tested with real cameras

### Native ONVIF Dashboard
- Separate card design for native ONVIF cameras (no LXC/pipeline)
- Camera info: model, firmware, codec (H.264 ONVIF), FPS
- Snapshot support

### Dynamic Settings
- Proxmox: storage/bridge dropdowns from API with free space info
- Auto-detect VMID range from existing containers
- Smooth first-time setup flow
