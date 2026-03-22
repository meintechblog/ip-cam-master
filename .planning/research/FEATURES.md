# Feature Research

**Domain:** IP camera management and Proxmox orchestration for UniFi Protect integration
**Researched:** 2026-03-22
**Confidence:** HIGH (domain well-understood, comparable tools analyzed, project scope is narrow and well-defined)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Camera discovery via network scan** | Every NVR tool (Frigate, Shinobi, MotionEye) auto-discovers cameras. Manual IP entry alone feels archaic. | MEDIUM | Use mDNS/Bonjour, ONVIF WS-Discovery, and ARP+port scanning. Mobotix cameras respond on RTSP :554. Loxone Intercoms discoverable via mDNS. Must differentiate ONVIF-capable (display-only) from non-ONVIF (workflow-needed). |
| **Camera status dashboard** | Shinobi, Frigate, MotionEye all show live grid of camera thumbnails with online/offline status. Users need at-a-glance health. | MEDIUM | Poll go2rtc API (port 1984) for stream health. Show per-camera: name, IP, type, container status, stream status, UniFi Protect adoption status. |
| **One-click camera onboarding** | This is the project's core value proposition. Proxmox Helper Scripts proved that one-click LXC provisioning is expected for self-hosted tools. Manual SSH + config editing is the pain point being solved. | HIGH | Full pipeline: create LXC, install go2rtc (+ nginx for Loxone), configure streams, start services. Must be idempotent -- running again should repair, not duplicate. |
| **LXC container lifecycle management** | Proxmox Helper Scripts set the standard: create, start, stop, delete containers through a UI. Users expect to manage what the tool created. | MEDIUM | Proxmox API (proxmoxer) for CRUD. Show container state (running/stopped/error). Allow restart and delete with confirmation. One container per camera is the architecture. |
| **Credential management (secure)** | Camera credentials must be stored but never leaked. Public GitHub repo makes this critical. Every self-hosted tool handles credentials through local config or env vars. | LOW | Store in local config file outside repo (e.g., /etc/ip-cam-master/credentials.yaml or SQLite). Never commit. Mask in UI. Validate on entry by testing camera connection. |
| **go2rtc configuration generation** | go2rtc is the transcoding engine. Users expect the tool to generate correct YAML config, not require hand-editing. Frigate auto-generates go2rtc config from its own camera config. | MEDIUM | Template-based: Mobotix gets ffmpeg transcode config (MJPEG->H.264 with VAAPI), Loxone gets nginx proxy + go2rtc config. Must handle VAAPI device passthrough (/dev/dri) in LXC config. |
| **One-line install/update script** | Proxmox Helper Scripts popularized `bash -c "$(curl -fsSL ...)"` pattern. Self-hosters expect this. No manual dependency hunting. | MEDIUM | Script must: detect prerequisites (Proxmox API access, network), install app (VM or container), handle updates (git pull + service restart). Version-aware: skip if current. |
| **Proxmox host configuration** | Users need to tell the app which Proxmox host to manage. Connection details, API token, storage target. | LOW | Settings page: hostname/IP, API token (not root password), target storage, VMID range, network bridge. Test connection on save. |

### Differentiators (Competitive Advantage)

Features that set ip-cam-master apart from generic NVR tools and manual scripting.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **End-to-end UniFi Protect adoption** | No existing tool does discovery-to-Protect-adoption in one flow. unifi-cam-proxy requires manual Docker setup. Frigate/Shinobi are NVRs, not Protect integration tools. This is the unique value. | HIGH | After container+go2rtc are running, trigger Protect adoption via ONVIF discovery or RTSP URL. Requires Protect 5.0+ for third-party camera support. Adoption token valid 60 min -- must be automated. |
| **Camera-type-specific workflows** | Mobotix (MJPEG->H.264 transcode) and Loxone Intercom (nginx auth-proxy + transcode) need different pipelines. Encoding this knowledge into the tool eliminates hours of blog-reading. | MEDIUM | Plugin/template architecture: each camera type defines its own pipeline (services needed, config templates, stream URLs). Extensible for future camera types. |
| **VAAPI hardware acceleration auto-config** | Transcoding MJPEG to H.264 is CPU-intensive. Auto-detecting Intel GPU and configuring /dev/dri passthrough to LXC is something no tool does automatically. | MEDIUM | Detect /dev/dri on Proxmox host. Configure LXC with device passthrough. Set go2rtc ffmpeg flags for VAAPI. Validate with test transcode. Fallback to software encoding if VAAPI unavailable. |
| **Container-per-camera isolation** | Unlike monolithic NVRs (Frigate runs all cameras in one container), one LXC per camera means: independent restart, independent resource limits, one camera failure does not cascade. | LOW | Architecture decision already made. UI should make isolation visible: per-camera container stats (CPU, memory), independent start/stop/restart. |
| **UniFi Protect health monitoring** | SSH to Dream Machine to check adopted camera status, parse Protect logs for "camera not available" errors. No other tool does this. | HIGH | SSH to UDM, parse Protect logs, correlate with managed cameras. Surface diagnostics: "Camera X disconnected 3 times in 24h, last error: timeout". Future: pattern detection. |
| **Stream validation/preview** | Before completing setup, show user the transcoded stream to confirm it works. go2rtc exposes WebRTC/MSE preview on port 1984. | LOW | Embed go2rtc web player (iframe or direct WebRTC) in the setup wizard. "Can you see your camera? [Yes/No]" confirmation step. Catches config errors before Protect adoption. |
| **Guided setup wizard** | Step-by-step: select discovered camera -> enter credentials -> test connection -> choose transcode settings -> create container -> verify stream -> adopt in Protect. | MEDIUM | Multi-step form with validation at each stage. Back/retry on failure. Progress indicator. Much friendlier than CLI scripts. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for this specific project.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Built-in NVR/recording** | "Why not record too?" | UniFi Protect already handles recording. Duplicating NVR functionality adds massive complexity (storage management, playback UI, retention policies) and conflicts with the core value of being an orchestration tool, not a replacement. Frigate and Shinobi already own this space. | Display "Recording handled by UniFi Protect" with link to Protect dashboard. Show Protect recording status per camera. |
| **AI/object detection** | Frigate has it, users may expect it | Completely out of scope. This is a camera onboarding and orchestration tool, not a detection/analytics platform. Adding TensorFlow/Coral support would 10x complexity. | Recommend Frigate for users who want AI detection alongside Protect. |
| **Multi-site / multi-Proxmox management** | Enterprise users want it | Dramatically increases complexity: multi-host API management, cross-network discovery, site selection UI. V1 is for single-site homelabs. | Design data model to not preclude multi-site later (site_id field), but do not build the UI or logic. |
| **Cloud/remote access** | "Access from anywhere" | Security nightmare for a tool that manages camera credentials and has Proxmox API access. Local-only is a feature, not a limitation. | Document how to use Tailscale/WireGuard for remote access if users want it. |
| **Mobile native app** | "I want an app" | Web-first with responsive design covers mobile viewing. Native app is a separate project with separate maintenance burden. | Responsive web UI that works on mobile browsers. PWA manifest for "Add to Home Screen". |
| **Generic camera brand support** | "Support Hikvision, Dahua, Reolink..." | These cameras already support ONVIF and can be adopted directly in UniFi Protect 5.0+ without any proxy. The tool exists specifically for cameras that CANNOT be adopted natively (Mobotix classic, Loxone Intercom). | Show ONVIF-capable cameras as "direct adoption possible" in discovery, with link to Protect's native adoption flow. |
| **Real-time log streaming in UI** | "Show me container logs live" | WebSocket log streaming adds frontend complexity and is rarely useful after initial setup. Most debugging happens via SSH. | Show last N log lines on demand (pull, not push). Link to Proxmox console for full access. |

## Feature Dependencies

```
[Network Scanner / Camera Discovery]
    |
    +--> [Camera Onboarding Wizard]
    |        |
    |        +--> requires --> [Proxmox Host Config] (need API access to create containers)
    |        |
    |        +--> requires --> [Credential Management] (need camera creds for stream config)
    |        |
    |        +--> requires --> [go2rtc Config Generation] (need stream config for container)
    |        |
    |        +--> requires --> [LXC Container Lifecycle] (need to create/start container)
    |        |
    |        +--> optional --> [Stream Validation/Preview] (confirm before adoption)
    |        |
    |        +--> optional --> [UniFi Protect Adoption] (final step)
    |
[Camera Status Dashboard]
    |
    +--> requires --> [LXC Container Lifecycle] (need container status)
    |
    +--> enhanced-by --> [UniFi Protect Health Monitoring] (richer status info)

[One-Line Install Script] -- independent, no dependencies on app features

[VAAPI Auto-Config] -- enhances --> [go2rtc Config Generation]

[Camera-Type Workflows] -- enhances --> [Camera Onboarding Wizard]
```

### Dependency Notes

- **Onboarding Wizard requires Proxmox Host Config:** Cannot create LXC containers without valid Proxmox API connection. This must be the first thing configured.
- **Onboarding Wizard requires Credential Management:** Camera streams need authentication. Credentials must be stored before go2rtc config can be generated.
- **Dashboard requires LXC Container Lifecycle:** Status display depends on ability to query container state from Proxmox API.
- **UniFi Protect Adoption depends on working stream:** Protect will only adopt a camera if the RTSP stream is accessible. Stream must be validated first.
- **VAAPI Auto-Config enhances go2rtc Config Generation:** VAAPI is optional -- software transcoding works as fallback. But VAAPI should be auto-detected during container creation.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to validate the core value of "one-click camera onboarding."

- [ ] **Proxmox host configuration** -- Foundation: without this, nothing works
- [ ] **Network camera discovery** -- Core UX entry point, discovers Mobotix and Loxone devices
- [ ] **Credential management** -- Secure storage for camera and Proxmox credentials
- [ ] **LXC container creation and management** -- Create, start, stop, delete containers via Proxmox API
- [ ] **go2rtc config generation** -- Mobotix (MJPEG->H.264) and Loxone (nginx+go2rtc) templates
- [ ] **Camera status dashboard** -- At-a-glance view of all managed cameras and container health
- [ ] **One-line install script** -- Required for distribution as open-source tool

### Add After Validation (v1.x)

Features to add once the core onboarding pipeline works end-to-end.

- [ ] **Stream validation/preview** -- Embed go2rtc WebRTC preview in onboarding flow
- [ ] **UniFi Protect adoption trigger** -- Automate the final adoption step (currently can be done manually in Protect UI)
- [ ] **VAAPI auto-detection and configuration** -- Auto-detect Intel GPU, configure passthrough
- [ ] **Guided setup wizard** -- Multi-step onboarding with back/retry (v1 can be a simpler form)
- [ ] **Container resource monitoring** -- CPU/memory per container, visible in dashboard

### Future Consideration (v2+)

Features to defer until the core product is proven.

- [ ] **UniFi Protect health monitoring (SSH diagnostics)** -- Parse Protect logs for camera errors, requires SSH to UDM
- [ ] **Disconnect pattern detection** -- Analyze camera reliability over time
- [ ] **Additional camera type plugins** -- Extensible architecture for new camera types beyond Mobotix and Loxone
- [ ] **Bulk operations** -- Restart all containers, update all go2rtc configs
- [ ] **Backup/restore configuration** -- Export/import all camera configs and credentials

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Proxmox host configuration | HIGH | LOW | P1 |
| Network camera discovery | HIGH | MEDIUM | P1 |
| Credential management | HIGH | LOW | P1 |
| LXC container creation/mgmt | HIGH | MEDIUM | P1 |
| go2rtc config generation | HIGH | MEDIUM | P1 |
| Camera status dashboard | HIGH | MEDIUM | P1 |
| One-line install script | HIGH | MEDIUM | P1 |
| Stream validation/preview | MEDIUM | LOW | P2 |
| UniFi Protect adoption | HIGH | HIGH | P2 |
| VAAPI auto-detection | MEDIUM | MEDIUM | P2 |
| Guided setup wizard | MEDIUM | MEDIUM | P2 |
| Container resource monitoring | LOW | LOW | P2 |
| Protect health monitoring | MEDIUM | HIGH | P3 |
| Disconnect pattern detection | LOW | HIGH | P3 |
| Camera type plugins | MEDIUM | MEDIUM | P3 |
| Bulk operations | LOW | LOW | P3 |
| Backup/restore | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch -- without these, the tool cannot demonstrate its core value
- P2: Should have, add when core pipeline works end-to-end
- P3: Nice to have, future consideration after user validation

## Competitor Feature Analysis

| Feature | Frigate | Shinobi | MotionEye | Proxmox Helper Scripts | unifi-cam-proxy | ip-cam-master (ours) |
|---------|---------|---------|-----------|------------------------|-----------------|---------------------|
| Camera discovery | ONVIF via go2rtc | ONVIF built-in | Limited ONVIF | N/A | N/A | ONVIF + mDNS + port scan, type-aware |
| Stream transcoding | go2rtc (embedded) | ffmpeg | motion (software) | N/A | ffmpeg (manual) | go2rtc per-container with VAAPI |
| Container orchestration | Single Docker | Single Docker | Single install | LXC creation scripts | Single Docker | One LXC per camera, full lifecycle |
| UniFi Protect integration | None (separate NVR) | None | None | None | Proxy adoption | End-to-end adoption pipeline |
| Web dashboard | Recording/detection UI | Multi-camera grid | Simple grid | N/A (CLI) | N/A (CLI) | Orchestration-focused status UI |
| Non-ONVIF camera support | Manual config | Manual config | Manual config | N/A | RTSP proxy | Camera-type-specific workflows |
| Install experience | Docker compose | npm/Docker | pip/Docker | One-line bash | Docker compose | One-line bash + web UI |
| Hardware acceleration | Coral TPU, VAAPI | GPU support | None | N/A | None | VAAPI auto-config |
| Auth proxy for cameras | N/A | N/A | N/A | N/A | N/A | nginx auth-stripping for Loxone |

**Key insight:** No existing tool covers the discovery-to-Protect-adoption pipeline. Frigate, Shinobi, and MotionEye are NVRs that compete with Protect. unifi-cam-proxy handles adoption but requires manual Docker setup. Proxmox Helper Scripts handle LXC creation but not camera-specific configuration. ip-cam-master uniquely combines orchestration (Proxmox LXC) with camera-specific knowledge (Mobotix MJPEG, Loxone auth) and Protect integration.

## Sources

- [Frigate NVR documentation](https://docs.frigate.video/) -- Feature set, go2rtc integration, camera configuration
- [Shinobi CCTV features](https://shinobi.video/features) -- Multi-camera management, ONVIF support, multi-user
- [MotionEye GitHub](https://github.com/motioneye-project/motioneye) -- Simple NVR features, limitations
- [Proxmox VE Helper Scripts (community)](https://community-scripts.github.io/ProxmoxVE/) -- One-line install pattern, LXC management UX
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) -- Stream protocol support, codec negotiation, ffmpeg transcoding
- [UniFi Protect third-party cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) -- ONVIF adoption, feature limitations
- [unifi-cam-proxy](https://github.com/keshavdv/unifi-cam-proxy) -- Non-ONVIF adoption via proxy, Docker deployment
- [Florian Rhomberg blog: third-party camera integration](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) -- Protect 5.0+ adoption process
- [LoxWiki: Loxone Intercom + UniFi Protect via go2rtc](https://loxwiki.atlassian.net/wiki/spaces/LOXEN/pages/2517499917/) -- nginx auth-proxy pipeline
- [Mobotix RTSP streaming community](https://community.mobotix.com/t/rtsp-streaming-with-mobotix-cameras/4912) -- MJPEG limitations, classic vs MOVE series
- [go2rtc issue #1825: Loxone Intercom + Protect](https://github.com/AlexxIT/go2rtc/issues/1825) -- Real-world integration challenges
- [Proxmox VE API documentation](https://pve.proxmox.com/wiki/Proxmox_VE_API) -- LXC container CRUD, proxmoxer library

---
*Feature research for: IP camera management and Proxmox orchestration for UniFi Protect integration*
*Researched: 2026-03-22*
