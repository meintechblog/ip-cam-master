---
phase: 18-bambu-a1-camera-integration
plan: 02
subsystem: bambu-a1-camera
tags: [tdd, pure-function, binary-fixture, protocol, auth-packet]
requires: []
provides:
  - "buildAuth(username, accessCode) -> Buffer (pure, no I/O)"
  - "Golden fixture __fixtures__/a1-auth-packet.bin (80 bytes)"
  - "Regression test guarding the 0x30-vs-0x3000 silent-fail pitfall"
affects: []
tech-stack:
  added: []
  patterns:
    - "__fixtures__/ directory for binary test assets (first in repo)"
    - "Byte-for-byte fixture assertion via readFileSync + Buffer.equals"
key-files:
  created:
    - "src/lib/server/services/bambu-a1-auth.ts"
    - "src/lib/server/services/bambu-a1-auth.test.ts"
    - "src/lib/server/services/__fixtures__/a1-auth-packet.bin"
  modified: []
decisions:
  - "No REFACTOR commit — function is 6 lines of pure transform, lifted verbatim from spike 004 (already proven byte-correct against real A1 hardware). Additional abstraction would only obscure the byte layout."
  - "Golden fixture generated deterministically at build-time via tsx one-liner against buildAuth('bblp', '20633520'); committed alongside impl."
metrics:
  completed: 2026-04-20
requirements-completed:
  - BAMBU-A1-07
---

# Phase 18 Plan 02: buildAuth Pure Function + Golden Fixture Summary

Single-source-of-truth 80-byte auth-packet encoder for Bambu Lab A1 JPEG-over-TLS (port 6000), extracted from spike 004 as a pure TypeScript function with a byte-for-byte regression test and committed 80-byte golden fixture. Permanently closes the 0x30-vs-0x3000 silent-fail pitfall (documented in spike 004 §2, CONTEXT.md D-08, RESEARCH Pitfall 1) that nearly defeated the original hardware spike.

## Task Results

### Task 1 (RED) — Failing test

- Test file `src/lib/server/services/bambu-a1-auth.test.ts` created with 5 `it(...)` blocks inside one `describe`:
  1. Length is exactly 80 bytes
  2. First 16-byte header is `[0x40,0,0,0, 0,0x30,0,0, 0,0,0,0, 0,0,0,0]` — explicit regression guard against writing `0x30` instead of `0x3000` at offset 4 (silent fail: `30 00 00 00` vs correct `00 30 00 00`)
  3. Bytes 16..19 are ASCII `"bblp"`, bytes 20..47 are zero
  4. Bytes 48..55 are ASCII `"20633520"`, bytes 56..79 are zero
  5. Output equals `readFileSync('src/lib/server/services/__fixtures__/a1-auth-packet.bin')` via `Buffer.equals`
- Vitest run output: `Test Files 1 failed` with `Error: Cannot find module './bambu-a1-auth'` (RED confirmed)
- **Commit:** `fb6e09d` — `test(18-02): byte-for-byte buildAuth fixture (MUST FAIL)`

### Task 2 (GREEN) — Impl + fixture

- `src/lib/server/services/bambu-a1-auth.ts` exports pure function:

```typescript
export function buildAuth(username: string, accessCode: string): Buffer {
    const buf = Buffer.alloc(80, 0);
    buf.writeUInt32LE(0x40, 0);
    buf.writeUInt32LE(0x3000, 4); // NOT 0x30
    buf.write(username, 16, 32, 'ascii');
    buf.write(accessCode, 48, 32, 'ascii');
    return buf;
}
```

- No imports, no `$env`, no `console.*`, no I/O — safe for any import site.
- Golden fixture generated via `npx tsx -e "..." ` against `buildAuth('bblp', '20633520')`, written to `src/lib/server/services/__fixtures__/a1-auth-packet.bin`, exactly 80 bytes.
- Vitest run output: `Test Files 1 passed | Tests 5 passed` (GREEN confirmed).
- `npx tsc --noEmit` exits 0.
- **Commit:** `347da4d` — `feat(18-02): implement buildAuth pure function`

### Task 3 (REFACTOR) — Skipped

No refactor commit. The function is a 6-line pure transform lifted verbatim from `.planning/spikes/004-a1-stream-fallback/probe.mjs` (lines 38-46), already validated byte-for-byte against the user's real A1 at `192.168.3.195`. Further abstraction (e.g., extracting named constants for `0x40`, `0x3000`, `16`, `32`, `48`) would obscure the byte layout rather than clarify it — the in-function comment + docblock already map every constant to its meaning. REFACTOR is optional per TDD cycle; zero-cost skip preferred over ceremonial commit.

## Byte Layout (per RESEARCH Gap #8, validated)

| Offset | Length | Bytes              | Meaning                                                    |
|--------|--------|--------------------|------------------------------------------------------------|
| 0      | 4      | `40 00 00 00`      | `writeUInt32LE(0x40)` — packet type                        |
| 4      | 4      | `00 30 00 00`      | `writeUInt32LE(0x3000)` — subtype (silent-fail trap)       |
| 8      | 4      | `00 00 00 00`      | reserved                                                   |
| 12     | 4      | `00 00 00 00`      | reserved                                                   |
| 16     | 32     | `62 62 6c 70 00…`  | username `"bblp"` ASCII, null-padded to 32 bytes           |
| 48     | 32     | `32 30 36 33 35 33 32 30 00…` | access code `"20633520"` ASCII, null-padded to 32 |

## Golden Fixture

- **Path:** `src/lib/server/services/__fixtures__/a1-auth-packet.bin`
- **Size:** 80 bytes (verified via `wc -c`)
- **First 16 bytes (hex):** `40 00 00 00 00 30 00 00 00 00 00 00 00 00 00 00`
- **Full hex dump** (from `xxd`):

```
00000000: 4000 0000 0030 0000 0000 0000 0000 0000  @....0..........
00000010: 6262 6c70 0000 0000 0000 0000 0000 0000  bblp............
00000020: 0000 0000 0000 0000 0000 0000 0000 0000  ................
00000030: 3230 3633 3335 3230 0000 0000 0000 0000  20633520........
00000040: 0000 0000 0000 0000 0000 0000 0000 0000  ................
```

## Downstream Consumers Unblocked

With `buildAuth` now pure and importable via `import { buildAuth } from '@/lib/server/services/bambu-a1-auth'` (or relative from sibling files), the following plans can proceed without re-implementing byte-level packet encoding:

- **Plan 03** (LXC ingestion script `lxc-assets/bambu-a1-camera.mjs`) — imports `buildAuth` for TLS handshake on port 6000
- **Plan 04** (preflight TLS check `checkTls6000Real` in `bambu-preflight.ts`) — imports `buildAuth` inside the `secureConnect` handler
- **Plan 06** (snapshot endpoint helper `bambu-a1-camera.ts`) — imports `buildAuth` for single-frame TLS pull

Any future regression in `buildAuth`'s byte layout is caught immediately by the companion test: the byte-for-byte assertion fails with a human-readable array diff, and the fixture comparison adds a second guard even if the inline assertion is accidentally weakened.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes, no Rule 4 architectural decisions, no authentication gates.

## Deferred Issues (Out of Scope)

Full `npm test` suite shows 12 pre-existing failures across 5 unrelated files (`backup.test.ts`, `update-runner.test.ts`, `proxmox-validate.test.ts`, `onboarding.test.ts`, `proxmox.test.ts`). None touch `bambu-a1-auth.*` or the `__fixtures__/` directory; all are unrelated to this plan. Per CLAUDE.md SCOPE BOUNDARY rule, these are logged as deferred and not fixed in this plan. Targeted vitest run for plan 18-02 (`npm run test:unit -- --run src/lib/server/services/bambu-a1-auth.test.ts`) is all green (5/5).

## Threat Flags

None. Reviewed files created: `bambu-a1-auth.ts` is a pure function with no new network surface, no new file access, no schema changes. The test file reads a local fixture (no external input). The fixture file is a 80-byte binary asset with a well-known structure that fails the companion test on any tamper.

## TDD Gate Compliance

- RED gate: `test(18-02): ...` commit `fb6e09d` — verified failing before impl
- GREEN gate: `feat(18-02): ...` commit `347da4d` — verified passing after impl
- REFACTOR gate: skipped (justified above)

Both mandatory gates present in git log:

```
347da4d feat(18-02): implement buildAuth pure function
fb6e09d test(18-02): byte-for-byte buildAuth fixture (MUST FAIL)
```

## Self-Check

- [x] `src/lib/server/services/bambu-a1-auth.ts` exists
- [x] `src/lib/server/services/bambu-a1-auth.test.ts` exists
- [x] `src/lib/server/services/__fixtures__/a1-auth-packet.bin` exists and is 80 bytes
- [x] Commit `fb6e09d` (RED) exists
- [x] Commit `347da4d` (GREEN) exists
- [x] `npm run test:unit -- --run src/lib/server/services/bambu-a1-auth.test.ts` passes 5/5
- [x] `npx tsc --noEmit` exits 0
- [x] No modifications to `.planning/STATE.md` or `.planning/ROADMAP.md`

## Self-Check: PASSED
