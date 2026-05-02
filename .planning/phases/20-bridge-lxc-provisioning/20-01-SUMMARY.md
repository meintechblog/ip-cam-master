---
phase: 20-bridge-lxc-provisioning
plan: 01
requirements: [HUB-BRG-01, HUB-BRG-02, HUB-BRG-03, HUB-BRG-04, HUB-BRG-05, HUB-BRG-06, HUB-BRG-07, HUB-WIZ-04]
key-files:
  - src/lib/server/services/go2rtc.ts
  - src/lib/server/orchestration/protect-hub/bridge-provision.ts
  - src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts
  - src/routes/api/protect-hub/bridge/provision/+server.ts
  - src/routes/api/protect-hub/bridge/status/+server.ts
  - src/routes/api/protect-hub/bridge/start/+server.ts
  - src/routes/api/protect-hub/bridge/stop/+server.ts
  - src/routes/api/protect-hub/bridge/restart/+server.ts
  - src/lib/server/orchestration/protect-hub/bridge-provision.test.ts
  - src/lib/server/orchestration/protect-hub/bridge-lifecycle.test.ts
duration: ~25min
---

# 20-01 SUMMARY — Bridge Provisioning Backend + API Layer

## Task Completion

| Task | Name | Status |
|------|------|--------|
| 01 | generateBridgeConfig() + generateBridgeSystemdUnit() in go2rtc.ts | DONE |
| 02 | bridge-provision.ts + bridge-lifecycle.ts orchestration modules | DONE |
| 03 | 5 API endpoints for bridge operations | DONE |
| 04 | Vitest suites for bridge-provision and bridge-lifecycle | DONE |

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/server/orchestration/protect-hub/bridge-provision.ts` | 186 | provisionBridge() orchestration |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.ts` | 77 | start/stop/restart/status lifecycle |
| `src/routes/api/protect-hub/bridge/provision/+server.ts` | 18 | POST provision endpoint |
| `src/routes/api/protect-hub/bridge/status/+server.ts` | 9 | GET status endpoint |
| `src/routes/api/protect-hub/bridge/start/+server.ts` | 17 | POST start endpoint |
| `src/routes/api/protect-hub/bridge/stop/+server.ts` | 17 | POST stop endpoint |
| `src/routes/api/protect-hub/bridge/restart/+server.ts` | 17 | POST restart endpoint |
| `src/lib/server/orchestration/protect-hub/bridge-provision.test.ts` | 287 | 7 provision tests |
| `src/lib/server/orchestration/protect-hub/bridge-lifecycle.test.ts` | 195 | 13 lifecycle tests |

## Files Modified

| File | Change |
|------|--------|
| `src/lib/server/services/go2rtc.ts` | +46 lines: generateBridgeConfig() + generateBridgeSystemdUnit() |

## Test Results

- **28 tests passed** (20 new + 8 existing catalog tests)
- 0 failures
- `tsc --noEmit` clean
- bridge-provision.test.ts: 7 tests (idempotent return, failed cleanup, template clone, raw create fallback, status=failed on error, IP poll failure, config stamp verification)
- bridge-lifecycle.test.ts: 13 tests (getBridgeStatus null/exists, startBridge no-op/start/error, stopBridge no-op/stop, restartBridge order/error)

## Deviations

1. **cloneFromTemplate() signature**: Plan assumed `cloneFromTemplate({ vmid, hostname })` without `templateVmid`. Actual signature requires `templateVmid` parameter. Adapted the call in `bridge-provision.ts` to pass `templateVmid` from `getTemplateVmid()`.

2. **createTemplateFromContainer() return type**: Plan showed `Promise<void>`, actual returns `Promise<number | null>`. No code change needed (fire-and-forget `.catch()` pattern works for both).

3. **IP poll timeout test**: Uses 60s test timeout since real `setTimeout` runs 15 * 2s = 30s. Could be optimized with fake timers in a future pass.
