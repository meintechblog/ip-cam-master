---
phase: 22-onboarding-wizard-cameras-integration
plan: 01
subsystem: database
tags: [protect-hub, schema, wizard, p22, drizzle, sqlite]

# Dependency graph
requires:
  - phase: 21-protect-hub-reconcile-runs
    provides: schema-add pattern (protectHubReconcileRuns at schema.ts:226-237 + client.ts:134-149); single-row service shape (bridge-lifecycle.ts)
  - phase: 19-protect-stream-hub-data-model
    provides: protect_hub_bridges + camera_outputs tables that the wizard pointer joins against in Plan 02-04
provides:
  - hub_onboarding_state SQLite table (single-row, id=1 always upserted)
  - HubOnboardingStep + HubOnboardingStatus type exports
  - wizard-state.ts service: getPointer / setPointer / resetPointer / completePointer (synchronous, better-sqlite3)
  - drizzle/0003_hub_onboarding_state.sql migration (additive, idempotent)
  - Live dev DB migrated — table exists in data/ip-cam-master.db
affects:
  - phase 22 plan 02 (endpoints) — imports getPointer/setPointer/resetPointer/completePointer; gates protect_hub_enabled flip on completePointer call
  - phase 22 plan 04 (wizard UI) — host page reads pointer to render "Du warst bei Schritt N — weiter?" resume banner
  - phase 22 plan 05 (Hub-Tab) — status panel reads pointer for transient state hints
  - phase 22 plan 06 (UAT) — pre-flight checks the table exists on the VM

# Tech tracking
tech-stack:
  added: []  # No new libraries — uses existing drizzle-orm + better-sqlite3
  patterns:
    - "Single-row pointer table (id INTEGER PRIMARY KEY DEFAULT 1) for logical-singleton state"
    - "Pure synchronous service module wrapping drizzle CRUD (mirrors bridge-lifecycle.ts)"
    - "Defensive idempotent completePointer (handles empty-table corner case for HUB-WIZ-10 gate ordering)"

key-files:
  created:
    - "drizzle/0003_hub_onboarding_state.sql"
    - "src/lib/server/orchestration/protect-hub/wizard-state.ts"
    - "src/lib/server/orchestration/protect-hub/wizard-state.test.ts"
  modified:
    - "src/lib/server/db/schema.ts"
    - "src/lib/server/db/client.ts"

key-decisions:
  - "Hand-wrote drizzle/0003_hub_onboarding_state.sql instead of using drizzle-kit generate output: autogen rebuilt the entire schema with wrong filename (0002_*) because the project's _journal.json was historically out of sync with reality (live tables managed via client.ts ensureColumn). Hand-written single-table migration matches the existing 0002_update_runs.sql convention."
  - "Applied migration to live dev DB via `sqlite3 data/ip-cam-master.db < drizzle/0003_hub_onboarding_state.sql` instead of `drizzle-kit push`: drizzle-kit push prompts for interactive column-conflict resolution on this project (pre-existing schema drift), incompatible with non-TTY shell. Direct SQL apply is functionally equivalent for an additive table and matches the project's lightweight-migration convention (client.ts:18 \"Auto-create tables that don't exist yet\")."

patterns-established:
  - "Single-row table service template: getPointer (SELECT WHERE id=1 .get() ?? null) + setPointer upsert (existing? UPDATE : INSERT) + resetPointer (DELETE WHERE id=1) + completePointer (defensive UPSERT to terminal state)"
  - "TDD RED-then-GREEN with vi.hoisted ref to swap drizzle client to in-memory better-sqlite3 (mirrors bridge-lifecycle.test.ts)"

requirements-completed:
  - HUB-WIZ-09
  - HUB-WIZ-10

# Metrics
duration: ~25min
completed: 2026-05-07
---

# Phase 22 Plan 01: Wave 0 — Schema and Wizard State Service Summary

**Single-row hub_onboarding_state table + synchronous pointer service that gates HUB-WIZ-09 resumability and HUB-WIZ-10 atomic protect_hub_enabled flip; live dev DB migrated.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-07T12:00:00Z (approx)
- **Completed:** 2026-05-07T12:22:20Z
- **Tasks:** 3 (all complete)
- **Files modified/created:** 5 (2 modified, 3 created)
- **Commits:** 4 (1 schema + 1 RED + 1 GREEN + plan-metadata pending)

## Accomplishments

- `hub_onboarding_state` schema landed in `src/lib/server/db/schema.ts` (lines 240-256) with the locked 5-column shape per CONTEXT.md L-15
- `CREATE TABLE IF NOT EXISTS` lightweight bootstrap in `client.ts` (lines 152-164) — auto-creates table on every app boot, handles VM auto-deploy case
- `drizzle/0003_hub_onboarding_state.sql` hand-written migration matching `0002_update_runs.sql` style (single CREATE TABLE + statement-breakpoint, header comment with phase + requirement IDs)
- `wizard-state.ts` service exports `getPointer / setPointer / resetPointer / completePointer / WizardPointer` — pure synchronous, mirrors `bridge-lifecycle.ts` shape
- 7/7 unit tests pass (RED → GREEN), 83/83 protect-hub tests still green (no regression)
- Live dev DB at `data/ip-cam-master.db` contains `hub_onboarding_state` table with the four expected columns (id, step, status, last_activity_at, error)

## Task Commits

1. **Task 1: Add hubOnboardingState schema + DDL + Drizzle migration** — `bee80e2` (feat)
2. **Task 2 RED: Failing tests for wizard-state pointer service** — `dda49b1` (test)
3. **Task 2 GREEN: wizard-state pointer service implementation** — `485cb06` (feat)
4. **Task 3: [BLOCKING] Apply Drizzle schema to live DB** — no source-file commit (live DB is not in git); the migration SQL committed in Task 1 + the direct apply via sqlite3 is the artifact. See "Deviations from Plan" §2 for rationale.

**Plan metadata commit:** to follow this summary.

## Files Created/Modified

- `src/lib/server/db/schema.ts` — appended `HubOnboardingStep`, `HubOnboardingStatus`, `hubOnboardingState` table at lines 240-256
- `src/lib/server/db/client.ts` — appended `CREATE TABLE IF NOT EXISTS hub_onboarding_state` at lines 151-164
- `drizzle/0003_hub_onboarding_state.sql` — new hand-written migration (12 lines incl. header comment + statement-breakpoint)
- `src/lib/server/orchestration/protect-hub/wizard-state.ts` — new pointer service (59 lines) with header comment documenting HUB-WIZ-09 + HUB-WIZ-10 contracts
- `src/lib/server/orchestration/protect-hub/wizard-state.test.ts` — new test file (131 lines), 7 tests, in-memory better-sqlite3 + vi.hoisted DB ref pattern

## Decisions Made

- **Single-row table pattern:** `id INTEGER PRIMARY KEY DEFAULT 1` (no AUTOINCREMENT) per CONTEXT.md L-15 + RESEARCH §Pattern 1. Matches `protect_hub_bridges` analog. Resolves RESEARCH Open Question 2.
- **`completePointer()` does NOT delete the row:** terminal state is `step=6, status='completed'` so Plan 02's `wizard/complete` endpoint can flip `protect_hub_enabled` atomically against the same row (HUB-WIZ-10). Only `resetPointer()` deletes.
- **Defensive idempotent `completePointer()`:** handles the empty-table corner case (insert if no row, update if row exists). Plan 02's wizard/complete endpoint can safely call without first ensuring `setPointer` ran.
- **Hand-written migration over autogen:** drizzle-kit generate produced a file that re-creates the entire schema (because the project's `_journal.json` was out of sync with reality — historic tables were managed via `client.ts ensureColumn`). Hand-writing matches the existing `0002_update_runs.sql` convention (single-table file, comment header, `--> statement-breakpoint`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-kit generate produced wrong filename + bulk-rebuild content**
- **Found during:** Task 1
- **Issue:** `npm run db:generate` emitted `drizzle/0002_right_smiling_tiger.sql` (slot collision with existing `0002_update_runs.sql`) and the file contained `CREATE TABLE` statements for ALL existing tables, not just the new `hub_onboarding_state`. Root cause: `drizzle/meta/_journal.json` only tracks 0000 and 0001 — `0002_update_runs.sql` was hand-written without journal entry, and the historic Phase 19/21 tables were added via `client.ts ensureColumn` blocks rather than migrations.
- **Fix:** Removed the auto-generated `0002_right_smiling_tiger.sql` and the new `meta/0002_snapshot.json`; reverted `_journal.json` via `git checkout`; hand-wrote `drizzle/0003_hub_onboarding_state.sql` containing only the new table, matching the `0002_update_runs.sql` style.
- **Files modified:** `drizzle/0003_hub_onboarding_state.sql` (new, hand-written), discarded `drizzle/0002_right_smiling_tiger.sql` and `drizzle/meta/0002_snapshot.json` and the journal addition.
- **Verification:** `ls drizzle/*.sql` shows only the four canonical files; `cat drizzle/0003_hub_onboarding_state.sql` confirms single-table content.
- **Committed in:** bee80e2 (Task 1 commit)

**2. [Rule 3 - Blocking] drizzle-kit push requires TTY for column-conflict resolution; applied SQL directly**
- **Found during:** Task 3
- **Issue:** `npx drizzle-kit push` failed with `Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false)` because drizzle-kit detected pre-existing schema drift on UNRELATED tables (Phase 19/21 historic ALTER COLUMNs added via `client.ts ensureColumn`) and prompted for column-conflict disambiguation. `--force` didn't bypass it; `script -q /dev/null` couldn't allocate a real TTY in the agent shell.
- **Fix:** Applied the migration SQL directly via `sqlite3 data/ip-cam-master.db < drizzle/0003_hub_onboarding_state.sql`. This is functionally equivalent for a pure additive table and matches the project's lightweight-migration convention (`client.ts:18` comment: "Auto-create tables that don't exist yet").
- **Files modified:** None (live DB only).
- **Verification:** `sqlite3 data/ip-cam-master.db ".schema hub_onboarding_state"` returns the full CREATE TABLE definition with all four expected columns; `SELECT COUNT(*) FROM hub_onboarding_state` returns 0 (table exists, empty).
- **Committed in:** N/A (no source change). Task 3's artifact is the live DB state.

**3. [Rule 3 - Note] Plan verification command referenced wrong DB path (`data/db.sqlite` vs actual `data/ip-cam-master.db`)**
- **Found during:** Task 3
- **Issue:** Plan's `<verify>` block uses `sqlite3 data/db.sqlite ".schema hub_onboarding_state" | grep -c "hub_onboarding_state"` but `drizzle.config.ts` configures the actual path as `./data/ip-cam-master.db`.
- **Fix:** Used the actual configured path (`data/ip-cam-master.db`) for the verification command. Returns `1` as expected.
- **Files modified:** None.
- **Verification:** Same command, correct path → exit 0 with output `1`.

---

**Total deviations:** 3 auto-fixed (3 Rule 3 - Blocking/Note, infrastructure/path issues; no source-code or behavior deviations)
**Impact on plan:** All deviations were tooling/path workarounds. The intent of every plan step (schema landed, table in live DB, service module shipped, tests passing, no regression) was met exactly. No scope creep, no behavior changes.

## Threat Surface Scan

No new threat surface beyond the plan's existing register (T-22-01 Tampering, T-22-02 Information Disclosure). Plan adds a single-row local SQLite table + pure local DB service:
- No new network endpoints
- No auth/authn surface
- No file access
- No remote write paths

The `error` column stores transient TS Error.message strings; T-22-02 mitigation already documents that upstream catalog.ts never propagates auth tokens to errors. Plan 02 will pass-through the error string into JSON responses (noted there).

## Known Stubs

None. All code shipped is functional and exercised by 7 unit tests.

## TDD Gate Compliance

- ✅ RED gate: `dda49b1` (`test(22): Plan 22-01 Task 2 RED — failing tests`)
- ✅ GREEN gate: `485cb06` (`feat(22): Plan 22-01 Task 2 GREEN — wizard-state pointer service`)
- REFACTOR gate: skipped — implementation is already minimal and matches `bridge-lifecycle.ts` shape verbatim.

## Issues Encountered

- drizzle-kit auto-generation incompatible with this project's historic `client.ts ensureColumn` migration style. Resolved by hand-writing migrations matching the existing `0002_update_runs.sql` convention. This is a known characteristic of the project, not a defect introduced by this plan.

## User Setup Required

None — no external service configuration required. The live VM at `192.168.3.178:3000` will receive the `hub_onboarding_state` table automatically on the next git-push deploy via the `client.ts CREATE TABLE IF NOT EXISTS` block (per `feedback_deploy_to_vm.md` auto-deploy pattern).

## Next Phase Readiness

- Plan 02 (endpoints) can now `import { getPointer, setPointer, resetPointer, completePointer, type WizardPointer } from '$lib/server/orchestration/protect-hub/wizard-state'`.
- Plan 04 (wizard UI) can read the pointer via the Plan 02 GET `/api/protect-hub/wizard/state` endpoint to render the resume banner.
- Live DB has the table → no runtime errors when downstream plans query it.
- Type-check + 83/83 protect-hub tests still green → safe to proceed to Wave 2.

## Self-Check: PASSED

**Files claimed:**
- ✅ FOUND: `src/lib/server/db/schema.ts` (modified — hubOnboardingState at line 248)
- ✅ FOUND: `src/lib/server/db/client.ts` (modified — CREATE TABLE at line 157)
- ✅ FOUND: `drizzle/0003_hub_onboarding_state.sql`
- ✅ FOUND: `src/lib/server/orchestration/protect-hub/wizard-state.ts`
- ✅ FOUND: `src/lib/server/orchestration/protect-hub/wizard-state.test.ts`

**Commits claimed:**
- ✅ FOUND: bee80e2 (Task 1)
- ✅ FOUND: dda49b1 (Task 2 RED)
- ✅ FOUND: 485cb06 (Task 2 GREEN)

**Live DB state:**
- ✅ `sqlite3 data/ip-cam-master.db ".schema hub_onboarding_state"` returns the table definition with id/step/status/last_activity_at/error.
- ✅ `SELECT COUNT(*) FROM hub_onboarding_state` returns 0.

---
*Phase: 22-onboarding-wizard-cameras-integration*
*Completed: 2026-05-07*
