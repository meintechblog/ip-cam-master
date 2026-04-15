---
phase: 11-foundation-discovery-credentials-preflight
plan: 02
subsystem: discovery
tags: [ssdp, bambu, udp, discovery]
requirements: [BAMBU-03, BAMBU-04, BAMBU-06]
key-files:
  created:
    - src/lib/server/services/bambu-discovery.ts
    - src/lib/server/services/bambu-discovery.test.ts
  modified:
    - src/routes/api/discovery/+server.ts
completed: 2026-04-15
---

# Phase 11 Plan 02: SSDP Discovery Service + /api/discovery Merge — Summary

One-liner: Bambu SSDP listener on UDP 2021 merged into `/api/discovery` via Promise.all; pure parser + live dgram listener in one module, covered by 5 unit tests against the verbatim H2C field-notes payload.

## What shipped

### `src/lib/server/services/bambu-discovery.ts`

- `parseNotifyPayload(raw, sourceIp)` — pure parser. Lowercases header keys (first-occurrence-wins), rejects any packet whose `NT:` ≠ `urn:bambulab-com:device:3dprinter:1`, rejects any `DevModel.bambu.com` outside the allowlist, and returns `{ ip, serialNumber, model, modelLabel, name }`.
- `BAMBU_MODEL_ALLOWLIST` = `['O1C2', 'H2C', 'H2D', 'X1C', 'P1S', 'A1']` (H2C reports as `O1C2`; allowlist includes the human codes for forward-compat).
- `MODEL_LABELS` maps `O1C2 → "Bambu Lab H2C"`. Unknown-but-allowlisted codes fall through to `"Bambu Lab <code>"`.
- `discoverBambuDevices({ listenMs=6000, port=2021 })` — opens `dgram.createSocket({ type:'udp4', reuseAddr:true })`, binds UDP **2021** (per H2C-FIELD-NOTES §SSDP, NOT 1990 — the `Host:` header is misleading), calls `setBroadcast(true)`, collects NOTIFY packets for the listen window, de-dupes by source IP. Always resolves; socket errors produce an empty list. Uses a `settled` guard so the shutdown timer and error path don't double-resolve.

### `src/lib/server/services/bambu-discovery.test.ts`

5 vitest cases, all passing:
1. Canonical H2C payload (verbatim from H2C-FIELD-NOTES.md §SSDP) → `{ ip:'192.168.3.109', serialNumber:'31B8BP611201453', model:'O1C2', modelLabel:'Bambu Lab H2C', name:'Bob the Builder' }`.
2. Synthetic A1 payload at 192.168.3.195 → `model:'A1', modelLabel:'Bambu Lab A1'`.
3. Generic UPnP NOTIFY (`NT: urn:schemas-upnp-org:device:MediaServer:1`) → `null`.
4. Bambu-URN NOTIFY with `DevModel: Z9Z9` → `null`.
5. `BAMBU_MODEL_ALLOWLIST` contains exactly the 6 documented codes.

### `src/routes/api/discovery/+server.ts` — diff summary

1. Widened `DiscoveredCamera.type` to include `'bambu'`; added three OPTIONAL fields: `serialNumber?: string`, `model?: string`, `lanModeHint?: 'likely_on'`.
2. Added `import { discoverBambuDevices } from '$lib/server/services/bambu-discovery'`.
3. Extracted the existing HTTP-probe scan (bash-script build → `execAsync` → stdout parse → saved-credentials name lookup) into a nested `runExistingHttpScan()` async closure. Behavior preserved bit-for-bit — no reordering, no regex changes, same `timeout: 60000` / `--max-time 1` safeguards.
4. Replaced the single `await execAsync(...)` + sort flow with:
   ```ts
   const [httpScanResult, bambuDevices] = await Promise.all([
     runExistingHttpScan(),
     discoverBambuDevices({ listenMs: 6000 })
   ]);
   ```
5. Mapped `bambuDevices` → `DiscoveredCamera[]` with `type:'bambu'`, `lanModeHint:'likely_on'`, and the `serialNumber` / `model` / `name` carried from the parser.
6. Merged via `Map<ip, DiscoveredCamera>` — HTTP rows inserted first, Bambu rows inserted after, so on IP collision the Bambu row wins (strictly more informative). Final sort on last-octet ascending preserved.
7. Outer try/catch still returns `{ cameras: [], error }` on failure.

## Verification

- `npx vitest run src/lib/server/services/bambu-discovery.test.ts` → **5 passed** (95 ms).
- `npm run check` → **0 errors**, 19 pre-existing warnings (all in unrelated components: CameraDetailCard, DeleteConfirmDialog, EventFilters, OnboardingWizard, ProxmoxTab, UnifiTab, settings/+page — none touched by this plan).

## Deviations from plan

- Added a `settled` guard in `discoverBambuDevices` to prevent double-resolution if the socket errors after the listen-window timer fires (or vice versa). Not spelled out in the plan but the plan's sketch had the same latent bug (`done()` being callable twice via `sock.on('error')` + `setTimeout`). **Rule 1 — Bug.** No behavior change in the happy path; only hardens error handling.
- Wrapped the `sock.bind(port, …)` call in a try/catch for defense-in-depth (EADDRINUSE throws synchronously on some platforms when `reuseAddr` isn't honored). **Rule 2 — Critical robustness.** Matches the plan's explicit guardrail: "If UDP bind(2021) fails … log and return empty."

## Known stubs / follow-ups

None. The parser and listener are complete for Plan 11-02's scope. Plan 11-04 will consume `type === 'bambu'` rows and the `serialNumber` / `model` / `lanModeHint` annotations in the onboarding wizard.

## Self-Check: PASSED

- src/lib/server/services/bambu-discovery.ts: FOUND
- src/lib/server/services/bambu-discovery.test.ts: FOUND
- src/routes/api/discovery/+server.ts: FOUND (modified)
- vitest: 5/5 passing
- svelte-check: 0 errors
