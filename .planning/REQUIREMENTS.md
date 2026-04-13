# Requirements: IP-Cam-Master v1.2 — Bambu Lab H2C Kamera-Integration

**Defined:** 2026-04-13
**Milestone:** v1.2
**Core Value:** Bambu Lab H2C als UniFi-Protect-kompatible Kamera integrieren — Auto-Discovery, verschlüsselte Credentials, go2rtc-Transcoding, Adoption — analog zum bestehenden Mobotix/Loxone-Pattern.

> Numbering continues conceptually from v1.1 categories. REQ-IDs use the `BAMBU-*` prefix for the new Bambu-specific capabilities and extend existing category prefixes where work slots into existing modules.

## v1.2 Requirements

### Hardware Validation Spike (Phase 10)

- [ ] **BAMBU-01**: User runs a validation spike against their real H2C to confirm RTSPS stream path (`/streaming/live/1` assumed from X1C), SSDP service type (`urn:bambulab-com:device:3dprinter:1` assumed), and MQTT topic schema before any production code is written
- [ ] **BAMBU-02**: Spike outputs a short findings note (`.planning/research/H2C-FIELD-NOTES.md`) that subsequent phases treat as ground truth

### Discovery (Phase 11)

- [ ] **BAMBU-03**: Network scanner detects Bambu Lab printers on the local network via SSDP (UDP broadcast on port 2021, service type matches Bambu URN)
- [ ] **BAMBU-04**: Discovery result shows device type ("Bambu Lab H2C"), IP, serial number (from SSDP payload), and LAN-Mode status hint
- [ ] **BAMBU-05**: User can manually add a Bambu printer by IP if auto-discovery misses it
- [ ] **BAMBU-06**: Discovery integrates into the existing scanner module — result list UI differentiates Bambu from Mobotix/Loxone/ONVIF cameras

### Credentials & Schema (Phase 11)

- [ ] **BAMBU-07**: User enters Access Code (from printer display, 8-digit) and Serial Number in the onboarding wizard; both stored AES-256-GCM encrypted in SQLite
- [ ] **BAMBU-08**: Drizzle schema extends `cameras` (or introduces Bambu-specific fields) for `access_code`, `serial_number`, and a `transport` stub (`'lan'` default; `'cloud'` reserved for v1.3)
- [ ] **BAMBU-09**: Credential schema migration lands without breaking existing Mobotix/Loxone rows

### Pre-flight & Connection Test (Phase 11)

- [ ] **BAMBU-10**: Pre-flight test verifies (a) TCP reachability on port 322, (b) RTSPS handshake succeeds with given Access Code, (c) MQTT TLS handshake succeeds on port 8883 — distinct error states surfaced in UI (LAN Mode off, wrong code, printer offline, Live555 hung)

### Stream Pipeline (Phase 12)

- [ ] **BAMBU-11**: App generates a go2rtc YAML config for Bambu H2C using `rtspx://bblp:<code>@<ip>:322/streaming/live/1` (skips TLS validation for printer self-signed cert) with `#video=copy` passthrough (no transcode — stream is already H.264)
- [ ] **BAMBU-12**: LXC template used for Bambu cameras is the existing shared template (ffmpeg, go2rtc, Node.js, VAAPI passthrough) — no new template needed
- [ ] **BAMBU-13**: go2rtc restream is the sole RTSPS consumer of the printer — UniFi Protect adopts go2rtc's RTSP output on :8554, never touches the printer directly (architectural guarantee, documented)
- [ ] **BAMBU-14**: go2rtc health check (HTTP :1984 `/api/streams`) confirms stream is live before onboarding completes

### UniFi Protect Adoption & Monitoring (Phase 13)

- [ ] **BAMBU-15**: End-to-end onboarding flow: discover → credentials → pre-flight → create LXC → deploy go2rtc config → adopt in UniFi Protect → status appears on dashboard
- [ ] **BAMBU-16**: Dashboard shows Bambu camera status (online/offline/error) with Bambu-specific error taxonomy (LAN Mode disabled, Access Code invalid, RTSPS handshake hung, MQTT disconnected)
- [ ] **BAMBU-17**: UniFi Protect status monitoring reuses the existing polling pattern — no Bambu-specific Protect code

### Adaptive Stream Mode — Differentiator (Phase 14)

- [ ] **BAMBU-18**: MQTT subscription to `device/<serial>/report` detects active print state (user-configurable field — verified in Phase 10)
- [ ] **BAMBU-19**: During active print: go2rtc pulls live RTSPS continuously (current behavior)
- [ ] **BAMBU-20**: During idle: go2rtc is reconfigured to serve a snapshot loop (1 frame/min via a lightweight HTTP/RTSPS grab) instead of continuous pull — reduces printer Live555 load and eliminates 24/7 exposure to known hang bug
- [ ] **BAMBU-21**: Mode switching is automatic (driven by MQTT print-state transitions) and visible in the dashboard ("Live" vs "Snapshot" badge)
- [ ] **BAMBU-22**: User can override per-camera: "Always Live" / "Always Snapshot" / "Adaptive (default)"

### Wizard UI & Polish (Phase 14)

- [ ] **BAMBU-23**: Onboarding wizard has a Bambu-specific credential step with inline help ("find Access Code on printer display → Settings → LAN Mode")
- [ ] **BAMBU-24**: Error states from pre-flight map to actionable UI messages (not raw errors)

### Documentation & Installer (Phase 15)

- [ ] **BAMBU-25**: README / docs explain Bambu LAN Mode setup, firmware version caveat (Authorization Control changes risk breaking LAN access), and the Bambu Studio single-connection trade-off
- [ ] **BAMBU-26**: Existing one-line installer needs no Bambu-specific changes (validated)

## Future Requirements (Deferred to v1.3+)

- **Cloud-Auth Fallback**: Bambu Handy account + OAuth + 2FA + JWT refresh + TUTK P2P for cloud streams. Explicitly deferred — TUTK is not RTSPS (doesn't fit existing pipeline), and the auth flow is a large independent workstream. Schema stub (`transport` column) already in place.
- **Bird's Eye Camera** (second camera on H2C via `/streaming/live/2`?) — needs separate hardware verification
- **Print-progress overlays** on the stream (e.g., burn-in layer count) — nice-to-have, not v1.2 scope

## Out of Scope

- **Cloud-only integration** — explicitly LAN-only for v1.2
- **Printer control** (start/stop print, temperature, AMS, file upload) — this is a camera integration, not a 3D-printer-management app
- **Telemetry / metrics** (nozzle temp, bed temp, progress graphs) — out of scope, Home Assistant `bambu_lab` covers that use case
- **Non-H2C Bambu models** in v1.2 (X1C, P1S, H2D, A1) — architecture will likely support them, but v1.2 validation is H2C-only
- **Multi-camera per printer** beyond the primary `/streaming/live/1` feed — Bird's Eye deferred

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BAMBU-01 | Phase 10 | Pending |
| BAMBU-02 | Phase 10 | Pending |
| BAMBU-03 | Phase 11 | Pending |
| BAMBU-04 | Phase 11 | Pending |
| BAMBU-05 | Phase 11 | Pending |
| BAMBU-06 | Phase 11 | Pending |
| BAMBU-07 | Phase 11 | Pending |
| BAMBU-08 | Phase 11 | Pending |
| BAMBU-09 | Phase 11 | Pending |
| BAMBU-10 | Phase 11 | Pending |
| BAMBU-11 | Phase 12 | Pending |
| BAMBU-12 | Phase 12 | Pending |
| BAMBU-13 | Phase 12 | Pending |
| BAMBU-14 | Phase 12 | Pending |
| BAMBU-15 | Phase 13 | Pending |
| BAMBU-16 | Phase 13 | Pending |
| BAMBU-17 | Phase 13 | Pending |
| BAMBU-18 | Phase 14 | Pending |
| BAMBU-19 | Phase 14 | Pending |
| BAMBU-20 | Phase 14 | Pending |
| BAMBU-21 | Phase 14 | Pending |
| BAMBU-22 | Phase 14 | Pending |
| BAMBU-23 | Phase 14 | Pending |
| BAMBU-24 | Phase 14 | Pending |
| BAMBU-25 | Phase 15 | Pending |
| BAMBU-26 | Phase 15 | Pending |

**Coverage:** 26 / 26 v1.2 requirements mapped (100%). No orphans.

---
*REQ-ID format: `BAMBU-NN`. All v1.2 work is Bambu-specific; existing modules (discovery, go2rtc, onboarding, Protect monitoring) get extended, not duplicated.*
