---
phase: 22-onboarding-wizard-cameras-integration
plan: 05
subsystem: ui
tags: [protect-hub, settings, all-urls, ui, p22, status-panel, event-log, toggle-flap-protection]

# Dependency graph
requires:
  - phase: 22-onboarding-wizard-cameras-integration
    provides: getHubState (Plan 02 — derived 5-state enum); /api/protect-hub/health (Plan 02 Task 4); /api/protect-hub/events (Plan 02 Task 4); /api/protect-hub/drift (Plan 02 stub); /api/protect-hub/wizard/reset (Plan 02 Task 3); deriveSlug + deriveStreamUrl (Plan 02 Task 2)
  - phase: 21-multi-cam-yaml-reconciliation-loop
    provides: POST /api/protect-hub/reconcile + isReconcilerBusy (consumed by HubStatusPanel Sync-now button)
  - phase: 20-protect-bridge-provisioning
    provides: getBridgeStatus + protect_hub_bridges schema (consumed by all-urls loader)
  - phase: 19-protect-stream-hub-data-model
    provides: cameraOutputs + cameras schemas with source/mac columns (consumed by all-urls loader)

provides:
  - "HubStatusPanel.svelte — 4 status rows + drift block + Sync-now button, polls /health + /drift every 10 s"
  - "HubEventLog.svelte — divide-y mono grid, polls /events?limit=50 every 10 s"
  - "ProtectHubTab.svelte — embeds both new panels AND wires L-18 toggle-flap-protection (SC-4)"
  - "settings/+page.server.ts — load() now exposes hubState via getHubState() to ProtectHubTab"
  - "/settings/protect-hub/all-urls — new bulk-URL view grouped by output type (HUB-UI-07)"

affects:
  - phase 22 plan 06 — UAT validates Hub-Status panel against the live VM, exercises Sync-now end-to-end, verifies toggle-flap-protection during a wizard run, copies a URL from /all-urls
  - phase 23 — drift indicator gains its real body (currently driftDetected:false stub from Plan 02); offboarding flow flips toggle off→disabled (currently a no-op surface)

# Tech tracking
tech-stack:
  added: []  # No new libraries; pure feature wiring on existing rune + Tailwind + lucide stack
  patterns:
    - "10 s parallel-poll pattern (Promise.all + setInterval cleanup in $effect return) for two endpoints whose data lives on the same panel"
    - "Sync-now state machine: syncInFlight $state + reconcilerBusy server flag; button disabled while EITHER is true (T-22-20 mitigation)"
    - "Toggle-flap-protection (L-18) as a derived $derived(hubState ∈ {starting, stopping}) gate + separate Abbrechen button POSTing to /wizard/reset (the only abort path)"
    - "Loader-side derived-state extension — settings/+page.server.ts threads getHubState() into the existing tabs prop chain without a new API endpoint"
    - "All-URLs grouped-render pattern — $derived(filter by outputType) + per-group empty state copy + per-row Shared-5 copy idiom with copiedKey discriminator"
    - "Page h1 typography ladder discipline: text-2xl font-semibold for P22-introduced h1s (font-bold retired per UI-SPEC revision 2026-05-06)"

key-files:
  created:
    - "src/lib/components/protect-hub/HubStatusPanel.svelte"
    - "src/lib/components/protect-hub/HubEventLog.svelte"
    - "src/lib/components/settings/ProtectHubTab.test.ts"
    - "src/routes/settings/protect-hub/all-urls/+page.svelte"
    - "src/routes/settings/protect-hub/all-urls/+page.server.ts"
    - "src/routes/settings/protect-hub/all-urls/page.test.ts"
  modified:
    - "src/lib/components/settings/ProtectHubTab.svelte"
    - "src/routes/settings/+page.server.ts"
    - "src/routes/settings/+page.svelte"
    - ".planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md"

key-decisions:
  - "Added the 'Protect Hub aktivieren' toggle to ProtectHubTab.svelte. Plan text references it as the existing L-18 surface, but the live source did not yet have one — the only enable path was the 'Bridge einrichten' CTA. Adding the toggle was required to make SC-4 (toggle-flap-protection) testable. Off→on click navigates to /settings/protect-hub/onboarding (the wizard's atomic /wizard/complete then flips protect_hub_enabled='true'); the on→off path is owned by P23 and rendered as a no-op for now."
  - "Duplicated the HubState union type locally in ProtectHubTab.svelte instead of importing from '$lib/server/orchestration/protect-hub/hub-state'. SvelteKit's compiler refuses to bundle $lib/server/* code into the client; even a type-only import would require a build flag. The duplicated 5-string union is byte-identical and trivially comparable; if hub-state.ts ever changes the enum, the loader's getHubState() return would also break, surfacing the drift at the loader site rather than as a silent client-side bug."
  - "Sync-now poll loop has a 120 s safety cap. The plan's pseudo-code is `while(true) { await refresh; if (!busy) break; }`. Without a cap, a stuck reconciler would freeze the UI's loading state indefinitely. 120 s is well above the P21 reconciler's hard timeout (90 s in the worst case) so a healthy run never hits the cap."
  - "All-URLs loader filters out rows with null mac OR null bridgeIp before deriving URLs. deriveSlug/deriveStreamUrl throw on empty mac (Plan 02 guard); the loader pre-filters so we never throw inside a server load function (which would surface as a 500)."
  - "All-URLs page h1 uses text-2xl font-semibold per UI-SPEC line 81 (P22-introduced h1s use font-semibold; font-bold remains only on the pre-existing /kameras h1). Defensive test asserts no class attribute uses font-bold."

patterns-established:
  - "Parallel 10 s poll for two related endpoints — Promise.all + single setInterval; $effect return clears the interval. Mirrored from kameras/+page.svelte:25-31 (Shared 4) but with parallel fetches."
  - "Two-axis 'busy' gate for write-then-poll buttons: client syncInFlight $state OR server reconcilerBusy flag — disabled label flips to 'Synchronisation läuft…' for either condition (covers both pre-server-ack and post-ack-still-running phases)."
  - "Loader-side extension pattern for cross-component derived state: compute via async getter in +page.server.ts, return in load() object, thread through existing prop chain into the tab component (no new API route required)."

requirements-completed:
  - HUB-UI-07  # /settings/protect-hub/all-urls bulk-URL view grouped by output type
  - HUB-UI-08  # Hub-Tab Hub-Status panel + event log + Sync-now + L-18 toggle-flap-protection (SC-4)

# Metrics
duration: ~30min
completed: 2026-05-07
---

# Phase 22 Plan 05: Hub-Tab Status Panel and All-URLs Page Summary

**Two new panels (HubStatusPanel + HubEventLog) embed into the Settings → Protect Hub tab, the L-18 toggle-flap-protection (SC-4) is wired end-to-end via getHubState() loader → ProtectHubTab disabled+spinner+Abbrechen, and a new /settings/protect-hub/all-urls page renders all enabled output URLs grouped by Loxone-MJPEG / Frigate-RTSP for bulk Loxone/Frigate provisioning.**

## Performance

- **Duration:** ~30 minutes (3 tasks, 3 commits + this summary commit)
- **Started:** 2026-05-07T14:43:00Z (approx)
- **Completed:** 2026-05-07T14:50:00Z
- **Tasks:** 3 (all complete, all autonomous)
- **Files created/modified:** 10 (6 created, 4 modified)
- **Commits:** 3 (one per task) + this metadata commit
- **Test count delta:** +23 unit tests (12 ProtectHubTab + 11 all-urls)
- **Test suite:** 26/26 Plan 05 tests pass; 114/114 protect-hub regression tests still green
- **Type-check:** 0 errors introduced; 15 pre-existing errors in untracked OutputToggle.svelte (parallel Plan 22-03 in-flight) — documented in deferred-items.md

## Accomplishments

- **HubStatusPanel.svelte** (Task 1): polls /api/protect-hub/health + /api/protect-hub/drift every 10 s in parallel via Promise.all. Renders 4 status rows (bridge dot + label, last reconcile relative-time, YAML hash truncated to 8 chars, active stream count). Drift block renders only when driftDetected===true (Plan 02 stub returns false in P22 — block stays hidden by design). Sync-now button POSTs /api/protect-hub/reconcile, shows Loader2 + "Synchronisation läuft…" while syncInFlight OR reconcilerBusy=true, polls /health at 1 s until reconcilerBusy drops, then invalidateAll's the page. T-22-20 (Sync-now spam-click) mitigated via the dual-axis busy gate.
- **HubEventLog.svelte** (Task 1): polls /api/protect-hub/events?limit=50 every 10 s. Renders divide-y mono grid (4 cols: time · type-badge · status · short reconcile id). Empty-state copy "Noch keine Ereignisse aufgezeichnet."; error rows tinted text-danger per UI-SPEC line 296. Both components use $effect with cleanup return for setInterval lifecycle.
- **ProtectHubTab.svelte modifications** (Task 2): imports + renders <HubStatusPanel /> + <HubEventLog /> after the existing Bridge-Container card and before the existing Stream-Katalog refresh card. All P19/P20 chrome (Why intro card, Bridge-Container, refresh card, catalog table) preserved verbatim. Adds the L-18 "Protect Hub aktivieren" toggle at the top of the tab — disabled with inline Loader2 + "Vorgang läuft…" caption + a separate "Abbrechen" button when hubState ∈ {starting, stopping}. Cancel button POSTs /api/protect-hub/wizard/reset and invalidateAll's (clears in_progress pointer → next render shows hub_state=disabled).
- **+page.server.ts loader extension** (Task 2): imports getHubState from $lib/server/orchestration/protect-hub/hub-state, calls it in load(), threads hubState into the return object alongside the existing protectHub block. The settings/+page.svelte tab dispatch threads hubState={data.hubState} into <ProtectHubTab>.
- **ProtectHubTab.test.ts** (Task 2): 12 regex assertions — 5 baseline (HubStatusPanel + HubEventLog imports + template references + Bridge-Container heading preserved + bridgeAction function preserved) + 5 SC-4 wiring (≥2 hubState === starting/stopping checks, "Vorgang läuft…", "Abbrechen", POST /api/protect-hub/wizard/reset, disabled={toggleDisabled} or disabled={hubState ===}) + 2 loader (getHubState import + return-shape).
- **/settings/protect-hub/all-urls/+page.server.ts** (Task 3): drizzle inner-join cameraOutputs + cameras WHERE enabled=true AND source='external'. Reads protect_hub_enabled gate first; returns hubEnabled=false + empty arrays when off. Uses deriveSlug + deriveStreamUrl from the browser-shareable $lib/protect-hub/slug.ts (Plan 02 parity-tested). Pre-filters rows with null mac OR null bridgeIp before deriving URLs.
- **/settings/protect-hub/all-urls/+page.svelte** (Task 3): h1 "Hub-Adressen — Übersicht" using text-2xl font-semibold (NOT font-bold — UI-SPEC retired bold for P22-introduced h1s). Two groups in $derived: Loxone-MJPEG first, Frigate-RTSP second. Per row: grid grid-cols-[1fr_auto_auto] gap-3 — cam name + slug · mono URL · copy button (Shared 5 idiom with copiedKey discriminator + 2000 ms timeout). Empty group state "Keine Ausgänge dieses Typs aktiv."; empty page state (hub off) "Protect Hub ist nicht aktiv. → Im Einstellungs-Tab 'Protect Hub' aktivieren." Breadcrumb back-link to /settings.
- **page.test.ts** (Task 3): 11 regex assertions across loader (schemas + innerJoin, protect_hub_enabled gate, deriveSlug/deriveStreamUrl imports, enabled=true + source=external filter) and page (lucide icons + copyToClipboard, group headers, empty-page copy, h1 typography + no font-bold class, grid-cols layout, sr-only hint, breadcrumb).

## Task Commits

1. **Task 1 — HubStatusPanel + HubEventLog components:** `d7571ca`
2. **Task 2 — embed status panel + event log + L-18 toggle gate:** `f7396a6`
3. **Task 3 — /settings/protect-hub/all-urls page + loader:** `a584575`

**Plan-metadata commit:** to follow this summary.

## Files Created/Modified

### Created (6)

- `src/lib/components/protect-hub/HubStatusPanel.svelte` — Hub status + drift + Sync-now (~155 LOC)
- `src/lib/components/protect-hub/HubEventLog.svelte` — last 50 events mono grid (~85 LOC)
- `src/lib/components/settings/ProtectHubTab.test.ts` — 12 SC-4 + panel-embedding regex assertions
- `src/routes/settings/protect-hub/all-urls/+page.svelte` — Hub-Adressen Übersicht UI
- `src/routes/settings/protect-hub/all-urls/+page.server.ts` — joined enabled-outputs loader
- `src/routes/settings/protect-hub/all-urls/page.test.ts` — 11 regex assertions

### Modified (4)

- `src/lib/components/settings/ProtectHubTab.svelte` — added "Protect Hub aktivieren" toggle with L-18 disable + spinner + caption + Abbrechen, embedded HubStatusPanel + HubEventLog, kept all P19/P20 chrome
- `src/routes/settings/+page.server.ts` — added getHubState import + await getHubState() + hubState in load() return
- `src/routes/settings/+page.svelte` — threaded hubState={data.hubState} into <ProtectHubTab>
- `.planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md` — already documented OutputToggle.svelte 10-error block (parallel Plan 22-03 work-in-flight)

## Decisions Made

- **Added the "Protect Hub aktivieren" toggle to ProtectHubTab.** The plan text references it as "the existing L-18 surface", but the live source had no toggle — the only enable path was the "Bridge einrichten" CTA. Adding the toggle was required to make SC-4 (toggle-flap-protection) a testable surface. Off→on navigates to /settings/protect-hub/onboarding (the wizard's atomic /wizard/complete then flips protect_hub_enabled='true' per Plan 02 Task 3). On→off is owned by P23 (offboarding) and rendered as a no-op for now — toggle visually stays "on" until P23 lands.
- **Duplicated the HubState union type locally in ProtectHubTab.svelte.** Importing types from `$lib/server/orchestration/protect-hub/hub-state` is rejected by SvelteKit's client-bundling guard (server-only modules cannot leak into the browser, even type-only). The 5-string union is byte-identical and trivially comparable. If hub-state.ts ever changes the enum, the loader's getHubState() return would also break, surfacing the drift at the loader site, not as a silent client-side bug.
- **Sync-now poll loop has a 120 s safety cap.** Plan's pseudo-code is `while(true) { await refresh; if (!busy) break; }`. Without a cap, a stuck reconciler would freeze the UI's loading state indefinitely. 120 s exceeds the P21 reconciler's worst-case hard timeout (90 s) so a healthy run never hits the cap.
- **All-URLs loader pre-filters rows with null mac OR null bridgeIp** before deriving URLs. deriveSlug/deriveStreamUrl throw on empty mac (Plan 02 guard); pre-filtering avoids throwing inside a server load function (which would surface as a 500 to the user).
- **All-URLs page h1 uses text-2xl font-semibold** per UI-SPEC line 81 (P22-introduced h1s use font-semibold; font-bold remains only on the pre-existing /kameras h1). Defensive test asserts no class attribute uses font-bold.
- **The defensive `font-bold` test originally matched the comment text** "NOT font-bold". Tightened the regex to `/class="[^"]*\bfont-bold\b[^"]*"/` so it only matches actual class attributes. This is a Rule 1 self-correction (test was over-eager), not a deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing functionality] No "Protect Hub aktivieren" toggle existed on the live source**
- **Found during:** Task 2 design pass.
- **Issue:** Plan text references "the existing 'Protect Hub aktivieren' toggle is the L-18 surface that P22 must gate". The live source (ProtectHubTab.svelte at HEAD~3) had no toggle — only a "Bridge einrichten" CTA. Without a toggle, SC-4 (toggle-flap-protection) would have nothing to gate.
- **Fix:** Added the toggle as a new card at the top of the credsConfigured branch. Off→on navigates to /settings/protect-hub/onboarding (the wizard atomically saves protect_hub_enabled='true' on Step 6 via /wizard/complete per Plan 02 Task 3). On→off is owned by P23 (offboarding flow); rendered as a no-op for now.
- **Files affected:** `src/lib/components/settings/ProtectHubTab.svelte`
- **Committed in:** `f7396a6` (Task 2 commit)

**2. [Rule 1 — Test bug] `expect(src).not.toMatch(/font-bold/)` matched comment text**
- **Found during:** Task 3 first test run (1/11 failed).
- **Issue:** The defensive "no font-bold anywhere" assertion matched the script-comment text "NOT font-bold" (used to document why font-semibold is correct).
- **Fix:** Tightened the regex to `/class="[^"]*\bfont-bold\b[^"]*"/` so it only matches actual class attributes. The intent is preserved — UI-SPEC retired font-bold for P22-introduced h1s — but the regex no longer false-positives on documentation comments.
- **Files affected:** `src/routes/settings/protect-hub/all-urls/page.test.ts`
- **Committed in:** `a584575` (Task 3 commit)

### Out-of-Scope / Deferred

**3. [Out of scope] 10–15 svelte-check errors in `src/lib/components/cameras/OutputToggle.svelte`**
- **Found during:** Task 2 + Task 3 `npm run check` runs.
- **Issue:** OutputToggle.svelte is untracked (created by parallel Plan 22-03 wave). Errors include redeclared `body`, `$state` typing, missing `message`/`error` properties on a typed shape. Reproduces on `git stash` of Plan 22-05 changes — confirmed pre-existing.
- **Action:** Logged to `.planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md` (already documented from Plan 22-04 Task 2 sweep). Plan 22-03's verifier will address.
- **Impact on Plan 22-05:** None. The 12+11 Plan 22-05 tests pass; the 114 protect-hub regression tests pass. None of Plan 22-05's own files contribute to the error count (verified via `git stash` toggle).

---

**Total deviations:** 2 auto-fixed (Rule 2 missing toggle + Rule 1 test regex over-match) + 1 out-of-scope item documented.

## Threat Surface Scan

All threats from the plan's `<threat_model>` register handled as designed:

- **T-22-17 (Information Disclosure on All-URLs):** Accept per L-23 (LAN-trust). The loader gates on `protect_hub_enabled='true'` so the URLs only render when the user has explicitly enabled the Hub. Deferred-items has no related debt.
- **T-22-18 (DoS on dual 10 s polling):** Accept per L-23. Two parallel polls per panel; each request is bounded (health: 2 s timeout from Plan 02; events: SQLite read, fast).
- **T-22-20 (Sync-now spam click):** Mitigated. Button disabled while syncInFlight OR reconcilerBusy=true; reconciler is single-flight at server (P21 L-13). Verified in HubStatusPanel.svelte template + script.
- **T-22-21 (DoS on all-urls server-load):** Accept. Bounded by `enabled=true AND source='external'` filter; max ~50 cams in single-bridge MVP. SQLite query <10 ms.
- **T-22-23 (Toggle flap-protection bypass):** Mitigated. Toggle is a UX gate; the actual settings.protect_hub_enabled flip happens via /wizard/complete (Plan 02 server-side validates). The Abbrechen button POST /wizard/reset only resets the pointer, never flips the feature flag.

**No new threat surface introduced beyond the plan's register.**

## Known Stubs

- **Drift block in HubStatusPanel renders only when `drift?.driftDetected === true`** — and Plan 02's `/api/protect-hub/drift` endpoint is a stub returning `{ driftDetected: false, checkedAt: null }`. So in P22 the drift block never renders. This is intentional per the plan (RESEARCH §Pitfall #10 — full drift detection lands in P23). The conditional is wired correctly so the block will appear automatically once P23 replaces the stub body.
- **The "Protect Hub aktivieren" toggle is a no-op when ON** — Off→on navigates to the wizard, but on→off is owned by P23 (offboarding flow). The toggle stays visually "on" once enabled until P23 lands. Not a stub of the panel itself; a deliberate scope boundary documented in the script comment.

## TDD Gate Compliance

The plan declared `tdd="true"` on all 3 tasks but used a "ship test alongside source" approach — the plan's `<action>` blocks describe writing source + test in one task, and the per-task verify command runs the new test file. All tests were authored alongside their source and run green at commit time. Commits use `feat()` (not `test()`+`feat()` pairs) because each task ships both source and test in one logical change. Task 1 has no test file declared in the plan and verifies via `npm run check` (the components are component-render-only with no business logic to unit-test).

## Issues Encountered

- **Pre-existing `OutputToggle.svelte` errors** (15 svelte-check errors from parallel Plan 22-03 in-flight). Documented in `deferred-items.md`; not blocking Plan 22-05 verification.
- **Test regex over-match on comment text** — fixed inline before commit (Deviation 2).
- **Plan referenced a toggle that didn't exist on the live source** — added inline as Rule 2 missing functionality (Deviation 1).

## User Setup Required

None. The new panels and page light up automatically once the live VM picks up the next git-push deploy. No new external service config, no new env vars, no new schema (all consumed schemas were locked in Phase 19/20/22-02).

## Next Phase Readiness

- **Plan 22-06 UAT:** can now exercise the full Settings → Protect Hub surface against the live VM —
  - Hub-Status panel shows bridge state, last reconcile, hash, stream count
  - Sync-now click → spinner → completes → resumes
  - Event log shows last 50 events; error rows red
  - During a wizard run (hubState='starting'): toggle disabled with spinner + "Vorgang läuft…" + Abbrechen button visible; clicking Abbrechen calls /api/protect-hub/wizard/reset and the toggle becomes enabled again
  - /settings/protect-hub/all-urls lists all enabled outputs grouped by Loxone-MJPEG / Frigate-RTSP; copy buttons work

- **Phase 23:** when the drift detector lands (`/api/protect-hub/drift` body replaced + `protect_hub_bridges.driftDetected` column write), the HubStatusPanel drift block + "Erneut deployen" button activate automatically — no Plan 22-05 component change needed. When the offboarding flow lands, the toggle's on→off branch can be wired to a confirmation modal + cleanup pipeline; the L-18 disable+spinner+Abbrechen behaviour then also covers the stopping transition (already gated by `hubState === 'stopping'`).

## Self-Check: PASSED

**Files claimed:**
- ✅ FOUND: `src/lib/components/protect-hub/HubStatusPanel.svelte`
- ✅ FOUND: `src/lib/components/protect-hub/HubEventLog.svelte`
- ✅ FOUND: `src/lib/components/settings/ProtectHubTab.test.ts`
- ✅ FOUND: `src/routes/settings/protect-hub/all-urls/+page.svelte`
- ✅ FOUND: `src/routes/settings/protect-hub/all-urls/+page.server.ts`
- ✅ FOUND: `src/routes/settings/protect-hub/all-urls/page.test.ts`
- ✅ FOUND: `src/lib/components/settings/ProtectHubTab.svelte` (modified — embeds panels + L-18 toggle)
- ✅ FOUND: `src/routes/settings/+page.server.ts` (modified — getHubState in load() return)
- ✅ FOUND: `src/routes/settings/+page.svelte` (modified — hubState prop on <ProtectHubTab>)

**Commits claimed:**
- ✅ FOUND: d7571ca (Task 1 — HubStatusPanel + HubEventLog components)
- ✅ FOUND: f7396a6 (Task 2 — ProtectHubTab embed + L-18 toggle gate + loader extension)
- ✅ FOUND: a584575 (Task 3 — /all-urls page + loader + tests)

**Test counts:**
- ✅ Plan-specific: 23/23 pass (12 ProtectHubTab + 11 all-urls)
- ✅ Settings tabs regression: 3/3 pass (tabs.test.ts unchanged)
- ✅ Protect-hub regression: 114/114 pass (no new regressions in orchestration / api / lib paths)
- ✅ Type-check: 0 new errors introduced (15 pre-existing in OutputToggle.svelte from parallel Plan 22-03 — out of scope)

---
*Phase: 22-onboarding-wizard-cameras-integration*
*Completed: 2026-05-07*
