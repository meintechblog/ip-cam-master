---
phase: 20-bridge-lxc-provisioning
verified: 2026-05-02T09:10:00Z
status: human_needed
score: 7/8 success criteria structurally verified
deferred:
  - item: "HUB-BRG-03 static IP via DHCP reservation"
    phase: "P20 amended decision D-PROV-03: DHCP with reservation recommendation, not enforced in wizard"
    evidence: "Amended decision in ROADMAP Phase 20 details"
---

# Phase 20: Bridge LXC Provisioning + Hello-World YAML — Verification Report

**Phase Goal:** User can click "Bridge bereitstellen" in the Protect Hub tab, watch a single shared LXC container get provisioned from the existing Debian 13 + VAAPI template (30–90 s), and verify that go2rtc inside it serves a hardcoded test stream on `:1984` (MJPEG) and `:8554` (RTSP) — without any per-cam outputs yet, but with the security surface fully locked down

**Verified:** 2026-05-02T09:10:00Z
**Status:** human_needed
**Plans completed:** 2/3 (20-01 ✓, 20-02 ✓, 20-03 pending UAT)

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Hub toggle → wizard → Step 1 (Protect check) + Step 2 (provision) | ✓ VERIFIED | `onboarding/+page.svelte:278 lines` — Step 1 calls `/api/protect-hub/discover`, Step 2 calls `/api/protect-hub/bridge/provision`. `bridge-provision.ts:187 lines` allocates VMID, calls `createContainer()` or `cloneFromTemplate()` with BRIDGE_MEMORY=1024, BRIDGE_CORES=2. `proxmox.ts` sets `onboot:1`. VAAPI via template. |
| SC-2 | LXC created from SAME existing template, bridge-specific sizing | ✓ VERIFIED | `bridge-provision.ts:78-86` — calls `cloneFromTemplate()` (fast path) with BRIDGE_MEMORY=1024, hostname='protect-hub'. Falls back to raw `createContainer()` if no template. |
| SC-3 | go2rtc.yaml has `api.listen: 0.0.0.0:1984`, `ui_editor: false` | ✓ VERIFIED | `go2rtc.ts:515-516` — `listen: "0.0.0.0:1984"` + `ui_editor: false`. Editor disabled per D-API-BIND-01. |
| SC-4 | YAML carries idempotency stamp `# managed by ip-cam-master` | ✓ VERIFIED | `go2rtc.ts:513` — `managed by ip-cam-master` stamp in `generateBridgeConfig()`. |
| SC-5 | Bridge survives host reboot (autostart=1) | ✓ VERIFIED | `proxmox.ts:146` — `onboot: 1` in `createContainer()`. Template clones inherit config. |
| SC-6 | Start/Stop/Restart in ProtectHubTab + health probe in scheduler | ✓ VERIFIED | `ProtectHubTab.svelte:66` — `bridgeAction()` calls `/api/protect-hub/bridge/{action}`. `scheduler.ts:142-164` — probes `http://${bridge.containerIp}:1984/api/streams` every 5 min, updates `lastHealthCheckAt`. |
| SC-7 | Provision failure → status='failed', retryable, idempotent | ✓ VERIFIED | `bridge-provision.ts:49-51` — failed rows cleaned up before re-provision. `bridge-provision.ts:178-181` — catch sets `status: 'failed'`. |
| SC-8 | LAN-trust-boundary documented in wizard Step 2 | ? NEEDS HUMAN | `ProtectHubTab.svelte:198-209` — contains German LAN-trust text "Bridge-Endpunkte sind absichtlich nicht authentifiziert..." but visual placement and clarity need human review. |

**Score:** 7/8 truths structurally verified (1 needs human visual confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/server/orchestration/protect-hub/bridge-provision.ts` | provisionBridge() | ✓ VERIFIED | 187 lines, exports `provisionBridge`, imported by provision endpoint |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` | start/stop/restart/status | ✓ VERIFIED | 78 lines, all 4 exports imported by 4 API routes + 2 page loaders |
| `src/lib/server/services/go2rtc.ts` | generateBridgeConfig() | ✓ VERIFIED | 724 lines, contains stamp + 0.0.0.0:1984 + ui_editor:false + LimitNOFILE=4096 |
| `src/routes/api/protect-hub/bridge/provision/+server.ts` | POST endpoint | ✓ VERIFIED | 19 lines, calls provisionBridge() |
| `src/routes/api/protect-hub/bridge/status/+server.ts` | GET endpoint | ✓ VERIFIED | 10 lines, calls getBridgeStatus() |
| `src/routes/api/protect-hub/bridge/start/+server.ts` | POST endpoint | ✓ VERIFIED | 18 lines, calls startBridge() |
| `src/routes/api/protect-hub/bridge/stop/+server.ts` | POST endpoint | ✓ VERIFIED | 18 lines, calls stopBridge() |
| `src/routes/api/protect-hub/bridge/restart/+server.ts` | POST endpoint | ✓ VERIFIED | 18 lines, calls restartBridge() |
| `src/routes/settings/protect-hub/onboarding/+page.svelte` | Wizard Steps 1-2 | ✓ VERIFIED | 278 lines, Step 1 (discover) + Step 2 (provision) |
| `src/routes/settings/protect-hub/onboarding/+page.server.ts` | Wizard loader | ✓ VERIFIED | 22 lines, redirects if bridge running |
| `src/lib/components/settings/ProtectHubTab.svelte` | Bridge controls + status | ✓ VERIFIED | 385 lines, lifecycle buttons + health display + LAN-trust text |
| `src/lib/server/services/scheduler.ts` | Bridge health probe | ✓ VERIFIED | Bridge probe at lines 142-164, fetches :1984/api/streams |
| `src/lib/server/orchestration/protect-hub/bridge-provision.test.ts` | Vitest suite | ✓ VERIFIED | 288 lines, 9 tests, all passing |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.test.ts` | Vitest suite | ✓ VERIFIED | 196 lines, 12 tests, all passing |

**Artifacts:** 14/14 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| provision/+server.ts | bridge-provision.ts | `import { provisionBridge }` | ✓ WIRED | POST handler calls provisionBridge() |
| bridge-provision.ts | proxmox.ts | `import { createContainer, cloneFromTemplate, ... }` | ✓ WIRED | Uses both template and raw create paths |
| bridge-provision.ts | go2rtc.ts | `import { generateBridgeConfig, generateBridgeSystemdUnit }` | ✓ WIRED | Deploys config and systemd unit |
| ProtectHubTab.svelte | bridge API endpoints | `fetch('/api/protect-hub/bridge/{action}')` | ✓ WIRED | bridgeAction() at line 66-69 |
| onboarding/+page.svelte | provision endpoint | `fetch('/api/protect-hub/bridge/provision')` | ✓ WIRED | Step 2 at line 66 |
| scheduler.ts | protectHubBridges | `import { protectHubBridges }` | ✓ WIRED | Health probe queries bridge row, fetches :1984 |
| settings/+page.server.ts | bridge-lifecycle.ts | `import { getBridgeStatus }` | ✓ WIRED | Loads bridge data for ProtectHubTab |

**Wiring:** 7/7 connections verified

## Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| HUB-BRG-01: Single shared LXC | ✓ SATISFIED | provisionBridge() is idempotent, returns existing bridge |
| HUB-BRG-02: Existing template reuse | ✓ SATISFIED | cloneFromTemplate() fast path, raw create fallback |
| HUB-BRG-03: Static IP | ⚠️ DEFERRED | DHCP reservation recommended in UI text, not enforced. Amended decision D-PROV-03 |
| HUB-BRG-04: Resource profile | ✓ SATISFIED | 1024 MB, 2 cores, LimitNOFILE=4096. VAAPI via template |
| HUB-BRG-05: go2rtc bind + editor disabled | ✓ SATISFIED | 0.0.0.0:1984, ui_editor: false |
| HUB-BRG-06: Start/Stop/Restart from UI | ✓ SATISFIED | ProtectHubTab bridgeAction() + 3 API endpoints |
| HUB-BRG-07: Survives host reboot | ✓ SATISFIED | onboot:1 in proxmox.ts createContainer() |
| HUB-BRG-08: Health monitoring | ✓ SATISFIED | scheduler.ts probes :1984/api/streams every 5 min |
| HUB-WIZ-02: Toggle → wizard route | ✓ SATISFIED | ProtectHubTab navigates to /settings/protect-hub/onboarding |
| HUB-WIZ-03: Step 1 Protect connection | ✓ SATISFIED | Wizard calls /api/protect-hub/discover, deep-links to UniFi tab |
| HUB-WIZ-04: Step 2 bridge provision | ✓ SATISFIED | Calls POST /api/protect-hub/bridge/provision with progress UI |

**Requirements:** 10/11 satisfied (HUB-BRG-03 deferred per amended decision)

## Behavioral Verification

| Check | Result | Detail |
|-------|--------|--------|
| Test suite | 271 passed, 12 failed, 1 skipped | All 12 failures are pre-existing (proxmox.test.ts, onboarding.test.ts, backup.test.ts, update-runner.test.ts, proxmox-validate.test.ts). P20 tests all pass. |
| bridge-provision.test.ts | ✓ 9/9 passed | Idempotency, failed cleanup, template/raw paths, IP polling |
| bridge-lifecycle.test.ts | ✓ 12/12 passed | get/start/stop/restart, error handling, state transitions |

## Anti-Pattern Scan

No antipatterns found in P20 files:
- No TODO/FIXME/HACK/XXX markers
- No placeholder content
- No empty returns or log-only functions
- Clean error handling throughout

## Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|-----------|-----------|--------|---------|----------|----------------|---------|
| bridge-provision.test.ts | BRG-01,02,04,05,07, WIZ-04 | 9 | 0 | 0 | Value (specific vmid, status, config strings) | ✓ PASS |
| bridge-lifecycle.test.ts | BRG-06,08 | 12 | 0 | 0 | Value (exact status values, call counts) | ✓ PASS |

**Disabled tests on requirements:** 0
**Circular patterns detected:** 0
**Insufficient assertions:** 0

## Human Verification

This phase has user-facing UI and requires real Proxmox hardware interaction. Plan 20-03 (UAT) is not yet executed.

| Test | What to do | Expected | Why human needed |
|------|-----------|----------|-----------------|
| Wizard flow | Open /settings → Protect Hub tab → click bridge setup → complete Steps 1-2 | Bridge provisions in 30-90s, bridge IP shown | Requires real Proxmox host |
| go2rtc health | `curl http://<bridge-ip>:1984/api/streams` from LAN | Returns streams JSON | Requires running bridge on Proxmox |
| Editor blocked | `curl http://<bridge-ip>:1984/editor.html` | Returns 404 | Security surface verification |
| RTSP stream | `ffprobe rtsp://<bridge-ip>:8554/test` | Stream plays | Real network + go2rtc |
| Host reboot | Reboot Proxmox host | Bridge comes back on same IP within 60s | Physical infrastructure |
| Lifecycle controls | Click Start/Stop/Restart in UI | State reflects within 10s | Real container state changes |
| YAML stamp | `pct exec <vmid> -- cat /etc/go2rtc/go2rtc.yaml` | First line has stamp | Inside real LXC |
| LXC config | `pct config <vmid>` | memory=1024, cores=2, VAAPI mount | Real Proxmox config |
| LAN-trust text | Read Step 2 info panel | Clear security warning visible | Visual/UX judgment |

## Deferred Items

| Item | Deferred To | Evidence |
|------|-------------|---------|
| HUB-BRG-03 static IP enforcement | Amended decision D-PROV-03 | DHCP with reservation recommendation; static IP not enforced in wizard. UI text recommends DHCP reservation. |

## Summary

**Status: human_needed** — All code artifacts exist, are substantive, and are properly wired. P20 tests pass (21/21). No antipatterns. But 9 human verification items remain (Plan 20-03 UAT against real Proxmox hardware). The phase cannot be marked complete without executing Plan 20-03.

**Score:** 7/8 success criteria structurally verified. SC-8 (LAN-trust docs) needs visual confirmation.
