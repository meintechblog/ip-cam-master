# Phase 2: Mobotix Camera Pipeline - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

End-to-end Mobotix camera onboarding: user enters camera credentials, app tests connection, creates LXC container on Proxmox, installs go2rtc via SSH, deploys YAML config for MJPEG→H.264 transcoding with VAAPI, and verifies the resulting RTSP stream. Builds on Phase 1's Proxmox client, container management, and settings infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Onboarding Flow
- **D-01:** "+Kamera hinzufügen" button on the Kameras page starts the onboarding
- **D-02:** 5-step Stepper/Wizard UI:
  1. Kamera-IP + Credentials + Transcode-Parameter (optional, with smart defaults)
  2. Verbindung testen (RTSP probe, detect native resolution)
  3. Container erstellen (LXC on Proxmox via existing API)
  4. go2rtc konfigurieren (install binary, deploy YAML, start service)
  5. Stream verifizieren (go2rtc API check + WebRTC live preview)
- **D-03:** Progress indicator at top showing all 5 steps
- **D-04:** On error: retry in the same step — user stays on current step with error message + retry button until it succeeds
- **D-05:** After completion, return to Kameras page where new camera appears in the container grid

### go2rtc Container Setup
- **D-06:** LXC base image: Debian 12 (Bookworm) — standard Proxmox template
- **D-07:** go2rtc installed via SSH into the container: download latest binary from GitHub releases, no package manager
- **D-08:** go2rtc managed as systemd service inside the container — auto-restart, journalctl logs
- **D-09:** App generates `go2rtc.yaml` config file and deploys it to the container via SSH (SCP/SFTP)
- **D-10:** ffmpeg also needed in container for VAAPI transcoding — install via apt

### Transcode Parameters
- **D-11:** Transcode parameters shown in Wizard Step 1 as optional fields with smart defaults
- **D-12:** Defaults are camera-dependent: on connection test (Step 2), detect native resolution from RTSP stream and pre-fill resolution/fps
- **D-13:** Fallback defaults if detection fails: 1280x720, 20fps, 5000kbit/s (proven values from blog setup)
- **D-14:** Parameters stored in DB per camera for later editing
- **D-15:** go2rtc YAML template: `ffmpeg:rtsp://<user>:<pw>@<ip>:554/stream0/mobotix.mjpeg#video=h264#width={W}#height={H}#raw=-r {FPS}#raw=-maxrate {BITRATE}#raw=-bufsize {BITRATE*2}#raw=-g {FPS}#hardware=vaapi`

### Stream Verification
- **D-16:** Verification via go2rtc HTTP API (`:1984/api/streams`) — check stream is active and codec is H.264
- **D-17:** WebRTC/MSE live preview in the final wizard step — small player window showing the transcoded stream from go2rtc
- **D-18:** Display stream info: RTSP URL (`rtsp://<container-ip>:8554/cam`), codec, resolution, fps
- **D-19:** This RTSP URL is what gets adopted into UniFi Protect (shown to user, adoption is Phase 4)

### Claude's Discretion
- Wizard component implementation (custom stepper vs bits-ui)
- SSH command sequences and error handling details
- go2rtc binary version pinning strategy
- WebRTC player component choice (go2rtc provides built-in WebRTC endpoint)
- Container naming convention (e.g., `cam-{ip-suffix}` or `mobotix-{vmid}`)
- How transcode parameter editing works post-onboarding (Kamera-Detail-Seite)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing codebase (Phase 1)
- `src/lib/server/services/proxmox.ts` — Proxmox client, createContainer, configureVaapi, lifecycle management (reuse for Step 3)
- `src/lib/server/db/schema.ts` — containers + credentials tables (extend for transcode params)
- `src/lib/server/services/settings.ts` — Settings service with encryption (reuse for Proxmox connection)
- `src/lib/components/containers/ContainerGrid.svelte` — Existing container grid (new camera appears here after onboarding)
- `src/routes/kameras/+page.svelte` — Kameras page where onboarding button goes

### Project context
- `.planning/PROJECT.md` — Technical pipeline: Mobotix MJPEG → go2rtc (ffmpeg VAAPI) → RTSP :8554
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: LXC-03, G2R-01, G2R-04, G2R-05, G2R-06, ONBD-01..04, ONBD-06
- `CLAUDE.md` — go2rtc config template, VAAPI hardware string, stream source URL pattern

### External references
- go2rtc GitHub API docs: `GET /api/streams` for stream status, WebRTC endpoint at `/api/ws`
- go2rtc releases: binary download for linux/amd64
- Proxmox LXC SSH: containers accessible via `pct exec {vmid}` from Proxmox host or direct SSH if network is configured

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `proxmox.ts:getProxmoxClient()` — Configured API client, reuse directly
- `proxmox.ts:createContainer()` — LXC creation with VAAPI passthrough, reuse for Step 3
- `proxmox.ts:configureVaapi()` — Device passthrough config, already implemented
- `settings.ts:getSettings()` / `saveSetting()` — Encrypted credential storage, reuse for camera credentials
- `ContainerCard.svelte` / `ContainerGrid.svelte` — Display components, new cameras appear here automatically

### Established Patterns
- API routes at `src/routes/api/` — SvelteKit server routes with JSON responses
- TDD with Vitest — mocked proxmox-api, test files alongside source
- Dark theme with Tailwind — CSS variables in app.css
- InlineAlert component for success/error feedback

### Integration Points
- New API routes needed: `/api/onboarding/*` for wizard steps
- SSH service needed: new `src/lib/server/services/ssh.ts` using node-ssh
- go2rtc service needed: new `src/lib/server/services/go2rtc.ts` for config generation + API health checks
- DB schema extension: transcode parameters per camera (resolution, fps, bitrate)
- Kameras page: add "+Kamera hinzufügen" button that opens wizard

</code_context>

<specifics>
## Specific Ideas

- Wizard should feel like the Proxmox container creation dialog — step-by-step, clear progress
- Stream preview (WebRTC) in Step 5 is the "wow moment" — user sees their camera working for the first time through the app
- Connection test in Step 2 should detect the camera's native capabilities (resolution, codec) and show them
- go2rtc VAAPI config string from the blog: `-init_hw_device vaapi=intel:/dev/dri/renderD128 -filter_hw_device intel -c:v h264_vaapi`

</specifics>

<deferred>
## Deferred Ideas

- Auto-Discovery of cameras on the network — Phase 3 (user mentioned wanting this on the Kameras page)
- Post-onboarding parameter editing on a camera detail page — could be Phase 2 scope if time permits, otherwise later
- UniFi Protect adoption of the RTSP stream — Phase 4
- Loxone Intercom pipeline (nginx auth-proxy) — Phase 3

</deferred>

---

*Phase: 02-mobotix-camera-pipeline*
*Context gathered: 2026-03-22*
