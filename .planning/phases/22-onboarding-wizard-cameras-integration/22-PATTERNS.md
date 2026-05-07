# Phase 22: Onboarding Wizard + `/cameras` Integration — Pattern Map

**Mapped:** 2026-05-07
**Files analyzed:** 27 (15 new components/routes/migrations + 8 new server endpoints + 4 modified files)
**Analogs found:** 27 / 27 (every new file has a strong existing analog in this codebase)

> Every excerpt below is verified by direct read of the cited file. Line numbers are accurate at HEAD (commit 09872ec). Where the upstream RESEARCH.md table conflicts with the live source, the live source wins (noted inline).

---

## File Classification

### New components

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/components/cameras/ExternalCamCard.svelte` | component (leaf) | request-response (single fetch + manual reload) | `src/lib/components/cameras/CameraDetailCard.svelte` | exact role · same domain (camera card) |
| `src/lib/components/cameras/OutputsSubsection.svelte` | component (leaf) | request-response (toggle PUT) | `src/lib/components/cameras/CameraDetailCard.svelte` lines 794-812 (RTSP+copy row) | role-match (URL row + copy button + container chrome) |
| `src/lib/components/cameras/OutputToggle.svelte` | component (primitive) | request-response (PUT with optimistic UI + AbortController) | `src/lib/components/settings/ProtectHubTab.svelte` lines 67-75 + 268-302 (`bridgeAction`) | role-match (single async action with in-flight + error states) |
| `src/lib/components/protect-hub/ProtectHubGuide.svelte` | component | none (pure render) | `src/lib/components/cameras/AdoptionGuide.svelte` (instruction-list panel) | role-match (instructional snippet panel) |
| `src/lib/components/protect-hub/WizardStepIndicator.svelte` | component | none (pure render) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 95-118 (inline 2-step indicator) **+** `src/lib/components/onboarding/StepIndicator.svelte` (parameterised list version) | exact role · evolves the inline P20 indicator into a reusable component |
| `src/lib/components/protect-hub/WizardResumeBanner.svelte` | component | none (pure render + emit events) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 141-189 (alert/info card style with action buttons) | role-match (banner card with primary + secondary actions) |
| `src/lib/components/protect-hub/HubStatusPanel.svelte` | component | request-response (Sync-now POST) + 10 s polling | `src/lib/components/settings/ProtectHubTab.svelte` lines 224-303 (Bridge-Container card with status badge + action buttons) | exact role (extending the very file it lives in) |
| `src/lib/components/protect-hub/HubEventLog.svelte` | component | polling (10 s) | `src/routes/kameras/+page.svelte` lines 25-31 (poll pattern) **+** `src/lib/components/settings/ProtectHubTab.svelte` lines 364-429 (table render) | role-match (read-only mono table + interval poll) |
| `src/routes/settings/protect-hub/onboarding/_components/Step3.svelte` | wizard step component | request-response (POST discover) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 121-191 (Step 1 card with auto-fetch + states) | exact role · same wizard, same UX vocabulary |
| `src/routes/settings/protect-hub/onboarding/_components/Step4.svelte` | wizard step component | CRUD (per-cam PUT) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 194-267 (Step 2 card layout) **+** `src/routes/api/cameras/[id]/outputs/+server.ts` (the endpoint to call) | exact role + verified endpoint contract |
| `src/routes/settings/protect-hub/onboarding/_components/Step5.svelte` | wizard step component | event-driven (poll loop with named stages) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 233-241 (provisioning spinner UX) **+** `src/lib/components/onboarding/OnboardingWizard.svelte` lines 842-885 (multi-stage step log with check/spinner per row) | role-match — Step 5's "named stages" UX is the OnboardingWizard's stepLog/subLog pattern; Step 5 layout is the P20 Step 2 card |
| `src/routes/settings/protect-hub/onboarding/_components/Step6.svelte` | wizard step component | request-response (complete + redirect) | `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 211-232 (success state + final CTA) **+** `src/lib/components/onboarding/OnboardingWizard.svelte` lines 887-902 (final RTSP card + "Zur Kameraübersicht" goto) | exact role |

### New routes (pages)

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/routes/settings/protect-hub/all-urls/+page.svelte` | route page | SSR-loaded read-only | `src/routes/settings/protect-hub/onboarding/+page.svelte` (sibling Hub-feature route) | exact route shape (same parent dir, same breadcrumb back-link pattern) |
| `src/routes/settings/protect-hub/all-urls/+page.server.ts` | loader | SSR | `src/routes/settings/protect-hub/onboarding/+page.server.ts` (sibling) | exact role |

### New server endpoints

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/routes/api/protect-hub/wizard/state/+server.ts` (GET) | API route (read) | request-response | `src/routes/api/protect-hub/bridge/status/+server.ts` (GET wrapper around a getter) | exact (one-line wrapper) |
| `src/routes/api/protect-hub/wizard/[step]/+server.ts` (POST) | API route (write) | request-response | `src/routes/api/protect-hub/bridge/start/+server.ts` (POST wrapper, error handling) | role-match |
| `src/routes/api/protect-hub/wizard/reset/+server.ts` (POST) | API route (delete) | request-response | `src/routes/api/protect-hub/bridge/start/+server.ts` | role-match |
| `src/routes/api/protect-hub/wizard/complete/+server.ts` (POST) | API route (atomic write) | request-response | `src/routes/api/cameras/[id]/outputs/+server.ts` (atomic-replace + side-effect) | role-match (atomic state transition) |
| `src/routes/api/protect-hub/health/+server.ts` (GET) | API route (composite read) | request-response | `src/routes/api/cameras/status/+server.ts` lines 45-90 (timeout-fenced fetch to `:1984/api/streams`) **+** `src/routes/api/protect-hub/bridge/status/+server.ts` (thin getter shape) | role-match (composes existing getters with go2rtc probe) |
| `src/routes/api/protect-hub/events/+server.ts` (GET) | API route (filtered read) | request-response | `src/routes/api/protect-hub/reconcile-runs/+server.ts` (param-driven GET) **+** `src/lib/server/services/events.ts` lines 51-104 (`getEvents()`) | role-match |
| `src/routes/api/protect-hub/all-outputs/+server.ts` (GET) | API route (joined read) | request-response | `src/routes/api/protect-hub/reconcile-runs/+server.ts` (drizzle SELECT pattern) | role-match — but **planner should prefer reading directly in `+page.server.ts`** per RESEARCH §Open Question 6 |
| `src/routes/api/protect-hub/drift/+server.ts` (GET) | API route (read cached + on-demand SSH) | request-response | `src/routes/api/protect-hub/bridge/status/+server.ts` | role-match |

### New shared modules

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/server/orchestration/protect-hub/wizard-state.ts` | service | DB CRUD (single-row table) | `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` (single-row getter + state setters) | exact role |
| `src/lib/server/orchestration/protect-hub/hub-state.ts` (derived state) | service | pure read-compose | `src/lib/server/services/auth.ts` (`isYoloMode()` — pure read of settings) | role-match |
| `src/lib/protect-hub/slug.ts` (browser-shareable util) | utility | none | `src/lib/server/orchestration/protect-hub/yaml-builder.ts` lines 108-111 (`deriveSlug` private helper) | exact-source — refactor target |

### New schema + migration

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/server/db/schema.ts` (append `hubOnboardingState`) | schema | DDL | `src/lib/server/db/schema.ts` lines 226-237 (`protectHubReconcileRuns` — most recent additive table from P21) | exact-source — same file, same style |
| `src/lib/server/db/client.ts` (append `CREATE TABLE IF NOT EXISTS`) | DB client | DDL | `src/lib/server/db/client.ts` lines 134-149 (P21 reconcile-runs `CREATE TABLE IF NOT EXISTS`) | exact-source — same file, same style |
| `drizzle/0003_hub_onboarding_state.sql` | migration | DDL | `drizzle/0002_update_runs.sql` (most recent additive migration) | exact role |

### Modified files

| Modified File | Role | Data Flow | Modification Driver |
|---------------|------|-----------|---------------------|
| `src/routes/kameras/+page.svelte` | route page | unchanged (10 s poll preserved) | Partition managed/external sections |
| `src/routes/kameras/+page.server.ts` | loader | unchanged | Add `hubEnabled` flag + `bridgeIp` |
| `src/lib/types.ts` (`CameraCardData`) | type | n/a | Extend with `source/kind/manufacturer/modelName/externalId/hubBridgeId` |
| `src/routes/api/cameras/status/+server.ts` | API route | unchanged | Map new fields into response |
| `src/lib/components/cameras/CameraDetailCard.svelte` | component | unchanged | Branch on `camera.source === 'external'` to delegate to `<ExternalCamCard>` (recommended) OR gate the LXC block at line 386 |
| `src/lib/components/settings/ProtectHubTab.svelte` | component | unchanged | Embed `<HubStatusPanel>` + `<HubEventLog>` |
| `src/routes/settings/protect-hub/onboarding/+page.svelte` | route page | unchanged | Refactor inline Step 1/2 into Step components 3-6, delegate to indicator + resume banner |
| `src/routes/settings/protect-hub/onboarding/+page.server.ts` | loader | unchanged | Load wizard pointer + bridge status |

---

## Pattern Assignments

### `src/lib/server/db/schema.ts` — append `hubOnboardingState` table

**Analog:** `src/lib/server/db/schema.ts` lines 220-237 (P21 `protectHubReconcileRuns` — most recent additive table). Verified live.

**Schema-add pattern** (file lines 220-237):
```ts
// v1.3 Phase 21 — Reconcile run audit log (per D-RCN-04 + L-14).
// One row per reconcile pass. Drives drift indicator + reconcile log UI in P23.
// Mirrors the updateRuns shape from P24 — proven cross-process audit pattern.
// status enum (verbatim per D-RCN-04): running | success | no_op | bridge_unreachable | error
export type ReconcileRunStatus = 'running' | 'success' | 'no_op' | 'bridge_unreachable' | 'error';

export const protectHubReconcileRuns = sqliteTable('protect_hub_reconcile_runs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    reconcileId: text('reconcile_id').notNull(),
    startedAt: text('started_at')
        .notNull()
        .$defaultFn(() => new Date().toISOString()),
    completedAt: text('completed_at'),
    status: text('status').notNull().default('running'),
    hashChanged: integer('hash_changed', { mode: 'boolean' }).notNull().default(false),
    deployedYamlHash: text('deployed_yaml_hash'),
    error: text('error')
});
```

**Pattern to apply (P22):** Append `hubOnboardingState` table at the end of `schema.ts` using identical style — header comment block (`// v1.3 Phase 22 — …`), exported type for the status enum, `sqliteTable('hub_onboarding_state', {...})`, `$defaultFn(() => new Date().toISOString())` for timestamps. Use `id: integer('id').primaryKey().default(1)` (single-row pattern per RESEARCH §Pattern 1 / Open Question 2).

---

### `src/lib/server/db/client.ts` — append `CREATE TABLE IF NOT EXISTS`

**Analog:** `src/lib/server/db/client.ts` lines 134-149 (P21 reconcile-runs `CREATE TABLE IF NOT EXISTS`). Verified live.

**DDL-append pattern** (file lines 134-149):
```ts
// v1.3 Phase 21 — protect_hub_reconcile_runs (per D-RCN-04).
// Audit log for every reconcile pass; mirrors update_runs shape.
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS protect_hub_reconcile_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reconcile_id TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        hash_changed INTEGER NOT NULL DEFAULT 0,
        deployed_yaml_hash TEXT,
        error TEXT
    )
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_hub_reconcile_runs_started_at ON protect_hub_reconcile_runs(started_at DESC)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_protect_hub_reconcile_runs_reconcile_id ON protect_hub_reconcile_runs(reconcile_id)`);
```

**Pattern to apply (P22):** Add equivalent `CREATE TABLE IF NOT EXISTS hub_onboarding_state (...)` block at the end of `client.ts` (no index needed — single-row table). This is the project's chosen "lightweight migration" pattern (header comment at line 18 says "Auto-create tables that don't exist yet").

---

### `drizzle/0003_hub_onboarding_state.sql` — Drizzle migration

**Analog:** `drizzle/0002_update_runs.sql` (most recent migration). Verified live.

**Migration header pattern** (full file):
```sql
-- v1.3 Phase 24 — Auto-Update Parity (UPD-AUTO-10)
-- Dedicated table for update run history. Replaces the JSON blob
-- previously stored in settings.update_run_history.
CREATE TABLE IF NOT EXISTS `update_runs` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    ...
);
--> statement-breakpoint
```

**Pattern to apply (P22):** Same DDL style. Generate via `npm run db:generate` (drizzle-kit) — the file is auto-generated; only the comment header may be hand-edited.

---

### `src/lib/server/orchestration/protect-hub/wizard-state.ts` — pointer service

**Analog:** `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` lines 1-28 (single-row table getter + setter shape). Verified live.

**Single-row service pattern** (file lines 1-28):
```ts
// v1.3 Phase 20 — Bridge LXC lifecycle controls.
//
// start/stop/restart update the protect_hub_bridges row and call the
// corresponding Proxmox container actions. getBridgeStatus returns the
// current bridge row or null.
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { protectHubBridges } from '$lib/server/db/schema';
import { startContainer, stopContainer } from '$lib/server/services/proxmox';

export type BridgeRow = typeof protectHubBridges.$inferSelect;

export function getBridgeStatus(): BridgeRow | null {
    return db.select().from(protectHubBridges).get() ?? null;
}
```

**Pattern to apply (P22):**
- Header comment with phase + purpose
- `export type WizardPointer = typeof hubOnboardingState.$inferSelect | null;`
- Pure synchronous functions: `getPointer()`, `setPointer(step, error?)`, `resetPointer()`, `completePointer()`
- Use `db.select().from(table).where(eq(table.id, 1)).get() ?? null`
- Use `$defaultFn(() => new Date().toISOString())` parity from schema
- Reference RESEARCH §Code Examples (lines 643-685) for the exact body

---

### `src/routes/api/protect-hub/wizard/[step]/+server.ts` — pointer-write endpoint

**Analog:** `src/routes/api/protect-hub/bridge/start/+server.ts` (full file, 17 lines). Verified live.

**Thin POST wrapper pattern** (full file):
```ts
// v1.3 Phase 20 — POST /api/protect-hub/bridge/start.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startBridge } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';

export const POST: RequestHandler = async () => {
    try {
        const result = await startBridge();
        if (!result.ok) {
            return json({ ok: false, error: result.error }, { status: 500 });
        }
        return json({ ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return json({ ok: false, error: message }, { status: 500 });
    }
};
```

**Pattern to apply (P22):** Same shape — phase header, `import { json }`, named `POST` export, top-level try/catch with `err instanceof Error` guard, `{ ok: false, error: ... }` shape. For `[step]/+server.ts` add `params: { step: string }` parsing with `Number.isInteger(step) && step >= 1 && step <= 6` validation returning `400` on bad input (RESEARCH §Code Examples lines 690-703).

---

### `src/routes/api/protect-hub/wizard/state/+server.ts` — pointer-read endpoint

**Analog:** `src/routes/api/protect-hub/bridge/status/+server.ts` (full file, 8 lines). Verified live.

**Thin GET wrapper pattern** (full file):
```ts
// v1.3 Phase 20 — GET /api/protect-hub/bridge/status.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBridgeStatus } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';

export const GET: RequestHandler = async () => {
    const bridge = getBridgeStatus();
    return json({ bridge });
};
```

**Pattern to apply (P22):** Same shape — phase header, named `GET` export, return `json({ pointer })` directly (no try/catch for pure DB read).

---

### `src/routes/api/protect-hub/health/+server.ts` — composite health probe

**Analogs (two combined):**
1. `src/routes/api/protect-hub/bridge/status/+server.ts` — outer shape (thin GET wrapper).
2. `src/routes/api/cameras/status/+server.ts` lines 47-90 — timeout-fenced fetch to `:1984/api/streams`.

**go2rtc reachability probe pattern** (`cameras/status/+server.ts` lines 47-87, verified live):
```ts
if (containerIp && containerStatus === 'running') {
    // Check go2rtc API
    try {
        const res = await fetch(`http://${containerIp}:1984/api/streams`, {
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            go2rtcRunning = true;
            const data = await res.json();
            // ... derive consumer / producer counts ...
        }
    } catch {
        // go2rtc not reachable
    }
}
```

**Reconciler-busy probe pattern** (`reconcile.ts:116`, verified): `import { isReconcilerBusy } from '$lib/server/orchestration/protect-hub/reconcile';` — synchronous boolean.

**Bridge getter pattern** (`bridge-lifecycle.ts:13`, verified): `import { getBridgeStatus } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';`

**Pattern to apply (P22):** Compose all three — see RESEARCH §Code Examples lines 707-743 for the full body. Use `AbortSignal.timeout(2000)` (per RESEARCH; the cameras-status endpoint uses 3000 ms but Step 5 polls at 1500 ms cadence so health probe must be ≤ 2000 ms to avoid request pile-up).

---

### `src/routes/api/protect-hub/events/+server.ts` — event log read

**Analog:**
1. `src/routes/api/protect-hub/reconcile-runs/+server.ts` lines 25-45 — query-param-driven GET shape.
2. `src/lib/server/services/events.ts` lines 51-104 — existing `getEvents({source, ...})` filter helper.

**Query-driven GET pattern** (`reconcile-runs/+server.ts` lines 25-45, verified):
```ts
export const GET: RequestHandler = async ({ url }) => {
    const reconcileId = url.searchParams.get('reconcileId');
    if (!reconcileId) {
        return json(
            { ok: false, error: 'reconcileId query parameter is required' },
            { status: 400 }
        );
    }
    const row = db.select().from(protectHubReconcileRuns)
        .where(eq(protectHubReconcileRuns.reconcileId, reconcileId)).get();
    if (!row) {
        return json({ ok: false, error: 'not found' }, { status: 404 });
    }
    return json({ ok: true, run: row });
};
```

**Events helper signature** (`services/events.ts:51-58`, verified):
```ts
export function getEvents(filters?: {
    cameraId?: number;
    severity?: EventSeverity;
    eventType?: EventType;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
}): { events: CameraEvent[]; total: number }
```

**Caveat (live source):** `getEvents()` does NOT currently accept a `source` filter — it only filters on `cameraId/severity/eventType/since/until`. The reconciler writes events with `source='protect_hub'` (verified in `outputs/+server.ts:135`). Planner has two options:
- **(A)** Extend `getEvents()` filter union to accept `source?: string` (one-line change at `events.ts:60-77`).
- **(B)** Inline the SELECT in the new endpoint, reading `events.source = 'protect_hub'` directly via drizzle `eq(events.source, 'protect_hub')`.

**Recommendation:** Option **A** — minimal change, matches existing pattern. Smoke test extends `events.test.ts` (if it exists) or adds new.

---

### `src/lib/components/cameras/ExternalCamCard.svelte` — external cam card

**Analog:** `src/lib/components/cameras/CameraDetailCard.svelte` (entire file, 972 lines). Verified live.

**Imports pattern** (lines 1-5, verified):
```ts
import type { CameraCardData } from '$lib/types';
import { ExternalLink, Copy, Check, Play, Square, RotateCw, Trash2, Pencil, KeyRound, Loader2, Power, Lock, LockOpen, Eye, EyeOff } from 'lucide-svelte';
import AdoptionGuide from './AdoptionGuide.svelte';
import { copyToClipboard } from '$lib/utils/clipboard';
```

**Props pattern** (line 7, verified):
```ts
let { camera }: { camera: CameraCardData } = $props();
```

**Copy-button pattern** (lines 8 + 64-69 + 805-811, verified):
```ts
let copied = $state(false);

async function copyRtsp() {
    if (!rtspDisplayUrl) return;
    if (await copyToClipboard(rtspDisplayUrl)) {
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
    }
}
```

**Copy-button JSX** (lines 805-811, verified):
```svelte
<button onclick={copyRtsp} class="text-text-secondary hover:text-text-primary shrink-0 cursor-pointer" title={camera.rtspAuthEnabled ? 'Komplette URL mit Creds kopieren' : 'Kopieren'}>
    {#if copied}
        <Check class="w-4 h-4 text-green-400" />
    {:else}
        <Copy class="w-4 h-4" />
    {/if}
</button>
```

**URL-row chrome pattern** (lines 794-799, verified):
```svelte
<div class="flex items-center gap-2 bg-bg-primary rounded-lg px-3 py-2 mt-3">
    <span class="text-xs text-text-secondary shrink-0">RTSP</span>
    <code class="text-xs text-text-primary font-mono flex-1 truncate">
        {rtspDisplayUrl}
    </code>
    <!-- copy button here -->
</div>
```

**LXC block to gate** (line 386, verified): `{#if !isNativeOnvif}` — extend to `{#if !isNativeOnvif && camera.source !== 'external'}` (per CONTEXT.md). Recommended: extract entire external branch into `<ExternalCamCard>` to avoid bloating the 972-line CameraDetailCard further.

**Pattern to apply (P22):**
- Reuse all imports, the `let copied = $state(false)` + `setTimeout(...,2000)` copy idiom, the `bg-bg-primary rounded-lg px-3 py-2` URL-row chrome, the `text-xs font-mono` mono URL display.
- Replace LXC card block with read-only Stream Catalog table (3 cols, see UI-SPEC §badges).
- Add Protect-Hub badge + qualifier per UI-SPEC `bg-accent/15 text-accent border border-accent/30 px-2 py-1 rounded text-xs` (note: P22 has retired `px-1.5 py-0.5` per UI-SPEC revision 2026-05-06).

---

### `src/lib/components/cameras/OutputToggle.svelte` — single output toggle primitive

**Analog (state machine):** `src/lib/components/settings/ProtectHubTab.svelte` lines 65-90 + 268-302 (`bridgeAction` async with disabled-during-flight).

**Async-action pattern with disabled-during-flight** (file lines 65-75, verified):
```ts
let bridgeLoading = $state(false);

async function bridgeAction(action: 'start' | 'stop' | 'restart') {
    bridgeLoading = true;
    try {
        await fetch(`/api/protect-hub/bridge/${action}`, { method: 'POST' });
        await invalidateAll();
    } finally {
        bridgeLoading = false;
    }
}
```

**Disabled state in JSX** (file lines 268-278, verified):
```svelte
<button
    onclick={() => bridgeAction('start')}
    disabled={bridgeLoading}
    class="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded
        hover:bg-green-700 transition-colors text-sm font-medium cursor-pointer disabled:opacity-50"
>
    <Play class="w-3.5 h-3.5" />
    Starten
</button>
{#if bridgeLoading}
    <Loader2 class="w-4 h-4 animate-spin text-text-secondary" />
{/if}
```

**Optimistic UI + AbortController + rollback pattern** is documented in RESEARCH §Pattern 3 (lines 367-397) — body verified against the endpoint contract at `src/routes/api/cameras/[id]/outputs/+server.ts` lines 38-160.

**VAAPI hard-cap rollback excerpt** (`outputs/+server.ts` lines 97-107, verified — Pitfall #5):
```ts
if (projectedTotal > VAAPI_HARD_CAP) {
    return json(
        {
            ok: false,
            reason: 'vaapi_hard_cap_exceeded',
            message: `Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: ${projectedTotal}.`
        },
        { status: 422 }
    );
}
```

**Pattern to apply (P22):** State machine `off → enabling → on` and reverse, with `AbortController` per RESEARCH §Pattern 3. Reuse the disabled+spinner combo from `ProtectHubTab.bridgeAction`. Render German error message from `body.message` directly (server provides it). UI-SPEC §toggle line 350 locks the visual state-by-state spec.

---

### `src/lib/components/protect-hub/WizardStepIndicator.svelte` — 6-disc step indicator

**Analog (primary):** `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 95-118 — the inline 2-step indicator that P22 must evolve into a reusable 6-step component.

**Inline 2-step indicator pattern** (file lines 94-118, verified):
```svelte
<!-- Step indicator -->
<div class="flex items-center gap-3 mb-8">
    {#each [1, 2] as step}
        <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                {currentStep > step
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                    : currentStep === step
                        ? 'bg-accent/20 text-accent border border-accent/40'
                        : 'bg-bg-input text-text-secondary border border-border'}">
                {#if currentStep > step}
                    <CheckCircle2 class="w-4 h-4" />
                {:else}
                    {step}
                {/if}
            </div>
            <span class="text-sm {currentStep >= step ? 'text-text-primary' : 'text-text-secondary'}">
                {step === 1 ? 'Protect-Verbindung' : 'Bridge bereitstellen'}
            </span>
        </div>
        {#if step < 2}
            <div class="flex-1 h-px {currentStep > 1 ? 'bg-green-500/40' : 'bg-border'}"></div>
        {/if}
    {/each}
</div>
```

**Analog (secondary, parameterised):** `src/lib/components/onboarding/StepIndicator.svelte` (full file, verified) — generic step indicator already used by the Mobotix/Loxone wizard. Reuses the same `bg-accent`/`bg-success`/`bg-bg-input` token vocabulary but uses a different (older) variant.

**Pattern to apply (P22):**
- Copy the disc + connector styling **verbatim** from the P20 inline indicator (uses the same tokens UI-SPEC §interaction-contracts §wizard-step-indicator locks).
- Make the disc a `<button>` (not `<div>`) per UI-SPEC §accessibility — keyboard-focusable for backward navigation.
- Forward-disc click is a no-op when locked; emit `stepClicked(n)` only when `n <= currentStep` (already-completed).
- Disc states (per UI-SPEC line 339): incomplete `bg-bg-input text-text-secondary border border-border`; current `bg-accent/20 text-accent border border-accent/40`; complete `bg-green-500/20 text-green-400 border border-green-500/40` + `<CheckCircle2 class="w-4 h-4" />`.

---

### `src/routes/settings/protect-hub/onboarding/_components/Step3.svelte` — Wizard Step 3

**Analog:** `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 121-191 (Step 1 card with auto-fetch + states). Verified live.

**Auto-fetch on mount pattern** (file lines 27-31, verified):
```ts
$effect(() => {
    if (data.credsConfigured && !checkOk && !checking && !checkError) {
        verifyProtect();
    }
});
```

**Async verify with reason classification** (lines 33-58, verified):
```ts
async function verifyProtect() {
    checking = true;
    checkOk = false;
    checkError = null;
    checkReason = null;
    try {
        const res = await fetch('/api/protect-hub/discover', { method: 'POST' });
        const body = await res.json();
        if (res.ok && body.ok) {
            checkOk = true;
        } else {
            checkReason = body.reason ?? null;
            if (body.reason === 'auth_failed') {
                checkError = 'Anmeldung bei UniFi Protect fehlgeschlagen. Bitte Zugangsdaten prüfen.';
            } else if (body.reason === 'controller_unreachable') {
                checkError = 'UniFi Controller nicht erreichbar. Bitte Netzwerkverbindung prüfen.';
            } else {
                checkError = body.error || 'Verbindung fehlgeschlagen';
            }
        }
    } catch (err) {
        checkError = err instanceof Error ? err.message : 'Netzwerkfehler';
    } finally {
        checking = false;
    }
}
```

**Card chrome + state-block patterns** (lines 122-189, verified):
```svelte
<div class="bg-bg-card rounded-lg border border-border p-6 space-y-4">
    <h2 class="text-lg font-semibold text-text-primary">Schritt 1: ...</h2>

    {#if checking}
        <div class="flex items-center gap-3 text-text-secondary py-4">
            <Loader2 class="w-5 h-5 animate-spin text-accent" />
            <span class="text-sm">Verbindung wird geprüft...</span>
        </div>
    {:else if checkOk}
        <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 class="w-5 h-5 text-green-400 shrink-0" />
            <div>
                <span class="text-sm font-medium text-green-400">Protect-Verbindung erfolgreich</span>
            </div>
        </div>
    {:else if checkError}
        <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
            <XCircle class="w-5 h-5 text-red-400 shrink-0" />
            ...
        </div>
    {/if}
</div>
```

**Pattern to apply (P22):**
- Reuse the entire card chrome and the `checking/ok/error` triad verbatim.
- Step 3 calls `POST /api/protect-hub/discover` (same endpoint as Step 1) and on success calls `POST /api/protect-hub/wizard/3` to advance pointer (RESEARCH §Code Examples line 353).
- After success, show a summary of cams grouped by `kind` (data from a follow-up GET to `/api/protect-hub` or directly from the discover response which already includes `insertedCams/updatedCams/insertedChannels`).

---

### `src/routes/settings/protect-hub/onboarding/_components/Step5.svelte` — Wizard Step 5 (named-stages reconcile)

**Analog (primary):** `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 233-241 (P20 Step 2 provisioning spinner).
**Analog (secondary):** `src/lib/components/onboarding/OnboardingWizard.svelte` lines 842-885 (multi-stage step log with check/spinner per row — verified live).

**Multi-stage progress pattern** (`OnboardingWizard.svelte` lines 842-857, verified):
```svelte
<!-- Step log -->
<div class="space-y-3">
    {#each stepLog as log (log.step)}
        <div class="flex items-start gap-3">
            {#if log.status === 'done'}
                <CheckCircle class="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            {:else}
                <Loader2 class="w-5 h-5 text-accent animate-spin shrink-0 mt-0.5" />
            {/if}
            <div class="flex-1 min-w-0">
                <span class="text-sm font-medium text-text-primary">{log.label}</span>
                <p class="text-xs text-text-secondary">{log.detail}</p>
            </div>
        </div>
    {/each}
</div>
```

**Polling cadence pattern** (verified at `kameras/+page.svelte:25-31`):
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

**Reconcile fire-and-poll pattern** (RESEARCH §Pattern 2 lines 339-356, verified against `reconcile/+server.ts:24-51` and `reconcile-runs/+server.ts:25-45`):
```ts
async function startFirstReconcile() {
    const res = await fetch('/api/protect-hub/reconcile', { method: 'POST' });
    const { reconcileId } = await res.json();

    pollHandle = setInterval(async () => {
        const [run, health] = await Promise.all([
            fetch(`/api/protect-hub/reconcile-runs?reconcileId=${reconcileId}`).then(r => r.json()),
            fetch('/api/protect-hub/health').then(r => r.json())
        ]);
        updateStages(run, health);
        if (run.run?.status === 'success' || run.run?.status === 'no_op') {
            clearInterval(pollHandle);
            await fetch('/api/protect-hub/wizard/5', { method: 'POST' });
        }
    }, 1500);
}
```

**Pattern to apply (P22):**
- Cadence **1500 ms** (UI-SPEC §step-5-health-poll line 378) — NOT the 10 s `/kameras` poll.
- Hard timeout **90 s** — render "Hinweis: Das dauert länger als gewöhnlich…" + offer continue link.
- Three named stages (UI-SPEC lines 184-189) render as the per-row check/spinner pattern from `OnboardingWizard.svelte:842-857`.
- 404 on `/reconcile-runs?reconcileId=X` is documented as expected race in `reconcile.ts:138-145` — retry the SAME id, don't abandon.

---

### `src/lib/components/protect-hub/HubStatusPanel.svelte` — settings status panel

**Analog:** `src/lib/components/settings/ProtectHubTab.svelte` lines 224-303 (Bridge-Container card with status badge + action buttons). Verified live.

**Status badge pattern** (file lines 77-90, verified):
```ts
function bridgeStatusBadge(status: string): { color: string; label: string; spinning: boolean } {
    switch (status) {
        case 'running':
            return { color: 'bg-green-500', label: 'Läuft', spinning: false };
        case 'stopped':
            return { color: 'bg-yellow-500', label: 'Gestoppt', spinning: false };
        case 'failed':
            return { color: 'bg-red-500', label: 'Fehlgeschlagen', spinning: false };
        case 'provisioning':
            return { color: 'bg-blue-500', label: 'Wird bereitgestellt...', spinning: true };
        default:
            return { color: 'bg-gray-500', label: 'Ausstehend', spinning: false };
    }
}
```

**Status panel header** (lines 226-240, verified):
```svelte
<div class="bg-bg-card rounded-lg border border-border p-6">
    <div class="flex items-center gap-3 mb-4">
        <Server class="w-5 h-5 text-text-secondary" />
        <h2 class="text-lg font-semibold text-text-primary">Bridge-Container</h2>
        <div class="flex items-center gap-2 ml-auto">
            {#if badge.spinning}
                <Loader2 class="w-3.5 h-3.5 animate-spin text-blue-400" />
            {:else}
                <span class="w-2.5 h-2.5 rounded-full {badge.color}"></span>
            {/if}
            <span class="text-sm font-medium ...">{badge.label}</span>
        </div>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
            <span class="text-text-secondary">Hostname</span>
            <p class="font-mono text-text-primary">{hub.bridge.hostname}</p>
        </div>
        ...
    </div>
</div>
```

**Pattern to apply (P22):**
- Reuse the entire card chrome (`bg-bg-card rounded-lg border border-border p-6`).
- Reuse the dot+label badge pattern (`w-2.5 h-2.5 rounded-full {color}`).
- UI-SPEC line 81 mandates `text-base font-semibold` for the new status panel `<h2>` — note this differs from the existing ProtectHubTab `text-lg font-semibold` (P22 introduces stricter typography ladder).
- Sync-now button: `bg-accent text-white px-4 py-2 rounded-lg` (per UI-SPEC §accent-reserved). In-flight = button label replaced with spinner + "Synchronisation läuft…" (UI-SPEC §sync-now-in-flight).

---

### `src/lib/components/protect-hub/HubEventLog.svelte` — event log table

**Analog (data fetch):** `src/routes/kameras/+page.svelte` lines 25-31 (10 s polling pattern, verified).
**Analog (table render):** `src/lib/components/settings/ProtectHubTab.svelte` lines 364-429 (catalog table). Verified live.

**Polling pattern** (`kameras/+page.svelte:25-31`, full excerpt above).

**Table render pattern** (`ProtectHubTab.svelte:365-429`, verified):
```svelte
<div class="bg-bg-card rounded-lg border border-border overflow-hidden">
    <table class="w-full text-sm">
        <thead class="bg-bg-darker">
            <tr class="text-left text-text-secondary text-xs uppercase">
                <th class="px-4 py-2">Cam</th>
                ...
            </tr>
        </thead>
        <tbody>
            {#each hub.cams as cam (cam.id)}
                <tr class="border-t border-border align-top">
                    <td class="px-4 py-3 font-medium">{cam.name}</td>
                    ...
                </tr>
            {/each}
        </tbody>
    </table>
</div>
```

**Pattern to apply (P22):**
- Reuse polling shape (10 s cadence — UI-SPEC §event-log line 408).
- Use `divide-y divide-border` + 4-column grid layout (per UI-SPEC §event-log line 407: `grid grid-cols-[auto_auto_auto_1fr] gap-3 items-center text-xs font-mono`) — NOT `<table>`.
- Event-type badges: `bg-bg-input text-text-secondary px-2 py-1 rounded text-xs font-mono` (UI-SPEC §event-type-badges line 296).

---

### `src/routes/kameras/+page.svelte` (MODIFIED) — partition into 2 sections

**Analog:** existing file structure at lines 25-69 (verified). Already uses 10 s polling.

**Existing render pattern** (lines 63-69, verified):
```svelte
<div class="space-y-4">
    {#each cameras as camera (camera.id)}
        <CameraDetailCard {camera} />
    {/each}
</div>
```

**Pattern to apply (P22):**
- Replace the single `<div class="space-y-4">` block with a `<div class="space-y-12">` containing two `<section>` blocks (UI-SPEC §kameras-partition line 391).
- First section: `cameras.filter(c => c.source !== 'external')` with `<CameraDetailCard>`.
- Second section (rendered ONLY when `data.hubEnabled === true` per CONTEXT decision): `cameras.filter(c => c.source === 'external')` with `<ExternalCamCard>`.
- Section headers: `<h2 class="text-base font-semibold text-text-primary mb-4">` (UI-SPEC line 392). NOTE: differs from existing `<h1 class="text-2xl font-bold">` at line 35 — that h1 is preserved verbatim per UI-SPEC line 90 (only NEW h1s use `font-semibold`).

---

### `src/routes/api/cameras/status/+server.ts` (MODIFIED) — extend response

**Analog:** the file itself (entire current implementation, verified).

**Existing return shape** (file lines 114-158, verified):
```ts
return {
    id: cam.id,
    vmid: cam.vmid,
    name: cam.name,
    cameraIp: cam.ip,
    cameraType: cam.cameraType || 'mobotix',
    cameraWebUrl,
    containerIp,
    streamName: cam.streamName,
    rtspUrl: containerIp ? `rtsp://${containerIp}:8554/${cam.streamName}` : null,
    status: cam.status,
    rtspAuthEnabled: Boolean(cam.rtspAuthEnabled),
    width: cam.width,
    ...
} satisfies CameraCardData;
```

**Pitfall #1 (RESEARCH lines 511-522):** The existing return object hand-picks fields and **does not include** `source`, `kind`, `manufacturer`, `modelName`, `externalId`, `hubBridgeId`. The DB columns exist (P19 — verified at `client.ts:60-65`). P22 must add them to the response object AND to `CameraCardData` type.

**Pattern to apply (P22):**
- Extend `CameraCardData` in `src/lib/types.ts:129-173` with the 6 missing fields (use existing types `CameraSource` and `CameraKind` already at lines 181, 188).
- Add the 6 fields to the return object in `cameras/status/+server.ts:114-158`. Map directly from `cam` row (no logic).
- Add a smoke test asserting the response shape includes the new fields (matches RESEARCH §Validation Architecture line 917).

---

### `src/lib/components/protect-hub/ProtectHubGuide.svelte` — Loxone + Frigate snippet display

**Analog:** `src/lib/components/cameras/AdoptionGuide.svelte` (full file, verified). Same domain (instructional UI), same vocabulary (`bg-bg-card border border-border rounded`, `text-success`, ordered-step rendering).

**Step instruction pattern** (`AdoptionGuide.svelte:87-99`, verified):
```svelte
{#if result.instructions.length > 0}
    <div class="space-y-2">
        <p class="text-xs text-text-secondary font-medium uppercase tracking-wider">Schritte zur Adoption</p>
        {#each result.instructions as instruction, i}
            <div class="flex gap-3 bg-bg-primary/50 rounded-lg px-4 py-3">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold shrink-0">
                    {i + 1}
                </span>
                <span class="text-sm text-text-primary">{instruction}</span>
            </div>
        {/each}
    </div>
{/if}
```

**Slug derivation** (browser-safe util — RESEARCH §Pattern 4):
```ts
// src/lib/protect-hub/slug.ts (NEW shared util)
// Mirrors src/lib/server/orchestration/protect-hub/yaml-builder.ts:108-111
export type OutputType = 'loxone-mjpeg' | 'frigate-rtsp';
export function deriveSlug(mac: string, outputType: OutputType): string {
    if (!mac) throw new Error('deriveSlug: mac is required');
    const suffix = outputType === 'loxone-mjpeg' ? 'low' : 'high';
    return `${mac}-${suffix}`;
}
```

**Server-side counterpart to mirror EXACTLY** (`yaml-builder.ts:108-111`, verified):
```ts
function deriveSlug(row: OutputRow): string {
    const suffix = row.outputType === 'loxone-mjpeg' ? 'low' : 'high';
    return `${row.mac}-${suffix}`;
}
```

**Pattern to apply (P22):**
- Build a tabbed container (UI-SPEC §protect-hub-guide table). Tabs = "Loxone (Intercom)" and "Frigate (NVR)".
- Snippet code blocks: `text-xs font-mono leading-relaxed` inside `bg-bg-input` rounded surface (UI-SPEC line 94).
- Snippet content: pre-filled templates substituting `bridgeIp` + `slug` (use the new shared `deriveSlug()` util).
- Per-snippet copy button uses the same `let copied = $state(false) + setTimeout(2000)` idiom as `CameraDetailCard.svelte:64-69`.

---

### `src/routes/settings/protect-hub/all-urls/+page.server.ts` — All-URLs loader

**Analog:** `src/routes/settings/protect-hub/onboarding/+page.server.ts` (full file, 22 lines, verified).

**SSR loader pattern** (full file, verified):
```ts
// v1.3 Phase 20 — Wizard data loader for bridge onboarding (Steps 1-2).
// Redirects to /settings if bridge is already running (wizard complete for P20).
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSettings } from '$lib/server/services/settings';
import { getBridgeStatus } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';

export const load: PageServerLoad = async () => {
    const bridge = getBridgeStatus();
    // If bridge is running, wizard is done — go back to settings
    if (bridge?.status === 'running') {
        redirect(303, '/settings');
    }

    const unifi = await getSettings('unifi_');
    const credsConfigured = !!(unifi.unifi_host && unifi.unifi_username && unifi.unifi_password);

    return {
        credsConfigured,
        bridge
    };
};
```

**Pattern to apply (P22):**
- Same imports + `PageServerLoad` typed export.
- Redirect to `/settings` if `protect_hub_enabled !== 'true'` (mirror the gate logic).
- Read all enabled `cameraOutputs` rows joined to `cameras` directly via drizzle (`db.select().from(cameraOutputs).innerJoin(cameras, eq(cameraOutputs.cameraId, cameras.id)).where(eq(cameraOutputs.enabled, true))`).
- Read bridge IP from `getBridgeStatus()`.
- Return `{ outputs: [...], bridgeIp, hubEnabled }`.
- Per RESEARCH §Open Question 6 — read directly here, do NOT add an `/api/protect-hub/all-outputs` endpoint.

---

### `src/routes/settings/protect-hub/all-urls/+page.svelte` — All-URLs page

**Analog:** `src/routes/settings/protect-hub/onboarding/+page.svelte` lines 82-93 (page-level breadcrumb + h1 + subtitle pattern). Verified live.

**Page header pattern** (file lines 82-92, verified):
```svelte
<div class="max-w-2xl">
    <!-- Breadcrumb -->
    <a href="/settings" class="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 mb-6">
        <ArrowLeft class="w-4 h-4" />
        Zurück zu Einstellungen
    </a>

    <h1 class="text-2xl font-bold text-text-primary mb-2">Protect Hub — Bridge einrichten</h1>
    <p class="text-sm text-text-secondary mb-8">
        Der Bridge-Container stellt go2rtc für alle Hub-Streams bereit.
    </p>
```

**Pattern to apply (P22):**
- Same breadcrumb (verbatim copy).
- New h1 uses **`text-2xl font-semibold`** (UI-SPEC §typography line 81) — NOT `font-bold` (P22 retired bold).
- Group blocks per output type using the same `bg-bg-card rounded-lg border border-border p-6` chrome.
- Per-row layout: `grid grid-cols-[1fr_auto_auto] gap-3 items-center` with cam name (`text-sm`), mono URL (`text-xs font-mono`), copy button (reuse the copied-state idiom).

---

## Shared Patterns

These cross-cutting patterns apply to MULTIPLE new files. Planner should reference once globally and cite per-file actions only when they deviate.

### Shared 1 — Phase header comment

**Source:** every existing `+server.ts` and orchestration file in `src/lib/server/orchestration/protect-hub/` (verified across 5+ files).

**Pattern (reference: `src/routes/api/protect-hub/reconcile/+server.ts:1-15`):**
```ts
// v1.3 Phase 21 Plan 05 — POST /api/protect-hub/reconcile (force-reconcile).
//
// Non-blocking per D-API-01: returns 202 + { ok: true, reconcileId } IMMEDIATELY,
// then spawns reconcile() in the background as fire-and-forget. The client polls
// `GET /api/protect-hub/reconcile-runs?reconcileId=…` for status (...)
```

**Apply to:** ALL new server endpoints, ALL new orchestration modules, ALL new schema additions, ALL new component files. Header includes phase number, plan number (assigned by planner), short purpose, and key contract (e.g., status codes, idempotency).

---

### Shared 2 — Imports + named exports for `+server.ts`

**Source:** any `+server.ts` in the codebase. Verified at `src/routes/api/protect-hub/bridge/start/+server.ts:1-5`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startBridge } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';

export const POST: RequestHandler = async () => { ... };
```

**Apply to:** all 8 new `+server.ts` files. Always `json()` for response, always `RequestHandler` typed export, always named HTTP-verb export (`GET` / `POST` / `PUT` / `DELETE`).

---

### Shared 3 — Standard error envelope

**Source:** the codebase consistently returns `{ ok: false, error: string, reason?: string }` with HTTP status codes 400/404/422/500/503. Verified across 6+ endpoints.

**Pattern (reference: `src/routes/api/protect-hub/discover/+server.ts:8-36`):**
```ts
export const POST: RequestHandler = async () => {
    try {
        const result = await discover();
        if (!result.ok) {
            const status =
                result.reason === 'controller_unreachable' ? 503
                    : result.reason === 'auth_failed' ? 401
                    : 500;
            return json(
                { ok: false, reason: result.reason, error: result.error.message },
                { status }
            );
        }
        return json({ ok: true, ... });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return json({ ok: false, error: message }, { status: 500 });
    }
};
```

**Apply to:** all 8 new `+server.ts` files. Use `reason` for machine-readable error tags (e.g., `'invalid_step'`, `'pointer_not_found'`), `error` for human-readable English message; UI maps `reason` to German copy on the client side (per UI-SPEC §copywriting).

---

### Shared 4 — Polling cadence in `$effect` with cleanup

**Source:** `src/routes/kameras/+page.svelte:25-31` (verified).

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

**Apply to:**
- `HubEventLog.svelte` — 10 s
- `HubStatusPanel.svelte` — 10 s
- `Step5.svelte` reconcile poll — 1500 ms (UI-SPEC §step-5-health-poll)
- `kameras/+page.svelte` — already uses this; preserve

---

### Shared 5 — Copy-button idiom

**Source:** `src/lib/components/cameras/CameraDetailCard.svelte:8 + 64-69 + 805-811` (verified). Uses `$lib/utils/clipboard.ts` `copyToClipboard()`.

**Pattern:**
```ts
let copied = $state(false);
async function copyXxx() {
    if (await copyToClipboard(value)) {
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
    }
}
```

```svelte
<button onclick={copyXxx} class="text-text-secondary hover:text-text-primary shrink-0 cursor-pointer" title="Kopieren">
    {#if copied}
        <Check class="w-4 h-4 text-green-400" />
    {:else}
        <Copy class="w-4 h-4" />
    {/if}
</button>
```

**Apply to:**
- `OutputsSubsection.svelte` — per-output URL row
- `ProtectHubGuide.svelte` — per-snippet copy button
- `all-urls/+page.svelte` — per-row copy button

UI-SPEC §copy-button line 359-365 locks accessibility additions: minimum `w-8 h-8` clickable area, `<span class="sr-only">Adresse kopieren</span>`, `title="Kopieren"` / `title="Kopiert"`.

---

### Shared 6 — Smoke test via file-content regex

**Source:** `src/routes/settings/tabs.test.ts` (full file, 36 lines, verified).

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('settings tabs (HUB-WIZ-01)', () => {
    it('includes a "Protect Hub" tab between UniFi and Credentials', () => {
        const src = readFileSync(resolve('src/routes/settings/+page.svelte'), 'utf8');
        const match = src.match(/const tabs = \[([^\]]+)\]/);
        expect(match).not.toBeNull();
        ...
    });
});
```

**Apply to:** all new component + page tests (10 test files per RESEARCH §Wave 0 Gaps lines 942-953). The codebase has **no** `@testing-library/svelte` or jsdom installed; regex-against-source is the only available pattern. Server tests (e.g., `src/routes/api/cameras/[id]/outputs/server.test.ts`, verified to exist) use real Vitest mocks of the drizzle DB — pattern at that file's `vi.mock` block; reuse for the 4 new wizard endpoints.

---

### Shared 7 — Drizzle query patterns

**Source:** verified across `bridge-lifecycle.ts:13-14`, `outputs/+server.ts:68-89`, `reconcile-runs/+server.ts:34-38`.

| Operation | Pattern | Example |
|-----------|---------|---------|
| Single-row read | `db.select().from(table).get()` | `getBridgeStatus()` |
| Filtered read | `.where(eq(table.col, value)).get()` | reconcile-runs by id |
| Filtered count | `.select({ n: sql<number>\`count(*)\` })` | outputs MJPEG cap |
| Replace strategy | `db.delete(...).run(); db.insert(...).run()` | outputs replace |
| Single-flight insert | `eq(table.col, value)` then conditional insert/update | wizard-state upsert |

**Apply to:** all new server-side DB operations. Always import `eq, and, sql` from `'drizzle-orm'` and `db` from `'$lib/server/db/client'` (verified across 10+ files).

---

### Shared 8 — Tailwind token vocabulary

**Source:** `src/routes/layout.css` `@theme` block (verified). Tokens already locked.

| Token | Use |
|-------|-----|
| `bg-bg-primary` | page background |
| `bg-bg-card` | card surfaces |
| `bg-bg-input` | input + inset surfaces |
| `border-border` | hairline separators |
| `text-text-primary` | primary copy |
| `text-text-secondary` | labels, helper copy |
| `text-success` / `bg-green-500/10` / `border-green-500/30` | success blocks |
| `text-warning` / `bg-yellow-500/10` / `border-yellow-500/30` | drift / warn blocks |
| `text-danger` / `bg-red-500/10` / `border-red-500/30` | error blocks |
| `bg-accent` (primary CTAs only) | per UI-SPEC §accent-reserved-for-list |
| `bg-accent/10`, `bg-accent/15`, `bg-accent/20`, `border-accent/40` | accent variants via opacity |

**Apply to:** all new components. Phase 22 introduces zero new color variables (UI-SPEC line 45). Phase 22 retires `text-[10px]`, `text-[11px]`, and `px-1.5 py-0.5` per UI-SPEC revisions 2026-05-06.

---

### Shared 9 — Lucide icon imports

**Source:** verified across `CameraDetailCard.svelte:3`, `ProtectHubTab.svelte:12-25`, `onboarding/+page.svelte:6`.

```ts
import { Loader2, CheckCircle2, XCircle, RotateCw, RotateCcw, Copy, Check, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-svelte';
```

**Apply to:** all new components — RESEARCH §Standard Stack §Supporting (lines 130-139) lists the exact icons each new component uses.

---

## No Analog Found

Every file P22 will create or modify has at least one strong existing analog in this codebase. **0 files require pure RESEARCH.md fallback.**

Two files have a "weak" analog where the planner should lean on RESEARCH over the analog:

| File | Role | Notes |
|------|------|-------|
| `src/lib/server/orchestration/protect-hub/hub-state.ts` (NEW) | Pure-function derived state | Only `src/lib/server/services/auth.ts:isYoloMode()` is similar in structure (read setting, return boolean). RESEARCH §Open Question 1 + Pitfall #3 are the canonical sources for the rule. |
| `src/routes/api/protect-hub/drift/+server.ts` (NEW) | On-demand SSH probe | No existing endpoint runs SSH inline on a request. Recommendation per RESEARCH §Open Question 4 + §Pitfall #10: read cached value from `protect_hub_bridges.driftDetected` (a column to be added in Wave 0); 5-min scheduler tick refreshes via SSH. The endpoint just reads cache. Treat the read-cache shape as analog to `bridge/status/+server.ts`. |

---

## Pattern Coverage Summary

| Pattern Category | Coverage |
|------------------|----------|
| Wizard step rendering (3-6) | EXACT analog (P20 Step 1/2 inline) |
| Wizard step indicator (6 discs) | EXACT analog (P20 inline indicator + P11/P18 generic StepIndicator) |
| Resume banner | ROLE-MATCH analog (P20 alert/info card) |
| External cam card | EXACT domain match (CameraDetailCard) |
| Outputs subsection (URL rows) | EXACT excerpt match (CameraDetailCard:794-812) |
| Output toggle state machine | ROLE-MATCH (ProtectHubTab.bridgeAction + RESEARCH §Pattern 3) |
| ProtectHubGuide snippets | ROLE-MATCH (AdoptionGuide instruction blocks + UI-SPEC tabbed layout) |
| Hub-Tab status panel | EXACT (ProtectHubTab Bridge-Container card) |
| Hub event log | EXACT (kameras polling + ProtectHubTab table render) |
| All-URLs page | EXACT (sibling onboarding page server+client shape) |
| Wizard pointer endpoints | EXACT (bridge/start/+server.ts + bridge/status/+server.ts) |
| Health endpoint | COMPOSITE (cameras/status fetch pattern + bridge/status getter shape) |
| Events endpoint | EXACT (reconcile-runs param-driven GET + getEvents helper) |
| DB schema addition | EXACT (P21 protectHubReconcileRuns) |
| DB client.ts table-create | EXACT (P21 reconcile-runs CREATE TABLE) |
| Migration file | EXACT (drizzle/0002_update_runs.sql) |
| Wizard pointer service | EXACT (bridge-lifecycle.ts shape) |
| Slug derivation util | EXACT-SOURCE refactor (yaml-builder.ts:108-111) |
| Smoke testing | EXACT (tabs.test.ts regex pattern) |

---

## Metadata

**Analog search scope:** `src/lib/components/`, `src/routes/`, `src/lib/server/orchestration/protect-hub/`, `src/lib/server/services/`, `src/lib/server/db/`, `drizzle/`. All directly read.

**Files scanned:** 25+ source files read and excerpted. Five files read in full (≤ 1000 lines): `onboarding/+page.svelte` (278), `onboarding/+page.server.ts` (22), `StepIndicator.svelte` (36), `kameras/+page.svelte` (69), `tabs.test.ts` (36). Larger files (`CameraDetailCard.svelte` 972, `ProtectHubTab.svelte` 432, `OnboardingWizard.svelte` 909) read in targeted ranges (imports, copy-button, LXC block, status badge, multi-stage log).

**Pattern extraction date:** 2026-05-07
**Verification:** Every code excerpt above carries an exact file path + line range that was directly read. No paraphrasing of code.
