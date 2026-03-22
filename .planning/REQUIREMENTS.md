# Requirements: IP-Cam-Master

**Defined:** 2026-03-22
**Core Value:** One-click camera onboarding -- discover a camera, and the app handles everything to get its stream into UniFi Protect.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure Setup

- [x] **INFRA-01**: User can configure Proxmox host connection (IP, API token, storage target, network bridge)
- [x] **INFRA-02**: App validates Proxmox connection on save and shows success/error
- [x] **INFRA-03**: User can configure UniFi Dream Machine connection (IP, SSH credentials)
- [x] **INFRA-04**: User can configure credential store for camera access (local-only, never in repo)
- [x] **INFRA-05**: App stores all secrets in local SQLite database outside of git-tracked files

### Network Discovery

- [ ] **DISC-01**: App scans local network for Mobotix cameras (ARP + port 554 probing)
- [ ] **DISC-02**: App discovers Loxone Intercoms (new model) via mDNS/port scanning
- [ ] **DISC-03**: App identifies ONVIF-capable cameras via WS-Discovery
- [ ] **DISC-04**: App differentiates cameras: "needs workflow" (no ONVIF) vs "native adoption possible" (ONVIF)
- [ ] **DISC-05**: User can manually add a camera by IP if auto-discovery misses it
- [ ] **DISC-06**: Discovery results show camera type, IP, and ONVIF capability

### LXC Container Management

- [x] **LXC-01**: App creates a Proxmox LXC container for a camera via Proxmox API
- [x] **LXC-02**: App configures VAAPI device passthrough (/dev/dri) in LXC container
- [ ] **LXC-03**: App installs and configures go2rtc inside the LXC container
- [ ] **LXC-04**: App installs and configures nginx inside LXC container (for Loxone Intercom cameras)
- [x] **LXC-05**: User can start, stop, and restart a camera's LXC container from the dashboard
- [x] **LXC-06**: User can delete a camera's LXC container with confirmation dialog
- [x] **LXC-07**: Container creation is idempotent -- running again repairs, does not duplicate

### go2rtc Configuration

- [ ] **G2R-01**: App generates correct go2rtc YAML config for Mobotix cameras (MJPEG->H.264, VAAPI)
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
- [ ] **ONBD-02**: Onboarding flow: select camera -> enter/confirm credentials -> test connection -> create container -> deploy config -> verify stream
- [ ] **ONBD-03**: Each onboarding step shows clear success/error with retry option
- [ ] **ONBD-04**: After successful stream verification, app provides RTSP URL for UniFi Protect adoption
- [ ] **ONBD-05**: App triggers or guides UniFi Protect adoption (semi-automatic with clear instructions)
- [ ] **ONBD-06**: Mobotix-specific pipeline works end-to-end (MJPEG source -> H.264 RTSP output)
- [ ] **ONBD-07**: Loxone Intercom-specific pipeline works end-to-end (HTTP+auth -> nginx -> go2rtc -> RTSP)

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
| Built-in NVR/recording | UniFi Protect handles recording -- duplicating NVR adds massive complexity |
| AI/object detection | Separate domain (Frigate exists), would 10x complexity |
| Multi-site/multi-Proxmox | V1 is single-site homelab tool |
| Cloud/remote access | Security risk -- local-only is a feature. Use Tailscale/WireGuard if needed |
| Mobile native app | Responsive web UI + PWA sufficient |
| Generic camera brand support | ONVIF cameras can be adopted natively in Protect 5.0+ -- tool exists for non-ONVIF cameras |
| Old Loxone Intercom model | Explicitly excluded per user requirement |
| Real-time log streaming UI | Low value after initial setup. Show last N lines on demand instead |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| DISC-01 | Phase 3 | Pending |
| DISC-02 | Phase 3 | Pending |
| DISC-03 | Phase 3 | Pending |
| DISC-04 | Phase 3 | Pending |
| DISC-05 | Phase 3 | Pending |
| DISC-06 | Phase 3 | Pending |
| LXC-01 | Phase 1 | Complete |
| LXC-02 | Phase 1 | Complete |
| LXC-03 | Phase 2 | Pending |
| LXC-04 | Phase 3 | Pending |
| LXC-05 | Phase 1 | Complete |
| LXC-06 | Phase 1 | Complete |
| LXC-07 | Phase 1 | Complete |
| G2R-01 | Phase 2 | Pending |
| G2R-02 | Phase 3 | Pending |
| G2R-03 | Phase 3 | Pending |
| G2R-04 | Phase 2 | Pending |
| G2R-05 | Phase 2 | Pending |
| G2R-06 | Phase 2 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DASH-05 | Phase 4 | Pending |
| DASH-06 | Phase 4 | Pending |
| ONBD-01 | Phase 2 | Pending |
| ONBD-02 | Phase 2 | Pending |
| ONBD-03 | Phase 2 | Pending |
| ONBD-04 | Phase 2 | Pending |
| ONBD-05 | Phase 4 | Pending |
| ONBD-06 | Phase 2 | Pending |
| ONBD-07 | Phase 3 | Pending |
| INST-01 | Phase 5 | Pending |
| INST-02 | Phase 5 | Pending |
| INST-03 | Phase 5 | Pending |
| INST-04 | Phase 5 | Pending |
| INST-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 42
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
