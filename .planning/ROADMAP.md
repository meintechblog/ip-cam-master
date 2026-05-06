# Roadmap: IP-Cam-Master

## Completed Milestones

- **v1.0** — One-click camera onboarding for Mobotix/Loxone into UniFi Protect (5 phases, 11 plans) — [Archive](milestones/v1.0-ROADMAP.md)
- **v1.1** — Self-Maintenance & Polish: in-UI updates, backups, logs, health (4 phases, 5 plans) — [Archive](milestones/v1.1-ROADMAP.md)
- **v1.2** — Bambu Lab Camera Integration (H2C + A1): Phases 10–18, 6+ plans, code-complete 2026-04-20 (UAT pending). Phase 16 (Deploy Flow) and Phase 17 (RTSP Auth) shipped alongside. See [v1.2 phase archive](#v12-phase-archive) below.

## Current Milestone

**v1.3 — Protect Stream Hub (Loxone + Frigate-ready)**

UniFi Protect Kameras pro Cam in allen verfügbaren Stream-Qualitäten katalogisieren und über einen einzigen LXC-Bridge-Container in den jeweils passenden Output-Formaten bereitstellen — primär Loxone-MJPEG (640×360 @ 10fps, "Benutzerdefinierte Intercom") und native RTSP-Passthrough (high-quality H.264 copy) für Frigate, NVRs und andere Tools. Voller Lifecycle: Onboarding-Wizard → Auto-Reconciliation → Tiered Offboarding.

Phase numbering continues from v1.2 (last phase was 18). v1.3 starts at Phase 19.

**Locked decisions (research-driven, do not re-derive):**
- Single Bridge-LXC (no per-cam container) hosting n streams via one `go2rtc.yaml`
- MAC-as-PK for `cameras.source='external'` rows (irreversible after P19 commit)
- Two new npm deps: `unifi-protect@^4.29.0` + `yaml@^2.6.0`
- Reuse existing primitives: `proxmox.ts`, `ssh.ts`, `scheduler.ts`, `protect.ts`, the LXC template — no new top-level frameworks
- 5 phases (P19–P23) per `.planning/research/v1.3/SUMMARY.md` §"Phase Decomposition"

## Phases

- [x] **Phase 19: Data Model + Protect Catalog (Read-Only)** — Schema lock (MAC-as-PK), Protect bootstrap fetch, first-party/third-party classification, read-only stream catalog UI; settings tab shell. No bridge, no reconcile, no outputs. Ships demoable value alone (7 reqs). (completed 2026-05-02)
- [x] **Phase 20: Bridge LXC Provisioning + Hello-World YAML** — Provision the single shared bridge LXC from existing template, deploy a hardcoded go2rtc.yaml, bind go2rtc API to localhost, expose `:1984` + `:8554`. Wizard Steps 1–2. Ships demoable value alone (11 reqs). (completed 2026-05-06; 3 source bugs found+fixed during live UAT — restart-after-config-push, cores override, onboot default)
- [x] **Phase 21: Multi-Cam YAML + Reconciliation Loop** — Heart of the milestone. yaml-builder for Loxone-MJPEG (VAAPI transcode) + Frigate-RTSP (copy passthrough); reconcile with canonical-form sha256 dedupe, single-flight + dirty-flag retry; WS exp backoff; bridge health probe (18 reqs).
- [ ] **Phase 22: Onboarding Wizard + `/cameras` Integration** — Wizard Steps 3–6 (resumable via `hub_onboarding_state`), `/cameras` partition (managed/external), Protect Hub badge + first/third-party qualifier, Outputs subsection with copy-buttons + per-target snippets, "All Hub URLs" page (14 reqs).
- [ ] **Phase 23: Offboarding + Lifecycle Polish + Stream-Sharing API** — 3-tier offboarding (Pause / Disable+Keep / Full Uninstall), idempotent cleanup, soft-delete with 7-day grace, Protect RTSP-share cleanup gated by `share_enabled_by_us`, drift indicator, reconcile event log, per-stream metrics, "Export Hub config" pre-uninstall (12 reqs).
- [x] **Phase 24: Auto-Update Parity** — Bring self-update to charging-master parity (parallel-track maintenance, precedent: P16). Adds auto-update toggle + configurable hour (Europe/Berlin), background scheduler (6h GitHub check + 5min auto-update tick), ETag caching, 9-stage pipeline stepper UI, reconnect overlay polling `/api/version`, install confirmation modal, two-stage rollback (git + tarball snapshot), 23h auto-update minimum spacing, atomic `state.json` cross-process, dedicated `update_runs` table. (completed 2026-05-05)

## Phase Details

### Phase 19: Data Model + Protect Catalog (Read-Only)
**Goal**: User can enable a Protect Hub settings tab, see all UniFi Protect cams discovered from their UDM with manufacturer/model/MAC and per-channel codec/resolution/fps/bitrate, and observe automatic first-party vs third-party classification — without any bridge container yet existing
**Depends on**: Nothing (first phase of v1.3); v1.2 must be code-complete (already true as of 2026-04-20)
**Requirements**: HUB-CAT-01, HUB-CAT-02, HUB-CAT-03, HUB-CAT-04, HUB-CAT-05, HUB-CAT-06, HUB-WIZ-01 (7 reqs)
**Success Criteria** (what must be TRUE):
  1. User sees a new "Protect Hub" tab on `/settings` with a feature toggle (default OFF) and a status panel; activating discovery from this tab populates the SQLite catalog (`cameras.source='external'` rows + `protect_stream_catalog` rows) with their actual UDM cams
  2. User can verify in the catalog UI that every Protect cam shows manufacturer, model, MAC (lowercased, no separators), and the full set of native stream qualities the cam exposes — including a single-channel cam rendering correctly with no hardcoded 3-channel placeholders (HUB-CAT-06)
  3. User sees each cam labeled `first-party` (UniFi/UVC, derived via `manufacturer matches /Ubiquiti|UniFi|UVC/i` OR `bootstrap.cameras[].type` starts with `UVC`) or `third-party` (Mobotix-via-adoption, Hikvision, etc.) with the classification badge visible in the catalog table
  4. The schema is locked with `cameras.mac NOT NULL` for `source='external'` rows and `cameras.externalId` treated as a denormalized cache field — never used as a join key (verifiable via DB inspection: `SELECT mac, external_id FROM cameras WHERE source='external'` returns rows where MAC is the stable identifier)
  5. The catalog survives a brief UDM unreachability: when the controller is offline, the UI still renders the cached catalog from SQLite and surfaces a "controller unreachable" banner instead of breaking
  6. A research spike artifact is committed at `.planning/research/v1.3/spikes/p19-tls-rtspx.md` documenting the result of `ffprobe rtspx://192.168.3.1:7441/<alias>` from a throwaway LXC, confirming the TLS scheme choice (rtspx:// vs tls_verify=0) before any reconciler code in P21 depends on it
  7. The two new npm deps (`unifi-protect@^4.29.0` and `yaml@^2.6.0`) are installed and pinned in `package.json` with no version-bumps to existing dependencies
**Plans**: 4 plans (in 3 waves)
Plans:
- [x] 19-01-PLAN.md — TLS spike against UDM 192.168.3.1 (ffprobe from local LAN host as pragmatic deviation; locked TLS_SCHEME='rtsps-tls-verify-0'; rtspx:// confirmed unsupported by ffmpeg)
- [x] 19-02-PLAN.md — Schema lock (cameras +7 columns; +3 new tables: protect_hub_bridges, camera_outputs, protect_stream_catalog) + install unifi-protect@^4.29.0 + yaml@^2.6.0
- [x] 19-03-PLAN.md — protect-bridge.ts (lib boundary, classifyKind via isThirdPartyCamera, TLS_SCHEME const) + orchestration/protect-hub/catalog.ts (discover + loadCatalog) + /api/protect-hub/discover endpoint + Vitest suites
- [x] 19-04-PLAN.md — ProtectHubTab.svelte (auto-discover on empty cache, manual refresh, controller-unreachable banner, no-creds deep-link) + 7th settings tab + saveSetting() resets lib client on unifi_ keys + manual UAT against real UDM
**Research flags**:
  - TLS spike against actual UDM 192.168.3.1: `rtspx://` vs `tls_verify=0` (PITFALLS #8) — OWNED BY PLAN 19-01
  - `mac` field reliability for first-party AND third-party cams (PITFALLS #2) — OWNED BY PLAN 19-03 fixtures + UAT
  - `bootstrap.cameras[].type` discriminator for first-party detection — RESOLVED: amended D-CLASS-01 uses `isThirdPartyCamera` boolean instead (verified against protect-types.ts:788)
**UI hint**: yes

### Phase 20: Bridge LXC Provisioning + Hello-World YAML
**Goal**: User can click "Bridge bereitstellen" in the Protect Hub tab, watch a single shared LXC container get provisioned from the existing Debian 13 + VAAPI template (30–90 s), and verify that go2rtc inside it serves a hardcoded test stream on `:1984` (MJPEG) and `:8554` (RTSP) — without any per-cam outputs yet, but with the security surface fully locked down
**Depends on**: Phase 19 (schema for `protect_hub_bridges`, settings tab shell, classification logic)
**Requirements**: HUB-BRG-01, HUB-BRG-02, HUB-BRG-03, HUB-BRG-04, HUB-BRG-05, HUB-BRG-06, HUB-BRG-07, HUB-BRG-08, HUB-WIZ-02, HUB-WIZ-03, HUB-WIZ-04 (11 reqs)
**Success Criteria** (what must be TRUE):
  1. Activating the Hub toggle (when no bridge row exists) navigates to `/settings/protect-hub/onboarding` and runs Wizard Step 1 (reuses existing v1.0 Protect connection) and Step 2 (calls `bridge-provision.ts` to allocate next free VMID, run `createContainer()` with bridge profile — 1–2 GB RAM, 2–4 cores, `/dev/dri` passthrough, `nofile=4096`, static IP via DHCP reservation, autostart on host reboot enabled)
  2. After provision completes, `pct config <vmid>` on the Proxmox host shows the LXC was created from the SAME existing template used for Mobotix/Loxone/Bambu cams — no new template work — with the bridge-specific resource sizing applied
  3. The deployed `/etc/go2rtc/go2rtc.yaml` on the bridge contains `api: { listen: "0.0.0.0:1984", ui_editor: false }` (L-9 amended per D-API-BIND-01: MJPEG streams live under the API HTTP server, so localhost-only would block Loxone access; editor disabled is the security surface) — verifiable: from another LAN host, `curl http://<bridge-ip>:1984/editor.html` returns 404, while `curl http://<bridge-ip>:1984/api/streams` (API root) returns the streams JSON, and `:8554/<test-stream>` plays via `ffprobe`
  4. The deployed YAML carries the idempotency stamp `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>` as the first comment block, ready for canonical-hash drift detection in P21
  5. Bridge container survives a Proxmox host reboot (autostart=1) and resumes serving on the same static IP — verifiable by rebooting the test host and observing the bridge IP unchanged + go2rtc back online within 60 s
  6. From the Protect Hub settings tab, user can click Start / Stop / Restart and observe the container state reflect within 10 s; container health probe is wired into the existing `healthCheckInterval` in `scheduler.ts` (one extra `fetch(http://<bridge-ip>:1984/api/streams)` per tick) and surfaces "last health check" timestamp in the UI
  7. Provision failure (Proxmox storage full, network blip, SSH timeout) leaves `protect_hub_bridges.status='failed'` and is retryable from the wizard — re-running the step is idempotent (does NOT create a duplicate VMID)
  8. The wizard documents the LAN-trust-boundary explicitly in Step 2's info panel and the README: "Bridge endpoints are unauthenticated by design; ensure the LXC is on a trusted LAN segment"
**Plans**: 3 plans (in 3 waves)
Plans:
- [x] 20-01-PLAN.md — Bridge provisioning backend: bridge-provision.ts + bridge-lifecycle.ts + generateBridgeConfig() + 5 API endpoints + Vitest suites
- [x] 20-02-PLAN.md — Wizard route /settings/protect-hub/onboarding (Steps 1-2) + ProtectHubTab bridge controls + scheduler health probe
- [x] 20-03-PLAN.md — UAT against real Proxmox: provision bridge, verify SC-1..8, state sync (closed 2026-05-06; 3 bugs fixed mid-UAT, 11/11 verified)
**Amended decisions**:
  - L-9 amended to `api.listen: "0.0.0.0:1984"` + `ui_editor: false` (D-API-BIND-01) — MJPEG streams live under API HTTP, localhost-only would block Loxone
  - Bridge sizing: 1024 MB / 2 cores for P20; P21 may bump to 2048 MB
  - DHCP with reservation recommendation (D-PROV-03); static IP not required in wizard
**UI hint**: yes

### Phase 21: Multi-Cam YAML + Reconciliation Loop
**Goal**: User can INSERT into `camera_outputs` (manually for now, via SQL or a dev API) and within ≤5 minutes (or instantly via force-reconcile) the bridge's go2rtc.yaml is rewritten with the right ffmpeg blocks for each enabled output, deployed atomically via SSH `tmp+rename`, and go2rtc reloads cleanly — Loxone-MJPEG outputs play in VLC at 640×360 @ 10 fps, Frigate-RTSP outputs play with original H.264 codec untouched
**Depends on**: Phase 19 (schema), Phase 20 (bridge LXC running)
**Requirements**: HUB-OUT-01, HUB-OUT-02, HUB-OUT-03, HUB-OUT-04, HUB-OUT-05, HUB-OUT-06, HUB-OUT-07, HUB-RCN-01, HUB-RCN-02, HUB-RCN-03, HUB-RCN-04, HUB-RCN-05, HUB-RCN-06, HUB-RCN-07, HUB-RCN-08, HUB-RCN-09, HUB-RCN-10, HUB-OPS-05 (18 reqs)
**Success Criteria** (what must be TRUE):
  1. With one Loxone-MJPEG and one Frigate-RTSP output enabled on a real Protect cam: VLC plays `http://<bridge>:1984/api/stream.mjpeg?src=<mac-slug>-low` showing transcoded 640×360 @ 10 fps with `-an` (no audio) confirmed by `ffprobe`, AND VLC plays `rtsp://<bridge>:8554/<mac-slug>-high` showing the original Protect codec/resolution untouched (verified via `ffprobe -show_streams`: copy-passthrough, no re-encode)
  2. Reconcile runs every 5 minutes when `settings.protect_hub_enabled=true` (silent tick when disabled), AND every output toggle in UI triggers an in-process force-reconcile so the user sees results within seconds; toggling an output OFF removes its YAML block within one cycle
  3. A no-op reconcile (DB state unchanged) does NOT redeploy: verifiable by toggling nothing and observing zero SSH push events for 30 minutes — the canonical-form sha256 of the rendered YAML matches `protect_hub_bridges.last_deployed_yaml_hash` and a `# managed by ip-cam-master` stamp check passes; reconcile cycle <2 s on the mtime fast-path when YAML unchanged
  4. Two simultaneous reconcile triggers (timer + user toggle within the same 100 ms) execute sequentially via the module-scoped single-flight Promise; if a third trigger arrives mid-flight, a dirty-flag schedules exactly one follow-up reconcile after the in-flight pass completes — verifiable from the reconcile event log
  5. Protect Share-Livestream URLs are re-extracted from `protect.bootstrap.cameras[]` on EVERY reconcile pass — never cached across reconciles. Simulated UDM reboot (mock fixture rotating tokens) results in fresh URLs in the next deployed YAML; Loxone tiles auto-recover within 5 minutes without user intervention
  6. WebSocket connection to Protect uses exponential backoff (5 s → 5 min cap) on disconnect with single-flight reconnect — verifiable: 60 seconds of simulated UDM unreachability triggers ≤5 reconnect attempts (NOT hundreds), and on reconnect a full bootstrap fetch + force-reconcile runs once
  7. New Protect cam appearing in bootstrap → auto-added to `cameras` table with `kind`-based default outputs (first-party: Loxone-MJPEG ON; third-party: all OFF), notified in the reconcile event log; removed Protect cam → soft-deleted (`source='external_archived'`), 7-day grace before purge, re-add path restores the row with original toggles intact
  8. VAAPI concurrency cap enforced: trying to enable a 5th Loxone-MJPEG output while 4 are active surfaces a soft warning in the UI; trying to enable a 7th is hard-blocked with a clear error message. Frigate-RTSP outputs (passthrough) are uncounted because they incur zero VAAPI cost
  9. Stream slugs are derived from MAC, not display name: renaming a cam in Protect updates the displayed name in the UI but the slug (`<mac-slug>-<output-suffix>`) and resulting URLs remain identical — verifiable by editing a cam name in Protect and observing the next reconcile produces a YAML with unchanged stream keys
  10. Self-update (v1.1 feature) returns HTTP 409 if `reconciler.busy=true`; YAML deploy uses `tmp+rename` atomic write, so a SIGTERM mid-deploy leaves the existing YAML intact (no half-written file); SIGTERM grace 30 s lets in-flight reconciles complete
  11. Bridge container health probe extends the existing `healthCheckInterval` in `scheduler.ts` (one extra fetch to bridge:1984 per tick); a sustained failure (>2 min producers=0 on a stream that should be live) emits an event and triggers a UI warning banner
**Plans**: 6 plans (in 5 waves)
Plans:
- [ ] 21-01-PLAN.md — Wave 0: protect_hub_reconcile_runs schema + 6 test stubs + [BLOCKING] drizzle-kit push
- [ ] 21-02-PLAN.md — Wave 1: yaml-builder.ts (pure D-PIPE-02/04 emission + canonicalHash) + 4 golden YAML fixtures + token-redaction security test
- [ ] 21-03-PLAN.md — Wave 2: reconcile.ts (single-flight + 4-pass orchestration + atomic tmp+rename SSH push + auto-add/soft-delete writeback) + ~14 behavioural tests
- [ ] 21-04-PLAN.md — Wave 2: ws-manager.ts (exp-backoff [5,10,30,60,120,300]s, single-flight, force-reconcile on success) + fake-timer tests
- [ ] 21-05-PLAN.md — Wave 3: 3 API routes (POST /reconcile 202, GET /reconcile-runs, PUT /cameras/[id]/outputs with VAAPI cap) + ~12 tests
- [ ] 21-06-PLAN.md — Wave 4: scheduler 5min tick + 2-strike health probe + update-checker busy-gate + 30s SIGTERM grace + live UAT against vmid 2014
**Research flags**:
  - go2rtc reconnect-after-source-disconnect empirical test (PITFALLS #14): does go2rtc auto-redial when the upstream Protect cam reboots, or does it hold a dead consumer connection? — DEFERRED to Plan 21-06 live UAT; backend mitigation already in via D-PIPE-05 reconnect flags + D-CAP-03 health probe
  - Canonical YAML form choice (PITFALLS #5): exact `yaml.stringify()` options to guarantee byte-identical output for byte-identical input — RESOLVED: `yaml@2.6.stringify({sortMapEntries: true})` with stamp-strip canonicalization (Pattern 2 in 21-RESEARCH.md); locked in Plan 21-02

### Phase 22: Onboarding Wizard + `/cameras` Integration
**Goal**: A non-developer user can enable the Protect Hub feature via the settings toggle, complete a 6-step wizard end-to-end (resumable across browser closes and app restarts), and see their first-party UniFi cams streaming as Loxone-MJPEG outputs in `/cameras` — inline with their existing managed Mobotix/Loxone/Bambu cams, marked with a "Protect Hub" badge plus a first-party/third-party qualifier — within 5 minutes of clicking the toggle
**Depends on**: Phase 21 (reconciler must be live before the wizard's Step 5 first-reconcile can complete)
**Requirements**: HUB-WIZ-05, HUB-WIZ-06, HUB-WIZ-07, HUB-WIZ-08, HUB-WIZ-09, HUB-WIZ-10, HUB-UI-01, HUB-UI-02, HUB-UI-03, HUB-UI-04, HUB-UI-05, HUB-UI-06, HUB-UI-07, HUB-UI-08 (14 reqs)
**Success Criteria** (what must be TRUE):
  1. User completes the 6-step wizard end-to-end: Step 3 fetches Protect cams + populates the catalog (preview shows discovered cams grouped by `kind`), Step 4 lets user pick cams (first-party checkboxes pre-checked with default output type pre-selected; third-party unchecked with copy "Already producing MJPEG natively? Leave off."), Step 5 runs the first reconcile and waits for go2rtc healthy on `:1984`, Step 6 redirects to `/cameras` with a confirmation toast — all within ~3 minutes for 4 cams
  2. The wizard is resumable: killing the SvelteKit process during Step 5 (via SIGTERM), restarting the app, and re-opening the wizard route picks up at Step 5 (NOT from scratch) using the `hub_onboarding_state` step-pointer table; user completes the remaining steps without manual DB cleanup
  3. `settings.protect_hub_enabled` flips to `true` ONLY after Step 6 completes successfully — there is no half-enabled state where the toggle reads ON but the catalog or bridge isn't ready (verifiable: aborting the wizard at Step 4 leaves the toggle OFF and `/cameras` shows zero external rows)
  4. Toggle flapping is prevented: while `hub_state` is `starting` or `stopping`, the settings toggle is greyed-out with a non-cancellable spinner; an explicit "Abort" button (separate from the toggle) is the only way to cancel an in-flight transition
  5. `/cameras` shows a single merged sorted array of managed + external cams from the existing `/api/cameras/status` endpoint (no parallel endpoint); external cams render with a primary "Protect Hub" badge plus a secondary first-party (UniFi glyph) or third-party (manufacturer pill, e.g. "Mobotix S15") qualifier badge
  6. External cam detail page shows: read-only native Protect stream catalog (Low/Medium/High with codec/resolution/fps), active Bridge outputs section with toggles (Loxone-MJPEG, Frigate-RTSP) and per-URL copy buttons, snapshot preview pulled from go2rtc `frame.jpeg?src=<slug>` — AND hides cam-edit + cam-delete buttons (the cam belongs to Protect, not the app); the action menu replaces "delete container" with "remove from Hub"
  7. Each output URL has a one-click copy button + a per-target snippet via the new `ProtectHubGuide.svelte` component: pre-filled Loxone "Benutzerdefinierte Intercom" copy-paste config block AND pre-filled Frigate `cameras:` config block, both using the user's actual bridge IP and slug
  8. A new `/settings/protect-hub/all-urls` page (or equivalent route) lists every active output URL across all cams in one copy-friendly view (cam name + slug + URL + per-output copy button), grouped by output type
  9. Settings Protect Hub tab shows: Hub status (state machine label), last reconcile timestamp, container status badge, drift indicator (only when foreign YAML stamp detected), "Sync now" button (force-reconcile), and the last 50 reconcile events from the event log
**Plans**: TBD
**UI hint**: yes

### Phase 23: Offboarding + Lifecycle Polish + Stream-Sharing API
**Goal**: User can cleanly tear down the Protect Hub via a 3-tier offboarding dialog (Pause / Disable+Keep / Full Uninstall) with explicit consequence preview and idempotent cleanup that survives a mid-step crash; Protect-side RTSP-share toggles are restored only for channels we ourselves enabled (never user-managed shares); operational polish surfaces drift, reconcile event log, and per-stream metrics for steady-state observability
**Depends on**: Phase 22 (cams must be live before they can be off-boarded)
**Requirements**: HUB-OFF-01, HUB-OFF-02, HUB-OFF-03, HUB-OFF-04, HUB-OFF-05, HUB-OFF-06, HUB-OFF-07, HUB-OFF-08, HUB-OPS-01, HUB-OPS-02, HUB-OPS-03, HUB-OPS-04 (12 reqs)
**Success Criteria** (what must be TRUE):
  1. Deactivating the Protect Hub toggle opens a 3-tier confirm dialog with concrete consequence preview ("4 Protect cams disappear from /cameras", "8 Loxone consumers lose stream — list URLs", "M Frigate streams go offline", "12 archived cam rows will be purged after 7 days") — and offers radio buttons for Tier A (Pause), Tier B (Disable+Keep, default), Tier C (Full Uninstall, requires `type DELETE to confirm`)
  2. Tier A — Pause: stops the reconciler tick (`settings.protect_hub_enabled=false`) but keeps bridge LXC running, cam rows live, outputs active; flipping the toggle back ON returns to the running state instantly with no provisioning
  3. Tier B — Disable + Keep LXC: stops the bridge container (`pct stop`), soft-deletes external cam rows via `cameras.source='external_archived'`, keeps history; re-enabling the toggle takes a fast-path (start container, flip rows back from `external_archived` to `external`, re-enable outputs they had) without re-running the wizard
  4. Tier C — Full Uninstall: after `type DELETE to confirm`, destroys the LXC via `bridge-lifecycle.ts destroyBridge()`, purges archived cam rows after the 7-day grace window expires, optionally cleans up Protect-side RTSP-share toggles (sub-toggle default OFF)
  5. Protect-side RTSP-share cleanup respects ownership: only channels with `share_enabled_by_us=true` in `protect_rtsp_actions` are touched; manually flipping a Protect channel ON outside the app, then offboarding with the cleanup sub-toggle ON, leaves that user-managed channel untouched (verifiable via Protect web UI inspection)
  6. Offboarding cleanup is idempotent: killing the app process mid-step (e.g., during SSH-stop-bridge) and restarting reaches a "Force cleanup" admin action button that completes the remaining steps — never leaving orphan Proxmox containers, half-deleted DB rows, or a `hub_state=stopping` deadlock
  7. Pre-uninstall: the dialog exposes an "Export Hub config" button that downloads a JSON file of `cam → output → URL` mapping (one-click backup before destructive action), reusing the v1.1 backup pattern
  8. Settings Protect Hub tab shows live operational status — bridge container state, container IP, active stream count, last successful reconcile timestamp, last YAML hash — and a drift indicator that visibly warns (orange banner + "Re-deploy" action button) when the deployed YAML's hash differs from the app's expected hash; drift NEVER auto-overwrites silently
  9. Reconcile event log surfaces the last 50 events with timestamp, type (`discover`/`reconcile`/`deploy`/`reload`/`error`), success/failure, deploy-or-noop, reconcile-id — viewable inline on the settings tab, sortable, filterable
  10. Per-stream metrics card on cam detail page (visible when Hub is enabled and the output is active) shows bitrate, framerate, ffmpeg uptime — pulled from go2rtc `/api/streams` `producers[]` data — with a graceful "metrics unavailable" fallback when the bridge is briefly unreachable
**Plans**: TBD
**Research flags**:
  - `unifi-protect.updateDevice` exact PATCH semantics for `isRtspEnabled=false` per channel (PITFALLS #6 / SUMMARY §"Research Flags"): is per-channel granularity supported in v4.29.0, or does it flip all channels?
**UI hint**: yes

### Phase 24: Auto-Update Parity
**Goal**: User can enable Auto-Update in `/settings → Version`, pick a daily hour in Europe/Berlin, and the app autonomously checks GitHub every 6 h, applies updates within the configured window (skipping if active onboarding/reconcile is running, with 23 h minimum spacing), shows a 9-stage visual pipeline stepper during manual or auto installs, recovers from disconnects via a reconnect overlay polling `/api/version`, and rolls back through git → tarball-snapshot if anything fails — all matching the charging-master `/settings` reference implementation
**Depends on**: Nothing in v1.3 (parallel-track maintenance, like P16). Builds on v1.1 update-runner (`scripts/update.sh`, `update-runner.ts`, `update-check.ts`, `update-history.ts`, `backup.ts`).
**Reference**: `/Users/hulki/codex/charging-master` — full feature, port one-for-one. See research notes in `.planning/phases/24-auto-update-parity/24-RESEARCH.md` after planning.
**Requirements** (new, not in REQUIREMENTS.md yet — to be added during plan-phase):
  - UPD-AUTO-01: Settings UI with auto-update enable/disable toggle and 0-23 hour dropdown (Europe/Berlin label)
  - UPD-AUTO-02: Background scheduler with 6 h GitHub check tick + 5 min auto-update opportunity tick, started from `hooks.server.ts`
  - UPD-AUTO-03: ETag-based GitHub commit polling (`If-None-Match` → 304 = no rate-limit hit), persisted across checks
  - UPD-AUTO-04: 9-stage pipeline stepper UI (preflight → snapshot → drain → stop → fetch → install → build → start → verify) parsed from log markers
  - UPD-AUTO-05: Reconnect overlay during install: polls `/api/version` every 2 s for SHA change + `dbHealthy=true`, 90 s timeout
  - UPD-AUTO-06: Install confirmation modal showing current → target SHA, commit message/author/date, warning if onboarding/reconcile in flight
  - UPD-AUTO-07: Two-stage rollback in `update.sh`: stage 1 = `git reset --hard PRE_SHA` + reinstall; stage 2 = tarball restore from pre-update snapshot
  - UPD-AUTO-08: 23 h minimum between auto-updates (read `update.lastAutoUpdateAt` from settings)
  - UPD-AUTO-09: Atomic `state.json` (`.update-state/state.json`, tmp+rename), shared between Node and bash via simple JSON
  - UPD-AUTO-10: Dedicated `update_runs` table (Drizzle schema): startAt, endAt, fromSha, toSha, status, stage, errorMessage, rollbackStage; replaces JSON blob in settings
  - UPD-AUTO-11: 5 min server-side cooldown for manual `POST /api/update/check`
  - UPD-AUTO-12: Localhost-only guard on `POST /api/update/run` and `POST /api/update/ack-rollback` (Host header)
  - UPD-AUTO-13: Generated `version.ts` (CURRENT_SHA, SHORT, BUILD_TIME) via prebuild step, replacing runtime `git describe`
**Success Criteria** (what must be TRUE):
  1. User opens `/settings → Version` and sees: current version card, last-checked card with "Jetzt prüfen" + cooldown, **new** Auto-Update card with toggle + hour dropdown (default OFF, hour=3), update history (last 10), and update-available banner with green pulsing dot when remote SHA ≠ current
  2. With Auto-Update enabled at hour=3, the app autonomously triggers an update at the next 3 AM Europe/Berlin if a newer commit exists on `origin/main` AND no Hub onboarding/reconcile is running AND the last auto-update was >23 h ago — verifiable in `update_runs` table with a row tagged auto-trigger
  3. During any install (manual or auto), the UI shows the 9-stage stepper with the active stage pulsing blue, completed stages green, failed stages red, rolled-back stages amber — driven by `[stage=<name>]` markers in the log SSE stream
  4. When systemd restarts the app mid-install (between `start` and `verify`), the UI shows a non-dismissable reconnect overlay polling `/api/version` every 2 s; once new SHA + `dbHealthy=true` arrive, overlay auto-closes and reveals success state
  5. Triggering install when an active flow exists (Protect Hub reconcile in flight per `protectHubReconcileInterval`, or wizard `hub_state IN ('starting','stopping')`) opens the install modal with a red warning bar listing the conflict — user must explicitly confirm to override
  6. Force a build failure (e.g., introduce a TypeScript error commit on `origin/main`): stage 1 rollback (`git reset --hard PRE_SHA` + reinstall + restart) succeeds, service comes back, history row marked `rolled_back` with `rollbackStage='stage1'`; corrupt the .git dir to force stage 1 fail: stage 2 (tar restore from `.update-state/snapshots/<SHA>.tar.gz`) succeeds, history row marked `rolled_back` with `rollbackStage='stage2'`
  7. After `npm run build` runs, `src/lib/version.ts` exists with `CURRENT_SHA`, `CURRENT_SHA_SHORT`, `BUILD_TIME` — the running app exposes these via `/api/version` without spawning `git`; deleting `.git` post-build does NOT break the version display
  8. GitHub rate-limit defense works: after the first `200 OK` check, the next check sends `If-None-Match: <etag>` → `304 Not Modified` consumes 0 from the unauthenticated 60-req/h budget (verifiable via `x-ratelimit-remaining` header in logs)
  9. State file `.update-state/state.json` survives concurrent reads from Node (status endpoint) and writes from the bash updater script (stage transitions): atomic `tmp + rename` is used in both Node and bash, no partial JSON ever observed
  10. Final step: deployed to running VM via `./scripts/dev-deploy.sh` and verified end-to-end against the live `ip-cam-master.local` instance (auto-update toggle persists across restart, manual install completes, history visible)
**Plans**: TBD — to be split during `/gsd:plan-phase 24`. Likely waves: (W1) DB schema + version-gen + state-store; (W2) GitHub client w/ ETag + scheduler + auto-update decision engine; (W3) update.sh two-stage rollback + snapshot + stage markers; (W4) UI (stepper, reconnect overlay, install modal, auto-update settings card) + API routes; (W5) deploy to VM + UAT.
**Research flags**:
  - GitHub API rate-limit budget on the unauthenticated path: 60 req/h shared across the VM. Confirm 6 h interval × 1 = 4 req/day fits comfortably, even with manual checks
  - `systemd-run` vs dedicated `ip-cam-master-updater.service` unit: charging-master uses a dedicated `oneshot` unit (sibling cgroup, prevents parent-kill on `systemctl stop`); current ip-cam-master uses transient `systemd-run` per-update. Decision needed: keep transient (simpler) or adopt dedicated unit (charging-master pattern, safer for `stop` stage)
  - `unifi-protect` WS reconnect during install drain: must trigger `disconnect()` before stop stage so reconnect on restart is clean (charging-master uses `/api/internal/prepare-for-shutdown`); add `drain` stage to `update.sh`
**UI hint**: yes (settings card + stepper + overlay + modal — significant UI surface)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 19. Data Model + Protect Catalog (Read-Only) | 3/4 | Complete    | 2026-05-02 |
| 20. Bridge LXC Provisioning + Hello-World YAML | 3/3 | Complete    | 2026-05-06 |
| 21. Multi-Cam YAML + Reconciliation Loop | 0/6 | Planned     | - |
| 22. Onboarding Wizard + `/cameras` Integration | 0/? | Not started | - |
| 23. Offboarding + Lifecycle Polish + Stream-Sharing API | 0/? | Not started | - |
| 24. Auto-Update Parity (parallel-track maintenance) | 1/1 | Complete    | 2026-05-05 |

## Coverage

- **Total v1.3 requirements:** 62 HUB-* IDs across 8 categories (CAT/BRG/OUT/RCN/WIZ/UI/OFF/OPS)
- **Mapped:** 62 / 62 (100% — no orphans, no duplicates)
- **Distribution:** P19=7, P20=11, P21=18, P22=14, P23=12

Per-category mapping:
- HUB-CAT-* (6): all in P19
- HUB-BRG-* (8): all in P20
- HUB-OUT-* (7): all in P21
- HUB-RCN-* (10): all in P21
- HUB-WIZ-* (10): WIZ-01 in P19; WIZ-02/03/04 in P20; WIZ-05/06/07/08/09/10 in P22
- HUB-UI-* (8): all in P22
- HUB-OFF-* (8): all in P23
- HUB-OPS-* (5): OPS-05 in P21; OPS-01/02/03/04 in P23

## Phase Dependency Graph

```
P19 (schema + read-only catalog) ──┐
                                   ├── both ship demoable value alone
P20 (bridge LXC + hello-world) ────┘
            ↓
P21 (yaml + reconcile)  ← heart of the milestone, highest risk
            ↓
P22 (wizard + /cameras UI)  ← usable by humans
            ↓
P23 (offboarding + polish)
```

No circular deps. P19 and P20 each ship demoable value standalone. P21 is technically usable by a developer who can INSERT into `camera_outputs` manually. P22 turns it into an end-user product. P23 cannot meaningfully precede P22.

**P24 (Auto-Update Parity)** runs as a parallel-track maintenance phase — no dependency on P19–P23, can ship at any time alongside the milestone (precedent: P16 in v1.2). Touches a disjoint code area (`src/routes/settings/`, `src/lib/server/services/update-*`, `scripts/update.sh`, new `update_runs` table) so file conflicts with v1.3 work are unlikely.

---

## v1.2 Phase Archive

Preserved for reference. v1.2 = Bambu Lab Camera Integration (Phases 10–18). Code-complete 2026-04-20; UAT pending for formal close.

- [ ] **Phase 10: H2C Hardware Validation Spike** — Investigation spike against real H2C; deliverable is a findings note that gates all later phases (4 plans)
- [ ] **Phase 11: Foundation — Discovery, Credentials, Pre-flight** — SSDP discovery, encrypted Access Code + Serial storage, three-state pre-flight handshake
- [ ] **Phase 12: Stream Pipeline — go2rtc RTSPS + LXC Reuse** — `rtspx://` passthrough config, go2rtc as sole RTSPS consumer, existing LXC template reused
- [ ] **Phase 13: UniFi Protect Adoption + Dashboard Error Taxonomy** — End-to-end adoption verified; Bambu-specific error states on dashboard; inline Access Code update
- [ ] **Phase 14: Adaptive Stream Mode + Wizard UI Polish** — Live-during-print / snapshot-during-idle driven by MQTT; polished Bambu credential wizard
- [ ] **Phase 15: Docs & Installer Validation** — README for LAN Mode setup, firmware caveats, Bambu Studio trade-off; installer confirmed unchanged
- [ ] **Phase 16: Deploy Flow — .git/HEAD Sync** — rsync-Deploy must keep `.git/HEAD` aligned with the deployed commit so the in-app updater works (TBD plans)
- [ ] **Phase 17: RTSP Auth + Bambu Credentials Management** — go2rtc RTSP-Auth per camera with original credentials; Bambu credentials management in Settings (TBD plans)
- [x] **Phase 18: Bambu Lab A1 Camera Integration** — A1 as a fourth `camera_type` branch alongside H2C; reuses SSDP/MQTT/credentials/Protect adoption; adds JPEG-over-TLS :6000 ingestion. (6/6 plans, 12/12 reqs, completed 2026-04-20)
