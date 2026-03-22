# Requirements: IP-Cam-Master

**Defined:** 2026-03-22
**Core Value:** One-click camera onboarding — discover a camera, and the app handles everything to get its stream into UniFi Protect.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure Setup

- [ ] **INFRA-01**: User can configure Proxmox host connection (IP, API token, storage target, network bridge)
- [ ] **INFRA-02**: App validates Proxmox connection on save and shows success/error
- [ ] **INFRA-03**: User can configure UniFi Dream Machine connection (IP, SSH credentials)
- [ ] **INFRA-04**: User can configure credential store for camera access (local-only, never in repo)
- [ ] **INFRA-05**: App stores all secrets in local SQLite database outside of git-tracked files

### Network Discovery

- [ ] **DISC-01**: App scans local network for Mobotix cameras (ARP + port 554 probing)
- [ ] **DISC-02**: App discovers Loxone Intercoms (new model) via mDNS/port scanning
- [ ] **DISC-03**: App identifies ONVIF-capable cameras via WS-Discovery
- [ ] **DISC-04**: App differentiates cameras: "needs workflow" (no ONVIF) vs "native adoption possible" (ONVIF)
- [ ] **DISC-05**: User can manually add a camera by IP if auto-discovery misses it
- [ ] **DISC-06**: Discovery results show camera type, IP, and ONVIF capability

### LXC Container Management

- [ ] **LXC-01**: App creates a Proxmox LXC container for a camera via Proxmox API
- [ ] **LXC-02**: App configures VAAPI device passthrough (/dev/dri) in LXC container
- [ ] **LXC-03**: App installs and configures go2rtc inside the LXC container
- [ ] **LXC-04**: App installs and configures nginx inside LXC container (for Loxone Intercom cameras)
- [ ] **LXC-05**: User can start, stop, and restart a camera's LXC container from the dashboard
- [ ] **LXC-06**: User can delete a camera's LXC container with confirmation dialog
- [ ] **LXC-07**: Container creation is idempotent — running again repairs, does not duplicate

### go2rtc Configuration

- [ ] **G2R-01**: App generates correct go2rtc YAML config for Mobotix cameras (MJPEG→H.264, VAAPI)
- [ ] **G2R-02**: App generates correct go2rtc YAML config for Loxone Intercom (via nginx proxy stream)
- [ ] **G2R-03**: App generates nginx config for Loxone Intercom auth-proxy (Basic Auth header injection, buffering disabled)
- [ ] **G2R-04**: App deploys generated configs to the LXC container and restarts services
- [ ] **G2R-05**: User can customize transcode parameters (resolution, fps, bitrate) per camera
- [ ] **G2R-06**: App validates stream is accessible after config deployment

### Camera Dashboard

- [ ] **DASH-01**: Dashboard shows all managed cameras in a grid/list view
- [ ] **DASH-02**: Each camera card shows: name, IP, type (Mobotix/Loxone/ONVIF), container status, stream status
- [ ] **DASH-03**: Camera status updates automatically (polling go2rtc API + Proxmox API)
- [ ] **DASH-04**: User can view live stream preview (via go2rtc WebRTC/MSE player) for any managed camera
- [ ] **DASH-05**: ONVIF-capable cameras are displayed as "nativ nutzbar" without workflow actions
- [ ] **DASH-06**: Dashboard shows UniFi Protect adoption status per camera

### Camera Onboarding Pipeline

- [ ] **ONBD-01**: User can start onboarding flow for a discovered non-ONVIF camera
- [ ] **ONBD-02**: Onboarding flow: select camera → enter/confirm credentials → test connection → create container → deploy config → verify stream
- [ ] **ONBD-03**: Each onboarding step shows clear success/error with retry option
- [ ] **ONBD-04**: After successful stream verification, app provides RTSP URL for UniFi Protect adoption
- [ ] **ONBD-05**: App triggers or guides UniFi Protect adoption (semi-automatic with clear instructions)
- [ ] **ONBD-06**: Mobotix-specific pipeline works end-to-end (MJPEG source → H.264 RTSP output)
- [ ] **ONBD-07**: Loxone Intercom-specific pipeline works end-to-end (HTTP+auth → nginx → go2rtc → RTSP)

### Installation & Distribution

- [ ] **INST-01**: One-line install command (`curl | bash`) sets up app on a fresh Proxmox VM
- [ ] **INST-02**: Installer handles all dependencies (Node.js, systemd service, SQLite)
- [ ] **INST-03**: Same command performs updates (detects existing install, pulls latest, restarts service)
- [ ] **INST-04**: App runs as systemd service with automatic restart on failure
- [ ] **INST-05**: Install script works on Debian/Ubuntu-based Proxmox VMs

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Monitoring & Diagnostics

- **MON-01**: App reads UniFi Protect logs via SSH to Dream Machine
- **MON-02**: App detects and displays "camera not available" events with timestamps
- **MON-03**: App shows disconnect pattern analysis (frequency, time-of-day, duration)
- **MON-04**: User can view per-camera reliability score over time

### Advanced Features

- **ADV-01**: Container resource monitoring (CPU, memory per LXC)
- **ADV-02**: Bulk operations (restart all, update all configs)
- **ADV-03**: Backup/restore of all camera configurations
- **ADV-04**: Plugin architecture for additional camera types
- **ADV-05**: Guided setup wizard with multi-step form and progress indicator

## Out of Scope

| Feature | Reason |
|---------|--------|
| Built-in NVR/recording | UniFi Protect handles recording — duplicating NVR adds massive complexity |
| AI/object detection | Separate domain (Frigate exists), would 10x complexity |
| Multi-site/multi-Proxmox | V1 is single-site homelab tool |
| Cloud/remote access | Security risk — local-only is a feature. Use Tailscale/WireGuard if needed |
| Mobile native app | Responsive web UI + PWA sufficient |
| Generic camera brand support | ONVIF cameras can be adopted natively in Protect 5.0+ — tool exists for non-ONVIF cameras |
| Old Loxone Intercom model | Explicitly excluded per user requirement |
| Real-time log streaming UI | Low value after initial setup. Show last N lines on demand instead |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | TBD | Pending |
| INFRA-02 | TBD | Pending |
| INFRA-03 | TBD | Pending |
| INFRA-04 | TBD | Pending |
| INFRA-05 | TBD | Pending |
| DISC-01 | TBD | Pending |
| DISC-02 | TBD | Pending |
| DISC-03 | TBD | Pending |
| DISC-04 | TBD | Pending |
| DISC-05 | TBD | Pending |
| DISC-06 | TBD | Pending |
| LXC-01 | TBD | Pending |
| LXC-02 | TBD | Pending |
| LXC-03 | TBD | Pending |
| LXC-04 | TBD | Pending |
| LXC-05 | TBD | Pending |
| LXC-06 | TBD | Pending |
| LXC-07 | TBD | Pending |
| G2R-01 | TBD | Pending |
| G2R-02 | TBD | Pending |
| G2R-03 | TBD | Pending |
| G2R-04 | TBD | Pending |
| G2R-05 | TBD | Pending |
| G2R-06 | TBD | Pending |
| DASH-01 | TBD | Pending |
| DASH-02 | TBD | Pending |
| DASH-03 | TBD | Pending |
| DASH-04 | TBD | Pending |
| DASH-05 | TBD | Pending |
| DASH-06 | TBD | Pending |
| ONBD-01 | TBD | Pending |
| ONBD-02 | TBD | Pending |
| ONBD-03 | TBD | Pending |
| ONBD-04 | TBD | Pending |
| ONBD-05 | TBD | Pending |
| ONBD-06 | TBD | Pending |
| ONBD-07 | TBD | Pending |
| INST-01 | TBD | Pending |
| INST-02 | TBD | Pending |
| INST-03 | TBD | Pending |
| INST-04 | TBD | Pending |
| INST-05 | TBD | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 0
- Unmapped: 37 ⚠️

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
