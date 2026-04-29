# Phase 19 Context — Data Model + Protect Catalog (Read-Only)

**Phase:** 19
**Milestone:** v1.3 Protect Stream Hub
**Captured:** 2026-04-30

## Domain

Lock the v1.3 schema (cameras-table extension, three new tables for hub/outputs/catalog), wire up a `unifi-protect`-lib-backed bootstrap fetch + first/third-party classification, and surface a read-only "Protect Hub" settings tab where the user sees their UDM's cams with manufacturer/model/MAC and per-channel codec/resolution/fps/bitrate. **No bridge container, no reconciliation, no outputs.** Phase 19 is the schema-irreversibility step + the demoable "I can see my cams" milestone.

## Locked Requirements (from ROADMAP.md)

7 requirements: HUB-CAT-01..06 + HUB-WIZ-01.

Success criteria (from ROADMAP §Phase 19) flow into plan acceptance:
1. Settings "Protect Hub" tab + feature toggle (default OFF) + status panel; activating discovery populates `cameras (source='external')` + `protect_stream_catalog` rows from real UDM
2. Catalog UI shows manufacturer, model, MAC (lowercased, no separators), full set of native stream qualities; single-channel cams render correctly (no hardcoded 3-channel placeholder)
3. first-party / third-party classification badge visible per cam
4. `cameras.mac NOT NULL` for `source='external'` rows (verifiable via DB inspection); `cameras.externalId` is denormalized cache only
5. Catalog survives brief UDM unreachability — UI renders cached SQLite catalog + "controller unreachable" banner
6. Spike artifact committed at `.planning/research/v1.3/spikes/p19-tls-rtspx.md`
7. `unifi-protect@^4.29.0` + `yaml@^2.6.0` pinned without bumping existing deps

## Decisions (from this discussion)

### Classification (D-CLASS)

**D-CLASS-01 — first-party detection rule (AMENDED 2026-04-30 after phase-researcher verified `unifi-protect@4.29.0` types):**

```ts
kind = 'first-party'  IF  cam.isThirdPartyCamera === false
     = 'third-party'  IF  cam.isThirdPartyCamera === true
     = 'unknown'      IF  isThirdPartyCamera is undefined/null
                          (defensive only — required field per current lib types,
                           but old firmware may omit it)
```

**Why amended:** The original rule referenced a `manufacturer` field that does NOT exist on `ProtectCameraConfigInterface`. Phase-researcher verified verbatim against `github.com/hjdhjd/unifi-protect/blob/main/src/protect-types.ts` line 788 — the canonical discriminator is `isThirdPartyCamera: boolean`. Original milestone research (ARCHITECTURE.md, FEATURES.md) inferred `manufacturer` from web docs without source verification. Phase-research caught it.

**Why this is BETTER than the original rule:**
- Protect itself already has the classification — we trust their boolean rather than re-deriving from manufacturer-string-matching that could regress on edge cases
- Mobotix-via-Protect-5.0-third-party-adoption gets `isThirdPartyCamera=true` by Protect's own bookkeeping → still default-OFF (Mobotix users with native MJPEG can leave it off)
- UniFi-AI-Pro and any future first-party UniFi cams just work — no regex maintenance
- Zero string-matching ambiguity (case sensitivity, whitespace, partial matches)

**Code impact:** `protect-bridge.ts` `classifyKind(camera)` becomes a 3-line function:

```ts
export function classifyKind(camera: ProtectCameraConfigInterface): 'first-party' | 'third-party' | 'unknown' {
  if (camera.isThirdPartyCamera === false) return 'first-party';
  if (camera.isThirdPartyCamera === true) return 'third-party';
  return 'unknown';
}
```

**`model`/`marketName` columns:** still populate from `cam.modelKey` / `cam.marketName` for UI display (manufacturer pill on third-party cards), just not used for classification logic. **Note:** `cameras.model` already exists in DB from Phase 18 — reuse that column for `marketName`, do NOT re-add.

**D-CLASS-02 — `kind='unknown'` treatment:**

Treat as third-party for default-enable logic (default-OFF, opt-in). UI shows the manufacturer-as-is + a small `?` qualifier badge so user can override manually.

**Rationale:** Safe default. Never auto-activate streams the user didn't explicitly opt into. False-negative (real UniFi cam with empty manufacturer) is a user inconvenience (one extra checkbox click); false-positive (third-party native-MJPEG cam auto-activated) is wasted VAAPI cycles + user confusion.

### TLS Spike (D-TLS)

**D-TLS-01 — Spike is the first plan-task in P19, automated and committed:**

Plan 01 (or its first task) provisions a throwaway LXC, runs `ffprobe -i rtspx://192.168.3.1:7441/<known-share-alias>` (with and without `tls_verify=0`), captures output, writes findings to `.planning/research/v1.3/spikes/p19-tls-rtspx.md`, commits.

**D-TLS-02 — Spike result is locked into a const in a new central module:**

Result of the spike (chosen scheme: `rtspx://` OR `rtsp://` + `tls_verify=0` flag) becomes a const in a new central `src/lib/server/services/protect-bridge.ts` (module also hosts the lib boundary, see D-LIB-02). All later phases (P21 yaml-builder, P23 share-toggle) import this const — no inline fallbacks, no runtime probing.

**Rationale:** Reproducible audit trail (next-session Claude can re-read the findings file), single source of truth for TLS scheme, decoupled from individual call sites.

### Catalog Refresh Trigger (D-REFRESH)

**D-REFRESH-01 — Initial-Auto + Manual-Button, no background polling in P19:**

- First time `/settings/protect-hub` is opened AND `protect_stream_catalog` is empty → automatic `discover()` run with spinner UI; populate catalog.
- Subsequent visits: catalog renders from SQLite cache (instant); a manual "Aktualisieren" button triggers `discover()`.
- **No scheduler tick, no Background polling, no auto-refresh-on-idle in P19.** P21+ takes over background sync via the 5-min reconciler tick.

**Rationale:** P19 is "read-only catalog visibility." Adding a background scheduler in P19 couples it to scheduler.ts unnecessarily and contradicts the phase boundary. Initial-auto gives a non-empty first-impression; manual button covers updates without surprise UDM-pinging.

**On UDM unreachability:** discover() catches the network error, leaves cache untouched, UI shows orange "Controller nicht erreichbar — Anzeige aus Cache" banner with last-discovery timestamp. (Satisfies HUB-CAT-05.)

### `unifi-protect` Lib Boundary (D-LIB)

**D-LIB-01 — New lib for ALL new v1.3 read paths; hand-rolled `protect.ts` stays untouched for legacy:**

| Path | Code path | Module |
|------|-----------|--------|
| v1.0 cam-monitoring (status cache, 30s TTL) | hand-rolled `protect.ts` (legacy) | `src/lib/server/services/protect.ts` (UNCHANGED) |
| v1.3 catalog discovery (`bootstrap.cameras[]` + `channels[]`) | new `unifi-protect` lib | `src/lib/server/services/protect-bridge.ts` (NEW) |
| v1.3 enableRtsp / share-toggle (P23) | new `unifi-protect` lib | `src/lib/server/services/protect-bridge.ts` (extend in P23) |
| v1.3 WebSocket bootstrap stream (P21) | new `unifi-protect` lib | `src/lib/server/services/protect-bridge.ts` (extend in P21) |

**Rationale:** Zero refactor risk on v1.0/v1.1/v1.2 code. `protect.ts` has open UAT items from v1.2 (Bambu live-hardware verification) — touching it now is out-of-scope. Lib gives typed Bootstrap response that we'd otherwise have to hand-parse. Future migration (v1.4+) collapses both into one client.

**D-LIB-02 — Module location:**

`src/lib/server/services/protect-bridge.ts` — sits next to `protect.ts` in the existing services-layer flat folder. NOT under `src/lib/server/orchestration/protect-hub/`, which is reserved for orchestration logic (catalog.ts, reconcile.ts, etc.) per ARCHITECTURE.md.

`protect-bridge.ts` exports:
- `getProtectClient()` — singleton lib instance, reuse credentials from existing settings
- `fetchBootstrap()` — typed return of cams + channels
- `classifyKind(camera)` — first/third-party/unknown derivation per D-CLASS-01
- `TLS_SCHEME` — const set from D-TLS-02 spike result
- (P23 future) `enableCameraRtsp(cameraId, channelIds)` — wraps `enableRtsp()`

`src/lib/server/orchestration/protect-hub/catalog.ts` imports from `protect-bridge.ts` to do the upsert work.

## Code Context (Reusable Assets)

| File | Purpose | Reuse approach for P19 |
|------|---------|------------------------|
| `src/lib/server/db/client.ts` | Pseudo-migration `ensureColumn()` + `CREATE TABLE IF NOT EXISTS` on boot | Add new `ensureColumn()` calls for `cameras.source/mac/external_id/hub_bridge_id/manufacturer/model/kind`; add `CREATE TABLE IF NOT EXISTS` for `protect_hub_bridges` + `camera_outputs` + `protect_stream_catalog` |
| `src/lib/server/db/schema.ts` | Drizzle table definitions | Extend `cameras` schema; append 3 new table exports |
| `src/lib/server/services/protect.ts` | Hand-rolled cookie+CSRF Protect client; 30s status cache | UNCHANGED. Do not import from new code. |
| `src/lib/server/services/settings.ts` | 30s settings cache + AES-256-GCM encrypted creds; `getSetting`/`putSetting` | Add `protect_hub_enabled` settings entry (default false); reuse credential reader for Protect login (UDM creds already configured in v1.0) |
| `src/routes/settings/+page.svelte` | Tabs pattern (Proxmox / UniFi / Credentials / Backup / Version / Zugangsschutz) | Add "Protect Hub" as 7th tab; thin `ProtectHubTab.svelte` content |
| `src/lib/components/cameras/*` | CameraDetailCard, AdoptionGuide patterns | Read-only in P19 (no UI changes to /cameras); P22 extends |

## Canonical Refs

Every downstream agent MUST read these:

| Ref | Path | Why |
|-----|------|-----|
| Project | `.planning/PROJECT.md` | v1.3 milestone scope, lifecycle requirements, classification UX |
| Requirements | `.planning/REQUIREMENTS.md` | All 62 HUB-* reqs with traceability mapping |
| Roadmap | `.planning/ROADMAP.md` | Phase 19 goal + success criteria + research flags |
| Research Summary | `.planning/research/v1.3/SUMMARY.md` | 30 Locked-Early Decisions (L-1..L-30); Phase decomposition; pitfall→phase mapping |
| Research detail (Stack) | `.planning/research/v1.3/STACK.md` | `unifi-protect@4.29.0` API surface; `yaml@2.6.0` rationale |
| Research detail (Architecture) | `.planning/research/v1.3/ARCHITECTURE.md` | Schema design; module locations; file-touch matrix |
| Research detail (Pitfalls) | `.planning/research/v1.3/PITFALLS.md` | 22 cataloged pitfalls; P19 mitigations: #2 MAC-PK, #4 channel iteration, #8 TLS spike, #19 sizing, #20 SSH key |
| Research detail (Features) | `.planning/research/v1.3/FEATURES.md` | UX expectations for Catalog, Discovery, classification; out-of-scope antifeatures |
| Spike artifact (created in P19 plan) | `.planning/research/v1.3/spikes/p19-tls-rtspx.md` | TLS scheme decision audit trail (created by P19 first plan-task; referenced by P21 yaml-builder) |

## Constraints / Boundaries

- **Phase scope is FIXED:** schema lock + read-only catalog. NO bridge LXC (that's P20), NO reconciler (P21), NO `/cameras` integration (P22), NO offboarding (P23).
- **Schema-irreversibility:** P19 commits the `cameras.mac NOT NULL` (for `source='external'` rows) decision. Once shipped, changing the PK strategy requires a painful migration. Plan-checker MUST verify the schema decision before P19 plans go to execute.
- **Two new deps only:** `unifi-protect@^4.29.0` + `yaml@^2.6.0`. No bumping of existing deps. Plan-checker should verify `package.json` diff.
- **No `/cameras` UI work in P19:** the cameras list does NOT need to display external cams in P19. That's P22's job. P19's UI is `/settings/protect-hub` only.
- **No reconciler-stub in P19:** even a "skeleton" reconciler module is out of scope. P21 owns it.
- **Hand-rolled `protect.ts` stays UNTOUCHED.** Plan-checker must flag any modification to that file.

## Deferred Ideas

(Captured during discussion but out of P19 scope — added to roadmap backlog.)

- *None this session.* All discussion stayed within Phase 19 boundaries.

## Open Questions for Plan-Phase

These are NOT blocking decisions — plan-phase researcher resolves them:

- **Q-OPEN-01 (P19 plan-research):** Does `unifi-protect.getBootstrap()` always return `manufacturer` and `type` fields, or are there firmware versions / cam models where they're missing? If missing, what's the fallback? (Probably: leave `kind='unknown'` and surface in UI.)
- **Q-OPEN-02 (P19 plan-research):** What's the exact TypeScript shape of `bootstrap.cameras[].channels[]` in `unifi-protect@4.29.0`? Are `width`/`height`/`fps`/`bitrate` always present, or per-firmware?
- **Q-OPEN-03 (P19 spike):** The spike answers — does `rtspx://` work against a UDM Pro with a default self-signed cert, or does go2rtc need `tls_verify=0`? Spike captures concrete ffprobe output.
- **Q-OPEN-04 (P19 plan):** When the user has no Protect credentials configured yet (fresh install), does the Hub-Tab show a deep-link to the existing UniFi-settings tab (HUB-WIZ-03 anticipates Step 1 of wizard, but in P19 there's no wizard yet) — or is the tab just hidden until creds exist? Recommendation: tab visible, status panel says "Konfiguriere zuerst die UniFi-Verbindung →" with deep-link button.

## Next Steps

`/clear` then `/gsd:plan-phase 19` to spawn researcher + planner with this CONTEXT.md as input.
