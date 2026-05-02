# Phase 20 Context — Bridge LXC Provisioning + Hello-World YAML

**Phase:** 20
**Milestone:** v1.3 Protect Stream Hub
**Captured:** 2026-05-02

## Domain

Phase 20 provisions the single shared Bridge LXC container that will host all Hub streams via go2rtc. It deploys a hello-world go2rtc config with a test stream, wires health monitoring into the existing scheduler, and builds Wizard Steps 1-2 (Protect connection check + bridge provisioning). No per-cam outputs, no reconciliation, no multi-cam YAML -- those are P21.

## Locked Requirements (from ROADMAP.md)

HUB-BRG-01, HUB-BRG-02, HUB-BRG-03, HUB-BRG-04, HUB-BRG-05, HUB-BRG-06, HUB-BRG-07, HUB-BRG-08, HUB-WIZ-02, HUB-WIZ-03, HUB-WIZ-04

Success criteria flow from ROADMAP.md §"Phase 20: Bridge LXC Provisioning + Hello-World YAML" (8 criteria).

## Decisions (from this discussion + RESEARCH.md resolution)

### D-API-BIND

**D-API-BIND-01 — Amend L-9: go2rtc API binds to `0.0.0.0:1984` (AMENDED 2026-05-02):**

```yaml
api:
  listen: "0.0.0.0:1984"
  ui_editor: false
```

**Why amended:** L-9 locked `127.0.0.1:1984` but MJPEG streams are served under the API HTTP server (`/api/stream.mjpeg`). If API is localhost-only, Loxone cannot reach MJPEG endpoints from the LAN. The LAN-trust posture (L-23) already accepts unauthenticated access; disabling `ui_editor` removes the only sensitive surface.

**Code impact:** `generateBridgeConfig()` in `go2rtc.ts` uses `0.0.0.0:1984` instead of `127.0.0.1:1984`. The `ui_editor: false` config key disables the go2rtc config editor web UI.

### D-PROV

**D-PROV-01 — Bridge goes in BOTH `containers` and `protect_hub_bridges` tables:**

Let `createContainer()` / `cloneFromTemplate()` auto-insert into `containers` as they already do (cameraType=`protect-hub`). The `protect_hub_bridges` table adds hub-specific metadata. Health check queries `protect_hub_bridges`, not `containers`.

**Why:** The `containers` table is Proxmox inventory; the bridge IS a Proxmox LXC. Dual insertion is harmless and avoids modifying the proven `createContainer` flow.

**D-PROV-02 — Memory 1024 MB / Cores 2 for P20:**

Start at 1024 MB RAM, 2 CPU cores. P21 may bump to 2048 MB if load testing shows memory pressure under multiple ffmpeg transcodes.

**D-PROV-03 — DHCP with reservation recommendation:**

Provision with `ip=dhcp` (existing pattern). Store assigned IP in `protect_hub_bridges.containerIp`. Wizard Step 2 info panel recommends DHCP reservation for stable URLs. Matches L-24 without requiring network config input in wizard.

**D-PROV-04 — nofile via systemd LimitNOFILE:**

Add `LimitNOFILE=4096` to the go2rtc systemd unit for the bridge. Simpler than LXC-level prlimit and contained within the service.

**D-PROV-05 — Bridge hostname: `protect-hub`:**

Short, descriptive, unique in `pct list`.

**D-PROV-06 — Blocking POST for provision (no SSE):**

Matches existing camera onboarding pattern. UI shows spinner + "This may take a few minutes on first setup" message. Template clone is ~10s; first provision without template is 3-5min.

**D-PROV-07 — Fire-and-forget template creation after provision:**

If no `ipcm-base` template exists after successful bridge provision, call `createTemplateFromContainer()` fire-and-forget. Benefits future camera onboarding and bridge re-provisioning.

### D-WIZ

**D-WIZ-01 — Wizard route at `/settings/protect-hub/onboarding` (per L-16):**

Dedicated route, not modal. Steps 1-2 only in P20; Steps 3-6 added in P22.

**D-WIZ-02 — Step 1 verifies Protect connection via existing `fetchBootstrap()`:**

If auth fails, deep-link to UniFi settings tab (existing pattern from ProtectHubTab).

## Code Context (Reusable Assets)

| File | Purpose | Reuse approach for P20 |
|------|---------|----------------------|
| `src/lib/server/services/proxmox.ts` | `createContainer()`, `cloneFromTemplate()`, `startContainer()`, `stopContainer()`, `configureVaapi()`, `getTemplateVmid()`, `createTemplateFromContainer()` | Call directly with bridge-specific params |
| `src/lib/server/services/ssh.ts` | `connectToProxmox()`, `executeOnContainer()`, `pushFileToContainer()`, `waitForContainerReady()` | Call directly, no modification |
| `src/lib/server/services/go2rtc.ts` | `generateSystemdUnit()`, `getInstallCommands()` | Reuse; ADD `generateBridgeConfig()` |
| `src/lib/server/services/scheduler.ts` | `healthCheckInterval` loop | Extend to probe bridge health |
| `src/lib/server/services/onboarding.ts` | `getNextVmid()` | Call directly for VMID allocation |
| `src/lib/server/services/protect-bridge.ts` | `fetchBootstrap()` | Call from wizard Step 1 |
| `src/lib/server/orchestration/protect-hub/catalog.ts` | `loadCatalog()` | Already loaded in settings page |
| `src/lib/server/db/schema.ts` | `protectHubBridges` table | Query/insert/update |
| `src/lib/components/settings/ProtectHubTab.svelte` | Hub tab UI | Extend with bridge controls |

## Canonical Refs

Every downstream agent MUST read these:

| Ref | Path | Why |
|-----|------|-----|
| Project | `.planning/PROJECT.md` | Core constraints |
| Roadmap | `.planning/ROADMAP.md` | Phase 20 success criteria |
| State | `.planning/STATE.md` | Current position |
| Research | `.planning/phases/20-bridge-lxc-provisioning/RESEARCH.md` | Pitfalls, file inventory, open questions |
| This Context | `.planning/phases/20-bridge-lxc-provisioning/20-CONTEXT.md` | Locked decisions for P20 |

## Constraints / Boundaries

- **Phase scope is FIXED:** Bridge provisioning, hello-world YAML, wizard Steps 1-2, health probe, start/stop/restart. NO per-cam outputs, NO reconciliation loop, NO YAML builder.
- **L-3:** Bridge in `protect_hub_bridges`, NOT in `containers` alone (dual OK per D-PROV-01).
- **L-8:** YAML stamp `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>` on first line.
- **L-9 AMENDED:** `api.listen: "0.0.0.0:1984"` + `ui_editor: false` per D-API-BIND-01.
- **L-25:** 1024 MB / 2 cores / nofile=4096 per D-PROV-02/04.
- **One bridge only:** Code must prevent duplicate bridge creation.

## Next Steps

`/clear` then plans 20-01 through 20-03 generated below.
