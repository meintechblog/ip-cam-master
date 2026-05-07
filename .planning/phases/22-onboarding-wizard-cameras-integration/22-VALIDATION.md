---
phase: 22
slug: onboarding-wizard-cameras-integration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-07
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.4 + @testing-library/jest-dom (existing setup, no new install) |
| **Config file** | `vitest.config.ts` at repo root |
| **Quick run command** | `npm run test:unit -- --run` |
| **Full suite command** | `npm run test:unit -- --run && npm run check` |
| **Estimated runtime** | quick: ~12 s · full: ~22 s |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run`
- **After every plan wave:** Run `npm run test:unit -- --run && npm run check`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 22 seconds

---

## Wave 0 Requirements

Phase 22 closes Wave 0 inside Plan 01 (the test scaffold for the wizard pointer service is created in Plan 01 Task 2 alongside its source).

- [x] `src/lib/server/orchestration/protect-hub/wizard-state.test.ts` — 7 unit tests for the pointer service stub of HUB-WIZ-09 + HUB-WIZ-10 (created in Plan 01 Task 2)
- [x] `src/routes/settings/protect-hub/onboarding/wizard.test.ts` — regex-against-source scaffold covering Step3..6 + WizardStepIndicator + WizardResumeBanner + host page (created in Plan 04 Task 1; extended in Task 4)
- [x] Drizzle schema for `hub_onboarding_state` + live `npx drizzle-kit push` (Plan 01 Task 3 — BLOCKING)

Existing vitest infrastructure covers all phase requirements. No new framework install needed.

Wave 0 closes when Plan 01 ships (it is the foundational schema + service stub before downstream plans can compile).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | HUB-WIZ-09, HUB-WIZ-10 | T-22-01 | Drizzle types compile after schema addition | unit | `npm run check` | ✅ | ⬜ pending |
| 22-01-02 | 01 | 1 | HUB-WIZ-09, HUB-WIZ-10 | T-22-02 | Single-row pointer service: 7 cases incl. atomic update | unit | `npm run test:unit -- --run src/lib/server/orchestration/protect-hub/wizard-state.test.ts` | ✅ | ⬜ pending |
| 22-01-03 | 01 | 1 | HUB-WIZ-09 | — | Live DB has hub_onboarding_state table after `drizzle-kit push` | integration | `sqlite3 data/db.sqlite ".schema hub_onboarding_state" \| grep -c "hub_onboarding_state"` | ✅ | ⬜ pending |
| 22-02-01 | 02 | 2 | HUB-UI-01 | T-22-03 | CameraCardData + /api/cameras/status response shape (8 added fields incl. streamCatalog + outputs) | unit | `npm run test:unit -- --run src/routes/api/cameras/status/server.test.ts` | ✅ | ⬜ pending |
| 22-02-02 | 02 | 2 | HUB-UI-01, HUB-UI-08 | T-22-09 | Browser-server slug parity + 8 hub-state derivation cases | unit | `npm run test:unit -- --run src/lib/protect-hub/slug.test.ts src/lib/server/orchestration/protect-hub/hub-state.test.ts` | ✅ | ⬜ pending |
| 22-02-03 | 02 | 2 | HUB-WIZ-09, HUB-WIZ-10 | T-22-03, T-22-07 | Step validator (400) + atomic complete-flip ordering (3 cases) | unit | `npm run test:unit -- --run src/routes/api/protect-hub/wizard/complete/server.test.ts` | ✅ | ⬜ pending |
| 22-02-04 | 02 | 2 | HUB-UI-08 | T-22-05, T-22-06, T-22-08 | events filter source-arg + check pass | unit | `npm run test:unit -- --run src/lib/server/services/events.test.ts && npm run check` | ✅ | ⬜ pending |
| 22-03-01 | 03 | 3 | HUB-UI-01 | — | /kameras partition imports ExternalCamCard + has both section headers + hubEnabled gate (regex) | unit | `npm run test:unit -- --run src/routes/kameras/page.test.ts` | ✅ | ⬜ pending |
| 22-03-02 | 03 | 3 | HUB-UI-02..06 | T-22-10, T-22-12 | ExternalCamCard regex + OutputToggle state machine regex | unit | `npm run test:unit -- --run src/lib/components/cameras/ExternalCamCard.test.ts src/lib/components/cameras/OutputToggle.test.ts` | ✅ | ⬜ pending |
| 22-03-03 | 03 | 3 | HUB-UI-04, HUB-UI-05 | — | ProtectHubGuide has 7 regex assertions (tabs, snippets, copy idioms) | unit | `npm run test:unit -- --run src/lib/components/protect-hub/ProtectHubGuide.test.ts` | ✅ | ⬜ pending |
| 22-03-04 | 03 | 3 | HUB-WIZ-10 (toast consumer) | T-22-19 | /kameras consumes ?onboarding=success once and replaceState clears the param | grep | `grep -c "onboarding=success\|consumeOnboardingToast\|showToast" src/routes/kameras/+page.svelte` | ✅ | ⬜ pending |
| 22-04-01 | 04 | 3 | HUB-WIZ-09 | — | WizardStepIndicator + WizardResumeBanner regex + scaffold for Step3..6 (RED until Tasks 2-3) | unit | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ✅ | ⬜ pending |
| 22-04-02 | 04 | 3 | HUB-WIZ-05, HUB-WIZ-06 | — | Step3 discover POST + Step4 VAAPI cap regex GREEN | unit | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ✅ | ⬜ pending |
| 22-04-03 | 04 | 3 | HUB-WIZ-07, HUB-WIZ-08 | T-22-14 | Step5 1500ms poll + 3 stages + 90s timeout + Step6 wizard/complete + redirect regex GREEN | unit | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ✅ | ⬜ pending |
| 22-04-04 | 04 | 3 | HUB-WIZ-09, HUB-WIZ-10 | T-22-13, T-22-15, T-22-16 | Host page imports + loadCatalog (or fallback drizzle SELECT) + jumpToStep POST + continuePointer NOT POST | unit | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ✅ | ⬜ pending |
| 22-05-01 | 05 | 3 | HUB-UI-08 | T-22-18, T-22-20 | HubStatusPanel + HubEventLog compile clean | typecheck | `npm run check` | ✅ | ⬜ pending |
| 22-05-02 | 05 | 3 | HUB-UI-08 | T-22-23 | ProtectHubTab embeds new components AND wires SC-4 toggle-flap-protection (5 baseline + 4 SC-4 assertions) | unit | `npm run test:unit -- --run src/lib/components/settings/ProtectHubTab.test.ts` | ✅ | ⬜ pending |
| 22-05-03 | 05 | 3 | HUB-UI-07 | T-22-17, T-22-21 | All-URLs page loader + render + empty-state regex (5 assertions) | unit | `npm run test:unit -- --run src/routes/settings/protect-hub/all-urls/page.test.ts` | ✅ | ⬜ pending |
| 22-06-01 | 06 | 4 | (UAT pre-flight) | T-22-22 | VM SHA matches + hub_onboarding_state table exists on VM | integration | `ssh ip-cam-master 'sqlite3 /opt/ip-cam-master/data/db.sqlite ".schema hub_onboarding_state" \| grep -c hub_onboarding_state'` | ✅ | ⬜ pending |
| 22-06-02 | 06 | 4 | HUB-WIZ-05..10 | T-22-13, T-22-14, T-22-16 | Wizard end-to-end against live VM (Steps 3-6, resumability, atomic enable, abort-at-step-4) — see Manual-Only table | manual | (human-verify checkpoint) | n/a | ⬜ pending |
| 22-06-03 | 06 | 4 | HUB-UI-01..06 | T-22-10, T-22-12 | /kameras partition + ExternalCamCard live verification — see Manual-Only table | manual | (human-verify checkpoint) | n/a | ⬜ pending |
| 22-06-04 | 06 | 4 | HUB-UI-07, HUB-UI-08 | T-22-17, T-22-18, T-22-20 | Hub-Tab status + event log + All-URLs live verification — see Manual-Only table | manual | (human-verify checkpoint) | n/a | ⬜ pending |
| 22-06-05 | 06 | 4 | (all 14 reqs) | — | UAT evidence document committed with all PASS | file-exists | `test -f .planning/phases/22-onboarding-wizard-cameras-integration/22-06-UAT-EVIDENCE.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Continuity check (Nyquist):** No 3 consecutive tasks lack an automated `<verify>` command. Plan 04 Tasks 1-4 all run the same regex-against-source `wizard.test.ts` (per Blocker 4 fix); each task lands additional source files that turn the file's pre-existing assertions GREEN. Plan 06 Tasks 2-4 are explicitly checkpoint:human-verify (manual UAT) and bracketed by Task 1 (automated pre-flight grep) and Task 5 (automated file-exists check) — manual gap is bounded.

---

## Manual-Only Verifications

P22 is overwhelmingly UI work. Playwright is not installed; jsdom is not installed for Svelte rendering. Regex-against-source tests cover file structure but not pixels. The 9 ROADMAP P22 success criteria are visually verified against the live VM at `192.168.3.178:3000` in Plan 06.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ROADMAP SC-1: 6-step wizard end-to-end ~3 min for 4 cams (Step 3 discover → Step 4 cam-pick → Step 5 first reconcile + 3 stages → Step 6 redirect with toast) | HUB-WIZ-05/06/07/08 | Pixel-level verification of multi-step UX flow; live UDM controller; cam selection logic | Plan 06 Task 2 sub-checks 2-7 (browser-driven; observed copy + DB inspection) |
| ROADMAP SC-2: Wizard resumable across SvelteKit restart (kill mid-Step-5 → reopen → resume banner → Continue) | HUB-WIZ-09 | Requires `systemctl restart ip-cam-master` against live VM; pixel verification of banner | Plan 06 Task 2 sub-check 6 |
| ROADMAP SC-3: protect_hub_enabled flips ONLY after Step 6 (atomic) | HUB-WIZ-10 | DB inspection mid-flow + UI partition state observation | Plan 06 Task 2 sub-checks 8 + 10 |
| ROADMAP SC-4: Toggle flap-protection during hub_state ∈ {starting, stopping} (disabled + spinner + "Vorgang läuft…" + separate Abbrechen) | HUB-UI-08 | Visual verification across two browser tabs during transitional state | Plan 06 Task 2 sub-check 9 (also covered by automated regex on ProtectHubTab.test.ts in Task 22-05-02) |
| ROADMAP SC-5: /kameras partition with Protect Hub primary badge + first/third-party qualifier | HUB-UI-01 | Pixel verification of badges, two-section layout | Plan 06 Task 3 sub-checks 1 + 2 |
| ROADMAP SC-6: External cam detail page (catalog + outputs + toggles + copy + snapshot; cam-edit/cam-delete hidden; "Aus Hub entfernen" disabled with P23 tooltip) | HUB-UI-02..06 | Pixel verification + interaction flow + VLC stream playback verification | Plan 06 Task 3 sub-checks 3-6 |
| ROADMAP SC-7: Per-output copy + ProtectHubGuide tabs (Loxone + Frigate snippets pre-filled with bridge IP + mac slug) | HUB-UI-04, HUB-UI-05 | Pixel verification + clipboard test (copy → paste in terminal) | Plan 06 Task 3 sub-check 7 |
| ROADMAP SC-8: /settings/protect-hub/all-urls listing every active output URL grouped by output type | HUB-UI-07 | Pixel verification + clipboard test | Plan 06 Task 4 sub-checks 1 + 2 |
| ROADMAP SC-9: Settings → Protect Hub tab status panel + event log (live data, polling visible, Sync-now triggers reconcile) | HUB-UI-08 | Pixel verification + cross-tab synchronization observation + 30s+ polling watch | Plan 06 Task 4 sub-checks 3-6 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit checkpoint:human-verify (Plan 06 Tasks 2-4 only)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Plan 04 Tasks 1-4 share `wizard.test.ts` per Blocker 4 fix; Plan 06 manual cluster is bracketed by automated tasks 1 + 5)
- [x] Wave 0 covers all MISSING references (Plan 01 Tasks 1-3 close it; subsequent plans depend only on what Plan 01 ships)
- [x] No watch-mode flags (every command uses `--run`)
- [x] Feedback latency < 22s (quick: ~12s, full: ~22s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-07
