# v1.3 Requirements — Protect Stream Hub (Loxone + Frigate-ready)

**Milestone:** v1.3
**Defined:** 2026-04-30
**Goal:** UniFi Protect Kameras pro Cam in allen verfügbaren Stream-Qualitäten katalogisieren und über einen einzigen LXC-Bridge-Container in den jeweils passenden Output-Formaten bereitstellen — primär Loxone-MJPEG (low-quality, "Benutzerdefinierte Intercom"), aber auch native RTSP-Passthrough (high-quality) für Frigate, NVRs und andere Tools. Voller Lifecycle (Onboarding-Wizard → Auto-Reconciliation → Offboarding-Teardown).

**Locked-Early Decisions:** see `.planning/research/v1.3/SUMMARY.md` §"Locked-Early Decisions" (30 items, including MAC-as-PK and 5-phase decomposition).

---

## v1.3 Requirements

### Catalog & Discovery (HUB-CAT-*)

- [x] **HUB-CAT-01**: User sees all UniFi Protect cams in `/cameras` (inline with managed cams), each marked with a "Protect Hub" badge.
- [x] **HUB-CAT-02**: For each external Protect cam, the catalog displays manufacturer, model, MAC, and the set of available native stream qualities with codec, resolution, framerate, and bitrate per quality.
- [x] **HUB-CAT-03**: System auto-classifies each Protect cam as `first-party` (UniFi/UVC) or `third-party` (adopted Mobotix/Hikvision/etc.) based on Protect bootstrap data; classification is visible in the UI as a secondary qualifier badge.
- [x] **HUB-CAT-04**: Stream catalog refreshes automatically on a cadence (15 min default) and on user-triggered "Sync now."
- [x] **HUB-CAT-05**: Catalog is cached in SQLite so the UI renders correctly even when the UDM is briefly unreachable.
- [x] **HUB-CAT-06**: Single-channel cams (low-end models with only one stream quality) render correctly — no hardcoded 3-channel assumption.

### Bridge LXC Container (HUB-BRG-*)

- [x] **HUB-BRG-01**: A single shared LXC container hosts all Hub streams (no per-cam container).
- [x] **HUB-BRG-02**: The Bridge container is auto-provisioned from the existing Debian 13 + VAAPI template — no new template work required.
- [ ] **HUB-BRG-03**: Bridge container has a static IP (DHCP reservation or static config) so URLs in Loxone/Frigate configs never break.
- [x] **HUB-BRG-04**: Bridge container resource profile is sized for go2rtc bridge workload (1–2 GB RAM, 2–4 cores, `/dev/dri` passthrough, `nofile=4096`).
- [x] **HUB-BRG-05**: go2rtc API binds to `127.0.0.1:1984` inside the LXC; only `:1984` (MJPEG HTTP) and `:8554` (RTSP) are LAN-exposed; the go2rtc web editor is disabled.
- [x] **HUB-BRG-06**: Bridge container can be started, stopped, and restarted from the app UI.
- [x] **HUB-BRG-07**: Bridge container survives Proxmox host reboot (autostart enabled).
- [x] **HUB-BRG-08**: Bridge container health is monitored continuously and visible in the UI (go2rtc `/api/streams` + container status, last health-check timestamp).

### Output Types (HUB-OUT-*)

- [ ] **HUB-OUT-01**: Each Protect cam can independently activate one or more outputs (Loxone-MJPEG, Frigate-RTSP). Outputs are toggleable from the cam detail page.
- [ ] **HUB-OUT-02**: Loxone-MJPEG output transcodes the source via VAAPI to 640×360 @ 10 fps (per the meintechblog 2025-11-07 recipe) and exposes `http://<bridge-ip>:1984/api/stream.mjpeg?src=<cam-slug>-low`.
- [ ] **HUB-OUT-03**: Frigate-RTSP output is H.264 copy-passthrough (`-c:v copy -an`, no audio) and exposes `rtsp://<bridge-ip>:8554/<cam-slug>-high`.
- [ ] **HUB-OUT-04**: VAAPI transcode concurrency is capped (soft 4, hard 6) for Loxone-MJPEG outputs; Frigate-RTSP outputs incur zero VAAPI cost.
- [ ] **HUB-OUT-05**: First-party UniFi cams default to Loxone-MJPEG enabled at onboarding; third-party adopted cams default OFF (opt-in) — Mobotix S15 with native MJPEG can be left unchanged.
- [ ] **HUB-OUT-06**: Stream URLs are stable across cam-name edits in Protect — slug is derived from MAC, not display name.
- [ ] **HUB-OUT-07**: Each output URL has a one-click copy button + a per-target hint (Loxone "Benutzerdefinierte Intercom" snippet, Frigate `cameras:` config snippet).

### Reconciliation Loop (HUB-RCN-*)

- [ ] **HUB-RCN-01**: Auto-reconciliation runs every 5 minutes when `settings.protect_hub_enabled = true`; tick is silent when disabled.
- [ ] **HUB-RCN-02**: Force-reconcile is triggered automatically on every output toggle in UI (in-process Promise; user sees results within seconds, not minutes).
- [ ] **HUB-RCN-03**: Manual "Sync now" button on the settings page triggers a force-reconcile and shows the resulting event log.
- [ ] **HUB-RCN-04**: Reconciliation re-extracts Protect Share-Livestream URLs from `bootstrap` every pass — URLs are never cached across reconciles (UDM reboots rotate the share tokens).
- [ ] **HUB-RCN-05**: Reconciliation uses canonical-form sha256 hash of the rendered YAML for deploy diff; identical YAML produces a no-op (no SSH push, no go2rtc reload).
- [ ] **HUB-RCN-06**: Reconciliation is single-flight: concurrent triggers serialize via a mutex; if a trigger arrives while a reconcile is mid-flight, a dirty-flag retry is scheduled.
- [ ] **HUB-RCN-07**: WebSocket connection to Protect uses exponential backoff (5 s → 5 min cap) on disconnect, with a single-flight reconnect and a full bootstrap fetch on reconnect.
- [ ] **HUB-RCN-08**: New Protect cam appearing → auto-added to catalog; outputs default-ON for first-party, default-OFF for third-party. User is notified (event log + optional toast).
- [ ] **HUB-RCN-09**: Removed Protect cam → soft-deleted (`cameras.source = 'external_archived'`); 7-day grace before pruning; re-add path restores the original row.
- [ ] **HUB-RCN-10**: Self-update (v1.1 feature) returns HTTP 409 if `reconciler.busy = true`; reconciler writes YAML via `tmp+rename` so a mid-deploy crash never leaves a half-written file.

### Onboarding Wizard (HUB-WIZ-*)

- [x] **HUB-WIZ-01**: Settings page shows a "Protect Hub" tab with the feature toggle (default OFF) as the entry point.
- [x] **HUB-WIZ-02**: Activating the toggle (when bridge does not yet exist) navigates to a dedicated wizard route `/settings/protect-hub/onboarding` — not a modal.
- [x] **HUB-WIZ-03**: Wizard Step 1 verifies the Protect connection using existing credentials; missing creds deep-link to the UniFi settings tab.
- [x] **HUB-WIZ-04**: Wizard Step 2 provisions the Bridge LXC (long-running 30–90 s) with progress events streamed to the UI; provision failure leaves the bridge row in `status='failed'` and is retryable from the wizard.
- [ ] **HUB-WIZ-05**: Wizard Step 3 fetches Protect cams and populates the stream catalog; preview shows discovered cams grouped by `kind`.
- [ ] **HUB-WIZ-06**: Wizard Step 4 lets the user pick which cams join the Hub: first-party cams checkboxes pre-checked with default output type pre-selected; third-party cams checkboxes unchecked with copy "Already producing MJPEG natively? Leave off."
- [ ] **HUB-WIZ-07**: Wizard Step 5 runs the first reconcile, deploys the initial YAML, and waits for go2rtc to come up healthy on `:1984`.
- [ ] **HUB-WIZ-08**: Wizard Step 6 redirects to `/cameras` with a confirmation toast; new external cams are visible inline with "Protect Hub" badges.
- [ ] **HUB-WIZ-09**: Wizard is resumable: if interrupted (browser closed, app restarted, network blip), re-entering the wizard picks up from the last completed step using the `hub_onboarding_state` step-pointer table.
- [ ] **HUB-WIZ-10**: `settings.protect_hub_enabled` becomes `true` only after Step 6 completes successfully — no half-enabled state where the toggle is on but the catalog/bridge aren't ready.

### `/cameras` UI Integration (HUB-UI-*)

- [ ] **HUB-UI-01**: External Protect cams appear inline in the existing `/cameras` list (one merged sorted array from the existing status endpoint).
- [ ] **HUB-UI-02**: External cam cards show a primary "Protect Hub" badge plus a secondary first-party / third-party qualifier badge.
- [ ] **HUB-UI-03**: External cam detail page shows: read-only native Protect stream catalog (Low/Medium/High with codec/resolution/fps), active Bridge outputs with toggles, copy-buttons per URL, snapshot preview.
- [ ] **HUB-UI-04**: External cam detail page hides cam-edit and cam-delete buttons (the cam belongs to Protect, not the app).
- [ ] **HUB-UI-05**: External cam action menu replaces "delete container" with "remove from Hub" (clarity about ownership).
- [ ] **HUB-UI-06**: A `ProtectHubGuide` component shows Loxone "Benutzerdefinierte Intercom" copy-paste snippet + Frigate `cameras:` config copy-paste snippet, both pre-filled with the user's actual URLs.
- [ ] **HUB-UI-07**: An "All Hub URLs" page lists every active output URL across all cams in one copy-friendly view (for users provisioning Loxone/Frigate in bulk).
- [ ] **HUB-UI-08**: Settings page Protect Hub tab shows: Hub status, last reconcile timestamp, container status badge, drift indicator, "Sync now" button, and the last 50 reconcile events.

### Offboarding (HUB-OFF-*)

- [ ] **HUB-OFF-01**: Deactivating the Protect Hub toggle opens a 3-tier confirm dialog explaining the consequences and offering Pause / Disable+Keep / Full Uninstall.
- [ ] **HUB-OFF-02**: Tier A — Pause: stops the reconciler tick but keeps everything else; recoverable instantly by re-enabling the toggle.
- [ ] **HUB-OFF-03**: Tier B (default) — Disable + Keep LXC: stops the Bridge container, soft-deletes external cam rows (`source='external_archived'`), keeps history; re-enable is fast-path (start container, flip rows back).
- [ ] **HUB-OFF-04**: Tier C — Full Uninstall: requires `type DELETE to confirm`; destroys the LXC, purges archived cam rows after the grace window, optionally cleans up Protect-side RTSP-share toggles.
- [ ] **HUB-OFF-05**: Tier C confirm dialog shows consequence preview: which Loxone consumers will lose stream, which Frigate streams go offline, how many archived cam rows will be purged.
- [ ] **HUB-OFF-06**: Protect-side RTSP-share cleanup is an opt-in sub-toggle (default OFF); the cleanup only touches channels we ourselves enabled (tracked via `share_enabled_by_us` flag in `protect_rtsp_actions` log) — never touches user-managed share toggles.
- [ ] **HUB-OFF-07**: Offboarding cleanup is idempotent: kill SSH mid-step → restart app → "Force cleanup" admin action completes the remaining steps.
- [ ] **HUB-OFF-08**: Pre-uninstall: "Export Hub config" button generates a JSON file of `cam → output → URL` mapping for backup before destructive actions.

### Operations & Monitoring (HUB-OPS-*)

- [ ] **HUB-OPS-01**: Settings Protect Hub tab shows live operational status: bridge container state, container IP, active stream count, last successful reconcile timestamp, last YAML hash.
- [ ] **HUB-OPS-02**: Reconcile event log surfaces the last 50 events (timestamp, type — `discover`/`reconcile`/`deploy`/`reload`/`error`, success/failure, deploy-or-noop, reconcile-id).
- [ ] **HUB-OPS-03**: Drift indicator visible when the deployed YAML's hash differs from the app's expected hash (warn the user, surface a "Re-deploy" action — don't silently auto-overwrite).
- [ ] **HUB-OPS-04**: Per-stream metrics card on cam detail page (optional, when Hub is enabled): bitrate, framerate, ffmpeg uptime — pulled from go2rtc `/api/streams`.
- [ ] **HUB-OPS-05**: Bridge container health probe extends the existing `healthCheckInterval` in `scheduler.ts` (one extra fetch to bridge:1984 per tick); failures are surfaced as events and trigger a UI warning.

---

## Future Requirements (Deferred to v1.4+)

- Multi-bridge support (one bridge per cam-group / per VAAPI host) — schema leaves the door open via `cameras.hubBridgeId`, code path is single-bridge only in v1.3.
- Per-channel `enableRtsp` granularity (today the `unifi-protect` lib flips all channels at once).
- Additional output types: HomeAssistant, Scrypted, generic webhook.
- Profile system (named profiles like "Loxone-Default", "Frigate-Recording") — only justified at ≥5 output types.
- Output-stream auth (LAN-trust-boundary is the v1.3 posture; v1.4+ if requested).
- Webhook/event bus for stream lifecycle events.
- Real Drizzle migration system (replaces v1.1 schema-hash stopgap).

## Out of Scope (Explicit Exclusions)

- **Multi-Protect / multi-site:** v1.3 is one Protect controller per app instance.
- **Protect cams that the app provisions itself:** v1.3 only re-distributes cams already adopted in Protect by the user; the existing v1.0 onboarding path covers cams managed BY the app.
- **`unifi-cam-proxy` style adoption:** that solves the opposite direction (cams INTO Protect) and is not in v1.3 scope.
- **Authentication on output streams:** LAN-trust posture for v1.3, documented in wizard + README.
- **Loxone "Motion Shape Extreme" hardware integration:** that's Loxone's own outdoor cam product; v1.3 integrates with Loxone's "Benutzerdefinierte Intercom" component, which is the correct target for external MJPEG streams (correction surfaced by stack research).
- **Embedding go2rtc as a Node child process:** go2rtc lives in the Bridge LXC, deployed via SSH — not in the app process.
- **Profile system / named output bundles:** only justified at ≥5 output types; v1.3 ships flat per-cam toggles.

---

## Traceability

Maps each REQ-ID to the phase that delivers it. Filled by roadmapper on 2026-04-30.

**Coverage:** 62 / 62 (100% mapped, no orphans, no duplicates)
**Distribution:** P19=7, P20=11, P21=18, P22=14, P23=12

| REQ-ID | Phase | Category |
|--------|-------|----------|
| HUB-CAT-01 | Phase 19 | Catalog & Discovery |
| HUB-CAT-02 | Phase 19 | Catalog & Discovery |
| HUB-CAT-03 | Phase 19 | Catalog & Discovery |
| HUB-CAT-04 | Phase 19 | Catalog & Discovery |
| HUB-CAT-05 | Phase 19 | Catalog & Discovery |
| HUB-CAT-06 | Phase 19 | Catalog & Discovery |
| HUB-WIZ-01 | Phase 19 | Onboarding Wizard (settings tab shell) |
| HUB-BRG-01 | Phase 20 | Bridge LXC Container |
| HUB-BRG-02 | Phase 20 | Bridge LXC Container |
| HUB-BRG-03 | Phase 20 | Bridge LXC Container |
| HUB-BRG-04 | Phase 20 | Bridge LXC Container |
| HUB-BRG-05 | Phase 20 | Bridge LXC Container |
| HUB-BRG-06 | Phase 20 | Bridge LXC Container |
| HUB-BRG-07 | Phase 20 | Bridge LXC Container |
| HUB-BRG-08 | Phase 20 | Bridge LXC Container |
| HUB-WIZ-02 | Phase 20 | Onboarding Wizard (Step 1 entry) |
| HUB-WIZ-03 | Phase 20 | Onboarding Wizard (Step 1 — Protect connection) |
| HUB-WIZ-04 | Phase 20 | Onboarding Wizard (Step 2 — bridge provision) |
| HUB-OUT-01 | Phase 21 | Output Types |
| HUB-OUT-02 | Phase 21 | Output Types |
| HUB-OUT-03 | Phase 21 | Output Types |
| HUB-OUT-04 | Phase 21 | Output Types |
| HUB-OUT-05 | Phase 21 | Output Types |
| HUB-OUT-06 | Phase 21 | Output Types |
| HUB-OUT-07 | Phase 21 | Output Types |
| HUB-RCN-01 | Phase 21 | Reconciliation Loop |
| HUB-RCN-02 | Phase 21 | Reconciliation Loop |
| HUB-RCN-03 | Phase 21 | Reconciliation Loop |
| HUB-RCN-04 | Phase 21 | Reconciliation Loop |
| HUB-RCN-05 | Phase 21 | Reconciliation Loop |
| HUB-RCN-06 | Phase 21 | Reconciliation Loop |
| HUB-RCN-07 | Phase 21 | Reconciliation Loop |
| HUB-RCN-08 | Phase 21 | Reconciliation Loop |
| HUB-RCN-09 | Phase 21 | Reconciliation Loop |
| HUB-RCN-10 | Phase 21 | Reconciliation Loop |
| HUB-OPS-05 | Phase 21 | Operations (bridge health probe) |
| HUB-WIZ-05 | Phase 22 | Onboarding Wizard (Step 3) |
| HUB-WIZ-06 | Phase 22 | Onboarding Wizard (Step 4) |
| HUB-WIZ-07 | Phase 22 | Onboarding Wizard (Step 5) |
| HUB-WIZ-08 | Phase 22 | Onboarding Wizard (Step 6) |
| HUB-WIZ-09 | Phase 22 | Onboarding Wizard (resumability) |
| HUB-WIZ-10 | Phase 22 | Onboarding Wizard (state-machine gate) |
| HUB-UI-01 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-02 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-03 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-04 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-05 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-06 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-07 | Phase 22 | `/cameras` UI Integration |
| HUB-UI-08 | Phase 22 | `/cameras` UI Integration |
| HUB-OFF-01 | Phase 23 | Offboarding |
| HUB-OFF-02 | Phase 23 | Offboarding |
| HUB-OFF-03 | Phase 23 | Offboarding |
| HUB-OFF-04 | Phase 23 | Offboarding |
| HUB-OFF-05 | Phase 23 | Offboarding |
| HUB-OFF-06 | Phase 23 | Offboarding |
| HUB-OFF-07 | Phase 23 | Offboarding |
| HUB-OFF-08 | Phase 23 | Offboarding |
| HUB-OPS-01 | Phase 23 | Operations & Monitoring |
| HUB-OPS-02 | Phase 23 | Operations & Monitoring |
| HUB-OPS-03 | Phase 23 | Operations & Monitoring |
| HUB-OPS-04 | Phase 23 | Operations & Monitoring |

### Phase-Wise Summary

**Phase 19 — Data Model + Protect Catalog (Read-Only)** [7 reqs]
HUB-CAT-01, HUB-CAT-02, HUB-CAT-03, HUB-CAT-04, HUB-CAT-05, HUB-CAT-06, HUB-WIZ-01

**Phase 20 — Bridge LXC Provisioning + Hello-World YAML** [11 reqs]
HUB-BRG-01, HUB-BRG-02, HUB-BRG-03, HUB-BRG-04, HUB-BRG-05, HUB-BRG-06, HUB-BRG-07, HUB-BRG-08, HUB-WIZ-02, HUB-WIZ-03, HUB-WIZ-04

**Phase 21 — Multi-Cam YAML + Reconciliation Loop** [18 reqs]
HUB-OUT-01, HUB-OUT-02, HUB-OUT-03, HUB-OUT-04, HUB-OUT-05, HUB-OUT-06, HUB-OUT-07, HUB-RCN-01, HUB-RCN-02, HUB-RCN-03, HUB-RCN-04, HUB-RCN-05, HUB-RCN-06, HUB-RCN-07, HUB-RCN-08, HUB-RCN-09, HUB-RCN-10, HUB-OPS-05

**Phase 22 — Onboarding Wizard + `/cameras` Integration** [14 reqs]
HUB-WIZ-05, HUB-WIZ-06, HUB-WIZ-07, HUB-WIZ-08, HUB-WIZ-09, HUB-WIZ-10, HUB-UI-01, HUB-UI-02, HUB-UI-03, HUB-UI-04, HUB-UI-05, HUB-UI-06, HUB-UI-07, HUB-UI-08

**Phase 23 — Offboarding + Lifecycle Polish + Stream-Sharing API** [12 reqs]
HUB-OFF-01, HUB-OFF-02, HUB-OFF-03, HUB-OFF-04, HUB-OFF-05, HUB-OFF-06, HUB-OFF-07, HUB-OFF-08, HUB-OPS-01, HUB-OPS-02, HUB-OPS-03, HUB-OPS-04
