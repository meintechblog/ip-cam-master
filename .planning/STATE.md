---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: "Protect Stream Hub"
status: planning
stopped_at: ""
last_updated: "2026-04-30T00:25:00.000Z"
last_activity: 2026-04-30 — Milestone v1.3 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-30)

**Core value:** One-click camera onboarding -- discover a camera, and the app handles everything to get its stream into UniFi Protect. v1.3 erweitert das um die *Reverse-Direction*: Protect-Cams ergänzend als Loxone-/Frigate-fähige Streams aus der App heraus bereitstellen.
**Current focus:** v1.3 — Protect Stream Hub (Loxone + Frigate-ready). Defining requirements.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-30 — Milestone v1.3 started

Phase numbering: continues from v1.2 (last phase was 18). v1.3 starts at Phase 19.

Shipped milestones:

- v1.0 — One-click camera onboarding (2026-03-23)
- v1.1 — Self-Maintenance & Polish (2026-04-10)
- v1.2 — Bambu Lab A1 Camera Integration (code-complete 2026-04-20, formal close pending UAT)

```
[          ] 0% — v1.3 just started (defining requirements)
```

## Performance Metrics

**Velocity:**

- Total plans completed (v1.3): 0
- Phases planned (v1.3): TBD (roadmapper)
- Requirements mapped: 0 / 0

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

- 2026-04-30: Milestone v1.3 started — Protect Stream Hub (Loxone + Frigate-ready). Reverse-Direction des bestehenden Patterns: vorher Cams → Protect, jetzt Protect → Loxone/Frigate. Single Bridge-Container mit go2rtc.yaml-Reconciliation, voller Lifecycle (Onboarding → Betrieb → Offboarding), Integration in bestehende `/cameras`-UI mit Stream-Inventur pro Cam.
- 2026-04-20: Phase 16 added — Deploy Flow — .git/HEAD Sync (maintenance/infra, parallel-track zu v1.2 Bambu-Phasen). Ausgelöst durch false-positive "Update blockiert" im Settings-UI am 2026-04-20: VM HEAD hing 38 Commits hinter main, weil rsync-Deploys `.git/HEAD` nicht mit-aktualisieren.
- 2026-04-20: Phase 18 added — Bambu Lab A1 Camera Integration (additive on top of v1.2 H2C branch). Added after live-hardware spikes 001–004 (`.planning/spikes/`) against user's A1 at 192.168.3.195 proved: (a) A1 has no RTSPS:322 (closes port), (b) A1 MQTT LAN is byte-for-byte H2C-compatible, (c) A1 camera streams JPEG-over-TLS on :6000 at 1536×1080 / ~0.45 fps idle with an 80-byte auth handshake. Reuses SSDP/MQTT/credentials from Phase 11 and go2rtc+Protect adoption from Phase 12–13; adds ~260 LOC A1-specific ingestion path. Depends on Phases 11–13 being done.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

*v1.3 Pre-Decisions (from milestone discussion, to be locked during spec-phase/discuss-phase):*

- v1.3 Architektur: **Single Bridge-Container** für n Streams (kein per-Cam-Container) — bestätigt vom User, weil Loxone-Konsumenten typischerweise wenige Cams brauchen und VAAPI sich gut über mehrere ffmpeg-Prozesse teilen lässt.
- v1.3 Architektur: **Stream-Catalog-Modell** — pro Cam alle nativen Protect-Qualitätsstufen katalogisieren (Low/Medium/High mit Codec/Auflösung/FPS), mehrere Output-Typen pro Cam aktivierbar (Loxone-MJPEG transcoded, Frigate-RTSP passthrough). Erweiterbar für künftige Targets (HomeAssistant, Scrypted).
- v1.3 UX: **Feature-Toggle in Settings** schaltet den Hub frei. Bei aktiviertem Toggle erscheinen Protect-Cams in bestehender `/cameras`-Übersicht (Marker "Protect Hub" zur Abgrenzung von app-managed Cams).
- v1.3 UX: **Voller Lifecycle** — kuratiertes Onboarding (Wizard mit Protect-Verbindung → LXC-Provisioning → Discovery-Preview → Cam-Auswahl → Initial-Sync), Betrieb mit Auto-Reconciliation, sauberes Offboarding (Container stoppen/löschen, DB-Cleanup, optionales Aufräumen Stream-Sharing in Protect).
- v1.3 Open Question: **Stream-Share Auto-Aktivierung via Protect API** — recherchieren ob möglich, sonst sauberer UI-Fallback mit Anleitung pro Cam.
- v1.3 Open Question: **Loxone Single- vs Dual-Stream** (low+high für Loxone) — im Blogpost reichte single low-stream (640×360 @ 10fps), gegen offizielle Loxone-Doku verifizieren.

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

*v1.3 (Open Questions to resolve in spec/discuss):*
- Recherche: Stream-Sharing in UniFi Protect API auto-aktivierbar (oder bleibt manuell mit UI-Anleitung)?
- Recherche: Loxone Motion Shape Extreme — single low-quality MJPEG ausreichend, oder werden zwei Streams (low+high) erwartet?
- Reuse vs Neu: Bridge-LXC auf gleichem Proxmox-Host wie Mobotix/Loxone/Bambu-Container; eigenes Container-Template oder bestehendes wiederverwenden?

*v1.2 (carried over — pending UAT before formal milestone close):*
- 5 manuelle UAT-Items für Bambu A1 (Wizard / Provisioning / Protect Adoption / Cloud-Mode-Toggle) gegen Live-Hardware @ 192.168.3.195

### Blockers/Concerns

*v1.3 (none yet — milestone just started)*

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
Stopped at: v1.3 milestone started — defining requirements next
Resume file: None
