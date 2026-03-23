# Phase 4: Dashboard and UniFi Protect - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the dashboard with UniFi Protect integration: connect to Protect API for camera status and adoption, SSH to UDM for log analysis, surface problems and events in the UI, and enable programmatic camera adoption from within the app. Builds on the dashboard skeleton (health banner, stat cards, camera table) already built in this session.

</domain>

<decisions>
## Implementation Decisions

### UniFi Protect API Integration
- **D-01:** Hybrid approach: `unifi-protect` npm package (or direct REST) for structured data (cameras, status, adoption) + SSH for raw log access
- **D-02:** Dedicated local UniFi OS user `ip-cam-master` with full Protect admin permissions — credentials already stored in app settings
- **D-03:** Dedicated SSH key at `/opt/ip-cam-master/data/udm_key` for UDM root access — already deployed and tested
- **D-04:** Protect API auth via POST to `https://{host}/api/auth/login` with cookie-based session. Session refresh on 401.
- **D-05:** Protect API base path: `https://{host}/proxy/protect/api/` — cameras, events, NVR status all available here
- **D-06:** Camera matching between our DB and Protect: match by container IP (our cameras appear as third-party ONVIF devices at their container IP)

### Camera Adoption from App
- **D-07:** Programmatic adoption IS possible — user `ip-cam-master` has `create:protect.camera` and `write:protect.camera` scopes
- **D-08:** After onboarding wizard completes (stream verified), offer "In Protect aufnehmen" button that triggers adoption via API
- **D-09:** Adoption flow: our ONVIF server on the container is discoverable by Protect. App calls Protect API to adopt the discovered device.
- **D-10:** If programmatic adoption fails or isn't reliable, fallback to guided instructions ("Oeffne Protect → Geraete → Uebernehmen")

### Log Analysis & Problem Detection
- **D-11:** Collect events from two sources: Protect API (camera state changes, adoption events) + SSH log parsing (detailed errors, stream failures)
- **D-12:** Store events in SQLite `events` table with: timestamp, camera_id, event_type, severity, message, source
- **D-13:** Event types to capture: `camera_disconnect`, `camera_reconnect`, `stream_failed`, `adoption_changed`, `aiport_error`
- **D-14:** Noise filtering — do NOT store or display: routine ONVIF discovery updates, normal reconnects under 10 seconds, go2rtc startup messages, periodic health checks
- **D-15:** Flapping detection: if a camera has >3 disconnects in 10 minutes, flag it as "instabil" with warning severity
- **D-16:** Polling interval: Protect API every 30s for camera status. SSH log scan every 60s (parse recent log entries since last scan).

### Dashboard Enhancements
- **D-17:** Dashboard already has: health banner, 4 stat cards (Kameras, Container, Streams, UniFi Protect), resource bars, camera table — keep and enhance
- **D-18:** Add "Letzte Ereignisse" section below stats — compact list of last 10 important events with timestamp, camera name, and event description
- **D-19:** UniFi Protect stat card: update from indirect stream-consumer detection to real Protect API data (adopted count, connected count)
- **D-20:** Camera table: add Protect column showing real adoption status from API (adopted/pending/error) instead of indirect detection

### Per-Camera Protect Info
- **D-21:** In CameraDetailCard pipeline section, update UniFi Protect box with real API data: adoption status, Protect camera name, last disconnect, disconnect count (24h)
- **D-22:** Flapping warning badge on cameras that are unstable (>3 disconnects in 10min)
- **D-23:** For native ONVIF cameras: show Protect status too (they're directly adopted, we can match by MAC/IP)

### Logs Page
- **D-24:** Activate the placeholder Logs page with a filterable event table
- **D-25:** Filters: by camera, by severity (info/warning/error), by event type, date range
- **D-26:** Show newest events first, paginated or virtual-scrolled
- **D-27:** Include a "Protect Logs" tab that shows raw recent entries from UDM SSH logs (on-demand, not stored — for deep debugging like we did manually today)

### Claude's Discretion
- Protect API client implementation details (direct REST vs npm package evaluation during research)
- SSH log parsing regex patterns and implementation
- Event table schema details
- Exact polling/caching strategy
- Logs page component structure
- How many events to retain in SQLite (retention policy)

</decisions>

<specifics>
## Specific Ideas

- "Sau wichtig" — the user explicitly prioritized this because of a real incident where go2rtc streams were flapping and causing constant disconnect/reconnect push notifications. The manual SSH log analysis session today motivated this entire phase.
- The adoption button after onboarding would be "zu krass" (amazing) — this is the ultimate one-click experience the project aims for
- UniFi Protect logs live at `/srv/unifi-protect/logs/` on the UDM (192.168.3.1) — key log files: `cameras.thirdParty.log`, `cameras.log`, `aiport.log`, `notifications.push.log`
- Third-party cameras in Protect show as `[MAC @ container-IP]` — this is how we match them to our DB
- The fix today switched Mobotix from RTSP MJPEG to HTTP MJPEG (`faststream.jpg?stream=full&fps=20&needlength`) — the app should generate this URL format going forward

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing codebase
- `src/routes/+page.svelte` — Dashboard page with health banner, stat cards, resource bars, camera table (just built)
- `src/lib/components/cameras/CameraDetailCard.svelte` — Camera cards with pipeline view, UniFi Protect section (needs API data)
- `src/routes/api/cameras/status/+server.ts` — Current status API with indirect Protect detection via go2rtc consumers
- `src/lib/server/services/settings.ts` — Settings service, UniFi credentials stored here (unifi_host, unifi_username, unifi_password)
- `src/lib/server/db/schema.ts` — DB schema, needs events table
- `src/routes/logs/` — Placeholder logs page to be activated
- `src/lib/components/layout/Sidebar.svelte` — Navigation with Logs link already present

### Infrastructure
- `/opt/ip-cam-master/data/udm_key` — SSH key for UDM access (on app VM)
- UDM SSH: `ssh -i data/udm_key root@192.168.3.1`
- Protect API: `https://192.168.3.1/proxy/protect/api/cameras`
- Protect logs: `/srv/unifi-protect/logs/cameras.thirdParty.log`, `cameras.log`, `aiport.log`

### Project context
- `.planning/PROJECT.md` — UDM at 192.168.3.1, infrastructure details
- `.planning/REQUIREMENTS.md` — DASH-01..06, ONBD-05
- `CLAUDE.md` — `unifi-protect` npm package reference (v4.27+)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `settings.ts:getSettings('unifi_')` — Retrieve UniFi credentials (host, username, encrypted password)
- `crypto.ts:decrypt()` — Decrypt stored password for API auth
- `+page.svelte` (dashboard) — Health banner, stat cards, camera table already rendering with polling
- `CameraDetailCard.svelte` — Pipeline view with UniFi Protect section (currently indirect detection)
- `ssh.ts:connectToProxmox()` — SSH service pattern, adapt for UDM SSH connection

### Established Patterns
- API routes at `src/routes/api/` with JSON responses
- 10s polling on dashboard, 30s on probe data — follow this pattern
- Dark theme with Tailwind custom colors (bg-card, border, text-primary, success/warning/danger)
- StatusBadge and InlineAlert components for status display

### Integration Points
- New service: `src/lib/server/services/protect.ts` — Protect API client (login, cameras, events)
- New service: `src/lib/server/services/udm-logs.ts` — SSH log parser for UDM
- New DB table: `events` — camera events stored for history/pattern detection
- New API routes: `/api/protect/cameras`, `/api/protect/events`, `/api/logs/protect`
- Dashboard enhancement: swap indirect detection for real API data
- Logs page: activate with event table + raw log viewer

</code_context>

<deferred>
## Deferred Ideas

- Push notifications from app to phone — v2 (MON-* requirements)
- Disconnect pattern analysis with graphs/charts over time — v2 (MON-03)
- Per-camera reliability score — v2 (MON-04)
- Automatic go2rtc config fix when stream issues detected — future
- UniFi Protect event webhook subscription (WebSocket) for real-time updates — could replace polling, evaluate in research

</deferred>

---

*Phase: 04-dashboard-and-unifi-protect*
*Context gathered: 2026-03-23*
