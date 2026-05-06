---
phase: 21-multi-cam-yaml-reconciliation-loop
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/lib/server/orchestration/protect-hub/yaml-builder.ts
  - src/lib/server/orchestration/protect-hub/reconcile.ts
  - src/lib/server/orchestration/protect-hub/ws-manager.ts
  - src/lib/server/orchestration/protect-hub/catalog.ts
  - src/lib/server/services/scheduler.ts
  - src/lib/server/services/update-checker.ts
  - src/lib/server/services/go2rtc.ts
  - src/lib/server/db/schema.ts
  - src/lib/server/db/client.ts
  - src/hooks.server.ts
  - src/routes/api/protect-hub/reconcile/+server.ts
  - src/routes/api/protect-hub/reconcile-runs/+server.ts
  - src/routes/api/cameras/[id]/outputs/+server.ts
findings:
  critical: 0
  warning: 7
  info: 6
  total: 13
status: findings
---

# Phase 21: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard (per-file with cross-file checks for the protect-hub module)
**Files Reviewed:** 13
**Status:** findings (no BLOCKERs; 7 WARNINGs; 6 INFOs)

## Summary

The implementation is broadly solid: the four user decisions (D-PIPE / D-RCN / D-API / D-CAP) are honoured, single-flight + dirty-flag concurrency is structurally correct, the canonical-hash dedupe works as specified, and tokens are absent from logs and committed fixtures (the redaction CI test is in place). No BLOCKER issues were found — nothing in the changed code prevents shipping or carries a security vulnerability proven exploitable on the LAN-trust posture.

That said, several WARNINGs are worth fixing before this surface widens beyond the live UAT bridge:

1. **Soft-delete archives all external cams when bootstrap returns `ok:true` with zero cameras.** A transient empty bootstrap (e.g. brief Protect controller hiccup that returns 200/empty rather than 5xx) marks every cam `external_archived` and emits a per-cam warning event. The 7-day grace softens the impact, but a sanity threshold would prevent the bad-state cascade.
2. **`pushFileToContainer` heredoc is fragile.** The single-quoted `IPCAMEOF` heredoc delimiter is correct for shell-escaping the YAML body, but if the YAML ever contains a line that is exactly `IPCAMEOF`, the heredoc terminates early. yaml-builder cannot produce that line today, but it is an unguarded contract.
3. **Shell-injection latency bomb in `pushFileToContainer`'s `pct push ${vmid} ${tmpPath} ${remotePath}`.** Today `reconcileId` is always a `randomUUID()` (only hex + dashes), so the unquoted interpolation is safe. But the `reconcile()` signature accepts an `externalReconcileId: string` from any caller. If a future endpoint forwards a user-supplied id without revalidation, the `mv` and `pct push` interpolations become a command-injection sink. Defense-in-depth: validate or quote.
4. **Bootstrap is fetched twice per reconcile pass.** discover() calls fetchBootstrap(); doReconcile then calls fetchBootstrap() again 7 lines later for the soft-delete diff. The 8-min lib cache absorbs the extra wire cost, but the in-process call is unconditional and the comment promises "one-roundtrip-per-reconcile" — these don't agree.
5. **`bridgeFailureCount` is a module-level singleton that races with multiple bridges.** The 2-strike health probe assumes a single bridge (consistent with v1.3 single-bridge MVP), but `db.select().from(protectHubBridges).get()` always returns the first row. If a future migration adds a second bridge, the counter conflates failures across them.
6. **Soft-delete writes `source='external_archived'` but reconcile's auto-add `seedDefaultOutputsForNewCams` does NOT skip archived cams.** A cam archived in pass N can be re-seeded `enabled=true` in pass N+1 (if it returns to bootstrap and discover() flips it back to 'external'). The MJPEG cap counter would also get out of sync if archived cams are skipped for soft-delete but not for the cap pre-count.
7. **The `events.source = 'protect_hub'` literal is not in the `EventSource` TS union.** Both reconcile.ts (direct DB insert) and the PUT /outputs route (cast through `as unknown as Omit<CameraEvent, 'id'>`) work around it. The cast is justified by a comment, but this is a TypeScript hole that future readers will trip on.

INFO findings call out smaller things: a redundant `outputType as OutputType` cast, a `void reconcileId` dead expression, an unused `_reason` parameter, a comment inconsistency (the code says `width=640#height=360` matches "existing Mobotix pattern" but the existing Mobotix pattern uses `cappedFps = Math.min(fps, 15)` not a hardcoded 10), and a couple of small consistency issues.

---

## Warnings

### WR-01: Soft-delete may archive all external cams on a transient empty bootstrap

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:239-247`
**Issue:** When `fetchBootstrap()` returns `{ ok: true, cameras: [] }` (e.g. Protect controller restarting and returning a partially-loaded bootstrap, or all cams transiently filtered out by the lib's `modelKey === 'camera'` check during a firmware upgrade), `bootstrapMacs` becomes an empty `Set` and `softDeleteMissingCams()` archives every external cam, emitting one per-cam `protect_hub_cam_archived` warning event. The 7-day grace window in P23 will eventually unarchive them, but until then every reconcile produces an empty YAML, the bridge restarts go2rtc with zero streams, and Loxone tiles go dark across the entire deployment.

The current guard (`if (bootstrap.ok)`) only protects against fetch errors, not against legitimate-looking-but-empty responses. The same call inside `discover()` would also see zero cams, so the discover path is silent (no error), and only the soft-delete path produces visible damage.

**Fix:** Add a sanity threshold before archiving — refuse to archive when the bootstrap returned `{ cameras: [] }` AND the DB has any external cams (i.e. "going from N>0 cams to 0 cams in a single pass" should require a second confirming pass).

```ts
if (bootstrap.ok) {
    const bootstrapMacs = new Set(
        bootstrap.cameras.map((c) => normalizeMac(c.mac ?? '')).filter((m) => m !== '')
    );
    // Defensive: refuse to archive ALL cams in a single pass — a transient
    // empty bootstrap (controller restart, partial response) would otherwise
    // archive the entire fleet on one tick. Require a non-empty bootstrap
    // OR an empty DB before applying soft-delete.
    if (bootstrapMacs.size > 0) {
        softDeleteMissingCams(bootstrapMacs);
    } else {
        const externalCount = db
            .select({ n: sql<number>`count(*)` })
            .from(cameras)
            .where(eq(cameras.source, 'external'))
            .get();
        if ((externalCount?.n ?? 0) === 0) {
            // empty DB + empty bootstrap is a no-op, safe
            softDeleteMissingCams(bootstrapMacs);
        }
        // else: skip; next pass with non-empty bootstrap will reconcile normally
    }
}
```

---

### WR-02: `pushFileToContainer` heredoc breaks if YAML contains a line equal to `IPCAMEOF`

**File:** `src/lib/server/services/ssh.ts:88` (cited because reconcile.ts depends on it)
**Issue:** The reconcile path delegates atomic write to `pushFileToContainer`, which writes the file via:

```ts
await ssh.execCommand(`cat > ${tmpPath} << 'IPCAMEOF'\n${content}\nIPCAMEOF`);
```

The single-quoted heredoc delimiter prevents shell expansion of `$`, backticks, and `\` inside the YAML body — that part is correct. But the heredoc terminates at any line that is exactly `IPCAMEOF`. If a future yaml-builder change ever emits `IPCAMEOF` on its own line (e.g. a stream slug coincidentally named that way, or a comment block someone adds), the heredoc closes early, the rest of the YAML lands as shell commands on the Proxmox host, and the deploy fails with weird syntax errors at best (or executes the YAML body as shell at worst).

yaml-builder today emits MAC-derived slugs (lowercase hex) so this cannot happen. But there's no guard, and a future contributor adding a free-text stream label has no way to know.

**Fix:** Use a randomized heredoc terminator and reject any content that contains it (defense-in-depth, no perf cost):

```ts
export async function pushFileToContainer(
    ssh: NodeSSH,
    vmid: number,
    content: string,
    remotePath: string
): Promise<void> {
    const tmpPath = `/tmp/ipcam-${Date.now()}`;
    const eof = `IPCAMEOF_${randomUUID().replace(/-/g, '')}`;
    if (content.split('\n').some((line) => line === eof)) {
        throw new Error('pushFileToContainer: content collides with heredoc terminator');
    }
    await ssh.execCommand(`cat > ${tmpPath} << '${eof}'\n${content}\n${eof}`);
    await ssh.execCommand(`pct push ${vmid} ${tmpPath} ${remotePath}`);
    await ssh.execCommand(`rm ${tmpPath}`);
}
```

---

### WR-03: `reconcileId` unquoted in shell commands — safe today, fragile for future callers

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:320-322` and `src/lib/server/services/ssh.ts:91`
**Issue:** `reconcile.ts` builds `tmpPath = ${FINAL_YAML_PATH}.tmp.${reconcileId}` and passes it to two shell-interpolated commands:

1. `executeOnContainer(ssh, bridge.vmid, mv ${tmpPath} ${FINAL_YAML_PATH})` — wrapped in `bash -c '...'`, so the `${tmpPath}` is inside single quotes, BUT only after the `replace(/'/g, ...)` escape pass. If `reconcileId` contains a single quote, the escape handles it. If it contains anything else (spaces, `;`, backticks), the bash-c quoting still contains it. Safe.
2. `pushFileToContainer(... tmpPath)` then runs `ssh.execCommand(`pct push ${vmid} ${tmpPath} ${remotePath}`)` — this is **not** wrapped in `bash -c '...'`. The remote shell receives the literal command string and word-splits on spaces. If `reconcileId` contains a space, `pct push` gets an extra argument and fails (or worse, takes a wrong path). If it contains `;` or `&&` or backticks, command injection.

Today `reconcileId` is always a `randomUUID()` from `node:crypto` (POST /reconcile generates one server-side; the function default is also randomUUID). UUID format is hex+dashes only. Safe.

But `reconcile(bridgeId, reason, externalReconcileId?)` exposes the parameter as `string` with no validation. A future endpoint that forwards `reconcileId` from the URL — e.g. a "retry with the same id" handler — would be a command-injection sink.

**Fix:** Add a UUID-format guard at the entry point so the shape is enforced regardless of caller:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reconcile(
    bridgeId: number,
    reason: ReconcileReason,
    externalReconcileId?: string
): Promise<ReconcileResult> {
    if (externalReconcileId !== undefined && !UUID_RE.test(externalReconcileId)) {
        throw new Error(`reconcile: externalReconcileId must be a UUIDv4-shape string`);
    }
    // ...rest unchanged
}
```

Alternatively, pass `tmpPath` as a quoted argument to a shell-aware wrapper. The validation guard is the lighter touch.

---

### WR-04: Bootstrap fetched twice per reconcile pass (comment promises one)

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:215-244`
**Issue:** The flow is:
- Line 220: `await discover()` — internally calls `fetchBootstrap()`
- Line 239: `await fetchBootstrap()` — second call, for the soft-delete MAC diff

The comment at line 217-219 reads:
> "fetchBootstrap is also called below for the soft-delete diff; the extra call is acceptable because the lib internally caches the bootstrap with an 8-min refresh window (L-12). discover() reuses the same cached client, so this is a one-roundtrip-per-reconcile cost."

This is partially accurate — the lib client (`getProtectClient`) caches the *login session* for 8 min, but `getBootstrap()` is a separate API call that does NOT have an 8-min cache; it hits the wire on every call (verified in `src/lib/server/services/protect-bridge.ts:74-94` and the lib's `protect-api.ts`). So the comment is misleading: this really is two HTTP roundtrips per reconcile pass against the UDM, not one.

The real fix is to thread the discover() result into the soft-delete path so the bootstrap is fetched once.

**Fix:** Extend `DiscoverResult` to include the bootstrap MAC set (or the cameras array), then use that in soft-delete:

```ts
// In catalog.ts:
export type DiscoverResult =
    | { ok: true; insertedCams: number; updatedCams: number; insertedChannels: number;
        bootstrapMacs: Set<string>; }   // NEW
    | { ok: false; reason: ...; error: Error };

// inside discover():
const bootstrapMacs = new Set(
    result.cameras.map((c) => normalizeMac(c.mac ?? '')).filter((m) => m !== '')
);
return { ok: true, insertedCams, updatedCams, insertedChannels, bootstrapMacs };

// In reconcile.ts:
const discoverResult = await discover();
if (!discoverResult.ok) { /* unchanged */ }
seedDefaultOutputsForNewCams();
softDeleteMissingCams(discoverResult.bootstrapMacs);   // no second fetchBootstrap()
```

---

### WR-05: `bridgeFailureCount` module-level state assumes single bridge (works today, breaks future multi-bridge)

**File:** `src/lib/server/services/scheduler.ts:24,166-205`
**Issue:** `bridgeFailureCount` is a single module-level integer. The health probe loops over `db.select().from(protectHubBridges).get()` (singular) — so today, a single bridge is the only path exercised. But the logic is structurally flawed for the moment a second bridge is added: failures of bridge A and bridge B share the counter, so two failures (one per bridge) would mark whichever bridge currently lives in the DB row as `unhealthy` even though each bridge has only failed once.

This is a v1.3-MVP-fits-single-bridge constraint per `21-CONTEXT.md`, so the BLOCKER bar isn't crossed. But the comment at line 21 says "P21 adds 2-strike threshold" without flagging that it is single-bridge-only.

**Fix:** Move the counter into a `Map<bridgeId, number>` so it scales:

```ts
const bridgeFailureCount = new Map<number, number>();
// ...
const bridge = db.select().from(protectHubBridges).get();
if (bridge) {
    const fc = bridgeFailureCount.get(bridge.id) ?? 0;
    // ...success path: bridgeFailureCount.set(bridge.id, 0);
    // ...failure path: bridgeFailureCount.set(bridge.id, fc + 1);
    // ...unhealthy threshold: if ((bridgeFailureCount.get(bridge.id) ?? 0) >= 2 && ...
}
```

Cleanup on `stopScheduler()`: `bridgeFailureCount.clear()`.

---

### WR-06: `seedDefaultOutputsForNewCams` does not exclude `external_archived` cams

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:494-498`
**Issue:** Pass 1c soft-delete sets `source = 'external_archived'`. Pass 1b auto-add (which runs BEFORE 1c on the same pass) selects `WHERE eq(cameras.source, 'external')` — correctly excluding archived cams. So in a single pass the order is fine.

BUT consider this sequence across passes:

- Pass N: cam X is in bootstrap. Source='external'. seedDefaultOutputsForNewCams sees no row in cameraOutputs → seeds enabled=true.
- Pass N+1: cam X drops out of bootstrap (e.g. firmware upgrade hiding cams). discover() does NOT remove cam X (it's an UPSERT-only path). softDeleteMissingCams archives cam X (source='external_archived'). The `cameraOutputs` row remains (no cleanup).
- Pass N+2: cam X is back. discover() upserts and writes source='external' (overwriting 'external_archived' on line 92 in catalog.ts: `source: 'external'`). loadOutputRows includes it. So far so good.
- Pass N+3 (still no row removal between archive and unarchive): seedDefaultOutputsForNewCams is called, looks for an existing cameraOutputs row for cam X. Finds the OLD one (from pass N) and skips. But the user may have manually disabled it in P23 UI — and the old row's enabled state is preserved across the archive/unarchive cycle. Probably the right behavior.

The actual bug: the auto-add cap counter on line 482-491 counts `enabled=true` mjpeg outputs across ALL cams, including archived ones. If an archived cam's row still has `enabled=true`, it occupies cap headroom that should be free. The user can't unblock it through the UI (P23 hides archived cams), so the cap stays artificially exhausted.

**Fix:** Exclude archived cams from the cap counter. Either by joining cameras and filtering on `source = 'external'`, or by clearing `enabled=false` in `softDeleteMissingCams`:

```ts
// Option A — filter cap counter:
const enabledCountRow = db
    .select({ n: sql<number>`count(*)` })
    .from(cameraOutputs)
    .innerJoin(cameras, eq(cameras.id, cameraOutputs.cameraId))
    .where(
        and(
            eq(cameraOutputs.outputType, 'loxone-mjpeg'),
            eq(cameraOutputs.enabled, true),
            eq(cameras.source, 'external')
        )
    )
    .get();

// Option B — disable outputs on archive (in softDeleteMissingCams):
db.update(cameraOutputs)
    .set({ enabled: false, updatedAt: new Date().toISOString() })
    .where(eq(cameraOutputs.cameraId, cam.id))
    .run();
```

Option A also fixes the same off-count in the PUT /outputs hard-cap check (`+server.ts:78-89` doesn't filter on `cameras.source`).

---

### WR-07: TS `EventSource` union does not include `'protect_hub'` — multiple workarounds in code

**File:** `src/lib/types.ts:222` (referenced); `src/lib/server/orchestration/protect-hub/reconcile.ts:694-706`; `src/routes/api/cameras/[id]/outputs/+server.ts:128-138`
**Issue:** The reconcile path emits events with `source: 'protect_hub'`. But:

```ts
// src/lib/types.ts:222
export type EventSource = 'protect_api' | 'ssh_logs' | 'app';
```

`'protect_hub'` is not in the union. Two divergent workarounds exist:

1. `reconcile.ts` bypasses `storeEvent()` and writes via `db.insert(events)` directly (line 695-705). The schema column is plain `text`, so the DB accepts it. Comments at line 676-683 explain the why and defer the type widening to P23.
2. The PUT /outputs route uses a TS escape hatch:
   ```ts
   } as unknown as Omit<CameraEvent, 'id'>);
   ```
   to call `storeEvent()` with the `'protect_hub'` source and the new `'vaapi_soft_cap_warning'` eventType.

Both work. But this is inconsistent (two patterns for the same problem) and the comment-justified cast in the route file is exactly the kind of `as unknown as` that CLAUDE.md's "no `any` without explanatory comment" rule is meant to discourage. Future readers will not be able to grep for misuse if the project tolerates `as unknown as ...` casts to plug union holes instead of widening the union.

**Fix:** Widen the union now (one-line change) and remove both workarounds:

```ts
// src/lib/types.ts
export type EventSource = 'protect_api' | 'ssh_logs' | 'app' | 'protect_hub';
export type EventType =
    | 'camera_disconnect'
    | 'camera_reconnect'
    | 'stream_failed'
    | 'adoption_changed'
    | 'aiport_error'
    | 'reconcile_deployed'
    | 'reconcile_noop'
    | 'reconcile_error'
    | 'protect_hub_cam_added'
    | 'protect_hub_cam_archived'
    | 'vaapi_soft_cap_warning';
```

Then both reconcile.ts's direct insert and the PUT /outputs cast can be replaced with normal `storeEvent()` calls. The comment at line 676-683 in reconcile.ts ("declared out-of-scope by 21-03-PLAN files_modified") is correct procedurally but the cost is ongoing technical debt.

---

## Info

### IN-01: Redundant TS cast `o.outputType as OutputType` in loadOutputRows

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:453`
**Issue:** The Drizzle select infers `outputType` as `string` from the schema's `text('output_type')` column. The cast `as OutputType` narrows it to the literal union, but yaml-builder already does an exhaustive switch at runtime and throws on unsupported types (line 119-125 of yaml-builder.ts). The cast suppresses TS without adding safety.
**Fix:** Either trust the runtime guard and use `outputType: o.outputType as OutputType` with an `// SAFETY: yaml-builder validates at runtime` comment, or filter at the SQL layer by adding `inArray(cameraOutputs.outputType, ['loxone-mjpeg', 'frigate-rtsp'])` to the WHERE clause. The latter is cleaner — unsupported types in the DB never produce yaml-builder throws.

---

### IN-02: Unused `_reason` parameter in `doReconcile`

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:196`
**Issue:** `doReconcile(bridgeId, reconcileId, _reason)` accepts `reason` (prefixed `_` to silence the linter) but never uses it. The reason is meaningful for audit (it would let P23's reconcile-log UI show "tick" vs "force" vs "ws_reconnect"), but the audit-row schema doesn't carry a `reason` column, so the value is dropped.
**Fix:** Either drop the parameter from `doReconcile` (the public `reconcile()` already accepts it), or persist it on the audit row. Persisting is the higher-value change for P23:

```ts
// schema.ts
export const protectHubReconcileRuns = sqliteTable('protect_hub_reconcile_runs', {
    // ...existing
    reason: text('reason'),  // 'tick' | 'force' | 'output_toggle' | 'ws_reconnect' | null
});

// client.ts ensureColumn:
ensureColumn('protect_hub_reconcile_runs', 'reason', 'TEXT');

// reconcile.ts insertRunRow:
function insertRunRow(reconcileId: string, reason: ReconcileReason): void {
    db.insert(protectHubReconcileRuns).values({ reconcileId, reason, ... }).run();
}
```

---

### IN-03: `void reconcileId;` is dead code

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:730`
**Issue:** `void reconcileId;` at the end of `emitReconcileEvent` is a comment-as-code marker ("referenced in `message` already; helper signature kept for future fields"). The TS compiler treats it as a dead expression. Linter may flag it; future readers may delete the parameter and not notice the comment.
**Fix:** Replace with an actual comment or use the parameter:

```ts
// reconcileId is currently embedded in the message by callers; kept on this
// helper's signature for future audit-row enrichment (e.g. eventId<->reconcileId join).
```

---

### IN-04: Comment claim that Loxone hardcoded values "match the existing Mobotix pattern" is partially incorrect

**File:** `src/lib/server/orchestration/protect-hub/yaml-builder.ts:39-40`
**Issue:** The comment in `21-CONTEXT.md:39` (cited by the file's docs) says "matches existing Mobotix pattern in `go2rtc.ts:130-165`". The Mobotix Loxone pattern (`generateGo2rtcConfigLoxone`) actually:
- Uses `Math.min(fps, 15)` not a hardcoded `-r 10`
- Uses `-c:v h264` (transcoding), not `-c:v copy`
- Uses `-maxrate ${bitrate}k -bufsize ${bufsize}k` (bitrate cap)
- Reads from `http://localhost:8081/mjpg/video.mjpg`, not `rtsps://`

The Phase 21 form is genuinely different — it transcodes to MJPEG (not H.264) at 640x360@10fps with no bitrate cap. The "matches the existing Mobotix pattern" claim is misleading.
**Fix:** Update the comment to reflect the actual lineage — this is a Loxone-Custom-Intercom-specific recipe locked by L-27 + Florian Rhomberg's recipe, not a Mobotix copy.

---

### IN-05: `getActiveFlowConflicts` swallows `isReconcilerBusy()` errors silently

**File:** `src/lib/server/services/update-checker.ts:78-87`
**Issue:** The `try { if (isReconcilerBusy()) ... } catch { /* reconcile module may not be loaded yet */ }` swallows any error. `isReconcilerBusy()` is a synchronous module-level read; the only way it throws is if the module fails to load (early boot, dependency cycle). At normal runtime, it cannot throw. The catch hides legitimate import errors that would otherwise surface during boot.
**Fix:** Either log the caught error (so misconfiguration is visible) or remove the try/catch and accept that an import failure should be loud:

```ts
try {
    if (isReconcilerBusy()) {
        conflicts.push({ kind: 'reconciler_busy', detail: 'Protect Hub reconcile in progress' });
    }
} catch (err) {
    console.warn('[update-checker] isReconcilerBusy probe failed:', (err as Error).message);
}
```

---

### IN-06: Single-flight follow-up loses caller's `externalReconcileId`

**File:** `src/lib/server/orchestration/protect-hub/reconcile.ts:177-181`
**Issue:** When a concurrent caller bumps `_dirty=true` while a pass is in flight, the follow-up `setImmediate(() => reconcile(bridgeId, 'tick'))` does not preserve the dirty caller's externalReconcileId (and cannot — multiple callers might have raced on different ids). The follow-up always uses a fresh randomUUID. The function doc at line 138-145 calls this out explicitly:

> "Trade-off: API correlation is best-effort, single-flight correctness is absolute"

This is by-design but the API contract is not surfaced anywhere in the SvelteKit route docs. A user polling `GET /reconcile-runs?reconcileId=X` after `POST /reconcile` returned `X` will get a 404 if their pass got coalesced with an in-flight one.

The route file's comment at line 14-15 of `reconcile-runs/+server.ts` mentions:
> "404 when the row is not (yet) present — clients should retry with the same id, since the audit row is INSERTed at the start of reconcile()"

But this only handles the early-poll race, not the coalesced-by-single-flight case. The latter never inserts an audit row with the requested id; retry will never succeed.

**Fix:** Document the contract in the route response. Either:
1. Return 410 Gone with a `coalescedInto: <other-reconcile-id>` field (requires tracking the join);
2. Update the route doc to say "if the row never appears, your reconcile was coalesced into a concurrent pass — query the latest run instead";
3. (Cleanest) record dirty-flag follow-ups against the original caller's id in a sidecar table.

For v1.3 MVP, doc-only is fine — but the current 404 leaves the client stuck.

---

## Files Reviewed (Full List)

- `src/lib/server/orchestration/protect-hub/yaml-builder.ts` — clean, no findings
- `src/lib/server/orchestration/protect-hub/reconcile.ts` — WR-01, WR-03, WR-04, WR-06, IN-01, IN-02, IN-03
- `src/lib/server/orchestration/protect-hub/ws-manager.ts` — clean (single-flight + backoff are correctly wired; cyclic-import warning in the file header is honoured)
- `src/lib/server/orchestration/protect-hub/catalog.ts` — clean (controller_host fix is correct; `unifi_host` is the right source per the comment)
- `src/lib/server/services/scheduler.ts` — WR-05
- `src/lib/server/services/update-checker.ts` — IN-05
- `src/lib/server/services/go2rtc.ts` — only the `rtsp_transport tcp` Bambu fix was added (line 183); the rest of the file is preexisting v1.0/v1.2 code and out of scope
- `src/lib/server/db/schema.ts` — clean (`protectHubReconcileRuns` matches D-RCN-04 spec)
- `src/lib/server/db/client.ts` — clean (CREATE TABLE IF NOT EXISTS + indexes are idempotent)
- `src/hooks.server.ts` — clean (30s grace window correctly polls `isReconcilerBusy`; SIGTERM handler is well-formed)
- `src/routes/api/protect-hub/reconcile/+server.ts` — clean (202+id pattern correct; fire-and-forget caught)
- `src/routes/api/protect-hub/reconcile-runs/+server.ts` — IN-06 (doc gap, not a bug)
- `src/routes/api/cameras/[id]/outputs/+server.ts` — WR-06 (cap count bug shared with reconcile.ts), WR-07 (cast workaround)

---

## Notes Outside Scope (informational only, NOT findings)

- The `pushFileToContainer` heredoc in `ssh.ts` is preexisting code (P18). The WR-02 fix would also benefit P18's Bambu adoption path. Treating as in-scope because reconcile.ts is the new heavy consumer.
- Performance issues (e.g. discover() doing one SELECT-then-INSERT per cam inside the transaction, the duplicate fetchBootstrap call's wire cost) are intentionally NOT flagged per v1 scope — they don't affect correctness.
- The `STAMP_REGEX` in yaml-builder.ts strips only the first stamp line. If someone manually deploys a YAML with two stamp comments, the canonical hash diverges from the builder's output. Not a real-world concern (only the builder writes stamps), but the regex could be tightened to match `^# managed by ip-cam-master.*\n` repeated greedily for resilience.
- The `events.timestamp` dedup in `storeEvent` (events.ts:9-21) means two events with the same timestamp + type + message are coalesced. The reconcile path produces deterministic timestamps via `new Date().toISOString()` which has millisecond precision — not a real concern, but worth noting that two reconciles emitting `reconcile_noop` with the same hash slice in the same millisecond would deduplicate one of the audit-event entries.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## REVIEW COMPLETE
