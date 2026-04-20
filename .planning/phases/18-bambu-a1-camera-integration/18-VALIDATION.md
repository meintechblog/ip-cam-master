---
phase: 18
slug: bambu-a1-camera-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Canonical
> source of test architecture: `18-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 (configured at repo root, no changes needed) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm run test:unit -- --run src/lib/server/services/bambu-a1-*.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~sub-second for quick; ~30 s for full suite (current baseline) |
| **E2E gate** | `A1_IP=… A1_ACCESS_CODE=… npm test -- --run a1-e2e` (env-gated, runs against real A1 at 192.168.3.195; skipped in CI) |

---

## Sampling Rate

- **After every task commit:** `npm run test:unit -- --run src/lib/server/services/bambu-a1-*.test.ts` (sub-second)
- **After every plan wave:** `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green + manual UAT against real A1 @ 192.168.3.195
- **Max feedback latency:** < 5 s per task (well within Nyquist threshold)

---

## Per-Task Verification Map

> **Status:** draft — populated by the planner once PLAN.md tasks exist.
> Mapping of REQ-ID → test is canonical in `18-RESEARCH.md` §Validation Architecture
> "Phase Requirements → Test Map". After `/gsd-plan-phase 18` completes, each task
> gets a row here with its `{phase}-{plan}-{task}` ID and its automated command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(to be populated by planner)* | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Driven by `18-RESEARCH.md` §Validation Architecture "Wave 0 Gaps":

- [ ] `src/lib/server/services/bambu-a1-auth.ts` — `buildAuth(username, accessCode) → Buffer` pure function
- [ ] `src/lib/server/services/bambu-a1-auth.test.ts` — byte-for-byte + golden fixture assertions
- [ ] `src/lib/server/services/__fixtures__/a1-auth-packet.bin` — 80-byte golden fixture
- [ ] `src/lib/server/services/bambu-a1-camera.ts` — server-side helpers (preflight TLS check, snapshot fetch)
- [ ] `src/lib/server/services/bambu-a1-camera.test.ts` — SIGTERM, snapshot, frame-parser roundtrip
- [ ] `lxc-assets/bambu-a1-camera.mjs` — ingestion script deployed into LXC
- [ ] `src/routes/api/cameras/[id]/a1-snapshot/+server.ts` — new endpoint (D-04)
- [ ] `src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts` — cache + auth check
- [ ] Extend `src/lib/server/services/bambu-preflight.test.ts` with A1 cases
- [ ] Extend `src/lib/server/services/bambu-mqtt.test.ts` with TUTK watch
- [ ] Extend `src/lib/server/services/go2rtc.test.ts` with A1 yaml snapshot
- [ ] Drizzle migration for `cameras.model` column

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A1 frame rate during active print | BAMBU-A1 deferred UAT | Requires user to start a real print; spike measured idle only (0.45 fps) | User starts any print on the A1 → observe fps in UniFi Protect and in `/api/cameras/:id/a1-snapshot` timestamps over 30 s. Target: ≥ 1 fps; if < 1 fps, enable the ffmpeg frame-padding retrofit (see RESEARCH §Gap 2, Case B). |
| UniFi Protect adoption works on A1 | BAMBU-A1-12 | Requires UniFi Protect dashboard access, manual QR/IP adoption flow | User runs full onboarding wizard → triggers LXC provision → opens UniFi Protect → confirms A1 appears as adoptable camera → completes adoption → sees live stream during active print, offline badge during idle. |
| German-language preflight hints render correctly | BAMBU-A1-04/05 | UX copy, visual review | User triggers each error (LAN mode off, wrong access code, `tutk_server=enable`) in the wizard and confirms hint text matches CONTEXT.md D-05 wording. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`--watch`, etc.) in task commands
- [ ] Feedback latency < 5 s for quick run, < 60 s for full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills task map

**Approval:** pending (planner to populate task map; Nyquist auditor to approve)
