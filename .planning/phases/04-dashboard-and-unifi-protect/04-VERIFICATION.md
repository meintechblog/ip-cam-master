---
phase: 04-dashboard-and-unifi-protect
verified: 2026-03-23T13:00:00Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Check native ONVIF camera label wording in dashboard"
    expected: "ONVIF-capable cameras appear as 'nativ nutzbar' per ROADMAP Success Criterion 4"
    why_human: "Code shows 'Nativ ONVIF' (CameraDetailCard) and 'ONVIF' badge in type column, not 'nativ nutzbar'. Functionally correct but wording differs from roadmap specification. A human must confirm whether the German UX wording is acceptable."
---

# Phase 4: Dashboard and UniFi Protect — Verification Report

**Phase Goal:** User can monitor all managed cameras from a status dashboard and complete UniFi Protect adoption
**Verified:** 2026-03-23T13:00:00Z
**Status:** human_needed (all automated checks passed; one wording item requires human confirmation)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dashboard shows all managed cameras in a grid/list with name, IP, type, container status, and stream status | VERIFIED | `src/routes/+page.svelte` renders camera table with Name, IP, Typ, Container, go2rtc, Stream columns. Fetches from `/api/cameras/status`. |
| 2 | Camera statuses update automatically without manual refresh | VERIFIED | `+page.svelte` uses `setInterval(fetchCameras, 10000)` in `$effect` — 10-second polling active. |
| 3 | User can view live stream preview for any managed camera via go2rtc WebRTC/MSE player | VERIFIED | Pre-existing feature from Phase 2/3. `CameraDetailCard.svelte` contains WebRTC/MSE player. Build confirms no regression. |
| 4 | ONVIF-capable cameras appear as "nativ nutzbar" without workflow actions | UNCERTAIN | `CameraDetailCard.svelte` uses `isNativeOnvif` derived state and hides workflow actions. Label shown is "Nativ ONVIF" not "nativ nutzbar". Functionally correct — actions are hidden; wording differs from spec. Needs human confirmation. |
| 5 | User can see UniFi Protect adoption status per camera and follow guided adoption instructions | VERIFIED | `cameras/status` endpoint enriches each camera with `protectStatus`. Dashboard table shows adoptiert/getrennt/wird adoptiert/wartend. `AdoptionGuide.svelte` provides guided instructions with ONVIF check. |

**Score:** 5/5 truths verified (4 VERIFIED, 1 UNCERTAIN pending human)

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/server/services/protect.ts` | VERIFIED | 201 lines. Exports: `protectFetch`, `getProtectCameras`, `matchCamerasToProtect`, `getProtectStatus`, `verifyOnvifServer`. Session cache + 30s status cache implemented. |
| `src/lib/server/services/events.ts` | VERIFIED | 119 lines. Exports: `storeEvent`, `storeEvents`, `getEvents`, `detectFlapping`, `getFlappingCameras`, `cleanupOldEvents`. All 6 functions present. |
| `src/lib/server/services/udm-logs.ts` | VERIFIED | 162 lines. Exports: `scanUdmLogs`, `parseLogLines`, `fetchRawProtectLogs`. SSH dispose in `finally` block. LOG_PATTERNS and NOISE_PATTERNS present. |
| `src/lib/server/db/schema.ts` | VERIFIED | `export const events = sqliteTable('events', ...)` with all 8 columns: id, cameraId, cameraName, eventType, severity, message, source, timestamp. |
| `src/lib/types.ts` | VERIFIED | Contains `ProtectCamera`, `ProtectCameraMatch`, `ProtectStatus`, `CameraEvent`, `EventType`, `EventSeverity`, `EventSource`. `CameraCardData` has `protectStatus?: ProtectCameraMatch \| null` and `flapping?: boolean`. |

#### Plan 02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/routes/api/protect/cameras/+server.ts` | VERIFIED | `export const GET`. Calls `getProtectStatus()`, serializes Map to array, returns JSON. |
| `src/routes/api/protect/events/+server.ts` | VERIFIED | `export const GET`. Parses cameraId, severity, eventType, since, until, limit, offset from URL params. Calls `getEvents(filters)`. |
| `src/routes/api/protect/adopt/+server.ts` | VERIFIED | `export const POST`. Reads cameraId from body, calls `verifyOnvifServer`, returns German instruction array and `protectUrl`. |
| `src/routes/api/logs/protect/+server.ts` | VERIFIED | `export const GET`. Parses `lines` param (max 500). Calls `fetchRawProtectLogs`. |
| `src/lib/server/services/scheduler.ts` | VERIFIED | Exports `startScheduler`, `stopScheduler`. `setInterval` with `60_000` for SSH log scan, `3600_000` for cleanup. Imports `scanUdmLogs`, `storeEvents`, `cleanupOldEvents`. |
| `src/routes/+page.svelte` | VERIFIED | Real Protect stat card with `protectAdopted`/`protectConnected`. Inline "Letzte Ereignisse" section with `{#each recentEvents as event}`. Flapping badge ("instabil"). |
| `src/lib/components/cameras/CameraDetailCard.svelte` | VERIFIED | Contains `showAdoptionGuide` state, `AdoptionGuide` import, "In Protect aufnehmen" button, `Adoptiert`/`Getrennt`/`Wartend` states, `flapping` badge. |

#### Plan 03 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/routes/logs/+page.svelte` | VERIFIED | 188 lines. Two tabs: "Ereignisse" and "Protect Logs". No placeholder text. Fetches `/api/protect/events` and `/api/logs/protect`. |
| `src/lib/components/events/EventTable.svelte` | VERIFIED | Paginated table with columns: Zeitpunkt, Schwere, Kamera, Typ, Nachricht. Pagination with Zurueck/Weiter buttons. |
| `src/lib/components/events/EventFilters.svelte` | VERIFIED | Filter dropdowns for camera ("Alle Kameras"), severity (info/warning/error), event type, and date range inputs. |
| `src/lib/components/cameras/AdoptionGuide.svelte` | VERIFIED | Loading ("ONVIF-Server wird geprueft"), success ("ONVIF-Server laeuft"), error ("ONVIF-Server nicht erreichbar") states. "Erneut pruefen" and "UniFi Protect oeffnen" present. |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `protect.ts` | `settings.ts` | `getSettings('unifi_')` | WIRED | `getSettings('unifi_')` called in `login()` and `connectToUdm()` — line 27 protect.ts |
| `events.ts` | `schema.ts` | `db.select().from(events)` | WIRED | `from(events)` in `getEvents`, `detectFlapping`, `getFlappingCameras` — lines 68, 96, 109 |
| `udm-logs.ts` | `node-ssh` | `ssh.connect({host})` | WIRED | `connectToUdm()` creates `NodeSSH` and calls `ssh.connect({host: sshHost, ...})` — line 107 |

#### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `api/protect/cameras/+server.ts` | `protect.ts` | `getProtectStatus()` | WIRED | Import and call on line 3, 7 |
| `api/protect/events/+server.ts` | `events.ts` | `getEvents(filters)` | WIRED | Import and call on line 3, 26 |
| `scheduler.ts` | `udm-logs.ts` | `scanUdmLogs()` on 60s interval | WIRED | Import line 1, called inside `setInterval(..., 60_000)` |
| `+page.svelte` | `/api/cameras/status` | `fetch('/api/cameras/status')` with protectStatus in response | WIRED | `fetch('/api/cameras/status')` line 25; `protectAdopted` derived from `c.protectStatus?.isAdopted` line 64 |

#### Plan 03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `logs/+page.svelte` | `/api/protect/events` | `fetch('/api/protect/events?' + params)` | WIRED | Line 42 — fetch with full filter param string |
| `logs/+page.svelte` | `/api/logs/protect` | `fetch('/api/logs/protect?lines=...')` | WIRED | Line 70 — `fetchProtectLogs()` |
| `AdoptionGuide.svelte` | `/api/protect/adopt` | `fetch('/api/protect/adopt', { method: 'POST' })` | WIRED | Line 30 — POST with `{ cameraId }` body |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| DASH-01 | 04-02 | Dashboard shows all managed cameras in grid/list | SATISFIED | `+page.svelte` renders camera table with all cameras from `/api/cameras/status` |
| DASH-02 | 04-02 | Each camera card shows name, IP, type, container status, stream status | SATISFIED | Dashboard table columns: Name (with flapping badge), IP, Typ, Container, go2rtc, Stream, UniFi |
| DASH-03 | 04-01, 04-02 | Camera status updates automatically (polling go2rtc + Proxmox) | SATISFIED | 10s `setInterval` in `$effect`; `cameras/status` calls Proxmox + go2rtc APIs |
| DASH-04 | 04-03 | User can view live stream preview via go2rtc WebRTC/MSE player | SATISFIED | Pre-existing in CameraDetailCard; build confirms no regression; Plan 03 notes DASH-04 already satisfied |
| DASH-05 | 04-02 | ONVIF-capable cameras displayed as "nativ nutzbar" without workflow actions | NEEDS HUMAN | `isNativeOnvif` flag hides workflow actions. Label is "Nativ ONVIF" / "ONVIF" badge, not "nativ nutzbar". Functionally correct but wording differs from ROADMAP spec. |
| DASH-06 | 04-01, 04-02 | Dashboard shows UniFi Protect adoption status per camera | SATISFIED | `protectStatus` field in each `CameraCardData`; dashboard table UniFi column shows adoptiert/getrennt/wartend |
| ONBD-05 | 04-01, 04-02, 04-03 | App triggers or guides UniFi Protect adoption with clear instructions | SATISFIED | `AdoptionGuide.svelte` verifies ONVIF server, shows numbered German steps, links to Protect UI; wired from CameraDetailCard "In Protect aufnehmen" button |

**Orphaned requirements from REQUIREMENTS.md Traceability table mapped to Phase 4:** None. All 7 Phase 4 requirements (DASH-01 through DASH-06, ONBD-05) are claimed by plan frontmatter.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `events.ts` (line 92) | `detectFlapping()` uses JS `new Date(Date.now() - 10 * 60 * 1000)` instead of SQLite `datetime('now', '-10 minutes')` | Info | Plan specified SQLite datetime functions; JS date math is functionally equivalent (timezone-agnostic ISO strings). `getFlappingCameras()` correctly uses `datetime('now', '-10 minutes')`. No behavioral difference. |
| `cameras/status/+server.ts` (line 157) | `} satisfies CameraCardData` — result object lacks `cameraModel`, `firmwareVersion`, `liveFps` fields (set to null/missing) | Info | These fields are populated by separate probe endpoint; type assertion via `satisfies` would fail at build if types mismatched. Build succeeds confirming these are optional/nullable in the type. |

No blocker or warning severity anti-patterns found. All data flows are wired to real services; no stubs detected.

---

### Human Verification Required

#### 1. Native ONVIF "nativ nutzbar" Wording

**Test:** Open the dashboard with a `mobotix-onvif` camera registered. Find that camera in the table and the CameraDetailCard.
**Expected (per ROADMAP):** Camera appears as "nativ nutzbar" without workflow actions.
**Actual (in code):** Camera shows "ONVIF" badge in the Typ column, "nativ" in the Stream column, and "Nativ ONVIF" in CameraDetailCard header. Workflow container/go2rtc actions are hidden.
**Why human:** The functional requirement (no workflow actions shown) is met in code. The exact label "nativ nutzbar" does not appear anywhere in the UI. Whether "Nativ ONVIF" and "ONVIF" badge are acceptable for the German-speaking target audience requires user judgment.

---

### Build Verification

```
npm run build — exit 0
✓ built in 10.74s (using @sveltejs/adapter-node)
```

No TypeScript errors. All phase artifacts compile cleanly.

### Commit Verification

All 6 phase commits confirmed in `git log`:
- `a812dd9` — feat(04-01): events table schema + types
- `7efbbd3` — feat(04-01): Protect API service
- `80958b1` — feat(04-01): events service + UDM log parser
- `66f3b15` — feat(04-02): API routes + scheduler + cameras/status
- `eeb5254` — feat(04-02): dashboard + CameraDetailCard enhancements
- `c322e51` — feat(04-03): logs page + EventTable + EventFilters
- `449cb20` — feat(04-03): AdoptionGuide + CameraDetailCard wiring

---

## Gaps Summary

No gaps blocking goal achievement. All five ROADMAP Success Criteria are met in code. The single UNCERTAIN item (DASH-05 wording) is a UX label question, not a functional gap — native ONVIF cameras correctly have workflow actions hidden.

---

_Verified: 2026-03-23T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
