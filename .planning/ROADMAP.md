# Roadmap: IP-Cam-Master

## Completed Milestones

- **v1.0** — One-click camera onboarding for Mobotix/Loxone into UniFi Protect (5 phases, 11 plans) — [Archive](milestones/v1.0-ROADMAP.md)
- **v1.1** — Self-Maintenance & Polish: in-UI updates, backups, logs, health (4 phases, 5 plans) — [Archive](milestones/v1.1-ROADMAP.md)

## Current Milestone

**v1.2 — Bambu Lab H2C Kamera-Integration**

Integrate the Bambu Lab H2C 3D-printer camera into the existing LXC/go2rtc/UniFi Protect pipeline as a third `camera_type` alongside Mobotix and Loxone. LAN-only, Access Code + Serial, RTSPS via go2rtc, adoption into UniFi Protect — plus a user-proposed Adaptive Stream Mode that disconnects go2rtc when the printer is idle to protect the printer's fragile Live555 server from 24/7 exposure.

Phase numbering continues from v1.1 (ended at Phase 09). v1.2 starts at Phase 10.

## Phases

- [ ] **Phase 10: H2C Hardware Validation Spike** — Investigation spike against real H2C; deliverable is a findings note that gates all later phases (4 plans)
- [ ] **Phase 11: Foundation — Discovery, Credentials, Pre-flight** — SSDP discovery, encrypted Access Code + Serial storage, three-state pre-flight handshake
- [ ] **Phase 12: Stream Pipeline — go2rtc RTSPS + LXC Reuse** — `rtspx://` passthrough config, go2rtc as sole RTSPS consumer, existing LXC template reused
- [ ] **Phase 13: UniFi Protect Adoption + Dashboard Error Taxonomy** — End-to-end adoption verified; Bambu-specific error states on dashboard; inline Access Code update
- [ ] **Phase 14: Adaptive Stream Mode + Wizard UI Polish** — User-proposed differentiator: live-during-print / snapshot-during-idle driven by MQTT; polished Bambu credential wizard
- [ ] **Phase 15: Docs & Installer Validation** — README for LAN Mode setup, firmware caveats, Bambu Studio trade-off; installer confirmed unchanged

## Phase Details

### Phase 10: H2C Hardware Validation Spike
**Goal**: Confirm H2C-specific protocol assumptions against real hardware before any production code is written
**Depends on**: Nothing (first phase of v1.2)
**Requirements**: BAMBU-01, BAMBU-02
**Success Criteria** (what must be TRUE):
  1. User can read a findings document at `.planning/research/H2C-FIELD-NOTES.md` that states the confirmed RTSPS URL path (`/streaming/live/1` or corrected variant) observed on their actual H2C
  2. User can see, in the same document, the confirmed SSDP service URN and broadcast port observed from a live capture on the local network
  3. User can see the confirmed MQTT topic schema (at minimum, the print-state field name and payload shape) captured from the real printer
  4. Subsequent phase plans cite H2C-FIELD-NOTES.md as ground truth when they diverge from X1C/P1S assumptions
**Plans**: 4 plans
- [ ] PLAN-01-tooling-prep.md — Install openssl/ffmpeg/mosquitto-clients/tcpdump/socat + go2rtc binary on App-VM (192.168.3.233)
- [ ] PLAN-02-spike-script.md — Bash spike script (run-spike.sh) + go2rtc config template; four phases with hard timeouts
- [ ] PLAN-03-field-notes-template.md — H2C-FIELD-NOTES.md skeleton + RUN-GUIDE.md runbook
- [ ] PLAN-04-field-run.md — Run spike against real H2C, fill field notes, commit (gated on user home + credentials)

### Phase 11: Foundation — Discovery, Credentials, Pre-flight
**Goal**: User can discover their Bambu printer, enter credentials securely, and receive a clear pre-flight verdict before any LXC is provisioned
**Depends on**: Phase 10 (gates on confirmed SSDP URN + RTSPS path)
**Requirements**: BAMBU-03, BAMBU-04, BAMBU-05, BAMBU-06, BAMBU-07, BAMBU-08, BAMBU-09, BAMBU-10
**Success Criteria** (what must be TRUE):
  1. User sees their Bambu H2C appear in the discovery result list (labeled "Bambu Lab H2C", with IP and serial) when they run a network scan
  2. User can manually add a Bambu printer by IP if SSDP missed it, and the app differentiates Bambu rows from Mobotix/Loxone/ONVIF in the UI
  3. User can enter the 8-digit Access Code and Serial Number in the onboarding wizard and the values land AES-256-GCM encrypted in SQLite without breaking existing Mobotix/Loxone rows
  4. User receives a distinct pre-flight verdict for each failure mode: LAN Mode off, wrong Access Code, printer unreachable, RTSPS handshake hung — not a single opaque error
**Plans**: TBD
**UI hint**: yes

### Phase 12: Stream Pipeline — go2rtc RTSPS + LXC Reuse
**Goal**: go2rtc, running in the existing shared LXC template, pulls the printer's RTSPS stream as the sole consumer and exposes it on :8554 for Protect
**Depends on**: Phase 11 (needs credentials + pre-flight before provisioning an LXC)
**Requirements**: BAMBU-11, BAMBU-12, BAMBU-13, BAMBU-14
**Success Criteria** (what must be TRUE):
  1. User can inspect the generated go2rtc YAML for a Bambu camera and see an `rtspx://bblp:<code>@<ip>:322/streaming/live/1` source with `#video=copy` (or validated VAAPI fallback) and TLS verification skipped
  2. Bambu cameras provision into the same existing LXC template used by Mobotix (no new template, VAAPI passthrough still in place)
  3. Architectural guarantee is codified and documented in-repo: go2rtc is the sole RTSPS consumer of the printer; UniFi Protect only ever connects to go2rtc's :8554 restream
  4. Onboarding completes only after a go2rtc health check against `http://<lxc>:1984/api/streams` confirms the Bambu stream is live
**Plans**: TBD

### Phase 13: UniFi Protect Adoption + Dashboard Error Taxonomy
**Goal**: User completes end-to-end onboarding and sees accurate, Bambu-aware status on the dashboard
**Depends on**: Phase 12 (needs a live go2rtc restream to adopt)
**Requirements**: BAMBU-15, BAMBU-16, BAMBU-17
**Success Criteria** (what must be TRUE):
  1. User can run the full flow — discover → credentials → pre-flight → LXC create → go2rtc deploy → Protect adoption — and see the Bambu camera streaming in UniFi Protect at the end, without leaving the app
  2. User can see distinct Bambu-specific error states on the dashboard (LAN Mode disabled, Access Code invalid, RTSPS handshake hung, MQTT disconnected) rather than a generic "offline"
  3. Protect status polling reuses the existing polling module with no Bambu-specific Protect-side code; health probes never open the printer's RTSPS stream directly
**Plans**: TBD
**UI hint**: yes

### Phase 14: Adaptive Stream Mode + Wizard UI Polish
**Goal**: User benefits from the differentiator — go2rtc stays live during active prints and falls back to a lightweight snapshot loop when the printer is idle — driven by MQTT print-state, with a polished Bambu credential wizard
**Depends on**: Phase 11 (MQTT subscription + credentials) and Phase 12 (go2rtc config toggling)
**Requirements**: BAMBU-18, BAMBU-19, BAMBU-20, BAMBU-21, BAMBU-22, BAMBU-23, BAMBU-24
**Success Criteria** (what must be TRUE):
  1. User sees a "Live" badge on the dashboard while the H2C is actively printing and a "Snapshot" badge when the printer is idle, with the mode driven automatically by MQTT `device/<serial>/report` transitions
  2. User can override per-camera to "Always Live", "Always Snapshot", or "Adaptive (default)" and the mode respects the override immediately
  3. User sees a Bambu-specific onboarding step with inline help explaining where to find the Access Code and how to enable LAN Mode — no raw error strings bubble up to the UI
  4. During idle, the printer is no longer under a 24/7 RTSPS pull (observable: go2rtc disconnects, printer's Live555 has no open session)
**Plans**: TBD
**UI hint**: yes

### Phase 15: Docs & Installer Validation
**Goal**: External users of the public repo can set up LAN Mode, understand the firmware/Bambu Studio trade-offs, and install v1.2 with the existing one-line script unchanged
**Depends on**: Phase 14 (docs describe a stable implementation)
**Requirements**: BAMBU-25, BAMBU-26
**Success Criteria** (what must be TRUE):
  1. User can read a README section that walks through enabling LAN Mode Liveview on the H2C, finding the Access Code, and the Bambu Studio single-connection trade-off
  2. User is warned in the docs about the firmware "Authorization Control" risk and the recommendation to disable auto-update on adopted printers
  3. The existing one-line installer is re-run end-to-end on a clean VM and provisions v1.2 with no Bambu-specific changes to `install.sh`
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. H2C Hardware Validation Spike | 0/4 | Not started | - |
| 11. Foundation — Discovery, Credentials, Pre-flight | 0/? | Not started | - |
| 12. Stream Pipeline — go2rtc RTSPS + LXC Reuse | 0/? | Not started | - |
| 13. UniFi Protect Adoption + Dashboard Error Taxonomy | 0/? | Not started | - |
| 14. Adaptive Stream Mode + Wizard UI Polish | 0/? | Not started | - |
| 15. Docs & Installer Validation | 0/? | Not started | - |
