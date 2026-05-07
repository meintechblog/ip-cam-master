# Phase 22 — Deferred / Out-of-Scope Items

Items discovered during Plan 22-02 execution that are NOT caused by Plan 22-02 changes.
Per executor scope rules: log here, do not auto-fix.

## Pre-existing test failures (baseline before Plan 22-02 commit 270c5a8)

- `src/lib/server/services/proxmox.test.ts` — 4 failing tests (`getProxmoxClient`, `create`, `vaapi`, `delete`)
  - Failure: timeout / `ssh.connect` error in mocked SSH path. Unrelated to /api/protect-hub/* work.
- `src/lib/server/services/onboarding.test.ts` — 8 failing tests (testMobotixConnection, createCameraContainer×3, configureGo2rtc×2, verifyStream×2)
  - Failure: same SSH-mock breakage class.

Both files unchanged by Plan 22-02. Failures reproduce on `main@270c5a8` (just before Plan 22-02 Task 4) when run in isolation.

Recommend: open a separate `/gsd:debug` session targeting `src/lib/server/services/{proxmox,onboarding}.test.ts` to fix the SSH-mock-chain regression.

## Pre-existing untracked file with TS errors (parallel Wave-3 work-in-progress) — RESOLVED 2026-05-07

- `src/lib/components/cameras/OutputToggle.svelte` — was untracked WIP from Plan 22-03 development.
  - **Resolved in Plan 22-03 Task 2 (commit 2a3573c).** Final version uses `toggleState` (not `state`) to avoid the `$state` rune shadow, renames the request body local from `body` → `requestBody`, and uses scoped `capBody` / `errBody` locals in the 422 + generic-error branches. `npm run check` reports 0 errors after the commit. The file ships with a 5-assertion regex test (`OutputToggle.test.ts`) that locks the state-machine, AbortController, PUT endpoint, 422 vaapi-cap path, and disabled-during-flight gate.
