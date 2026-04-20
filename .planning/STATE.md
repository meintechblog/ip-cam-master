---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: "Bambu Lab H2C Kamera-Integration"
status: roadmap_complete
stopped_at: "Phase 18 planned — 6 plans in 3 waves (18-01 through 18-06). Requirements BAMBU-A1-01..12 added to REQUIREMENTS.md. Ready for /gsd:execute-phase 18"
last_updated: "2026-04-20T16:30:00.000Z"
last_activity: 2026-04-20
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-13)

**Core value:** One-click camera onboarding -- discover a camera, and the app handles everything to get its stream into UniFi Protect.
**Current focus:** v1.2 — Bambu Lab H2C Kamera-Integration. Integrate the H2C as a third `camera_type` alongside Mobotix and Loxone with SSDP discovery, LAN-mode Access Code + Serial credentials, go2rtc RTSPS passthrough, and UniFi Protect adoption. Includes user-proposed Adaptive Stream Mode (live during print, snapshot during idle) to protect the printer's fragile Live555 server.

## Current Position

Phase: 18 — Bambu Lab A1 Camera Integration (planning complete)
Plan: 6 plans authored (18-01..18-06), 3 waves, ready for execution
Status: Planning complete, awaiting `/gsd:execute-phase 18`
Last activity: 2026-04-20 — Phase 18 planned: schema+capabilities (Plan 01 BLOCKING drizzle-push), auth lib+fixture (Plan 02 TDD), LXC script+yaml+onboarding (Plan 03), model-aware preflight (Plan 04), MQTT TUTK watch (Plan 05), snapshot endpoint+UI+UAT checkpoint (Plan 06). Requirements BAMBU-A1-01..12 coined and merged into REQUIREMENTS.md. v1.2 Phases 10–17 remain unplanned.

Phase numbering: continues from v1.1 (ended at Phase 09). v1.2 starts at Phase 10.

Shipped milestones:
- v1.0 — One-click camera onboarding (2026-03-23)
- v1.1 — Self-Maintenance & Polish (2026-04-10)

```
[          ] 0% — v1.2 just started (0/6 phases)
```

## Performance Metrics

**Velocity:**

- Total plans completed (v1.2): 0
- Phases planned (v1.2): 6 (Phases 10–15)
- Requirements mapped: 26 / 26 (100%)
- New npm deps expected: 1 (`mqtt@^5.10`)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 10 | 0 | - | - |
| 11 | 0 | - | - |
| 12 | 0 | - | - |
| 13 | 0 | - | - |
| 14 | 0 | - | - |
| 15 | 0 | - | - |

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

- 2026-04-20: Phase 16 added — Deploy Flow — .git/HEAD Sync (maintenance/infra, parallel-track zu v1.2 Bambu-Phasen). Ausgelöst durch false-positive "Update blockiert" im Settings-UI am 2026-04-20: VM HEAD hing 38 Commits hinter main, weil rsync-Deploys `.git/HEAD` nicht mit-aktualisieren.
- 2026-04-20: Phase 18 added — Bambu Lab A1 Camera Integration (additive on top of v1.2 H2C branch). Added after live-hardware spikes 001–004 (`.planning/spikes/`) against user's A1 at 192.168.3.195 proved: (a) A1 has no RTSPS:322 (closes port), (b) A1 MQTT LAN is byte-for-byte H2C-compatible, (c) A1 camera streams JPEG-over-TLS on :6000 at 1536×1080 / ~0.45 fps idle with an 80-byte auth handshake. Reuses SSDP/MQTT/credentials from Phase 11 and go2rtc+Protect adoption from Phase 12–13; adds ~260 LOC A1-specific ingestion path. Depends on Phases 11–13 being done.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

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

- Run Phase 10 spike against the user's real H2C before planning Phase 11
- Resolve schema Option A (zero-migration, reuse `password`) vs Option B (new `accessCode` / `serialNumber` columns) in the Phase 11 plan
- Validate `#video=copy` vs VAAPI re-encode against live UniFi Protect adoption during Phase 12
- Confirm MQTT print-state field names from Phase 10 findings before implementing Adaptive Stream Mode in Phase 14

### Blockers/Concerns

- Research flag (Phase 10): H2C-specific RTSPS path, SSDP service URN, and MQTT topic schema cannot be resolved by desk research — requires physical hardware access (user has it)
- Research flag (Phase 12): `#video=copy` passthrough vs forced VAAPI re-encode must be validated against live UniFi Protect adoption (not theoretical)
- Research flag (Phase 14): MQTT print-state field names must be confirmed from Phase 10 findings or ha-bambulab `pybambu` source before mode-switch logic is implemented

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

Last activity: 2026-04-20
Stopped at: Phase 18 planning complete (6 plans, 3 waves). Ready to run `/gsd:execute-phase 18`.
Resume file: None
