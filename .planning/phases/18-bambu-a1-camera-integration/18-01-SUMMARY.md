---
phase: 18-bambu-a1-camera-integration
plan: 01
subsystem: database
tags: [drizzle, sqlite, bambu, a1, capabilities, schema]

requires:
  - phase: 11-foundation-discovery-credentials-preflight
    provides: Phase 11 additive Bambu column pattern (access_code, serial_number); BAMBU_MODEL_ALLOWLIST + MODEL_LABELS in bambu-discovery.ts

provides:
  - cameras.model column (nullable TEXT; null=assume-H2C for backward-compat)
  - PRINTER_CAPABILITIES exported map with all six Bambu models
  - A1 cameraTransport='jpeg-tls-6000' — the sole driver of the preflight branch split
  - Drizzle migration 0001_add_camera_model.sql with Phase 18 header comment
  - Live SQLite schema synchronized via drizzle-kit push

affects:
  - 18-02-bambu-a1-auth-lib (consumes PRINTER_CAPABILITIES indirectly via downstream plans)
  - 18-03-bambu-a1-lxc-script (reads cameras.model at runtime for yaml branch)
  - 18-04-bambu-a1-preflight (reads PRINTER_CAPABILITIES.cameraTransport for model-split)
  - 18-05-bambu-a1-mqtt-watch (reads cameras.model for per-model TUTK watch)
  - 18-06-bambu-a1-snapshot-ui (reads PRINTER_CAPABILITIES for UI capability gates)

tech-stack:
  added: []
  patterns:
    - "Additive nullable schema migrations (ALTER TABLE ADD COLUMN) without backfill — extends Phase 11 pattern"
    - "Per-model capability matrix keyed by model code, exported as named const for consumer import"

key-files:
  created:
    - drizzle/0001_add_camera_model.sql
    - drizzle/meta/0001_snapshot.json
  modified:
    - src/lib/server/db/schema.ts
    - src/lib/server/services/bambu-discovery.ts
    - src/lib/server/services/bambu-discovery.test.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "Hand-wrote additive migration instead of using drizzle-kit generate output — generator produced destructive table-recreate because meta/0000_snapshot.json predates Phase 17 columns (pre-existing snapshot drift)"
  - "cameras.model is nullable; null = assume H2C for backward-compat with pre-Phase-18 rows (per BAMBU-A1-02 + RESEARCH §Open Questions #3)"
  - "PRINTER_CAPABILITIES.xcamFeatures left empty for non-A1 models — only A1 needs its own gate; future phases fill per-model without breaking A1 consumers"

patterns-established:
  - "Capability matrix pattern: central exported Record<modelCode, {...flags}> consumed by both backend (preflight split) and frontend (UI gates)"
  - "Snapshot-drift remediation: when drizzle-kit generate produces a destructive migration due to stale meta/0000_snapshot.json, hand-write the minimal ALTER and keep the new 0001_snapshot.json (which reflects the true desired state)"

requirements-completed: [BAMBU-A1-01, BAMBU-A1-02, BAMBU-A1-03]

duration: 6min
completed: 2026-04-20
---

# Phase 18 Plan 01: Schema + Capabilities Foundation Summary

**cameras.model nullable TEXT column added to Drizzle schema + live SQLite, and PRINTER_CAPABILITIES exported from bambu-discovery.ts with all six Bambu models — A1 alone declares `cameraTransport: 'jpeg-tls-6000'`.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T15:18:21Z
- **Completed:** 2026-04-20T15:24:13Z
- **Tasks:** 3
- **Files modified:** 5 (4 source + 1 live DB)

## Accomplishments

- `cameras.model` column exists in both Drizzle schema (`text('model')`, nullable) and live SQLite (`model|TEXT|0||0` — nullable, no default). Live row count preserved at 0 (fresh worktree DB).
- `PRINTER_CAPABILITIES` exported from `src/lib/server/services/bambu-discovery.ts` immediately after `MODEL_LABELS`. All six models (O1C2, H2C, H2D, X1C, P1S, A1) declared with the exact five keys from D-07: `chamberHeater`, `ams`, `xcamFeatures`, `cameraResolution`, `cameraTransport`. A1 alone uses `cameraTransport: 'jpeg-tls-6000'` — the sole driver of the preflight branch split downstream in Plan 04.
- Migration `drizzle/0001_add_camera_model.sql` committed with Phase 18 header comment and the minimal `ALTER TABLE \`cameras\` ADD \`model\` text` statement, mirroring the Phase 11 additive pattern. Journal advanced to idx 1; new 0001 snapshot generated.
- Five new tests in `bambu-discovery.test.ts` assert the map shape + transport values; all 10 tests in the file pass (5 existing parseNotifyPayload + 5 new PRINTER_CAPABILITIES).

## Task Commits

1. **Task 1: Add cameras.model column + migration** — `e8376a6` (feat)
2. **Task 2: [BLOCKING] drizzle-kit push** — no repo commit (mutates live DB only); verified `sqlite3 data/ip-cam-master.db "PRAGMA table_info(cameras);"` shows `model|TEXT|0||0`
3. **Task 3 RED: Failing PRINTER_CAPABILITIES tests** — `2e5b685` (test)
4. **Task 3 GREEN: PRINTER_CAPABILITIES implementation** — `96eec62` (feat)

## Files Created/Modified

- `src/lib/server/db/schema.ts` — Added `model: text('model')` column to `cameras` table (line 53), with comment explaining nullable+H2C-backward-compat semantics
- `src/lib/server/services/bambu-discovery.ts` — Added `PRINTER_CAPABILITIES` named export with six-model capability matrix per D-07
- `src/lib/server/services/bambu-discovery.test.ts` — Added 5 tests for map shape, transport values, A1 AMS/chamberHeater/xcamFeatures facts
- `drizzle/0001_add_camera_model.sql` — Additive migration with Phase 18 header
- `drizzle/meta/0001_snapshot.json` — New schema snapshot (auto-generated; reflects current schema state including Phase 17 columns)
- `drizzle/meta/_journal.json` — Appended 0001 entry; tag renamed from auto-generated `0001_absent_rockslide` to `0001_add_camera_model`

## Implementation: Final PRINTER_CAPABILITIES Shape

```typescript
export const PRINTER_CAPABILITIES: Record<
	string,
	{
		chamberHeater: boolean;
		ams: 'none' | 'lite' | 'full';
		xcamFeatures: readonly string[];
		cameraResolution: '480p' | '1080p' | '4k';
		cameraTransport: 'rtsps-322' | 'jpeg-tls-6000';
	}
> = {
	O1C2: { chamberHeater: true,  ams: 'full', xcamFeatures: [],                          cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
	H2C:  { chamberHeater: true,  ams: 'full', xcamFeatures: [],                          cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
	H2D:  { chamberHeater: true,  ams: 'full', xcamFeatures: [],                          cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
	X1C:  { chamberHeater: true,  ams: 'full', xcamFeatures: [],                          cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
	P1S:  { chamberHeater: false, ams: 'full', xcamFeatures: [],                          cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
	A1:   { chamberHeater: false, ams: 'lite', xcamFeatures: ['buildplateMarkerDetector'], cameraResolution: '1080p', cameraTransport: 'jpeg-tls-6000' }
};
```

## Decisions Made

1. **Hand-written migration over drizzle-kit auto-generated output.** When `npm run db:generate` was invoked, drizzle-kit produced a destructive migration (`PRAGMA foreign_keys=OFF; CREATE TABLE __new_cameras; INSERT ... SELECT; DROP TABLE cameras; ALTER TABLE __new_cameras RENAME TO cameras; ...`) because the tracked `meta/0000_snapshot.json` predates Phase 17's `print_state`, `stream_mode`, `rtsp_auth_enabled`, and `credentials.type/access_code/serial_number` additions. Keeping that generator output would have triggered destructive prompts on `drizzle-kit push` and potentially re-created the table. Replaced with a minimal additive `ALTER TABLE cameras ADD model text`, exactly matching the Phase 11 additive pattern. The new 0001 snapshot reflects the full current schema, so subsequent generates will diff cleanly. Rationale also logged under "Deviations" below.
2. **Nullable model column with no backfill.** Per plan and RESEARCH §Open Questions #3: null = assume H2C for backward-compat; SSDP will set model for new adoptions in Plan 04. Zero risk to existing production H2C rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced drizzle-kit auto-generated destructive migration with hand-written additive ALTER**

- **Found during:** Task 1 (`npm run db:generate` step)
- **Issue:** `drizzle-kit generate` produced `drizzle/0001_absent_rockslide.sql` containing a destructive `CREATE TABLE __new_cameras / INSERT SELECT / DROP TABLE cameras / RENAME` sequence plus unrelated `ALTER TABLE credentials ADD ...` statements. Root cause: the tracked `meta/0000_snapshot.json` predates Phase 17 columns (`print_state`, `stream_mode`, `rtsp_auth_enabled`, `credentials.type/access_code/serial_number`), so the generator "caught up" by re-emitting those differences as destructive table-recreate + column-adds. This would have tripped the Task 2 acceptance criterion "no destructive prompts" and potentially wiped data on a production DB.
- **Fix:** Deleted the generated `0001_absent_rockslide.sql`; hand-wrote `0001_add_camera_model.sql` with the Phase 18 header comment + single `ALTER TABLE \`cameras\` ADD \`model\` text` line, mirroring `0000_flippant_apocalypse.sql` additive pattern. Renamed journal entry tag from `0001_absent_rockslide` to `0001_add_camera_model`. Kept the auto-generated `meta/0001_snapshot.json` as-is — it correctly reflects the current schema (including the new `model` column + all Phase 17 columns), so future `db:generate` runs will diff cleanly against it.
- **Files modified:** drizzle/0001_add_camera_model.sql (created), drizzle/0001_absent_rockslide.sql (deleted), drizzle/meta/_journal.json (tag rename)
- **Verification:** Live `drizzle-kit push` succeeded with "[✓] Changes applied" and no destructive prompts; `PRAGMA table_info(cameras)` confirms `model|TEXT|0||0`.
- **Committed in:** `e8376a6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking migration-correctness fix)
**Impact on plan:** Fix was essential — keeping the auto-generated destructive migration would have tripped Task 2's acceptance criterion and risked production data on merge. No scope creep; the fix aligns with the plan's stated additive-migration intent.

## Issues Encountered

- `npx tsc --noEmit` reports unrelated errors about `.svelte-kit/tsconfig.json` and module resolution that are pre-existing to this worktree (likely because `svelte-kit sync` was not run). Project convention is `npm run check`, which succeeds with 0 ERRORS + 23 pre-existing warnings — used this instead.
- Full `npm test` has 12 pre-existing failing tests across `src/lib/server/services/onboarding.test.ts` (8) and `src/lib/server/services/proxmox.test.ts` (4). Confirmed these fail at base commit `b240cc7` with schema/bambu-discovery reverted — **not caused by this plan**. Logged to `.planning/phases/18-bambu-a1-camera-integration/deferred-items.md`.

## Verification

- `npm run test:unit -- --run src/lib/server/services/bambu-discovery.test.ts`: **10/10 passing** (5 existing parseNotifyPayload + 5 new PRINTER_CAPABILITIES)
- `npm run check` (svelte-check): **0 ERRORS** (23 pre-existing warnings in unrelated components, 8 files with problems — all pre-existing)
- `sqlite3 data/ip-cam-master.db "PRAGMA table_info(cameras);" | grep model`: `18|model|TEXT|0||0` — nullable TEXT, no default, not PK
- `git diff --name-only` scope: exactly the files listed in plan frontmatter `files_modified`, plus `drizzle/meta/0001_snapshot.json` (which was explicitly expected per the plan's own wording "only new `0001_snapshot.json` + journal append")

## Downstream Consumers Unblocked

- **Plan 18-02** (auth lib + fixture): independent of this plan but runs in parallel Wave 1
- **Plan 18-03** (LXC script + yaml + onboarding): can now switch on `PRINTER_CAPABILITIES[model].cameraTransport === 'jpeg-tls-6000'` to choose the A1 yaml generator
- **Plan 18-04** (model-aware preflight): can now read `cameras.model` at runtime and branch on `PRINTER_CAPABILITIES[model].cameraTransport`
- **Plan 18-05** (MQTT TUTK watch): can now read `cameras.model` to decide whether to install the `ipcam.tutk_server` watcher
- **Plan 18-06** (snapshot endpoint + UI): can now gate panels on `PRINTER_CAPABILITIES[camera.model].chamberHeater`, `.ams !== 'none'`, `.xcamFeatures.includes(...)`

## Next Phase Readiness

- Wave 1 foundation is complete on the schema + capabilities axis.
- Plan 18-02 (auth-lib + golden fixture) is independent and may be executing in parallel.
- Wave 2 (Plans 03, 04, 05) can start as soon as both Wave 1 plans land.
- No blockers or open concerns from this plan.

## Self-Check: PASSED

- `src/lib/server/db/schema.ts` — FOUND (model column at line 53)
- `src/lib/server/services/bambu-discovery.ts` — FOUND (PRINTER_CAPABILITIES exported)
- `src/lib/server/services/bambu-discovery.test.ts` — FOUND (5 new tests)
- `drizzle/0001_add_camera_model.sql` — FOUND (header + ALTER)
- `drizzle/meta/0001_snapshot.json` — FOUND
- `drizzle/meta/_journal.json` — FOUND (tag=0001_add_camera_model)
- Commit `e8376a6` — FOUND (Task 1: schema + migration)
- Commit `2e5b685` — FOUND (Task 3 RED: failing tests)
- Commit `96eec62` — FOUND (Task 3 GREEN: implementation)

---

*Phase: 18-bambu-a1-camera-integration*
*Completed: 2026-04-20*
