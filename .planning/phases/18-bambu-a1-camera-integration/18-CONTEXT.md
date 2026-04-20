# Phase 18: Bambu Lab A1 Camera Integration - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

User can onboard a Bambu Lab A1 printer end-to-end — discovery → credentials → preflight → LXC provisioning → stream transcoding → UniFi Protect adoption — as a fourth `camera_type` branch. Additive on top of the v1.2 H2C branch: SSDP discovery, MQTT LAN control, credentials, go2rtc output, and Protect adoption are reused unchanged. Only the camera-ingestion path diverges: the A1 has no RTSPS:322 and instead exposes a proprietary JPEG-over-TLS stream on port 6000 that we must pull, wrap as MJPEG, and hand to go2rtc.

**Out of scope (explicitly deferred to later phases or backlog):**
- Measuring frame rate during an active A1 print (follow-up UAT)
- Support for other low-spec Bambu models beyond A1 (P1P, A1 mini) — may reuse this branch but not validated
- Cloud-connected A1 streaming (TUTK-relayed). LAN-only per the same constraint as H2C.

</domain>

<decisions>
## Implementation Decisions

### Stream Ingestion Pipeline
- **D-01 (Topology):** go2rtc `exec:` source spawns an A1 ingestion Node script. The script reads the printer's port-6000 JPEG stream and emits raw concatenated JPEGs (each self-delimited with `FF D8`…`FF D9`) on stdout. go2rtc wraps this as MJPEG and re-exposes as RTSP on the existing :8554 (same pattern as Loxone nginx integration, `generateLoxoneGo2rtcYaml` in `src/lib/server/services/go2rtc.ts:111-127`).
  - *Implication for researcher:* verify go2rtc's `exec:` source handles raw concatenated JPEGs without a boundary header, or adjust script to emit `multipart/x-mixed-replace` format.
- **D-02 (Runtime):** The Node ingestion script is deployed into the per-camera LXC container alongside go2rtc, following the one-container-per-camera rule. Deployment mechanism reuses the SSH-based config deploy pattern already used for Mobotix/Loxone (`src/lib/server/services/ssh.ts` + `executeOnContainer`). The script is a small Node single-file (`~150 LOC`, all logic in one .mjs based on spike 004) that requires only `node` in the container (already present for the existing toolchain).

### Idle UX / Adaptive Stream Mode
- **D-03 (Protect stream at idle):** Phase 14 Adaptive Stream Mode applies to A1 identically to H2C. When `print.gcode_state` is in `IDLE_STATES` (`IDLE`, `FINISH`, `FAILED`), go2rtc is stopped via `toggleGo2rtc(vmid, 'stop')` (`bambu-mqtt.ts:43-50`); UniFi Protect shows the existing "offline" badge. During `LIVE_STATES` (`RUNNING`, `PREPARE`, `PAUSE`), go2rtc runs and A1 streams at its native rate (~0.45 fps at idle; expected higher during active print — see deferred UAT).
  - *Rationale:* avoids the "slideshow in Protect" failure mode where 0.45 fps looks broken, and reuses the existing adaptive framework with zero new mode logic.
- **D-04 (Dashboard preview at idle):** Camera detail page exposes a server-side endpoint `GET /api/cameras/:id/a1-snapshot` that performs a single on-demand TLS + auth + first-frame pull from port 6000, returns the JPEG. Label: "Letztes Bild: vor Xs". No continuous LAN traffic to the printer when idle; only when a user opens the detail page.

### Cloud-Mode Guard (TUTK)
- **D-05 (Preflight guard):** Hard preflight check reads `print.ipcam.tutk_server` from the pushall MQTT response. If value is `"enable"`, preflight fails with a new error `A1_CLOUD_MODE_ACTIVE` and a German-language hint: *"Bambu Handy App → Gerät → "LAN Mode only" aktivieren und Cloud-Verbindung deaktivieren."* The LXC is not provisioned until the user disables cloud mode.
  - Error enum extends `PreflightError` in `src/lib/server/services/bambu-preflight.ts:15`.
  - Hint goes into `PREFLIGHT_HINTS_DE` (same file, :25).
- **D-06 (Runtime watch):** `bambu-mqtt.ts` monitors `ipcam.tutk_server` in the delta stream. Transition `disable → enable` sets `sub.lastError = 'A1_CLOUD_MODE_ACTIVE'` (add to `BambuConnectionError` enum at :25-29), dashboard reflects via existing `getBambuState()` path. Transition back to `disable` auto-clears the error (auto-recovery).

### UI Model Gating
- **D-07 (Central capabilities map):** A `PRINTER_CAPABILITIES` export is added to `src/lib/server/services/bambu-discovery.ts` next to `MODEL_LABELS`. Shape:
  ```ts
  export const PRINTER_CAPABILITIES: Record<string, {
    chamberHeater: boolean;
    ams: 'none' | 'lite' | 'full';
    xcamFeatures: readonly string[];
    cameraResolution: '480p' | '1080p' | '4k';
    cameraTransport: 'rtsps-322' | 'jpeg-tls-6000';
  }> = {
    O1C2: { chamberHeater: true, ams: 'full', xcamFeatures: [...], cameraResolution: '1080p', cameraTransport: 'rtsps-322' },
    H2C:  { ... same as O1C2 ... },
    A1:   { chamberHeater: false, ams: 'lite', xcamFeatures: ['buildplateMarkerDetector'], cameraResolution: '1080p', cameraTransport: 'jpeg-tls-6000' },
    X1C:  { ... },
    P1S:  { ... },
    H2D:  { ... },
  };
  ```
  API responses for Bambu cameras return `capabilities` alongside existing fields. Frontend components check `camera.capabilities.chamberHeater` / `.ams !== 'none'` / `.xcamFeatures.includes(...)` instead of hardcoded model checks. Adding a future model = add one map entry, no UI edits.
- **D-08 (Auth-packet regression test):** Vitest unit test in `src/lib/server/services/bambu-a1-camera.test.ts` asserts `buildAuth('bblp', '20633520')` returns a `Buffer` byte-equal to `Buffer.from([0x40,0,0,0, 0,0x30,0,0, 0,0,0,0, 0,0,0,0, ...username padded..., ...code padded...])`. Plus golden fixture `src/lib/server/services/__fixtures__/a1-auth-packet.bin` (80 bytes) committed for visual review. The silent-fail mode documented in spike 004 §2 cannot regress without the test failing.

### Claude's Discretion

The following were not discussed; planner/researcher has flexibility:
- Exact preflight structure: pass `model` param into `runBambuPreflight()` vs. branch internally via SSDP-captured model at call site. Both work; pick the simpler.
- Snapshot endpoint rate limiting / caching: a simple 2-second server-side cache is probably enough; plan can decide.
- Node script deployment mechanics: use the exact same SSH-based deploy pattern the Mobotix/Loxone configs use. Don't reinvent.
- Error-hint German wording polish — iterate in UI review if needed.
- `A1_CLOUD_MODE_ACTIVE` vs `CLOUD_MODE_ACTIVE` naming: if future Bambu models gain A1-style JPEG-over-TLS too (P1P likely), rename to model-agnostic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spike Evidence (live-hardware ground truth — read first)
- `.planning/spikes/MANIFEST.md` — consolidated reuse-vs-new breakdown + sharp edges
- `.planning/spikes/001-a1-port-surface/README.md` — A1 vs H2C port diff
- `.planning/spikes/002-a1-rtsps-native/README.md` — why H2C preflight mis-diagnoses A1
- `.planning/spikes/003-a1-mqtt-lan/README.md` — A1 MQTT schema (including `print.ipcam`)
- `.planning/spikes/003-a1-mqtt-lan/pushall-full.json` — full A1 pushall response, reference for telemetry fields
- `.planning/spikes/004-a1-stream-fallback/README.md` — JPEG-over-TLS protocol (auth bytes, frame format, fps)
- `.planning/spikes/004-a1-stream-fallback/probe.mjs` — working 150-LOC reference client
- `.planning/spikes/004-a1-stream-fallback/frame-001.jpg` — visual proof of working stream

### Prior Phase Artifacts (foundation being extended)
- `.planning/ROADMAP.md` Phase 10–14 — v1.2 Bambu H2C branch definition this phase extends
- `.planning/phases/11-foundation-discovery-credentials-preflight/PLAN-04-wizard-bambu-branch.md` — existing Bambu credential wizard pattern to extend for A1
- `.planning/research/H2C-FIELD-NOTES.md` — H2C ground-truth field notes; A1 diverges at camera transport, matches at MQTT/SSDP/credentials

### Existing Code References (touched by this phase)
- `src/lib/server/services/bambu-discovery.ts:27` — `BAMBU_MODEL_ALLOWLIST` (A1 already present); site of new `PRINTER_CAPABILITIES` map (D-07)
- `src/lib/server/services/bambu-mqtt.ts:14-23` — `LIVE_STATES`/`IDLE_STATES` (reused for A1 per D-03); `BambuConnectionError` enum (:25-29) extended per D-06
- `src/lib/server/services/bambu-mqtt.ts:104-136` — message handler where `ipcam.tutk_server` watch (D-06) attaches
- `src/lib/server/services/bambu-preflight.ts:15` — `PreflightError` enum extended with `A1_CLOUD_MODE_ACTIVE` (D-05)
- `src/lib/server/services/bambu-preflight.ts:25-34` — `PREFLIGHT_HINTS_DE` extended with German hint (D-05)
- `src/lib/server/services/bambu-preflight.ts:57-84` — `runBambuPreflight` needs model-split (skip RTSPS:322 for A1, add TLS:6000 check + TUTK MQTT check)
- `src/lib/server/services/go2rtc.ts:43-62` — Mobotix `exec:`-style pattern the A1 branch mirrors
- `src/lib/server/services/go2rtc.ts:111-127` — Loxone nginx pattern (another reference for the `exec:` topology)
- `src/lib/server/services/go2rtc.ts:146-160` — existing H2C Bambu yaml generator; A1 gets a sibling `generateBambuA1Go2rtcYaml` next to it
- `src/lib/server/services/ssh.ts` + `executeOnContainer` — deploy mechanism for the A1 Node script into the LXC (D-02)
- `src/routes/api/onboarding/bambu/preflight/+server.ts` — preflight route to thread `model` through
- `src/routes/api/cameras/[id]/bambu-state/+server.ts` — pattern for the new `/api/cameras/:id/a1-snapshot` endpoint (D-04)

### External Protocol Reference
- ha-bambulab `pybambu/bambu_client.py` `ChamberImageThread.run()` — authoritative reference for the :6000 auth-packet byte layout. Consulted during spike 004 after an initial encoding bug. Path for downstream check: `https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/bambu_client.py`. Do not add as a runtime dependency — just a protocol citation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (no change needed)
- **`bambu-discovery.ts`**: A1 already in `BAMBU_MODEL_ALLOWLIST` (:27) and `MODEL_LABELS` (:38). SSDP route works for A1 out of the box.
- **`bambu-mqtt.ts` subscriber**: spike 003 confirmed byte-for-byte compatible with A1 — auth, topics, pushall, deltas, state-group mapping. `addBambuSubscriber`/`removeBambuSubscriber` apply directly.
- **`bambu-credentials.ts`**: SN + access code schema identical for A1. `BAMBU_USERNAME = 'bblp'` (:4 or similar) is universal.
- **`go2rtc.ts` RTSP output block**: `rtspServerBlock()` wrapper (:15) applies identically to the A1 branch.
- **`ssh.ts`**: `connectToProxmox()` + `executeOnContainer()` pattern handles deploying the A1 Node script.

### Established Patterns (must mirror)
- **`exec:`-source pattern** — Loxone branch (`go2rtc.ts:111-127`) is the closest parallel for A1. A1 branch follows the same yaml shape, just swapping `http://localhost:8081/mjpg/video.mjpg` for `exec:node /opt/ipcm/bambu-a1-camera.mjs --ip=<ip> --access-code=<code>`.
- **Model-aware preflight** — `runBambuPreflight` in `bambu-preflight.ts:57` is currently H2C-only in its check sequence. Parallels the per-camera-type preflight branching used elsewhere in the wizard.
- **Error taxonomy** — `PreflightError` + `PREFLIGHT_HINTS_DE` + `BambuConnectionError` form a consistent triplet. A1 errors extend all three.

### Integration Points
- SSDP → onboarding wizard (`+server.ts` routes under `src/routes/api/onboarding/bambu/*`) — wizard branches on `PRINTER_CAPABILITIES[model].cameraTransport` to show A1-specific copy ("Toolhead-Kamera, 1080p, Live nur während Druck").
- go2rtc yaml generation → LXC provisioning flow (Phase 12) — new `generateBambuA1Go2rtcYaml` is called instead of `generateBambuGo2rtcYaml` when `model === 'A1'`.
- Dashboard camera detail route — reads `camera.capabilities` and hides panels accordingly.

</code_context>

<specifics>
## Specific Ideas

- User's real A1 at `192.168.3.195` (SN `03919A3B0100254`) is the ground-truth test fixture throughout Phase 18 execution. Credentials live in gitignored `.env.a1`.
- The German-language preflight hint for `A1_CLOUD_MODE_ACTIVE` should match the existing hint tone in `PREFLIGHT_HINTS_DE` — short, actionable, points to the specific setting screen.
- "Snapshot Mode" as a user-visible label is already established for H2C (Phase 14 `always_snapshot` mode). A1 reuses this vocabulary.

</specifics>

<deferred>
## Deferred Ideas

- **FPS during active print** — spike 004 only measured idle (~0.45 fps). Real live-print fps is a follow-up UAT item once the branch is shipped. If ≥ 2 fps, current plan is fine. If < 1 fps, may revisit the ffmpeg frame-padding option as a retrofit.
- **Support for A1 mini / P1P** — likely the same :6000 JPEG-over-TLS protocol, but not validated. Keep the branch model-keyed so adding them later is a capabilities-map entry + allowlist entry, nothing more.
- **FTPS:990 SD-card access on A1** — port is open (spike 001), but no UI feature planned in v1.2 for either H2C or A1. Deferred to a future milestone where gcode upload/queue management is in scope.
- **Peer cert CN-pinning** — spike 004 observed the TLS peer cert `CN = <printer-SN>`. Defense-in-depth against MitM on the LAN. Not critical for LAN-only tool; noted as nice-to-have security hardening.
- **Full snapshot mode (no LXC even)** — For A1-idle-only use cases (user who never actively prints), we could skip LXC provisioning entirely and just use the snapshot endpoint. Architecturally interesting but out of scope for v1.2; users who want "live during print" benefit from the LXC anyway.
- **Renaming `A1_CLOUD_MODE_ACTIVE` to model-agnostic** — if P1P/A1 mini show the same TUTK behavior, rename to `BAMBU_LAN_CAMERA_CLOUD_MODE_ACTIVE` or similar. Revisit when a second model is added.

</deferred>

---

*Phase: 18-bambu-a1-camera-integration*
*Context gathered: 2026-04-20*
