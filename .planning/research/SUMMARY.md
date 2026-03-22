# Project Research Summary

**Project:** IP-Cam-Master
**Domain:** IP camera orchestration platform (Proxmox LXC + go2rtc + UniFi Protect)
**Researched:** 2026-03-22
**Confidence:** MEDIUM-HIGH

## Executive Summary

IP-Cam-Master is a self-hosted web application that automates the onboarding of non-ONVIF IP cameras (Mobotix, Loxone Intercom) into UniFi Protect via Proxmox LXC containers running go2rtc for MJPEG-to-H.264 transcoding. No existing tool covers this discovery-to-Protect-adoption pipeline. The recommended approach is a single-process SvelteKit application backed by SQLite, deployed as a systemd service on a Proxmox VM. The Node.js ecosystem uniquely provides mature libraries for all three integration points: Proxmox API (`proxmox-api`), UniFi Protect (`unifi-protect`), and SSH-based container management (`node-ssh`). This is a narrow-scope orchestration tool, not an NVR -- recording, AI detection, and multi-site support are explicitly out of scope.

The architecture follows a "one LXC container per camera" model with a pipeline orchestrator that coordinates multi-step provisioning: create container, install go2rtc, generate configs from templates, configure VAAPI GPU passthrough, start services, and verify the RTSP stream. Each camera type (Mobotix, Loxone) has a distinct workflow -- Loxone requires an additional nginx auth-proxy layer because its Intercom does not accept URL-based credentials. Config files are always generated from templates (never edited in place), and credentials are stored locally, never committed to the public repository.

The primary risks are: (1) VAAPI device passthrough failing silently in LXC containers, causing CPU-bound transcoding that cannot scale past 1-2 cameras; (2) credential leakage into the public GitHub repo; (3) go2rtc losing camera connections without automatic recovery; and (4) UniFi Protect's fragile third-party camera adoption breaking after any configuration change. All four are well-documented with concrete prevention strategies. The `proxmox-api` npm package has not been updated in 2 years and should be validated early -- a thin REST client is the fallback.

## Key Findings

### Recommended Stack

The stack is a single Node.js process running SvelteKit (Svelte 5) with adapter-node, producing one deployment artifact managed by systemd. SQLite via `better-sqlite3` handles persistence (no external database server), and Drizzle ORM provides type-safe schema management. This single-process model -- one systemd unit, one port, one SQLite file -- is ideal for a self-hosted tool that must support one-line installation.

**Core technologies:**
- **SvelteKit 2.x (Svelte 5):** Full-stack framework -- SSR + API routes in one codebase. 50-70% less JS than React. Perfect scale for self-hosted tools.
- **SQLite (better-sqlite3):** Embedded database, zero external dependencies. Critical for one-line installer. Config + credentials storage only.
- **proxmox-api:** TypeScript Proxmox client. MEDIUM confidence due to 2-year publish gap. Direct REST calls are the fallback.
- **unifi-protect:** Complete Node.js UniFi Protect API. Actively maintained. For monitoring, not adoption automation.
- **node-ssh:** SSH into LXC containers for go2rtc config deployment and service management.
- **go2rtc:** Runs inside each LXC (not embedded in app). MJPEG-to-H.264 transcoding with VAAPI. Managed via generated YAML configs.

### Expected Features

**Must have (table stakes -- v1):**
- Proxmox host configuration (foundation for everything)
- Network camera discovery (ONVIF + ARP scan + MAC fingerprinting)
- Credential management (encrypted at rest, never committed)
- LXC container creation and lifecycle management
- go2rtc config generation (Mobotix and Loxone templates)
- Camera status dashboard (container health + stream health)
- One-line install script

**Should have (differentiators -- v1.x):**
- Stream validation/preview (go2rtc WebRTC preview before adoption)
- UniFi Protect adoption trigger (currently semi-manual)
- VAAPI auto-detection and passthrough configuration
- Guided setup wizard (multi-step with back/retry)

**Defer (v2+):**
- UniFi Protect health monitoring via SSH to UDM
- Additional camera type plugins
- Bulk operations, backup/restore
- AI detection, NVR features, multi-site (anti-features -- never build)

### Architecture Approach

The system is a monolithic SvelteKit app with clearly separated backend services (Proxmox, Camera Pipeline, Network Scanner, UniFi Protect, Status Monitor, Config Store). The Camera Pipeline Service is the core orchestrator -- it coordinates a sequential, idempotent, step-by-step provisioning workflow with rollback support. Config files (go2rtc.yaml, nginx.conf) are generated from templates and deployed to containers via SSH. Health monitoring uses tiered polling: Proxmox container status, go2rtc API reachability, and RTSP frame production.

**Major components:**
1. **Camera Pipeline Service** -- Orchestrates end-to-end provisioning (LXC creation through stream verification)
2. **Proxmox Service** -- REST client for container CRUD, device passthrough, exec
3. **Config Generator** -- Template engine for go2rtc.yaml and nginx.conf per camera type
4. **Status Monitor** -- Tiered health polling every 30 seconds across all managed cameras
5. **Network Scanner** -- ARP scan + port probe + ONVIF discovery + MAC OUI fingerprinting

### Critical Pitfalls

1. **VAAPI passthrough fails silently in LXC** -- Must configure device nodes, cgroup rules, UID mapping, AND install VAAPI drivers inside the container. Verify with `vainfo` post-provision. Address in Phase 1.
2. **Credentials leaked to public repo** -- Set up `.gitignore` and credential architecture before writing any code. Pre-commit hooks to block secrets. Address in Phase 0.
3. **go2rtc loses connections without recovery** -- MJPEG sources lack reconnection semantics. Use ffmpeg source prefix with reconnect flags. External health-check restarts stale streams. Address in Phase 2.
4. **UniFi Protect adoption breaks on any config change** -- Use fixed IPs, fixed ports, fixed stream names. Provide both HQ and LQ streams. Document re-adoption prominently. Address in Phase 3.
5. **Proxmox API token permission errors** -- Privilege separation is on by default. Use dedicated user with explicit permissions. Test with API tokens from day one, never root tickets. Address in Phase 1.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Proxmox Integration
**Rationale:** Everything depends on Proxmox API connectivity and LXC container management. The Proxmox Service is the foundational dependency. The `proxmox-api` library needs early validation (MEDIUM confidence). VAAPI passthrough must be proven in Phase 1, not retrofitted later.
**Delivers:** Working SvelteKit skeleton, SQLite persistence layer, Proxmox API client that can create/start/stop/destroy LXC containers with GPU passthrough, settings UI for Proxmox host configuration.
**Addresses:** Proxmox host configuration, credential management, LXC container lifecycle (from FEATURES.md)
**Avoids:** Proxmox API token permission errors, VAAPI silent failures, credentials in repo (from PITFALLS.md)

### Phase 2: Mobotix Camera Pipeline
**Rationale:** Mobotix is the simpler camera type (go2rtc only, no nginx). Building the full provisioning pipeline for one camera type validates the Pipeline Orchestrator pattern and Config-as-Template pattern before adding Loxone complexity.
**Delivers:** End-to-end provisioning for Mobotix cameras: go2rtc config generation, container provisioning with go2rtc installed, MJPEG-to-H.264 transcoding via VAAPI, RTSP stream output, stream health verification.
**Addresses:** go2rtc config generation, one-click onboarding (from FEATURES.md)
**Avoids:** go2rtc connection loss without recovery (from PITFALLS.md)

### Phase 3: Loxone Pipeline and Network Discovery
**Rationale:** Loxone Intercom requires nginx auth-proxy on top of go2rtc, making it a natural extension of Phase 2. Network discovery is independent and can be built alongside, providing the camera detection UI entry point.
**Delivers:** Loxone Intercom pipeline (nginx auth-proxy + go2rtc), network scanner (ARP + ONVIF + MAC fingerprinting), scanner UI with camera type classification.
**Addresses:** Camera-type-specific workflows, network camera discovery (from FEATURES.md)
**Avoids:** Loxone nginx auth proxy misconfiguration, nginx MJPEG buffering issues (from PITFALLS.md)

### Phase 4: Dashboard, Monitoring, and UniFi Protect
**Rationale:** Status monitoring is a read-only concern that layers on top of working provisioning. UniFi Protect adoption is semi-manual and should only be built once streams are proven stable.
**Delivers:** Camera status dashboard with tiered health checks, stream validation/preview via go2rtc WebRTC, UniFi Protect adoption instructions and verification, re-adoption detection.
**Addresses:** Camera status dashboard, stream validation/preview, UniFi Protect adoption (from FEATURES.md)
**Avoids:** UniFi Protect adoption fragility (from PITFALLS.md)

### Phase 5: Installer and Distribution
**Rationale:** The app must work before it can be packaged. The one-line installer is the distribution mechanism and must be tested on a fresh Proxmox VM.
**Delivers:** Bash installer script (Node.js + clone + npm install + systemd service), update mechanism, documentation for end users.
**Addresses:** One-line install script (from FEATURES.md)
**Avoids:** Installer fails on fresh system (from PITFALLS.md)

### Phase Ordering Rationale

- **Proxmox first** because every other feature depends on creating and managing LXC containers. Validating the API client and GPU passthrough early de-risks the entire project.
- **Mobotix before Loxone** because Mobotix is the simpler pipeline (no nginx layer). It validates the core orchestration pattern before adding auth-proxy complexity.
- **Network discovery in Phase 3** (not Phase 1) because cameras can be added manually during early phases. Discovery is a UX convenience, not a functional dependency.
- **Dashboard and Protect in Phase 4** because monitoring requires working cameras to monitor, and Protect adoption requires stable streams to adopt.
- **Installer last** because packaging a broken app is pointless. The app must be feature-complete before distribution.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Proxmox API token auth and LXC device passthrough configuration need hands-on validation. The `proxmox-api` npm package may need to be replaced with direct REST calls.
- **Phase 3:** Loxone Intercom auth-proxy pattern is documented in only a few sources (LoxWiki, one blog post, one go2rtc issue). Needs real hardware testing.
- **Phase 4:** UniFi Protect third-party camera adoption has no stable public API. The `unifi-protect` library is unofficial. Integration must be tested against real UDM hardware.

Phases with standard patterns (skip research-phase):
- **Phase 2:** go2rtc configuration and ffmpeg transcoding are well-documented with extensive community examples.
- **Phase 5:** One-line installer scripts follow the established Proxmox Helper Scripts pattern. Standard systemd service creation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | SvelteKit, SQLite, node-ssh are high confidence. `proxmox-api` is MEDIUM due to 2-year publish gap. Validate early or fall back to direct REST. |
| Features | HIGH | Domain is narrow and well-understood. Comparable tools analyzed (Frigate, Shinobi, unifi-cam-proxy). Feature scope is clear. |
| Architecture | HIGH | Single-process monolith with service modules is straightforward. Pipeline orchestrator pattern is well-documented. One-LXC-per-camera model is proven. |
| Pitfalls | HIGH | All critical pitfalls verified across multiple sources (Proxmox forums, go2rtc GitHub issues, UniFi community). Prevention strategies are concrete. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **`proxmox-api` library viability:** Last published 2 years ago. Must validate against Proxmox VE 8.x in Phase 1. Fallback: direct REST client using `fetch` (~1 day effort).
- **UniFi Protect adoption automation:** No stable public API for programmatic adoption. The app can prepare streams and provide instructions, but full automation may not be possible. Validate with real UDM in Phase 4.
- **VAAPI concurrent session limits:** Intel iGPU supports 8-16 simultaneous encode sessions. With 4 cameras (per PROJECT.md scope), this is not an issue, but should be documented as a scaling constraint.
- **Loxone Intercom auth mechanism:** Documentation is sparse. The Base64 auth header approach is confirmed by LoxWiki and one go2rtc issue, but edge cases (token expiry, firmware updates) are unknown.
- **ONVIF discovery library:** The `onvif` npm package has MEDIUM confidence. May need evaluation against alternatives or a thin custom WS-Discovery implementation.

## Sources

### Primary (HIGH confidence)
- [Proxmox VE API Documentation](https://pve.proxmox.com/wiki/Proxmox_VE_API) -- REST API reference, LXC management, API tokens
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) -- Configuration, HTTP API, ffmpeg transcoding, VAAPI
- [UniFi Protect Third-Party Cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) -- Official ONVIF adoption docs
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0, battle-tested SQLite driver
- [SvelteKit docs](https://www.npmjs.com/package/@sveltejs/kit) -- v2.55.0, adapter-node deployment
- [unifi-protect npm](https://www.npmjs.com/package/unifi-protect) -- v4.27.7, actively maintained

### Secondary (MEDIUM confidence)
- [proxmox-api npm](https://www.npmjs.com/package/proxmox-api) -- v1.1.1, TypeScript, last published 2 years ago
- [Proxmox LXC iGPU passthrough](https://forum.proxmox.com/threads/proxmox-lxc-igpu-passthrough.141381/) -- Community tutorial
- [LoxWiki Loxone Intercom + go2rtc](https://loxwiki.atlassian.net/wiki/spaces/LOXEN/pages/2517499917/) -- nginx auth-proxy reference
- [Florian Rhomberg blog](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) -- Third-party camera walkthrough
- [unifi-cam-proxy](https://github.com/keshavdv/unifi-cam-proxy) -- Alternative adoption approach
- [go2rtc connection recovery issue #762](https://github.com/AlexxIT/go2rtc/issues/762) -- Known reconnection limitations

### Tertiary (LOW confidence)
- [onvif npm](https://www.npmjs.com/package/onvif) -- ONVIF WS-Discovery, needs evaluation
- [nmap for network scanning](https://nmap.org/) -- Optional fallback, requires system binary

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
