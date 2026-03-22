---
phase: 1
slug: foundation-and-proxmox-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (comes with SvelteKit) |
| **Config file** | `vite.config.ts` (Vitest uses Vite config) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INFRA-01 | unit | `npx vitest run src/lib/server/services/settings.test.ts -t "save proxmox"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INFRA-02 | unit | `npx vitest run src/lib/server/services/proxmox.test.ts -t "validate"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | INFRA-03 | unit | `npx vitest run src/lib/server/services/settings.test.ts -t "save unifi"` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | INFRA-04 | unit | `npx vitest run src/lib/server/services/crypto.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | INFRA-05 | unit | `npx vitest run src/lib/server/db/client.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | LXC-01 | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "create"` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | LXC-02 | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "vaapi"` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | LXC-05 | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "lifecycle"` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | LXC-06 | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "delete"` | ❌ W0 | ⬜ pending |
| 01-02-05 | 02 | 1 | LXC-07 | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "idempotent"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/server/services/settings.test.ts` — stubs for INFRA-01, INFRA-03
- [ ] `src/lib/server/services/proxmox.test.ts` — stubs for INFRA-02, LXC-01, LXC-02, LXC-05, LXC-06, LXC-07
- [ ] `src/lib/server/services/crypto.test.ts` — stubs for INFRA-04
- [ ] `src/lib/server/db/client.test.ts` — stubs for INFRA-05
- [ ] Vitest installed via SvelteKit scaffold

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings UI renders correctly with dark theme | INFRA-01 | Visual verification | Open /settings, verify dark theme, tabs visible |
| Container card grid displays properly | LXC-05 | Visual/integration | Create container via Proxmox API, verify card appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
