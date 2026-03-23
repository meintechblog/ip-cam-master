# Roadmap: IP-Cam-Master

## Overview

IP-Cam-Master delivers one-click camera onboarding for non-ONVIF cameras into UniFi Protect. The roadmap builds from Proxmox infrastructure outward: first establish the foundation and container management, then build the Mobotix camera pipeline (simpler, no nginx), extend to Loxone Intercom with network discovery, layer on the dashboard and UniFi Protect integration, and finally package everything for one-line installation. Each phase delivers a complete, verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Proxmox Integration** - App skeleton with settings UI, credential storage, and LXC container lifecycle management
- [x] **Phase 2: Mobotix Camera Pipeline** - End-to-end Mobotix onboarding: go2rtc config generation, container provisioning, MJPEG-to-H.264 transcoding, stream verification
- [x] **Phase 3: Loxone Pipeline and Network Discovery** - Loxone Intercom pipeline with nginx auth-proxy, plus network camera discovery
- [ ] **Phase 4: Dashboard and UniFi Protect** - Camera status dashboard with live preview and UniFi Protect adoption workflow
- [x] **Phase 5: Installer and Distribution** - One-line install script, systemd service, update mechanism (completed 2026-03-23)

## Phase Details

### Phase 1: Foundation and Proxmox Integration
**Goal**: User can configure infrastructure connections and manage LXC containers on Proxmox through the web UI
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, LXC-01, LXC-02, LXC-05, LXC-06, LXC-07
**Success Criteria** (what must be TRUE):
  1. User can enter Proxmox host connection details in the settings UI and see validation feedback (success or error)
  2. User can enter UniFi Dream Machine connection details in the settings UI
  3. User can configure camera credentials that are stored in local SQLite, never in git-tracked files
  4. User can create an LXC container on Proxmox with VAAPI device passthrough from the web UI
  5. User can start, stop, restart, and delete LXC containers from the web UI
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md -- Scaffold SvelteKit project, database, crypto, settings backend + API routes
- [x] 01-02-PLAN.md -- LXC container management: Proxmox service + container REST API
- [x] 01-03-PLAN.md -- Web UI: layout, settings page, container card grid, visual checkpoint

### Phase 2: Mobotix Camera Pipeline
**Goal**: User can onboard a Mobotix camera end-to-end, from credential entry through verified H.264 RTSP stream output
**Depends on**: Phase 1
**Requirements**: LXC-03, G2R-01, G2R-04, G2R-05, G2R-06, ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-06
**Success Criteria** (what must be TRUE):
  1. User can start an onboarding flow for a Mobotix camera: enter credentials, test connection, create container, deploy config, verify stream
  2. Each onboarding step shows clear success or error with retry option
  3. After successful onboarding, an RTSP URL is provided that outputs H.264 video transcoded from Mobotix MJPEG via VAAPI
  4. User can customize transcode parameters (resolution, fps, bitrate) per camera
**Plans:** 3/3 plans complete

Plans:
- [x] 02-01-PLAN.md -- Backend services: SSH, go2rtc config generation, onboarding orchestration, DB schema + API routes
- [x] 02-02-PLAN.md -- 5-step onboarding wizard UI with progress indicator, step components, WebRTC preview
- [x] 02-03-PLAN.md -- Visual checkpoint: verify wizard UI and flow

### Phase 3: Loxone Pipeline and Network Discovery
**Goal**: User can onboard Loxone Intercoms via nginx auth-proxy pipeline and discover cameras automatically on the network
**Depends on**: Phase 2
**Requirements**: LXC-04, G2R-02, G2R-03, ONBD-07, DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06
**Success Criteria** (what must be TRUE):
  1. User can onboard a Loxone Intercom end-to-end: nginx auth-proxy strips authentication, go2rtc transcodes, verified RTSP stream outputs
  2. User can trigger network scan that discovers Mobotix cameras and Loxone Intercoms automatically
  3. Discovery results show camera type, IP, and ONVIF capability, with clear differentiation between "needs workflow" and "native adoption possible"
  4. User can manually add a camera by IP if auto-discovery misses it
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Dashboard and UniFi Protect
**Goal**: User can monitor all managed cameras from a status dashboard and complete UniFi Protect adoption
**Depends on**: Phase 3
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, ONBD-05
**Success Criteria** (what must be TRUE):
  1. Dashboard shows all managed cameras in a grid/list with name, IP, type, container status, and stream status
  2. Camera statuses update automatically without manual refresh
  3. User can view live stream preview for any managed camera via go2rtc WebRTC/MSE player
  4. ONVIF-capable cameras appear as "nativ nutzbar" without workflow actions
  5. User can see UniFi Protect adoption status per camera and follow guided adoption instructions
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Installer and Distribution
**Goal**: Anyone can install and update IP-Cam-Master with a single command on a fresh Proxmox VM, with basic access control (Zugangsschutz)
**Depends on**: Phase 4
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05
**Success Criteria** (what must be TRUE):
  1. Running `curl | bash` on a fresh Debian/Ubuntu Proxmox VM installs the app with all dependencies and starts it as a systemd service
  2. Running the same command on an existing install updates to the latest version and restarts the service
  3. App automatically restarts on failure via systemd
**Plans:** 1/1 plans complete

Plans:
- [x] 05-01-PLAN.md -- Install script, systemd service, and authentication system (Zugangsschutz)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Proxmox Integration | 3/3 | Complete | - |
| 2. Mobotix Camera Pipeline | 3/3 | Complete | 2026-03-22 |
| 3. Loxone Pipeline and Network Discovery | 3/3 | Complete | 2026-03-23 |
| 4. Dashboard and UniFi Protect | 0/2 | Not started | - |
| 5. Installer and Distribution | 1/1 | Complete   | 2026-03-23 |
