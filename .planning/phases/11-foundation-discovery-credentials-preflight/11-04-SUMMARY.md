---
phase: 11-foundation-discovery-credentials-preflight
plan: 04
subsystem: onboarding-ui
tags: [svelte, onboarding, bambu, wizard, preflight-ui]
requires: [11-01, 11-02, 11-03]
provides:
  - "Bambu-branch onboarding wizard (Serial + Access Code)"
  - "Discovery list differentiates Bambu rows (Printer icon, LAN Mode chip)"
  - "Manual-add Bambu Lab radio option"
  - "Pre-flight verdict UI with German hints for all 4 error codes"
affects:
  - src/lib/components/onboarding/OnboardingWizard.svelte
  - src/routes/kameras/onboarding/+page.svelte
tech-stack:
  added: []
  patterns:
    - "Svelte 5 runes ($state/$derived/$effect/$props) matching existing wizard components"
    - "Parallel branch in OnboardingWizard — Bambu early-return, zero changes to Mobotix/Loxone code paths"
    - "Client-duplicated PREFLIGHT_HINTS_DE strings for offline fallback (server is authoritative)"
key-files:
  created:
    - src/lib/components/onboarding/StepBambuCredentials.svelte
    - src/lib/components/onboarding/StepBambuPreflight.svelte
  modified:
    - src/lib/components/onboarding/OnboardingWizard.svelte
    - src/routes/kameras/onboarding/+page.svelte
decisions:
  - "Bambu branch is strictly additive — wrapped existing template in {#if cameraType === 'bambu'} / {:else}. No existing prop or behavior changed."
  - "Bambu rows naturally excluded from pipelineCameras (existing filter was mobotix|loxone-only — Bambu adds nothing)."
  - "Manual-add UX: radio toggle switches the form between the existing Mobotix/Loxone wizard and a new Bambu IP-only entry that hands off to the credential step."
  - "AbortController 25s client-side timeout on the pre-flight fetch (server worst-case = 20s); abort is treated as PRINTER_UNREACHABLE."
  - "Pre-flight OK terminal state stops at 'bereit für LXC-Provisionierung (Phase 12)' — no container creation this phase, per plan guardrail."
metrics:
  duration: "~15 min"
  completed: "2026-04-15"
  tasks: 2
  files_touched: 4
---

# Phase 11 Plan 04: Bambu Wizard Branch Summary

Wired the Phase-11 backend capabilities (SSDP discovery + pre-flight handler) into the onboarding UI so users can select "Bambu Lab" as a device type, enter Serial + Access Code, and receive a German-labelled pre-flight verdict.

## What Changed

**New components** (~200 LOC total):

- `src/lib/components/onboarding/StepBambuCredentials.svelte` (74 lines) — Serial Number + Access Code inputs, German labels, monospace 8-char Access Code field with `maxlength="8"`, `tracking-widest`, helper text pointing to the printer display path. Prefills `prefillSerial` from SSDP USN when coming from discovery. "Weiter" disabled until both fields non-empty.
- `src/lib/components/onboarding/StepBambuPreflight.svelte` (~125 lines) — On `$effect` mount, POSTs to `/api/onboarding/bambu/preflight`. Three states: `running` (spinner + "Pre-Flight läuft (TCP → RTSPS → MQTT, bis zu 20 s)"), `ok` (green check, "Pre-Flight erfolgreich — bereit für LXC-Provisionierung (Phase 12)"), `error` (red X + error-code subtitle + German `hint` from server). For `RTSPS_HANDSHAKE_HUNG` appends the power-cycle guidance per PITFALLS §1. 25s AbortController client-side timeout; on abort treats as PRINTER_UNREACHABLE. Fallback copy of `PREFLIGHT_HINTS_DE` duplicated locally in case server response is malformed (server is still authoritative). No server-only imports.

**OnboardingWizard.svelte** (+47 / -1 lines):

- Added `prefillSerial?: string` prop.
- Imported `StepBambuCredentials`, `StepBambuPreflight`, `Printer` (lucide).
- New state block (`bambuIp`, `bambuSerial`, `bambuAccessCode`, `bambuStep: 'credentials' | 'preflight' | 'done'`) and three handlers (`handleBambuCredentialsSubmit`, `handleBambuPreflightDone`, `handleBambuPreflightRetry`).
- Wrapped the existing template in `{#if cameraType === 'bambu'} ... {:else} <existing wizard> {/if}` — Mobotix/Loxone branches remain byte-identical.
- Bambu terminal state: "Pre-Flight bestanden" + link back to `/kameras` (no container creation in Phase 11).

**+page.svelte** (~+60 lines):

- Widened local `discovered` row type: `type: 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu' | 'unknown'` + optional `serialNumber`, `model`, `lanModeHint`.
- `selectedSerial` state; passed to `<OnboardingWizard prefillSerial={selectedSerial}>`.
- `selectCamera` signature extended with optional `serialNumber` (Bambu path sets it, skips generic credential fetch).
- Discovery list: new `{:else if cam.type === 'bambu'}` branch renders a `Printer` icon (orange), "BAMBU LAB {model}" badge, "LAN Mode" chip when `lanModeHint === 'likely_on'`, and an orange "Einrichten" button that opens the wizard with `cameraType='bambu'` + prefilled serial.
- Manual-add: radio toggle between "Mobotix / Loxone" (existing wizard) and "Bambu Lab" (IP-only input → opens Bambu wizard with that IP). `manualDeviceType`, `manualBambuIp` state + `startManualBambu()` handler.
- `pipelineCameras` derived filter already excludes Bambu (was `mobotix|loxone`-only) — Bambu never enters the batch pipeline. BAMBU-06 guardrail satisfied.

## Verification

- `npm run check` → **0 errors, 22 warnings**. All warnings are pre-existing (a11y, `state_referenced_locally` in settings/cameras files). The two `state_referenced_locally` warnings my code introduced on `prefillSerial` / `prefillIp` follow the exact same pattern as pre-existing `prefillUsername` / `prefillPassword` / `prefillName` warnings in the same file — these are Svelte-5-runes warnings for prop init-value capture inside `$state()` initialisers, intentional to preserve parity with existing code (Rule scope: do not refactor unrelated patterns).
- No new npm packages installed.
- No server-only modules imported into client components (verified: StepBambuPreflight does not import from `bambu-preflight.ts`; only the JSON wire-format is shared).
- Plan 01/02/03 files untouched (verified: `git diff --stat` shows no changes under `schema.ts`, `bambu-discovery.ts`, `bambu-preflight.ts`, or the preflight route).
- Existing Mobotix/Loxone wizard template rendered via the `{:else}` branch — functionally unchanged; smoke-check deferred to the human-verify checkpoint.

## Checkpoint Status

**Task 3 (human-verify) NOT executed** — per instructions, this plan's final checkpoint is the user testing the wizard against their real H2C at 192.168.3.109. The parent orchestrator will drive that separately.

**What the user should click through (deferred checkpoint preview):**

1. Browse to `/kameras/onboarding`.
2. Scenario A: Wait for auto-scan; confirm the H2C "Bob the Builder" (or "Bambu Lab H2C") appears as a Bambu row with the orange Printer icon + "BAMBU LAB O1C2" badge + "LAN Mode" chip, distinct from any Mobotix/Loxone rows.
3. Scenario B (happy path): Click Einrichten → confirm Serial prefilled to `31B8BP611201453` → enter correct 8-char Access Code → click "Weiter — Pre-Flight prüfen" → within ~5s expect green "Pre-Flight erfolgreich" → "Fertig" returns to `/kameras`.
4. Scenario C (wrong code): Same, enter `00000000` → expect red X + `WRONG_ACCESS_CODE` + German hint "Access Code abgelehnt...".
5. Scenario D (LAN Mode off): Toggle LAN Mode OFF on the printer, wait 10s, retry → expect `LAN_MODE_OFF` + "LAN Mode scheint deaktiviert...". Toggle back ON.
6. Scenario E (manual-add unreachable): In the manual-add block at top of page, select the "Bambu Lab" radio, enter a bogus IP like `192.168.3.250`, click Weiter, enter any Serial + any 8 chars, submit → expect `PRINTER_UNREACHABLE` + "Drucker nicht erreichbar...".
7. Regression: Run one existing Mobotix camera through the default wizard (radio left on "Mobotix / Loxone") to confirm no regression.

## Deviations

None — plan executed as written. Minor spec interpretation: the plan's manual-add text said "Locate the existing manual-add form" — there was no dedicated form block in the file; the manual-add path was simply `<OnboardingWizard nextVmid={data.nextVmid} />`. I added a thin device-type chooser above that wizard (radio + conditional IP input for Bambu) rather than inventing a fake form to slot a radio into. This matches the plan's intent (BAMBU-05: device-type radio, accept IP only) without over-engineering.

## Known Stubs

None. All rendered states are wired to the real server endpoint and SSDP discovery payload.

## Deferred to Phase 14

- Inline help links ("Wo finde ich den Access Code?") — explicitly deferred per 11-CONTEXT §5.
- Polished firmware checklist in the credential step.
- Screenshot previews of the printer display for German users.

## Files Changed

| Path | LOC delta |
|------|-----------|
| src/lib/components/onboarding/StepBambuCredentials.svelte | +74 (new) |
| src/lib/components/onboarding/StepBambuPreflight.svelte | +125 (new) |
| src/lib/components/onboarding/OnboardingWizard.svelte | +47 / -1 |
| src/routes/kameras/onboarding/+page.svelte | +60 / -8 |

## Self-Check: PASSED

- `src/lib/components/onboarding/StepBambuCredentials.svelte` — FOUND
- `src/lib/components/onboarding/StepBambuPreflight.svelte` — FOUND
- OnboardingWizard.svelte contains `StepBambuCredentials` + `StepBambuPreflight` imports — verified
- +page.svelte contains `cam.type === 'bambu'` branch + `manualDeviceType === 'bambu'` — verified
- `npm run check` — 0 errors
