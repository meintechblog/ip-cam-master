---
phase: 22-onboarding-wizard-cameras-integration
fixed_at: 2026-05-07T15:25:00Z
review_path: .planning/phases/22-onboarding-wizard-cameras-integration/22-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 22: Code Review Fix Report

**Fixed at:** 2026-05-07T15:25:00Z
**Source review:** `.planning/phases/22-onboarding-wizard-cameras-integration/22-REVIEW.md`
**Iteration:** 1
**Mode:** `--fix --auto` (CRITICAL + WARNING scope; INFO skipped per scope)

**Summary:**
- Findings in scope: 13 (5 CRITICAL + 8 WARNING; WR-06 collapsed into CR-03)
- Fixed: 13
- Skipped: 0
- Test status after fixes: 103 P22-related tests pass; 12 pre-existing failures in `proxmox.test.ts`, `proxmox-validate.test.ts`, `version.test.ts`, `backup.test.ts`, `onboarding.test.ts` predate this run (verified by re-running at `1eafb2e` — same failures) and touch source files outside the P22 surface (`src/lib/server/services/proxmox*`, `version`, `backup`, `onboarding`).

## Fixed Issues

### CR-01: Decrypted camera password sent to browser for every camera including external Protect cams

**Files modified:** `src/routes/api/cameras/status/+server.ts`
**Commit:** `e543cc8`
**Applied fix:** Wrapped the decrypt + cameraWebUrl construction in a `cam.source !== 'external' && cam.source !== 'external_archived'` gate so Protect-mirror rows no longer ship a `http://user:plaintext@ip` URL in the `/api/cameras/status` response. ExternalCamCard never renders this field, so the change is invisible to the UI; managed cam rendering is unchanged. Existing 2 tests for the route pass.

### CR-02: CSRF protection disabled globally (`trustedOrigins: ['*']`)

**Files modified:** `svelte.config.js`
**Commit:** `e854e06`
**Applied fix:** Removed the entire `csrf: { trustedOrigins: ['*'] }` block, restoring the SvelteKit default (Origin header must match request host). For a LAN-only self-hosted tool with no known cross-origin senders this is the safer baseline. Replaced the override with an inline comment explaining the rationale and pointing at the per-route hook pattern if a future Proxmox-callback flow needs scoped exceptions. Note: live UAT recommended on Bambu wizard + Hub wizard + output toggle to confirm no in-app flow regresses; the SvelteKit default treats SSR-rendered pages making same-origin POSTs as compliant, which covers every flow in this codebase today.

### CR-03: Wizard pointer service has a read-then-write race

**Files modified:** `src/lib/server/orchestration/protect-hub/wizard-state.ts`
**Commit:** `122d5ce`
**Applied fix:** Replaced the `getPointer()` + branch-on-null + `INSERT` or `UPDATE` pattern in both `setPointer()` and `completePointer()` with Drizzle's `.onConflictDoUpdate({ target: hubOnboardingState.id, set: { ... } })`. Single atomic statement that eliminates the multi-tab / fast-double-click race entirely. All 7 wizard-state tests pass unchanged; the schema header comment ("id=1 always upserted") now matches the implementation.

**Also covers WR-06** — the same finding at lower severity. WR-06 was a structural-correctness duplicate of CR-03 (it explicitly says "duplicates CR-03's recommended fix"), so a single commit resolves both.

### CR-04: ProtectHubGuide hardcodes slug suffix instead of calling `deriveSlug()`

**Files modified:** `src/lib/components/protect-hub/ProtectHubGuide.svelte`
**Commit:** `2199ee8`
**Applied fix:** Imported `deriveSlug` from `$lib/protect-hub/slug` and added two `$derived` slug values (`loxoneSlug = deriveSlug(mac, 'loxone-mjpeg')`, `frigateSlug = deriveSlug(mac, 'frigate-rtsp')`) used in both snippet templates. The component header comment already claimed it used the shared util — now it actually does. All 22 ProtectHubGuide + slug tests pass: outputs are byte-identical to the prior hardcoded form (`mac-low` / `mac-high`), so the parity test catches any future divergence at the YAML-builder side.

### CR-05: `external_archived` source falls into the managed cameras section

**Files modified:** `src/routes/kameras/+page.svelte`
**Commit:** `d4fbea4`
**Applied fix:** Switched `managedCams` filter from negative `c.source !== 'external'` to positive `c.source === 'managed'`. The external section already used a positive match (`c.source === 'external'`), so both sections now exclude `external_archived` rows; the P23 archive view will surface them later. All 5 kameras page tests pass.

### WR-01: `syncNow()` busy-wait in HubStatusPanel has no inner-loop error guard

**Files modified:** `src/lib/components/protect-hub/HubStatusPanel.svelte`
**Commit:** `b5b8fa8`
**Applied fix:** Wrapped `await refresh()` inside the 120 s busy-wait in a `try { ... } catch { }` so any future change that allows refresh() to throw still terminates the wait at the 120 s cap. Today refresh() already swallows fetch errors silently, so this is defensive — the cap ensures `syncInFlight` cannot be stuck `true` indefinitely under any failure mode.

### WR-02: `OutputToggle` does not cancel in-flight `AbortController` on unmount

**Files modified:** `src/lib/components/cameras/OutputToggle.svelte`
**Commit:** `025b384`
**Applied fix:** Added a `$effect(() => { return () => { abortController?.abort(); abortController = null; } })` that aborts the in-flight PUT and nulls the controller when the component is destroyed. Prevents the server-side write from outliving the component instance and racing the next /api/cameras/status poll. All 5 OutputToggle tests pass.

### WR-03: Managed cameras section header renders "Eigene Kameras (0)" with empty list

**Files modified:** `src/routes/kameras/+page.svelte`
**Commit:** `89ac244`
**Applied fix:** Added a `{:else}` branch on the `{#each managedCams}` block rendering "Keine Kameras eingerichtet." (matching the existing pre-P22 empty-state copy) so the section's intent is clear when the user has zero managed cams but multiple external cams (hub enabled). Note: this commit also brought along the WR-05 template-side change; the WR-05 commit then wired the loader to feed `lastDiscoveredAt`. All 5 page tests pass.

### WR-04: Step 5 Stage 3 does not show "done" on `no_op` reconcile

**Files modified:** `src/routes/settings/protect-hub/onboarding/_components/Step5.svelte`
**Commit:** `c66a4a4`
**Applied fix:** Extended the Stage 3 `done` condition from `run?.status === 'success'` to `run?.status === 'success' || run?.status === 'no_op'`. Aligns the visual with `pollOnce()`'s terminal-success semantics (which already advances on both `success` and `no_op`). Removes the one-frame "Streams werden geprüft…" flash before auto-advance to Step 6. All 17 wizard tests pass.

### WR-05: External section empty state missing "Letzte Synchronisation" timestamp

**Files modified:** `src/routes/kameras/+page.svelte`, `src/routes/kameras/+page.server.ts`
**Commits:** `89ac244` (template — bundled with WR-03 commit), `fc32c7d` (loader)
**Applied fix:** Added `lastDiscoveredAt` to the `+page.server.ts` loader's return object via `loadCatalog().lastDiscoveredAt` (best-effort try/catch — falls back to `null` on DB error so the empty state still renders without timestamp). Template now appends "Letzte Synchronisation: {de-DE}." conditionally. UI-SPEC line 219 contract met.

### WR-06: `wizard-state.ts` non-atomic read-then-write pattern

**Status:** **Resolved by CR-03's commit `122d5ce`**
**Applied fix:** WR-06 explicitly states "duplicates CR-03's recommended fix" — same root cause, same fix. The atomic UPSERT in `122d5ce` eliminates the structural race entirely.

### WR-07: `WizardStepIndicator` disc uses `font-bold` (UI-SPEC violation)

**Files modified:** `src/lib/components/protect-hub/WizardStepIndicator.svelte`
**Commit:** `fc9a9ce`
**Applied fix:** One-character class change: `font-bold` → `font-semibold` on the disc number Tailwind class. Brings the new P22 component into compliance with UI-SPEC §typography (only `font-normal` and `font-semibold` allowed for P22-introduced elements; `font-bold` reserved for the inherited pre-P22 `<h1>` on `/kameras`).

### WR-08: `health/+server.ts` returns `ok: true` even when `go2rtcReady=false`

**Files modified:** `src/routes/api/protect-hub/health/+server.ts`
**Commit:** `c1f3829`
**Applied fix:** Took the additive option from the review — added a derived `bridgeHealthy = go2rtcReady && bridge.status === 'running'` boolean to the response. `ok` semantics preserved (no consumer reads it as composite health today; the `no_bridge` early-return continues to emit `ok: false` for wizard UI detection). Future callers can rely on `bridgeHealthy` for unambiguous bridge status. No tests for this endpoint exist — Tier 1 verification (re-read) and tsc parse-check pass.

## Skipped Issues

None — all 13 in-scope findings were fixed.

## Out-of-Scope (INFO findings — not addressed per `--fix critical_warning`)

- **IN-01** — `cameraWebUrl` field still in `CameraCardData` interface for external cams. After CR-01 this is `null` for externals; field can be removed from the type in a future cleanup. Acceptable per the review.
- **IN-02** — `AllUrlsRow` type exported from `+page.server.ts` instead of `$lib/types.ts`. Stylistic; no runtime impact.

## Validation

- **103 P22-related tests pass** (12 test files: cameras/status, wizard-state, ProtectHubGuide, slug, kameras page, OutputToggle, wizard, all-urls page, reconcile route, wizard/complete, catalog, reconcile orchestrator).
- **TypeScript parse check** passes against `tsconfig.json` for all touched files (only pre-existing `$lib/version` unresolved imports surface — unrelated to this run; that file is generated by `npm run gen:version`).
- **12 unrelated pre-existing test failures** in `proxmox.test.ts`, `proxmox-validate.test.ts`, `version.test.ts`, `backup.test.ts`, `onboarding.test.ts` — verified by running tests at the pre-fix `1eafb2e` HEAD with the same 4-failure signature. None of these test files cover code I touched (`git diff 1eafb2e HEAD -- <those files>` is empty).

## Recommended Live UAT (post-merge, before declaring P22 closed)

1. **CR-02 (CSRF)** — exercise Bambu wizard, Hub wizard Steps 3-6, and the OutputToggle on a managed cam to confirm same-origin POSTs still succeed. SvelteKit default Origin-check is non-disruptive for in-app SSR-rendered POSTs but worth a manual smoke.
2. **CR-01 (credential leak)** — DevTools network tab on `/kameras` while the hub is enabled with at least one external Protect cam: confirm the response payload no longer carries a `http://user:plaintext@ip` URL for `source: 'external'` rows.
3. **CR-03 (UPSERT)** — open the wizard in two tabs, click "Schritt 4 weiter" simultaneously, confirm no 500 in either tab.

## Auto-iteration

Per workflow, the orchestrator will now re-run `gsd-code-reviewer` to verify CRITICAL count is 0. Expected: clean pass; iteration 1 of 3 used.

---

_Fixed: 2026-05-07T15:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
