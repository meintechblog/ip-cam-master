# Phase 22: Onboarding Wizard + `/cameras` Integration - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

A non-developer user can enable the Protect Hub feature via the settings toggle, complete a 6-step wizard end-to-end (resumable across browser closes and app restarts), and see their first-party UniFi cams streaming as Loxone-MJPEG outputs in `/kameras` — inline with their existing managed Mobotix/Loxone/Bambu cams, marked with a "Protect Hub" badge plus a first-party/third-party qualifier — within ~5 minutes of clicking the toggle.

This phase owns: Wizard Steps 3–6 (Steps 1–2 already exist from P20), the `/kameras` partition (managed/external), per-cam Outputs subsection with copy-buttons, the `ProtectHubGuide` component (Loxone + Frigate snippets), the new `/settings/protect-hub/all-urls` page, and the Settings Hub-Tab status panel (status, last-reconcile, drift indicator, Sync-now, event log).

This phase does NOT own: backend reconciler logic (P21), bridge provisioning (P20), data-model/catalog (P19), offboarding flow (P23).

</domain>

<decisions>
## Implementation Decisions

### `/kameras` Partition Visual Style
- Two section headers in a single list ("Eigene Kameras (n)" / "Aus UniFi Protect (n)"), same visual style — minimal, no tab switch
- Sort order within each section: keep current behavior (insertion order from `/api/cameras/status`), no re-sort
- Search/filter bar: NOT in P22 (does not exist today, do not add)
- External-section empty state: render section ONLY when `settings.protect_hub_enabled === true` — completely hide otherwise

### External Cam Detail Layout
- LXC-Card: hide completely on `camera.source === 'external'` (gate the existing `{#if !isNativeOnvif}` block with an additional source check)
- Native Protect stream catalog rendering: inline 3-column table (Channel · Codec · Resolution@FPS) — read-only
- Outputs section UI: Toggle-Switches per output type (Loxone-MJPEG / Frigate-RTSP), URL + copy-button shown underneath when ON
- Snapshot preview strategy: single fetch on render + manual reload icon (on-demand), no auto-refresh
- Hide cam-edit + cam-delete buttons (cam belongs to Protect, not the app); action-menu replaces "delete container" with "remove from Hub"

### Wizard Resumability UX
- Resume banner on re-entry: render "Du warst bei Schritt N — weiter?" banner with Continue / Reset buttons, only when `hub_onboarding_state` has a non-null pointer
- Step indicator: linear progress bar, clickable backward to already-completed steps; forward steps locked until preconditions met
- Toggle-flap protection during `hub_state ∈ {starting, stopping}`: toggle disabled + inline spinner + "Vorgang läuft…" text + separate explicit "Abbrechen" button (separate from toggle, per L-18)
- Step 5 (first reconcile) wait UX: live-poll on `/api/protect-hub/health` with named stages ("YAML deployed" → "go2rtc starting" → "Streams ready"), 90s timeout

### Copy-Snippets & "All Hub URLs"
- Loxone snippet: ready-to-paste "Benutzerdefinierte Intercom" block with URL + User-Agent hint + short DE comments using `#`-style
- Frigate snippet: per-cam YAML block (`cameras: { <slug>: { ffmpeg: { inputs: [...] } } }`); `detect` + `record` keys included as commented hints
- Snippet language: German, terse, consistent with existing wizard copy ("Adresse:" / "Hinweis:")
- "All Hub URLs" page layout: grouped by output type (all Loxone-MJPEG first, then Frigate-RTSP); per-entry: cam name · slug · URL · copy-button

### Claude's Discretion
- Exact Tailwind class choices, copy wording, micro-interactions (hover states, focus rings, transition durations)
- Component file decomposition (single big component vs. small leaf components for table/toggles/snippet)
- Test fixture data shapes (consistent with existing patterns)
- Whether to add a tiny smoke-test for the toggle state machine (recommended) or rely on E2E

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/components/cameras/CameraDetailCard.svelte` — used today for managed cams; needs source-aware variant logic
- `src/lib/types.ts` already has `CameraSource = 'managed' | 'external' | 'external_archived'` and `CameraKind = 'first-party' | 'third-party' | 'unknown'` (P19)
- `/api/cameras/status` returns merged managed + external array — no parallel endpoint needed (per L-15+P19)
- Wizard route `/settings/protect-hub/onboarding/+page.svelte` (Steps 1-2) exists from P20 (commit 925367c) — extend with Steps 3-6
- `hub_onboarding_state` step-pointer table exists from P19 schema (per L-15)
- `protect_hub_bridges` table + `camera_outputs` table from P19 (L-3, L-4)
- Settings tab pattern lives in `src/routes/settings/+page.svelte` — Hub-Tab is the 7th tab from P19 Plan 04
- Existing wizard component (Bambu wizard from P11/P18) is the closest UX precedent for step-pointer + auto-advance pattern

### Established Patterns
- Polling: 10s interval via `setInterval` in `+page.svelte` $effect — followed in `/kameras` already; Step 5 health-poll should use same pattern with shorter cadence (1.5s)
- API routes: `src/routes/api/[domain]/[verb]/+server.ts` with named exports `GET`/`POST`/`PATCH`/`DELETE`
- Form actions for POST flows; data fetching via `+page.server.ts` for SSR-friendly data
- Toggle/state machine UI: existing `auth_yolo` toggle in settings is the simplest precedent; current Hub-toggle pattern from P19 needs to evolve into a state-machine-aware version per L-18
- Tailwind theme: `bg-bg-primary`, `bg-bg-input`, `border-border`, `text-text-primary`, `text-text-secondary`, `bg-accent` — already used in CameraDetailCard
- Lucide icons via `lucide-svelte` (Loader2, etc.)

### Integration Points
- `/kameras` page (`src/routes/kameras/+page.svelte`) → render two sections by `cameras.filter(c => c.source !== 'external')` and `cameras.filter(c => c.source === 'external' && hubEnabled)`
- `CameraDetailCard.svelte` → branch rendering on `camera.source` (or extract `<ExternalCamCard>` leaf)
- `/settings/protect-hub/onboarding` → add Steps 3-6 rendering, share `hub_onboarding_state` mutations via `/api/protect-hub/wizard/[step]` POST endpoints
- New page: `/settings/protect-hub/all-urls/+page.svelte` (+ `+page.server.ts` to load active outputs)
- New component: `src/lib/components/protect-hub/ProtectHubGuide.svelte` for the snippet display
- Settings Hub-Tab (`ProtectHubTab.svelte` from P19 Plan 04) → extend with status panel, sync-now button, event log

</code_context>

<specifics>
## Specific Ideas

- The `LXC 0` rendering bug today on the live VM proves the gate is wrong: 22 external rows render with "LXC 0" + red status dot. Fix in P22 by gating the LXC card block in `CameraDetailCard.svelte:385` on `!isNativeOnvif && camera.source !== 'external'` (or branch into a dedicated `<ExternalCamCard>` component).
- "Bob the Builder" appears twice in the cameras list (id=14 managed + id=23 external mirror) — this is by-design (forward path + Protect-mirror), but P22 must make the visual difference unmistakable so the user understands they aren't looking at duplicates. The "Protect Hub" badge + first/third-party qualifier should make this clear.
- The Bambu mirror (cam.id=23) has `manufacturer='BobtheBuilder'` and `kind='third-party'` in the DB — third-party qualifier badge should render the manufacturer name (not the model_name, which can be empty/redundant).
- Step 5 (first reconcile) should call into the existing P21 reconciler entrypoint (no parallel logic).

</specifics>

<deferred>
## Deferred Ideas

- Search/filter bar on `/kameras` — out of scope; not present today; revisit in a future polish phase if needed
- Auto-refresh snapshot preview — explicitly chosen as on-demand to keep load light and bandwidth predictable; revisit if users complain
- "All Hub URLs" page export-to-file (CSV/YAML) — capture-button only for P22; bulk export is a P23 candidate ("Export Hub config" pre-uninstall is on P23's reqs)
- Drift-indicator click-through to a YAML diff view — show drift only as a flag in P22, dive-in UI is a P23 candidate

</deferred>
