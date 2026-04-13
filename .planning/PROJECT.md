# IP-Cam-Master

## What This Is

A modular web application that orchestrates IP camera integration into UniFi Protect. It manages the full lifecycle: discovering cameras in the network, provisioning LXC containers on Proxmox with the necessary transcoding services (go2rtc, nginx), and adopting the resulting streams into UniFi Protect — all through a single web interface. Built for self-hosters who want to integrate non-ONVIF cameras (Mobotix, Loxone Intercom) into UniFi Protect without manual setup.

## Core Value

One-click camera onboarding: discover a camera in the network, and the app handles everything needed to get its stream into UniFi Protect — container creation, service configuration, stream adoption.

## Requirements

### Validated

- [x] Proxmox host configuration in the app (connection details for LXC management) — *Phase 1*
- [x] Camera credentials managed securely (never in repo, local config only) — *Phase 1*
- [x] Web dashboard showing all managed cameras with status (online/offline/error) — *Phase 1 (foundation)*

### Active

- [ ] Network scanner discovers Mobotix cameras and Loxone Intercoms (new model) in the local network
- [ ] Network scanner identifies cameras that already support ONVIF (no workflow needed, display-only)
- [ ] End-to-end setup pipeline: create LXC container on Proxmox, configure go2rtc with ffmpeg transcoding, adopt stream in UniFi Protect
- [ ] Loxone Intercom (new model) integration via nginx auth-proxy + go2rtc transcoding
- [ ] Mobotix camera integration via go2rtc direct RTSP transcoding (MJPEG → H.264)
- [ ] Web dashboard showing all managed cameras with status (online/offline/error)
- [ ] Proxmox host configuration in the app (connection details for LXC management)
- [ ] UniFi Protect connection for monitoring adopted camera status
- [ ] Camera credentials managed securely (never in repo, local config only)
- [ ] One-line install script from GitHub repo (install + update)
- [ ] VAAPI hardware acceleration support for Intel-based transcoding hosts

### Out of Scope

- Old Loxone Intercom model — explicitly excluded, only new model supported
- Mobile app — web-first, responsive design sufficient
- Cloud/remote access — local network tool only
- Multi-site management — single Proxmox host / single UniFi site for v1
- Camera recording/NVR — UniFi Protect handles that

## Context

### Infrastructure

- **Proxmox Host (proxi3):** 192.168.3.16 — runs LXC containers and the app VM
- **App VM:** 192.168.3.233 / ip-cam-master.local — hosts the webapp
- **UniFi Dream Machine:** 192.168.3.1 — runs UniFi Protect, SSH access available
- **Architecture:** One LXC container per camera on Proxmox, each running go2rtc (and nginx for Loxone Intercom)

### Known Cameras in Network

- **192.168.3.21** — Mobotix, ONVIF-capable (native UniFi Protect, no workflow needed)
- **192.168.3.22** — Mobotix, no ONVIF (needs go2rtc pipeline, credentials: configured locally)
- **192.168.3.11** — Mobotix (credentials: configured locally)
- **192.168.3.13** — Loxone Intercom (new model, needs nginx auth-proxy + go2rtc)

### Technical Pipeline (from blog reference)

**Mobotix (no ONVIF):**
```
Mobotix MJPEG → go2rtc (ffmpeg transcode to H.264) → RTSP :8554 → UniFi Protect adoption
```
- Stream source: `rtsp://<user>:<pw>@<ip>:554/stream0/mobotix.mjpeg`
- go2rtc config: `ffmpeg:rtsp://...#video=h264#width=1280#height=720#raw=-r 20#raw=-maxrate 5000#raw=-bufsize 10000#raw=-g 20#hardware=vaapi`

**Loxone Intercom (new):**
```
Intercom MJPEG (auth required) → nginx (strip auth) → go2rtc (transcode) → RTSP :8554 → UniFi Protect
```
- nginx proxies `http://<intercom-ip>/mjpg/video.mjpg` with auth header injection
- go2rtc picks up unauthenticated stream from nginx

### Future Vision

- UniFi Protect log analysis (via SSH to Dream Machine) to diagnose "camera not available" errors
- Pattern detection in camera disconnects
- Installation routine improvements based on diagnostic data
- Stats/metrics for adopted cameras visible in the app

## Constraints

- **Security**: Camera credentials and host SSH keys must NEVER be committed to the public GitHub repo
- **Platform**: Runs on Proxmox VE as a VM, manages LXC containers on the same host
- **Network**: All components on the same local network (192.168.3.x)
- **Hardware Accel**: VAAPI on Intel — requires `/dev/dri` passthrough to LXC containers
- **Compatibility**: Must support Proxmox VE LXC container management API
- **Distribution**: Public GitHub repo (meintechblog/ip-cam-master), one-line install for anyone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One LXC container per camera | Isolation, independent restart/debug per camera | — Pending |
| go2rtc for transcoding | Lightweight, supports UniFi Protect adoption via port 1984 | — Pending |
| nginx for Loxone auth-proxy | Intercom requires auth stripping before go2rtc can consume stream | — Pending |
| Public GitHub repo | Community tool, one-line install, open source | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

## Current State

**v1.1 shipped** (2026-04-10) — Self-Maintenance & Polish. 4 phases, 5 plans, 43 commits, +4844 LOC, 78 unit tests, 0 new dependencies.

The app is now fully self-maintaining from the web UI:
- In-app self-update via GitHub (`git pull` + build + `systemd-run --transient` restart + automatic rollback) — verified with 4 real end-to-end update runs on the production VM, one of which was the feature updating itself with its own history-persistence fix
- SQLite backup download + upload-restore with integrity checks
- Systemd journal viewer with severity filter and live SSE tail as a third tab on `/logs`
- Host vitals dashboard (disk/RAM/service uptime) via `/proc/meminfo`, `df`, `systemctl show`
- Version display (tag + short SHA) with daily background check against GitHub and header badge when updates are available

**v1.0 shipped** (2026-03-23) — Camera orchestration foundation: discovery, Mobotix/Loxone onboarding, LXC provisioning, dashboard with UniFi Protect integration, event logging, one-line installer.

Running in production on 192.168.3.249 with 6+ cameras managed.

## Current Milestone: v1.2 Bambu Lab H2C Kamera-Integration

**Goal:** Bambu Lab H2C 3D-Drucker-Kamera im LAN als UniFi-Protect-kompatible Kamera einbinden — analog zum bestehenden Mobotix/Loxone-Pattern mit Auto-Discovery, LXC-Provisioning und go2rtc-Transcoding.

**Target features:**
- Netzwerk-Discovery erkennt Bambu-Drucker (mDNS `_bambulab._tcp` / Port-Scan) automatisch — gleicher Flow wie Mobotix/Loxone
- LAN-Mode-Zugriff via Access Code (vom Drucker-Display) + Serial Number — keine Cloud nötig
- RTSPS-Stream (`rtsps://bblp:<access_code>@<ip>:322/streaming/live/1`) über go2rtc transcodieren und in UniFi Protect adoptieren
- UI-Credential-Eingabe für Access Code + Serial beim Onboarding (encrypted im SQLite-Store)
- Cloud-Auth als Fallback, falls LAN Mode am Drucker nicht aktivierbar

## Next Milestone Goals

Candidates from v1.1's Future Requirements (for v1.3+):
- Real Drizzle migration system (replaces v1.1's schema-hash stopgap)
- Tag-based release channel (opt-in over rolling `main`)
- Remote backup targets (S3/WebDAV push of nightly backups)
- Alert notifications when the service goes down

---
*Last updated: 2026-04-13 — started v1.2 Bambu Lab H2C Kamera-Integration*
