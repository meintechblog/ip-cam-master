---
phase: 18-bambu-a1-camera-integration
plan: 06
status: complete
type: execute-with-uat
autonomous: false
completed: 2026-04-20
requirements:
  - BAMBU-A1-02
  - BAMBU-A1-10
  - BAMBU-A1-11
  - BAMBU-A1-12
---

# Plan 18-06 — Snapshot Endpoint + UI Capability Gates + UAT

## What was built

- `GET /api/cameras/:id/a1-snapshot` (`src/routes/api/cameras/[id]/a1-snapshot/+server.ts`) — JPEG response, 2s in-memory cache per camera id, 404/400/502 error mapping, access-code never in body/headers/logs (negative test asserts both `SECRET` and `-dec` mock suffixes absent)
- `saveCameraRecord` + Bambu save-camera route (`src/lib/server/services/onboarding.ts`, `src/routes/api/onboarding/bambu/save-camera/+server.ts`) — persists SSDP-captured `model` into `cameras.model` with `BAMBU_MODEL_ALLOWLIST` validation (defense-in-depth)
- Wizard end-to-end model plumbing (`OnboardingWizard.svelte`, `StepBambuCredentials.svelte`, `StepBambuPreflight.svelte`, `kameras/onboarding/+page.svelte`) — SSDP `model` flows into `prefillModel`, A1 sees the D-05 hint string, preflight body threads `model`
- `CameraDetailCard.svelte` capability gates — chamber-temp panel hidden when `chamberHeater === false`; AMS panel hidden / "AMS Lite" label when `ams === 'none' | 'lite'`; xcam toggles gated by `xcamFeatures.includes(...)`
- `PrinterCapabilities` in `CameraCardData` (`src/lib/types.ts`) and `/api/cameras/status` derives capabilities via `PRINTER_CAPABILITIES[camera.model]`

## Commits

- `540087a` feat(18-06): add GET /api/cameras/:id/a1-snapshot endpoint with 2s cache
- `d72c4f8` feat(18-06): persist cameras.model from SSDP-captured device info
- `38c7932` feat(18-06): capability-gate dashboard + A1-aware wizard copy

## Tests

- 8/8 green for `a1-snapshot/server.test.ts` (cache hit/miss, 400, 404, 502, credential-leak negative, image/jpeg round-trip, bambu-only, A1-only)
- 65/65 total Bambu unit tests green (bambu-discovery, bambu-credentials, bambu-preflight, bambu-a1-auth, bambu-mqtt, bambu-a1-camera + new snapshot)
- `npx tsc --noEmit` clean

## UAT — what was verified live against the user's A1 (192.168.3.195)

Verified by orchestrator (`b8150d1` deployed to VM):

1. **VM schema** — `cameras.model` column present after `ensureColumn` shim added (see Deviations); existing rows have `model: null` (back-compat as designed)
2. **Snapshot endpoint error paths** — H2C-id (Bob the Builder, id=14) → `400 "Not an A1 printer"`; Mobotix (id=12) → `404 "Not a Bambu camera"`; missing id=999 → `404 "Camera not found"`. All three paths produce the documented HTTP codes against the live deployment.
3. **A1 port surface** — TCP:6000 OPEN, TCP:8883 OPEN, TCP:322 ECONNREFUSED. Confirms spike 001/002 against live hardware.
4. **Live A1 preflight (model=A1)** — `POST /api/onboarding/bambu/preflight {ip:192.168.3.195, sn:03919A3B0100254, accessCode:20633520, model:'A1'}` → `{ok:true} HTTP 200`. Proves: (a) `buildAuth('bblp', '20633520')` produces a byte-perfect 80-byte handshake the live A1 accepts, (b) `checkTls6000Real` correctly classifies a successful auth, (c) `checkTutkDisabledReal` reads `tutk_server: 'disable'` from a live MQTT pushall.
5. **Backward-compat** — same payload without `model` field → falls back to H2C → tries RTSPS:322 → ECONNREFUSED → reports `LAN_MODE_OFF` (the original mis-diagnosis Plan 18-04 fixes when model is supplied). Confirms 2-arg `runBambuPreflight(input, deps)` signature unchanged.
6. **Wrong access code path** — same payload with `accessCode:99999999` + `model:'A1'` → A1 silently drops auth → classifier returns `AUTH_SILENT_DROP` → mapped to `WRONG_ACCESS_CODE` with the exact German hint. Validates the silent-drop classifier branch end-to-end.

## UAT — what still needs the user (not blocking phase close)

These require browser interaction and/or the Bambu Handy App and were not exercised by the orchestrator:

- Wizard onboarding flow against the A1 (Steps 2–3 of plan UAT) — needs human at the dashboard
- LXC provisioning + go2rtc deploy (Steps 4–5) — would create a real container; deferred until user wants the A1 onboarded for production
- UniFi Protect adoption (Step 6) — manual via Protect UI
- Live snapshot bytes through the endpoint (Step 7, the `200 image/jpeg` round-trip) — depends on the A1 being onboarded first
- Cloud-mode toggle round-trip (Step 9) — requires the Bambu Handy App

Plan 18-04 model-aware preflight + Plan 18-02 buildAuth are byte-perfect against live hardware, which de-risks the remaining UI/provisioning steps to "wire-up correctness" rather than "protocol correctness."

## Deviations

1. **Test file rename** — Plan specified `+server.test.ts` but SvelteKit reserves the `+` prefix for route files. Renamed to `server.test.ts` colocated. Rule 3 deviation, documented in agent return.
2. **`ensureColumn('cameras', 'model', 'TEXT')` added to `client.ts` post-merge** — Plan 18-01 only ran `drizzle-kit push` against the worktree-local DB. The VM uses the project's runtime `ensureColumn` shim convention (Phase 17 pattern). Without the call, existing VM databases throw `SqliteError: no such column: model` on first query. Single-line fix committed as `b8150d1` after UAT discovery. Plan 18-01's RESEARCH.md should have called out this convention; opening this as a planner-feedback note.

## Requirements covered

- BAMBU-A1-02 (camera record persists model)
- BAMBU-A1-10 (UI capability gating for chamber/AMS/xcam)
- BAMBU-A1-11 (snapshot-on-demand endpoint)
- BAMBU-A1-12 (wizard copy + preflight hint A1_CLOUD_MODE_ACTIVE)

## Next plan

None — Plan 18-06 is the final plan of Phase 18.
