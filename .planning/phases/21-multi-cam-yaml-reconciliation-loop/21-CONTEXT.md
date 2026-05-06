# Phase 21: Multi-Cam YAML + Reconciliation Loop - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Mode:** Smart-discuss (autonomous) — all 4 grey areas accepted with recommended defaults

<domain>
## Phase Boundary

User can INSERT into `camera_outputs` (manually for now, via SQL or a dev API) and within ≤5 minutes (or instantly via force-reconcile) the bridge's `go2rtc.yaml` is rewritten with the right ffmpeg blocks for each enabled output, deployed atomically via SSH `tmp+rename`, and go2rtc reloads cleanly.

End-state proof:
- Loxone-MJPEG outputs play in VLC at 640×360 @ 10 fps with `-an` (no audio)
- Frigate-RTSP outputs play with original Protect codec untouched (`-c:v copy` passthrough)
- No-op reconcile (DB unchanged) does NOT redeploy (canonical-form sha256 dedupe)
- Two simultaneous triggers serialize via single-flight Promise + dirty-flag retry
- WS reconnect uses exp backoff (5s → 5min cap, single-flight)
- VAAPI cap (soft 4 / hard 6 MJPEG transcodes) enforced
- Self-update returns 409 if `reconciler.busy`
- Bridge health probe extends existing `healthCheckInterval`

Out of scope (deferred to P22/P23):
- Onboarding wizard Steps 3–6 (P22)
- `/cameras` integration / "All Hub URLs" page (P22)
- 3-tier offboarding + share-toggle cleanup + drift indicator (P23)

</domain>

<decisions>
## Implementation Decisions

### Area 1 — ffmpeg Pipeline per Output (D-PIPE)

- **D-PIPE-01** Source URL form: `rtsps://192.168.3.1:7441/<rtspAlias>?enableSrtp` with `tls_verify=0` (per L-10 + P19-01 spike result `Result: rtsps-tls-verify-0`). yaml-builder MUST rewrite Protect's published `rtspx://...` URLs to `rtsps://...`.
- **D-PIPE-02** Loxone-MJPEG ffmpeg form (canonical):
  ```
  ffmpeg:rtsps://192.168.3.1:7441/<token>?enableSrtp#input=tls_verify=0#video=mjpeg#width=640#height=360#raw=-r 10#raw=-an#hardware=vaapi#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2
  ```
  Rationale: matches existing Mobotix pattern in `go2rtc.ts:130-165`; `width/height/-r 10` enforces Loxone Custom Intercom contract; `-an` per L-27.
- **D-PIPE-03** Decoder selection at HEVC sources: implicit via `hardware=vaapi` — go2rtc/ffmpeg auto-selects `hevc_vaapi` per source codec. No explicit `-c:v` decoder flag needed. Verified: Carport cam ships HEVC, this is the realistic-default path.
- **D-PIPE-04** Frigate-RTSP ffmpeg form (canonical):
  ```
  ffmpeg:rtsps://192.168.3.1:7441/<token>?enableSrtp#input=tls_verify=0#video=copy#raw=-an
  ```
  Pure passthrough, zero VAAPI cost (per L-26). `-an` per L-27.
- **D-PIPE-05** Reconnect robustness: `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2` on every output, regardless of type. Matches the existing Mobotix RTSP-cam pattern.
- **D-PIPE-06** Stream slug derivation: `<mac-slug>-<output-suffix>` per L-22, where `mac-slug = lowercase MAC, no separators` and `output-suffix = "low" | "high"` for Loxone-MJPEG and Frigate-RTSP respectively (or `loxone` / `frigate` if both share the same source channel). Final slug pattern locked in plan-phase.

### Area 2 — Reconcile Correctness + No-op Skip (D-RCN)

- **D-RCN-01** Canonical YAML form: use `yaml@2.6` (eemeli) with `sortMapEntries: true`. Strip the first-line stamp comment (`# managed by ip-cam-master, reconcile-id …, ts …`) BEFORE computing sha256 — otherwise every render produces a new hash and the dedupe is useless.
- **D-RCN-02** mtime fast-path (per L-7 + research §"P21 #11"): read remote file mtime AND its sha256. Skip deploy ONLY if BOTH match `protect_hub_bridges.last_deployed_yaml_hash`. Defensive against drift (someone manually edits the file → mtime changes → forces re-deploy).
- **D-RCN-03** YAML deploy atomicity: write to `<dest>.tmp`, `mv` to final path, then `systemctl reload-or-restart go2rtc`. Use existing `pushFileToContainer` helper from `ssh.ts` (already implements tmp+rename per Phase 18 pattern).
- **D-RCN-04** Reconcile event log: new SQLite table `protect_hub_reconcile_runs`, mirroring `update_runs` from P24. Columns: `id INTEGER PK`, `reconcileId TEXT NOT NULL`, `startedAt TEXT NOT NULL`, `completedAt TEXT`, `status TEXT NOT NULL` (running/success/no_op/bridge_unreachable/error), `hashChanged INTEGER NOT NULL DEFAULT 0`, `deployedYamlHash TEXT`, `error TEXT`. Drives drift indicator + reconcile log UI in P23. SQLite (not journalctl) because UI must query.
- **D-RCN-05** URL re-extraction: per L-11 + research #1 — Protect share URLs MUST be re-extracted from `protect.bootstrap.cameras[]` on EVERY reconcile pass; never cached across passes. After UDM reboot, simulated by mocking the bootstrap response with rotated tokens, the next reconcile produces a YAML with fresh tokens; Loxone tiles auto-recover within 5 minutes without user action.

### Area 3 — API + Concurrency (D-API)

- **D-API-01** Force-reconcile endpoint: `POST /api/protect-hub/reconcile` — non-blocking. Returns 202 + `{ reconcileId: <uuid> }` immediately; client polls `GET /api/protect-hub/reconcile-runs?reconcileId=…` for status. Allows UI "Sync now" button without UI-thread block.
- **D-API-02** Per-cam outputs endpoint: `PUT /api/cameras/[id]/outputs` (replace) or `PATCH` (delta). Plan-phase chooses; PUT is simpler. Toggle ON/OFF triggers force-reconcile in-process.
- **D-API-03** Single-flight: module-scoped Promise per bridge id. Queue depth 1: extra triggers SET a dirty flag and return immediately; in-flight reconcile completes, checks dirty flag, runs ONE follow-up. Per L-13.
- **D-API-04** Self-update busy gate: existing update-runner imports `isReconcilerBusy()` from new `reconcile.ts`. If true, returns HTTP 409 with `Retry-After: 60`. Per L-14.
- **D-API-05** WebSocket reconnect: exp backoff schedule `[5_000, 10_000, 30_000, 60_000, 120_000, 300_000]` ms (cap 5min); single-flight; on reconnect, full bootstrap re-fetch + force-reconcile once. Per L-12.

### Area 4 — VAAPI Cap + Health Probe (D-CAP)

- **D-CAP-01** Soft cap (4 MJPEG outputs): backend emits `vaapi_soft_cap_warning` event when count reaches 4; UI banner (P22 surface — P21 only emits the event) shows "X von 4 Transkodierungen aktiv". Toggle-on still succeeds.
- **D-CAP-02** Hard cap (6 MJPEG outputs): API `PUT /api/cameras/[id]/outputs` returns HTTP 422 with `{ ok: false, reason: "vaapi_hard_cap_exceeded", message: "Maximal 6 gleichzeitige Loxone-MJPEG-Transkodierungen pro Bridge möglich. Aktuell: 6." }`. Per L-26.
- **D-CAP-03** Health probe extension: extend existing `healthCheckInterval` in `scheduler.ts` (one extra `fetch(http://<bridgeIp>:1984/api/streams)` per tick — currently 5min cadence). Threshold: 2 consecutive failures → `protect_hub_bridges.status='unhealthy'` + reconcile log event. Recovery: single success → status back to `running`.
- **D-CAP-04** Bridge unreachable mid-reconcile: SSH dial fail → reconcile aborts, `protect_hub_reconcile_runs.status='bridge_unreachable'`, retry on next 5min tick (no immediate retry — avoids tight loop).

### Claude's Discretion

The following are implementation details the planner / executor decide:
- Exact stream slug suffix wording (loxone-low vs simply low; frigate-high vs high)
- File layout: `src/lib/server/orchestration/protect-hub/yaml-builder.ts` + `reconcile.ts` is the obvious split, but planner may bundle into one if rationale is sound
- Test structure (which assertions belong to yaml-builder vs reconcile)
- Migration strategy for the new `protect_hub_reconcile_runs` table (`ensureColumn` pattern from existing schema migrations vs. drizzle-kit)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/lib/server/services/scheduler.ts` — has `healthCheckInterval` (5min container health probes); P21 adds `protectHubReconcileInterval` here + extends healthCheckInterval with one bridge-fetch (per L-25, NOT a separate interval)
- `src/lib/server/services/go2rtc.ts:42-72,130-165,505-528` — `generateGo2rtcConfig`, `generateGo2rtcConfigLoxone`, `generateBridgeConfig` patterns. P21's `yaml-builder.ts` follows the same string-template approach but emits multi-stream YAML
- `src/lib/server/services/ssh.ts` — `pushFileToContainer(ssh, vmid, content, path)` (Phase 18 introduced tmp+rename atomic write); reuse for the reconcile YAML deploy
- `src/lib/server/services/protect-bridge.ts` — `TLS_SCHEME='rtsps-tls-verify-0'`, `protectStreamUrl(host, alias)`, `getProtectClient()` lib singleton (8min refresh window). yaml-builder consumes these
- `src/lib/server/orchestration/protect-hub/catalog.ts` — `discover()` already does Protect bootstrap fetch + classifies cams; reconcile reuses this for the URL re-extraction step (L-11)
- `src/lib/server/orchestration/protect-hub/bridge-provision.ts` — pattern for orchestrating LXC ops via SSH; reconcile follows the same "connect → execute → dispose" envelope
- `src/lib/server/db/schema.ts` — `cameraOutputs`, `protectStreamCatalog`, `protectHubBridges` already exist (P19); `protectHubReconcileRuns` is the new table
- `update-runs` table from P24 — exemplar for the reconcile-runs table layout (atomic state across processes)

### Established Patterns

- SSH ops via `connectToProxmox()` returning a Node-SSH client; always `dispose()` in finally
- DB writes via Drizzle insert/update; never raw SQL except in migrations
- Module-level singletons for stateful services (lib client, scheduler intervals)
- vitest with mocks hoisted via `vi.hoisted({...})`; in-memory better-sqlite3 + drizzle for DB tests
- Atomic per-task git commits with descriptive Why/How messages; co-author trailer

### Integration Points

- `src/routes/api/protect-hub/reconcile/+server.ts` — new POST endpoint (force-reconcile, 202+reconcileId)
- `src/routes/api/protect-hub/reconcile-runs/+server.ts` — new GET endpoint (poll status)
- `src/routes/api/cameras/[id]/outputs/+server.ts` — new PUT endpoint (set outputs, triggers force-reconcile)
- `src/lib/server/services/scheduler.ts` — extend `healthCheckInterval`, add `protectHubReconcileInterval`
- `src/lib/server/services/update-runner.ts` (P24) — import `isReconcilerBusy()` and gate self-update on it (HTTP 409)
- `hooks.server.ts` — SIGTERM handler already exists (P24); extend with 30s grace for in-flight reconciles per L-14

</code_context>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked decisions
- `.planning/research/v1.3/SUMMARY.md` §"Locked-Early Decisions" L-1..L-30 — strategic choices already made
- `.planning/research/v1.3/PITFALLS.md` — failure modes #1, #3, #5, #6, #11, #13, #14, #18 are P21-relevant (per SUMMARY §"P21 — YAML + Reconcile")
- `.planning/research/v1.3/STACK.md` — yaml@2.6, unifi-protect@4.29, no new deps
- `.planning/research/v1.3/ARCHITECTURE.md` — reconcile placement decisions
- `.planning/research/v1.3/spikes/p19-tls-rtspx.md` — locks `TLS_SCHEME='rtsps-tls-verify-0'`; rtspx://→rtsps:// rewrite is mandatory

### Schema
- `.planning/phases/19-data-model-protect-catalog/19-02-PLAN.md` — schema columns committed in P19; `cameraOutputs` already exists, `protectHubReconcileRuns` is new
- `src/lib/server/db/schema.ts` — current state of all tables

### P20 outputs (bridge baseline)
- `.planning/phases/20-bridge-lxc-provisioning/20-03-SUMMARY.md` — bridge live at vmid 2014; `:1984/api/streams` returns `['test']`; ready for multi-cam yaml
- `src/lib/server/services/go2rtc.ts:generateBridgeConfig()` — current hello-world template; P21 replaces with multi-stream output

</canonical_refs>

<specifics>
## Specific Ideas

- Stream URL examples Loxone needs (per Custom Intercom contract, NOT Motion Shape Extreme):
  `http://<bridge-ip>:1984/api/stream.mjpeg?src=<mac-slug>-low`
- Stream URL examples Frigate needs:
  `rtsp://<bridge-ip>:8554/<mac-slug>-high`
- Health probe failure threshold = 2 (not 3) — fast detection, low cost; matches `cameras.status` transitions in existing scheduler

</specifics>

<deferred>
## Deferred Ideas

- VAAPI cap UI banner styling and exact German wording — owned by P22 (UI integration)
- "All Hub URLs" copy-list page — P22
- Bulk-toggle output type across cams — P22
- Drift indicator UI surface — P23 (P21 only writes to `protect_hub_reconcile_runs`)
- Per-stream metrics card — P23
- "Export Hub config before uninstall" — P23
- Auto-add new Protect cam (kind-based default ON/OFF) and soft-delete with 7-day grace — covered by L-20 + L-28; P21 implements the writeback in reconcile, P23 implements UI

</deferred>

---

*Phase: 21-multi-cam-yaml-reconciliation-loop*
*Context gathered: 2026-05-06 via smart-discuss (4/4 areas accepted with recommended defaults)*
