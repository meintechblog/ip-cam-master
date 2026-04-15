---
phase: 11-foundation-discovery-credentials-preflight
plan: 01
subsystem: db-schema + credentials
tags: [drizzle, sqlite, aes-256-gcm, bambu]
requires: []
provides:
  - CameraType union (incl. 'bambu')
  - cameras.access_code (nullable TEXT, ciphertext)
  - cameras.serial_number (nullable TEXT, plaintext)
  - encryptAccessCode / decryptAccessCode / BAMBU_USERNAME
affects:
  - src/lib/server/db/schema.ts
  - drizzle/
  - src/lib/server/services/bambu-credentials.ts
  - src/lib/server/services/bambu-credentials.test.ts
tech-stack:
  added: []
  patterns: [vi.mock('$env/dynamic/private')]
key-files:
  created:
    - src/lib/server/services/bambu-credentials.ts
    - src/lib/server/services/bambu-credentials.test.ts
    - drizzle/0000_flippant_apocalypse.sql
    - drizzle/meta/_journal.json
    - drizzle/meta/0000_snapshot.json
  modified:
    - src/lib/server/db/schema.ts
decisions:
  - Hand-trimmed drizzle-kit's baseline SQL to purely-additive ALTER TABLE statements
  - Kept drizzle-kit's generated snapshot as the target-state reference for future migrations
requirements-completed: [BAMBU-07, BAMBU-08, BAMBU-09]
---

# Phase 11 Plan 01: Schema Migration + Bambu Crypto Wiring — Summary

**One-liner:** Added two nullable columns (`access_code`, `serial_number`) to the `cameras` table, widened the `CameraType` union to include `'bambu'`, and shipped a typed AES-256-GCM credential wrapper module reusing the existing `crypto.ts` primitives.

## Schema Diff

`src/lib/server/db/schema.ts`:

- **+1 top-level export** (above the first table):
  ```ts
  export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu';
  ```
- **+2 columns** at the tail of the `cameras` table, both nullable (no `.notNull()`, no `.default()`):
  ```ts
  accessCode: text('access_code'),
  serialNumber: text('serial_number'),
  ```

Net change: +4 lines, 0 lines removed, 0 existing columns touched.

## Migration

**Generated file:** `drizzle/0000_flippant_apocalypse.sql` (hand-trimmed — see deviation below).

**Final SQL contents (additive only):**
```sql
ALTER TABLE `cameras` ADD `access_code` text;--> statement-breakpoint
ALTER TABLE `cameras` ADD `serial_number` text;
```

**Not run:** `npm run db:migrate` has NOT been executed. That step belongs to the execute-phase deployment against App-VM (192.168.3.249).

## Service module

`src/lib/server/services/bambu-credentials.ts` — 23 LOC — exports:
- `BAMBU_USERNAME = 'bblp'` (const, typed as literal)
- `encryptAccessCode(s: string): string` — thin wrapper over `encrypt`
- `decryptAccessCode(s: string): string` — thin wrapper over `decrypt`

`src/lib/server/services/bambu-credentials.test.ts` — 35 LOC — 4 tests, all passing.

## Verification results

- `npx vitest run src/lib/server/services/bambu-credentials.test.ts`: **4 passed / 4**, 218ms
- `npm run check` (svelte-kit sync + svelte-check): **0 errors**, 19 pre-existing warnings (all unrelated to this plan — Svelte 5 rune migration warnings, a11y warnings in unrelated components)
- `grep -E "ADD ... access_code|serial_number" drizzle/*.sql`: both ALTERs present
- `grep -Ei "DROP|RENAME|NOT NULL" drizzle/0000_flippant_apocalypse.sql`: CLEAN

## Deviations from Plan

**1. [Rule 3 — Blocking] drizzle-kit emitted a baseline migration, not a pure ALTER diff**
- **Found during:** Task 1, step 3 (inspection after `db:generate`)
- **Issue:** The repo had no prior drizzle migration history (`drizzle/` did not exist). When `drizzle-kit generate` runs against an empty history, it emits a full baseline (`CREATE TABLE` for every table, including `NOT NULL` columns) rather than the incremental `ALTER TABLE` that the plan's `<behavior>` and verification regex expect.
- **Why blocking:** Applying that baseline via `db:migrate` on the live App-VM database (which already has all tables populated with Mobotix/Loxone rows) would fail with "table already exists" or worse. The plan explicitly requires the migration to add the columns "without altering or dropping any existing rows" (BAMBU-09).
- **Fix:** Replaced the generated `drizzle/0000_flippant_apocalypse.sql` body with just the two additive `ALTER TABLE ... ADD COLUMN` statements the plan specified. Kept drizzle-kit's generated snapshot (`meta/0000_snapshot.json`) and `_journal.json` so future `db:generate` runs have a correct target-state reference.
- **Tradeoff:** A fresh install (no pre-existing DB) would need a one-shot `drizzle-kit push` or to have the schema created by the app's boot path — this plan's migration is written for the already-existing App-VM database. Fresh-install bootstrap is out of Phase 11 scope (Phase 0/initial-setup territory).
- **Files affected:** `drizzle/0000_flippant_apocalypse.sql` (trimmed to 2 statements + header comment).

**2. [Rule 3 — Blocking] `drizzle-kit` missing from `node_modules`**
- **Found during:** Task 1, step 2 (`npm run db:generate` failed with "command not found").
- **Fix:** Ran `npm install` to install the declared devDependencies. No package.json changes.

**3. [Plan guidance] No new npm package installed**
- Plan forbade new packages; none installed. `mqtt` package reserved for Plan 03.

## Known Stubs

None. All exports are live; downstream consumers (Plans 02, 03, 04) will import them next.

## Self-Check

- `src/lib/server/db/schema.ts`: FOUND, contains `accessCode` + `serialNumber` + `CameraType`
- `src/lib/server/services/bambu-credentials.ts`: FOUND
- `src/lib/server/services/bambu-credentials.test.ts`: FOUND, 4 tests pass
- `drizzle/0000_flippant_apocalypse.sql`: FOUND, 2 ALTER statements only, no DROP/RENAME/NOT NULL
- `drizzle/meta/_journal.json`: FOUND
- `drizzle/meta/0000_snapshot.json`: FOUND

## Self-Check: PASSED
