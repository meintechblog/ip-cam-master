---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: "Protect Stream Hub"
status: planning
stopped_at: ""
last_updated: "2026-04-30T00:45:00.000Z"
last_activity: 2026-04-30 — v1.3 roadmap created (5 phases P19–P23, 62/62 reqs mapped)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-30)

**Core value:** One-click camera onboarding -- discover a camera, and the app handles everything to get its stream into UniFi Protect. v1.3 erweitert das um die *Reverse-Direction*: Protect-Cams ergänzend als Loxone-/Frigate-fähige Streams aus der App heraus bereitstellen.
**Current focus:** v1.3 — Protect Stream Hub. Roadmap created (P19–P23), ready for `/gsd:plan-phase 19`.

## Current Position

Phase: P19 (next up — not started)
Plan: —
Status: Roadmap complete; awaiting `/gsd:plan-phase 19`
Last activity: 2026-04-30 — v1.3 roadmap created (5 phases, 62/62 reqs mapped, 100% coverage)

Phase numbering: continues from v1.2 (last phase was 18). v1.3 starts at Phase 19.

Shipped milestones:

- v1.0 — One-click camera onboarding (2026-03-23)
- v1.1 — Self-Maintenance & Polish (2026-04-10)
- v1.2 — Bambu Lab A1 Camera Integration (code-complete 2026-04-20, formal close pending UAT)

```
[          ] 0% — v1.3 roadmap done, P19 not yet started
```

## v1.3 Phase Overview

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 19 | Data Model + Protect Catalog (Read-Only) | 7 | Not started |
| 20 | Bridge LXC Provisioning + Hello-World YAML | 11 | Not started |
| 21 | Multi-Cam YAML + Reconciliation Loop | 18 | Not started |
| 22 | Onboarding Wizard + `/cameras` Integration | 14 | Not started |
| 23 | Offboarding + Lifecycle Polish + Stream-Sharing API | 12 | Not started |

**Total:** 62/62 v1.3 requirements mapped (100% coverage).

## Performance Metrics

**Velocity:**

- Total plans completed (v1.3): 0
- Phases planned (v1.3): 5
- Requirements mapped: 62 / 62 (100%)

**Historical (v1.2):**
| Phase 18 | 6 plans | 12/12 reqs | code-complete, UAT pending |

**Historical (v1.0):**
| Phase 01 P01 | 6min | 3 tasks | 24 files |
| Phase 01 P02 | 3min | 2 tasks | 7 files |
| Phase 01 P03 | 4min | 3 tasks | 20 files |
| Phase 02 P01 | 5min | 2 tasks | 13 files |
| Phase 02 P02 | 3min | 1 tasks | 11 files |
| Phase 05 P01 | 5min | 2 tasks | 15 files |
| Phase 04 P01 | 3min | 3 tasks | 5 files |
| Phase 04 P03 | 3min | 2 tasks | 5 files |
| Phase 04 P02 | 4min | 2 tasks | 9 files |
| Phase 05 P02 | 2min | 2 tasks | 1 files |
| Phase 05 P01 | 6min | 2 tasks | 16 files |

## Accumulated Context

### Roadmap Evolution

- 2026-04-30 (later): v1.3 roadmap committed — 5 phases (P19–P23) per `.planning/research/v1.3/SUMMARY.md` §"Phase Decomposition". Coverage 62/62 (100%). Phase distribution: P19=7, P20=11, P21=18, P22=14, P23=12. P19/P20 each ship demoable value standalone; P21 is the heart and highest risk; P22 turns it usable; P23 closes the lifecycle. Two new npm deps locked: `unifi-protect@^4.29.0` + `yaml@^2.6.0`. MAC-as-PK locked for P19 schema (irreversible after commit). Research flags: P19 (TLS spike against UDM), P21 (go2rtc reconnect empirical test + canonical YAML form), P23 (`unifi-protect.updateDevice` PATCH semantics for per-channel `isRtspEnabled`).
- 2026-04-30: Milestone v1.3 started — Protect Stream Hub (Loxone + Frigate-ready). Reverse-Direction des bestehenden Patterns: vorher Cams → Protect, jetzt Protect → Loxone/Frigate. Single Bridge-Container mit go2rtc.yaml-Reconciliation, voller Lifecycle (Onboarding → Betrieb → Offboarding), Integration in bestehende `/cameras`-UI mit Stream-Inventur pro Cam.
- 2026-04-20: Phase 16 added — Deploy Flow — .git/HEAD Sync (maintenance/infra, parallel-track zu v1.2 Bambu-Phasen). Ausgelöst durch false-positive "Update blockiert" im Settings-UI am 2026-04-20: VM HEAD hing 38 Commits hinter main, weil rsync-Deploys `.git/HEAD` nicht mit-aktualisieren.
- 2026-04-20: Phase 18 added — Bambu Lab A1 Camera Integration (additive on top of v1.2 H2C branch). Added after live-hardware spikes 001–004 (`.planning/spikes/`) against user's A1 at 192.168.3.195 proved: (a) A1 has no RTSPS:322 (closes port), (b) A1 MQTT LAN is byte-for-byte H2C-compatible, (c) A1 camera streams JPEG-over-TLS on :6000 at 1536×1080 / ~0.45 fps idle with an 80-byte auth handshake. Reuses SSDP/MQTT/credentials from Phase 11 and go2rtc+Protect adoption from Phase 12–13; adds ~260 LOC A1-specific ingestion path. Depends on Phases 11–13 being done.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

*v1.3 Locked-Early Decisions (research-grounded; see `.planning/research/v1.3/SUMMARY.md` for the full 30-item table):*

- **L-1 MAC-as-PK** for `cameras.source='external'` rows (lowercased, no separators); `externalId` (Protect UUID) is denormalized cache only. Schema is irreversible after P19 commits → must verify in P19 success criteria that `cameras.mac NOT NULL` for external rows.
- **L-2 Discriminator** in single `cameras` table via `source TEXT DEFAULT 'managed'` + nullable container columns; NOT a separate `external_cameras` table.
- **L-3 Bridge container** stored in new `protect_hub_bridges` table, NOT in existing `containers` (which is per-cam by convention).
- **L-4 Outputs** stored in `camera_outputs` table, NOT a JSON column.
- **L-5 Reconcile cadence** 5 min + event-driven force-reconcile.
- **L-6 Reconciler placement** dedicated scheduler tick `protectHubReconcileInterval`, NOT bolted on the 60s SSH log scan.
- **L-7 Deploy strategy** full-rewrite YAML + canonical-form sha256 dedupe (no delta diff).
- **L-8 YAML stamp** `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>`; foreign stamp = warn, do NOT auto-overwrite.
- **L-9 go2rtc API binding** `api: { listen: "127.0.0.1:1984" }` + `ui_editor: false` inside LXC.
- **L-10 Protect RTSP scheme** `rtspx://` (or `tls_verify=0` if rtspx fails the P19 spike).
- **L-11 Protect URLs in YAML** re-extracted from bootstrap every reconcile, never cached across passes.
- **L-12 WS reconnect** exponential backoff 5s → 5min cap, single-flight, full bootstrap on reconnect.
- **L-13 Reconciler concurrency** module-scoped single-flight Promise + dirty-flag retry; per-bridge mutex.
- **L-14 Self-update vs reconcile** Self-update returns 409 if `reconciler.busy`; SIGTERM grace 30s; YAML deploy via tmp+mv atomic.
- **L-15 Wizard state** no DB persistence of wizard form state; permanent tables written incrementally; only `hub_onboarding_state` step-pointer table.
- **L-16 Wizard placement** dedicated route `/settings/protect-hub/onboarding`, NOT modal.
- **L-17 Hub feature gate** `settings.protect_hub_enabled` becomes true ONLY after Step 6 completes successfully.
- **L-18 Toggle state machine** `hub_state ENUM('disabled', 'starting', 'enabled', 'stopping', 'error')`.
- **L-19 Default offboarding** 3-tier dialog: Pause / Disable+Keep (default) / Full Uninstall (type-DELETE).
- **L-20 Soft-delete** `cameras.source = 'external_archived'`, NEVER DELETE; 7-day grace.
- **L-21 Protect-side share cleanup** track `share_enabled_by_us`; offboarding sub-toggle (default OFF) ONLY offers channels we enabled.
- **L-22 URL stability** slug = `<cam-mac-slug>-<output-suffix>`, derived from MAC.
- **L-23 Stream URL auth** none — LAN-trust-boundary, documented in wizard + README.
- **L-24 Bridge IP** static (DHCP reservation or static config); IP-only URLs (no mDNS).
- **L-25 Bridge LXC sizing** dedicated profile (~1–2 GB RAM, 2–4 cores, `nofile=4096`), NOT per-cam template.
- **L-26 VAAPI concurrency** soft cap 4, hard cap 6 Loxone-MJPEG transcodes; Frigate-RTSP `-c:v copy` (zero VAAPI).
- **L-27 Frigate output defaults** `-an` (no audio) by default; H.264 passthrough; H.265 → UI hint only.
- **L-28 Cam classification** `manufacturer`, `model`, `kind` columns; first-party default-ON, third-party default-OFF.
- **L-29 YAML library** `yaml@^2.6.0` (eemeli) — deterministic key ordering, TS-typed.
- **L-30 Protect API client** `unifi-protect@^4.29.0` for write-paths; existing `protect.ts` STAYS for reads (no rip-out, two clients side-by-side OK).

*Historical v1.2 decisions preserved:*

- Phase 18 plan: 6 plans in 3 waves. Wave 1 = Plans 01+02 (schema+capabilities, auth lib) with no deps. Wave 2 = Plans 03+04+05 (LXC script, preflight, MQTT watch) depending on 01/02. Wave 3 = Plan 06 (snapshot endpoint + UI + UAT) depending on 01/02/04/05. Plans 03 and 05 have no file overlap with each other → can run parallel in Wave 2; Plan 04 overlaps only in test-file extensions with 03/05 → sequential within-wave scheduling OK.
- Phase 18 plan: Plan 02 is TDD (buildAuth regression test is the whole point per D-08). Plan 03 task 1 is TDD-flavored (tdd=true on the LXC .mjs script creation task; byte-layout test lives in Plan 02).
- Phase 18 plan: Plan 01 Task 2 is [BLOCKING] drizzle-kit push — the Drizzle schema change alone passes tsc/build but would fail at runtime when querying cameras.model, so the push task is mandatory.
- Phase 18 plan: Plan 06 ends with a blocking `checkpoint:human-verify` against real A1 @ 192.168.3.195 — the 7 ROADMAP Success Criteria cannot be satisfied without live hardware (spike evidence only covers protocol correctness, not Protect adoption and UI gating).
- Phase 18 plan: Security threat model reused verbatim from RESEARCH §Security Threat Model (9 threats, all mitigated or accepted under LAN trust boundary; zero HIGH-severity unmitigated; CN-pinning deferred per CONTEXT.md).
- v1.2 Roadmap: 6 phases (10–15) derived from 26 BAMBU-* requirements, standard granularity
- v1.2 Roadmap: Phase 10 is an **investigation spike** against real H2C (not a build phase) — deliverable is `.planning/research/H2C-FIELD-NOTES.md`; Phases 11+ gate on its findings
- v1.2 Roadmap: Cloud-Auth **dropped from v1.2 scope** — LAN-only; `transport` schema stub added in Phase 11 to keep the v1.3+ door open
- v1.2 Roadmap: **go2rtc is the sole RTSPS consumer** of the printer — architectural guarantee encoded in Phase 12, documented in Phase 15 (Pitfall 1 mitigation)
- v1.2 Roadmap: Adaptive Stream Mode (user-proposed differentiator) scheduled in Phase 14 — structural mitigation for Live555 24/7-exposure risk
- v1.2 Roadmap: Existing LXC template reused for Bambu (no new template); VAAPI passthrough unchanged; new npm dep is `mqtt@^5.10` only
- v1.2 Roadmap: Phase numbering continues from v1.1 (starts at 10, not reset)

*Historical v1.1 decisions preserved:*

- v1.1 Roadmap: 4 phases derived from 17 Active requirements, standard granularity
- v1.1 Roadmap: Observability first (low-risk, builds primitives for update runner), then backup (safety prerequisite), then read-only update check, then execution runner last
- v1.1 Roadmap: UPDATE split into two phases — version awareness (read-only) vs runner (risky execution) — to contain blast radius and let safer parts ship independently
- v1.1 Roadmap: LOGS and HEALTH combined into a single observability phase (both read host state, share systemd/proc primitives)

*Historical v1.0 decisions preserved below for reference:*

- Roadmap: 5 phases derived from 42 requirements, standard granularity
- Roadmap: Proxmox first (everything depends on LXC management), Mobotix before Loxone (simpler pipeline validates orchestration pattern)
- [Phase 01]: Used scryptSync KDF for encryption key derivation instead of raw key
- [Phase 01]: Dropped vitePreprocess -- not needed in SvelteKit 2.50+, TS works natively
- [Phase 01]: Used as-any type assertion for dev0 VAAPI parameter (proxmox-api types lack PVE 8.1 device passthrough)
- [Phase 01]: Cached Proxmox node name in module-level variable to avoid repeated API calls per operation
- [Phase 01]: Used simple custom tab implementation instead of bits-ui Tabs for lower complexity
- [Phase 01]: Stored camera credentials as settings with credential_ prefix for Phase 1 simplicity
- [Phase 02]: SSH bridge via pct exec for container commands instead of direct container SSH
- [Phase 02]: go2rtc config uses hash-param syntax for ffmpeg options per go2rtc conventions
- [Phase 02]: Combined save-camera + advance on credentials submit for smoother wizard UX
- [Phase 05]: scryptSync for password hashing (consistent with existing crypto.ts KDF pattern)
- [Phase 05]: In-memory session Map (sessions lost on restart, acceptable for homelab)
- [Phase 05]: YOLO mode via auth_yolo setting in DB (skip all auth when user opts out)
- [Phase 05]: Single users table with upsert (D-27: only one user ever)
- [Phase 04]: Direct fetch() to Protect REST API instead of unifi-protect npm package
- [Phase 04]: 30s cache TTL for Protect status (frontend polls at 10s)
- [Phase 04]: SQLite datetime() for flapping/cleanup queries instead of JS date math
- [Phase 04]: Simple tab implementation with activeTab state (consistent with existing settings page pattern)
- [Phase 04]: Protect API polling piggybacks on 10s frontend poll with 30s cache — no separate scheduler
- [Phase 04]: SSH log scan runs as background scheduler (60s) started from hooks.server.ts
- [Phase 04]: Map serialized to array for JSON transport in protect/cameras endpoint
- [Phase 05]: SSH-based provisioning over cloud-init cicustom (simpler, debuggable)
- [Phase 05]: Settings injected via PUT /api/settings for proper AES-256-GCM encryption
- [Phase 05]: /api/settings kept public for installer curl POST on fresh install

### Pending Todos

*v1.3 Research Flags (resolve during phase execution):*
- **P19**: TLS spike against actual UDM 192.168.3.1 — confirm `rtspx://` works (vs `tls_verify=0`); confirm `mac` field reliability for first-party AND third-party cams; confirm `bootstrap.cameras[].type` discriminator for first-party detection. Spike artifact: `.planning/research/v1.3/spikes/p19-tls-rtspx.md`.
- **P21**: go2rtc reconnect-after-source-disconnect empirical test (does go2rtc auto-redial when upstream Protect cam reboots, or hold a dead consumer connection?); canonical YAML form choice (`yaml.stringify()` options for byte-identical idempotency).
- **P23**: `unifi-protect.updateDevice` exact PATCH semantics for `isRtspEnabled=false` per channel — is per-channel granularity supported in v4.29.0, or does it flip all channels?

*v1.2 (carried over — pending UAT before formal milestone close):*
- 5 manuelle UAT-Items für Bambu A1 (Wizard / Provisioning / Protect Adoption / Cloud-Mode-Toggle) gegen Live-Hardware @ 192.168.3.195

### Blockers/Concerns

*v1.3 (none yet — roadmap just complete, ready for `/gsd:plan-phase 19`)*

*v1.2 (resolved/archived):*
- Research flag (Phase 10): H2C-specific RTSPS path resolved via spike (A1 is the actual hardware target, no RTSPS:322).
- Research flag (Phase 12): `#video=copy` validated end-to-end with Bambu A1 JPEG-over-TLS:6000 ingestion path.
- Research flag (Phase 14): Adaptive Stream Mode validated against Bambu MQTT print-state.

*Prior concerns from v1.1 (resolved/archived):*
- Research flag (Phase 09): `systemd-run --transient` behavior validated on deployed VM (Debian 13) during v1.1 shipping
- Research flag (Phase 09): Schema-hash comparison stopgap documented as future "real Drizzle migration system" follow-up
- Research flag (Phase 08): GitHub API unauthenticated rate limit (60 req/h) documented, acceptable for single-user homelab

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260323-krt | Phase 4 QA sweep — fix Protect status UI and logic | 2026-03-23 | fe32585 | [260323-krt-phase-4-qa-sweep-fix-protect-status-ui-a](./quick/260323-krt-phase-4-qa-sweep-fix-protect-status-ui-a/) |
| 260410-c36 | Container-IP prominent im Batch-Onboarding + MAC im LXC-Panel | 2026-04-10 | 569062f | [260410-c36-container-ip-prominent-im-batch-onboardi](./quick/260410-c36-container-ip-prominent-im-batch-onboardi/) |

## Session Continuity

Last activity: 2026-04-30
Stopped at: v1.3 roadmap complete (5 phases P19–P23, 62/62 reqs mapped); next step is `/gsd:plan-phase 19`
Resume file: None
