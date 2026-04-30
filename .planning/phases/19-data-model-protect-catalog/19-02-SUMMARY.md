---
phase: 19-data-model-protect-catalog
plan: 02
subsystem: database
tags: [drizzle, sqlite, better-sqlite3, unifi-protect, yaml, schema-migration, pseudo-migration, ensureColumn]

# Dependency graph
requires:
  - phase: 18-bambu-a1-h2c-split
    provides: cameras.model column (Bambu SSDP code) — REUSED, not duplicated
provides:
  - cameras +7 columns (source, mac, external_id, hub_bridge_id, manufacturer, model_name, kind)
  - protect_hub_bridges table (P20 will populate)
  - camera_outputs table (P21 will populate)
  - protect_stream_catalog table (P19 Plan 03 will populate)
  - unifi-protect@^4.29.0 + yaml@^2.6.0 dependencies pinned
  - CameraSource ('managed'|'external'|'external_archived') and CameraKind ('first-party'|'third-party'|'unknown') type unions
affects: [19-03-protect-bridge-lib, 19-04-protect-hub-tab, 20-bridge-lxc, 21-reconciler, 22-cameras-list-integration, 23-share-toggle]

# Tech tracking
tech-stack:
  added: [unifi-protect@4.29.0, yaml@2.6.0, undici (transitive of unifi-protect)]
  patterns: [pseudo-migration via ensureColumn() + CREATE TABLE IF NOT EXISTS, discriminator-via-source-column (L-2), MAC-as-effective-PK (L-1), separate camera_outputs table not JSON column (L-4)]

key-files:
  created: []
  modified:
    - src/lib/server/db/schema.ts (Drizzle definitions for 7 new columns + 3 new tables)
    - src/lib/server/db/client.ts (ensureColumn calls + CREATE TABLE IF NOT EXISTS for all P19 schema)
    - src/lib/types.ts (CameraSource + CameraKind type unions)
    - package.json (added unifi-protect@^4.29.0 + yaml@^2.6.0 to dependencies)
    - package-lock.json (regenerated with 3 new entries — unifi-protect, yaml, undici)

key-decisions:
  - "Pinned at exact floor versions per plan: unifi-protect@^4.29.0 + yaml@^2.6.0 (resolved to 4.29.0 and 2.6.0). Initial npm install resolved yaml to 2.8.3, which was downgraded to 2.6.0 to match acceptance criteria literally."
  - "Phase 18's cameras.model column REUSED for Bambu SSDP codes; new dedicated cameras.model_name column added for Protect marketName. Avoids semantic collision; both columns coexist."
  - "Existing CameraType union UNCHANGED ('mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu'). External Protect cams use the new source='external' discriminator (per L-2) rather than extending the union."
  - "No FOREIGN KEY clauses on new tables (matches existing project convention; FK is app-layer only). hub_bridge_id is a logical FK enforced by app code, not SQLite."
  - "No CHECK constraints on source column (enforced in catalog.ts upsert in Plan 03)."
  - "Indexes added on protect_stream_catalog(camera_id) and camera_outputs(camera_id) — both are FK lookup paths used in the read API."

patterns-established:
  - "Schema-irreversibility step pattern: P19 commits MAC-as-PK invariant for source='external' rows; once shipped, changing requires painful migration."
  - "Idempotent boot-time pseudo-migration via ensureColumn() + CREATE TABLE IF NOT EXISTS — mirrors Phase 18 pattern verbatim."
  - "Two-column convention for semantically distinct values that share a domain term: cameras.model (Bambu SSDP code) vs cameras.model_name (Protect marketName)."

requirements-completed: [HUB-CAT-02, HUB-CAT-04, HUB-CAT-05, HUB-CAT-06]

# Metrics
duration: 5m 15s
completed: 2026-04-30
---

# Phase 19 Plan 02: Data Model Schema Lock Summary

**Locked the v1.3 cameras-table extension (+7 columns), 3 new tables (protect_hub_bridges, camera_outputs, protect_stream_catalog), and pinned unifi-protect@4.29.0 + yaml@2.6.0 — all via the existing pseudo-migration pattern, with Phase 18's Bambu SSDP cameras.model column intact.**

## Performance

- **Duration:** ~5 min 15 sec
- **Started:** 2026-04-29T23:59:01Z
- **Completed:** 2026-04-30T00:04:16Z
- **Tasks:** 3 (all autonomous)
- **Files modified:** 5

## Accomplishments

- Schema-irreversibility point committed: MAC-as-PK invariant for `source='external'` rows is now locked (per L-1).
- 7 new columns on `cameras` (`source`, `mac`, `external_id`, `hub_bridge_id`, `manufacturer`, `model_name`, `kind`) verified against running SQLite via boot-twice idempotency test.
- 3 new tables created with expected columns: `protect_hub_bridges`, `camera_outputs`, `protect_stream_catalog`.
- 2 indexes created for FK lookup paths: `idx_protect_stream_catalog_cam`, `idx_camera_outputs_cam`.
- Phase 18's `cameras.model` column (Bambu SSDP code) is INTACT — no regression.
- `unifi-protect@^4.29.0` + `yaml@^2.6.0` pinned in `package.json` with exact floor versions; resolved to `unifi-protect@4.29.0` (pulls `undici` as transitive) and `yaml@2.6.0` (zero deps). No existing dependency was bumped.
- Drizzle schema in `schema.ts` matches the runtime SQL added in `client.ts` — no type drift (`npm run check` exits 0).
- `src/lib/server/services/protect.ts` (legacy v1.0 hand-rolled client) is UNTOUCHED per the D-LIB-01 boundary constraint.

## Task Commits

Each task was committed atomically:

1. **Task 01: Install unifi-protect@^4.29.0 + yaml@^2.6.0** — `c20e0a4` (chore)
2. **Task 02: Extend Drizzle schema (cameras +7 columns; +3 new tables)** — `7255207` (feat)
3. **Task 03 [BLOCKING]: Apply schema migration on boot via ensureColumn() + CREATE TABLE IF NOT EXISTS** — `4b145ba` (feat)

## Files Created/Modified

- `package.json` — Added `"unifi-protect": "^4.29.0"` and `"yaml": "^2.6.0"` to `dependencies` block. No version bumps on existing deps.
- `package-lock.json` — Regenerated with 3 new lockfile entries: `unifi-protect@4.29.0`, `yaml@2.6.0`, and `undici` (transitive of unifi-protect, sole runtime transitive).
- `src/lib/server/db/schema.ts` — Added 7 new columns to `cameras` Drizzle definition (after `rtspAuthEnabled`, before `createdAt`). Added 3 new exported tables (`protectHubBridges`, `cameraOutputs`, `protectStreamCatalog`) at the bottom of the file.
- `src/lib/server/db/client.ts` — Appended 7 `ensureColumn('cameras', ...)` calls + 3 `CREATE TABLE IF NOT EXISTS` blocks + 2 `CREATE INDEX IF NOT EXISTS` calls. Existing `ensureColumn` calls (rtsp_auth_enabled, model, credentials.*) UNCHANGED.
- `src/lib/types.ts` — Added exported `CameraSource` and `CameraKind` union types adjacent to the existing `ProtectCamera` interface.

## Verification Results (BLOCKING gate from Task 03)

Ran the migration twice against a realistic legacy DB seeded with 3 pre-P19 rows (1 mobotix, 1 loxone, 1 bambu A1):

**Boot 1 (first migration):**
- All 7 new columns appear in `cameras` schema dump.
- All 3 new tables exist with expected columns and indexes.
- `SELECT COUNT(*) FROM cameras WHERE source = 'managed'` returns **3** — all legacy rows stamped with the column DEFAULT (no orphaned NULLs).
- All 3 legacy rows show `kind='unknown'` (default).
- Bambu A1 row's `model='A1'` (Phase 18 SSDP code) is INTACT — `model_name` is NULL (different column, no semantic collision).
- New tables empty (`protect_hub_bridges=0`, `camera_outputs=0`, `protect_stream_catalog=0`) — Plan 03 will populate.

**Boot 2 (idempotency check):**
- `MIGRATION_RUN_OK` — no `duplicate column` errors, no `table already exists` errors. The `ensureColumn()` PRAGMA-table_info early-return and `CREATE TABLE IF NOT EXISTS` no-op as expected.
- Data unchanged: same 3 rows, same column values, same `model='A1'` on the Bambu row.

After verification, the local workstation DB was restored from backup so dev state remains unchanged.

## Resolved Versions (from package-lock.json)

| Package | Range Pin | Resolved | Transitive deps |
| --- | --- | --- | --- |
| `unifi-protect` | `^4.29.0` | `4.29.0` | `undici` |
| `yaml` | `^2.6.0` | `2.6.0` | (none) |

## Decisions Made

- **`yaml@2.6.0` floor enforcement:** Initial `npm install --save unifi-protect@^4.29.0 yaml@^2.6.0` resolved `yaml` to `2.8.3` (npm picks the latest within the major). The plan's acceptance criteria literally read `"yaml": "^2.6.0"`, so I re-installed at the exact floor (`yaml@2.6.0 unifi-protect@4.29.0`) to match. Both are still caret-pinned for forward-compat patches.
- **Existing `CameraType` union UNCHANGED:** External Protect cams will set `source='external'` and leave `cameraType` at its default `'mobotix'` sentinel (never read by managed-cam code paths because they filter on `source='managed'`). Avoids backward-incompat changes to the union; satisfies the discriminator-via-source-column design (per L-2).
- **Phase 18 `cameras.model` REUSED, not renamed:** New dedicated `cameras.model_name` column added for Protect `marketName`. Both columns coexist on the same row — `model` for Bambu SSDP codes ('A1', 'H2C', 'O1C2'), `model_name` for Protect catalog ('G4 Bullet', 'Mobotix S15'). Documented inline in `schema.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] yaml@2.8.3 resolution did not match plan acceptance criteria**
- **Found during:** Task 01 (after first `npm install --save unifi-protect@^4.29.0 yaml@^2.6.0`)
- **Issue:** npm resolved `yaml@^2.6.0` to the latest within the major (`2.8.3`), bumping the floor in `package.json` to `^2.8.3`. The plan's automated verification check (`startsWith('^2.6')`) and the literal acceptance criterion (`"yaml": "^2.6.0"`) would have failed.
- **Fix:** Reinstalled with the exact floor (`yaml@2.6.0 unifi-protect@4.29.0`). `package.json` now reads `"yaml": "^2.6.0"` exactly.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `node -e "...require('./package.json').dependencies['yaml'].startsWith('^2.6')..."` → OK
- **Committed in:** `c20e0a4` (Task 01 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — version-pin mismatch).
**Impact on plan:** Plan was followed exactly; the deviation was a minor adaptation of `npm install` semantics to satisfy the literal acceptance criterion. No scope creep.

## Issues Encountered

- **Pre-existing test failures:** `npm run test` reports 12 failed tests across 5 test files (proxmox.test.ts, etc.). Verified via `git stash` + re-run on the pre-change baseline that these failures are PRE-EXISTING, not regressions caused by this plan. They appear unrelated to schema or dep changes (mock-related timeouts and SSH connection mocks). Per the deviation-rules scope boundary, these are out-of-scope for Plan 19-02 — logged here for the orchestrator to consider whether a separate fix-up plan is needed before the v1.3 release.
- **Local workstation DB had no `cameras` table:** The dev workstation's `data/ip-cam-master.db` only had `containers`, `credentials`, `events`, `settings`, `users` (the workstation has never run the SvelteKit dev server with full migrations). To validate the BLOCKING migration test against a realistic legacy state, I bootstrapped a temporary pre-P19 cameras table with 3 representative rows (mobotix, loxone, bambu A1), ran the migration twice, then restored the DB from a pre-test backup. This does not affect the production VM (where the table exists from prior phases) — the migration proof is still valid because the verification exercised the actual pre-P19 schema shape against the actual `client.ts` boot code.

## User Setup Required

None — no external service configuration required for this plan.

## Boot Time Comparison

The pseudo-migration adds 7 `PRAGMA table_info` checks + 7 conditional `ALTER TABLE` (only on first boot) + 3 `CREATE TABLE IF NOT EXISTS` + 2 `CREATE INDEX IF NOT EXISTS`. All of these are O(1) DDL operations against a small SQLite file. Empirically, the migration ran in well under 100 ms in both boot tests (no observable difference from the pre-existing migration block). This matches the plan's expectation ("Boot time before vs after migration should be identical — pseudo-migration is fast").

## Unexpected SQLite Warnings

None. Both boot logs (`/tmp/p19-02-boot1.log`, `/tmp/p19-02-boot2.log`) printed only `MIGRATION_RUN_OK` — no `duplicate column`, `already exists`, `SQLITE_ERROR`, or any other warning strings.

## Next Phase Readiness

- **Plan 19-03 (protect-bridge.ts library boundary):** Schema is locked. Plan 03 can now `import { cameras, protectStreamCatalog, protectHubBridges, cameraOutputs } from '$lib/server/db/schema'` and `import { ProtectApi } from 'unifi-protect'`. The `CameraSource` and `CameraKind` types in `src/lib/types.ts` are available for the catalog upsert and classification logic.
- **Plan 19-04 (Protect Hub settings tab UI):** Will read from `protect_stream_catalog` joined with `cameras` (filtered on `source='external'`).
- **Phase 20 (bridge LXC):** `protect_hub_bridges` table is ready for the first row insert when the bridge container is provisioned.
- **Phase 21 (reconciler):** `camera_outputs` table is ready; `outputType` is open-ended and will accept `'loxone-mjpeg'` and `'frigate-rtsp'` initially.

## Self-Check: PASSED

- **Files exist:**
  - `src/lib/server/db/schema.ts` ✓ (FOUND, contains all 7 columns + 3 tables)
  - `src/lib/server/db/client.ts` ✓ (FOUND, contains 7 ensureColumn calls + 3 CREATE TABLE blocks)
  - `src/lib/types.ts` ✓ (FOUND, exports CameraSource + CameraKind)
  - `package.json` ✓ (contains unifi-protect ^4.29.0 + yaml ^2.6.0)
- **Commits exist:**
  - `c20e0a4` (Task 01) ✓ FOUND
  - `7255207` (Task 02) ✓ FOUND
  - `4b145ba` (Task 03) ✓ FOUND
- **Boundary constraint:**
  - `src/lib/server/services/protect.ts` UNTOUCHED ✓ (`git diff` empty across all 3 commits)
- **Phase 18 regression check:**
  - `cameras.model` column INTACT ✓ (verified via `.schema cameras` post-migration)

---
*Phase: 19-data-model-protect-catalog*
*Plan: 02*
*Completed: 2026-04-30*
