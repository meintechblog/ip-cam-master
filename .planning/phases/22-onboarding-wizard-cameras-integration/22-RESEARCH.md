# Phase 22: Onboarding Wizard + `/cameras` Integration — Research

**Researched:** 2026-05-07
**Domain:** SvelteKit UI integration over an existing Protect-Hub backend (P19 catalog, P20 bridge provisioning, P21 reconciler)
**Confidence:** HIGH (everything load-bearing was verified by reading source; one critical schema gap was discovered)

## Summary

Phase 22 is a UI-heavy phase that lights up the user-visible surface of the Protect Hub feature: it adds Steps 3–6 to the wizard already drafted in P20, partitions `/kameras` into managed + external sections, wires per-cam Outputs toggles to the existing `PUT /api/cameras/[id]/outputs` endpoint, ships a snippet-display component for Loxone + Frigate, adds a new `/settings/protect-hub/all-urls` page, and extends `ProtectHubTab.svelte` with a status panel + event log. The backend it consumes is already in place: `discover()` and `loadCatalog()` populate `cameras` (source='external') and `protect_stream_catalog` rows; `reconcile(bridgeId, 'force', externalId)` is the entrypoint for Step 5; `PUT /api/cameras/[id]/outputs` is the toggle endpoint; `/api/protect-hub/bridge/status` exposes bridge state; the `events` table holds the reconcile event log under `source='protect_hub'`.

There are **three critical gaps** the planner must close in Wave 0 before Steps 3–6 can be implemented:

1. **The `hub_onboarding_state` table referenced by L-15, HUB-WIZ-09, and the resume banner does NOT exist in `src/lib/server/db/schema.ts`.** P19 research planned it but no plan ever created it. P22 must add the table + migration in Wave 0 — without it, resumability (HUB-WIZ-09) and step-pointer semantics cannot be implemented.
2. **`/api/cameras/status` does NOT expose `source`, `kind`, `manufacturer`, `modelName`, `externalId`, `hubBridgeId` on the row payload.** The DB columns exist (P19) but the endpoint maps them away. The `CameraCardData` interface also lacks them. P22 must extend the type + the response shape — without that, the `/kameras` partition can't decide which section a row belongs in (HUB-UI-01..05).
3. **There is NO `hub_state` ENUM column on `protect_hub_bridges` (or anywhere else).** L-18 specifies a five-state machine `disabled|starting|enabled|stopping|error` but the live schema only has `protect_hub_bridges.status` (running|stopped|failed|provisioning|pending|unhealthy). The toggle-flap-protection requirement (Success Criterion 4 + L-18) needs a new column or a derived state machine in app code. P22 must decide between (a) adding `hub_state` as a new column or (b) deriving the state in code from existing signals (`settings.protect_hub_enabled` + `protect_hub_bridges.status`).

Beyond those gaps, every other backend hook P22 needs already exists: `getEvents({source: 'protect_hub'})` for the event log, `isReconcilerBusy()` for the in-flight detection, `bridge.lastDeployedYamlHash` + `bridge.lastReconciledAt` for the status panel, the 5-min health probe for go2rtc reachability, the slug `<mac>-low|<mac>-high` for URL stability (L-22), and the events table column accepting any string for `eventType`.

**Primary recommendation:** Plan a Wave 0 that closes the 3 gaps above (1 schema migration, 1 API extension, 1 small state-machine shim) before any Wave 1 component work begins. Then Wave 1 = `/kameras` partition + ExternalCamCard + OutputsSubsection (read-mostly UI). Wave 2 = wizard Steps 3–6 (mutating). Wave 3 = `/settings/protect-hub/all-urls` + ProtectHubTab status panel + event log. Wave 4 = E2E smoke + soak.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wizard step-pointer persistence | API / Backend | Database | `hub_onboarding_state` row is the single source of truth across browser-tab/app-restart resumes; client-side state is ephemeral |
| Wizard step rendering + form state | Frontend Server (SSR) → Browser | — | `+page.server.ts` loads the pointer; `+page.svelte` renders the matching step component; ephemeral form state lives in client `$state` runes |
| Step 3 cam fetch | API / Backend | UniFi Protect API | Re-uses `POST /api/protect-hub/discover` which calls `discover()` in `catalog.ts` — server-side because Protect creds must never leak to the browser |
| Step 4 cam-pick mutation | API / Backend | Database | Pre-fills `camera_outputs` rows via `PUT /api/cameras/[id]/outputs` (existing) — server enforces VAAPI cap |
| Step 5 first-reconcile orchestration | API / Backend | SSH → Bridge LXC | `reconcile(bridgeId, 'force', externalReconcileId)` — already async-fire-and-poll via `POST /api/protect-hub/reconcile` (202) |
| Step 5 health-poll | API / Backend (read-only) | Browser polling | New thin endpoint `GET /api/protect-hub/health` reads `protect_hub_bridges.status` + reconcile-run row; browser polls 1.5 s |
| Step 6 enable-flag write | API / Backend | Database | Sets `settings.protect_hub_enabled='true'` exactly once after Step 6 completes (HUB-WIZ-10 + L-17) |
| `/kameras` partition rendering | Frontend Server (SSR) → Browser | — | `+page.svelte` filters the merged array by `cam.source`; server load just provides `hubEnabled` flag |
| External-cam card UI | Browser | — | Pure rendering of server-loaded data; toggles are async fetches |
| Outputs toggle | Browser → API | Database → Reconciler | Optimistic UI; `PUT /api/cameras/[id]/outputs` writes + fires force-reconcile (existing) |
| Snippet generation (Loxone, Frigate) | Browser | — | Pure string templating using bridge IP + slug — no server hit needed |
| `/settings/protect-hub/all-urls` data load | Frontend Server (SSR) | Database | `+page.server.ts` reads `cameraOutputs JOIN cameras WHERE enabled=true` |
| Settings Hub-Tab status panel | Frontend Server (SSR) → Browser | API polling | Initial server load + 10 s poll on `/api/protect-hub/bridge/status` + `/api/protect-hub/events?source=protect_hub` |
| Toggle state machine (`hub_state` for L-18) | API / Backend | Database OR derived | See Open Question 1 — column vs. derived |
| Sync-now button | API / Backend | Existing reconcile route | Hits `POST /api/protect-hub/reconcile` (existing, no changes) |
| Drift indicator | API / Backend | SSH probe | Compares `bridge.lastDeployedYamlHash` against the actual on-disk stamp on the bridge; existing reconciler already does mtime+hash check internally — surface via thin GET endpoint |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**`/kameras` Partition Visual Style**
- Two section headers in a single list ("Eigene Kameras (n)" / "Aus UniFi Protect (n)"), same visual style — minimal, no tab switch
- Sort order within each section: keep current behavior (insertion order from `/api/cameras/status`), no re-sort
- Search/filter bar: NOT in P22 (does not exist today, do not add)
- External-section empty state: render section ONLY when `settings.protect_hub_enabled === true` — completely hide otherwise

**External Cam Detail Layout**
- LXC-Card: hide completely on `camera.source === 'external'` (gate the existing `{#if !isNativeOnvif}` block with an additional source check)
- Native Protect stream catalog rendering: inline 3-column table (Channel · Codec · Resolution@FPS) — read-only
- Outputs section UI: Toggle-Switches per output type (Loxone-MJPEG / Frigate-RTSP), URL + copy-button shown underneath when ON
- Snapshot preview strategy: single fetch on render + manual reload icon (on-demand), no auto-refresh
- Hide cam-edit + cam-delete buttons (cam belongs to Protect, not the app); action-menu replaces "delete container" with "remove from Hub"

**Wizard Resumability UX**
- Resume banner on re-entry: render "Du warst bei Schritt N — weiter?" banner with Continue / Reset buttons, only when `hub_onboarding_state` has a non-null pointer
- Step indicator: linear progress bar, clickable backward to already-completed steps; forward steps locked until preconditions met
- Toggle-flap protection during `hub_state ∈ {starting, stopping}`: toggle disabled + inline spinner + "Vorgang läuft…" text + separate explicit "Abbrechen" button (separate from toggle, per L-18)
- Step 5 (first reconcile) wait UX: live-poll on `/api/protect-hub/health` with named stages ("YAML deployed" → "go2rtc starting" → "Streams ready"), 90 s timeout

**Copy-Snippets & "All Hub URLs"**
- Loxone snippet: ready-to-paste "Benutzerdefinierte Intercom" block with URL + User-Agent hint + short DE comments using `#`-style
- Frigate snippet: per-cam YAML block (`cameras: { <slug>: { ffmpeg: { inputs: [...] } } }`); `detect` + `record` keys included as commented hints
- Snippet language: German, terse, consistent with existing wizard copy ("Adresse:" / "Hinweis:")
- "All Hub URLs" page layout: grouped by output type (all Loxone-MJPEG first, then Frigate-RTSP); per-entry: cam name · slug · URL · copy-button

### Claude's Discretion
- Exact Tailwind class choices, copy wording, micro-interactions (hover states, focus rings, transition durations)
- Component file decomposition (single big component vs. small leaf components for table/toggles/snippet)
- Test fixture data shapes (consistent with existing patterns)
- Whether to add a tiny smoke-test for the toggle state machine (recommended) or rely on E2E

### Deferred Ideas (OUT OF SCOPE)
- Search/filter bar on `/kameras` — out of scope; not present today; revisit in a future polish phase if needed
- Auto-refresh snapshot preview — explicitly chosen as on-demand to keep load light and bandwidth predictable; revisit if users complain
- "All Hub URLs" page export-to-file (CSV/YAML) — capture-button only for P22; bulk export is a P23 candidate ("Export Hub config" pre-uninstall is on P23's reqs)
- Drift-indicator click-through to a YAML diff view — show drift only as a flag in P22, dive-in UI is a P23 candidate
- Offboarding (the actual destructive flow). The "Aus Hub entfernen" button must render but be **disabled with tooltip "Verfügbar in Phase 23"** per UI-SPEC line 236.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HUB-WIZ-05 | Wizard Step 3 fetches Protect cams + populates the catalog; preview groups by `kind` | Re-use `POST /api/protect-hub/discover` (existing, P19 Plan 03) → server returns `{ok, insertedCams, updatedCams, insertedChannels}`. Then UI re-fetches `/settings/protect-hub` (or a thin GET endpoint) to render the catalog grouped by `cameras.kind`. |
| HUB-WIZ-06 | Wizard Step 4 lets the user pick which cams join the Hub | Mutate `camera_outputs` rows via existing `PUT /api/cameras/[id]/outputs` (P21 Plan 05). First-party cams are pre-checked with default `loxone-mjpeg` output; third-party cams are unchecked (per L-28). |
| HUB-WIZ-07 | Wizard Step 5 runs the first reconcile and waits for go2rtc healthy on `:1984` | Trigger via `POST /api/protect-hub/reconcile` (existing, returns 202 + `reconcileId`). Poll `GET /api/protect-hub/reconcile-runs?reconcileId=...` for terminal status + new `GET /api/protect-hub/health` for staged readiness. |
| HUB-WIZ-08 | Wizard Step 6 redirects to `/cameras` with toast | New `+page.svelte` redirect via `goto('/kameras?onboarding=success')` with query param consumed once for toast — see Pitfall #4. |
| HUB-WIZ-09 | Wizard is resumable via `hub_onboarding_state` step-pointer table | **GAP — table does not exist.** Wave 0 must add migration. See Open Question 2. |
| HUB-WIZ-10 | `settings.protect_hub_enabled` becomes `true` only after Step 6 completes | One server action `POST /api/protect-hub/wizard/complete` writes `settings.protect_hub_enabled='true'` AND clears `hub_onboarding_state` pointer atomically. |
| HUB-UI-01 | External Protect cams appear inline in `/kameras` | Source filter on the merged array — see Pitfall #1 (CameraCardData lacks the field today). |
| HUB-UI-02 | External cards show "Protect Hub" badge + first/third-party qualifier | `cameras.kind` + `cameras.manufacturer` already populated by P19 catalog. UI-SPEC §badges fully locks copy + tokens. |
| HUB-UI-03 | External cam detail page shows native catalog, outputs with toggles, copy buttons, snapshot | Native catalog from `protect_stream_catalog`. Snapshot via `http://${bridge.containerIp}:1984/api/frame.jpeg?src=${slug}` (existing pattern — see go2rtc.ts pattern from managed cams). |
| HUB-UI-04 | External cam detail hides cam-edit + cam-delete buttons | Branch `CameraDetailCard.svelte` on `camera.source === 'external'` (or extract a leaf component, recommended in CONTEXT.md). |
| HUB-UI-05 | External cam action menu shows "Aus Hub entfernen" instead of "delete container" | Per UI-SPEC §destructive: render disabled with tooltip — actual logic is P23. |
| HUB-UI-06 | `ProtectHubGuide` component shows Loxone + Frigate snippets pre-filled with user URLs | Pure browser-side template; bridge IP from `protect_hub_bridges.containerIp`, slug from `<mac>-low` or `<mac>-high` (verified in `yaml-builder.ts:108`). |
| HUB-UI-07 | "All Hub URLs" page lists every active output URL | New route `/settings/protect-hub/all-urls`. Server load: SELECT cameraOutputs JOIN cameras WHERE enabled=true + bridge IP. |
| HUB-UI-08 | Settings Protect Hub tab shows status, last reconcile, drift, sync-now, last 50 events | Extend existing `ProtectHubTab.svelte`. All data sources exist: `protect_hub_bridges` row, `protect_hub_reconcile_runs` table, `events` table filtered by `source='protect_hub'`. |

## Project Constraints (from CLAUDE.md)

- **Language:** TypeScript only; no JS source files
- **Package manager:** npm (npm scripts in package.json — `npm run test:unit`, `npm run test`, `npm run check`, `npm run db:push`, `npm run db:generate`)
- **Add-ons in scope:** tailwindcss, drizzle, vitest (no shadcn-svelte; no Playwright in package.json)
- **Security:** camera credentials and SSH keys must NEVER be committed; this phase doesn't touch credentials but must not surface them in UI either
- **GSD workflow:** all file edits must be initiated through a GSD command — not relevant to this RESEARCH.md but planner should note it
- **Stack lock:** SvelteKit 2.55+ with Svelte 5 runes (verified `svelte: ^5.51.0` in package.json); Tailwind v4 with `@theme` tokens (verified in `src/routes/layout.css`); Drizzle ORM with SQLite via better-sqlite3; Vitest 4 for tests

## Standard Stack

### Core (already installed and verified in package.json)

| Library | Version | Purpose | Why Standard | Confidence |
|---------|---------|---------|--------------|------------|
| svelte | 5.51.0 (current latest 5.55.5 [VERIFIED: npm view]) | Component framework | Locked by project; runes are the active reactivity model | HIGH |
| @sveltejs/kit | 2.50.2 (current latest 2.59.1 [VERIFIED: npm view]) | App framework, routing, server endpoints | Locked by project | HIGH |
| drizzle-orm | 0.45.1 (current latest 0.45.2 [VERIFIED: npm view]) | Type-safe SQL on SQLite | Locked by project; existing schema uses `sqliteTable` | HIGH |
| better-sqlite3 | 12.6.2 | Synchronous SQLite driver | Locked by project (per CLAUDE.md stack research) | HIGH |
| vitest | 4.1.0 (current latest 4.1.5 [VERIFIED: npm view]) | Unit/smoke test runner | Locked; existing pattern is regex-against-source-file smoke tests in `tabs.test.ts` | HIGH |
| lucide-svelte | 0.577.0 | Icons | Already used in existing wizard, settings, CameraDetailCard | HIGH |
| bits-ui | 2.16.3 (current latest 2.18.1 [VERIFIED: npm view]) | Headless UI primitives | Listed in package.json — only used "if a tab primitive is needed for ProtectHubGuide; otherwise raw conditional rendering" per UI-SPEC | HIGH |
| tailwindcss | 4.1.18 | Styling via `@theme` tokens | Locked; tokens already declared | HIGH |

### Supporting (icons specifically used in P22 — verify imports against `lucide-svelte` exports)

| Icon | Purpose | Where |
|------|---------|-------|
| `Loader2` | Spinner during in-flight states | Step 5 stages, OutputToggle in-flight, Sync-now in-flight |
| `CheckCircle2` | Step-completed marker | Step indicator complete state, Step 5 completed stages |
| `XCircle` | Error states | Step 5 reconcile failed, OutputToggle error |
| `RotateCw` | Snapshot preview reload icon | ExternalCamCard top-right reload |
| `RotateCcw` | Resume banner left-stripe icon | WizardResumeBanner |
| `Copy` / `Check` | Copy button + success flash | Outputs URL row, ProtectHubGuide, all-urls page |
| `ArrowLeft` | Breadcrumb back-link | All-URLs page, wizard breadcrumb (existing) |
| `AlertTriangle` | Drift indicator warning | HubStatusPanel drift block |
| `RefreshCw` | Sync-now button leading icon | HubStatusPanel sync-now |

### Alternatives Considered (rejected — locked decisions)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `@testing-library/svelte` (5.3.1 latest [VERIFIED: npm view]) for component-render tests | Existing regex-against-source pattern in `tabs.test.ts` | The codebase has zero rendered-component tests today and no jsdom/happy-dom installed. Adding component-render infrastructure would be a sub-phase of its own. CONTEXT.md classifies a toggle smoke test as "Claude's discretion (recommended)" — recommend keeping the regex pattern, not adding new infrastructure. |
| `@playwright/test` for E2E | Manual UAT against live VM | Playwright is referenced in `package-lock.json` (`@vitest/browser-playwright`) as a transitive dep but NOT a direct devDep. Adding E2E would be a new tooling decision; existing P21 verification used live UAT against vmid 2014 (per Plan 06). Match that pattern. |
| Toast library (e.g. `svelte-sonner`) | Custom toast via query-param + `$effect` | Codebase has no toast library installed today. CONTEXT.md decision Step 6 → "redirect to /kameras with confirmation toast" — implementable as URL query param consumed once on `/kameras` mount. Don't add a library for one toast. |

**Installation:** None new required. Confirmed by reading package.json — all dependencies for P22 are already installed.

**Version verification (npm registry, 2026-05-07):**
- `svelte` 5.55.5 (project pins 5.51.0 — patch-stable)
- `@sveltejs/kit` 2.59.1 (project pins 2.50.2 — minor-stable)
- `drizzle-orm` 0.45.2 (project pins 0.45.1 — patch-stable)
- `vitest` 4.1.5 (project pins 4.1.0 — patch-stable)
- `bits-ui` 2.18.1 (project pins 2.16.3 — minor-stable)

## Architecture Patterns

### System Architecture Diagram

```
                            ┌─────────────────────────────────────────────┐
                            │  Browser (Svelte 5 runes)                   │
                            │                                             │
   ┌───/kameras────────────►│  +page.svelte ──filters by cam.source──►   │
   │                        │   ├─ <managed cams>: existing CameraDetail │
   │                        │   └─ <external cams>: new ExternalCamCard  │
   │                        │       ├─ stream catalog table (read-only) │
   │                        │       ├─ OutputsSubsection                  │
   │                        │       │   ├─ OutputToggle (loxone-mjpeg)   │
   │                        │       │   └─ OutputToggle (frigate-rtsp)   │
   │                        │       ├─ snapshot <img> + reload icon     │
   │                        │       └─ ProtectHubGuide (snippets)       │
   │                        │                                             │
   │  /settings/protect-hub/onboarding ──reads pointer──►                 │
   │                        │   ├─ WizardResumeBanner (if pointer ≠ null)│
   │                        │   ├─ WizardStepIndicator (6 discs)         │
   │                        │   └─ Step3 / Step4 / Step5 / Step6 card    │
   │                        │                                             │
   │  /settings/protect-hub/all-urls                                      │
   │                        │   └─ groups by output_type                 │
   │                        │                                             │
   │  /settings (Hub-Tab)                                                 │
   │                        │   └─ HubStatusPanel + HubEventLog          │
   └────────────────────────┴─────────┬───────────────────────────────────┘
                                      │ fetch / poll
   ┌──────────────────────────────────▼──────────────────────────────────┐
   │  SvelteKit server endpoints  (existing P19/P20/P21 + P22 new)        │
   │                                                                      │
   │  EXISTING (P19/P20/P21):                                             │
   │   POST /api/protect-hub/discover           → catalog.discover()     │
   │   GET  /api/protect-hub/bridge/status      → getBridgeStatus()      │
   │   POST /api/protect-hub/reconcile          → reconcile() [202]      │
   │   GET  /api/protect-hub/reconcile-runs     → poll by reconcileId    │
   │   PUT  /api/cameras/[id]/outputs           → camera_outputs replace │
   │   GET  /api/cameras/status                 → merged cam list        │
   │                                                                      │
   │  NEW IN P22:                                                         │
   │   POST /api/protect-hub/wizard/[step]      → set pointer + payload  │
   │   GET  /api/protect-hub/wizard/state       → read pointer           │
   │   POST /api/protect-hub/wizard/reset       → clear pointer          │
   │   POST /api/protect-hub/wizard/complete    → set protect_hub_enabled│
   │   GET  /api/protect-hub/health             → staged readiness       │
   │   GET  /api/protect-hub/events             → last-50 reconcile log  │
   │   GET  /api/protect-hub/all-outputs        → flat URL list          │
   │   GET  /api/protect-hub/drift              → on-demand drift check  │
   └──────────────────────────────────┬──────────────────────────────────┘
                                      │
   ┌──────────────────────────────────▼──────────────────────────────────┐
   │  Server-side orchestration  (existing — P22 calls into these)        │
   │   catalog.ts:           discover(), loadCatalog()                    │
   │   bridge-lifecycle.ts:  getBridgeStatus(), start/stop/restart        │
   │   reconcile.ts:         reconcile(bridgeId, reason, externalId)     │
   │                          isReconcilerBusy()                          │
   │   yaml-builder.ts:      deriveSlug(), canonicalHash()                │
   │   protect-bridge.ts:    fetchBootstrap(), normalizeMac()             │
   └──────────────────────────────────┬──────────────────────────────────┘
                                      │
   ┌──────────────────────────────────▼──────────────────────────────────┐
   │  SQLite (better-sqlite3)                                              │
   │   Existing: cameras, settings, protect_hub_bridges,                  │
   │             camera_outputs, protect_stream_catalog,                  │
   │             protect_hub_reconcile_runs, events                       │
   │   NEW IN P22: hub_onboarding_state                                   │
   └──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Path | Reads | Writes | Notes |
|-----------|------|-------|--------|-------|
| `/kameras/+page.svelte` | route | `/api/cameras/status` (10 s poll), `data.hubEnabled` from server load | — | Adds `<section>` partition; preserves existing CameraDetailCard render for managed cams |
| `/kameras/+page.server.ts` | route | `getSetting('protect_hub_enabled')` | — | Returns `hubEnabled: boolean` alongside existing fields |
| `ExternalCamCard.svelte` | `src/lib/components/cameras/` | `camera: CameraCardData` (extended), `bridge.containerIp` | — | Renders Protect-Hub badge + qualifier; embeds OutputsSubsection + ProtectHubGuide |
| `OutputsSubsection.svelte` | `src/lib/components/cameras/` | `cameraId`, `bridgeIp`, `outputs[]` (loxone+frigate) | `PUT /api/cameras/[id]/outputs` | Two OutputToggle children; URL row appears beneath when ON |
| `OutputToggle.svelte` | `src/lib/components/cameras/` | toggle state, `slug`, `bridgeIp` | mutates parent state | Spinner overlay during in-flight; AbortController for cancellable enable |
| `ProtectHubGuide.svelte` | `src/lib/components/protect-hub/` | `bridgeIp`, `slug`, `camName` | — | Tabbed snippet display; pure templates |
| `WizardStepIndicator.svelte` | `src/lib/components/protect-hub/` | `currentStep`, `completedSteps[]` | emits `stepClicked(n)` | 6 discs; backward clickable to completed only |
| `WizardResumeBanner.svelte` | `src/lib/components/protect-hub/` | `lastStep`, `lastActivityIso` | emits `continue`, `reset` | Renders only when pointer ≠ null |
| `HubStatusPanel.svelte` | `src/lib/components/protect-hub/` | `bridge`, `lastRun`, `driftDetected`, `streamCount` | `POST /api/protect-hub/reconcile` | Sync-now button single-flight aware |
| `HubEventLog.svelte` | `src/lib/components/protect-hub/` | `GET /api/protect-hub/events` (10 s poll) | — | Last 50 rows, mono table |
| `Step3Catalog.svelte` (or in `_components/`) | wizard route | `data.protectCams[]` | `POST /api/protect-hub/discover`, `POST /api/protect-hub/wizard/3` | Renders cams grouped by `kind`; CTA advances pointer |
| `Step4Pick.svelte` | wizard route | `data.protectCams[]` | `PUT /api/cameras/[id]/outputs` per-cam, `POST /api/protect-hub/wizard/4` | Pre-checks first-party + loxone; third-party unchecked |
| `Step5Reconcile.svelte` | wizard route | `data.bridge` | `POST /api/protect-hub/reconcile`, polls `GET /api/protect-hub/health` | Three named stages; 90 s timeout |
| `Step6Done.svelte` | wizard route | summary counts | `POST /api/protect-hub/wizard/complete` then `goto('/kameras?onboarding=success')` | Confirmation card + redirect |

### Recommended Project Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── cameras/
│   │   │   ├── ExternalCamCard.svelte           # NEW
│   │   │   ├── OutputsSubsection.svelte         # NEW
│   │   │   └── OutputToggle.svelte              # NEW
│   │   ├── protect-hub/
│   │   │   ├── ProtectHubGuide.svelte           # NEW
│   │   │   ├── WizardStepIndicator.svelte       # NEW
│   │   │   ├── WizardResumeBanner.svelte        # NEW
│   │   │   ├── HubStatusPanel.svelte            # NEW
│   │   │   └── HubEventLog.svelte               # NEW
│   │   └── settings/
│   │       └── ProtectHubTab.svelte             # MODIFIED — host status panel + event log
│   └── server/
│       ├── db/
│       │   └── schema.ts                        # MODIFIED — add hubOnboardingState table
│       └── orchestration/
│           └── protect-hub/
│               └── wizard-state.ts              # NEW — pointer get/set/reset/complete
├── routes/
│   ├── kameras/
│   │   ├── +page.svelte                         # MODIFIED — partition
│   │   └── +page.server.ts                      # MODIFIED — return hubEnabled
│   ├── settings/
│   │   └── protect-hub/
│   │       ├── onboarding/
│   │       │   ├── +page.svelte                 # REFACTORED — Steps 1..6
│   │       │   └── +page.server.ts              # MODIFIED — load pointer
│   │       └── all-urls/
│   │           ├── +page.svelte                 # NEW
│   │           └── +page.server.ts              # NEW
│   └── api/
│       ├── cameras/
│       │   └── status/+server.ts                # MODIFIED — expose source/kind/etc
│       └── protect-hub/
│           ├── wizard/
│           │   ├── state/+server.ts             # NEW
│           │   ├── [step]/+server.ts            # NEW
│           │   ├── reset/+server.ts             # NEW
│           │   └── complete/+server.ts          # NEW
│           ├── health/+server.ts                # NEW
│           ├── events/+server.ts                # NEW
│           ├── all-outputs/+server.ts           # NEW
│           └── drift/+server.ts                 # NEW
└── drizzle/
    └── 0003_hub_onboarding_state.sql            # NEW — migration
```

### Pattern 1: Wizard step-pointer persistence

**What:** Single-row `hub_onboarding_state` table stores `(step INTEGER, status TEXT, lastActivityAt TEXT)` so the wizard resumes across browser closes and SvelteKit restarts.

**When to use:** Any multi-step flow whose intermediate progress must survive a process kill — verified pattern from PITFALLS.md §"State machine + idempotent resume" (.planning/research/v1.3/PITFALLS.md:248).

**Schema (proposed):**

```ts
// src/lib/server/db/schema.ts — append after protectHubReconcileRuns
export type HubOnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export type HubOnboardingStatus = 'in_progress' | 'completed' | 'reset';

// Single-row table (logical singleton — enforce in app code, not via constraint).
// id is the PK but we always read/upsert id=1.
export const hubOnboardingState = sqliteTable('hub_onboarding_state', {
    id: integer('id').primaryKey().default(1),
    step: integer('step').notNull(), // 1..6 — last completed step
    status: text('status').notNull().default('in_progress'), // 'in_progress' | 'completed' | 'reset'
    lastActivityAt: text('last_activity_at')
        .notNull()
        .$defaultFn(() => new Date().toISOString()),
    error: text('error') // nullable; populated on transient failure
});
```

**Source:** [VERIFIED via grep on schema.ts] Existing `protectHubReconcileRuns` table follows the same auditing pattern; the proposed table mirrors that style.

### Pattern 2: Force-reconcile via existing 202-poll endpoint

**What:** Step 5 calls `POST /api/protect-hub/reconcile` which returns 202 + `{reconcileId}` immediately. Browser polls `GET /api/protect-hub/reconcile-runs?reconcileId=...` for terminal status (`success | no_op | bridge_unreachable | error`).

**When to use:** Any UI that needs to wait for the reconciler — Step 5 in P22, Sync-now in HubStatusPanel.

**Code Source:** Verified at `src/routes/api/protect-hub/reconcile/+server.ts:24-51` and `src/routes/api/protect-hub/reconcile-runs/+server.ts:25-45`.

```ts
// In Step5Reconcile.svelte
async function startFirstReconcile() {
    const res = await fetch('/api/protect-hub/reconcile', { method: 'POST' });
    const { reconcileId } = await res.json();

    // Poll the reconcile-runs row + the bridge health endpoint together.
    pollHandle = setInterval(async () => {
        const [run, health] = await Promise.all([
            fetch(`/api/protect-hub/reconcile-runs?reconcileId=${reconcileId}`).then(r => r.json()),
            fetch('/api/protect-hub/health').then(r => r.json())
        ]);
        // Map to staged UI: yaml deployed → go2rtc reload → streams ready
        updateStages(run, health);
        if (run.run?.status === 'success' || run.run?.status === 'no_op') {
            clearInterval(pollHandle);
            await fetch('/api/protect-hub/wizard/5', { method: 'POST' });
        }
    }, 1500);
}
```

### Pattern 3: Output-toggle write + optimistic UI

**What:** Toggle calls `PUT /api/cameras/[id]/outputs` with the new output set. Server replaces all rows for the cam, fires force-reconcile fire-and-forget, returns 200 immediately.

**Why optimistic:** The endpoint is idempotent (replace-strategy per D-API-02) and fires reconcile in background — the UI can move the toggle immediately and roll back only on HTTP error.

**Code Source:** Verified at `src/routes/api/cameras/[id]/outputs/+server.ts:38-160`.

```ts
// In OutputToggle.svelte
async function setEnabled(next: boolean) {
    state = next ? 'enabling' : 'disabling';
    try {
        const res = await fetch(`/api/cameras/${cameraId}/outputs`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ outputs: buildOutputsArray(next) }),
            signal: abortController.signal
        });
        const body = await res.json();
        if (res.ok && body.ok) {
            state = next ? 'on' : 'off';
        } else if (body.reason === 'vaapi_hard_cap_exceeded') {
            // 422 — show inline German error from `body.message`
            errorMessage = body.message;
            state = next ? 'off' : 'on'; // rollback
        } else {
            errorMessage = body.error ?? 'Konnte Ausgang nicht umschalten';
            state = next ? 'off' : 'on';
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            state = next ? 'off' : 'on';
        } else {
            errorMessage = 'Netzwerkfehler';
            state = next ? 'off' : 'on';
        }
    }
}
```

### Pattern 4: Slug derivation in browser (must match yaml-builder server-side)

**What:** Stream URLs are constructed in the browser as `http://{bridgeIp}:1984/api/stream.mjpeg?src={slug}` (Loxone) or `rtsp://{bridgeIp}:8554/{slug}` (Frigate). The slug is `<mac>-low` (loxone-mjpeg) or `<mac>-high` (frigate-rtsp).

**Critical:** Per L-22 the slug MUST be derived from the camera MAC, NOT the DB row ID. Browser must use the SAME function as `yaml-builder.ts:deriveSlug()` (line 108-111).

**Code Source:** Verified at `src/lib/server/orchestration/protect-hub/yaml-builder.ts:108-111`.

```ts
// Recommended: extract a shared util.
// src/lib/protect-hub/slug.ts (BROWSER + SERVER both import this)
export type OutputType = 'loxone-mjpeg' | 'frigate-rtsp';
export function deriveSlug(mac: string, outputType: OutputType): string {
    const suffix = outputType === 'loxone-mjpeg' ? 'low' : 'high';
    return `${mac}-${suffix}`; // mac is already-normalised lowercase, no separators
}
export function deriveStreamUrl(bridgeIp: string, mac: string, outputType: OutputType): string {
    const slug = deriveSlug(mac, outputType);
    return outputType === 'loxone-mjpeg'
        ? `http://${bridgeIp}:1984/api/stream.mjpeg?src=${slug}`
        : `rtsp://${bridgeIp}:8554/${slug}`;
}
```

### Pattern 5: Smoke tests via file-content regex

**What:** Existing test pattern in this codebase asserts file structure rather than rendering components. See `src/routes/settings/tabs.test.ts` for the canonical example.

**Why:** No `@testing-library/svelte` or `jsdom` is installed. Adding component-render infrastructure would expand scope significantly.

**When to use:** All P22 component smoke tests should use this pattern — it's load-bearing because the codebase has no other component-test runtime.

**Source:** [VERIFIED] `src/routes/settings/tabs.test.ts` (lines 12-35) is the existing template; vitest.config.ts at `vite.config.ts:5-13` only includes `src/**/*.test.ts`.

```ts
// Example: smoke test for Step 5 stages render
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Wizard Step 5 staged-progress UI', () => {
    it('renders three named stages', () => {
        const src = readFileSync(
            resolve('src/routes/settings/protect-hub/onboarding/_components/Step5.svelte'),
            'utf8'
        );
        expect(src).toMatch(/YAML wird geschrieben/);
        expect(src).toMatch(/go2rtc wird neu geladen/);
        expect(src).toMatch(/Streams werden geprüft/);
    });
    it('polls /api/protect-hub/health every 1500ms', () => {
        const src = readFileSync(/* ... */, 'utf8');
        expect(src).toMatch(/setInterval[\s\S]*1500/);
        expect(src).toMatch(/\/api\/protect-hub\/health/);
    });
});
```

### Pattern 6: Polling cadence inside `$effect` with cleanup

**What:** The standard polling pattern in this codebase: declare `let pollTimer = $state<ReturnType<typeof setInterval> | null>(null)`; inside `$effect` call `setInterval(fn, ms)` and return a cleanup function.

**Source:** [VERIFIED] `src/routes/kameras/+page.svelte:25-31` is the exact pattern used today (10 s polling).

```svelte
<script lang="ts">
let pollTimer: ReturnType<typeof setInterval> | null = null;

$effect(() => {
    fetchData();
    pollTimer = setInterval(fetchData, 10000);
    return () => {
        if (pollTimer) clearInterval(pollTimer);
    };
});
</script>
```

### Anti-Patterns to Avoid

- **Anti-pattern:** Computing stream URLs from `cameras.id` instead of `cameras.mac`. Per L-22 the slug must survive cam-row deletion + recreation; only MAC is stable across re-discovery. The on-disk YAML uses MAC; URL strings rendered in UI must match exactly.
- **Anti-pattern:** Persisting wizard form state to DB (selected cams, output choices). Per L-15 only the step pointer goes to DB; per-step form data is written incrementally to the canonical tables (`camera_outputs` for Step 4, `protect_hub_bridges` for Step 2, etc.).
- **Anti-pattern:** Polling `/api/protect-hub/reconcile-runs` without a cap. The reconcile runs row INSERT happens at the START of `reconcile()` (per `reconcile.ts` Pass 0); a 404 means either the reconcile failed before INSERT or there's a race. UI must retry the SAME reconcileId, not generate a new one.
- **Anti-pattern:** Adding a new event-type union member to `src/lib/types.ts` for reconcile events. The reconciler explicitly bypasses the union (`reconcile.ts:702-709`). Read events via the column directly (string filter on `source = 'protect_hub'`).
- **Anti-pattern:** Building a new `/api/cameras/external-status` endpoint. Per L-15 + CONTEXT.md and verified by `cameras/status/+server.ts`, the merged endpoint is the source of truth — extend it, don't fork it.
- **Anti-pattern:** Calling `discover()` from Step 3's UI button. Use the existing `POST /api/protect-hub/discover` endpoint that already wraps it (per `discover/+server.ts`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stream URL construction in UI | Custom string-concat with `cam.id` | Shared `deriveSlug()` util that mirrors `yaml-builder.ts:108` | The on-disk YAML keys MUST match the URL slugs the user copies; drift = broken Loxone/Frigate consumers |
| Reconciler triggering | Custom SSH command | `POST /api/protect-hub/reconcile` (existing 202 endpoint) | Single-flight + dirty-flag retry + audit row are already inside `reconcile()`; bypass = race conditions |
| Bridge health probing | New `/api/protect-hub/ping` | Reuse `GET /api/protect-hub/bridge/status` + extend with go2rtc HTTP probe | The 5-min scheduler probe at `scheduler.ts:151-206` already exposes this via the bridge status field |
| Output-toggle writes | Direct DB inserts | `PUT /api/cameras/[id]/outputs` (existing) | Server enforces VAAPI hard-cap (6) + soft-cap (4) + replace-strategy + reconcile fan-out |
| YAML hash computation | Custom hash | `canonicalHash()` from `yaml-builder.ts` if needed for drift display | The reconcile audit row already stores `deployedYamlHash` — read it, don't recompute |
| Reconcile event log | Custom polling DB query | `getEvents({source:'protect_hub'})` from `services/events.ts:51` (existing) — wrap with new `GET /api/protect-hub/events` thin endpoint | The events table already accepts free-form `eventType` strings; the helper paginates and filters |
| Toast/notification system | Install `svelte-sonner` or similar | Query-param `?onboarding=success` consumed once on `/kameras` mount | One toast in the entire phase (Step 6 redirect); a library is overkill |
| Resume-banner relative time | `dayjs` / `date-fns` | Pure-TS helper using `Intl.RelativeTimeFormat('de')` | Built into V8/Node — no dependency needed for "vor 12 Minuten" |
| German plural-aware copy | i18n library | Inline ternaries `${n === 1 ? 'Kamera' : 'Kameras'}` | One language, one phase; existing wizard copy uses the same pattern |
| Component testing | Install `@testing-library/svelte` | File-content regex pattern from `tabs.test.ts` | Codebase has zero rendered-component tests; adding the framework is a sub-phase |
| Drift-stamp parsing on bridge | Run YAML-aware diff | Read first line of remote `/etc/go2rtc/go2rtc.yaml` and check for our stamp prefix | Stamp format is locked by `yaml-builder.ts:138`: `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>`; foreign first-line = drift |

**Key insight:** Almost the entire backend P22 needs already exists from P19/P20/P21. The work is overwhelmingly UI assembly + 4 small new server endpoints (wizard pointer CRUD, health, events, all-outputs). Don't rebuild what's there.

## Runtime State Inventory

This phase IS NOT a rename/refactor/migration. **Skipping the runtime-state-inventory matrix.** No external systems persist phase-coupled state — the only schema migration is additive (new `hub_onboarding_state` table).

## Common Pitfalls

### Pitfall 1: `/api/cameras/status` does not currently expose `source`, `kind`, `manufacturer`, `modelName`

**What goes wrong:** UI tries to filter `cameras.filter(c => c.source === 'external')` and gets nothing because the field doesn't exist on the response.

**Why it happens:** `src/routes/api/cameras/status/+server.ts:114-158` constructs `CameraCardData` rows from a hand-picked field list. The DB columns exist (P19 schema lock) but they were never added to the response shape because P19/P20/P21 didn't yet need them in the UI.

**How to avoid:**
1. Wave 0 task: extend `CameraCardData` in `src/lib/types.ts:129-173` with `source: CameraSource`, `kind: CameraKind`, `manufacturer: string | null`, `modelName: string | null`, `externalId: string | null`, `hubBridgeId: number | null`.
2. Update `src/routes/api/cameras/status/+server.ts` to map these fields from the `cameras` row into the result object.
3. Smoke test: assert that for an external cam (source='external'), the response shape contains all six new fields.

**Warning signs:** Empty `/kameras` "Aus UniFi Protect" section even when DB has external rows; CameraDetailCard branching always falls through to managed.

### Pitfall 2: `hub_onboarding_state` table does not exist

**What goes wrong:** Wizard cannot persist its step pointer; HUB-WIZ-09 (resumability) is impossible to implement; resume-banner has nothing to read.

**Why it happens:** The table was specified in `.planning/research/v1.3/PITFALLS.md:248`, locked as L-15 in STATE.md, and referenced by HUB-WIZ-09, but never landed in `schema.ts`. P19 plan-summaries confirm it was deferred ("Plan 19-04 ships only the catalog" implicit). P20 added bridge tables but not this one.

**How to avoid:**
1. Wave 0 task: add the table definition (see Pattern 1 in §Architecture Patterns) to `src/lib/server/db/schema.ts`.
2. Generate migration: `npm run db:generate` then check the new file under `drizzle/0003_*.sql`.
3. Apply: `npm run db:push` (development) or include in deploy script (production — see `scripts/dev-deploy.sh` per project memory).
4. Add a `wizard-state.ts` module under `src/lib/server/orchestration/protect-hub/` exposing `getPointer() / setPointer() / resetPointer() / completePointer()`.

**Warning signs:** `import { hubOnboardingState }` fails at type-check time; running the wizard's `+page.server.ts` throws "no such table".

### Pitfall 3: `hub_state` ENUM column does not exist (L-18 toggle state machine)

**What goes wrong:** Toggle-flap protection (Success Criterion 4 + L-18) cannot block the toggle during `starting`/`stopping` because there's no field to read.

**Why it happens:** L-18 specifies a state-machine over `disabled|starting|enabled|stopping|error`, but the live `protect_hub_bridges` schema only has `status` (running|stopped|failed|provisioning|pending|unhealthy). These are related but not isomorphic — `protect_hub_bridges.status` is bridge-LXC state, not feature-flag state.

**How to avoid:** See Open Question 1. Two viable paths:
- **(A) Add `hub_state` column** to `protect_hub_bridges` (or to `settings` k/v) and write transitions explicitly. Bigger surface but unambiguous.
- **(B) Derive in code** from `(settings.protect_hub_enabled, protect_hub_bridges.status, hub_onboarding_state.step)`. Smaller surface but every reader must agree on the derivation.

**Recommendation:** **(B) Derived state.** A pure function `getHubState(): HubState` in `src/lib/server/orchestration/protect-hub/hub-state.ts` that reads the three signals and returns the L-18 enum value. Keeps the schema additive (just `hub_onboarding_state`); centralizes the rule.

**Warning signs:** Toggle remains active during a starting-bridge race; user double-clicks and triggers two provisioning runs.

### Pitfall 4: Step 6 toast across redirect

**What goes wrong:** Naive `goto('/kameras')` after Step 6 succeeds → user sees `/kameras` but no confirmation toast because the toast component never mounted before navigation.

**Why it happens:** SvelteKit `goto()` is a client-side navigation; the destination's `+page.svelte` mounts AFTER the navigation. State held in the source component is gone.

**How to avoid:** Pass success via URL query param: `goto('/kameras?onboarding=success')`. On `/kameras/+page.svelte` mount, check `$page.url.searchParams.get('onboarding')`; if `'success'`, render an inline alert banner for ~5 s and `replaceState` to remove the param so refresh doesn't re-trigger.

**Warning signs:** "Protect Hub aktiv — N Streams laufen." toast never appears on Step 6→/kameras transition.

### Pitfall 5: VAAPI hard-cap (6) blocks Step 4 silently for large UniFi sites

**What goes wrong:** A user with 8 first-party Protect cams pre-checks all of them with Loxone-MJPEG defaults; Step 4 → Step 5 hits `vaapi_hard_cap_exceeded` (HTTP 422) on the 7th `PUT /api/cameras/[id]/outputs`.

**Why it happens:** `src/routes/api/cameras/[id]/outputs/+server.ts:97-107` rejects when projected MJPEG count > 6 (per L-26). Step 4 must enforce this client-side before submit.

**How to avoid:**
1. Step 4 client-side validation: as the user toggles Loxone-MJPEG checkboxes, count enabled MJPEG outputs. When count reaches 6, disable additional MJPEG checkboxes with tooltip "Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich".
2. The 7th cam can still be added with Frigate-RTSP (which is `-c:v copy` and zero VAAPI per L-26 + L-27).
3. Show a soft-warning at count=4 (D-CAP-01 soft-cap) with a hint about the hard cap at 6.

**Warning signs:** Step 4 → Step 5 transition fails with German error message and user can't proceed without manually unchecking cams.

### Pitfall 6: Sync-now button during in-flight reconcile causes double-trigger

**What goes wrong:** User clicks "Jetzt synchronisieren" while the 5-min scheduler tick or another user's force-reconcile is mid-flight; UI shows two competing spinners.

**Why it happens:** `reconcile.ts:151-160` says concurrent callers JOIN the in-flight Promise (single-flight per L-13) — but the API endpoint always returns a fresh 202 + `reconcileId` even when joining. Two API calls = two `reconcileId`s pointing at the same actual run; the second client's poll on its `reconcileId` will return 404 (because the audit row was created with the first caller's id).

**How to avoid:**
1. UI state: HubStatusPanel reads `isReconcilerBusy()` exposure (need new lightweight `GET /api/protect-hub/reconcile/busy` endpoint OR fold into `/api/protect-hub/health`).
2. When busy, replace Sync-now button label with "Synchronisation läuft…" (per UI-SPEC §sync-now-in-flight).
3. The 404 case on `GET /reconcile-runs?reconcileId=X` is documented in `reconcile.ts:138-145` as expected — the polling Step 5 code must retry, not show an error.

**Warning signs:** "Run not found" error in the UI; spinner never resolves; user re-clicks and gets a third `reconcileId`.

### Pitfall 7: Bridge LXC deleted between sessions (resume edge case)

**What goes wrong:** User starts wizard at Step 2 (provisions bridge), closes browser, manually deletes the LXC via Proxmox UI, reopens wizard. `hub_onboarding_state` says `step=2 status=in_progress`; resume-banner says "Du warst bei Schritt 3 — weiter?". Continue → Step 3 fetches fine, Step 5 first-reconcile fails because no bridge.

**Why it happens:** `getBridgeStatus()` reads from `protect_hub_bridges` — if the row exists but the LXC is gone, the wizard has no way to know. The reconciler's `bridge_unreachable` result classifies this as transient.

**How to avoid:**
1. Resume-banner load logic: on `+page.server.ts` load, fetch both `getPointer()` AND `getBridgeStatus()` AND a quick `tryListContainer(vmid)` probe.
2. If bridge row exists but Proxmox returns 404 for the vmid → render a special "Bridge missing — Reset wizard" state (replace continue button with reset).
3. Reset clears both `hub_onboarding_state` AND `protect_hub_bridges` row so the next wizard run starts at Step 1.

**Warning signs:** Step 5 fails with "bridge unreachable" on a fresh wizard re-entry; user has no path forward except DB surgery.

### Pitfall 8: External cam appears in `/kameras` BEFORE wizard completes

**What goes wrong:** User runs Step 3 (which calls `discover()`); external cam rows are inserted into `cameras` table; `/kameras` re-fetches and the user sees external cams BEFORE Step 6 sets `protect_hub_enabled=true`.

**Why it happens:** P19's `discover()` is run at any time (settings tab "Aktualisieren" button + Step 3 trigger). External rows live in the table from that moment forward. CONTEXT.md says external section renders ONLY when `hubEnabled === true` — so the gate is correct.

**How to avoid:**
1. `/kameras/+page.svelte` filters: `cameras.filter(c => c.source === 'external' && data.hubEnabled)`. If hubEnabled=false, the entire `<section>` is omitted (per UI-SPEC §kameras-partition).
2. This is per-design — discover() can populate the table speculatively; the UI gate is the contract that hides external rows until the user finishes onboarding.

**Warning signs:** External cams visible immediately after Step 3 — UI test should specifically assert `data.hubEnabled === false ⇒ no external section rendered`.

### Pitfall 9: Slug uses MAC, but external cams might not have one

**What goes wrong:** Catalog upsert at `catalog.ts:67-72` THROWS if `mac === ''`. But `yaml-builder.ts:deriveSlug()` assumes mac is non-empty. URL templates in the UI assume the same.

**Why it happens:** L-1 is "MAC-as-PK" — without MAC the row never gets inserted. If somehow it did, `deriveSlug('', 'loxone-mjpeg')` returns `-low` which is meaningless.

**How to avoid:**
1. The DB-level guard at `catalog.ts:67-72` is correct — every row in `cameras WHERE source='external'` is guaranteed `mac IS NOT NULL`.
2. Browser-side `deriveSlug()` should still defensively check: `if (!mac) throw new Error('cam has no mac — slug cannot be derived')`.
3. Snapshot of an external cam without MAC = should never happen, but if it does, render a "Stream-Adresse nicht verfügbar" placeholder rather than a broken URL.

**Warning signs:** URL strings rendered as `-low` or `-high` (no MAC prefix) in the UI; copy buttons paste garbage.

### Pitfall 10: Drift-detection requires SSH-into-bridge; cannot be done synchronously

**What goes wrong:** HubStatusPanel wants a "drift detected: yes/no" flag at render time. But detecting drift requires reading the first line of `/etc/go2rtc/go2rtc.yaml` over SSH — too slow for a server-load.

**Why it happens:** Drift is real-state vs. expected-state. Expected lives in `bridge.lastDeployedYamlHash`; real lives on the bridge LXC.

**How to avoid:**
1. Fast path: store the LAST drift-check result + timestamp in `protect_hub_bridges` (add a column or reuse `lastHealthCheckAt`). Initial render shows the cached result.
2. New endpoint `GET /api/protect-hub/drift` runs the SSH probe on demand (when user clicks "Erneut prüfen") OR is run by the existing 5-min scheduler tick.
3. Recommended: piggy-back on the 5-min health probe in `scheduler.ts:146-206` — extend it to also `cat /etc/go2rtc/go2rtc.yaml | head -1` and compare against the expected stamp prefix; persist `driftDetected: boolean` on the bridge row.

**Warning signs:** Page load takes >1 s on Settings → Hub-Tab because of synchronous SSH; or drift always shows "unknown".

## Code Examples

### Reading the wizard pointer (server)

```ts
// src/lib/server/orchestration/protect-hub/wizard-state.ts
import { db } from '$lib/server/db/client';
import { hubOnboardingState } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export type WizardPointer = {
    step: number;
    status: 'in_progress' | 'completed' | 'reset';
    lastActivityAt: string;
    error: string | null;
} | null;

export function getPointer(): WizardPointer {
    const row = db.select().from(hubOnboardingState).where(eq(hubOnboardingState.id, 1)).get();
    return row ?? null;
}

export function setPointer(step: number, error: string | null = null): void {
    const existing = getPointer();
    const now = new Date().toISOString();
    if (!existing) {
        db.insert(hubOnboardingState).values({
            id: 1, step, status: 'in_progress', lastActivityAt: now, error
        }).run();
    } else {
        db.update(hubOnboardingState).set({
            step, status: 'in_progress', lastActivityAt: now, error
        }).where(eq(hubOnboardingState.id, 1)).run();
    }
}

export function resetPointer(): void {
    db.delete(hubOnboardingState).where(eq(hubOnboardingState.id, 1)).run();
}

export function completePointer(): void {
    const now = new Date().toISOString();
    db.update(hubOnboardingState).set({
        step: 6, status: 'completed', lastActivityAt: now, error: null
    }).where(eq(hubOnboardingState.id, 1)).run();
}
```

### Wizard step-advance endpoint

```ts
// src/routes/api/protect-hub/wizard/[step]/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setPointer } from '$lib/server/orchestration/protect-hub/wizard-state';

export const POST: RequestHandler = async ({ params }) => {
    const step = Number(params.step);
    if (!Number.isInteger(step) || step < 1 || step > 6) {
        return json({ ok: false, error: 'invalid step' }, { status: 400 });
    }
    setPointer(step);
    return json({ ok: true, step });
};
```

### Health endpoint (Step 5 staged readiness)

```ts
// src/routes/api/protect-hub/health/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBridgeStatus } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';
import { isReconcilerBusy } from '$lib/server/orchestration/protect-hub/reconcile';

export const GET: RequestHandler = async () => {
    const bridge = getBridgeStatus();
    if (!bridge?.containerIp) {
        return json({ ok: false, stage: 'no_bridge', reconcilerBusy: false });
    }
    let go2rtcReady = false;
    let streamCount = 0;
    try {
        const res = await fetch(`http://${bridge.containerIp}:1984/api/streams`, {
            signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
            go2rtcReady = true;
            const streams = await res.json();
            streamCount = Object.keys(streams).length;
        }
    } catch { /* not ready */ }

    return json({
        ok: true,
        bridgeStatus: bridge.status,
        bridgeIp: bridge.containerIp,
        go2rtcReady,
        streamCount,
        reconcilerBusy: isReconcilerBusy(),
        lastReconciledAt: bridge.lastReconciledAt,
        lastDeployedYamlHash: bridge.lastDeployedYamlHash
    });
};
```

### `/kameras` partition rendering

```svelte
<!-- src/routes/kameras/+page.svelte (after Wave 0 type extension) -->
<script lang="ts">
    let cameras = $state<CameraCardData[]>([]);
    // existing fetch + poll …

    let managedCams = $derived(cameras.filter(c => c.source !== 'external'));
    let externalCams = $derived(cameras.filter(c => c.source === 'external'));
</script>

<div class="space-y-12">
    <section>
        <h2 class="text-base font-semibold text-text-primary mb-4">
            Eigene Kameras ({managedCams.length})
        </h2>
        <div class="space-y-4">
            {#each managedCams as camera (camera.id)}
                <CameraDetailCard {camera} />
            {/each}
        </div>
    </section>

    {#if data.hubEnabled}
        <section>
            <h2 class="text-base font-semibold text-text-primary mb-4">
                Aus UniFi Protect ({externalCams.length})
            </h2>
            <div class="space-y-4">
                {#each externalCams as camera (camera.id)}
                    <ExternalCamCard {camera} bridgeIp={data.bridgeIp} />
                {:else}
                    <p class="text-sm text-text-secondary">
                        Noch keine Protect-Kameras erkannt.
                    </p>
                {/each}
            </div>
        </section>
    {/if}
</div>
```

### Slug + URL derivation (shared util)

```ts
// src/lib/protect-hub/slug.ts (importable from BOTH browser and server)
// Source: mirrors src/lib/server/orchestration/protect-hub/yaml-builder.ts:108
export type OutputType = 'loxone-mjpeg' | 'frigate-rtsp';

export function deriveSlug(mac: string, outputType: OutputType): string {
    if (!mac) throw new Error('deriveSlug: mac is required');
    const suffix = outputType === 'loxone-mjpeg' ? 'low' : 'high';
    return `${mac}-${suffix}`;
}

export function deriveStreamUrl(
    bridgeIp: string,
    mac: string,
    outputType: OutputType
): string {
    const slug = deriveSlug(mac, outputType);
    return outputType === 'loxone-mjpeg'
        ? `http://${bridgeIp}:1984/api/stream.mjpeg?src=${slug}`
        : `rtsp://${bridgeIp}:8554/${slug}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 stores + reactive `$:` | Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) | Svelte 5 GA (2024) | Project already uses runes throughout (verified `let { data } = $props()` in existing wizard) |
| Tailwind v3 with `tailwind.config.js` | Tailwind v4 with CSS-native `@theme` | Tailwind 4 GA (2024) | Project already on v4 — see `src/routes/layout.css:3` `@theme {` block |
| SvelteKit form actions for AJAX | `+page.server.ts` form actions OR `fetch` to `+server.ts` | SvelteKit 2 (2024) | Both patterns coexist; P22 uses fetch to `+server.ts` for incremental writes (Steps 3-5) and form actions only for Step 6 redirect+complete if simpler |
| Prisma | Drizzle ORM with `sqliteTable` | Locked at project setup | All P22 schema work uses drizzle-kit migrations; `db:push` for dev, `db:generate` + commit migration for prod |
| jest + jsdom for component tests | Vitest in jsdom (or skip — file-content regex) | Vitest 4 GA (2024) | This project chose REGEX over render-tests; P22 follows |

**Deprecated/outdated:**
- Anything assuming Svelte 4 lifecycle hooks (`onMount`, `onDestroy`) — Svelte 5 uses `$effect` with cleanup return.
- Anything assuming Drizzle 0.36-style schema — current is 0.45 with `$inferSelect` types.
- The `text-[10px]` and `text-[11px]` exceptions in UI-SPEC are **explicitly retired** in revision 2026-05-06 (UI-SPEC line 494) — all small text is `text-xs` (12 px).
- The `px-1.5 py-0.5` badge micro-padding is **explicitly retired** (UI-SPEC line 508) — replaced with on-grid `px-2 py-1`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The L-18 `hub_state` ENUM is best DERIVED in code rather than added as a DB column | Pitfall #3 / Open Question 1 | If user/discuss-phase prefers an explicit column, Wave 0 task list must be updated |
| A2 | Step 5 health-poll cadence of 1500 ms (per CONTEXT.md) is acceptable load on the bridge LXC | Pattern 2 | Fine for single-user MVP; if multi-tab is a concern, may need sticky-poll or last-event throttle. Sub-second cadence stress testing is out of scope. |
| A3 | A new endpoint `GET /api/protect-hub/health` should be added rather than reusing `/api/protect-hub/bridge/status` | Code Examples §health | Could fold the new fields into bridge/status to avoid endpoint sprawl. Naming `/health` matches the user-visible concept; planner may choose to combine. |
| A4 | The drift-detection probe extends the existing 5-min scheduler tick rather than adding a new tick | Pitfall #10 | If the 5-min cadence is too slow for the UI ("erneut prüfen" must be quick), an on-demand `GET /api/protect-hub/drift` endpoint is needed in addition. |
| A5 | The toast on Step 6 → /kameras can be a simple URL query param + inline alert; no library needed | Don't Hand-Roll | If Phase 23 also needs toasts (e.g. for offboarding confirmations), it's cheap to introduce a small library then; not in P22 scope. |
| A6 | Component tests follow the `tabs.test.ts` regex pattern; no new framework added | Pattern 5 | If user/planner wants real render tests, the planner must scope a Wave 0 task to install `@testing-library/svelte` 5.3.1 + jsdom 29 + svelte-jester. |
| A7 | The slug-derivation helper at `src/lib/protect-hub/slug.ts` (browser-shareable) is acceptable; no need to extract a fully-shared `protect-hub` lib | Pattern 4 | If P23 needs more shared logic, the planner can promote `protect-hub/` to a sub-package. |
| A8 | `protect_hub_bridges` is single-row in P22 scope (single bridge MVP per v1.3) | Architecture | Verified — `bridge-lifecycle.ts:14` does `db.select().from(protectHubBridges).get()` with no filter. Multi-bridge is out of scope for v1.3. |
| A9 | First-party / third-party UI rendering uses the `cameras.kind` column populated by P19's `classifyKind()`, not a per-render derivation | HUB-UI-02 | Verified — `protect-bridge.ts:106-108` derives kind once at discover-time and persists it. Browser reads it as-is. |
| A10 | Snapshot URL format is `http://{bridgeIp}:1984/api/frame.jpeg?src={slug}` | HUB-UI-03 / Architecture | This matches the existing managed-cam pattern in `go2rtc.ts:364-372` (which writes `snapshot: /api/frame.jpeg?src=...` into go2rtc YAML). go2rtc serves frame snapshots over HTTP from the same `:1984` API port. **Verified via search** — but worth a quick UAT smoke when implementing. |

## Open Questions

1. **`hub_state` enum: column or derived?**
   - What we know: L-18 mandates a 5-state machine `disabled|starting|enabled|stopping|error`; current schema only has `protect_hub_bridges.status` (LXC-state, not feature-state).
   - What's unclear: should the planner add a `hub_state` column on `protect_hub_bridges` (or `settings`), or derive it in code from existing signals?
   - **Recommendation:** Derive in code. Add `src/lib/server/orchestration/protect-hub/hub-state.ts` with a pure function `getHubState(): HubState` reading `(settings.protect_hub_enabled, protect_hub_bridges.status, hub_onboarding_state.step)`. Keeps schema additive (only `hub_onboarding_state`); centralizes the rule.
   - **If user prefers explicit column:** Add `hub_state TEXT NOT NULL DEFAULT 'disabled'` to `protect_hub_bridges` AND write transitions in every relevant codepath (bridge lifecycle, wizard complete, settings toggle). Larger surface, cleaner audit.

2. **`hub_onboarding_state` shape: single-row or multi-row history?**
   - What we know: Resume-banner needs `(step, lastActivityAt)`; reset clears the row.
   - What's unclear: Should past abandoned wizard runs be kept (audit) or overwritten (simplicity)?
   - **Recommendation:** Single-row (`id=1` always upserted). Simpler; no `WHERE id=...` filtering anywhere. If audit is desired later, P23 can add an `onboarding_history` table separately.

3. **Sync-now button: does it use the existing `POST /api/protect-hub/reconcile` endpoint?**
   - What we know: That endpoint already does single-flight + 202 + audit row + reconcileId — exactly what Sync-now needs.
   - What's unclear: Does the HubStatusPanel poll the resulting `reconcileId` to show in-flight status, or just rely on `isReconcilerBusy` exposed via `/api/protect-hub/health`?
   - **Recommendation:** Use the existing endpoint as-is. Poll `health` for the busy flag. No new endpoint.

4. **Drift indicator: real-time SSH probe or cached?**
   - What we know: A real-time probe is too slow for server-load (~300 ms SSH dial). 5-min cadence is fine for an indicator that displays "drift detected: 18 minutes ago".
   - What's unclear: Should the planner add a new background tick or piggy-back on the existing 5-min health tick?
   - **Recommendation:** Piggy-back. Extend `scheduler.ts:146-206` to also `cat /etc/go2rtc/go2rtc.yaml | head -1` and compare to the expected stamp prefix; write `bridge.driftDetected: boolean + bridge.driftCheckedAt: text` (two new columns or pack into a single JSON if columns are constrained).

5. **Cancellable enabling: AbortController or backend-cancel?**
   - What we know: UI-SPEC §toggle line 356 says: "A separate Abbrechen button is rendered next to the toggle ONLY when state ∈ {enabling, disabling} **and** the in-flight request is cancellable (P21 reconciler is async-fire-and-poll, so this is wired to AbortController on the fetch)."
   - What's unclear: AbortController only cancels the BROWSER fetch — the server still completes the reconcile. Is that acceptable? Per L-13 single-flight, the server can't be canceled mid-pass.
   - **Recommendation:** Per UI-SPEC the cancel button is "rendered disabled" when not cancellable — the spec already captures this. Implement: AbortController on the fetch ONLY (best-effort cancel of pending HTTP request); show "Vorgang läuft" while server finishes regardless.

6. **`/api/protect-hub/all-outputs` vs read-from-page-server:**
   - What we know: All-URLs page only needs read access at server-load time, no polling.
   - What's unclear: Add a separate API endpoint (consistent with reconcile-runs / events) OR just read in `+page.server.ts` directly?
   - **Recommendation:** Read in `+page.server.ts`. SSR page doesn't need an API endpoint for one-shot data. If a public API is needed in the future, refactor.

## Environment Availability

This is a UI phase; no new external runtime dependencies beyond what P19/P20/P21 already require. The planner should still confirm:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bridge LXC running on Proxmox | Steps 5–6 + ExternalCamCard snapshot + status panel | ✓ when prior phases succeeded; ✗ on first wizard run (Step 2 provisions it) | n/a | None — Step 2 must succeed before Step 5 starts |
| go2rtc on bridge `:1984` | snapshot preview, /api/streams readiness | ✓ once Step 5 reconcile succeeds | n/a (managed binary) | Empty UI states ("Vorschau nicht verfügbar") |
| UniFi Protect controller reachable | Step 3 discover | depends on user's network | unifi-protect 4.29.0 | Step 3 surfaces existing `controller_unreachable` error from `discover()` |
| `npm run db:push` / `npm run db:generate` | Wave 0 schema migration | ✓ (drizzle-kit ^0.31.8 in devDependencies) | 0.31.8 | None — required |
| Vitest test runner | All smoke tests | ✓ (vitest ^4.1.0 in devDependencies) | 4.1.0 | None — required |
| `@testing-library/svelte` | NOT REQUIRED — regex tests only | ✗ | — | Use file-content regex pattern from `tabs.test.ts` (default) |
| Playwright | NOT REQUIRED — manual UAT only | ✗ | — | Manual UAT against live VM (existing pattern from P21 plan 06) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Component testing framework — fallback is the established regex-against-source pattern.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 (jsdom NOT installed; tests run in node env) |
| Config file | `vite.config.ts` (combined Vite+Vitest config; `test.include = ['src/**/*.test.ts']`) |
| Quick run command | `npm run test:unit -- --run src/<path-or-pattern>` |
| Full suite command | `npm test` (= `npm run test:unit -- --run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HUB-WIZ-05 | Step 3 fetches Protect cams + groups by kind | smoke (regex) | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ❌ Wave 0 |
| HUB-WIZ-06 | Step 4 first-party pre-checked, third-party unchecked, output dropdown | smoke (regex) | same as above | ❌ Wave 0 |
| HUB-WIZ-07 | Step 5 polls health endpoint with 1.5s cadence; 90s timeout | smoke (regex) | same as above | ❌ Wave 0 |
| HUB-WIZ-08 | Step 6 redirects to /kameras with onboarding=success param | smoke (regex) | same as above | ❌ Wave 0 |
| HUB-WIZ-09 | Wizard reads `hub_onboarding_state` pointer on load; resume-banner renders when ptr ≠ null | unit | `npm run test:unit -- --run src/lib/server/orchestration/protect-hub/wizard-state.test.ts` | ❌ Wave 0 |
| HUB-WIZ-09 | `+page.server.ts` returns `pointer` field; resume banner consumes it | smoke (regex) | `npm run test:unit -- --run src/routes/settings/protect-hub/onboarding/wizard.test.ts` | ❌ Wave 0 |
| HUB-WIZ-10 | `protect_hub_enabled` written ONLY in `/api/protect-hub/wizard/complete` | unit + grep | `npm run test:unit -- --run src/routes/api/protect-hub/wizard/complete/server.test.ts` | ❌ Wave 0 |
| HUB-UI-01 | `/api/cameras/status` exposes `source/kind/manufacturer/modelName` fields | unit (server endpoint) | `npm run test:unit -- --run src/routes/api/cameras/status/server.test.ts` | ❌ Wave 0 (NEW test file) |
| HUB-UI-01 | `/kameras/+page.svelte` partitions managed vs external | smoke (regex) | `npm run test:unit -- --run src/routes/kameras/page.test.ts` | ❌ Wave 0 |
| HUB-UI-02 | ExternalCamCard renders Protect-Hub badge + qualifier (UniFi or Drittanbieter) | smoke (regex) | `npm run test:unit -- --run src/lib/components/cameras/ExternalCamCard.test.ts` | ❌ Wave 0 |
| HUB-UI-03 | ExternalCamCard renders catalog table + outputs subsection + snapshot reload | smoke (regex) | same as HUB-UI-02 | ❌ Wave 0 |
| HUB-UI-04 | ExternalCamCard does NOT render delete/edit buttons | smoke (regex) | same as HUB-UI-02 | ❌ Wave 0 |
| HUB-UI-05 | Action menu has "Aus Hub entfernen" disabled with P23 tooltip | smoke (regex) | same as HUB-UI-02 | ❌ Wave 0 |
| HUB-UI-06 | ProtectHubGuide renders Loxone + Frigate snippets with bridge IP + slug | smoke (regex) | `npm run test:unit -- --run src/lib/components/protect-hub/ProtectHubGuide.test.ts` | ❌ Wave 0 |
| HUB-UI-07 | All-URLs page groups by output type, lists every active URL | unit (server load) | `npm run test:unit -- --run src/routes/settings/protect-hub/all-urls/page.test.ts` | ❌ Wave 0 |
| HUB-UI-08 | HubStatusPanel + HubEventLog render bridge state + last 50 events | smoke (regex) | `npm run test:unit -- --run src/lib/components/settings/ProtectHubTab.test.ts` (extended) | ❌ Wave 0 |
| Toggle state machine | Loxone-MJPEG hard-cap UI client-side validation at 6 enabled | unit | `npm run test:unit -- --run src/lib/components/cameras/OutputToggle.test.ts` | ❌ Wave 0 |
| Pointer atomic-complete | `wizard/complete` clears pointer + sets enabled in same request | unit | `npm run test:unit -- --run src/routes/api/protect-hub/wizard/complete/server.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --run <test-file-just-touched>` (~3-10 s)
- **Per wave merge:** `npm test` (~30-60 s for the existing suite + ~1-2 s per new P22 test file)
- **Phase gate:** Full suite green before `/gsd-verify-work`. Plus a manual UAT pass against the live VM:
  1. Open wizard from clean state → all 6 steps complete → `/kameras` shows external cams
  2. Kill SvelteKit mid-Step-5 (`systemctl restart ip-cam-master`) → reopen wizard → resume-banner shows Step 5 → continue → completes
  3. Toggle Loxone-MJPEG output OFF → ON on an external cam → URL appears → reconciler runs → URL works in Loxone
  4. Visit `/settings/protect-hub/all-urls` → all active URLs listed + copy buttons work
  5. Click "Jetzt synchronisieren" → in-flight state → completes

### Wave 0 Gaps

- [ ] `src/lib/server/orchestration/protect-hub/wizard-state.test.ts` — covers HUB-WIZ-09 + atomic-complete
- [ ] `src/routes/settings/protect-hub/onboarding/wizard.test.ts` — covers HUB-WIZ-05/06/07/08 (regex against `+page.svelte` + step components)
- [ ] `src/routes/api/protect-hub/wizard/complete/server.test.ts` — covers HUB-WIZ-10
- [ ] `src/routes/api/cameras/status/server.test.ts` (NEW — does not exist) — covers HUB-UI-01 response shape
- [ ] `src/routes/kameras/page.test.ts` — covers HUB-UI-01 partitioning
- [ ] `src/lib/components/cameras/ExternalCamCard.test.ts` — covers HUB-UI-02/03/04/05
- [ ] `src/lib/components/protect-hub/ProtectHubGuide.test.ts` — covers HUB-UI-06
- [ ] `src/routes/settings/protect-hub/all-urls/page.test.ts` — covers HUB-UI-07
- [ ] `src/lib/components/settings/ProtectHubTab.test.ts` (NEW or extend existing `tabs.test.ts`) — covers HUB-UI-08
- [ ] `src/lib/components/cameras/OutputToggle.test.ts` — covers VAAPI-cap UI guard
- [ ] Schema migration `drizzle/0003_hub_onboarding_state.sql` — generated via `npm run db:generate`
- [ ] Type extension in `src/lib/types.ts` for CameraCardData (source/kind/manufacturer/modelName fields)

*(Framework install: NOT NEEDED — vitest already installed; pattern is regex-against-source)*

## Sources

### Primary (HIGH confidence)
- **Source code (verified directly):** `src/lib/server/db/schema.ts` (cameras + protect_hub_bridges + camera_outputs + protect_stream_catalog + protect_hub_reconcile_runs), `src/lib/server/orchestration/protect-hub/{catalog,reconcile,bridge-lifecycle,yaml-builder}.ts`, `src/routes/api/protect-hub/{discover,reconcile,reconcile-runs,bridge/*}/+server.ts`, `src/routes/api/cameras/{status,[id]/outputs}/+server.ts`, `src/routes/settings/protect-hub/onboarding/{+page.svelte,+page.server.ts}`, `src/routes/kameras/+page.svelte`, `src/lib/components/cameras/CameraDetailCard.svelte`, `src/lib/components/settings/ProtectHubTab.svelte`, `src/routes/layout.css`, `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`, `src/lib/server/services/{events,scheduler,settings}.ts`, `src/lib/types.ts`, `src/routes/settings/tabs.test.ts`, `package.json`, `vite.config.ts`
- **Planning artifacts (HIGH-confidence project-internal):** `.planning/STATE.md` (locks L-1..L-29), `.planning/ROADMAP.md` (Phase 22 goal + success criteria), `.planning/REQUIREMENTS.md` (HUB-WIZ-* + HUB-UI-* with mapping to phases), `.planning/research/v1.3/PITFALLS.md` (state-machine pattern, toggle-flap mitigation), `.planning/research/v1.3/SUMMARY.md` (schema overview), `.planning/phases/19-data-model-protect-catalog/19-RESEARCH.md` (catalog architecture), `.planning/phases/22-onboarding-wizard-cameras-integration/22-CONTEXT.md` (locked decisions), `.planning/phases/22-onboarding-wizard-cameras-integration/22-UI-SPEC.md` (visual contract)

### Secondary (MEDIUM confidence)
- **npm registry (latest versions):** verified via `npm view <pkg> version` on 2026-05-07: svelte 5.55.5, @sveltejs/kit 2.59.1, drizzle-orm 0.45.2, vitest 4.1.5, bits-ui 2.18.1, @testing-library/svelte 5.3.1, jsdom 29.1.1
- **Context7 lookup:** Svelte 5 runes docs (`/sveltejs/svelte` v5.37.0, 613 snippets, score 88.55) — confirmed `$state`/`$derived`/`$effect`/`$props` are the active patterns

### Tertiary (LOW confidence — flagged for validation)
- **A10 (snapshot URL pattern `:1984/api/frame.jpeg?src=<slug>`):** inferred from existing managed-cam pattern in `go2rtc.ts:364-372`; a quick UAT against the live bridge will confirm. If the path differs, the ExternalCamCard snapshot URL must be adjusted.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified in package.json + npm; no new deps needed
- Architecture: HIGH — every backend hook P22 calls into was read directly in source
- Pitfalls: HIGH — all 10 pitfalls grounded in code or planning artifacts; the 3 critical gaps were found by direct verification, not assumption
- Validation: HIGH — pattern inherited from existing `tabs.test.ts`; 11 specific test files mapped to 14 requirement IDs

**Research date:** 2026-05-07
**Valid until:** 2026-06-06 (30 days for stable codebase; sooner if Phase 22 implementation reveals divergent backend behavior). The 3 schema/API gaps are the most likely source of replanning if missed in Wave 0.
