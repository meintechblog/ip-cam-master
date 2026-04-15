---
phase: 11-foundation-discovery-credentials-preflight
plan: 04
type: execute
wave: 3
depends_on:
  - 01
  - 02
  - 03
files_modified:
  - src/lib/components/onboarding/OnboardingWizard.svelte
  - src/lib/components/onboarding/StepBambuCredentials.svelte
  - src/lib/components/onboarding/StepBambuPreflight.svelte
  - src/routes/kameras/onboarding/+page.svelte
autonomous: false
requirements:
  - BAMBU-04
  - BAMBU-05
  - BAMBU-06
  - BAMBU-07
  - BAMBU-10
user_setup:
  - service: bambu-h2c-printer
    why: "The wizard checkpoint requires a real H2C on the LAN to verify end-to-end"
    dashboard_config:
      - task: "Ensure H2C (192.168.3.109) is powered on and connected to the LAN"
        location: "Physical printer"
      - task: "Ensure LAN Mode is enabled and Access Code is visible"
        location: "Printer display → Einstellungen → Netzwerk → LAN Mode + Access Code"

must_haves:
  truths:
    - "The onboarding wizard's device-type chooser shows a `Bambu Lab` tile alongside Mobotix / Mobotix-ONVIF / Loxone"
    - "Selecting Bambu routes through a dedicated credential step (Serial Number + 8-char Access Code, monospace input) — NOT the generic username/password step"
    - "Discovery result list visually differentiates Bambu rows (distinct icon/label) from Mobotix/Loxone/ONVIF rows — BAMBU-06 compliant"
    - "The Bambu credential step posts to `POST /api/onboarding/bambu/preflight` and renders one of five outcomes: ok / PRINTER_UNREACHABLE / LAN_MODE_OFF / WRONG_ACCESS_CODE / RTSPS_HANDSHAKE_HUNG — each with the corresponding German hint from PREFLIGHT_HINTS_DE"
    - "Manual-add path accepts `Bambu Lab` as a device-type option and carries it through to the Bambu credential step"
    - "A human-verify checkpoint confirms the wizard works against the user's real H2C at 192.168.3.109"
  artifacts:
    - path: "src/lib/components/onboarding/StepBambuCredentials.svelte"
      provides: "Serial + Access Code input step; calls pre-flight on submit"
      contains: "accessCode"
    - path: "src/lib/components/onboarding/StepBambuPreflight.svelte"
      provides: "Renders pre-flight verdict + German hints"
      contains: "PREFLIGHT_HINTS_DE"
    - path: "src/lib/components/onboarding/OnboardingWizard.svelte"
      provides: "Extended with Bambu device-type tile + Bambu branch routing"
      contains: "bambu"
    - path: "src/routes/kameras/onboarding/+page.svelte"
      provides: "Discovery list differentiates Bambu rows; manual-add has Bambu radio option"
      contains: "bambu"
  key_links:
    - from: "StepBambuCredentials.svelte"
      to: "/api/onboarding/bambu/preflight"
      via: "fetch POST with JSON body {ip, serialNumber, accessCode}"
      pattern: "/api/onboarding/bambu/preflight"
    - from: "+page.svelte discovery list"
      to: "type === 'bambu'"
      via: "conditional render for Bambu-specific icon/label"
      pattern: "type === 'bambu'"
---

<objective>
Complete the Phase-11 user-visible slice: extend the onboarding wizard with a Bambu branch so the user can select "Bambu Lab" as a device type, enter Serial + Access Code, and see a clear pre-flight verdict. Also surface Bambu rows distinctly in the discovery result list.

Purpose: Plans 01-03 deliver schema, discovery, and pre-flight API — but with no UI change the user still can't onboard a Bambu printer. This plan wires the three backend capabilities into the wizard and closes BAMBU-04, 05, 06, 07, 10 from the user's perspective. Polish (inline help, firmware checklist) is explicitly deferred to Phase 14 per 11-CONTEXT §5.

Output:
- Two new Svelte components (StepBambuCredentials, StepBambuPreflight)
- Modifications to OnboardingWizard.svelte and kameras/onboarding/+page.svelte
- A `checkpoint:human-verify` task that gates phase completion on the user confirming the wizard works against their real H2C (192.168.3.109)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/11-foundation-discovery-credentials-preflight/11-CONTEXT.md
@.planning/research/H2C-FIELD-NOTES.md
@src/lib/components/onboarding/OnboardingWizard.svelte
@src/routes/kameras/onboarding/+page.svelte
@src/routes/api/onboarding/test-connection/+server.ts
@.planning/phases/11-foundation-discovery-credentials-preflight/11-01-SUMMARY.md
@.planning/phases/11-foundation-discovery-credentials-preflight/11-02-SUMMARY.md
@.planning/phases/11-foundation-discovery-credentials-preflight/11-03-SUMMARY.md

<interfaces>
Pre-flight endpoint contract (from Plan 03):
```ts
POST /api/onboarding/bambu/preflight
body: { ip: string; serialNumber: string; accessCode: string }

// Response (HTTP 200):
{ ok: true }
// or
{ ok: false; error: 'PRINTER_UNREACHABLE' | 'LAN_MODE_OFF' | 'WRONG_ACCESS_CODE' | 'RTSPS_HANDSHAKE_HUNG'; hint: string }
// HTTP 400 on missing fields:
{ ok: false; error: 'INVALID_INPUT'; hint: string }
```

Discovery response (from Plan 02) when a Bambu device is present:
```ts
{ ip: '192.168.3.109', type: 'bambu', alreadyOnboarded: false,
  name: 'Bob the Builder', serialNumber: '31B8BP611201453',
  model: 'O1C2', lanModeHint: 'likely_on' }
```

Wizard pre-existing shape (from src/lib/components/onboarding/OnboardingWizard.svelte — read in full before editing):
- Takes `cameraType: string` prop (currently 'mobotix' | 'mobotix-onvif' | 'loxone')
- Extend the switch/derived to include 'bambu'

Existing discovery list in +page.svelte line ~755, 926: currently branches on `cam.type === 'loxone'` / `'mobotix'` — add a sibling branch for `'bambu'` with a distinct icon (lucide-svelte has `Printer` or `Box` — pick one not already used).
</interfaces>

**Scope guardrails from 11-CONTEXT §5:**
- Inline help links & firmware checklists → Phase 14 (NOT here)
- Polished wizard UX → Phase 14
- Phase 11 ships "functional, not polished"
- Do NOT create LXC / go2rtc configs from this step — a successful pre-flight ends the Phase-11 wizard branch with "pre-flight passed — ready for provisioning in a later phase"
- The existing `test-connection` endpoint is NOT modified in this plan (Bambu gets its own pre-flight route instead — cleaner separation than dispatching inside test-connection, and keeps the existing Mobotix/Loxone code untouched)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Two new Bambu step components</name>
  <files>src/lib/components/onboarding/StepBambuCredentials.svelte, src/lib/components/onboarding/StepBambuPreflight.svelte</files>
  <action>
    Create `StepBambuCredentials.svelte` (Svelte 5 runes syntax, matching the existing components' style):

    - Props (Svelte 5 `$props()`): `{ ip: string; prefillSerial?: string; onSubmit: (result: { serialNumber: string; accessCode: string }) => void }`.
    - State (`$state`): `serialNumber`, `accessCode`.
    - Two inputs:
      - Serial Number — text input, labeled "Seriennummer" (German, matching existing wizard copy language), prefilled if `prefillSerial` is set (from SSDP discovery USN).
      - Access Code — text input, `font-mono` Tailwind class, `maxlength="8"`, `inputmode="text"`, labeled "Access Code", placeholder `"z.B. 12345678"`, with a small helper line: `"Am Drucker-Display: Einstellungen → Netzwerk → Access Code"`.
    - A "Weiter" (Next) button disabled until both fields are non-empty (trimmed); on click calls `onSubmit({ serialNumber: serialNumber.trim(), accessCode: accessCode.trim() })`.
    - No API call from this component — it only collects input and hands off to the parent. The pre-flight fetch lives in `StepBambuPreflight`.

    Create `StepBambuPreflight.svelte`:

    - Props: `{ ip: string; serialNumber: string; accessCode: string; onDone: (ok: boolean) => void; onRetry: () => void }`.
    - On mount (`$effect` or a top-level `onMount`), POST to `/api/onboarding/bambu/preflight` with `{ ip, serialNumber, accessCode }` and set local state `{ status: 'running' | 'ok' | 'error', error?: string, hint?: string }`.
    - While `status === 'running'`: show a spinner + "Pre-Flight läuft (TCP → RTSPS → MQTT, bis zu 20 s)".
    - On `{ ok: true }`: show green checkmark + "Pre-Flight erfolgreich — bereit für LXC-Provisionierung (Phase 12)" + a "Fertig" button calling `onDone(true)`.
    - On `{ ok: false, error, hint }`: show red X, the error code as a subtitle, the German `hint` as body text, and TWO buttons:
      - "Erneut prüfen" → calls `onRetry()` (parent routes back to the credentials step)
      - "Abbrechen" → calls `onDone(false)`
    - Additionally for `error === 'RTSPS_HANDSHAKE_HUNG'`: append the extra copy *"Drucker bitte kurz aus- und wieder einschalten, dann erneut versuchen. (Live555-Bug, bekannt — siehe Dokumentation.)"* — this mirrors PITFALLS §1 guidance.
    - Fetch has an AbortController with a 25 s client-side timeout (the server worst case is tcp 3 + rtsps 12 + mqtt 5 = 20 s; 25 s gives margin). On client-side abort: treat as PRINTER_UNREACHABLE.
    - No import from `bambu-preflight.ts` (that's a server-only module — don't accidentally bundle `mqtt` into the client). The component works off the JSON response shape documented in `<interfaces>` above; duplicate the German hint strings inline since the server sends them.

    Both components use existing Tailwind utilities; no new styles. Keep each file under ~120 lines.
  </action>
  <verify>
    <automated>npm run check</automated>
  </verify>
  <done>Both Svelte components exist, compile (no svelte-check errors), use Svelte 5 runes, do not import server-only modules, and render the documented states. `npm run check` passes.</done>
</task>

<task type="auto">
  <name>Task 2: Wire Bambu branch into wizard + discovery page</name>
  <files>src/lib/components/onboarding/OnboardingWizard.svelte, src/routes/kameras/onboarding/+page.svelte</files>
  <action>
    **OnboardingWizard.svelte:**
    - Widen the `cameraType` prop type to include `'bambu'`.
    - Add a branch when `cameraType === 'bambu'`:
      - Step 1: render `<StepBambuCredentials>` with prefilled serial (received from the selected discovery row, if present).
      - Step 2: render `<StepBambuPreflight>` with the collected creds.
      - Do NOT reuse `StepCredentials` (generic user/pass) or `StepTestConnection` (Mobotix/Loxone-specific) — Bambu has its own shape.
    - On pre-flight success (`onDone(true)`): for Phase 11, advance to a simple terminal state ("Pre-Flight bestanden — LXC-Provisionierung folgt in Phase 12"). Do NOT trigger container creation in this phase.
    - On pre-flight failure abort (`onDone(false)`): close the wizard (same behavior as existing Mobotix cancel).
    - Keep existing Mobotix / Mobotix-ONVIF / Loxone branches byte-identical — this is strictly additive.

    **src/routes/kameras/onboarding/+page.svelte:**

    1. **Discovery list differentiation (BAMBU-06)** — Around line 755 and line 926 (both locations branch on `cam.type`), add a sibling branch for `cam.type === 'bambu'`:
       - Icon: lucide-svelte `Printer` (import it; the existing imports already include other lucide icons — follow that pattern).
       - Label: `cam.name ?? 'Bambu Lab H2C'` (name from SSDP when present) + badge showing `cam.model ?? 'Bambu'` + a small "LAN Mode" chip when `cam.lanModeHint === 'likely_on'`.
       - Clicking the row sets `selectedCameraType = 'bambu'` and opens the wizard with `cameraType='bambu'`, passing `selectedIp=cam.ip` and a new prop `selectedSerial=cam.serialNumber` (plumb this through OnboardingWizard to StepBambuCredentials's `prefillSerial`).
       - Ensure Bambu rows are EXCLUDED from the existing `pipelineCameras = $derived(discovered.filter(c => c.type === 'mobotix' || c.type === 'loxone'))` — Bambu does NOT belong in the batch pipeline (Phase 11 ships one-at-a-time wizard only, batch comes later).

    2. **Manual-add Bambu radio (BAMBU-05)** — Locate the existing manual-add form (the "Kamera manuell hinzufügen" block — use grep to find it in +page.svelte). Add a third radio option alongside the existing device-type choices: `Bambu Lab`. Selecting it and submitting opens the wizard with `cameraType='bambu'` and `selectedIp=<user-entered IP>`; no serial is pre-filled (user enters it in the credential step).

    3. **Type definition update** — The local type for discovered cameras in +page.svelte must include the new optional fields (`serialNumber?: string; model?: string; lanModeHint?: string; type: 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu' | 'unknown'`).

    **Guardrails:**
    - Do NOT refactor the existing pipeline/batch onboarding code — the Bambu path is a parallel, self-contained branch.
    - Do NOT modify `/api/onboarding/test-connection` — Bambu uses its own endpoint.
    - If any existing code path breaks (e.g., `promptForCredentials` typed against a narrower union), adjust the local type rather than widening the shared contract.
  </action>
  <verify>
    <automated>npm run check</automated>
  </verify>
  <done>Wizard accepts `cameraType='bambu'` and routes through StepBambuCredentials → StepBambuPreflight; discovery list renders Bambu rows with a distinct icon/label and excludes them from `pipelineCameras`; manual-add exposes a Bambu Lab radio; `npm run check` passes; existing Mobotix/Loxone flows remain functionally unchanged (smoke-check by loading the page).</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human verification against real H2C at 192.168.3.109</name>
  <what-built>
    A fully wired Bambu branch in the onboarding wizard:
    - Discovery list shows Bambu printers with a distinct icon/label
    - Manual-add has a "Bambu Lab" option
    - Bambu credential step collects Serial + Access Code
    - Pre-flight step shows one of five verdicts (ok / 4 error codes) with German hints
  </what-built>
  <how-to-verify>
    Run these five scenarios against the real H2C "Bob the Builder" (192.168.3.109) and confirm each produces the expected outcome. Deploy the app to the App-VM first (`rsync -av --exclude data/ ./ root@192.168.3.233:/opt/ip-cam-master/ && ssh root@192.168.3.233 'cd /opt/ip-cam-master && npm install && npm run build && systemctl restart ip-cam-master'`), then browse to `http://192.168.3.233:3000/kameras/onboarding`.

    **Scenario A — Discovery (BAMBU-03/04/06):**
    1. Confirm H2C is powered on and LAN Mode is enabled.
    2. On the onboarding page, click "Netzwerk scannen" (or equivalent).
    3. Within ~10 s, confirm the list shows a row labeled "Bob the Builder" (or "Bambu Lab H2C" if name blank) at 192.168.3.109, with a distinct Printer icon and a "LAN Mode" chip.
    4. Confirm the Bambu row visually differs from any Mobotix/Loxone rows on the same network (different icon or badge).

    **Scenario B — Happy path (BAMBU-07 + BAMBU-10 ok):**
    1. Click the discovered H2C row.
    2. Confirm the credential step pre-fills Serial = `31B8BP611201453`.
    3. Enter the correct 8-char Access Code from the printer display.
    4. Click "Weiter". Within ~5 s, expect the green "Pre-Flight erfolgreich" state.

    **Scenario C — Wrong Access Code (BAMBU-10 WRONG_ACCESS_CODE):**
    1. Repeat Scenario B but enter a wrong 8-char code (e.g., `00000000`).
    2. Expect red X + error code `WRONG_ACCESS_CODE` + German hint "Access Code abgelehnt. Am Drucker-Display aktuellen Code ablesen…".

    **Scenario D — LAN Mode off (BAMBU-10 LAN_MODE_OFF):**
    1. On the printer display, toggle LAN Mode OFF. Wait 10 s.
    2. Repeat Scenario B. Expect `LAN_MODE_OFF` + German hint "LAN Mode scheint deaktiviert…".
    3. Toggle LAN Mode back ON before continuing.

    **Scenario E — Unreachable (BAMBU-10 PRINTER_UNREACHABLE):**
    1. Use manual-add with a bogus IP like `192.168.3.250` (no device there).
    2. Select "Bambu Lab", enter any Serial + any 8 chars.
    3. Expect `PRINTER_UNREACHABLE` + German hint "Drucker nicht erreichbar…".

    **Optional Scenario F — Live555 hang (BAMBU-10 RTSPS_HANDSHAKE_HUNG):**
    Hard to reproduce on demand. If the H2C happens to be in the hung state (Bambu Studio also cannot see the stream), the pre-flight should return `RTSPS_HANDSHAKE_HUNG` with the "Drucker aus- und wieder einschalten" hint. If not reproducible, note that in the resume signal.

    **Verification checklist — paste into the resume signal:**
    - [ ] Scenario A — Bambu row visible and differentiated
    - [ ] Scenario B — ok path returns `{ ok: true }` in <10s
    - [ ] Scenario C — wrong code → WRONG_ACCESS_CODE
    - [ ] Scenario D — LAN Mode off → LAN_MODE_OFF
    - [ ] Scenario E — bogus IP → PRINTER_UNREACHABLE
    - [ ] Scenario F — Live555 hang: tested / not-reproducible
    - [ ] Existing Mobotix/Loxone onboarding still works (run one existing camera through the wizard as a regression check)
  </how-to-verify>
  <resume-signal>
    Paste the verification checklist above with checkboxes ticked (or describe any failure/deviation). Type `approved` to close Phase 11, or describe issues for a revision pass.
  </resume-signal>
</task>

</tasks>

<verification>
1. `npm run check` — clean (no new type errors across the four modified files).
2. Regression: one existing Mobotix camera onboarded through the wizard still works (covered by Scenario A/F in the checkpoint).
3. The human-verify checklist (Scenarios A-E at minimum) all tick.
4. `/api/onboarding/bambu/preflight` returns the four documented error codes against forced failure conditions on the real H2C.
</verification>

<success_criteria>
- Bambu Lab selectable as a device type in both discovery-initiated and manual-add flows
- Bambu credential step collects Serial + Access Code (not user/pass)
- Pre-flight verdict rendered with the exact four error codes + German hints from Plan 03
- Discovery list differentiates Bambu rows visually
- Existing Mobotix/Loxone wizard flows unchanged
- Human verification against 192.168.3.109 passes Scenarios A, B, C, D, E
- Phase-11 ROADMAP success criteria fully satisfied (see 11-CONTEXT §Success)
</success_criteria>

<output>
After completion, create `.planning/phases/11-foundation-discovery-credentials-preflight/11-04-SUMMARY.md` capturing:
- Deployment confirmation (App-VM build hash / timestamp)
- Checkpoint verification checklist with user's responses for each scenario
- Any UX rough edges the user flagged that are explicitly deferred to Phase 14 (don't fix here)
- Screenshots or annotated paste of the pre-flight screens for each of the five outcomes (optional but welcome)
- Any new threats / pitfalls discovered during field testing (feed into PITFALLS.md or Phase 12 CONTEXT)
</output>
