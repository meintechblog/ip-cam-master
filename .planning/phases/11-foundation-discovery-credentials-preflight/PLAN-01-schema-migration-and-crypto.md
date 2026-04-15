---
phase: 11-foundation-discovery-credentials-preflight
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/server/db/schema.ts
  - drizzle/
  - src/lib/server/services/bambu-credentials.ts
  - src/lib/server/services/bambu-credentials.test.ts
autonomous: true
requirements:
  - BAMBU-07
  - BAMBU-08
  - BAMBU-09
user_setup: []

must_haves:
  truths:
    - "The `cameras` table has two new nullable columns: `access_code` (TEXT, AES-256-GCM ciphertext) and `serial_number` (TEXT, plaintext)"
    - "`cameraType` accepts the literal `'bambu'` in addition to the existing values"
    - "Running `npm run db:migrate` against the existing App-VM database adds the columns without altering or dropping any existing Mobotix/Loxone rows"
    - "A Bambu-specific credentials helper encrypts an 8-char Access Code on write and decrypts it on read, reusing the existing `crypto.ts` AES-256-GCM implementation"
    - "Unit tests prove encrypt→decrypt round-trips an Access Code and that the ciphertext is not equal to the plaintext"
  artifacts:
    - path: "src/lib/server/db/schema.ts"
      provides: "Drizzle schema with Bambu columns on `cameras` and updated cameraType union"
      contains: "access_code"
    - path: "drizzle/"
      provides: "Generated SQL migration adding the two columns (ALTER TABLE cameras ADD COLUMN ...)"
      contains: "ADD COLUMN"
    - path: "src/lib/server/services/bambu-credentials.ts"
      provides: "encryptAccessCode / decryptAccessCode wrappers plus a typed CameraType union export"
      exports: ["encryptAccessCode", "decryptAccessCode", "BAMBU_USERNAME"]
    - path: "src/lib/server/services/bambu-credentials.test.ts"
      provides: "Vitest suite covering round-trip and ciphertext-not-plaintext assertions"
      contains: "describe"
  key_links:
    - from: "src/lib/server/services/bambu-credentials.ts"
      to: "src/lib/server/services/crypto.ts"
      via: "import { encrypt, decrypt }"
      pattern: "from '\\$lib/server/services/crypto'"
    - from: "drizzle/*.sql migration"
      to: "cameras table (data/ip-cam-master.db)"
      via: "ALTER TABLE cameras ADD COLUMN access_code TEXT / ADD COLUMN serial_number TEXT"
      pattern: "ALTER TABLE .*cameras"
---

<objective>
Extend the existing `cameras` Drizzle schema with two nullable columns (`access_code`, `serial_number`) and widen the `cameraType` union to include `'bambu'`, then ship a small AES-256-GCM wrapper module so downstream plans (02 and 03) have a typed encrypt/decrypt surface for Access Codes.

Purpose: All Bambu-specific work in Phase 11 (SSDP discovery, pre-flight handler, wizard branch) depends on these two columns existing and on a typed credential helper. This plan is the Wave-1 foundation — no other Phase-11 plan can start before it ships.

Output:
- Updated `schema.ts` with two nullable columns and extended union type
- Generated drizzle-kit migration file under `drizzle/` (committed)
- New `bambu-credentials.ts` service + vitest suite
- No changes to existing rows; migration is purely additive.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/11-foundation-discovery-credentials-preflight/11-CONTEXT.md
@.planning/research/H2C-FIELD-NOTES.md
@.planning/research/PITFALLS.md
@src/lib/server/db/schema.ts
@src/lib/server/services/crypto.ts

<interfaces>
Existing `cameras` table columns (from src/lib/server/db/schema.ts):
- id, vmid, name, ip, username, password, cameraType (default 'mobotix'),
  streamPath, width, height, fps, bitrate, streamName, rtspUrl, containerIp,
  status, createdAt, updatedAt

Existing crypto helpers (src/lib/server/services/crypto.ts):
```ts
export function encrypt(plaintext: string): string; // "iv:tag:ct" hex triple
export function decrypt(stored: string): string;
```
Key is derived from `DB_ENCRYPTION_KEY` env var via scrypt (≥32 chars required).

drizzle config (drizzle.config.ts) points at `./src/lib/server/db/schema.ts`
and `./data/ip-cam-master.db`. Migration commands: `npm run db:generate`
(creates SQL file under `drizzle/`), `npm run db:migrate` (applies it).
</interfaces>

Decisions locked in 11-CONTEXT.md §1:
- Additive only — NULLABLE columns, no data backfill, no destructive ALTER
- For Bambu rows: `username='bblp'` (constant), `password` unused, secret lives in `access_code`
- `serial_number` is plaintext (also broadcast unencrypted in SSDP per H2C-FIELD-NOTES §SSDP — no security gain from encrypting)
- `transport` column deliberately NOT added in Phase 11 (v1.3 territory)
- cameraType union: `'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu'`
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend Drizzle schema and generate migration</name>
  <files>src/lib/server/db/schema.ts, drizzle/ (generated)</files>
  <behavior>
    - After change, `schema.ts` exports `cameras` with two new optional columns: `accessCode: text('access_code')` and `serialNumber: text('serial_number')`, both NULLABLE (no `.notNull()`).
    - A top-level `export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu'` is present and usable by consumers.
    - `npm run db:generate` produces exactly one new `.sql` file under `drizzle/` containing `ALTER TABLE \`cameras\` ADD \`access_code\` text;` and `ALTER TABLE \`cameras\` ADD \`serial_number\` text;` — and no DROP / RENAME / NOT NULL statements.
  </behavior>
  <action>
    1. Edit `src/lib/server/db/schema.ts`:
       - Add two columns at the end of the `cameras` table definition (do NOT touch existing columns, do NOT reorder):
         ```ts
         accessCode: text('access_code'),        // AES-256-GCM ciphertext, NULL for non-Bambu rows
         serialNumber: text('serial_number'),    // plaintext (also in SSDP payload), NULL for non-Bambu rows
         ```
         — Both are NULLABLE (no `.notNull()`, no `.default()`).
       - Add, near the top or bottom of the file, a union type export so downstream code can import it:
         ```ts
         export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu';
         ```
    2. Run `npm run db:generate` to emit a fresh migration under `drizzle/`. Commit whatever drizzle-kit writes (expect one new numbered `.sql` file + updated `_meta/`).
    3. Inspect the generated SQL — it MUST be purely additive (two `ALTER TABLE ... ADD COLUMN` statements, nothing else). If drizzle-kit emits anything destructive, STOP and surface the diff to the user — do not commit.
    4. Do NOT run `npm run db:migrate` here (that belongs to the execute-phase deployment step, not to this planning-level task).

    Why additive only: existing Mobotix/Loxone rows must remain untouched per BAMBU-09. Any `NOT NULL` addition would require a default or a data-backfill migration, which is out of scope.
  </action>
  <verify>
    <automated>npm run check && test -n "$(ls drizzle/*.sql 2>/dev/null | tail -1)" && grep -E "ADD (COLUMN )?\`?(access_code|serial_number)\`?" drizzle/*.sql | head -4 && ! grep -Ei "DROP|RENAME|NOT NULL" drizzle/$(ls -t drizzle/*.sql | head -1 | xargs -n1 basename)</automated>
  </verify>
  <done>schema.ts exports the two new nullable columns and the `CameraType` union; a new migration file exists under `drizzle/` containing only the two `ADD COLUMN` statements; `npm run check` (svelte-check) passes with no new type errors.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship bambu-credentials service with round-trip tests</name>
  <files>src/lib/server/services/bambu-credentials.ts, src/lib/server/services/bambu-credentials.test.ts</files>
  <behavior>
    - `encryptAccessCode('12345678')` returns a string of the form `"hex:hex:hex"` (three colon-separated hex segments — the shape produced by existing crypto.ts).
    - `decryptAccessCode(encryptAccessCode('12345678'))` returns `'12345678'`.
    - Ciphertext produced by `encryptAccessCode('12345678')` is NOT equal to `'12345678'`.
    - Two successive calls to `encryptAccessCode('12345678')` return DIFFERENT ciphertexts (IV randomness).
    - Exports a constant `BAMBU_USERNAME = 'bblp'` for use by the pre-flight handler (Plan 03) and Phase 12 go2rtc template.
  </behavior>
  <action>
    Create `src/lib/server/services/bambu-credentials.ts`:
    ```ts
    import { encrypt, decrypt } from './crypto';

    /**
     * Bambu LAN-Mode MQTT / RTSPS username. Constant per H2C-FIELD-NOTES.md §MQTT.
     * All Bambu rows in the `cameras` table use this literal — it is not user-editable.
     */
    export const BAMBU_USERNAME = 'bblp' as const;

    /** Wraps an 8-char Access Code with AES-256-GCM. Thin wrapper over crypto.ts. */
    export function encryptAccessCode(accessCode: string): string {
      return encrypt(accessCode);
    }

    /** Unwraps an Access Code ciphertext. Throws if the stored value is malformed. */
    export function decryptAccessCode(stored: string): string {
      return decrypt(stored);
    }
    ```

    Create `src/lib/server/services/bambu-credentials.test.ts` using vitest:
    - `beforeAll` sets `process.env.DB_ENCRYPTION_KEY = 'x'.repeat(32)` so crypto.ts does not throw.
    - Test 1: round-trip — `decryptAccessCode(encryptAccessCode('12345678'))` returns `'12345678'`.
    - Test 2: ciphertext differs from plaintext.
    - Test 3: two encryptions of the same plaintext yield two different ciphertexts (IV randomness).
    - Test 4: `BAMBU_USERNAME` equals `'bblp'`.

    Do NOT write `src/` code that consumes these exports yet — Plans 02/03/04 import them. This plan only defines the contract.
  </action>
  <verify>
    <automated>npx vitest run src/lib/server/services/bambu-credentials.test.ts</automated>
  </verify>
  <done>bambu-credentials.ts exports `encryptAccessCode`, `decryptAccessCode`, `BAMBU_USERNAME`; vitest suite passes all four assertions; no references to the module exist in src/routes or src/lib/components yet (intentional — consumers arrive in Plans 02-04).</done>
</task>

</tasks>

<verification>
1. `npm run check` passes (no new TS errors from the schema change).
2. `npx vitest run src/lib/server/services/bambu-credentials.test.ts` passes.
3. `drizzle/*.sql` contains the two expected `ADD COLUMN` statements and nothing destructive.
4. Manual sanity: `grep -n "accessCode\|serial_number" src/lib/server/db/schema.ts` shows the new columns present.
</verification>

<success_criteria>
- schema.ts has `access_code` + `serial_number` nullable columns and `CameraType` union exported
- A committed drizzle migration file ALTERs `cameras` to add the two columns (and does nothing else)
- `bambu-credentials.ts` is importable and its tests pass
- Existing Mobotix/Loxone code paths compile and continue to pass `npm run check`
- No data migration / backfill / default-value coercion anywhere
</success_criteria>

<output>
After completion, create `.planning/phases/11-foundation-discovery-credentials-preflight/11-01-SUMMARY.md` capturing:
- Schema diff (lines added, columns, nullability)
- Migration filename generated by drizzle-kit + its exact SQL contents
- Test output (vitest summary line)
- Any surprises (e.g., drizzle-kit emitting unexpected statements, svelte-check warnings introduced)
- Explicit confirmation that `npm run db:migrate` has NOT been run yet (deployment step lives in execute-phase)
</output>
