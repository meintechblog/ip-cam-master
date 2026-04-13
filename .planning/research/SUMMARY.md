# Project Research Summary

**Project:** IP-Cam-Master v1.2 — Bambu Lab H2C Kamera-Integration
**Domain:** 3D-printer camera stream ingestion into existing LXC/go2rtc/UniFi Protect pipeline
**Researched:** 2026-04-13
**Confidence:** MEDIUM-HIGH (protocol well-documented; H2C-specific behavior partially extrapolated from X1C/P1S field data)

---

## Executive Summary

The Bambu H2C slots into IP-Cam-Master as a third `camera_type` ("bambu") alongside the existing Mobotix and Loxone adapters. The integration delta is smaller than it first appears: ~80% of the existing pipeline (LXC provisioning, VAAPI passthrough, ONVIF wrapper, UniFi Protect adoption, credential encryption, status polling) is reused without modification. The Bambu-specific work concentrates in four places: a SSDP discovery listener on non-standard UDP ports, a two-field credential form (Access Code + Serial), an `rtsps://` go2rtc config template with TLS-verification disabled, and a pre-flight handshake that surfaces three distinct user-facing error states. One new npm dependency (`mqtt@^5.10`) is added for the LAN MQTT status channel. Everything else is either existing code extended via branching or a new function sitting alongside its Mobotix/Loxone sibling.

The most important architectural decision is that go2rtc must be the **sole RTSPS consumer** of the printer. The H2C's Live555 RTSPS daemon runs on the same control board that drives the toolhead and touchscreen. It enforces a single-connection limit and hangs after ungraceful disconnects — a known failure mode across the entire Bambu lineup, confirmed across multiple independent issue trackers (BambuStudio #4481, ha-bambulab #1627). UniFi Protect must never connect directly to the printer; it always adopts the go2rtc-restreamed RTSP on port 8554. This is already how the Mobotix and Loxone pipelines work, so no architectural change is required — but the rationale must be explicit in both the implementation and the docs.

The single biggest scope decision to resolve before planning begins is Cloud-Auth Fallback. PROJECT.md lists it as a v1.2 target feature. Research recommends dropping it from v1.2 scope entirely: cloud streams use TUTK P2P (not RTSPS), the auth flow requires OAuth + 2FA email + JWT refresh with effectively zero TypeScript library coverage, and the product positioning of IP-Cam-Master is self-hosted LAN-first. The correct response when LAN Mode Liveview cannot be enabled is a clear onboarding error, not a fallback to a cloud transport. If cloud mode is ever needed, it belongs in v1.3 behind a `BambuTransport` interface stub added now.

---

## Key Findings

### Recommended Stack

The v1.2 stack is a minimal delta on the existing v1.1 stack. The only new runtime dependency is `mqtt@^5.10` — the de-facto Node.js MQTT client (8M+ weekly downloads), pure JS, no native bindings, supports `rejectUnauthorized: false` for the printer's self-signed cert on port 8883. All other integration points reuse already-installed binaries and existing npm packages.

The `bambu-node` npm package was evaluated and rejected as a direct dependency: last published ~12 months ago, no 1.0 release, handful of dependents. Instead, vendor its TypeScript message-type definitions into `src/lib/bambu/types.ts` and implement the ~5 needed MQTT message handlers directly using plain `mqtt`. This is the same discipline applied to Mobotix/Loxone in v1.0 and avoids introducing an unmaintained library into a production dependency chain.

**Core technology additions:**

- `mqtt@5.10+`: LAN MQTT client over TLS to printer port 8883 — replaces `bambu-node`; plain MQTT protocol is small enough to implement directly with vendored types
- `rtspx://` URL scheme in go2rtc config: RTSPS with TLS verification skipped — Bambu's self-signed cert has no SAN matching any hostname or IP, so standard `rtsps://` with cert validation always fails at handshake
- Custom UDP SSDP listener on ports 1990/2021 via `node:dgram`: Bambu's non-standard discovery broadcast — standard `node-ssdp` targets port 1900 and cannot be used without forking
- `ffmpeg -g 20 -bsf:v h264_metadata=aud=insert`: Force keyframe interval and AUD insertion in go2rtc transcode — required for UniFi Protect to accept the re-muxed H.264 stream without garbled frames

**CORRECTION — PROJECT.MD discovery assumption:** PROJECT.md states discovery will use mDNS `_bambulab._tcp`. Research confirms this service record does not exist on Bambu printers. The actual discovery mechanism is SSDP-variant UDP broadcasts on ports 1990/2021 with service type `urn:bambulab-com:device:3dprinter:1`. Update PROJECT.md, onboarding copy, and implementation accordingly. Do not add a `bonjour-service` or `multicast-dns` dependency.

### Expected Features

**Must have (table stakes) — ship in v1.2:**

- SSDP discovery on UDP 2021 with manual-IP fallback for cross-VLAN setups
- Onboarding form: Access Code (8-digit, masked) + Serial Number — both required, both encrypted via existing AES-256-GCM store
- Pre-flight RTSPS handshake before LXC provisioning with three distinct error states: "Wrong Access Code", "Enable LAN Mode Liveview on printer", "Check IP/network"
- go2rtc YAML template with `rtspx://` or `-tls_verify 0`, `-rtsp_transport tcp`, `-reconnect 1`, keyframe forcing (`-g 20`) and AUD insertion
- `#video=copy` passthrough for HQ stream (H.264 already — saves CPU/VAAPI); VAAPI re-encode only for LQ downscale if Protect rejects the passthrough
- TCP probe to port 322 for health polling — never open the RTSPS stream for health checks (steals the connection slot from go2rtc)
- Documentation: how to find the Access Code on the H2C screen, how to enable LAN Mode Liveview, Bambu Studio trade-off warning

**Should have (differentiators) — cheap enough to include in v1.2:**

- Auto-detect H2C model name from SSDP payload (one-line lookup table) — surfaces "Bambu Lab H2C" in the dashboard instead of "Unknown printer"
- **Adaptive Stream Mode** (user-proposed): Connect go2rtc to the printer's RTSPS only during active print; fall back to TCP port-322 probe + one snapshot per minute (via ffmpeg single-frame grab) during idle. This directly addresses the Live555 stability concern: 24/7 Protect pulls become safe by design because go2rtc disconnects when the printer is idle. The same LXC and go2rtc instance handles both modes — only the stream source URL is toggled via go2rtc's API. Implement as a toggleable option per camera, off by default. Requires MQTT status subscription to know print state. **Flagged as recommended differentiator for the roadmap.**
- Polish on the "LAN Mode Liveview is OFF" error state: link to the printer's web UI and display step-by-step screenshot in the onboarding wizard

**Defer to v1.3+:**

- Bird's Eye Camera as a second adoptable stream (`/streaming/live/2` — unconfirmed on H2C)
- "Test Stream" preview button (ffmpeg single-frame grab served to browser)
- P1S/A1/X1C support (protocol identical, test matrix different)
- Cloud-Auth Fallback — see scope decision below

**SCOPE DECISION — Cloud-Auth Fallback:** PROJECT.md v1.2 target includes "Cloud-Auth als Fallback". Research recommendation: **drop from v1.2 scope.** Cloud mode requires (a) Bambu account REST auth + 2FA email code + JWT refresh, (b) TUTK P2P transport (not RTSPS — entirely different video path), (c) TypeScript library coverage is effectively zero. This is a 5-10x complexity multiplier for a use-case that contradicts the product's LAN-first value proposition. If the user's printer cannot have LAN Mode Liveview enabled, it cannot be supported in v1.2. Add a `BambuTransport: 'lan' | 'cloud'` stub to the schema now so the door is open for v1.3 without a migration.

### Architecture Approach

The Bambu integration is purely additive to the existing type-branching architecture. `camera_type` is already a first-class column in the `cameras` table and is branched in `onboarding.ts` and `go2rtc.ts`. Adding `'bambu'` means: extending the type union in `src/lib/types.ts`, adding SSDP detection to the discovery bash script, adding `testBambuConnection` alongside `testMobotixConnection`, adding `generateGo2rtcConfigBambu` alongside `generateGo2rtcConfigLoxone`, skipping `configureNginx` for the Bambu branch (go2rtc speaks RTSPS natively — no auth-stripping proxy needed), and adding a Bambu credential step component to the wizard router. No new service layer modules are strictly required, though a `src/lib/server/services/bambu.ts` extraction is recommended if Bambu-specific logic crosses ~50 LOC across files.

**Schema decision (open):** Option A (zero-migration) — store Access Code as `password`, hardcode `username='bblp'`, store Serial in a `settings` row. Option B (clean) — add nullable `serialNumber`, `accessCode`, `authMode` columns via Drizzle migration. Since Cloud-Auth is deferred, Option A is acceptable for v1.2. Lock this in Phase 1 plan.

**Major components touched:**

1. `src/routes/api/discovery/+server.ts` — add SSDP probe (bash or `node:dgram`) + `'bambu'` to type enum
2. `src/lib/server/services/go2rtc.ts` — add `generateGo2rtcConfigBambu()` with `rtspx://` template, `-g 20`, AUD insertion, TCP transport
3. `src/lib/server/services/onboarding.ts` — add `testBambuConnection()`, branch in `configureGo2rtc`, skip `configureNginx` for Bambu, reuse `configureOnvif` with no-audio flag
4. `src/routes/kameras/onboarding/` — new Bambu credential step component (Access Code + optional Serial)
5. `src/lib/bambu/` (new module) — `lan-client.ts` (MQTT over TLS), `types.ts` (vendored from bambu-node), `go2rtc-template.ts`

### Critical Pitfalls

1. **Live555 hang + single-connection limit (USER-FLAGGED: "Can H2C handle 24/7 Protect pulls?")** — Answer: probably, but fragile. Long-lived RTSPS connections that disconnect ungracefully cause the Live555 server to hang and refuse all further connections, including Bambu Studio, requiring a printer power-cycle (BambuStudio #4481). Mitigation: go2rtc must be the sole RTSPS consumer; Protect adopts go2rtc's restream at port 8554, never the printer directly. Configure generous reconnect backoff. Optionally implement Adaptive Stream Mode to disconnect go2rtc during idle. Surface "RTSPS server unresponsive — power-cycle printer" as a distinct dashboard error.

2. **TLS certificate validation breaks stream** — Bambu's self-signed cert has no SAN matching any hostname or IP. `rtsps://h2c.local:322` always fails at TLS handshake. Always resolve to IP before writing the go2rtc config; use `rtspx://` scheme or `-tls_verify 0`. Never store a hostname in the saved config.

3. **Firmware updates silently disable LAN access** — January 2025 "Authorization Control" firmware broke every third-party tool for weeks. Mitigations: checklist in onboarding wizard (LAN Mode ON, Developer Mode ON, Access Code visible), detect "stream stopped / printer still pingable" as probable firmware regression, recommend users disable auto-update on adopted printers.

4. **Access Code rotation = silent stream death** — Code can be rotated at any time; rotates on Bambu account sign-out. Distinguish "TCP :322 unreachable (LAN Mode off)" from "TCP :322 reachable but auth fails (code rotated)". Provide inline "Update Access Code" action that re-encrypts and re-deploys go2rtc config in one click — no re-onboarding.

5. **H2C is newer than the ecosystem** — ha-bambulab #1705 tracks H2C support as incomplete; H2D has open camera bug #1378. RTSPS path, TLS behavior, and SSDP service type all need verification on the user's actual H2C before implementation is locked. Phase 0 validation spike is mandatory.

6. **go2rtc passthrough causes garbled frames in Protect** — Protect's parser requires keyframes at predictable intervals and AUD NAL units. Force `-g 20 -bsf:v h264_metadata=aud=insert` in the ffmpeg transcode. Start with `#video=copy` and treat Protect rejection as the signal to switch to VAAPI re-encode.

---

## Implications for Roadmap

Based on combined research, the dependency graph dictates a 5-phase structure with an explicit Phase 0 validation spike.

### Phase 0: H2C Hardware Validation Spike
**Rationale:** The H2C is new enough that core assumptions (RTSPS path, TLS behavior, SSDP service type, MQTT topics) cannot be taken as given from X1C/P1S field reports. This spike must run against the user's actual printer before any implementation is committed.
**Delivers:** Confirmed RTSPS URL path, TLS behavior, SSDP USN format, MQTT topic structure — or corrections that feed back into Phases 1-3.
**Avoids:** Pitfall 8 (H2C newness), prevents designing against X1C assumptions that don't hold on H2C.
**Research flag:** Cannot be addressed by further desk research. Requires physical hardware access.

### Phase 1: Foundation — Discovery, Credentials, Pre-flight
**Rationale:** Everything downstream depends on correct device identification and credential handling. Discovery must be in place before the wizard can route to Bambu-specific steps. Credential storage must be decided before go2rtc config generation can reference the right fields. Pre-flight validates credentials before an LXC slot is consumed.
**Delivers:** SSDP scanner extension, manual-IP fallback, Access Code + Serial form wired to existing AES-256-GCM store, `testBambuConnection()` with three distinct error states, Bambu type added to all enums.
**Addresses:** SSDP discovery, manual-IP fallback, credential form, pre-flight handshake, encrypt at rest, firmware/LAN Mode checklist in wizard.
**Avoids:** Pitfalls 4 (access code rotation UX), 5 (discovery false positives / MQTT confirmation gate), 10 (plaintext credentials).

### Phase 2: Stream Pipeline — go2rtc Config + LXC Template
**Rationale:** Core value of the milestone. All TLS, keyframe, reconnect, and single-connection gotchas must be handled here. Gate on Phase 0 confirming the RTSPS URL and TLS behavior.
**Delivers:** `generateGo2rtcConfigBambu()` with `rtspx://` / `-tls_verify 0`, `-rtsp_transport tcp`, `-g 20`, AUD insertion, reconnect flags; Bambu branch in `configureGo2rtc`; nginx skipped; VAAPI re-encode as fallback; LXC template reuse from Mobotix.
**Uses:** go2rtc `rtspx://` scheme; ffmpeg `-g 20 -bsf:v h264_metadata=aud=insert`; existing Mobotix LXC template (VAAPI passthrough included).
**Avoids:** Pitfalls 1 (go2rtc as sole consumer), 2 (TLS cert mismatch), 6 (garbled Protect frames), 12 (VAAPI re-implementation).
**Research flag:** `#video=copy` vs forced re-encode must be validated against real Protect adoption in this phase — treat Protect rejection as the gate condition.

### Phase 3: UniFi Protect Adoption + Status + Dashboard Errors
**Rationale:** Adoption is straightforward (existing module, no changes) but must be verified end-to-end with the Bambu stream source. Dashboard error taxonomy for Bambu-specific failure modes is new work and belongs here before the UI polish phase.
**Delivers:** End-to-end verified (discovered printer → LXC → go2rtc → adopted in Protect); TCP :322 health probe in status poller (never open RTSPS stream for health); RTSPS hang vs auth fail vs port-closed error differentiation; inline "Update Access Code" action.
**Avoids:** Pitfall 1 (polling steals connection slot), Pitfall 4 (silent auth failure), Pitfall 9 (document Bambu Studio trade-off).

### Phase 4: Wizard UI Polish + Adaptive Stream Mode
**Rationale:** UI work sits on top of the functional pipeline. Adaptive Stream Mode requires MQTT status subscription (Phase 1) and go2rtc config toggling (Phase 2) — cannot be built until both are solid.
**Delivers:** Bambu credential step component in wizard; SSDP model-name display ("Bambu Lab H2C"); polished "LAN Mode Liveview OFF" error with screenshot; Adaptive Stream Mode toggle (live RTSPS during active print, snapshot polling 1/min otherwise) as per-camera setting, off by default.
**Addresses:** Auto-detect H2C model variant, "LAN Liveview OFF" diagnostic UI, Adaptive Stream Mode differentiator.
**Avoids:** Pitfall 1 (Adaptive Stream Mode is the structural solution to 24/7 stability).
**Research flag:** MQTT print-state topic and payload structure must be confirmed (Phase 0 / ha-bambulab `pybambu` source) before implementing the mode-switch logic.

### Phase 5: Docs + Installer
**Rationale:** Documentation for LAN Mode setup, Access Code retrieval, firmware freeze recommendation, and Bambu Studio trade-off is required for external users of the one-line installer. ToS framing must be careful.
**Delivers:** README section "Bambu Lab H2C Setup", onboarding wizard help text + screenshots, "disable auto-update" recommendation, known-good firmware version pin.
**Avoids:** Pitfalls 3 (firmware regression — document and warn), 9 (Bambu Studio conflict), 11 (ToS framing: "uses documented LAN Mode RTSPS endpoint", not "bypasses Bambu security").

### Phase Ordering Rationale

- Phase 0 before everything: H2C is new enough that a wrong assumption (different RTSPS path, different SSDP type) discovered after Phase 1-2 are built would require backtracking across multiple files.
- Phase 1 before Phase 2: Schema/credential decisions gate the go2rtc template (needs to know which field holds the access code).
- Phase 2 before Phase 3: Protect adoption requires a working go2rtc stream to adopt.
- Phase 4 after Phase 1+2: Adaptive Stream Mode requires both MQTT subscription and go2rtc config toggling.
- Phase 5 last: docs written once implementation is stable.

### Research Flags

Phases needing deeper research or hardware validation during planning:

- **Phase 0:** Hardware validation spike — desk research cannot resolve H2C-specific RTSPS path, SSDP service type string, and MQTT topic format. Must run against user's physical H2C.
- **Phase 2:** `#video=copy` vs forced VAAPI re-encode — must be validated against real UniFi Protect adoption, not theoretical.
- **Phase 4 (Adaptive Stream Mode):** MQTT print-state field names — verify against ha-bambulab `pybambu` source or real MQTT capture before implementing mode-switch logic.

Phases with standard patterns (can skip research-phase):

- **Phase 1 (credentials):** AES-256-GCM store is unchanged; Drizzle schema extension is a one-migration add. Well-understood.
- **Phase 3 (Protect adoption):** Existing module handles this; only Bambu-specific work is dashboard error taxonomy, which is straightforward branching.
- **Phase 5 (docs):** No technical uncertainty; content is known from research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | One new dep (`mqtt`), all others existing. `rtspx://` / `-tls_verify 0` pattern confirmed by multiple independent community sources. |
| Features | MEDIUM-HIGH | Table stakes well-defined from official Bambu docs + HA integration. H2C-specific behavior (secondary stream path, quad-cam quirks) extrapolated from X1C/H2D — verify in Phase 0. |
| Architecture | HIGH | Fit into existing type-branching architecture clear and verified against actual source files. Credential Option A vs B is the only open design choice. |
| Pitfalls | MEDIUM-HIGH | Live555 fragility, TLS cert issue, firmware regression, access code rotation — all confirmed across multiple independent issue trackers. H2C-specific severity may differ; H2C is newer and less field-tested. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **H2C RTSPS path:** `/streaming/live/1` assumed from X1C/P1S; unconfirmed on H2C. Resolve in Phase 0 spike.
- **SSDP service type on H2C firmware:** `urn:bambulab-com:device:3dprinter:1` confirmed on P1S; assume same for H2C but verify in Phase 0.
- **`#video=copy` Protect compatibility:** Cannot determine without live testing. Phase 2 gate condition.
- **MQTT print-state field names:** Needed for Adaptive Stream Mode. Cross-reference ha-bambulab `pybambu` source and confirm against real H2C MQTT capture.
- **Bird's Eye Camera secondary path:** `/streaming/live/2` reported for compatible models; unconfirmed on H2C. Defer to v1.3.
- **Schema decision (Option A vs B):** Recommend Option A (zero-migration) for v1.2 since Cloud-Auth is deferred. Lock in Phase 1 plan.
- **Cloud-Auth scope decision:** Must be explicitly confirmed with user before planning begins. Research recommendation is to drop from v1.2 and add `BambuTransport` stub only.

---

## Sources

### Primary (HIGH confidence — official Bambu documentation)

- [Bambu Wiki — Printer Network Ports](https://wiki.bambulab.com/en/general/printer-network-ports) — port 322 RTSPS, 8883 MQTTS, 1990/2021 SSDP confirmed
- [Bambu Wiki — Streaming video / virtual camera](https://wiki.bambulab.com/en/software/bambu-studio/virtual-camera) — official RTSPS URL format, concurrent access rules
- [Bambu Wiki — Live View Troubleshooting](https://wiki.bambulab.com/en/software/bambu-studio/faq/live-view) — LAN Mode Liveview toggle requirement, H2D/H2S/H2C grouped together
- [Bambu Blog — Authorization Control System](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/) — video access confirmed permitted under current firmware
- [Bambu Wiki — Third-party Integration](https://wiki.bambulab.com/en/software/third-party-integration) — official sanction of LAN MQTT access

### Primary (HIGH confidence — verified issue trackers)

- [BambuStudio #4481](https://github.com/bambulab/BambuStudio/issues/4481) — Live555 hang after ungraceful disconnect, requires power-cycle
- [ha-bambulab #1627](https://github.com/greghesp/ha-bambulab/issues/1627) — single-connection limit confirmed, go2rtc-as-sole-consumer pattern recommended
- [ha-bambulab #1798](https://github.com/greghesp/ha-bambulab/issues/1798) — TLS cert hostname validation failure, IP-only workaround
- [ha-bambulab #1705](https://github.com/greghesp/ha-bambulab/issues/1705) — H2C not yet fully supported in ha-bambulab
- [ha-bambulab #221](https://github.com/greghesp/ha-bambulab/issues/221) — LAN Mode liveview drops 1-3s after connect, firmware-induced
- [Hackaday — Authorization Control analysis](https://hackaday.com/2025/01/17/new-bambu-lab-firmware-update-adds-mandatory-authorization-control-system/) — firmware regression history and community impact

### Secondary (MEDIUM confidence — community implementations)

- [psychoticbeef/BambuLabOrcaSlicerDiscovery](https://github.com/psychoticbeef/BambuLabOrcaSlicerDiscovery) — SSDP ports 1990/2021 and service URN `urn:bambulab-com:device:3dprinter:1`
- [TomWis97/bs-lan-discovery](https://github.com/TomWis97/bs-lan-discovery) — SSDP non-standard port behavior, VLAN issues
- [synman/bambu-go2rtc](https://github.com/synman/bambu-go2rtc) — proven go2rtc integration pattern, ffmpeg flag reference
- [Frigate discussion #19832](https://github.com/blakeblackshear/frigate/discussions/19832) — garbled stream debugging, `-rtsp_transport tcp`, audio strip
- [greghesp/ha-bambulab](https://github.com/greghesp/ha-bambulab) — protocol reference (Python, authoritative on MQTT message schema)
- [bambu-node GitHub (THE-SIMPLE-MARK)](https://github.com/THE-SIMPLE-MARK/bambu-node) — TypeScript message type reference (vendor types only, do not depend on)
- [mqtt npm](https://www.npmjs.com/package/mqtt) — v5.x, recommended MQTT client
- [WolfWithSword — X1C camera in HA](https://www.wolfwithsword.com/bambulabs-x1c-camera-in-home-assistant/) — RTSPS URL format, LAN Mode Liveview gotcha
- [Bambu forum — Access Code rotation](https://forum.bambulab.com/t/access-code-always-needs-to-be-re-entered/82201) — rotation frequency and trigger conditions

---
*Research completed: 2026-04-13*
*Ready for roadmap: yes — pending Cloud-Auth scope decision from user*
