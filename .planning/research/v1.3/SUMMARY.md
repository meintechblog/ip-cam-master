# v1.3 Protect Stream Hub — Research Synthesis

**Project:** ip-cam-master
**Milestone:** v1.3 (Protect Stream Hub: Loxone + Frigate-ready)
**Domain:** UniFi Protect → external-consumer stream bridge (Loxone-MJPEG + Frigate-RTSP), built atop the existing per-cam-LXC product
**Researched:** 2026-04-30
**Confidence:** HIGH on stack & architecture (codebase-grounded, lib source verified); MEDIUM on a handful of pitfalls and one Loxone-side detail (flagged below)

**Source files:**
- `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` (all in `.planning/research/v1.3/`)
- `PROJECT.md` (mid-research updates: lifecycle first-class; first-party vs third-party cam classification)

---

## Executive Summary

v1.3 adds a *reverse-direction* capability on top of the v1.0–v1.2 product: cameras already adopted in UniFi Protect are catalogued, then re-served outward via **one shared go2rtc bridge LXC** as Loxone-friendly MJPEG and Frigate-friendly RTSP streams. The pattern is well-established (Frigate↔Frigate via go2rtc is the canonical reference); the meintechblog 2025-11-07 post is the user's own validated working recipe for the Loxone path. There are **no architectural surprises** — the milestone is mostly a new orchestration folder (`protect-hub/`) layered over existing primitives (`proxmox.ts`, `ssh.ts`, `protect.ts`, the Drizzle/SQLite store, the SvelteKit settings UI).

The recommended stack delta is **two npm packages**: `unifi-protect@^4.29.0` (typed Protect client with `enableRtsp()` and `bootstrap.cameras[].channels[]`) and `yaml@^2.6.0` (clean stringify/parse for the multi-stream go2rtc.yaml). Everything else is unchanged. The bridge is a normal LXC built from the existing template (Debian 13 + `/dev/dri` passthrough + intel-media-va-driver), provisioned via the existing `createContainer()`. No new ORM, no new SSH lib, no new HTTP client.

The risk concentration is in **lifecycle correctness, not raw integration**. Five things that will bite us: (1) the **camera identity PK** (research files disagree — see Conflict #1; recommendation: **MAC-as-PK**), (2) **token rotation** — Protect's Share-Livestream tokens rotate on every UDM reboot, so URLs must be re-extracted from `bootstrap` every reconcile pass and never cached, (3) **VAAPI saturation** on the bridge above ~6 concurrent transcodes, (4) **wizard interruption** without a state machine produces orphan LXCs and half-populated DB rows, and (5) **YAML drift** if anyone (including go2rtc itself) writes the file outside our reconciler — mitigated with a `# managed by ip-cam-master` stamp + canonical-form hashing + binding go2rtc's API to localhost. None of these are unsolved problems; all five must be designed in from Phase 19, not bolted on later.

---

## Conflicts Requiring User Resolution Before Phase 19

### Conflict 1: Camera identity PK — `externalId` (Protect UUID) vs `mac`

| Source | Position | Reasoning |
|---|---|---|
| ARCHITECTURE.md §1.1 | `externalId` (Protect UUID) | "IPs change, names get edited, MAC changes on adoption-reset — UUID does not" (no source cited) |
| PITFALLS.md Pitfall #2 | `mac` (lowercased, normalized) | "Protect's `id` is mutable across backup/restore, re-adoption, name edits. MAC is stable. Confirmed by Protect filesystem layout `/src/unifi-protect/video/<MAC>/`" + UI Help docs |

**Recommendation: MAC-as-PK.** PITFALLS is backed by the [UI Help: Migrating Cameras Between NVRs](https://help.ui.com/hc/en-us/articles/19118654419607) doc confirming MAC-keyed video storage; ARCHITECTURE's claim has no cited source.

- Add `mac TEXT NOT NULL` to `cameras` for `source='external'` rows; lowercased, no separators.
- Treat `externalId` (Protect UUID) as **denormalized cache field** — refresh per reconcile, never join on it.
- Reconciliation builds `Map<mac, ProtectCamera>` from `bootstrap`; user toggles survive Protect backup/restore and re-adoption.
- **Schema-irreversible** without painful migration — lock before P19 commits any schema code.

### Conflict 2: Phase decomposition — 5 vs 3 vs 4

ARCHITECTURE proposes 5 phases (P19–P23); FEATURES suggests 3 clusters; PITFALLS implicitly maps across 4.

**Recommendation: 5 phases (P19–P23) per ARCHITECTURE.** Cleanest dependency arrows, each phase ships standalone value, aligns with file-touch matrix and existing v1.x cadence.

---

## Locked-Early Decisions for v1.3 (30 items)

| # | Decision | Locked Choice | Rationale |
|---|---|---|---|
| L-1 | Camera identity PK | **MAC** (lowercased, no separators); `externalId` denormalized | Conflict #1 → PITFALLS #2 wins |
| L-2 | Discriminator strategy | Single `cameras` table with `source TEXT DEFAULT 'managed'` + nullable container columns | ARCH §1.1 |
| L-3 | Bridge container storage | New `protect_hub_bridges` table, NOT existing `containers` | ARCH §1.2 |
| L-4 | Output storage | Table `camera_outputs`, not JSON | ARCH §1.2 |
| L-5 | Reconcile cadence | 5 minutes + event-driven force-reconcile | ARCH §2.1 |
| L-6 | Reconcile placement | Dedicated scheduler tick, NOT bolted on 60s SSH log scan | ARCH §2.1 |
| L-7 | Deploy strategy | Full-rewrite YAML + canonical-form sha256 dedupe | PITFALLS #5, #11 |
| L-8 | YAML stamp | `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>`; foreign stamp = warn, don't auto-overwrite | PITFALLS #5 |
| L-9 | go2rtc API binding | `api: { listen: "127.0.0.1:1984" }` + `ui_editor: false` inside LXC | PITFALLS #5, #11, #15 |
| L-10 | Protect RTSP scheme | `rtspx://` (or `tls_verify=0`) | PITFALLS #8 |
| L-11 | Protect URLs in YAML | Re-extracted from bootstrap every reconcile, never cached | PITFALLS #1 |
| L-12 | WebSocket reconnect | Exponential backoff 5s → 5min cap, single-flight, full bootstrap on reconnect | PITFALLS #3 |
| L-13 | Reconciler concurrency | Module-scoped single-flight Promise + dirty-flag retry; per-bridge mutex | PITFALLS #6 |
| L-14 | Self-update vs reconcile | Self-update returns 409 if `reconciler.busy`; SIGTERM grace 30s; YAML via tmp+mv | PITFALLS #13 |
| L-15 | Wizard state | No DB persistence of wizard state; permanent tables written incrementally; `hub_onboarding_state` step-pointer only | ARCH §5.1 + PITFALLS #9 |
| L-16 | Wizard placement | Dedicated route `/settings/protect-hub/onboarding`, NOT modal | ARCH §4.3 |
| L-17 | Hub feature gate | `settings.protect_hub_enabled` becomes true ONLY after Step 6 completes | PITFALLS #9 |
| L-18 | Toggle state machine | `hub_state ENUM('disabled', 'starting', 'enabled', 'stopping', 'error')` | PITFALLS #12 |
| L-19 | Default offboarding | 3-tier dialog: (a) Pause / (b) Disable+Keep (default) / (c) Full uninstall (type-DELETE) | FEATURES §4c |
| L-20 | Soft-delete | `cameras.source = 'external_archived'`, NEVER DELETE; 7-day grace | ARCH §5.2 |
| L-21 | Protect-side share cleanup | Track `share_enabled_by_us`; offboarding sub-toggle (default OFF) ONLY offers channels we enabled | FEAT §6 + PITFALLS #10 |
| L-22 | URL stability | Slug = `<cam-mac-slug>-<output-suffix>`, derived from MAC | FEAT §5 + L-1 |
| L-23 | Stream URL auth | None — LAN-trust-boundary, documented in wizard + README | FEAT §2 + PITFALLS #15 |
| L-24 | Bridge IP | Static IP (DHCP reservation or static config); IP-only URLs | PITFALLS #16 |
| L-25 | Bridge LXC sizing | Dedicated profile (~1–2 GB RAM, 2–4 cores, `nofile=4096`), NOT per-cam template | PITFALLS #17, #19 |
| L-26 | VAAPI concurrency | Soft cap 4, hard cap 6 Loxone-MJPEG transcodes; Frigate-RTSP `-c:v copy` (zero VAAPI) | PITFALLS #7 |
| L-27 | Frigate output defaults | `-an` (no audio) by default; H.264 passthrough; H.265 → UI hint | PITFALLS #18 + STACK §3 |
| L-28 | Cam classification | `kind` column derived from Protect's own `isThirdPartyCamera: boolean` (NOT a manufacturer regex — that field does not exist on the lib type). `model` reuses Phase-18's existing column for `marketName`. first-party default-ON, third-party default-OFF (opt-in). **Amended 2026-04-30** in `19-CONTEXT.md` D-CLASS-01 after phase-researcher verified types against `protect-types.ts@main` line 788. | PROJECT.md update + lib-source verification |
| L-29 | YAML library | `yaml@^2.6.0` (eemeli) — deterministic key ordering | STACK §2.5 |
| L-30 | Protect API client | `unifi-protect@^4.29.0` for write-paths; existing `protect.ts` STAYS for reads (no rip-out) | STACK §1.4 |

---

## Cam Classification (First-Party vs Third-Party in Protect)

### Schema impact (Phase 19)

Add to `cameras` for `source='external'` rows:

```ts
manufacturer: text('manufacturer'),              // denormalized from Protect bootstrap
model: text('model'),                            // denormalized
kind: text('kind').notNull().default('unknown'), // 'first-party' | 'third-party' | 'unknown'
```

**Derivation rule** (in `catalog.ts` upsert, P19): `manufacturer matches /^Ubiquiti|UniFi|UVC/i` OR `bootstrap.cameras[].type` starts with `UVC` → `kind='first-party'`. Otherwise `'third-party'`. `'unknown'` only when catalog can't resolve.

### Catalog UX impact (P19 + P22)

- Stream Catalog table: small badge column. First-party shows UniFi glyph; third-party shows manufacturer pill ("Mobotix S15", "Hikvision"). Read-only.
- `/cameras` integration: "Protect Hub" badge stays primary marker; first-party/third-party is secondary qualifier.

### Default-enable logic impact (P21 reconciler + P22 wizard Step 4)

- **First-party cams:** checkbox pre-checked, default output type pre-selected.
- **Third-party cams:** checkbox unchecked by default, with copy: "Already producing MJPEG natively? Leave off. Re-distribute via Hub? Check the box."

Same logic in steady-state: new third-party cam at reconcile → outputs default-OFF regardless of feature gate. Mobotix S15 with native MJPEG → user leaves it off, exactly as PROJECT.md describes.

---

## Phase Decomposition (Recommended: 5 phases, P19–P23)

### Phase 19 — Data Model + Protect Catalog (Read-Only)
- Schema: `cameras.source/mac/externalId/hubBridgeId/manufacturer/model/kind`; new tables `protect_hub_bridges`, `camera_outputs`, `protect_stream_catalog`, `hub_onboarding_state`.
- Deps: `unifi-protect@^4.29.0` + `yaml@^2.6.0`.
- `protect-hub/catalog.ts` — fetch bootstrap, derive `kind`, upsert.
- `/api/protect-hub/discover` (POST refresh).
- `/settings/protect-hub` minimal status page + `ProtectHubTab.svelte` shell.
- TLS spike against UDM 192.168.3.1 — confirm `rtspx://`.
- **Pitfalls baked in:** #2 (MAC PK), #4 (channels from bootstrap), #8 (TLS spike), #19 (sizing), #20 (SSH key reuse).

### Phase 20 — Bridge LXC Provisioning + Hello-World YAML
- `bridge-provision.ts` (one-shot) + `bridge-lifecycle.ts` (start/stop/restart; destroy in P23).
- Bridge LXC profile: 1–2 GB RAM, 2–4 cores, `/dev/dri`, `nofile=4096`, static IP.
- go2rtc YAML template with `api.listen: 127.0.0.1:1984`, `ui_editor: false`, idempotency stamp.
- `/api/protect-hub/enable` + `/api/protect-hub/state`.
- Wizard Steps 1–2.
- Health-check sub-loop on existing scheduler.
- **Pitfalls:** #5 + #11 (canonical YAML, stamp, localhost binding), #7 (VAAPI sizing), #15 (LAN-trust doc), #16 (static IP), #17 (ulimit), #19 (sizing), #20 (SSH key).

### Phase 21 — Multi-Cam YAML + Reconciliation Loop
- `yaml-builder.ts` — multi-cam emission for `loxone-mjpeg` (transcode 640×360@10fps VAAPI) + `frigate-rtsp` (`-c:v copy -an` passthrough).
- `reconcile.ts` — query → build → canonical-hash → diff → SSH push → reload → emit event.
- `protectHubReconcileInterval` (5min), gated on `settings.protect_hub_enabled`.
- `/api/protect-hub/reconcile` (force-run) + `/api/cameras/[id]/outputs`.
- Single-flight + dirty-flag retry; mtime fast-path; busy flag for self-update.
- WS reconnect with exp backoff + full bootstrap on reconnect.
- **Pitfalls:** #1 (URL re-extract), #3 (WS exp backoff), #5 (canonical hash), #6 (single-flight + dirty), #11 (mtime fast-path), #13 (busy flag), #14 (health sub-loop), #18 (`-an` default).

### Phase 22 — Onboarding Wizard + `/cameras` Integration
- Wizard Steps 3–6: discovery preview, cam selection (first-party-default-ON / third-party-default-OFF), pre-flight check, recap, initial reconcile, "where to go next."
- State machine `hub_state` with toggle greying-out during transitions.
- Modify `/api/cameras/status` — partition managed/external; merge sorted.
- Modify `CameraDetailCard.svelte` — "Protect Hub" badge, first-party/third-party qualifier, Outputs subsection, snapshot preview, "recommended profile" hint.
- "All Hub URLs" copy-list page.
- Bulk-toggle output type across cams.
- `ProtectHubGuide.svelte` — Loxone "Benutzerdefinierte Intercom" snippet (NOT Motion Shape Extreme), Frigate `cameras:` snippet.
- E2E test.
- Graceful SIGTERM in `hooks.server.ts`.
- **Pitfalls:** #4 (toggle gating), #9 (wizard state machine), #12 (toggle flapping), #13 (graceful shutdown), #15 (LAN-trust doc), #16 (URL copy buttons), #21 (class-aware action menu), #22 (cost annotations).

### Phase 23 — Offboarding + Lifecycle Polish + Stream-Sharing API
- `/api/protect-hub/disable` with 3 paths: Pause / Disable+Keep / Full Uninstall (type-DELETE).
- Confirm dialog with consequence preview.
- `bridge-lifecycle.ts destroyBridge()`.
- Soft-delete `external_archived` + re-enable detection (bridge stopped → fast path).
- `share-toggle.ts` — Protect API auto-enable; offboarding sub-toggle (default OFF, only channels we enabled).
- "Sync now" + drift indicator + reconcile event log.
- "Export Hub config before uninstall."
- Per-stream metrics card.
- **Pitfalls:** #10 (offboarding cleanup with idempotent steps), #21 (class-aware UI).

### Phase Ordering Rationale

```
P19 (schema + read-only) ──┐
                           ├── both ship value alone
P20 (bridge LXC) ──────────┘
            ↓
P21 (yaml + reconcile)  ← heart, highest risk
            ↓
P22 (wizard + UI)       ← usable by humans
            ↓
P23 (offboarding + polish)
```

P19/P20 each ship demoable value. P21 is technically usable by a developer (manual `INSERT`). P22 turns it into an end-user product. P23 cannot meaningfully precede P22.

---

## Research Flags (need spike during phase execution)

| Phase | Why |
|---|---|
| P19 | TLS spike against actual UDM (rtspx:// vs tls_verify=0); confirm `mac` field reliability for first-party AND third-party cams; confirm `bootstrap.cameras[].type` discriminator |
| P21 | go2rtc reconnect-after-source-disconnect empirical test; canonical YAML form choice (sortKeys + key normalization) |
| P23 | `unifi-protect.updateDevice` exact PATCH semantics for `isRtspEnabled=false` per channel |

---

## What This Milestone Does NOT Need

| Avoid | Why |
|---|---|
| New ORM | Drizzle 0.45 + better-sqlite3 in place; pseudo-migration via `ensureColumn()` fine for v1.3 |
| New SSH library | `node-ssh` covers all bridge ops |
| New HTTP client | `unifi-protect` brings `undici`; Node 22 has built-in `fetch` |
| Process manager | systemd on VM + `Restart=always` on go2rtc inside LXC |
| Auth on bridge endpoints | LAN trust boundary; v1.4+ if requested |
| Webhook / event bus | Premature for single-user homelab |
| Profile system | Two output types — flat data model correct; profiles only justified at ≥5 |
| `js-yaml` | Use `yaml@^2.6.0` (eemeli) — better TS types |
| `unifi-cam-proxy` | Solves opposite problem (cams INTO Protect) |

---

## Pitfall-to-Phase Mapping (Roadmapper Success Criteria)

### P19 — Data Model + Catalog
- **#2** MAC PK locked in schema (irreversible) — verify: `cameras.mac` NOT NULL for `source='external'`, lowercased.
- **#4** Channel inventory iterated from `bootstrap.cameras[].channels[]`, never hardcoded — verify single-channel cam renders correctly.
- **#8** TLS spike: `rtspx://` works against UDM 192.168.3.1 — verify `ffprobe rtspx://192.168.3.1:7441/<alias>` from throwaway LXC.
- **#19** Bridge LXC sizing documented.

### P20 — Bridge LXC + Hello-World
- **#5 + #11** YAML stamp present; canonical-form hash; `api.listen: 127.0.0.1:1984` + `ui_editor: false` — verify `:1984/editor.html` unreachable from LAN.
- **#7** `/dev/dri` passthrough; cost-model documented.
- **#16** Static IP — verify Loxone tile survives bridge restart.
- **#17** `nofile=4096` — verify with `prlimit`.
- **#15** LAN-trust-boundary doc.

### P21 — YAML + Reconcile
- **#1** URLs re-extracted from bootstrap every pass — verify with simulated UDM reboot.
- **#3** WS exp backoff (5s → 5min) — verify ≤5 reconnect attempts during 60s UDM unreachability.
- **#5** Canonical hash: no-op reconcile does NOT redeploy.
- **#6** Single-flight — verify two simultaneous reconcile calls = sequential, not parallel.
- **#11** mtime fast-path — verify reconcile cycle <2s when YAML unchanged.
- **#13** Self-update returns 409 if `reconciler.busy`.
- **#18** Frigate template: `-an` is default.

### P22 — Wizard + `/cameras` UI
- **#9** Wizard resume — verify killing app process during Step 5; restart; resume completes.
- **#12** Toggle greyed during `starting`/`stopping`.
- **#13** SIGTERM grace 30s in `hooks.server.ts`.
- **#16** Output URL has copy button + per-target snippet (Loxone Custom Intercom, Frigate `cameras:`).
- **#21** External-cam action menu hides "delete container", shows "remove from hub."

### P23 — Offboarding + Polish
- **#10** Partial-failure recovery — kill SSH mid-cleanup-step; restart; "force cleanup" admin action completes.
- **#10** `share_enabled_by_us=true` respected — manually flip Protect channel ON outside app, then offboard: that channel NOT auto-disabled.
- Drift indicator shows last successful reconcile timestamp + container status.

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | `unifi-protect@4.29.0` API surface verified against lib source; go2rtc multi-stream confirmed against AlexxIT wiki + meintechblog; `yaml@2.6.0` stable |
| Features | MEDIUM-HIGH | Channel-catalog API HIGH from lib source; Loxone "Benutzerdefinierte Intercom" contract HIGH from meintechblog; single-vs-dual-stream Loxone LOW-MEDIUM; third-party classification NEW (minor spike needed) |
| Architecture | HIGH | Every recommendation references concrete existing file; reuses proven primitives; no new top-level frameworks |
| Pitfalls | MEDIUM-HIGH | HIGH on go2rtc/Protect-token/codec issues; MEDIUM on Loxone caching + scheduler-integration; MAC-vs-id PK pitfall HIGH (UI Help doc + filesystem layout) |

**Overall confidence: HIGH for proceeding to roadmap.** Conflicts and gaps are explicit with clear resolution paths.

### Gaps to Address During Planning

| Gap | Handling |
|---|---|
| Loxone single-stream sufficiency | Ship single-stream default in P21; design `cameraOutputs` model to allow future medium/high entry without schema change; revisit at P22 user testing |
| `unifi-protect.enableRtsp` per-channel granularity | Ship all-on for v1.3; per-channel control is v1.4. Spike at start of P23 |
| Cam classification edge cases (Mobotix-via-Protect-third-party-adopt) | Default rule: `kind='first-party'` only when `manufacturer matches /Ubiquiti|UniFi|UVC/i`. Mobotix-via-third-party-adoption → `kind='third-party'`, default-OFF |
| VAAPI concurrency on user's iGPU | P19/P20 acceptance test: 8 simultaneous Loxone outputs run for 30 minutes without ffmpeg failure. If iGPU can't hit 8, lower caps |
| Protect Share-Livestream auto-enable API path | Spike at start of P23 against UDM. Until verified, ship UI fallback modal |

---

## Sources

### Primary (HIGH)
- [unifi-protect GitHub](https://github.com/hjdhjd/unifi-protect) v4.29.0
- [unifi-protect src/protect-api.ts:1090-1212](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts)
- [go2rtc README + wiki](https://github.com/AlexxIT/go2rtc)
- [Frigate Configuring go2rtc](https://docs.frigate.video/guides/configuring_go2rtc/)
- [meintechblog 2025-11-07 — UniFi → Loxone howto](https://meintechblog.de/2025/11/07/howto-unifi-protect-videofeed-in-loxone-einbinden/)
- [openHAB #20072 — Share Livestream URL rotates on every restart](https://github.com/openhab/openhab-addons/issues/20072)
- [UI Help — Migrating Cameras Between NVRs](https://help.ui.com/hc/en-us/articles/19118654419607)

### Secondary (MEDIUM)
- [Florian Rhomberg — Third-party camera into Protect](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/)
- [Lukas Klein — Unifi cameras in Loxone](https://medium.com/@lukas.klein/using-your-unifi-cameras-in-loxone-a777a17c139c)

### Detailed Research Files
- `.planning/research/v1.3/STACK.md`
- `.planning/research/v1.3/FEATURES.md`
- `.planning/research/v1.3/ARCHITECTURE.md`
- `.planning/research/v1.3/PITFALLS.md`
