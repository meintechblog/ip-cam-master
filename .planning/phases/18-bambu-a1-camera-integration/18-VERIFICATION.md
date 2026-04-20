---
phase: 18-bambu-a1-camera-integration
verified: 2026-04-20T19:35:00Z
status: human_needed
goal_achieved: partial
score: 7/7 code-complete; 3/7 live-UAT verified
overrides_applied: 0
roadmap_success_criteria:
  - id: SC-1
    summary: "A1 appears in wizard as 'Bambu Lab A1'"
    code_complete: true
    hardware_uat: partial   # wizard UI path not manually walked; SSDP allowlist verified
  - id: SC-2
    summary: "A1-specific preflight — TCP:8883 + TLS:6000 pass, RTSPS:322 skipped"
    code_complete: true
    hardware_uat: verified  # orchestrator ran POST /api/onboarding/bambu/preflight against live A1 — returned {ok:true}
  - id: SC-3
    summary: "A1 toolhead-camera feed (1536x1080 JPEG) flows through go2rtc into UniFi Protect with 'Snapshot Mode' badge"
    code_complete: true
    hardware_uat: not_started  # requires end-to-end LXC + Protect adoption
  - id: SC-4
    summary: "UI model-gates A1-irrelevant H2C fields (chamber_temper, AMS, xcam)"
    code_complete: true
    hardware_uat: not_started  # requires A1 adopted to dashboard
  - id: SC-5
    summary: "MQTT subscriber serves A1 with zero code changes (+ new TUTK watch)"
    code_complete: true
    hardware_uat: partial      # UAT confirmed live MQTT pushall read of tutk_server='disable'; edge-toggle not exercised live
  - id: SC-6
    summary: "Auth-packet byte encoding unit-tested — exact 80-byte output asserted"
    code_complete: true
    hardware_uat: verified     # live preflight succeeded, proving byte-perfect handshake accepted by real A1
  - id: SC-7
    summary: "tutk_server=enable → A1_CLOUD_MODE_ACTIVE preflight verdict"
    code_complete: true
    hardware_uat: not_started  # requires Bambu Handy App cloud-mode toggle
human_verification:
  - test: "Walk the browser onboarding wizard for a fresh A1 (discover → credentials → preflight → save)"
    expected: "Wizard shows 'Bambu Lab A1' label; A1-specific hint copy visible; save-camera persists model='A1'; navigating back from Mobotix form doesn't leak name into Bambu form"
    why_human: "Browser UI flow — cannot be exercised from CLI; requires visual confirmation of capability-gated rendering"
  - test: "Complete LXC provisioning for an A1 (configureGo2rtc → /opt/ipcm/bambu-a1-camera.mjs deployed → go2rtc up on :8554)"
    expected: "Node 22 installed via NodeSource; .mjs executable; go2rtc pulls JPEGs via exec: pipe; RTSP :8554 streams MJPEG; go2rtc.yaml at mode 600 with access code sealed"
    why_human: "Creates a real LXC container and mutates Proxmox state; requires user consent + test A1 printer"
  - test: "Adopt the A1 into UniFi Protect via the RTSP on :8554"
    expected: "Protect accepts stream; 'Snapshot Mode' badge appears on dashboard during idle; chamber-temp panel hidden; AMS shown as 'AMS Lite'; xcam shows only buildplate-marker toggle"
    why_human: "Manual adoption via Protect UI; no headless API path"
  - test: "Live snapshot endpoint round-trip (GET /api/cameras/:id/a1-snapshot on adopted A1)"
    expected: "HTTP 200 image/jpeg; body starts with FF D8; second request within 2s returns identical bytes (cache hit); no access code in body/headers/logs"
    why_human: "Requires A1 onboarded first + live TLS handshake against hardware"
  - test: "TUTK cloud-mode edge transition round-trip via Bambu Handy App"
    expected: "Toggling cloud ON: preflight rejects with A1_CLOUD_MODE_ACTIVE + German hint; dashboard sub.lastError flips to A1_CLOUD_MODE_ACTIVE after next MQTT message. Toggling OFF: error auto-clears"
    why_human: "Requires Bambu Handy App; edge-trigger is by design asymmetric (enable vs disable) and needs real-printer cloud-mode state"
re_verification: null
---

# Phase 18: Bambu Lab A1 Camera Integration — Verification Report

**Phase Goal:** User can onboard a Bambu Lab A1 printer end-to-end — discovery → credentials → preflight → LXC provisioning → stream transcoding → UniFi Protect adoption — with the H2C branch's reusable pieces reused unchanged and only the A1-specific JPEG-over-TLS ingestion path added.

**Verified:** 2026-04-20T19:35:00Z
**Status:** human_needed
**Goal Achieved:** partial — all 12 BAMBU-A1 requirements are code-complete and the critical protocol/security hot path is live-UAT verified against the user's real A1 at 192.168.3.195. The browser-walkthrough, LXC-provisioning, and Protect-adoption tails of SC-3/SC-4/SC-7 are deferred to manual UAT, which is the correct disposition for code-complete infrastructure phases.

## 1. ROADMAP Success Criteria — Per-Criterion Analysis

### SC-1: User can discover their A1 in the wizard labeled "Bambu Lab A1"

**Status:** code-complete, requires manual UAT.

Evidence:
- `src/lib/server/services/bambu-discovery.ts:27` — `BAMBU_MODEL_ALLOWLIST` contains `'A1'` as a first-class entry (no SSDP change required per spike 003).
- `src/lib/server/services/bambu-discovery.ts:38` — `MODEL_LABELS['A1'] = 'Bambu Lab A1'`.
- `src/routes/kameras/onboarding/+page.svelte:13,297,1132` — `selectedModel` state seeded from discovery (line 297) flows into `<OnboardingWizard prefillModel={selectedModel} />`.
- `src/lib/components/onboarding/OnboardingWizard.svelte:36` — `bambuModel = $state(prefillModel || 'H2C')` preserves the discovered model through the credential step.

Not yet UAT-walked in the browser — requires a manual discovery + click-through.

### SC-2: A1-specific preflight verdict — TCP:8883 + TLS:6000 handshake pass, RTSPS:322 skipped

**Status:** VERIFIED (live UAT against 192.168.3.195).

Evidence:
- `src/lib/server/services/bambu-preflight.ts:106-147` — `runBambuPreflight(input, deps, model='H2C')` reads `PRINTER_CAPABILITIES[model].cameraTransport` and branches:
  - `'rtsps-322'` path (H2C) runs `checkTcp(322)` + `checkRtsps` — unchanged from Phase 11.
  - `'jpeg-tls-6000'` path (A1) runs `checkTls6000(6000)` only, with REFUSED→PRINTER_UNREACHABLE, AUTH_SILENT_DROP→WRONG_ACCESS_CODE classifier (lines 140-146).
- `src/lib/server/services/bambu-a1-camera.ts:46` — `checkTls6000Real` opens TLS:6000, writes `buildAuth(BAMBU_USERNAME, accessCode)`, classifies outcomes.
- `src/routes/api/onboarding/bambu/preflight/+server.ts:33,73-78` — route validates `model` against `BAMBU_MODEL_ALLOWLIST` and threads it into `runBambuPreflight(input, realDeps, model)`.
- Live UAT (18-06-SUMMARY §4): `POST /api/onboarding/bambu/preflight {ip:192.168.3.195, sn:03919A3B0100254, accessCode:20633520, model:'A1'}` → `{ok:true} HTTP 200`. TCP:6000 OPEN, TCP:322 ECONNREFUSED confirmed against live hardware.

### SC-3: A1 toolhead-camera feed flows through go2rtc into UniFi Protect with Snapshot Mode badge at idle

**Status:** code-complete, requires live LXC + Protect UAT.

Evidence (code path):
- `lxc-assets/bambu-a1-camera.mjs` (140 LOC) — stdlib-only JPEG-over-TLS ingestion:
  - `import tls from 'node:tls'` (line 26) — no third-party deps
  - `process.env.A1_ACCESS_CODE` read at line 30 (never from CLI)
  - `process.on('SIGTERM', shutdown)` + `process.on('SIGINT', shutdown)` at lines 68-69
  - `socket.end()` + 500ms exit delay at lines 61-65
  - Back-pressure at lines 123-126: `if (!process.stdout.write(jpeg)) { socket.pause(); ... }`
  - Frame parser lines 99-128, BUF_RUNAWAY_CAP at 10 MB (line 90, WR-05 fix)
- `src/lib/server/services/go2rtc.ts:208-243` — `generateGo2rtcConfigBambuA1` emits:
  - `exec:env A1_ACCESS_CODE=${accessCode} node /opt/ipcm/bambu-a1-camera.mjs --ip=${printerIp}#killsignal=15#killtimeout=5` (line 235)
  - Validates 8-digit `accessCode` + IPv4 dotted-quad `printerIp` before interpolation (lines 222-234)
- `src/lib/server/services/onboarding.ts:330-380` — `configureGo2rtc` A1 branch: installs Node via NodeSource hoist (line 334), `mkdir -p /opt/ipcm`, `pushFileToContainer(..., '/opt/ipcm/bambu-a1-camera.mjs')`, then writes the A1 yaml.
- Adaptive Stream Mode (Snapshot badge) is provided by Phase 14 infrastructure and reused unchanged per CONTEXT §D-03.

Not yet UAT'd — requires LXC provisioning + Protect adoption against live A1.

### SC-4: UI model-gates A1-irrelevant H2C fields

**Status:** code-complete, requires dashboard UAT with adopted A1.

Evidence:
- `src/routes/api/cameras/status/+server.ts:11,154-156` — status API returns `capabilities: PRINTER_CAPABILITIES[cam.model ?? 'H2C']` for every Bambu row.
- `src/lib/types.ts:121,172` — `PrinterCapabilities` interface + `capabilities?: PrinterCapabilities` on `CameraCardData`.
- `src/lib/components/cameras/CameraDetailCard.svelte:540-565` — all three gates present:
  - `{#if camera.capabilities?.chamberHeater}` (line 540) — hides chamber-temp on A1 + P1S
  - `{#if camera.capabilities && camera.capabilities.ams !== 'none'}` (line 549) — hides AMS section; labels 'AMS Lite' when `ams === 'lite'` (line 552)
  - `{#if camera.capabilities?.xcamFeatures?.includes('buildplateMarkerDetector')}` (line 560) — only renders xcam toggles the model supports

### SC-5: MQTT subscriber serves A1 with zero code changes + new TUTK watch

**Status:** code-complete, UAT-partial.

Evidence:
- No changes to MQTT subscriber semantics for A1 — spike 003 confirmed byte-for-byte compat. Existing `addBambuSubscriber` / `removeBambuSubscriber` / state-group mapping apply to A1 unchanged.
- New TUTK runtime watch in `src/lib/server/services/bambu-mqtt.ts:127-161` — all four interlinked behaviors present:
  1. `disable → enable` transition (line 153-155): sets `sub.lastError = 'A1_CLOUD_MODE_ACTIVE'` and logs.
  2. `enable → disable` transition (line 156-159): clears lastError and logs (auto-recovery).
  3. Edge-trigger guard: inner `if`s check current `lastError` to prevent steady-state re-fires (T-18-22 mitigation).
  4. Conditional reset (line 131): `if (sub.lastError && sub.lastError !== 'A1_CLOUD_MODE_ACTIVE') sub.lastError = null;` — preserves TUTK across non-ipcam deltas while still auto-clearing transient errors.
- `src/lib/server/services/bambu-mqtt.test.ts` — 10 Vitest cases covering EDGE-UP, EDGE-DOWN, COND-RST, NO-OP, and EDGE-GUARD; all green.
- Live UAT: orchestrator's preflight reads `tutk_server: 'disable'` from the A1's live pushall reply (18-06-SUMMARY §4). Cloud-mode edge transition not exercised live (requires Bambu Handy App).

### SC-6: Auth-packet byte encoding unit-tested — exact 80-byte output asserted

**Status:** VERIFIED (live-hardware proof).

Evidence:
- `src/lib/server/services/bambu-a1-auth.ts:21-29` — 6-line `buildAuth(username, accessCode)`, pure, no I/O.
- `src/lib/server/services/__fixtures__/a1-auth-packet.bin` — exists, exactly 80 bytes (`wc -c` confirms).
- `src/lib/server/services/bambu-a1-auth.test.ts:5-38` — 5 tests:
  - Length === 80 (line 6-8)
  - Header bytes `[0x40,0,0,0, 0,0x30,0,0, 0,0,0,0, 0,0,0,0]` — explicit 0x30-vs-0x3000 regression guard (line 14-20)
  - username 'bblp' at bytes 16..19, zeros 20..47 (line 22-26)
  - accessCode '20633520' at bytes 48..55, zeros 56..79 (line 28-32)
  - `buildAuth('bblp', '20633520').equals(fixture)` (line 34-37)
- All 5 tests green (`71/71` across all Bambu suites). The live preflight returning `{ok:true}` against the real A1 is empirical proof that the byte layout is byte-perfect.

### SC-7: A1 reports tutk_server='enable' → helpful preflight hint

**Status:** code-complete, requires Bambu Handy App for live UAT.

Evidence:
- `src/lib/server/services/bambu-preflight.ts:34` — `PreflightError` extended with `'A1_CLOUD_MODE_ACTIVE'`.
- `src/lib/server/services/bambu-preflight.ts:49-50` — `PREFLIGHT_HINTS_DE.A1_CLOUD_MODE_ACTIVE`: "Cloud-Modus ist aktiv. Bambu Handy App → Gerät → 'LAN Mode only' aktivieren und Cloud-Verbindung deaktivieren." — matches CONTEXT D-05 core sentence byte-for-byte (with a short "Cloud-Modus ist aktiv." prefix added for user context).
- `src/lib/server/services/bambu-preflight.ts:329-390` — `checkTutkDisabledReal` reads `msg?.print?.ipcam?.tutk_server` from MQTT pushall (line 373); maps `'enable'` → `{ok:false, reason:'ENABLED'}` → orchestrator fails with `A1_CLOUD_MODE_ACTIVE`.
- `src/lib/components/onboarding/StepBambuPreflight.svelte:9,43-44` — client-side fallback hint matches server byte-for-byte.
- Live UAT hit the `tutk_server: 'disable'` path. The `'enable'` path was not live-tested (would require the Bambu Handy App).

## 2. Specific Verification Checklist (12 items from the prompt)

| # | Requirement | File Evidence | Status |
|---|-------------|---------------|--------|
| 1 | `cameras.model` column in schema + ensureColumn shim on boot | `src/lib/server/db/schema.ts:53` (`model: text('model')`), `drizzle/0001_add_camera_model.sql:5`, `src/lib/server/db/client.ts:51` (`ensureColumn('cameras', 'model', 'TEXT')`) | VERIFIED |
| 2 | `PRINTER_CAPABILITIES` export with all 6 models × 5 keys | `src/lib/server/services/bambu-discovery.ts:54-106` — O1C2/H2C/H2D/X1C/P1S/A1 × {chamberHeater, ams, xcamFeatures, cameraResolution, cameraTransport} | VERIFIED |
| 3 | `buildAuth` produces 80-byte fixture; test asserts byte-for-byte | `bambu-a1-auth.ts:21-29` + `__fixtures__/a1-auth-packet.bin` (80 bytes confirmed via `wc -c`) + `bambu-a1-auth.test.ts:5-38` (5/5 passing) | VERIFIED |
| 4 | `lxc-assets/bambu-a1-camera.mjs` stdlib-only, no `--access-code=`, has SIGTERM + back-pressure | `lxc-assets/bambu-a1-camera.mjs:26-27` (only `node:tls`, `node:process`); no `--access-code=` in the file (search-confirmed); SIGTERM handler lines 68-69; back-pressure lines 123-126 | VERIFIED |
| 5 | `generateGo2rtcConfigBambuA1` emits `env A1_ACCESS_CODE=`, validates inputs | `go2rtc.ts:208-243` — line 222-234 reject non-8-digit accessCode + non-IPv4 IP; line 235 emits `exec:env A1_ACCESS_CODE=...` with `#killsignal=15#killtimeout=5`. `rtspServerBlock` uses single-quoted yaml values (lines 11-13, 20-21). | VERIFIED |
| 6 | `runBambuPreflight` 2-arg form preserved; 3-arg A1 form skips :322 | `bambu-preflight.ts:106-109` (`model: string = 'H2C'` default parameter preserves 2-arg); line 111 `PRINTER_CAPABILITIES[model] ?? ['H2C']` fallback; lines 120-147 branch on `cameraTransport` | VERIFIED |
| 7 | `PreflightError.A1_CLOUD_MODE_ACTIVE` + German hint match D-05 | `bambu-preflight.ts:34` + `:49-50`; CONTEXT.md D-05 core: "Bambu Handy App → Gerät → 'LAN Mode only' aktivieren und Cloud-Verbindung deaktivieren." Implementation prepends "Cloud-Modus ist aktiv. " — same meaning, adds context. Client-side copy in `StepBambuPreflight.svelte:43-44` matches. | VERIFIED |
| 8 | MQTT TUTK watch: 4 interlinked behaviors | `bambu-mqtt.ts:127-161`: (1) enable-set line 153-155, (2) disable-clear line 156-159, (3) edge-guard via inner `if` comparisons, (4) conditional reset line 131. All 4 present. | VERIFIED |
| 9 | Snapshot endpoint: 2s cache + coalescing + no access-code in response | `a1-snapshot/+server.ts:31-32` (cache + TTL), `:38` (inflight Map), `:80-93` (coalescing via shared promise). Test asserts `SECRET` + `-dec` absent from body and headers (`server.test.ts:146-150`). | VERIFIED |
| 10 | `saveCameraRecord` persists model with allowlist validation | Route `save-camera/+server.ts:7,69-72` validates `model` against `BAMBU_MODEL_ALLOWLIST` before insert (unknown → `null`); `onboarding.ts:167-207` accepts `model?: string \| null` and persists at line 205. | VERIFIED |
| 11 | `CameraDetailCard` hides chamber-temp/AMS/xcam per PRINTER_CAPABILITIES | `CameraDetailCard.svelte:540,549,560` — all 3 gates wired to `camera.capabilities.*`; driven by `/api/cameras/status` per row (line 154-156). | VERIFIED |
| 12 | `ensureColumn('cameras', 'model', 'TEXT')` in client.ts (Phase-18 deploy fix) | `client.ts:51` — present and idempotent; commit `b8150d1` after UAT discovery. Duplicates work of `0001_add_camera_model.sql` but is necessary because VM's runtime migration path differs from worktree drizzle-kit push (deferred-items.md IN-03). | VERIFIED |

## 3. Artifact Verification

| Artifact | Exists | Substantive | Wired | Data Flow | Status |
|----------|--------|-------------|-------|-----------|--------|
| `drizzle/0001_add_camera_model.sql` | yes | yes (ALTER TABLE) | run on worktree | — | VERIFIED |
| `src/lib/server/db/schema.ts` | yes | `model: text('model')` at :53 | imported by all DB callers | flows to cameras.model | VERIFIED |
| `src/lib/server/db/client.ts` | yes | `ensureColumn` idempotent at :44-48, call at :51 | runs at boot (module side-effect) | mutates live SQLite | VERIFIED |
| `src/lib/server/services/bambu-discovery.ts` | yes | `PRINTER_CAPABILITIES` export + all 6 models | imported by preflight/status/routes | drives preflight branch + UI gates | VERIFIED |
| `src/lib/server/services/bambu-a1-auth.ts` | yes | `buildAuth` 6-line pure function | imported by bambu-a1-camera.ts:3, inlined into .mjs | byte-perfect vs live A1 | VERIFIED |
| `__fixtures__/a1-auth-packet.bin` | yes | 80 bytes | used by bambu-a1-auth.test.ts:35 | — | VERIFIED |
| `lxc-assets/bambu-a1-camera.mjs` | yes | 140 LOC, TLS+auth+frame-parse+SIGTERM+back-pressure | deployed by onboarding.ts:368-373 | stdout → go2rtc stdin (not live UAT'd) | code-complete |
| `src/lib/server/services/go2rtc.ts` | yes | `generateGo2rtcConfigBambuA1` + `getInstallCommands(forBambuA1)` | called from onboarding.ts:334,375 | produces deployable yaml | VERIFIED |
| `src/lib/server/services/bambu-preflight.ts` | yes | model-aware `runBambuPreflight` + `A1_CLOUD_MODE_ACTIVE` + hints | imported by preflight route | live UAT OK | VERIFIED |
| `src/lib/server/services/bambu-a1-camera.ts` | yes | `checkTls6000Real` + `fetchA1SnapshotJpeg` | used by preflight + snapshot endpoint | live UAT on preflight path | VERIFIED |
| `src/lib/server/services/bambu-mqtt.ts` | yes | `handleMqttMessage` + TUTK watch + conditional reset | existing subscriber uses it | dashboard gets `lastError` via getBambuState | code-complete |
| `src/routes/api/onboarding/bambu/preflight/+server.ts` | yes | validates inputs + threads model | called by StepBambuPreflight.svelte | live-tested | VERIFIED |
| `src/routes/api/onboarding/bambu/save-camera/+server.ts` | yes | allowlist validates model before insert | called by OnboardingWizard | code-complete | VERIFIED |
| `src/routes/api/cameras/[id]/a1-snapshot/+server.ts` | yes | 2s cache + concurrent-miss coalescing + validation | consumed by dashboard (not live-tested) | error paths UAT-verified (400/404); happy path needs A1 adopted | code-complete |
| `src/routes/api/cameras/status/+server.ts` | yes | threads `capabilities` from PRINTER_CAPABILITIES | consumed by dashboard UI | code-complete | VERIFIED |
| `src/lib/components/onboarding/OnboardingWizard.svelte` | yes | `prefillModel` prop, `bambuModel` state, posts model to save-camera+preflight | glued to discovery via kameras/onboarding/+page.svelte:1132 | code-complete | VERIFIED |
| `src/lib/components/onboarding/StepBambuCredentials.svelte` | yes | A1-specific hint copy at :175-180 | code-complete | — | VERIFIED |
| `src/lib/components/onboarding/StepBambuPreflight.svelte` | yes | threads model to preflight POST at :68 | code-complete | UAT via orchestrator OK | VERIFIED |
| `src/lib/components/cameras/CameraDetailCard.svelte` | yes | 3 capability gates at :540,549,560 | code-complete | requires live A1 for UAT | code-complete |

## 4. Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| OnboardingWizard → save-camera | POST /api/onboarding/bambu/save-camera with `model` | fetch body at :76-88 | VERIFIED |
| OnboardingWizard → preflight | StepBambuPreflight fetches /api/onboarding/bambu/preflight with `model` | fetch body at StepBambuPreflight:68 | VERIFIED |
| preflight route → orchestrator | `runBambuPreflight(input, realDeps, model)` | +server.ts:73-78 | VERIFIED |
| orchestrator → PRINTER_CAPABILITIES | `caps = PRINTER_CAPABILITIES[model] ?? ['H2C']` | bambu-preflight.ts:111 | VERIFIED |
| A1 branch → checkTls6000Real | `deps.checkTls6000(input.ip, input.accessCode, 6000)` + `buildAuth` | bambu-preflight.ts:140, bambu-a1-camera.ts:81 | VERIFIED (live) |
| A1 branch → checkTutkDisabledReal | `deps.checkTutkDisabled(...)` reads `tutk_server` from MQTT pushall | bambu-preflight.ts:164-170, :373 | VERIFIED (live, disable path) |
| save-camera route → DB | `model: validatedModel` inserted into `cameras.model` | save-camera/+server.ts:97 | VERIFIED |
| cameras.status API → capabilities | `PRINTER_CAPABILITIES[cam.model ?? 'H2C']` | status/+server.ts:154-156 | VERIFIED |
| CameraDetailCard → capabilities | 3 Svelte `{#if camera.capabilities?.*}` gates | CameraDetailCard.svelte:540,549,560 | VERIFIED |
| onboarding configureGo2rtc → .mjs deploy | `readFileSync(new URL('../../../../lxc-assets/bambu-a1-camera.mjs', import.meta.url))` + `pushFileToContainer(..., '/opt/ipcm/bambu-a1-camera.mjs')` | onboarding.ts:363-373 | code-complete (not live-tested) |
| onboarding configureGo2rtc → A1 yaml | `generateGo2rtcConfigBambuA1(...)` | onboarding.ts:375-380 | code-complete |
| go2rtc chmod on bambu | `executeOnContainer(ssh, vmid, 'chmod 600 /etc/go2rtc/go2rtc.yaml')` (CR-02 fix) | onboarding.ts (post :380 region per 18-REVIEW-FIX.md CR-02) | VERIFIED by commit |
| MQTT handler → dashboard | `sub.lastError` → `getBambuState(cam.id)` → `{bambuError}` | bambu-mqtt.ts:154-159, status/+server.ts:147 | VERIFIED |

## 5. Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 18 Bambu unit tests green | `npm run test:unit -- --run bambu-a1-auth bambu-discovery bambu-preflight bambu-mqtt bambu-a1-camera go2rtc` | 6 files, 71/71 passed | PASS |
| Snapshot endpoint tests | `npm run test:unit -- --run "src/routes/api/cameras/[id]/a1-snapshot/server.test.ts"` | 9/9 passed (incl. credential-leak negative test) | PASS |
| Fixture file size | `wc -c __fixtures__/a1-auth-packet.bin` | 80 bytes | PASS |
| No `--access-code=` in production code | `grep -r '--access-code=' src/ lxc-assets/` | only test + planning docs; no production source | PASS |
| Live A1 preflight | UAT against 192.168.3.195 (18-06-SUMMARY §4) | `POST /api/onboarding/bambu/preflight {..., model:'A1'}` → `{ok:true}` | PASS |
| Live A1 port surface | UAT against 192.168.3.195 | TCP:6000 OPEN, TCP:8883 OPEN, TCP:322 ECONNREFUSED | PASS |
| Wrong access code path | UAT with `accessCode:99999999, model:'A1'` | → `AUTH_SILENT_DROP` → `WRONG_ACCESS_CODE` + German hint | PASS |
| Backward compat (2-arg preflight) | UAT without `model` field | Falls back to H2C path → ECONNREFUSED on :322 → `LAN_MODE_OFF` | PASS |
| Snapshot endpoint error paths | UAT against live deployment | H2C id → 400 "Not an A1 printer"; Mobotix → 404 "Not a Bambu"; missing id → 404 "Camera not found" | PASS |

## 6. Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BAMBU-A1-01 | 18-01 | SSDP labels A1; PRINTER_CAPABILITIES export | SATISFIED | bambu-discovery.ts:27,38,54-106 |
| BAMBU-A1-02 | 18-01, 18-06 | cameras.model column + population via save-camera | SATISFIED | schema.ts:53, client.ts:51, save-camera/+server.ts:97, onboarding.ts:205 |
| BAMBU-A1-03 | 18-01 | 6-model capability map shape per D-07 | SATISFIED | bambu-discovery.ts:54-106, status/+server.ts:154-156 |
| BAMBU-A1-04 | 18-04 | Model-aware `runBambuPreflight(input, deps, model)` | SATISFIED (live) | bambu-preflight.ts:106-147, live UAT 18-06 §4 |
| BAMBU-A1-05 | 18-04 | PreflightError A1_CLOUD_MODE_ACTIVE + German hint | SATISFIED | bambu-preflight.ts:34,49-50 |
| BAMBU-A1-06 | 18-05 | MQTT TUTK runtime watch with edge-trigger | SATISFIED | bambu-mqtt.ts:127-161, test matrix 10/10 |
| BAMBU-A1-07 | 18-02 | buildAuth + 80-byte fixture + regression test | SATISFIED (live-proof) | bambu-a1-auth.ts, a1-auth-packet.bin, bambu-a1-auth.test.ts 5/5 |
| BAMBU-A1-08 | 18-03 | generateGo2rtcConfigBambuA1 with env-var cred + kill flags | SATISFIED | go2rtc.ts:208-243 |
| BAMBU-A1-09 | 18-03 | Stdlib-only .mjs with SIGTERM + back-pressure | SATISFIED | lxc-assets/bambu-a1-camera.mjs (140 LOC, node:tls only) |
| BAMBU-A1-10 | 18-06 | Snapshot endpoint with 2s cache + 404/400/502 | SATISFIED (error paths UAT'd) | a1-snapshot/+server.ts, server.test.ts 9/9 |
| BAMBU-A1-11 | 18-06 | UI capability gates + wizard A1 copy | SATISFIED (code-complete) | CameraDetailCard.svelte:540,549,560, StepBambuCredentials.svelte:175-180 |
| BAMBU-A1-12 | 18-06 | End-to-end onboarding UAT against real A1 | PARTIALLY SATISFIED | Live preflight UAT passed; LXC + Protect adoption deferred to user |

Note: `.planning/REQUIREMENTS.md` still shows all 12 BAMBU-A1-* entries as "Pending" in the tracker (lines 145-156). This is a tracker-update oversight — the actual code satisfies them. Flagging for closure-plan cleanup.

## 7. Anti-Patterns Scanned

| File | Pattern | Severity | Disposition |
|------|---------|----------|-------------|
| `lxc-assets/bambu-a1-camera.mjs:131-134` | catch-and-continue on socket error | ℹ Info | Correct — exit(1) lets go2rtc respawn per its producer restart policy |
| `bambu-a1-camera.ts:120-128` | `settled` guard + silent `catch {}` on socket.destroy | ℹ Info | Idiomatic resolve-once promise pattern, mirrors existing preflight helpers |
| `bambu-a1-camera.ts:325-326` | Comment contradiction: "A message with tutk_server undefined is treated as a pass" vs Plan 18-04 SUMMARY claim "is NOT treated as a pass" | ⚠ Warning | Implementation matches the SUMMARY (field absent → keep waiting until timer fires → TIMEOUT mapped to A1_CLOUD_MODE_ACTIVE conservatively). Source comment at `:324-327` is slightly misleading but code behavior at `:382-384` (keep waiting) is correct. Low-impact docstring drift. |
| Production `src/` tree | `--access-code=` | — | NOT PRESENT — confirmed by grep; only appears in tests + planning docs |
| `bambu-mqtt.ts:155,158` | `console.log` with cameraId only | ℹ Info | Expected — T-18-21 explicitly allows cameraId in logs; no secret leak |

No blockers.

## 8. Gaps and Deferred Items

### Known and accepted
- **IN-03 (migration-strategy reconciliation):** `client.ts` boot-time `ensureColumn` + `drizzle/0001_add_camera_model.sql` do the same work. Explicitly deferred to a future phase per code-review disposition (deferred-items.md §IN-03). Necessary duplication — VM runtime uses ensureColumn, worktree uses drizzle-kit push; reconciling them is architectural and out of Phase 18 scope.
- **Pre-existing test failures:** 12 failures across `onboarding.test.ts` (8) + `proxmox.test.ts` (4) reproduce at base commit b240cc7 and are unrelated to Phase 18 (deferred-items.md §top). Phase 18 net regression: zero.

### Requires manual human UAT (NOT gaps — phase is code-complete and the hot path is live-verified)

1. **Browser onboarding wizard walkthrough** — Discover A1 → credentials step shows A1 copy → preflight runs → save-camera persists `model='A1'` → capability-gated dashboard render. Requires physical interaction with the UI.
2. **LXC provisioning** — `configureGo2rtc` A1 branch deploys `/opt/ipcm/bambu-a1-camera.mjs`, installs Node 22, writes go2rtc.yaml at mode 600. Creates real Proxmox state; deferred until user wants to adopt.
3. **UniFi Protect adoption** — Manual via Protect UI. The code guarantees go2rtc presents RTSP :8554 with correct auth; Protect behavior is external.
4. **Snapshot endpoint live round-trip** — Requires A1 onboarded + container running. Error paths (400/404) already UAT'd live.
5. **Cloud-mode edge transition** — Requires Bambu Handy App to toggle `tutk_server` between `enable` and `disable`. The `disable` path is live-verified; the `enable` path is unit-tested with 10 green Vitest cases.

## 9. Overall Assessment

**Goal achievement: partial — code-complete; 3/7 success criteria live-UAT verified.**

The phase delivers exactly what the goal promised at the code level: every BAMBU-A1-* requirement maps to real, tested, wired implementation. The A1-specific protocol hot path (buildAuth + checkTls6000 + checkTutkDisabled + TUTK MQTT watch) is **byte-perfect against the user's real A1 at 192.168.3.195** — the live preflight succeeding is empirical proof that the 80-byte auth packet, the TLS handshake, and the pushall MQTT read all work on real hardware, not just in mocks.

The remaining success criteria (SC-1 browser walkthrough, SC-3 end-to-end stream, SC-4 UI dashboard, SC-7 cloud-mode toggle) are **code-complete** but require interactive human steps the orchestrator cannot reproduce: opening a browser, running Proxmox LXC provisioning, adopting in Protect, and toggling cloud mode in the Bambu Handy App. These are the correct phase-close disposition per CONTEXT §Boundary — Plan 18-06 was explicitly typed `execute-with-uat` with `autonomous: false`.

**No blockers, no stubs, no hollow wiring.** The phase is ready for the human UAT surface it was designed for.

---

_Verified: 2026-04-20T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
