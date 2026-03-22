---
phase: 02
slug: mobotix-camera-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vite.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npm run build` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | LXC-03, G2R-01 | unit | `npx vitest run ssh.test.ts go2rtc.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | G2R-04, G2R-05 | unit | `npx vitest run go2rtc.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | G2R-06 | unit | `npx vitest run go2rtc.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | ONBD-01, ONBD-02, ONBD-03 | unit | `npx vitest run onboarding.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | ONBD-04, ONBD-06 | build | `npm run build` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 3 | ONBD-02, ONBD-03 | build | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/server/services/ssh.test.ts` — stubs for SSH/pct exec operations
- [ ] `src/lib/server/services/go2rtc.test.ts` — stubs for config generation, stream verification
- [ ] `src/lib/server/services/onboarding.test.ts` — stubs for onboarding pipeline steps

*Created by plan tasks themselves (TDD approach).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WebRTC live preview shows video | G2R-06, ONBD-04 | Requires running go2rtc + camera | Open wizard step 5, verify iframe shows live video |
| VAAPI hardware acceleration active | G2R-01 | Requires Intel GPU in LXC | Check go2rtc logs for "vaapi" codec usage |
| 5-step wizard visual flow | ONBD-02 | Visual/UX verification | Walk through all 5 steps on VM |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
