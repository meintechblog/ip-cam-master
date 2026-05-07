---
phase: 22-onboarding-wizard-cameras-integration
plan: 03
subsystem: ui
tags: [protect-hub, kameras, ui, components, p22, wave-3]

# Dependency graph
requires:
  - phase: 22-onboarding-wizard-cameras-integration
    provides: "Plan 02 — /api/cameras/status hub fields (source, kind, manufacturer, modelName, externalId, hubBridgeId, streamCatalog, outputs); $lib/protect-hub/slug (deriveSlug, deriveStreamUrl, OutputType); /api/protect-hub/health for toast streamCount"
  - phase: 21-multi-cam-yaml-reconciliation-loop
    provides: "PUT /api/cameras/[id]/outputs (replace-strategy + 422 vaapi_hard_cap_exceeded with German message body)"
  - phase: 19-protect-stream-hub-data-model
    provides: "cameras.{source,kind,manufacturer,modelName,mac,externalId,hubBridgeId} columns"
  - phase: 20-protect-bridge-provisioning
    provides: "bridge-lifecycle.ts:getBridgeStatus → containerIp surfaced in +page.server.ts loader"

provides:
  - "/kameras page partitioned into two sections: 'Eigene Kameras (N)' (always) + 'Aus UniFi Protect (N)' (gated on data.hubEnabled)"
  - "ExternalCamCard.svelte — external Protect cam variant with Protect-Hub badge + UniFi/Drittanbieter qualifier, snapshot preview, read-only Stream Catalog table, OutputsSubsection, ProtectHubGuide, disabled 'Aus Hub entfernen' button with P23 tooltip"
  - "OutputToggle.svelte — primitive with off→enabling→on state machine + AbortController + 422 vaapi-cap rollback + L-18 disabled-during-flight gate"
  - "OutputsSubsection.svelte — composes 2 OutputToggle rows (Loxone-MJPEG + Frigate-RTSP) + URL captions + copy buttons (visible when ON), builds sibling-output arrays for replace-strategy PUT"
  - "ProtectHubGuide.svelte — tabbed Loxone (Intercom) + Frigate (NVR) snippet display with copy buttons, short-circuits to nothing when bridgeIp/mac is null"
  - "/kameras +page.server.ts loader returns hubEnabled (settings.protect_hub_enabled === 'true') + bridgeIp (getBridgeStatus().containerIp) alongside existing fields"
  - "/kameras toast banner: consumes ?onboarding=success once, fetches streamCount from /api/protect-hub/health, renders dismissable green banner for 5s, replaceState removes the param so refresh doesn't retrigger"
  - "CameraDetailCard.svelte — defensive source gate on the LXC chrome block (`{#if !isNativeOnvif && camera.source !== 'external'}`) eliminates the live-VM 'LXC 0 + red dot' bug if any caller passes an external cam through"
  - "/api/cameras/status response now exposes cam.mac (Rule 3 deviation — Plan 02 missed this when extending the type with hub fields; required for client-side slug derivation)"

affects:
  - "phase 22 plan 06 — UAT visually verifies /kameras partition, Protect-Hub badge + qualifier, snapshot preview, output toggles, ProtectHubGuide tabs, and the onboarding=success toast on the live VM"
  - "phase 22 plan 04 wizard Step 6 — the existing 'Zur Kameraliste' link drives the user to /kameras?onboarding=success which now produces a green toast banner"
  - "phase 23 (offboarding) — owns the active path for the disabled 'Aus Hub entfernen' button (currently shows P23 tooltip)"

# Tech tracking
tech-stack:
  added: []  # No new libraries — pure Svelte 5 components on existing tokens
  patterns:
    - "Svelte 5 toggle primitive with `$state` enum, `$derived` in-flight gate, `$bindable` enabled prop, and AbortController for in-flight cancellation"
    - "Replace-strategy aware sibling-output composition — child OutputToggle receives `siblingOutputs` so the PUT body keeps the OTHER row's state intact"
    - "422-status branched JSON parsing with German error surfaced from `body.message` (server-side single source of truth for cap-error copy)"
    - "Page-level partition + bridgeIp prop drilling — avoids forcing CameraDetailCard to know about ExternalCamCard, while still keeping a defensive source gate on the LXC chrome block"
    - "Browser-shareable slug derivation (`$lib/protect-hub/slug`) consumed by 3 components (ExternalCamCard, OutputsSubsection, ProtectHubGuide) — keeps every URL byte-identical with go2rtc's YAML key per Pitfall #9"

key-files:
  created:
    - "src/lib/components/cameras/ExternalCamCard.svelte"
    - "src/lib/components/cameras/ExternalCamCard.test.ts"
    - "src/lib/components/cameras/OutputToggle.svelte"
    - "src/lib/components/cameras/OutputToggle.test.ts"
    - "src/lib/components/cameras/OutputsSubsection.svelte"
    - "src/lib/components/protect-hub/ProtectHubGuide.svelte"
    - "src/lib/components/protect-hub/ProtectHubGuide.test.ts"
    - "src/routes/kameras/page.test.ts"
  modified:
    - "src/routes/kameras/+page.svelte"
    - "src/routes/kameras/+page.server.ts"
    - "src/lib/components/cameras/CameraDetailCard.svelte"
    - "src/lib/types.ts"
    - "src/routes/api/cameras/status/+server.ts"
    - ".planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md"

key-decisions:
  - "Page-level partition (Strategy B) over CameraDetailCard early-return (Strategy A): /kameras filters by c.source and routes external cams to <ExternalCamCard> directly — avoids forcing bridgeIp to be a CameraDetailCard prop and keeps the 972-line legacy component untouched. Defense-in-depth: still added the source gate on CameraDetailCard:386 LXC block in case any other caller passes an external cam."
  - "OutputToggle uses local rune-state name `toggleState` (not `state`) to avoid shadowing Svelte 5's `$state` rune in svelte-check's scope analysis. Initial draft used `state` and triggered 4 type errors; rename was the minimal fix."
  - "OutputsSubsection composes `siblingOutputs` for each child OutputToggle so the replace-strategy PUT keeps the OTHER row's enabled state intact. Without this, toggling Loxone-MJPEG ON would silently clear Frigate-RTSP. The parent controls cross-row state; the toggle primitive itself is single-output."
  - "ExternalCamCard does NOT render a 'copy cam name' or 'copy Protect deep-link' affordance — kept the import idiom in source for P23 to wire visible affordances without re-importing copyToClipboard. Hidden div is intentional, documented inline."
  - "/kameras toast logic uses `consumeOnboardingToast()` with a `toastConsumed` guard so the $effect re-running (Svelte 5 reactivity) doesn't double-fire. The consumed flag short-circuits subsequent calls."

patterns-established:
  - "External-cam component family pattern: ExternalCamCard (parent) → OutputsSubsection (composes 2 OutputToggle children) + ProtectHubGuide (tabbed snippet sibling). Three components, each independently testable via regex-against-source per Shared 6."
  - "5-state state machine in Svelte 5 components with rollback semantics: enter transitional state optimistically, AbortController per call, server-provided German error rendered directly, rollback to previousState on error or non-OK response."
  - "Browser-side slug consumption: 3 separate components import { deriveSlug, deriveStreamUrl } from '$lib/protect-hub/slug' instead of replicating the convention. Single source of truth across snapshot URLs, output URLs, and snippet URLs."

requirements-completed:
  - HUB-UI-01  # /kameras two-section partition (managed always; external when hubEnabled)
  - HUB-UI-02  # ExternalCamCard with Protect-Hub badge + qualifier + read-only catalog
  - HUB-UI-03  # OutputToggle state machine + URL+copy when ON
  - HUB-UI-04  # ProtectHubGuide Loxone snippet (tabbed)
  - HUB-UI-05  # ProtectHubGuide Frigate snippet (tabbed)
  - HUB-UI-06  # LXC chrome eliminated for source='external' (defensive gate + page-level routing)

# Metrics
duration: ~13min
completed: 2026-05-07
---

# Phase 22 Plan 03: kameras-partition-and-external-cam-ui Summary

**Four components and a page partition land the visible payoff of v1.3 — `/kameras` now shows external Protect cams in their own "Aus UniFi Protect (N)" section with a Protect-Hub primary badge + first/third-party qualifier, toggleable Loxone-MJPEG / Frigate-RTSP outputs with copy-buttons, ready-to-paste Loxone + Frigate config snippets, and the live-VM "LXC 0 + red dot" bug on 22 external rows is gone (defensive source gate + page-level routing).**

## Performance

- **Duration:** ~13 minutes (4 tasks, 4 commits)
- **Started:** 2026-05-07T12:40:07Z
- **Completed:** 2026-05-07T~12:53Z
- **Tasks:** 4 (all complete, autonomous — no checkpoints)
- **Files created:** 8 (4 components + 3 tests + 1 page test)
- **Files modified:** 6 (loader, page, CameraDetailCard gate, types.ts, cameras/status endpoint, deferred-items.md)
- **Commits:** 4 (one per task — feat() for all four; no test()+feat() pairs because each task ships test alongside source)
- **Test count delta:** +25 unit tests (5 page + 8 ExternalCamCard + 5 OutputToggle + 7 ProtectHubGuide)
- **Test suite:** 25/25 plan tests pass · 135/135 protect-hub-related tests pass · 470/482 full suite pass (12 unrelated baseline failures in proxmox.test.ts + onboarding.test.ts — see Deferred Issues below)
- **Type-check:** 0 errors · 33 warnings (all pre-existing accessibility / state-references-locally hints, none in files this plan touched)

## Accomplishments

- **`/kameras` partition (Task 1):** Replaced the single `<div class="space-y-4">` cam list with a two-section layout (`<div class="space-y-12">` per UI-SPEC §kameras-partition). Managed section always renders; external section is gated on `data.hubEnabled` (omitted entirely when hub is disabled, per CONTEXT.md decision — no empty placeholder). Within external section, when `externalCams.length === 0` the empty-state copy "Noch keine Protect-Kameras erkannt." renders.
- **Loader extension:** `+page.server.ts` now reads `getSetting('protect_hub_enabled')` and `getBridgeStatus()?.containerIp` and returns `{ hubEnabled, bridgeIp, ...existing }`. Hub flags load even when proxmox is unconfigured — partition logic needs them either way.
- **CameraDetailCard defensive gate:** Added `&& camera.source !== 'external'` to the LXC block at line 386 (Strategy B fallback per plan). The page partition already routes externals to `<ExternalCamCard>`, so the LXC block is unreachable via the normal render — this is defense-in-depth in case any other caller passes an external cam.
- **ExternalCamCard (Task 2):** New component (~170 LOC). Top-row: cam name + Protect-Hub primary badge (`bg-accent/15 text-accent border border-accent/30 px-2 py-1 rounded text-xs`) + qualifier badge ("UniFi" / "Drittanbieter · {manufacturer}" / "Drittanbieter · Unbekannt"). Two-column body: snapshot preview (left, with manual reload icon — no auto-refresh per CONTEXT.md) + read-only Stream Catalog table (right, 18rem on lg+, 3 cols: Channel · Codec · Auflösung@FPS). Wires `<OutputsSubsection>` and `<ProtectHubGuide>`. Action menu: only the disabled "Aus Hub entfernen" button with "Verfügbar in Phase 23" tooltip (UI-SPEC line 236).
- **OutputToggle:** Single-output primitive with the off→enabling→on state machine (and reverse) per RESEARCH §Pattern 3. AbortController per call; on 422 with `reason='vaapi_hard_cap_exceeded'`, surfaces server-provided German `body.message` directly (server is single source of truth for cap-error copy). Disabled while in flight (L-18). Inline error message below the row in `text-xs text-danger`.
- **OutputsSubsection:** Composes 2 `<OutputToggle>` children (Loxone-MJPEG · 640×360 · 10 fps · transcodiert (VAAPI) + Frigate-RTSP · Passthrough · ohne Audio). URL caption rows visible only when toggle is ON, using `deriveStreamUrl(bridgeIp, mac, outputType)` from `$lib/protect-hub/slug`. Copy buttons reuse the standard `let copied = $state(false) + setTimeout(2000)` idiom. Builds `siblingOutputs` arrays so the replace-strategy PUT keeps the other row's state intact.
- **ProtectHubGuide (Task 3):** New component (~140 LOC). Tabbed Loxone (Intercom) + Frigate (NVR). Loxone snippet: 3-line plain-text block with German `#`-comments, ready-to-paste into Loxone "Benutzerdefinierte Intercom" — pre-filled with `http://${bridgeIp}:1984/api/stream.mjpeg?src=${mac}-low`. Frigate snippet: per-cam YAML `cameras:` block with commented detect/record hints — pre-filled with `rtsp://${bridgeIp}:8554/${mac}-high`. Per-tab copy buttons reuse the standard idiom. Short-circuits to nothing when `bridgeIp` or `mac` is null.
- **Toast banner (Task 4):** /kameras consumes `?onboarding=success` query param ONCE on mount via `consumeOnboardingToast()`. Fetches stream count from `/api/protect-hub/health`, sets `showToast=true`, renders inline green banner ("Protect Hub aktiv — N Streams laufen.") below the h1, immediately strips the query param via `goto(window.location.pathname, { replaceState: true })` so refresh doesn't retrigger. Auto-dismisses after 5s; manual dismiss via X-button clears the timer.
- **Defense in depth — `cam.mac` surfaced (Rule 3 deviation):** `/api/cameras/status` now returns `cam.mac` alongside the 6 hub fields Plan 02 added. ExternalCamCard / OutputsSubsection / ProtectHubGuide all need it to derive go2rtc slugs (snapshot URL, output URLs, snippet URLs). Without it, the slug pipeline is unusable on the client. Plan 02 missed this. Single non-breaking field addition; existing `cameras/status/server.test.ts` still green (2/2).

## Task Commits

1. **Task 3 — ProtectHubGuide tabbed snippet display:** `e4e4f66`
2. **Task 2 — ExternalCamCard + OutputToggle + OutputsSubsection:** `2a3573c`
3. **Task 1 — /kameras partition + loader + LXC gate fix:** `185a15f`
4. **Task 4 — wire ?onboarding=success toast banner on /kameras:** `e20fcae`

(Task execution order was T3 → T2 → T1 → T4 to satisfy import dependencies — T2 imports ProtectHubGuide; T1 imports ExternalCamCard; T4 augments T1's page. Plan-text task numbering preserved in commit subjects.)

**Plan-metadata commit:** to follow this summary.

## Files Created/Modified

### Created (8)

- `src/lib/components/cameras/ExternalCamCard.svelte` — external Protect cam card variant
- `src/lib/components/cameras/ExternalCamCard.test.ts` — 8 regex assertions
- `src/lib/components/cameras/OutputToggle.svelte` — single-output toggle primitive with state machine
- `src/lib/components/cameras/OutputToggle.test.ts` — 5 regex assertions
- `src/lib/components/cameras/OutputsSubsection.svelte` — 2 toggle rows + URL captions + copy buttons
- `src/lib/components/protect-hub/ProtectHubGuide.svelte` — tabbed Loxone + Frigate snippet display
- `src/lib/components/protect-hub/ProtectHubGuide.test.ts` — 7 regex assertions
- `src/routes/kameras/page.test.ts` — 5 regex assertions for the partition

### Modified (6)

- `src/routes/kameras/+page.svelte` — partition + onboarding=success toast (Tasks 1 + 4)
- `src/routes/kameras/+page.server.ts` — adds `hubEnabled` + `bridgeIp` to loader return
- `src/lib/components/cameras/CameraDetailCard.svelte` — defensive `&& camera.source !== 'external'` on LXC block
- `src/lib/types.ts` — `CameraCardData.mac: string | null` (Rule 3 deviation)
- `src/routes/api/cameras/status/+server.ts` — surface `cam.mac` in response (Rule 3 deviation)
- `.planning/phases/22-onboarding-wizard-cameras-integration/deferred-items.md` — marked OutputToggle TS-error item RESOLVED 2026-05-07

## Decisions Made

- **Page-level partition over CameraDetailCard early-return.** The plan offered Strategy A (preferred per CONTEXT.md) — branch in CameraDetailCard, delegate to ExternalCamCard. Strategy B was offered as fallback. We executed a hybrid: page-level partition in `/kameras/+page.svelte` routes external cams directly to `<ExternalCamCard>` (clean separation, no bridgeIp prop on CameraDetailCard, 972-line legacy component untouched), AND the defensive source gate on CameraDetailCard:386 LXC block (defense-in-depth in case any future caller passes an external cam through). This is the cleanest of both strategies for the live state of the codebase.
- **OutputToggle local rune-state named `toggleState`, not `state`.** Initial draft used `let state = $state<ToggleState>(...)`; svelte-check's scope analysis flagged this as shadowing the `$state` rune (4 errors at line 44). Rename to `toggleState` was the minimal fix. The 5-assertion regex test still locks the state literals (`'off'`, `'enabling'`, `'on'`, `'disabling'`, `'error'`) but does not assert the variable name itself, so the rename is non-breaking.
- **OutputsSubsection composes `siblingOutputs` per child.** The PUT /api/cameras/[id]/outputs endpoint uses replace-strategy: every PUT replaces the entire output set for the cam. If OutputToggle sent only its own row, toggling Loxone ON would silently disable Frigate. Parent OutputsSubsection passes the OTHER row's current enabled state via `siblingOutputs` prop; child OutputToggle merges its own change into that array before PUT. The toggle primitive itself remains single-output (testable in isolation), parent owns cross-row state composition.
- **`cam.mac` is now part of `/api/cameras/status` response.** Plan 02 added 6 hub scalar fields to `CameraCardData` but missed `cam.mac` (the actual cam MAC, not `lxcMac` which is the LXC container's MAC). All three new components need `cam.mac` to derive go2rtc slugs via `deriveSlug(mac, outputType)`. Without it the entire slug pipeline (snapshot URL, output URLs, snippet URLs) is unusable on the client. Surface it as a non-breaking additive field on the response shape and the type. (Documented as Deviation 1 below.)
- **CameraDetailCard `bridgeIp` not propagated.** Strategy A (CameraDetailCard early-return delegating to ExternalCamCard) would have required adding `bridgeIp?: string | null` to CameraDetailCard's prop signature. Page-level partition avoids this — `<ExternalCamCard>` renders directly with `bridgeIp={data.bridgeIp}` on the page, never going through CameraDetailCard.
- **Toast `toastConsumed` guard.** The `$effect` block runs on initial mount AND on reactive dependency changes. Without a guard, `consumeOnboardingToast` could fire twice (once on mount, once on a subsequent re-render). The `toastConsumed` flag short-circuits subsequent invocations — toast is a strict one-shot.
- **Hidden copy-cam-name affordance reserved for P23.** ExternalCamCard imports the `copyToClipboard` idiom (`Copy` + `Check` icons + `let copiedName = $state(false)`) but renders the affordance inside a `class="hidden"` block. P23 will wire visible cam-rename + Protect deep-link affordances; keeping the import + state idiom in source means P23 doesn't need to re-import the utility. Documented inline in the component.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `cam.mac` missing from `CameraCardData` and `/api/cameras/status` response**
- **Found during:** Task 2 (ExternalCamCard component implementation)
- **Issue:** Plan 03's `<context>` block references `camera.mac` for ExternalCamCard / ProtectHubGuide / OutputsSubsection slug derivation. But Plan 02's `CameraCardData` extension added 6 hub fields plus `streamCatalog` + `outputs` — and missed `cam.mac` itself. The slug pipeline (`deriveSlug(mac, outputType)`) is unusable on the client without it. The DB column exists (`cameras.mac` from P19); only the response shape and the type omitted it.
- **Fix:** Added `mac: string | null` to `CameraCardData` (between the 6 hub fields and the catalog/outputs arrays — annotated with a Plan-03-Task-2 deviation comment). Mapped `cam.mac ?? null` into the `/api/cameras/status` response object alongside the existing 6 hub fields. Existing `cameras/status/server.test.ts` continues to pass (2/2) — the additive field doesn't break existing assertions.
- **Files affected:** `src/lib/types.ts`, `src/routes/api/cameras/status/+server.ts`
- **Committed in:** `2a3573c` (Task 2 commit)

**2. [Rule 1 — Bug] Initial OutputToggle.svelte had 4 svelte-check errors from `$state` rune shadowing**
- **Found during:** Task 2 (initial draft type-check)
- **Issue:** Initial draft used `let state = $state<ToggleState>(...)`. svelte-check's scope analyzer reported: "Block-scoped variable '$state' used before its declaration", "Untyped function calls may not accept type arguments", and the local `state` shadowed the `$state` rune. Also 6 errors from `body` being declared three times in the same function (in the request body, the 422 branch, and the generic-error branch).
- **Fix:** Renamed local `state` → `toggleState` everywhere (12 references). Renamed `body` → `requestBody` (in the request) / `capBody` (in the 422 branch) / `errBody` (in the generic-error branch). All 10 errors cleared on re-run.
- **Files affected:** `src/lib/components/cameras/OutputToggle.svelte`
- **Committed in:** `2a3573c` (Task 2 commit) — one commit, the renames were applied before commit per the executor protocol's pre-commit type-check.

**3. [Rule 1 — Test refinement] Initial ExternalCamCard.test.ts "no LXC chrome" regex was too aggressive**
- **Found during:** Task 2 (running ExternalCamCard.test.ts after writing the component)
- **Issue:** Initial regex `/LXC \d+|LXC \{|VMID|protect_hub_bridges/` matched the substring "LXC 0" inside a documentation comment in the component header (which is intentional context — explains the bug being fixed). The assertion was too broad: it should target rendered template tokens (`{camera.vmid}`, `{camera.lxcCpu}`, `{camera.lxcMemory}`, `{camera.containerStatus}`) not source comments.
- **Fix:** Refined the regex to negative-assert only the JSX templating tokens that would render LXC chrome. Comments about LXC are still allowed (and useful — they document why this card exists).
- **Files affected:** `src/lib/components/cameras/ExternalCamCard.test.ts`
- **Committed in:** `2a3573c` (Task 2 commit) — single commit.

### Out-of-Scope / Deferred

**4. [Out of scope] 12 pre-existing baseline test failures in `proxmox.test.ts` (4) + `onboarding.test.ts` (8)**
- **Found during:** Full-suite run after Task 4
- **Issue:** Same 12 SSH-mock-chain failures Plan 22-02 documented in `deferred-items.md`. Both files unchanged by Plan 22-03. Failures reproduce on `main@270c5a8` (pre-Plan-22-02) when run in isolation.
- **Action:** No new entries added — Plan 22-02's existing entry covers these exhaustively. Recommend the same `/gsd:debug` session Plan 22-02 already recommended.
- **Impact on plan:** None. Plan 22-03's `<verification>` block specifies `npm run test:unit -- --run <plan-files>`; all 25 plan-specific tests pass. The 135/135 protect-hub-related tests also pass (broader regression check).

### Resolved deferred items

- **`OutputToggle.svelte` TS errors (logged in deferred-items.md by Plan 22-04 Task 2 type-check)** — RESOLVED in Task 2 (commit `2a3573c`). The committed version uses `toggleState` + scoped `requestBody`/`capBody`/`errBody` locals. `npm run check` reports 0 errors. deferred-items.md updated to mark the item resolved with the commit reference.

---

**Total deviations:** 3 auto-fixed (Rule 3 blocking + Rule 1 bug + Rule 1 test refinement) + 1 out-of-scope item (already tracked, no new entry needed) + 1 deferred item resolved.

## Threat Surface Scan

All threats from the plan's `<threat_model>` register are mitigated as designed:

- **T-22-09 (Information Disclosure — Bridge IP rendered):** `accept` per L-23 (LAN-trust). Verified: bridge IP is rendered only inside copy-snippets and snapshot URLs, never logged or sent off-LAN. The user owns the LAN segment; rendering 192.168.x.y to a logged-in user is not a leak.
- **T-22-10 (XSS — `camera.name`/`camera.manufacturer` rendering):** `mitigate`. Verified: Svelte auto-escapes interpolated text by default (`{camera.name}`, `{qualifierLabel}`). No `{@html ...}` usages introduced — verified by grep across all 4 new components: zero matches.
- **T-22-11 (DoS — Snapshot reload spam):** `accept`. User-driven, single-tab; cache-buster `?t={Date.now()}` triggers a fresh fetch only on click. No auto-poll added.
- **T-22-12 (Tampering — OutputToggle bypassing VAAPI cap):** `mitigate`. Server enforces `VAAPI_HARD_CAP=6` at `outputs/+server.ts:97-107` (verified live). Client-side guard is UX-only. The `OutputToggle.test.ts` regex asserts the client surfaces the 422 `vaapi_hard_cap_exceeded` reason and renders `body.message` from the server.
- **T-22-19 (Tampering — `?onboarding=success` spoofed via direct URL):** `accept`. Worst case: user lands on /kameras and sees a green "Hub aktiv" banner that wasn't earned. Banner is purely cosmetic — no state change, no auth decision driven by the param. The actual `protect_hub_enabled` flag is read from settings server-side; the partition's external section render is gated on `data.hubEnabled` (server-side), not on the query param.

**No new threat surface introduced.** No `{@html}` usage. No third-party data ingestion. Toast logic strips the URL param before rendering subsequent state — no persistent param leakage.

## Known Stubs

- **ExternalCamCard hidden copy-cam-name affordance:** ~10 LOC of `let copiedName = $state(false)` + `copyCamName()` + button rendered inside `class="hidden"`. Intentional placeholder for P23 cam-rename / Protect deep-link affordances. The hidden-but-functional pattern keeps the standard `copyToClipboard` idiom + state declaration in source so P23 doesn't need to re-import. Documented inline in the component (HTML comment block).
- **ExternalCamCard "Aus Hub entfernen" button is `disabled`:** Per UI-SPEC line 236, P22 ships no destructive flow. Tooltip "Verfügbar in Phase 23" sets the user expectation. P23 will wire the active path. The disabled state is intentional (tested by `ExternalCamCard.test.ts` regex `/disabled[\s>]/`).

No other stubs. The components consume Plan 02's catalog/outputs arrays directly without conditional extension.

## TDD Gate Compliance

All 4 tasks declared `tdd="true"`. Execution honored RED→GREEN sequencing within each task: tests written first, run to verify RED, then components written to GREEN. Commits use `feat()` (not `test()`+`feat()` pairs) because each task ships both source and test in one logical change — this matches the precedent established by Plan 22-02 (which the verifier accepted).

Per-task gate evidence (verified in commit history):
- **Task 3 (e4e4f66):** ProtectHubGuide.test.ts authored first (RED — file-not-found), then ProtectHubGuide.svelte (GREEN — 7/7 pass).
- **Task 2 (2a3573c):** ExternalCamCard.test.ts + OutputToggle.test.ts authored first (RED — 0/13 pass, file-not-found errors), then components (GREEN — 13/13 pass).
- **Task 1 (185a15f):** page.test.ts authored first (RED — 1/5 pass; only the pre-existing `text-2xl font-bold` assertion passed), then partition + loader + gate (GREEN — 5/5 pass).
- **Task 4 (e20fcae):** Plan defines verify cmd as `grep -c "onboarding=success\|consumeOnboardingToast\|showToast"` — verified post-edit (returns 9, > 0). Existing page.test.ts continues to pass (5/5) — toast wiring is additive.

## Issues Encountered

- **`cam.mac` missing from response shape** — resolved per Deviation 1.
- **OutputToggle TS errors from rune shadowing + body redeclaration** — resolved per Deviation 2 (in same commit as Task 2).
- **Initial test regex too aggressive on LXC chrome** — resolved per Deviation 3 (in same commit as Task 2).
- **Pre-existing baseline test failures in unrelated files** — out of scope; existing entry in `deferred-items.md` covers them.

## User Setup Required

None. All component changes are pure UI; the `cam.mac` API extension is non-breaking. The live VM at `192.168.3.178:3000` will pick up changes automatically on the next git-push deploy.

Manual verification (deferred to Plan 06 UAT):
- `/kameras` shows two sections; "LXC 0 + red dot" bug GONE for the 22 external rows.
- External cards show Protect-Hub badge + qualifier (UniFi for first-party / Drittanbieter · Mobotix etc. for third-party).
- Toggle output ON → URL appears with copy button → click copies to clipboard.
- ProtectHubGuide tabs switch correctly; Loxone + Frigate snippets are pre-filled with bridge IP + mac slug.
- `/kameras?onboarding=success` shows the green toast banner; refresh removes it.

## Next Phase Readiness

- **Plan 06 UAT:** all visual/functional checks for HUB-UI-01..06 are now testable against the live VM. The "LXC 0" bug elimination is the verification anchor — if it appears on any external row, Plan 03's gate or page-level partition has regressed.
- **Plan 04 wizard Step 6 redirect:** the existing "Zur Kameraliste" button drives `/kameras?onboarding=success`. Plan 03 Task 4's toast wiring closes the loop end-to-end — the user sees the banner immediately, the param is stripped on the same render, and the banner auto-dismisses after 5s.
- **Plan 05 ProtectHubTab integration:** uses the same `OutputToggle` pattern from this plan — the state machine, AbortController, and 422 rollback are now established conventions Plan 05's HubStatusPanel toggle can mirror.
- **Phase 23 offboarding:** owns the active path for "Aus Hub entfernen". The disabled button + tooltip are already in place; P23 only needs to wire the destructive flow + remove the disabled attribute.

All 25 plan-specific tests pass. 135/135 protect-hub-related tests pass. Type-check 0 errors. Live VM is ready for Plan 06 UAT once Wave 3 plans 04 + 05 also commit.

## Self-Check: PASSED

**Files claimed (all verified present):**
- ✅ FOUND: `src/lib/components/cameras/ExternalCamCard.svelte`
- ✅ FOUND: `src/lib/components/cameras/ExternalCamCard.test.ts`
- ✅ FOUND: `src/lib/components/cameras/OutputToggle.svelte`
- ✅ FOUND: `src/lib/components/cameras/OutputToggle.test.ts`
- ✅ FOUND: `src/lib/components/cameras/OutputsSubsection.svelte`
- ✅ FOUND: `src/lib/components/protect-hub/ProtectHubGuide.svelte`
- ✅ FOUND: `src/lib/components/protect-hub/ProtectHubGuide.test.ts`
- ✅ FOUND: `src/routes/kameras/page.test.ts`
- ✅ FOUND: `src/routes/kameras/+page.svelte` (modified — partition + toast)
- ✅ FOUND: `src/routes/kameras/+page.server.ts` (modified — hubEnabled + bridgeIp)
- ✅ FOUND: `src/lib/components/cameras/CameraDetailCard.svelte` (modified — defensive source gate at line 386)
- ✅ FOUND: `src/lib/types.ts` (modified — `mac: string | null` field on CameraCardData)
- ✅ FOUND: `src/routes/api/cameras/status/+server.ts` (modified — `mac: cam.mac ?? null` in response)

**Commits claimed (all verified in git log):**
- ✅ FOUND: `e4e4f66` (Task 3 — ProtectHubGuide)
- ✅ FOUND: `2a3573c` (Task 2 — ExternalCamCard + OutputToggle + OutputsSubsection)
- ✅ FOUND: `185a15f` (Task 1 — partition + loader + LXC gate)
- ✅ FOUND: `e20fcae` (Task 4 — onboarding=success toast)

**Test counts:**
- ✅ Plan-specific: 25/25 pass (5 page + 8 ExternalCamCard + 5 OutputToggle + 7 ProtectHubGuide)
- ✅ Protect-hub regression suite: 135/135 pass
- ✅ Type-check: 0 errors, 33 pre-existing warnings (none in plan files)

---
*Phase: 22-onboarding-wizard-cameras-integration*
*Completed: 2026-05-07*
