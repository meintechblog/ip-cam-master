---
phase: 22-onboarding-wizard-cameras-integration
reviewed: 2026-05-07T00:00:00Z
depth: standard
files_reviewed: 48
files_reviewed_list:
  - src/lib/server/db/schema.ts
  - src/lib/server/db/client.ts
  - src/lib/server/orchestration/protect-hub/wizard-state.ts
  - src/lib/server/orchestration/protect-hub/hub-state.ts
  - src/lib/server/orchestration/protect-hub/yaml-builder.ts
  - src/lib/server/services/events.ts
  - src/routes/api/cameras/status/+server.ts
  - src/routes/api/protect-hub/health/+server.ts
  - src/routes/api/protect-hub/events/+server.ts
  - src/routes/api/protect-hub/drift/+server.ts
  - src/routes/api/protect-hub/wizard/state/+server.ts
  - src/routes/api/protect-hub/wizard/[step]/+server.ts
  - src/routes/api/protect-hub/wizard/reset/+server.ts
  - src/routes/api/protect-hub/wizard/complete/+server.ts
  - src/lib/protect-hub/slug.ts
  - src/lib/types.ts
  - src/lib/components/cameras/CameraDetailCard.svelte
  - src/lib/components/cameras/ExternalCamCard.svelte
  - src/lib/components/cameras/OutputsSubsection.svelte
  - src/lib/components/cameras/OutputToggle.svelte
  - src/lib/components/protect-hub/ProtectHubGuide.svelte
  - src/lib/components/protect-hub/WizardResumeBanner.svelte
  - src/lib/components/protect-hub/WizardStepIndicator.svelte
  - src/lib/components/protect-hub/HubStatusPanel.svelte
  - src/lib/components/protect-hub/HubEventLog.svelte
  - src/lib/components/settings/ProtectHubTab.svelte
  - src/routes/kameras/+page.svelte
  - src/routes/kameras/+page.server.ts
  - src/routes/settings/+page.server.ts
  - src/routes/settings/+page.svelte
  - src/routes/settings/protect-hub/all-urls/+page.svelte
  - src/routes/settings/protect-hub/all-urls/+page.server.ts
  - src/routes/settings/protect-hub/onboarding/+page.svelte
  - src/routes/settings/protect-hub/onboarding/+page.server.ts
  - src/routes/settings/protect-hub/onboarding/_components/Step3.svelte
  - src/routes/settings/protect-hub/onboarding/_components/Step4.svelte
  - src/routes/settings/protect-hub/onboarding/_components/Step5.svelte
  - src/routes/settings/protect-hub/onboarding/_components/Step6.svelte
  - svelte.config.js
  - src/hooks.server.ts
findings:
  critical: 5
  warning: 8
  info: 2
  total: 15
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-05-07
**Depth:** standard
**Files Reviewed:** 48 (39 P22 files + 9 cross-referenced)
**Status:** issues_found

## Summary

The Phase 22 implementation covers a large surface area (wizard Steps 3-6, `/kameras` partition, OutputToggle state machine, HubStatusPanel, HubEventLog, all-urls page, slug parity). The architectural decisions are sound — the `deriveCurrentStep(pointer.step + 1)` offset is intentional and correct, the AbortController wiring is reasonable, and the `wizard/complete` atomicity ordering (saveSetting → completePointer) is correct.

Five blockers require fixing before deployment: a credential leak (decrypted camera passwords sent to the browser for ALL cameras including external Protect cams), a CSRF wildcard bypass, a non-atomic read-then-write race in the wizard state service (multi-tab / rapid-click path), a slug mismatch in ProtectHubGuide (hardcoded `${mac}-low/high` instead of calling `deriveSlug()`), and an `external_archived` source enum member that lands in the "managed" section instead of being excluded.

Eight warnings cover a polling loop that holds `syncInFlight=true` without a timeout-guard inside the inner while loop, a missing AbortController cleanup on OutputToggle unmount, an empty managed-cameras section header when only external cams exist, a `no_op` reconcile not showing Stage 3 as done, an off-by-one in the Step 5 stage-completion visual, a missing timestamp in the external-section empty-state copy, a `cameraWebUrl` sent but unused for external cams (partial mitigation of the CR-01 data exposure), and the `syncNow()` busy-wait that can accumulate stale health reads.

---

## Critical Issues

### CR-01: Decrypted camera password sent to browser for every camera including external Protect cams

**File:** `src/routes/api/cameras/status/+server.ts:173-178`

**Issue:** The `cameraWebUrl` field is built with a decrypted plaintext password and embedded username for **every** camera row in the `/api/cameras/status` response, regardless of `cam.source`. External Protect cameras (`source='external'`) do not have valid credentials in the `cameras` table (the catalog upsert stores whatever Protect provides, which may be empty strings or the UDM admin password). The `try/catch` around `decrypt(cam.password)` silently falls back to `http://${cam.ip}` on failure rather than `null`, but when the password field is non-empty and decryptable, the full `http://user:plaintext-password@ip` URL is returned in the JSON response visible to any logged-in browser tab. `ExternalCamCard.svelte` does not render `cameraWebUrl`, but the data still travels over the wire in every `/api/cameras/status` poll (every 10 s), is stored in the Svelte `$state` object in the browser, and can be inspected via DevTools or intercepted.

**Fix:**

```typescript
// In the cam.map() loop, gate credential decryption on source='managed'
let cameraWebUrl: string | null = null;
if (cam.source !== 'external' && cam.source !== 'external_archived') {
    try {
        const decryptedPass = decrypt(cam.password);
        cameraWebUrl = `http://${cam.username}:${encodeURIComponent(decryptedPass)}@${cam.ip}`;
    } catch {
        cameraWebUrl = `http://${cam.ip}`;
    }
}
```

---

### CR-02: CSRF protection disabled globally (`trustedOrigins: ['*']`)

**File:** `svelte.config.js:7-9`

**Issue:** `csrf: { trustedOrigins: ['*'] }` disables SvelteKit's built-in CSRF origin-check for every POST endpoint. This affects all mutating wizard endpoints (`/api/protect-hub/wizard/[step]`, `/api/protect-hub/wizard/complete`, `/api/protect-hub/wizard/reset`) and the output toggle (`/api/cameras/[id]/outputs`). A cross-origin page can POST to these endpoints from any domain the user is logged in to. The wizard/complete endpoint in particular flips `protect_hub_enabled='true'` and is idempotent, so a CSRF attack that triggers it is exploitable. This appears to be a blanket workaround for a pre-existing issue (likely the Proxmox API callbacks or the installer flow) but the fix should be narrowed.

**Fix:**

```js
// svelte.config.js — remove the wildcard; add only the specific origins that need
// cross-origin posting (e.g., Proxmox callback URLs). For a self-hosted LAN tool
// with no known cross-origin senders, remove the block entirely:
kit: {
    adapter: adapter()
    // No csrf override — let SvelteKit enforce origin checks by default
}
```

If some endpoints legitimately require cross-origin POST (e.g., the Proxmox webhook), scope them via a custom `handle` hook that checks the `Origin` header only on those routes.

---

### CR-03: Wizard pointer service has a read-then-write race (multi-tab / concurrent requests)

**File:** `src/lib/server/orchestration/protect-hub/wizard-state.ts:27-39` and `46-58`

**Issue:** Both `setPointer()` and `completePointer()` do a synchronous read (`getPointer()`) followed by a separate INSERT or UPDATE depending on whether a row exists. SQLite with WAL allows concurrent readers, so two simultaneous POST requests to `/api/protect-hub/wizard/[step]` (e.g., fast double-click in the browser, or two browser tabs) can both see `existing=null` and both attempt `INSERT`, causing a PRIMARY KEY constraint error on the second insert (`id=1` default). Drizzle does not wrap this in a transaction by default; the thrown error propagates as an unhandled 500.

The schema comment says "id=1 always upserted" but the implementation does not use `INSERT OR REPLACE` or `ON CONFLICT DO UPDATE`. With SQLite's synchronous default for Drizzle (`better-sqlite3` executes synchronously), within a single Node.js process concurrent requests cannot truly interleave at the JS level, but the comment model implies transactions should guard this. The deeper issue is that the P22 route does not enforce any locking.

**Fix:** Replace the read-then-insert/update pattern with a true SQLite upsert:

```typescript
import { sql } from 'drizzle-orm';

export function setPointer(step: number, error: string | null = null): void {
    const now = new Date().toISOString();
    db.run(
        sql`INSERT INTO hub_onboarding_state (id, step, status, last_activity_at, error)
            VALUES (1, ${step}, 'in_progress', ${now}, ${error})
            ON CONFLICT(id) DO UPDATE SET
                step = excluded.step,
                status = 'in_progress',
                last_activity_at = excluded.last_activity_at,
                error = excluded.error`
    );
}
```

Apply the same pattern to `completePointer()`.

---

### CR-04: ProtectHubGuide hardcodes slug suffix instead of calling `deriveSlug()` — breaks slug parity guarantee

**File:** `src/lib/components/protect-hub/ProtectHubGuide.svelte:40,46`

**Issue:** The Loxone snippet template directly interpolates `${mac}-low` and the Frigate snippet directly interpolates `${mac}-high` and `${mac}-high` again, bypassing the `deriveSlug()` function from `$lib/protect-hub/slug.ts`. The component comment claims it uses the shared slug util (line 7: "derived via the shared $lib/protect-hub/slug util"), but the import is absent and the slugs are hardcoded. If D-PIPE-06 ever changes the suffix mapping (e.g., `low`→`mjpeg`, `high`→`rtsp`), the go2rtc YAML and the guide snippets will silently diverge — precisely the parity failure Pitfall #9 was designed to prevent.

**Fix:**

```svelte
<script lang="ts">
import { deriveSlug } from '$lib/protect-hub/slug';
// ...
const loxoneSnippet = $derived(
    bridgeIp && mac
        ? `# Adresse: MJPEG-Stream über Hub-Bridge\nURL: http://${bridgeIp}:1984/api/stream.mjpeg?src=${deriveSlug(mac, 'loxone-mjpeg')}\n# Hinweis: User-Agent darf leer bleiben. Auth nicht aktiv (LAN-Trust).`
        : ''
);

const frigateSnippet = $derived(
    bridgeIp && mac
        ? `cameras:\n  ${deriveSlug(mac, 'frigate-rtsp')}:\n    ffmpeg:\n      inputs:\n        - path: rtsp://${bridgeIp}:8554/${deriveSlug(mac, 'frigate-rtsp')}\n...`
        : ''
);
</script>
```

---

### CR-05: `external_archived` source falls into the managed cameras section

**File:** `src/routes/kameras/+page.svelte:19`

**Issue:** The managed partition filter is `cameras.filter((c) => c.source !== 'external')`. The `CameraSource` type has three values: `'managed' | 'external' | 'external_archived'`. Soft-deleted external cameras (`source='external_archived'`, introduced in P21) will match `!== 'external'` and appear in the "Eigene Kameras" section, rendering as a managed camera with a `CameraDetailCard` that shows LXC infrastructure panels, RTSP URLs, and pipeline arrows — none of which are meaningful for an archived Protect cam.

**Fix:**

```svelte
let managedCams = $derived(cameras.filter((c) => c.source === 'managed'));
let externalCams = $derived(cameras.filter((c) => c.source === 'external'));
// external_archived is intentionally excluded from both sections (P23 will surface them in an archive view)
```

---

## Warnings

### WR-01: `syncNow()` busy-wait in HubStatusPanel has no inner-loop timeout guard — `syncInFlight` can be stuck `true` indefinitely

**File:** `src/lib/components/protect-hub/HubStatusPanel.svelte:47-65`

**Issue:** The `syncNow()` function holds `syncInFlight = true` for up to 120 s while polling `reconcilerBusy`. If `refresh()` throws inside the loop (e.g., transient network error) the `catch` block is missing — the outer `try` catches the POST failure but the inner `while` loop has no `try/catch`. A `refresh()` failure will propagate out of the `while` body and exit the `try` via the `finally`, setting `syncInFlight = false` correctly. However, if `health` is never updated after a network blip, `health?.reconcilerBusy` remains `true` from the last good poll and the loop runs for the full 120 s with every `await refresh()` silently swallowing the error. The user sees the button disabled for up to 2 minutes with no error feedback.

Additionally, the inner `while` loop does `await refresh()` which updates the shared `health` reactive state — this triggers a re-render every 1 s _in addition to_ the outer `pollTimer` every 10 s during an active sync. This is acceptable but should be documented.

**Fix:**

```typescript
async function syncNow() {
    syncInFlight = true;
    let syncError: string | null = null;
    try {
        const res = await fetch('/api/protect-hub/reconcile', { method: 'POST' });
        if (!res.ok) {
            syncError = 'Synchronisation konnte nicht gestartet werden.';
            return;
        }
        const start = Date.now();
        while (Date.now() - start < 120_000) {
            await new Promise((r) => setTimeout(r, 1000));
            try { await refresh(); } catch { /* keep waiting */ }
            if (!health?.reconcilerBusy) break;
        }
    } catch (err) {
        syncError = err instanceof Error ? err.message : 'Netzwerkfehler';
    } finally {
        syncInFlight = false;
        await invalidateAll();
    }
    // surface syncError to user if needed
}
```

---

### WR-02: `OutputToggle` does not cancel the in-flight `AbortController` on component unmount — network request outlives the component

**File:** `src/lib/components/cameras/OutputToggle.svelte:49,66-67`

**Issue:** `abortController` is a module-level `let` (not reactive state). When the `OutputToggle` component is destroyed (e.g., the user navigates away from `/kameras`, or the external cam card is re-rendered due to a poll refresh), any in-flight `fetch()` continues to run against its (now-detached) `AbortController.signal`. The server will process the PUT, toggle the output in the DB, but the component state machine (`toggleState`) can never receive the response — leaving the DB enabled/disabled inconsistently with what the new component instance reads on its next render.

**Fix:** Add a `$effect` cleanup:

```svelte
$effect(() => {
    return () => {
        // Abort any in-flight request when the component is destroyed.
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    };
});
```

---

### WR-03: Managed cameras section header renders "Eigene Kameras (0)" when hub is enabled and all cameras are external

**File:** `src/routes/kameras/+page.svelte:134-145`

**Issue:** The `cameras.length === 0` guard renders a full-page empty state, but it fires only when the API returns zero cameras total. If the user has zero managed cameras but multiple external cameras (hub enabled), the page enters the `{:else}` branch and renders `<h2>Eigene Kameras (0)</h2>` with an empty `<div class="space-y-4">` — no cards, no empty-state copy. The spec (`CONTEXT.md §kameras-partition`) specifies the managed section header with count but does not define an inner-section empty state. This is a confusing UX: "Eigene Kameras (0)" implies there should be something there.

**Fix:** Add a per-section empty state fallback:

```svelte
{#each managedCams as camera (camera.id)}
    <CameraDetailCard {camera} />
{:else}
    <p class="text-sm text-text-secondary">Keine Kameras eingerichtet.</p>
{/each}
```

---

### WR-04: Step 5 Stage 3 does not show "done" on `no_op` reconcile — visual glitch before auto-advance

**File:** `src/routes/settings/protect-hub/onboarding/_components/Step5.svelte:147-149`

**Issue:** `updateStages()` at line 149 sets Stage 3 to `done` only when `run?.status === 'success'`. A `no_op` reconcile (bridge YAML unchanged, no SSH deploy needed) also terminates with `pollOnce()` calling `advance()` at line 121, but `updateStages()` runs _before_ the terminal check and marks Stage 3 `in-progress` (since `run.status === 'no_op'` fails the `=== 'success'` check). The user sees Stage 3 as `Streams werden geprüft…` for one render frame before the component advances to Step 6. The effect is a visual flash, not a functional regression, but it is inconsistent with the "Streams laufen" success label.

**Fix:**

```typescript
next[2].status =
    (health.streamCount ?? 0) > 0 && (run?.status === 'success' || run?.status === 'no_op')
        ? 'done'
        : 'in-progress';
```

---

### WR-05: External section empty state missing "Letzte Synchronisation" timestamp per UI-SPEC

**File:** `src/routes/kameras/+page.svelte:156`

**Issue:** UI-SPEC line 219 specifies: `Noch keine Protect-Kameras erkannt. Letzte Synchronisation: {ts}.` The implementation renders only `Noch keine Protect-Kameras erkannt.` — the last sync timestamp is omitted. The loader for `/kameras/+page.server.ts` does not expose a `lastDiscoveredAt` field, so the timestamp is not available to the client. This is a spec deviation, not just a minor copy difference — the missing timestamp leaves the user with no way to know if the sync has ever run.

**Fix:** Expose `lastDiscoveredAt` from the loader:

```typescript
// kameras/+page.server.ts
const catalogState = await loadCatalog().catch(() => null);
return { ..., lastDiscoveredAt: catalogState?.lastDiscoveredAt ?? null };
```

And in the template:

```svelte
<p class="text-sm text-text-secondary">
    Noch keine Protect-Kameras erkannt.
    {#if data.lastDiscoveredAt}
        Letzte Synchronisation: {new Date(data.lastDiscoveredAt).toLocaleString('de-DE')}.
    {/if}
</p>
```

---

### WR-06: `wizard-state.ts` `setPointer` and `completePointer` use a non-atomic read-then-write pattern without a WAL-aware transaction

**File:** `src/lib/server/orchestration/protect-hub/wizard-state.ts:27-58`

**Issue:** Even if CR-03's concurrent-request scenario is deemed low-probability (because Node.js is single-threaded and `better-sqlite3` is synchronous), the current pattern has a structural correctness issue: if `getPointer()` returns `null` but a concurrent database writer (e.g., a future async migration path) inserts the row between `getPointer()` and `db.insert()`, the INSERT will violate the PRIMARY KEY constraint and throw. SQLite's WAL mode does not prevent this — it only allows concurrent readers; a writer still takes an exclusive lock at the file level. The fix from CR-03 (using `ON CONFLICT DO UPDATE`) eliminates the structural race entirely and should be applied regardless of whether multi-tab is a real concern today.

This finding duplicates CR-03's recommended fix but is classified separately as WARNING because the actual runtime exposure is low in a single-Node-process app with synchronous SQLite.

---

### WR-07: `WizardStepIndicator` disc for current step uses `font-bold` — contradicts UI-SPEC weight contract

**File:** `src/lib/components/protect-hub/WizardStepIndicator.svelte:53`

**Issue:** Line 53 applies `font-bold` to every disc button's number label:

```svelte
class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors
```

UI-SPEC §typography explicitly retired `font-bold` for all P22-introduced elements. The only allowable P22 font weights are `font-normal` (400) and `font-semibold` (600). The disc number labels fall under "Label / Meta" at `text-xs` or "Body" at `text-sm`, both `font-normal`. The step indicator is a new P22 component, so this is not an inherited pre-existing `font-bold` — it is a new violation.

**Fix:**

```svelte
class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
```

---

### WR-08: `health/+server.ts` returns `ok: true` even when `go2rtcReady=false` — Step 5 poll treats non-ready go2rtc as success-eligible

**File:** `src/routes/api/protect-hub/health/+server.ts:40-49`

**Issue:** The health endpoint returns `{ ok: true, bridgeStatus, go2rtcReady: false, streamCount: 0, ... }` when the bridge IP exists but go2rtc is not responding. Step 5's `pollOnce()` at line 109 sets `health = await healthRes.json()` and then calls `updateStages(runRow, health)`. The Stage 2 gate `health.go2rtcReady === true` correctly handles this case (Stage 2 stays `in-progress`). However, the `ok: true` field creates an ambiguity: consumers that check `health.ok` (e.g., future callers) will assume the bridge is fully healthy when it is not. The `ok` field semantics differ between "request succeeded" and "bridge is operational". The Stage 5 component correctly reads individual fields, but HubStatusPanel also reads from this endpoint without distinguishing `ok: true + go2rtcReady: false`.

**Fix:** Either rename to `requestOk: true` and add a separate `bridgeHealthy: boolean` field, or change the semantics so `ok` reflects composite bridge health:

```typescript
return json({
    ok: go2rtcReady && bridge.status === 'running',
    requestOk: true,  // request itself succeeded
    bridgeStatus: bridge.status,
    // ... rest unchanged
});
```

---

## Info

### IN-01: `cameraWebUrl` is included in the API response for external cams even though `ExternalCamCard` never uses it

**File:** `src/routes/api/cameras/status/+server.ts:187`

**Issue:** After applying CR-01's fix (gate credential decryption on `source === 'managed'`), `cameraWebUrl` will be `null` for external cams. At that point `cameraWebUrl` remains in the `CameraCardData` interface and in the response payload, but `ExternalCamCard.svelte` does not consume it. This is acceptable — the interface is shared and the field is optional-for-external semantically — but it creates dead wire for every external cam poll response. No action required if CR-01 is fixed; noted for future cleanup.

---

### IN-02: `all-urls/+page.server.ts` exposes `AllUrlsRow` type as a named export — leaks server-side DB query type to shared boundary

**File:** `src/routes/settings/protect-hub/all-urls/+page.server.ts:21-28`

**Issue:** `export type AllUrlsRow` is declared in `+page.server.ts`. SvelteKit's `server-only` boundary means this type is technically not bundled to the client, but it is re-exported from a `+page.server.ts` file rather than from `$lib/types.ts`. The `+page.svelte` imports it via `import type { PageData }` which is fine, but if any other file were to import `AllUrlsRow` directly from the `.server.ts` path it would incorrectly bypass the server-only boundary at the import level. Moving the type to `$lib/types.ts` would follow the established pattern.

---

## Summary Table

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 5 | CR-01, CR-02, CR-03, CR-04, CR-05 |
| WARNING  | 8 | WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, WR-08 |
| INFO     | 2 | IN-01, IN-02 |
| **Total** | **15** | |

**Block on CRITICAL before shipping.** WARNINGs should be fixed in the same pass where feasible (WR-02, WR-03, WR-04, WR-07 are small changes). INFOs are deferred.

---

_Reviewed: 2026-05-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
