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

## Plan 21-04 worktree observations

- **Same 12 pre-existing test failures** confirmed on the 21-04 base (`38bcd0e` — wave-1 merge). No regression introduced by ws-manager.ts. Out of scope.
- **`./reconcile` missing-module typecheck error** is BY DESIGN. Plan 21-04 ships `ws-manager.ts` with an `import { reconcile } from './reconcile';` that the parallel Plan 21-03 worktree creates. The error resolves at the wave-2 merge to main. Cyclic-guard verification (`grep -L "ws-manager" src/lib/server/orchestration/protect-hub/reconcile.ts`) is deferred until reconcile.ts lands; the design intent is documented in PATTERNS.md §ws-manager.ts and in the file's header comment.

**Reported by:** Plan 21-04 executor (worktree-agent-a0f8c73d3e2f92469), 2026-05-06.

## Plan 21-06 worktree observations

- **Same 12 pre-existing test failures** confirmed on the 21-06 base (`191bab7` — wave-3 merge). No regression introduced by the scheduler/update-checker/hooks integrations. Out of scope.
- **`npm run build` fails on the wave base** with `Error [ERR_UNHANDLED_ERROR]: Unhandled error. ({ code: 'SQLITE_ERROR' })` during the `rendering chunks…` phase. Reproduced by checking out `191bab7` clean and running `npm run build` → same crash. The trigger is SvelteKit's prerender worker importing a server module that touches the in-process SQLite client during build-time chunk rendering. This is **pre-existing**; all my changes were verified via `npm run check` (0 errors) + targeted `npx vitest --run`. Out of scope for P21-06; route to a separate build-stabilisation plan.
- **`Retry-After: 60` header on the 409 self-update response** was mentioned in the orchestrator's success criteria but the plan body explicitly says the downstream wrapper at `routes/api/update/run/+server.ts:71-76` is unchanged ("no change needed there"). I respected the plan's `files_modified` scope and did NOT touch the route handler. If a future cleanup wants the explicit header, add it to the existing `json({error: 'active_flows', conflicts}, {status: 409})` response — the conflict array already carries the `kind: 'reconciler_busy'` discriminator clients can read.

**Reported by:** Plan 21-06 executor (worktree-agent-a6a024aafe9eb4a27), 2026-05-06.
