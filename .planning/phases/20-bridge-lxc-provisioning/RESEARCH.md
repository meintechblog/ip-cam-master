# Phase 20 Research — Bridge LXC Provisioning + Hello-World YAML

**Phase:** 20
**Milestone:** v1.3 — Protect Stream Hub
**Researched:** 2026-05-02
**Requirements:** HUB-BRG-01..08, HUB-WIZ-02..04 (11 reqs)

---

## 1. Existing Primitives to Reuse

### 1.1 Container Creation (`proxmox.ts`)

The existing `createContainer()` at `src/lib/server/services/proxmox.ts:83` accepts `{vmid, hostname, ostemplate, memory?, cores?, cameraName?, cameraIp?, cameraType?}` and:
- Checks idempotency (VMID exists → updates config instead)
- Creates with `net0: name=eth0,bridge=${bridge},ip=dhcp`, `onboot: 1`
- Calls `configureVaapi()` for `/dev/dri` passthrough
- Upserts into `containers` table [VERIFIED: codebase grep]

**Bridge-specific delta:** The bridge needs 1024–2048 MB RAM (vs 192 default) and 2–4 cores (vs 1 default). Both are already parameterized. No code change needed in `createContainer()` — just pass higher values. [VERIFIED: proxmox.ts:143-144]

**Template clone path:** `cloneFromTemplate()` at `proxmox.ts:291` supports a `memory` override post-clone (used by Bambu A1 at 1024 MB). The bridge can use the same clone path with `memory: 1024` (or 2048). [VERIFIED: proxmox.ts:321-328]

**VMID allocation:** `getNextVmid()` in `onboarding.ts:659` scans Proxmox LXC+VM IDs + DB, starts at 2000+, increments. Works as-is for bridge. [VERIFIED: codebase]

### 1.2 go2rtc Installation (`go2rtc.ts`)

`getInstallCommands(false)` at `go2rtc.ts:109` installs `ffmpeg intel-media-va-driver wget` + downloads go2rtc binary. Bridge does NOT need Node.js (no Bambu A1 ingestion), so `forBambuA1=false` is correct. [VERIFIED: go2rtc.ts:109-125]

`generateSystemdUnit()` at `go2rtc.ts:80` creates a systemd unit with `Restart=always`, `RestartSec=5`, `StartLimitIntervalSec=0`. Reuse as-is. [VERIFIED: go2rtc.ts:80-93]

### 1.3 SSH Helpers (`ssh.ts`)

All three core helpers are reusable without modification:
- `executeOnContainer(ssh, vmid, cmd)` — runs `pct exec` with D-Bus retry logic [VERIFIED: codebase]
- `pushFileToContainer(ssh, vmid, content, path)` — temp file → `pct push` → cleanup [VERIFIED: codebase]
- `waitForContainerReady(ssh, vmid, timeoutMs=30000)` — polls `pct exec echo ready` every 2s [VERIFIED: codebase]

### 1.4 Scheduler Health Checks (`scheduler.ts`)

Existing health check at `scheduler.ts:76` runs every 5 minutes, iterates `cameras` table rows with `containerIp`, probes `http://<ip>:1984/api/streams` with 3s timeout. [VERIFIED: scheduler.ts:76-115]

**Bridge integration:** The bridge is in `protect_hub_bridges`, not `cameras`. The health check loop needs a small extension: after iterating managed cameras, also query `protect_hub_bridges` for the single bridge row and probe its `containerIp:1984`. [VERIFIED: schema uses separate table per L-3]

### 1.5 P19 Schema Already Locked

`protect_hub_bridges` table is ready: `{id, vmid (unique), hostname, containerIp, status (default 'pending'), lastDeployedYamlHash, lastReconciledAt, lastHealthCheckAt, createdAt, updatedAt}`. [VERIFIED: schema.ts:129-144]

**Status values to use in P20:** `'pending'` → `'provisioning'` → `'running'` / `'failed'` / `'stopped'`. The column is open-ended text, no migration needed. [VERIFIED: schema.ts default is 'pending', no CHECK constraint]

---

## 2. New Code Required

### 2.1 Bridge Provisioning Module

**Recommended location:** `src/lib/server/orchestration/protect-hub/bridge-provision.ts` (alongside existing `catalog.ts`)

**Core function: `provisionBridge()`**

Sequence:
1. Check `protect_hub_bridges` — if row exists with status `running`, return early (idempotent)
2. If row exists with status `failed`, delete it (allow retry)
3. Allocate VMID via `getNextVmid()`
4. Insert `protect_hub_bridges` row with `status='provisioning'`
5. Check for template via `getTemplateVmid()`
6. If template: `cloneFromTemplate({..., memory: 1024})` — fast path (~10s)
7. If no template: `createContainer({..., memory: 1024, cores: 2})` — slow path (3-5min)
8. `startContainer(vmid)`
9. `waitForContainerReady(ssh, vmid)`
10. If no template: run `getInstallCommands(false)` (apt-get ffmpeg, go2rtc, VAAPI driver)
11. Deploy hello-world go2rtc.yaml via `pushFileToContainer()`
12. Deploy systemd unit via `pushFileToContainer()`
13. `systemctl daemon-reload && systemctl enable go2rtc && systemctl restart go2rtc`
14. Poll container IP via `hostname -I` (existing pattern: 15 attempts × 2s)
15. Update bridge row: `containerIp`, `status='running'`
16. Verify health: `GET http://<ip>:1984/api/streams` — if fail, `status='failed'`

**Confidence:** HIGH — this is a direct adaptation of the camera onboarding flow with fewer steps (no ONVIF, no stream verify, no camera-specific config).

### 2.2 Bridge Lifecycle Module

**Recommended location:** `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts`

Functions:
- `startBridge()` — `startContainer(vmid)`, update `status='running'`
- `stopBridge()` — `stopContainer(vmid)`, update `status='stopped'`
- `restartBridge()` — stop + start, update status
- `getBridgeStatus()` — read bridge row, optionally probe health

Reuses existing `startContainer()` / `stopContainer()` from `proxmox.ts`. [VERIFIED: proxmox.ts exports both]

### 2.3 Hello-World go2rtc.yaml

The bridge's initial YAML needs:
1. The `api` binding per L-9
2. The YAML stamp per L-8
3. A test stream to verify go2rtc is working

```yaml
# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>
api:
  listen: "127.0.0.1:1984"
ui_editor: false
streams:
  test: exec:ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=10 -c:v libx264 -f rtsp {output}
```

**Note on `api.listen`:** go2rtc binds API to `127.0.0.1:1984` but RTSP (`:8554`) and MJPEG HTTP need to be LAN-reachable. go2rtc's default exposes `:8554` on all interfaces. The `api.listen` setting only controls the REST API listener, not the RTSP server. [ASSUMED — needs verification against go2rtc source that RTSP `:8554` binds to `0.0.0.0` by default even when `api.listen` is `127.0.0.1`]

**Port 1984 LAN access:** Per HUB-BRG-05, `:1984` must be LAN-exposed for MJPEG HTTP streams (`/api/stream.mjpeg?src=...`). This conflicts with `api.listen: "127.0.0.1:1984"` from L-9. Resolution options:
1. Bind API to `0.0.0.0:1984` but disable the editor UI — go2rtc supports `ui_editor: false` separately
2. Use iptables inside LXC to restrict `:1984` to specific paths
3. Accept that binding to `0.0.0.0:1984` is fine under LAN-trust-boundary (L-23)

**Recommendation:** Bind to `0.0.0.0:1984` with `ui_editor: false`. The LAN-trust posture (L-23) means we don't need per-port auth. The editor is the only sensitive surface. [ASSUMED — confirm go2rtc has `ui_editor` config key; the locked decision L-9 may need amendment]

**CRITICAL FINDING:** L-9 says `api: { listen: "127.0.0.1:1984" }` but the MJPEG stream endpoint lives under the API HTTP server (path `/api/stream.mjpeg`). If API binds to localhost only, Loxone cannot reach the MJPEG stream. **The planner must resolve this conflict.** Options:
- Amend L-9 to `listen: "0.0.0.0:1984"` + disable editor
- Use a reverse proxy (nginx) to expose only `/api/stream.mjpeg` and `/api/streams` — adds complexity
- Confirm with go2rtc docs whether MJPEG is served on a separate listener

**Confidence:** MEDIUM — the L-9 vs HUB-OUT-02 conflict is real and must be resolved before implementation.

### 2.4 Wizard Route (Steps 1–2)

**Location:** `src/routes/settings/protect-hub/onboarding/+page.svelte`

Step 1: Verify Protect connection — call existing `fetchBootstrap()` from `protect-bridge.ts`. If `ok: false` with `reason: 'auth_failed'`, show deep-link to UniFi settings tab (pattern already exists in ProtectHubTab.svelte). [VERIFIED: protect-bridge.ts exports fetchBootstrap()]

Step 2: Provision bridge — POST to new `/api/protect-hub/bridge/provision` endpoint. Long-running (30–90s). UI needs progress indication.

**Progress streaming:** The existing camera onboarding does NOT stream progress — it's a single POST that blocks until done. For the bridge (potentially 3-5min on first provision without template), consider:
- Option A: Same blocking POST with a spinner (simple, matches existing pattern)
- Option B: SSE/EventSource for step-by-step progress
- **Recommendation:** Option A for P20 (matches project conventions), with a "this may take a few minutes" message. If template exists, it's ~10s anyway. [ASSUMED — project prefers simplicity per historical decisions]

### 2.5 API Endpoints

New endpoints needed:
- `POST /api/protect-hub/bridge/provision` — triggers `provisionBridge()`
- `GET /api/protect-hub/bridge/status` — returns bridge row (vmid, status, containerIp, health)
- `POST /api/protect-hub/bridge/start` — calls `startBridge()`
- `POST /api/protect-hub/bridge/stop` — calls `stopBridge()`
- `POST /api/protect-hub/bridge/restart` — calls `restartBridge()`

### 2.6 `nofile` Ulimit (HUB-BRG-04)

The locked decision L-25 specifies `nofile=4096`. Currently no LXC containers set this. Implementation:
- After container creation, append to LXC config: `lxc.prlimit.nofile: 4096`
- Or set inside the container: `ulimit -n 4096` in the systemd unit (`LimitNOFILE=4096`)

**Recommendation:** Add `LimitNOFILE=4096` to the go2rtc systemd unit (simpler, contained). [ASSUMED — systemd LimitNOFILE is supported in LXC containers]

### 2.7 Static IP (HUB-BRG-03)

Current containers use DHCP (`ip=dhcp` in `createContainer`). The bridge needs a stable IP.

Options:
1. **DHCP reservation on the router** — user configures outside the app. App just reads the assigned IP after boot. (Simplest, matches L-24: "DHCP reservation or static config")
2. **Static IP in LXC config** — `net0: name=eth0,bridge=vmbr0,ip=<ip>/24,gw=<gw>`. Requires user to input the desired IP + gateway.
3. **Hybrid:** Provision with DHCP first, read the assigned IP, then let the user optionally lock it to static in the wizard.

**Recommendation:** Option 1 (DHCP) for P20. The IP is stored in `protect_hub_bridges.containerIp` after first boot. The wizard's Step 2 info panel should note: "For stable URLs, create a DHCP reservation for this container's MAC address on your router." This matches L-24 and avoids asking the user for network configuration in the wizard. [ASSUMED — acceptable UX trade-off; can be upgraded to static in P22 wizard if needed]

---

## 3. Database Interaction

### 3.1 Bridge vs Containers Table

Per L-3, the bridge goes in `protect_hub_bridges`, NOT in `containers`. However, `createContainer()` in `proxmox.ts` auto-inserts into the `containers` table. Options:
1. **Let it insert into both** — `containers` gets a row with `cameraType='protect-hub'`, `protect_hub_bridges` gets the hub-specific row. The `containers` row is harmless (it's just a Proxmox inventory).
2. **Skip the `containers` insert** — modify `createContainer()` to accept an `insertDb: false` flag.
3. **Use `cloneFromTemplate()` which also inserts into `containers`** — same issue.

**Recommendation:** Option 1. Let the bridge VMID appear in both tables. The `containers` table is just an inventory of Proxmox LXCs the app manages — the bridge IS one. The `protect_hub_bridges` table adds hub-specific metadata. The health check extension in scheduler.ts should query `protect_hub_bridges` (not filter `containers` by cameraType). [VERIFIED: no unique constraint conflict — vmid is unique per table independently]

### 3.2 Hub State Machine

The Protect Hub tab needs to show hub state. Per L-18, the state machine is: `disabled → starting → enabled → stopping → error`. For P20, only `disabled → starting → enabled` is needed (stopping/error are P23).

State is stored in `settings` table as `protect_hub_enabled` (boolean) plus the bridge's `status` column for container-level state. The two are orthogonal: `protect_hub_enabled=true` + `bridge.status='running'` = hub is live.

---

## 4. go2rtc Configuration Details

### 4.1 YAML Stamp Format (L-8)

```
# managed by ip-cam-master, reconcile-id 550e8400-e29b-41d4-a716-446655440000, ts 2026-05-02T14:30:00.000Z
```

Single comment line, first line of the file. P21 will parse this to detect foreign stamps. P20 just needs to write it. Use `crypto.randomUUID()` for the reconcile-id. [VERIFIED: Node.js crypto.randomUUID() available in Node 22]

### 4.2 go2rtc Config Structure

Based on existing go2rtc.ts generators, the YAML is a plain object with top-level keys: `api`, `streams`, optionally `rtsp`. The `yaml` npm package (already installed, `^2.6.0`) can serialize this, but for P20's simple hello-world config, a template string is sufficient. P21 will need the yaml library for dynamic multi-cam config.

### 4.3 go2rtc Health Check Endpoint

Existing code probes `GET /api/streams` (scheduler.ts:103). This returns a JSON object of stream names → stream info. For the hello-world test stream, a 200 response with `{"test": {...}}` confirms go2rtc is running and the config loaded. [VERIFIED: scheduler.ts:103]

---

## 5. Security Considerations

### 5.1 Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| go2rtc editor exposed to LAN | MEDIUM | `ui_editor: false` disables the config editor UI |
| Unauthenticated MJPEG/RTSP streams | LOW | LAN-trust-boundary (L-23), documented in wizard |
| Bridge IP changes after reboot | MEDIUM | Store IP in DB, re-poll on container start, recommend DHCP reservation |
| Provision creates orphan VMID on failure | MEDIUM | `status='failed'` in DB, retry deletes and re-provisions |
| Proxmox API token leak | LOW | Reuses existing credential storage pattern (encrypted in DB) |

### 5.2 LAN Trust Boundary Documentation

HUB-WIZ-04 (success criterion 8) requires the wizard to document: "Bridge endpoints are unauthenticated by design; ensure the LXC is on a trusted LAN segment." This should appear as an info panel in Step 2 of the wizard.

---

## 6. Pitfalls & Edge Cases

### 6.1 First Provision Without Template (Slow Path)

If no `ipcm-base` template exists (fresh install), the bridge provision takes 3-5 minutes (downloading Debian 13 template + apt-get). The wizard UI must handle this gracefully — "First-time setup takes longer" message. [VERIFIED: createContainer downloads ostemplate live]

**Mitigation:** After bridge provision, fire-and-forget `createTemplateFromContainer()` if no template exists yet — exactly the same pattern used in camera onboarding. Future bridge re-provisions (after Full Uninstall + re-enable) will use the fast clone path. [VERIFIED: onboarding.ts uses this pattern]

### 6.2 VAAPI Device Availability

`configureVaapi()` binds `/dev/dri` into the container. If the Proxmox host lacks an Intel GPU (e.g., AMD-only), VAAPI passthrough fails silently but ffmpeg transcode falls back to software. This is acceptable for P20 (hello-world only); P21 will need VAAPI verification for Loxone-MJPEG transcoding.

### 6.3 Duplicate Bridge Prevention

Only one bridge is allowed in v1.3. `provisionBridge()` must check `protect_hub_bridges` count before creating. If a row exists with `status='running'`, return the existing bridge info. [VERIFIED: schema has no multi-row prevention, must be enforced in code]

### 6.4 Container IP Polling Race

After `startContainer()`, the container may take a few seconds to get a DHCP lease. Existing pattern: poll `hostname -I` via `pct exec` 15 times with 2s sleep. This is proven reliable. [VERIFIED: onboarding.ts uses this pattern]

### 6.5 Bridge Autostart on Host Reboot (HUB-BRG-07)

`createContainer()` already sets `onboot: 1`. The recent fix (commit ce37cb6, 2026-05-02) ensures this is set unconditionally. No additional work needed. [VERIFIED: proxmox.ts:105 and :147]

---

## 7. File Inventory (Expected Changes)

### New Files
| File | Purpose |
|------|---------|
| `src/lib/server/orchestration/protect-hub/bridge-provision.ts` | Provision bridge LXC, deploy hello-world YAML |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` | Start/stop/restart/status for bridge |
| `src/routes/settings/protect-hub/onboarding/+page.svelte` | Wizard UI (Steps 1–2) |
| `src/routes/settings/protect-hub/onboarding/+page.server.ts` | Wizard data loader |
| `src/routes/api/protect-hub/bridge/provision/+server.ts` | POST — provision bridge |
| `src/routes/api/protect-hub/bridge/status/+server.ts` | GET — bridge status |
| `src/routes/api/protect-hub/bridge/start/+server.ts` | POST — start bridge |
| `src/routes/api/protect-hub/bridge/stop/+server.ts` | POST — stop bridge |
| `src/routes/api/protect-hub/bridge/restart/+server.ts` | POST — restart bridge |
| `src/lib/server/orchestration/protect-hub/bridge-provision.test.ts` | Vitest suite |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.test.ts` | Vitest suite |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/server/services/scheduler.ts` | Extend health check loop to probe bridge IP |
| `src/lib/components/settings/ProtectHubTab.svelte` | Add bridge status panel, Start/Stop/Restart buttons, navigate to wizard |
| `src/routes/settings/+page.server.ts` | Load bridge status for ProtectHubTab |
| `src/lib/server/services/go2rtc.ts` | Add `generateBridgeHelloWorldConfig()` function |

---

## 8. Open Questions for Planner

### 8.1 [CRITICAL] L-9 vs MJPEG Access Conflict

L-9 locks `api.listen: "127.0.0.1:1984"` but MJPEG streams are served under the API HTTP server (`/api/stream.mjpeg`). If API is localhost-only, Loxone can't reach MJPEG. **Must amend L-9 to `0.0.0.0:1984`** or add a reverse proxy. Recommend amending L-9 — the LAN-trust posture (L-23) already accepts unauthenticated access.

### 8.2 Bridge Memory Sizing

L-25 says 1–2 GB RAM. For P20 (hello-world only), 1024 MB is sufficient. P21 will need to assess whether multiple ffmpeg transcodes require 2048 MB. **Recommendation:** Start at 1024 MB, document that P21 may bump to 2048 if load testing shows pressure.

### 8.3 Cores

L-25 says 2–4 cores. For P20, 2 cores is sufficient. Same story as memory — P21 may bump.

### 8.4 Template Reuse After Bridge Provision

Should `provisionBridge()` create a template after success (like camera onboarding does)? The bridge is provisioned once and rarely destroyed. Template creation is a nice-to-have for re-provision after Full Uninstall, but the bridge itself could serve as the template source if no template exists yet.

**Recommendation:** Yes, fire-and-forget `createTemplateFromContainer()` after successful bridge provision if no template exists. Cost is near-zero and benefits future camera onboarding too.

---

## 9. Confidence Summary

| Topic | Confidence | Notes |
|-------|------------|-------|
| Container creation reuse | HIGH | Direct adaptation of proven camera flow |
| go2rtc installation reuse | HIGH | Same commands, same binary, same systemd unit |
| SSH helpers reuse | HIGH | No modification needed |
| Health check extension | HIGH | Small addition to existing loop |
| YAML stamp format | HIGH | Simple string, UUID + ISO timestamp |
| L-9 API binding conflict | MEDIUM | Needs resolution — recommend amending to 0.0.0.0 |
| Static IP strategy | MEDIUM | DHCP + recommendation for reservation is pragmatic |
| nofile ulimit | MEDIUM | LimitNOFILE in systemd unit should work in LXC |
| Wizard progress UX | MEDIUM | Blocking POST matches existing pattern |
| go2rtc `ui_editor` config key | LOW | Assumed from locked decision; needs doc verification |

---

## 10. Recommendations

1. **Amend L-9** before planning: change `api.listen` from `127.0.0.1:1984` to `0.0.0.0:1984` with `ui_editor: false`. Flag to user in discuss-phase.
2. **Plan 3 waves:** Wave 1 = bridge-provision + bridge-lifecycle (backend only). Wave 2 = API endpoints + scheduler extension. Wave 3 = wizard UI + ProtectHubTab updates.
3. **Test strategy:** Mock Proxmox/SSH calls in Vitest (established pattern from P19). UAT against real Proxmox is the final gate (same as P19-04).
4. **Bridge container hostname:** Use `protect-hub` (or `hub-bridge`) — short, descriptive, unique in `pct list`.
5. **Memory/cores:** Start at 1024 MB / 2 cores. Document as tunable for P21.
