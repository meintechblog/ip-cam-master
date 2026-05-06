---
phase: 21
slug: multi-cam-yaml-reconciliation-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `21-RESEARCH.md` §"Validation Architecture" — full per-task map populated post-planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 (already in `package.json`) |
| **Config file** | `/Users/hulki/codex/ip-cam-master/vitest.config.ts` |
| **Quick run command** | `npm test -- src/lib/server/orchestration/protect-hub/` |
| **Full suite command** | `npm test && npm run check` (vitest + svelte-check + tsc) |
| **Estimated runtime** | ~30s quick · ~90s full (incl. type-check) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/lib/server/orchestration/protect-hub/`
- **After every plan wave:** Run `npm test && npm run check`
- **Before `/gsd-verify-work`:** Full suite + `npm run build` must be green
- **Live smoke (manual):** `curl http://192.168.3.139:1984/api/streams` after force-reconcile against bridge vmid 2014
- **Max feedback latency:** ~30 seconds (quick filter)

---

## Per-Task Verification Map

> **Wave 0 status:** every test file below is currently MISSING. Wave 0 plans MUST create the stubs before any green path can run. The planner will populate task IDs into the table below.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| HUB-OUT-01 | enable Loxone-MJPEG output toggles correctly | unit | `vitest run src/routes/api/cameras/\[id\]/outputs/server.test.ts` | ❌ W0 | ⬜ |
| HUB-OUT-02 | yaml-builder emits Loxone-MJPEG ffmpeg form per D-PIPE-02 | unit (golden) | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "loxone"` | ❌ W0 | ⬜ |
| HUB-OUT-03 | yaml-builder emits Frigate-RTSP ffmpeg form per D-PIPE-04 | unit (golden) | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "frigate"` | ❌ W0 | ⬜ |
| HUB-OUT-04 | VAAPI hard cap returns 422 at 7 MJPEG outputs | integration | `vitest run src/routes/api/cameras/\[id\]/outputs/server.test.ts -t "hard cap"` | ❌ W0 | ⬜ |
| HUB-OUT-05 | first-party default ON, third-party default OFF on auto-add | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "auto-add seeds outputs"` | ❌ W0 | ⬜ |
| HUB-OUT-06 | slug = `<mac>-<suffix>`, stable across name edits | unit | `vitest run src/lib/server/orchestration/protect-hub/yaml-builder.test.ts -t "slug stable"` | ❌ W0 | ⬜ |
| HUB-OUT-07 | URLs emitted in YAML are correct format | unit (golden) | covered by yaml-builder.test.ts | ❌ W0 | ⬜ |
| HUB-RCN-01 | scheduler tick fires every 5min when enabled, silent when disabled | unit (fake timers) | `vitest run src/lib/server/services/scheduler.test.ts -t "protect hub"` | ❌ W0 | ⬜ |
| HUB-RCN-02 | PUT /outputs triggers reconcile in-process | unit (mock reconcile) | `vitest run src/routes/api/cameras/\[id\]/outputs/server.test.ts -t "triggers reconcile"` | ❌ W0 | ⬜ |
| HUB-RCN-03 | POST /reconcile returns 202 + reconcileId | unit | `vitest run src/routes/api/protect-hub/reconcile/server.test.ts` | ❌ W0 | ⬜ |
| HUB-RCN-04 | discover() called as Pass 1 of reconcile | unit (mock discover) | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "re-extract URLs"` | ❌ W0 | ⬜ |
| HUB-RCN-05 | identical YAML produces no_op (no SSH push) | unit (mock SSH) | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "no-op skip"` | ❌ W0 | ⬜ |
| HUB-RCN-06 | two simultaneous reconciles serialize via single-flight | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "single-flight"` | ❌ W0 | ⬜ |
| HUB-RCN-07 | WS reconnect uses backoff [5,10,30,60,120,300]s | unit (fake timers) | `vitest run src/lib/server/orchestration/protect-hub/ws-manager.test.ts` | ❌ W0 | ⬜ |
| HUB-RCN-08 | new cam detected → outputs seeded per kind | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "auto-add"` | ❌ W0 | ⬜ |
| HUB-RCN-09 | removed cam → source='external_archived' | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "soft-delete"` | ❌ W0 | ⬜ |
| HUB-RCN-10 | isReconcilerBusy() returns true mid-reconcile, false after | unit | `vitest run src/lib/server/orchestration/protect-hub/reconcile.test.ts -t "busy gate"` | ❌ W0 | ⬜ |
| HUB-OPS-05 | bridge fetch failure 2× → status='unhealthy' + event | unit | `vitest run src/lib/server/services/scheduler.test.ts -t "2-strike threshold"` | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/server/orchestration/protect-hub/yaml-builder.test.ts` — covers HUB-OUT-{02,03,06,07}
- [ ] `src/lib/server/orchestration/protect-hub/reconcile.test.ts` — covers HUB-RCN-{04,05,06,08,09,10} + HUB-OUT-05
- [ ] `src/lib/server/orchestration/protect-hub/ws-manager.test.ts` — covers HUB-RCN-07
- [ ] `src/routes/api/cameras/[id]/outputs/server.test.ts` — covers HUB-OUT-{01,04} + HUB-RCN-02
- [ ] `src/routes/api/protect-hub/reconcile/server.test.ts` — covers HUB-RCN-03
- [ ] Extend `src/lib/server/services/scheduler.test.ts` (or create) — covers HUB-RCN-01 + HUB-OPS-05
- [ ] Add `protectHubReconcileRuns` table to all in-memory test schemas (existing pattern at `bridge-provision.test.ts:90`, `catalog.test.ts:117`)
- [ ] No new test framework installs needed — `vitest@4.1.0` already in deps

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Loxone-MJPEG plays in VLC at 640×360 @ 10 fps with no audio | HUB-OUT-02 (smoke) | Requires Loxone Custom Intercom or VLC against MJPEG endpoint | After enabling Loxone-MJPEG output for one cam, open VLC → `http://192.168.3.139:1984/api/stream.mjpeg?src=<mac-slug>-low`; confirm video plays, `ffprobe` shows 640×360@10 + no audio stream |
| Frigate-RTSP plays with original codec untouched | HUB-OUT-03 (smoke) | Requires VLC/Frigate as RTSP consumer | After enabling Frigate-RTSP output, `ffprobe rtsp://192.168.3.139:8554/<mac-slug>-high`; confirm codec matches Protect's catalog (e.g. HEVC for Carport), no re-encode |
| Force-reconcile completes <5s on 3-cam bridge | HUB-RCN-03 (smoke) | Requires real bridge + 3 enabled cams | `time curl -X POST http://192.168.3.249/api/protect-hub/reconcile`; expect <5s round-trip |
| Self-update returns 409 mid-reconcile | HUB-RCN-10 (smoke) | Race condition; live trigger | While force-reconcile is running, trigger update: expect HTTP 409 + `Retry-After: 60` |
| go2rtc bounces ~1-3s on every YAML deploy (per CR-4) | HUB-RCN-05 (UX hint) | go2rtc has no SIGHUP / file-watch; reload-or-restart falls through to restart | Watch `:1984/api/streams` during a forced reconcile that changes YAML; brief disconnect expected. Documents canonical-hash dedupe (D-RCN-01) is load-bearing for UX |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (populated post-planner)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 test files + 1 schema-extension chore)
- [ ] No watch-mode flags
- [ ] Feedback latency <30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
