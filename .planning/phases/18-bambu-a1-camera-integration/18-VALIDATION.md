---
phase: 18
slug: bambu-a1-camera-integration
status: populated
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
| 18-01-T1 | 01 | 1 | BAMBU-A1-02 | T-18-01 | additive schema change; no destructive op | unit | `npm run test:unit -- --run src/lib/server/services/bambu-discovery.test.ts`, `npx tsc --noEmit` | ❌ pending | ⬜ pending |
| 18-01-T2 | 01 | 1 | BAMBU-A1-02 | T-18-01 | Drizzle push applies additive column only | integration | `npx drizzle-kit push && sqlite3 data/ip-cam-master.db "PRAGMA table_info(cameras);" \| grep model` | ❌ pending | ⬜ pending |
| 18-01-T3 | 01 | 1 | BAMBU-A1-01, BAMBU-A1-03 | T-18-02 | PRINTER_CAPABILITIES shape locked via unit tests | unit | `npm run test:unit -- --run src/lib/server/services/bambu-discovery.test.ts` | ❌ pending | ⬜ pending |
| 18-02-T1 | 02 | 1 | BAMBU-A1-07 | T-18-05 | RED test catches 0x30-vs-0x3000 regression | unit (TDD RED) | `npm run test:unit -- --run src/lib/server/services/bambu-a1-auth.test.ts` (expects FAIL) | ❌ pending | ⬜ pending |
| 18-02-T2 | 02 | 1 | BAMBU-A1-07 | T-18-04, T-18-05 | byte-for-byte + golden fixture | unit (TDD GREEN) | `npm run test:unit -- --run src/lib/server/services/bambu-a1-auth.test.ts && test "$(wc -c < src/lib/server/services/__fixtures__/a1-auth-packet.bin)" -eq 80` | ❌ pending | ⬜ pending |
| 18-03-T1 | 03 | 2 | BAMBU-A1-09 | T-18-07, T-18-10, T-18-11, T-18-12, T-18-13 | stdlib-only, SIGTERM-safe, no CLI cred leak | unit (syntax) | `node --check lxc-assets/bambu-a1-camera.mjs && grep -q "process.env.A1_ACCESS_CODE" lxc-assets/bambu-a1-camera.mjs && ! grep -q "\-\-access-code=" lxc-assets/bambu-a1-camera.mjs` | ❌ pending | ⬜ pending |
| 18-03-T2 | 03 | 2 | BAMBU-A1-08 | T-18-07, T-18-10 | yaml contains kill flags + env-var creds | unit (snapshot) | `npm run test:unit -- --run src/lib/server/services/go2rtc.test.ts` | ❌ pending | ⬜ pending |
| 18-03-T3 | 03 | 2 | BAMBU-A1-08, BAMBU-A1-09 | T-18-07 | onboarding A1 branch deploys .mjs + A1 yaml | unit (no regression) | `npm run test:unit -- --run src/lib/server/services/onboarding.test.ts && npx tsc --noEmit` | ❌ pending | ⬜ pending |
| 18-04-T1 | 04 | 2 | BAMBU-A1-04 | T-18-14, T-18-15, T-18-17 | TLS probe classifies all fail modes; no cred logs | unit | `npm run test:unit -- --run src/lib/server/services/bambu-a1-camera.test.ts` | ❌ pending | ⬜ pending |
| 18-04-T2 | 04 | 2 | BAMBU-A1-04, BAMBU-A1-05 | T-18-14, T-18-17 | model-aware branch; exact D-05 hint | unit | `npm run test:unit -- --run src/lib/server/services/bambu-preflight.test.ts` | ❌ pending | ⬜ pending |
| 18-04-T3 | 04 | 2 | BAMBU-A1-04 | T-18-14 | model validated against BAMBU_MODEL_ALLOWLIST | type-check | `npx tsc --noEmit && npm run lint` | ❌ pending | ⬜ pending |
| 18-05-T1 | 05 | 2 | BAMBU-A1-06 | T-18-19, T-18-21, T-18-22 | TUTK watch + conditional reset; no access-code logs | unit | `npm run test:unit -- --run src/lib/server/services/bambu-mqtt.test.ts` | ❌ pending | ⬜ pending |
| 18-06-T1 | 06 | 3 | BAMBU-A1-10 | T-18-23, T-18-24, T-18-25, T-18-26 | 2s cache; JPEG-only body; type guards | unit (endpoint) | `npm run test:unit -- --run "src/routes/api/cameras/[id]/a1-snapshot/+server.test.ts"` | ❌ pending | ⬜ pending |
| 18-06-T2 | 06 | 3 | BAMBU-A1-02 | T-18-29 | saveCameraRecord writes cameras.model | unit (no regression) | `npm run test:unit -- --run src/lib/server/services/onboarding.test.ts` | ❌ pending | ⬜ pending |
| 18-06-T3 | 06 | 3 | BAMBU-A1-11 | T-18-25 | capability-gated UI; D-05 hint in wizard | build | `npm run lint && npx tsc --noEmit && npm run build` | ❌ pending | ⬜ pending |
| 18-06-T4 | 06 | 3 | BAMBU-A1-12 | (live hardware) | end-to-end A1 adoption in Protect | manual UAT (blocking checkpoint) | Live wizard run @ 192.168.3.195; user types "approved" | ❌ pending | ⬜ pending |

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

**Approval:** planner populated 16-task map on 2026-04-20; Nyquist auditor to approve `nyquist_compliant: true` after confirming:
- No 3-task stretch without `<automated>` (spot-check: every task has an automated command or is a blocking UAT checkpoint)
- Feedback latency < 5s for quick unit runs, < 60s for full suite
- Wave 0 gaps all covered: the 12-item checklist in §"Wave 0 Requirements" is addressed across Plans 01-06
