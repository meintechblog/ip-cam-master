# Phase 19 Discussion Log

**Phase:** 19 — Data Model + Protect Catalog (Read-Only)
**Date:** 2026-04-30
**Mode:** default (4 single-question turns; no `--auto`/`--all`/`--text`)

This file is a human-reference audit trail. Downstream agents (researcher, planner, executor) consume `19-CONTEXT.md`, NOT this log.

---

## Gray Areas Selected by User

User opted to discuss all 4 gray areas (multiSelect):

1. Klassifikations-Algorithmus
2. TLS-Spike-Workflow
3. Catalog-Refresh-Trigger (P19 read-only)
4. `unifi-protect` Lib Boundary

---

## Area 1 — Klassifikations-Algorithmus

### Q1.1 — first-party detection precedence

**Options:**
- Manufacturer-PRIMÄR, type sekundär (Recommended)
- Type-PRIMÄR, manufacturer sekundär
- Beide müssen matchen (strikt)

**User selected:** Manufacturer-PRIMÄR, type sekundär.

**Rationale logged:** Mobotix-via-Protect-emulation in 5.0+ may emit `type='UVC-emulated'` while `manufacturer='Mobotix'`. Manufacturer-primary keeps Mobotix correctly classified as third-party → default-OFF.

### Q1.2 — `kind='unknown'` treatment

**Options:**
- Wie third-party behandeln (Recommended)
- UI-Warnung + manueller Override
- Wie first-party behandeln

**User selected:** Wie third-party behandeln (default-OFF, '?' badge).

**Rationale logged:** Safe default. False-negative is one extra checkbox click; false-positive wastes VAAPI cycles.

---

## Area 2 — TLS-Spike-Workflow

### Q2.1 — When/how to run the rtspx:// spike

**Options:**
- Automatisierter Plan-Task in P19 (Recommended)
- Manueller User-Spike vor Plan-Phase
- Inline mit Fallback in catalog.ts

**User selected:** Automatisierter Plan-Task in P19.

**Rationale logged:** Reproducible, audit-trail in `.planning/research/v1.3/spikes/p19-tls-rtspx.md`, scheme locked as const in central `protect-bridge.ts` module.

---

## Area 3 — Catalog-Refresh-Trigger (P19 read-only)

### Q3.1 — Trigger strategy

**Options:**
- Initial-Auto + Manual-Button (Recommended)
- Auto bei jedem Page-Load
- Nur Manual-Button (kein Auto)
- Eigener 15min Scheduler-Tick

**User selected:** Initial-Auto + Manual-Button.

**Rationale logged:** No Background coupling to scheduler.ts in P19. P21+ takes over with 5-min reconciler. UDM unreachability surfaces as banner with cached display.

---

## Area 4 — `unifi-protect` Lib Boundary

### Q4.1 — Where is the lib used vs hand-rolled `protect.ts`

**Options:**
- Lib für ALLE neuen v1.3 Read-Pfade (Recommended)
- Lib NUR für Write-Pfade
- Schrittweise Migration zu Lib

**User selected:** Lib für ALLE neuen v1.3 Read-Pfade.

**Rationale logged:** Zero refactor risk on v1.0/v1.1/v1.2 code; `protect.ts` has v1.2 UAT items still open. Future migration is a v1.4+ concern.

### Q4.2 — Module location

**Options:**
- `src/lib/server/services/protect-bridge.ts` (Recommended)
- `src/lib/server/orchestration/protect-hub/protect-client.ts`

**User selected:** `src/lib/server/services/protect-bridge.ts`.

**Rationale logged:** Sits next to `protect.ts` in the existing services-layer flat folder. orchestration/protect-hub/ is reserved for orchestration logic, not API clients.

---

## Deferred Ideas

None — all discussion stayed within Phase 19 boundaries.

## Claude's Discretion (not asked, decided per workflow guidance)

- Phase 19 phase-dir slug: `19-data-model-protect-catalog` (mirrors v1.0/v1.1 naming convention; concise + searchable).
- `protect-bridge.ts` exported surface (singleton, fetchBootstrap, classifyKind, TLS_SCHEME) — decided as part of D-LIB-02 module-shape; planner can adjust if research finds better partitioning.
- Q-OPEN-04 fallback (no creds yet): tab visible with deep-link to UniFi settings — not asked because the answer follows from existing wizard pattern; planner can re-validate.
