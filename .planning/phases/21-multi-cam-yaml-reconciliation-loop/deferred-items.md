# Phase 21 Deferred Items

Pre-existing issues encountered during P21 execution that are out of scope per the plan's SCOPE BOUNDARY rule. Do not auto-fix; surface for triage.

## Pre-existing test failures observed during 21-02 full-suite run

Confirmed on the wave-base commit (`24b898b` — before any 21-02 changes). 12 failing tests / 4 failing files, all unrelated to yaml-builder:

- `src/lib/server/services/backup.test.ts` (file-level fail; could not load)
- `src/lib/server/services/proxmox-validate.test.ts` (file-level fail; could not load)
- `src/lib/server/services/onboarding.test.ts` (8 tests fail — testMobotixConnection / createCameraContainer / configureGo2rtc / verifyStream)
- `src/lib/server/services/proxmox.test.ts` (4 tests fail — getProxmoxClient / create / vaapi / delete; one of them times out at 5s)

**Why deferred:** Pre-existing on the wave base before any 21-02 commit. P21 plan scope is the protect-hub orchestration unit + tests. Triage to a separate stabilization plan or quick-fix workflow.

**Repro:** `npx vitest --run src/lib/server/services/{backup,proxmox-validate,onboarding,proxmox}.test.ts` on the worktree-base commit reproduces all 12 failures.

**Reported by:** Plan 21-02 executor (worktree-agent-a44bab7e86357a024), 2026-05-06.
