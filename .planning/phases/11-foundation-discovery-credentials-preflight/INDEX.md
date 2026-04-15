# Phase 11 — Foundation: Discovery + Credentials + Pre-flight — Plan Index

**Phase goal:** User can discover their Bambu printer, enter credentials securely, and receive a clear pre-flight verdict before any LXC is provisioned.

**Requirements:** BAMBU-03, BAMBU-04, BAMBU-05, BAMBU-06, BAMBU-07, BAMBU-08, BAMBU-09, BAMBU-10

**Ground truth:** `.planning/research/H2C-FIELD-NOTES.md` (validated 2026-04-15 against real H2C — firmware 01.01.05.00, model code O1C2). Cite over STACK.md when they conflict.

## Plans

| Plan | Title | Wave | Depends on | Autonomous | Requirements |
|------|-------|------|------------|------------|--------------|
| 01 | Schema migration + crypto wiring | 1 | — | yes | BAMBU-07, BAMBU-08, BAMBU-09 |
| 02 | SSDP discovery service + /api/discovery integration | 2 | 01 | yes | BAMBU-03, BAMBU-04, BAMBU-06 |
| 03 | Pre-flight handler + error taxonomy | 2 | 01 | yes | BAMBU-10 |
| 04 | Wizard Bambu branch + manual-add + UI verification | 3 | 01, 02, 03 | no (human-verify checkpoint) | BAMBU-04, BAMBU-05, BAMBU-06, BAMBU-07, BAMBU-10 |

## Dependency graph

```
                    Plan 01 (schema + crypto)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       Plan 02 (SSDP)          Plan 03 (pre-flight)
              │                       │
              └───────────┬───────────┘
                          ▼
                    Plan 04 (wizard + UI checkpoint)
```

Plans 02 and 03 are both in Wave 2 and both depend solely on Plan 01. They touch disjoint files → safe in parallel. Plan 04 waits for all three.

## File ownership (no overlaps within a wave)

| Plan | Files |
|------|-------|
| 01 | `src/lib/server/db/schema.ts`, `drizzle/` (generated migration), `src/lib/server/services/bambu-credentials.ts`, `src/lib/server/services/bambu-credentials.test.ts` |
| 02 | `src/lib/server/services/bambu-discovery.ts`, `src/lib/server/services/bambu-discovery.test.ts`, `src/routes/api/discovery/+server.ts` |
| 03 | `src/routes/api/onboarding/bambu/preflight/+server.ts`, `src/lib/server/services/bambu-preflight.ts`, `src/lib/server/services/bambu-preflight.test.ts`, `package.json`, `package-lock.json` |
| 04 | `src/lib/components/onboarding/OnboardingWizard.svelte`, `src/lib/components/onboarding/StepBambuCredentials.svelte` (new), `src/lib/components/onboarding/StepBambuPreflight.svelte` (new), `src/routes/kameras/onboarding/+page.svelte` |

Plans 02 and 03 in Wave 2 touch strictly disjoint files — verified:
- Plan 02 touches `bambu-discovery.*` + `/api/discovery/+server.ts`.
- Plan 03 touches `bambu-preflight.*` + `/api/onboarding/bambu/preflight/+server.ts` + `package.json` (added: `mqtt`).
- Both read (not write) Plan 01's `bambu-credentials.ts` → safe.

Plan 04 is the only Phase-11 plan to touch the wizard / onboarding page — no write conflict with 02 or 03.

## Scope guardrails (from 11-CONTEXT.md)

- **Additive migration only** — new columns are NULLABLE; no data backfill; no destructive ALTER.
- **No `transport` column** — deferred to v1.3 when cloud-mode lands.
- **Sequential pre-flight checks** — never parallel. H2C has a single-connection limit (PITFALLS §1).
- **No shellout to mosquitto_sub** — Node `mqtt` package with `rejectUnauthorized: false` (H2C-FIELD-NOTES §Recommendations #5).
- **`mqtt` is the ONLY new npm dep** across all four plans.
- **Bind UDP port 2021 (not 1990)** — H2C-FIELD-NOTES §SSDP overrides STACK.md on this specific point.
- **DevModel allowlist:** `O1C2` (H2C's wire code), `H2C`, `H2D`, `X1C`, `P1S`, `A1` (forward-compat; non-H2C still surfaces as "Bambu Lab <model>" but v1.2 validation is H2C-only).
- **Phase-11 ships functional, not polished** — inline help, firmware checklist, wizard aesthetics deferred to Phase 14.
- **No LXC / go2rtc provisioning** — Phase 11 ends at "pre-flight passed"; Phase 12 takes over.

## Requirements coverage matrix

| Requirement | Plan | Coverage |
|-------------|------|----------|
| BAMBU-03 (SSDP on UDP 2021) | 02 | Full |
| BAMBU-04 (type / IP / serial / LAN hint in discovery) | 02, 04 (UI render) | Full |
| BAMBU-05 (manual-add Bambu by IP) | 04 | Full |
| BAMBU-06 (result list differentiates Bambu) | 02 (backend flag), 04 (UI) | Full |
| BAMBU-07 (Access Code + Serial, AES-256-GCM) | 01 (crypto + schema), 04 (UI) | Full |
| BAMBU-08 (schema extension) | 01 | Full |
| BAMBU-09 (migration preserves existing rows) | 01 (additive NULLABLE columns) | Full |
| BAMBU-10 (four-code pre-flight taxonomy) | 03 (backend), 04 (UI) | Full |

All eight v1.2-Phase-11 requirements are fully covered. No orphans.

## Success for Phase 11 (from 11-CONTEXT.md §Success)

- [ ] User sees their Bambu H2C in the discovery list (labeled "Bambu Lab H2C", with IP + serial)
- [ ] User can manually add a Bambu printer by IP; UI differentiates Bambu rows from Mobotix/Loxone/ONVIF
- [ ] User enters 8-digit Access Code + Serial → values land AES-256-GCM encrypted in SQLite without breaking existing rows
- [ ] Pre-flight returns one of four distinct error codes (LAN Mode off / wrong code / unreachable / handshake hung) — never an opaque error

All four gated by Plan 04's human-verify checkpoint against the real H2C at 192.168.3.109.

## Out of scope for Phase 11 (explicit deferrals — see 11-CONTEXT.md §Out of scope)

- LXC provisioning for Bambu → Phase 12
- go2rtc config generation → Phase 12
- UniFi Protect adoption → Phase 13
- MQTT subscribe loop for print-state → Phase 14
- Wizard polish + inline help → Phase 14
- `transport` column / cloud-mode → v1.3
- Bird's-Eye `/streaming/live/2` → permanently out of v1.2 (H2C returns 404)
