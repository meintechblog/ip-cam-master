---
phase: 22
slug: onboarding-wizard-cameras-integration
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-06
revised: 2026-05-06
---

# Phase 22 — UI Design Contract

> Visual and interaction contract for Phase 22: Onboarding Wizard Steps 3–6, `/kameras` partition, per-cam Outputs subsection, `ProtectHubGuide` component, `/settings/protect-hub/all-urls` page, and Settings Hub-Tab status panel.
>
> Source-of-truth for `gsd-planner` and `gsd-executor`. Validated by `gsd-ui-checker`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (Tailwind v4 with `@theme` tokens; no shadcn-svelte) |
| Preset | not applicable |
| Component library | bits-ui primitives where needed; raw Tailwind for everything else |
| Icon library | `lucide-svelte` (existing) |
| Font | system stack (default Tailwind `font-sans`); `font-mono` for URLs/code |

**Tokens are already locked in `src/routes/layout.css`** via Tailwind v4 `@theme`:

```css
--color-bg-primary: #0f1419;   /* dominant page background */
--color-bg-secondary: #1a1f2e; /* secondary surfaces */
--color-bg-card: #1e2433;      /* cards */
--color-bg-input: #252b3b;     /* inputs, subtle inset surfaces */
--color-border: #2d3548;       /* hairline separators, card borders */
--color-text-primary: #e4e8f1; /* primary copy */
--color-text-secondary: #8b95a8; /* labels, helper copy */
--color-accent: #3b82f6;       /* primary CTAs only */
--color-success: #22c55e;      /* successful states */
--color-warning: #f59e0b;      /* drift, instability */
--color-danger: #ef4444;       /* errors, destructive */
```

Phase 22 introduces **zero new color variables**. All variants derived via Tailwind opacity modifiers (e.g. `bg-accent/10`, `border-accent/40`, `text-warning/90`).

---

## Spacing Scale

Declared values (multiples of 4, mapped to Tailwind classes):

| Token | px | Tailwind | Usage in Phase 22 |
|-------|-----|----------|--------------------|
| xs | 4 | `gap-1`, `p-1`, `mt-1`, `py-1` | Icon-to-text gaps; checkbox gutters; per-row inline gaps inside Outputs table; badge vertical padding |
| sm | 8 | `gap-2`, `p-2`, `px-2` | Toggle row internal gap; copy-button to URL gap; badge horizontal padding |
| md | 16 | `gap-4`, `p-4` | Card internal padding; Outputs subsection content padding; resume-banner padding |
| lg | 24 | `gap-6`, `p-6`, `mb-6` | Wizard step card padding; section header → first row gap; All-Hub-URLs group block padding |
| xl | 32 | `gap-8`, `mb-8` | Wizard step indicator → step body gap; section-to-section gap on `/kameras` (managed → external) |
| 2xl | 48 | `mt-12`, `pt-12` | Below page-level h1 on `/settings/protect-hub/all-urls` and `/settings/protect-hub/onboarding` |

**Phase 22 spacing exceptions (justified):**

- **`w-2`, `w-2.5`, `w-3.5` icon sizes** (8/10/14 px) — match existing `CameraDetailCard` status dots and lucide icon sizing pattern. Not on the 4-grid for the dot itself but the *box* containing it is 16px (`w-4 h-4`). Acceptable.

**No font-size pixel exceptions.** All text in P22 uses one of the four declared sizes below (12 / 14 / 16 / 24). The previously-considered `text-[10px]` and `text-[11px]` exceptions are explicitly retired — every label, badge, snippet comment, "Adresse:" caption, drift-indicator delta and event-type badge now uses `text-xs` (12 px).

**No badge-padding exceptions.** All inline badges (Protect Hub primary badge, UniFi/Drittanbieter qualifiers, event-type badges) use on-grid `px-2 py-1` (8/4 px). The previously-considered `px-1.5 py-0.5` micro-padding is explicitly retired — pills are 2px taller across the contract, no other section affected.

---

## Typography

**Exactly 4 sizes, exactly 2 weights.**

| Role | Size | Weight | Line Height | Tailwind | Where used in P22 |
|------|------|--------|-------------|----------|--------------------|
| Label / Meta | 12 px | 400 (normal) | 1.4 (`leading-snug`) | `text-xs` | Toggle sub-labels ("Loxone-MJPEG"), URL captions ("Adresse:"), event-log timestamps, event-type badges, badge text, snippet `#`-comment lines, drift-indicator delta, third-party qualifier text |
| Body | 14 px | 400 | 1.5 (`leading-normal`) | `text-sm` | Wizard step body copy, Outputs row labels, event-log row body, snippet language, primary stage labels, step indicator labels |
| Section heading | 16 px | 600 (`font-semibold`) | 1.4 | `text-base font-semibold` | Wizard step heading ("Schritt 4: Kameras auswählen"), `/kameras` section headers ("Eigene Kameras (n)"), Outputs subsection title ("Bridge-Ausgänge"), Hub-Status panel title, Event log title |
| Page heading | 24 px | 600 (`font-semibold`) | 1.2 | `text-2xl font-semibold` | Page-level `<h1>` instances **introduced by P22**: `/settings/protect-hub/all-urls` h1, Hub-Tab status-panel section h1 (when rendered as a standalone page heading) |

**Weights — exactly 2:**

- `font-normal` (400) — body, meta, labels, mono URLs, snippet content, badge text
- `font-semibold` (600) — section headings (`text-base`) and **all new page-level `<h1>` instances P22 introduces**

**Footnote — pre-existing `font-bold` (NOT introduced by P22):**

> The file `src/routes/kameras/+page.svelte` already renders its top-level `<h1>` as `text-2xl font-bold` (line ~35). P22 inherits that file's existing style verbatim — the `/kameras` h1 is **not** modified. P22 introduces zero new `font-bold` usages. Any new `<h1>` P22 adds (all-urls page, hub-tab status panel) MUST use `font-semibold`.

**Hard-floor numeric:** `font-mono` for any URL, slug, MAC, or hash rendered in the UI (`text-xs font-mono` is the pattern). Never display URLs in proportional font.

**Code blocks (snippet display):** `text-xs font-mono leading-relaxed` (1.625) inside `bg-bg-input` or `bg-bg-primary` rounded surfaces. Snippet `#`-comment lines remain `text-xs font-mono` — the color shifts to `text-text-secondary` to visually de-emphasize, no size change.

---

## Color

**60/30/10 split:**

| Role | Token | Usage in Phase 22 |
|------|-------|--------------------|
| Dominant (60%) | `bg-bg-primary` (#0f1419) | Page background; outer chrome of `/kameras`, wizard, all-urls page |
| Secondary (30%) | `bg-bg-card` (#1e2433) + `bg-bg-secondary` (#1a1f2e) + `bg-bg-input` (#252b3b) | Cards (CameraDetailCard variants, wizard step container, Outputs subsection panel, ProtectHubGuide block, status panel, event log rows). Inputs and subtle inset surfaces (URL display rows, snippet code blocks) use `bg-bg-input` |
| Accent (10%) | `bg-accent` (#3b82f6) | **Reserved-for list — exhaustive:** primary CTA button background ("Auswahl übernehmen", "Bridge bereitstellen", "Zum Abschluss", "Zur Kameraliste", "Jetzt synchronisieren"), step indicator current-step ring, copy-button hover state (`hover:text-accent`), resume-banner "Weiter zu Schritt {N}" button, focus rings (`focus:border-accent`), Loxone-MJPEG output toggle ON-state thumb |

**Semantic colors (NOT counted in 10% accent budget):**

| Role | Token | Reserved-for in P22 |
|------|-------|----------------------|
| Success | `text-success` / `bg-green-500/10` | Step-completed checkmarks, wizard Step 5 stage-complete rows, output-online dot, "Streams ready" stage label, copy-button success flash (`Check` icon) |
| Warning | `text-warning` / `bg-yellow-500/10` | Drift indicator on Hub-Tab status panel ("YAML drift erkannt"), unhealthy bridge state, third-party-cam manufacturer-unknown row hint |
| Danger | `text-danger` / `bg-red-500/10` | Error states (provisioning failed, reconcile failed, "Verbindung fehlgeschlagen"), inline errors below disabled toggles |
| Neutral muted | `text-text-secondary` | Disabled toggles, "Vorgang läuft…" caption, snippet-block German `#`-comments |

**Accent-reserved-for whitelist (executor must NOT use `bg-accent` for anything else):**

1. Primary CTA button (`px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90`)
2. Step-indicator current-step disc fill (`bg-accent/20 text-accent border border-accent/40`)
3. Resume-banner action button
4. Focus ring on form inputs (`focus:border-accent`)
5. Toggle ON-state thumb (when output is enabled)
6. Copy-button hover-color transition (`hover:text-accent` only — base color stays `text-text-secondary`)
7. Section-anchor links (`text-accent hover:text-accent/80`) — already established for "Zurück zu Einstellungen"

Anything else uses neutral tokens. Section headers, badges, qualifier-pills are neutral by default.

---

## Copywriting Contract

All copy is **German, terse, consistent with existing wizard tone** ("Adresse:", "Hinweis:", "Vorgang läuft…", `&larr; Zurück zu Schritt N`, "Erneut versuchen").

### Page-level headings

| Surface | Copy | Tailwind |
|---------|------|----------|
| `/kameras` h1 (pre-existing, NOT modified) | `Kameras` | `text-2xl font-bold` (existing — inherited verbatim) |
| `/kameras` managed section header | `Eigene Kameras (N)` | `text-base font-semibold` |
| `/kameras` external section header | `Aus UniFi Protect (N)` | `text-base font-semibold` |
| Wizard h1 (pre-existing from P20, NOT modified) | `Protect Hub — Bridge einrichten` | inherited from P20 verbatim |
| Wizard subtitle | `Der Bridge-Container stellt go2rtc für alle Hub-Streams bereit.` | `text-sm text-text-secondary` |
| **All-URLs page h1 (NEW in P22)** | `Hub-Adressen — Übersicht` | `text-2xl font-semibold` |
| All-URLs subtitle | `Alle aktiven Stream-Adressen, gruppiert nach Ausgangstyp.` | `text-sm text-text-secondary` |
| **Hub-Tab status panel h2 (NEW in P22)** | `Hub-Status` | `text-base font-semibold` |

### Wizard Step 3 — Kameras katalogisieren

| Element | Copy |
|---------|------|
| Step indicator label | `Kameras katalogisieren` |
| Step heading | `Schritt 3: Kameras aus Protect laden` |
| Body before fetch | `Wir holen jetzt die Liste deiner Protect-Kameras und ihre Stream-Qualitäten.` |
| Loading caption | `Kameras werden gelesen…` |
| Success summary | `N Kameras gefunden — M erstanbieter, K drittanbieter.` (numbers inline, no extra padding) |
| Fetch error | `Konnte Kameras nicht laden: {reason}` + Button `Erneut versuchen` |
| Primary CTA | `Auswahl übernehmen` (right-aligned, accent) — destination-explicit, advances to Step 4 |

### Wizard Step 4 — Cam selection

| Element | Copy |
|---------|------|
| Step indicator label | `Kameras auswählen` |
| Step heading | `Schritt 4: Welche Kameras in den Hub?` |
| Body | `Erstanbieter-Cams sind vorausgewählt mit Loxone-MJPEG aktiv. Drittanbieter-Cams sind aus — viele liefern bereits MJPEG nativ.` |
| First-party section header | `Erstanbieter (UniFi)` |
| Third-party section header | `Drittanbieter — vorausgewählt aus` |
| Third-party hint copy | `Liefert die Cam bereits MJPEG nativ? Dann hier aus lassen.` |
| Per-row label | `{cam.name} · {cam.modelName ?? '—'}` |
| Output picker label | `Ausgang:` (inline, `text-text-secondary text-xs`) + dropdown `Loxone-MJPEG (640×360@10)` / `Frigate-RTSP (Passthrough)` |
| Empty state | `Keine Kameras zum Auswählen vorhanden.` |
| Primary CTA | `Auswahl übernehmen` |

### Wizard Step 5 — First reconcile

| Element | Copy |
|---------|------|
| Step indicator label | `Erste Synchronisation` |
| Step heading | `Schritt 5: Streams werden eingerichtet` |
| Body | `Wir schreiben jetzt die go2rtc-Konfiguration auf die Bridge und warten, bis alle Streams laufen.` |
| Stage 1 label | `YAML wird geschrieben…` |
| Stage 1 done | `YAML auf Bridge` |
| Stage 2 label | `go2rtc wird neu geladen…` |
| Stage 2 done | `go2rtc bereit` |
| Stage 3 label | `Streams werden geprüft…` |
| Stage 3 done | `Streams laufen` |
| Stage timeout copy (90 s) | `Hinweis: Das dauert länger als gewöhnlich. Du kannst warten oder im Hintergrund fortfahren.` |
| Reconcile failed | `Synchronisation fehlgeschlagen: {reason}` + Button `Erneut versuchen` |
| Primary CTA (after success) | `Zum Abschluss` — destination-explicit, advances to Step 6 |

### Wizard Step 6 — Done

| Element | Copy |
|---------|------|
| Step indicator label | `Fertig` |
| Step heading | `Schritt 6: Hub aktiv` |
| Body | `Alle ausgewählten Kameras sind unter "Aus UniFi Protect" in /kameras sichtbar.` |
| Toast on redirect | `Protect Hub aktiv — N Streams laufen.` |
| Primary CTA | `Zur Kameraliste` |
| Secondary link | `Alle Adressen anzeigen` (deep-link to `/settings/protect-hub/all-urls`) |

### Resume banner (rendered ABOVE step container when `hub_onboarding_state` pointer ≠ null)

| Element | Copy |
|---------|------|
| Heading | `Du warst bei Schritt {N} — weiter?` |
| Body | `Letzte Aktivität: {relative time, "vor 12 Minuten"}.` |
| Primary CTA | `Weiter zu Schritt {N}` (step number injected at render — destination-explicit) |
| Secondary | `Zurücksetzen` (text-only, `text-text-secondary hover:text-danger`) |

### `/kameras` section partition

| Element | Copy |
|---------|------|
| Managed section header | `Eigene Kameras (N)` |
| External section header | `Aus UniFi Protect (N)` |
| External-section absent state (hub disabled) | section element NOT rendered (per CONTEXT.md decision) |
| External-section empty (hub on, 0 cams) | `Noch keine Protect-Kameras erkannt. Letzte Synchronisation: {ts}.` |
| Managed section empty (existing) | `Keine Kameras eingerichtet` (unchanged) |

### External cam card — badges & qualifier

| Element | Copy / Token |
|---------|------|
| Primary badge | `Protect Hub` — `bg-accent/15 text-accent border border-accent/30 px-2 py-1 rounded text-xs` |
| Qualifier — first-party | `UniFi` — `bg-bg-input text-text-primary border border-border px-2 py-1 rounded text-xs` |
| Qualifier — third-party | `Drittanbieter · {camera.manufacturer ?? 'Unbekannt'}` — same neutral token (`bg-bg-input text-text-primary border border-border px-2 py-1 rounded text-xs`); manufacturer fallback when null. **Always render the manufacturer string, never the modelName** (per CONTEXT.md "specifics") |
| Qualifier — unknown | `Drittanbieter · Unbekannt` |
| Stream-catalog table header | `Channel · Codec · Auflösung@FPS` (3 columns, `bg-bg-input`, `text-xs text-text-secondary`) |
| Stream-catalog row | `Low · H.264 · 640×360@15` (`text-xs font-mono` in row body) |
| Snapshot-area "no preview" copy | `Vorschau nicht verfügbar` (`text-xs text-text-secondary/50`) |
| Snapshot-area "loading" | `Schnappschuss wird geladen…` (`text-xs text-text-secondary`) |
| Reload-icon tooltip | `Vorschau neu laden` |
| Reload-icon sr-only label | `<span class="sr-only">Vorschau neu laden</span>` (mirrors copy-button parity pattern) |
| Action menu — replaces "Löschen" | `Aus Hub entfernen` (the actual destructive flow lives in P23 — in P22 button is **disabled with tooltip "Verfügbar in Phase 23"**) |

### Outputs subsection — per cam

| Element | Copy |
|---------|------|
| Subsection title | `Bridge-Ausgänge` (`text-base font-semibold`) |
| Loxone-MJPEG row label | `Loxone-MJPEG` (`text-sm`) |
| Loxone-MJPEG row sub-label | `640×360 · 10 fps · transcodiert (VAAPI)` (`text-xs text-text-secondary`) |
| Frigate-RTSP row label | `Frigate-RTSP` (`text-sm`) |
| Frigate-RTSP row sub-label | `Passthrough · ohne Audio` (`text-xs text-text-secondary`) |
| URL caption (when ON) | `Adresse:` (`text-xs text-text-secondary`, then mono URL + copy button) |
| Toggle ON state | switch slides right, accent thumb, status `text-success text-xs`: `aktiv` |
| Toggle OFF state | switch left, `bg-bg-input`, status `text-text-secondary text-xs`: `aus` |
| Toggle in-flight | thumb spinner overlay + caption `Vorgang läuft…` (`text-xs text-text-secondary`, matches existing wizard idiom) + separate explicit `Abbrechen` button **disabled** (visually present but not clickable until terminal state — clarifies "we are working on it, no double-click"). Per CONTEXT.md L-18. |
| Toggle error | `Konnte Ausgang nicht umschalten: {reason}` (`text-xs text-danger`) below row |

### ProtectHubGuide component (Loxone + Frigate snippets)

| Element | Copy |
|---------|------|
| Guide section title | `Anleitung — Stream einbinden` (`text-base font-semibold`) |
| Loxone tab label | `Loxone (Intercom)` (`text-sm`) |
| Frigate tab label | `Frigate (NVR)` (`text-sm`) |
| Loxone snippet header | `Benutzerdefinierte Intercom — Konfiguration` (`text-sm font-semibold`) |
| Loxone snippet (German `#`-comments, ready-to-paste, `text-xs font-mono`) | ```# Adresse: MJPEG-Stream über Hub-Bridge\nURL: http://{bridge-ip}:1984/api/stream.mjpeg?src={cam-slug}-low\n# Hinweis: User-Agent darf leer bleiben. Auth nicht aktiv (LAN-Trust).``` |
| Frigate snippet header | `cameras: Block für config.yml` (`text-sm font-semibold`) |
| Frigate snippet (per-cam YAML, `text-xs font-mono`) | ```cameras:\n  {cam-slug}:\n    ffmpeg:\n      inputs:\n        - path: rtsp://{bridge-ip}:8554/{cam-slug}-high\n          roles:\n            - record\n            # - detect   # auskommentiert: Erkennung kostet CPU\n    # detect:\n    #   width: 1280\n    #   height: 720\n    #   fps: 5\n    # record:\n    #   enabled: true\n    #   retain:\n    #     days: 7\n    #     mode: motion``` |
| Copy button (in snippet header) | `Snippet kopieren` (icon + label, `text-xs`, accent on hover) |
| Copy success flash | `Kopiert` (`text-xs text-success`) — 2s timeout matches existing pattern |

### `/settings/protect-hub/all-urls` page

| Element | Copy |
|---------|------|
| h1 | `Hub-Adressen — Übersicht` (`text-2xl font-semibold`) |
| Subtitle | `Alle aktiven Stream-Adressen, gruppiert nach Ausgangstyp.` (`text-sm text-text-secondary`) |
| Group 1 header | `Loxone-MJPEG (N)` (`text-base font-semibold`) |
| Group 2 header | `Frigate-RTSP (M)` (`text-base font-semibold`) |
| Per-row layout | `{cam.name} · {slug}` left (`text-sm`), mono URL center (`text-xs font-mono`), copy button right |
| Empty group state | `Keine Ausgänge dieses Typs aktiv.` (`text-sm text-text-secondary`) |
| Empty page state (hub off) | `Protect Hub ist nicht aktiv. → Im Einstellungs-Tab "Protect Hub" aktivieren.` (`text-sm`, link) |
| Back link | `&larr; Zurück zu Einstellungen` (`text-sm text-accent`, matches wizard pattern) |

### Settings Hub-Tab status panel + event log

| Element | Copy |
|---------|------|
| Status panel title | `Hub-Status` (`text-base font-semibold`) |
| Bridge state row | `Bridge: {running/stopped/error}` (status dot left, mono right) — label `text-sm`, value `text-xs font-mono` |
| Last reconcile row | `Letzte Synchronisation: {relative time}` (`text-sm`) |
| Last YAML hash row | `Konfig-Hash: {sha[0:8]}…` (`text-xs font-mono text-text-secondary`) |
| Active streams row | `Aktive Streams: {N}` (`text-sm`) |
| Drift indicator (warn) | `YAML-Drift erkannt — die Bridge läuft auf einer fremden Konfiguration.` (`text-xs`, `bg-yellow-500/10 border-yellow-500/30`) + button `Erneut deployen` |
| Drift-indicator delta text | `{N} Zeile(n) abweichend` (`text-xs text-warning/90`) |
| Sync-now button | `Jetzt synchronisieren` (accent CTA, primary, `text-sm`) |
| Sync-now in flight | `Synchronisation läuft…` (button text replaces, spinner inline) |
| Event log title | `Letzte Ereignisse` (`text-base font-semibold`) |
| Event log empty | `Noch keine Ereignisse aufgezeichnet.` (`text-sm text-text-secondary`) |
| Event log row format | `{HH:MM:ss} · {type} · {success/failed} · {reconcile-id[0:8]}` (3-col: timestamp · type-badge · status — all `text-xs font-mono`) |
| Event-type badges | `discover` / `reconcile` / `deploy` / `reload` / `error` — all `bg-bg-input text-text-secondary px-2 py-1 rounded text-xs font-mono`; `error` rows tint `text-danger` |

### Destructive actions in Phase 22

Phase 22 ships **no destructive actions**. Offboarding is P23. The "Aus Hub entfernen" button in the external-cam action menu is rendered but **disabled** with tooltip `Verfügbar in Phase 23`. The wizard "Zurücksetzen" on the resume banner clears `hub_onboarding_state` only — it does NOT touch any deployed bridge state, so it is non-destructive (reset just sends user back to step 1; bridge remains running, cams stay catalogued).

---

## Component Inventory (Phase 22)

| Component | Path | Type | Notes |
|-----------|------|------|-------|
| `ExternalCamCard.svelte` | `src/lib/components/cameras/ExternalCamCard.svelte` | New leaf | Renders external Protect cam — replaces `CameraDetailCard` rendering when `camera.source === 'external'`. Hides LXC card entirely. Renders Protect-Hub badge + qualifier, native stream catalog (3-col table), Outputs subsection, snapshot preview |
| `OutputsSubsection.svelte` | `src/lib/components/cameras/OutputsSubsection.svelte` | New leaf | Reused by ExternalCamCard. Two toggle rows + URL captions + copy buttons |
| `OutputToggle.svelte` | `src/lib/components/cameras/OutputToggle.svelte` | New leaf | Single toggle row primitive. Handles in-flight, error, success states |
| `ProtectHubGuide.svelte` | `src/lib/components/protect-hub/ProtectHubGuide.svelte` | New | Tabbed snippet display (Loxone / Frigate). Used on external-cam detail and on `/settings/protect-hub/all-urls` |
| `WizardStepIndicator.svelte` | `src/lib/components/protect-hub/WizardStepIndicator.svelte` | New | Replaces inline 2-step indicator in wizard; renders 6 steps; backward-clickable to completed steps; forward locked |
| `WizardResumeBanner.svelte` | `src/lib/components/protect-hub/WizardResumeBanner.svelte` | New | Above step container when `hub_onboarding_state` ptr ≠ null |
| `HubStatusPanel.svelte` | `src/lib/components/protect-hub/HubStatusPanel.svelte` | New | Bridge state, last reconcile, drift indicator, Sync-now button. Lives in `ProtectHubTab.svelte` |
| `HubEventLog.svelte` | `src/lib/components/protect-hub/HubEventLog.svelte` | New | Last 50 reconcile events. Read-only, polls 10s |
| `WizardStep3Catalog.svelte` | `src/routes/settings/protect-hub/onboarding/_components/Step3.svelte` | New | "Kameras katalogisieren" |
| `WizardStep4Pick.svelte` | `_components/Step4.svelte` | New | "Kameras auswählen" — checkboxes + per-cam output dropdown |
| `WizardStep5Reconcile.svelte` | `_components/Step5.svelte` | New | "Erste Synchronisation" — staged progress |
| `WizardStep6Done.svelte` | `_components/Step6.svelte` | New | Confirmation + redirect |
| `/settings/protect-hub/all-urls/+page.svelte` | route | New page | Grouped by output type |
| `/settings/protect-hub/all-urls/+page.server.ts` | route | New | Loads active outputs |

**Modified files:**

- `src/routes/kameras/+page.svelte` — split single list into two sections (managed / external) with conditional rendering on `hubEnabled`. **The pre-existing `text-2xl font-bold` on the `<h1>` is preserved verbatim — P22 introduces no font-bold elsewhere.**
- `src/lib/components/cameras/CameraDetailCard.svelte` — branch on `camera.source === 'external'` and delegate to `<ExternalCamCard>` (or gate the LXC block at line ~385 with the additional source check; component extraction is preferred for clarity per CONTEXT.md)
- `src/lib/components/settings/ProtectHubTab.svelte` — extend with HubStatusPanel + HubEventLog + Sync-now wiring
- `src/routes/settings/protect-hub/onboarding/+page.svelte` — refactor to consume WizardStepIndicator + WizardResumeBanner + Step3/4/5/6 components

---

## Interaction Contracts

### Wizard step indicator (HUB-WIZ-09)

- 6 discs, horizontal, separated by 1px hairlines (`bg-border` for incomplete, `bg-green-500/40` between completed)
- Disc states:
  - **Incomplete:** `bg-bg-input text-text-secondary border border-border`
  - **Current:** `bg-accent/20 text-accent border border-accent/40`
  - **Complete:** `bg-green-500/20 text-green-400 border border-green-500/40` + `<CheckCircle2 class="w-4 h-4" />` icon
- **Backward navigation:** clicking a complete disc returns user to that step. Forward discs are not clickable until preconditions met (matches existing P20 pattern).
- Disc size: `w-8 h-8 rounded-full` (32px). Label below: `text-sm` (varies between primary/secondary by current vs. inactive).

### Toggle (Outputs)

State machine: `off → enabling → on` and `on → disabling → off`. UI states map to those plus `error`:

| State | Visual | Disabled? | Caption |
|-------|--------|-----------|---------|
| off | switch left, `bg-bg-input`, thumb `bg-text-secondary` | no | `aus` (`text-xs text-text-secondary`) |
| enabling | switch sliding, thumb has `<Loader2 class="w-3 h-3 animate-spin">` overlay | YES (per CONTEXT.md L-18) | `Vorgang läuft…` (`text-xs text-text-secondary`) |
| on | switch right, `bg-accent`, thumb `bg-white` | no | `aktiv` (`text-xs text-success`) |
| disabling | switch sliding back, spinner overlay | YES | `Vorgang läuft…` (`text-xs text-text-secondary`) |
| error | switch returns to last known stable state | no | `Konnte Ausgang nicht umschalten: {reason}` (`text-xs text-danger`) below row |

A separate `Abbrechen` button is rendered next to the toggle ONLY when state ∈ {enabling, disabling} **and** the in-flight request is cancellable (P21 reconciler is async-fire-and-poll, so this is wired to AbortController on the fetch). When not cancellable, the button is rendered disabled (matches the locked decision).

### Copy button

- Default: `<Copy class="w-4 h-4">` icon, `text-text-secondary hover:text-text-primary`
- Click: `<Check class="w-4 h-4 text-success">` for 2 seconds (existing `setTimeout(() => copied = false, 2000)` pattern in `CameraDetailCard`)
- Tooltip: `Kopieren` / on success `Kopiert`
- Touch target: minimum `w-8 h-8` (32px) clickable area even when icon is 16px — match existing pattern via padding
- Always next to a `<code class="font-mono text-xs">` URL display
- Accessibility: `<span class="sr-only">Adresse kopieren</span>` inside the button

### Snapshot preview (external cam)

- Single fetch on render via `<img src={snapshotUrl}?t={Date.now()}>` (cache-buster)
- Reload icon (`<RotateCw class="w-3.5 h-3.5">`) in top-right corner of snapshot area, clickable, triggers re-fetch
- **Reload button accessibility:** `<span class="sr-only">Vorschau neu laden</span>` inside the button (mirrors copy-button parity pattern). `aria-label="Vorschau neu laden"` on the `<button>` itself.
- No auto-refresh interval (per CONTEXT.md decision)
- Loading: `text-xs text-text-secondary/50` centered "Schnappschuss wird geladen…"
- Failed: same area, "Vorschau nicht verfügbar"

### Step 5 health-poll

- Polls `/api/protect-hub/health` every **1500 ms** (per CONTEXT.md "1.5s cadence")
- 90-second hard timeout. After 90s, render `Hinweis: Das dauert länger als gewöhnlich. Du kannst warten oder im Hintergrund fortfahren.` and offer link `Zur Kameraliste` (continue without blocking on Step 5 success).
- Three named stages render as a vertical mini-progress: each stage gets a row with status dot + label. Active stage shows `<Loader2>` + label, completed stage shows `<CheckCircle2 text-success>` + label.

### Resume banner

- Rendered ABOVE the step container, full-width within the `max-w-2xl` wizard column
- `bg-bg-card border-l-4 border-l-accent` (accent left-stripe to draw eye, no full accent fill)
- `<RotateCcw class="w-5 h-5 text-accent">` icon left
- Heading + relative-time body, two buttons right: `Weiter zu Schritt {N}` (accent, step number injected) + `Zurücksetzen` (link-style danger-on-hover)

### `/kameras` partition rendering

- Managed and external sections render in a single `<div class="space-y-12">` (xl gap between sections) — single scroll, no tabs
- Each section starts with: `<h2 class="text-base font-semibold text-text-primary mb-4">` header + count
- Within a section, `<div class="space-y-4">` (md gap, matches existing card list)
- External section is **not rendered at all** when `data.hubEnabled === false` (omit the `<section>` element entirely — do NOT render with empty placeholder per CONTEXT.md)

### Hub-Tab status panel

- `bg-bg-card border border-border rounded-lg p-6` container
- 4 status rows in `space-y-3` flex layout: each row `<icon> <label> <value-mono>`
- Drift indicator: when active, renders below the 4 rows in a `bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4` block with action button
- Sync-now button: bottom-right of panel, `bg-accent text-white px-4 py-2 rounded-lg text-sm` — when in-flight, replaces label with spinner + "Synchronisation läuft…"

### Event log

- `bg-bg-card border border-border rounded-lg p-6 mt-6` container (separate from status panel)
- Title `text-base font-semibold mb-4`
- Rows in `divide-y divide-border` table layout, each row `py-2 grid grid-cols-[auto_auto_auto_1fr] gap-3 items-center text-xs font-mono`
- Polls every 10s (matches existing `/kameras` polling cadence)

---

## Visual Hierarchy — minimal but unmistakable diff

External cam card differs from managed cam card by:

1. **Two badges** in top-left of stream area (already used by managed cards for cam name): `Protect Hub` (accent border) + qualifier (`UniFi` or `Drittanbieter · {manufacturer}`, neutral)
2. **No LXC right-panel** (320px wide on `lg` breakpoint, currently `lg:w-64 xl:w-72`) — instead the right panel is a **read-only Stream-Catalog table** at the same width
3. **No pipeline arrows** below stream — replaced by `Bridge-Ausgänge` subsection (Outputs) + `ProtectHubGuide` collapse-block
4. **Snapshot reload icon** in top-right of stream area instead of auto-refresh polling

That is the entire visual delta. Card chrome, padding, color, typography are identical to managed cards. **One badge + one qualifier is the unmistakable signal** (per objective).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn in stack) |
| third-party | none | not applicable |

No new component libraries introduced. Phase 22 builds on:

- Existing `lucide-svelte` icons (already in `package.json`)
- Existing Tailwind v4 `@theme` tokens (already in `src/routes/layout.css`)
- Existing `bits-ui` primitives (already used elsewhere in the project, vetted) — used here only if a tab primitive is needed for ProtectHubGuide; otherwise raw conditional rendering

---

## Accessibility Notes (informational, not enforced by ui-checker)

- All toggles must include `aria-checked` reflecting the on/off state and `aria-disabled` when in-flight
- Step indicator discs render as `<button>` elements (not `<div>`) for backward navigation — keyboard accessible
- Resume banner buttons must use real `<button>` and `<a>` elements
- Copy buttons render `<Copy>` with `<span class="sr-only">Adresse kopieren</span>` for screen readers
- **Snapshot reload buttons render `<RotateCw>` with `<span class="sr-only">Vorschau neu laden</span>` inside (mirrors copy-button parity)**
- Snippet code blocks use `<pre><code>` with `aria-label="Snippet"` to enable screen-reader copy
- Focus rings: existing `focus:border-accent` + `focus:outline-none` pattern preserved on inputs; do NOT remove outline globally

---

## Pre-Population Sources

| Decision | Source |
|----------|--------|
| Black-only theme, Tailwind v4 with `@theme` tokens | `src/routes/layout.css` (existing) |
| `bg-bg-primary`, `bg-bg-card`, `text-text-primary`, `bg-accent` token names | `CameraDetailCard.svelte` (existing) |
| Lucide icons | Existing import pattern in `CameraDetailCard.svelte`, wizard, settings |
| `font-mono` for URLs/MAC/hash | Existing pattern throughout `CameraDetailCard` |
| German terse copy ("Adresse:", "Vorgang läuft…", "&larr; Zurück") | Wizard P20 source + existing components |
| 2 wizard steps → 6 steps step indicator | P20 wizard `+page.svelte:96-118` (extension pattern) |
| `Loader2`, `CheckCircle2`, `XCircle` icons for status | P20 wizard imports |
| `bg-green-500/10 border-green-500/30` success block, `bg-red-500/10 border-red-500/30` error block | P20 wizard styling pattern |
| `text-2xl font-bold` page heading on `/kameras` | `kameras/+page.svelte:35` (PRE-EXISTING — inherited verbatim by P22, NOT introduced) |
| 10s polling cadence on `/kameras` | `kameras/+page.svelte:27` |
| 1.5s polling cadence for Step 5 health | CONTEXT.md decision (named stages with live-poll) |
| Two-section partition order: managed first, external second | CONTEXT.md decision (insertion-order, no search bar) |
| Hide external section completely when hub disabled | CONTEXT.md decision |
| LXC card hidden on external cams | CONTEXT.md decision; live VM bug "LXC 0" confirms gate is wrong today |
| Toggle disabled + spinner + inline-text + separate Abbrechen during in-flight | CONTEXT.md decision (per L-18) |
| Linear progress bar, clickable backwards, forward locked | CONTEXT.md decision |
| Single-fetch snapshot + manual reload icon, no auto-refresh | CONTEXT.md decision |
| Toggle-switches per output, URL+copy underneath when ON | CONTEXT.md decision |
| Loxone snippet `#`-comments in DE, ready-to-paste | CONTEXT.md decision |
| Frigate snippet per-cam YAML + commented detect/record | CONTEXT.md decision |
| All-URLs page grouped by output type | CONTEXT.md decision |
| Manufacturer (not modelName) in third-party qualifier | CONTEXT.md "specifics" |
| 4-size typography ladder (12/14/16/24) | Revision 2026-05-06 (ui-checker blocking issue 1) |
| 2-weight typography (400/600), `font-bold` documented as pre-existing only | Revision 2026-05-06 (ui-checker blocking issue 2) |
| Step 3 CTA `Auswahl übernehmen`, Step 5 CTA `Zum Abschluss` | Revision 2026-05-06 (ui-checker FLAG: explicit destinations) |
| Snapshot reload sr-only label `Vorschau neu laden` | Revision 2026-05-06 (ui-checker FLAG: parity with copy button) |
| Badge micro-padding on-grid: `px-2 py-1` (8/4 px) replaces `px-1.5 py-0.5` | Revision 2026-05-06 (ui-checker blocking issue: spacing 4-grid) |
| Resume-banner CTA `Weiter zu Schritt {N}` (step number injected) | Revision 2026-05-06 (ui-checker FLAG: explicit destination) |
| Hub-Tab Sync-now button copy `Jetzt synchronisieren` (German) | Revision 2026-05-06 (ui-checker FLAG: German consistency) |

---

## Revision Log

### 2026-05-06 — ui-checker blocking-issue resolution (round 1)

**Issue 1 — Font sizes reduced from 6 to 4.**
- Removed: `text-[10px]` and `text-[11px]` exceptions
- Final declared sizes: **12 / 14 / 16 / 24 px** (`text-xs` / `text-sm` / `text-base` / `text-2xl`)
- All previously-10/11px elements (snippet `#`-comment lines, "Adresse:" inline labels, drift-indicator delta text, event-type badges, third-party qualifier text, badge text, snapshot loading/empty captions) now use `text-xs` (12 px)

**Issue 2 — Font weights reduced from 3 to 2.**
- Declared for P22: `font-normal` (400) + `font-semibold` (600)
- `font-bold` (700) is **NOT introduced by P22**. It exists on the pre-existing `<h1>` in `kameras/+page.svelte:35` and is inherited verbatim. P22 introduces zero new `font-bold` usages. New page-level `<h1>` instances P22 introduces (all-urls page, hub-tab status panel) MUST use `font-semibold`.

**Non-blocking FLAGs addressed (round 1).**
- Step 3 CTA changed from bare `Weiter` to `Auswahl übernehmen` (explicit destination — advances to Step 4)
- Step 5 CTA changed from bare `Weiter` to `Zum Abschluss` (explicit destination — advances to Step 6)
- Snapshot reload button now declares `<span class="sr-only">Vorschau neu laden</span>` (mirrors copy-button parity)

### 2026-05-06 — ui-checker blocking-issue resolution (round 2)

**Issue — Spacing: badge micro-padding violates 4-grid.**
- Replaced all `px-1.5 py-0.5` (6/2 px — off-grid) with `px-2 py-1` (8/4 px — on-grid)
- Affected elements (3 badge tokens):
  - External cam `Protect Hub` primary badge
  - External cam `UniFi` / `Drittanbieter · {manufacturer}` qualifier (first-party, third-party, unknown)
  - Event-log event-type badges (`discover` / `reconcile` / `deploy` / `reload` / `error`)
- Visual impact: pills are 2 px taller; no other section requires changes
- Spacing scale doc updated to declare `px-2` and `py-1` explicitly under sm and xs tokens
- Spacing-exceptions doc updated to retire `px-1.5 py-0.5` micro-padding

**Non-blocking FLAGs addressed (round 2).**
- Resume-banner CTA changed from bare `Weiter` to `Weiter zu Schritt {N}` (step number injected at render — explicit destination, consistent with wizard CTA destination-explicitness)
- Hub-Tab Sync-now button copy changed from English `Sync now` to German `Jetzt synchronisieren` (German-consistency with rest of contract)
- Accent reserved-for list updated to reflect new copy: `Jetzt synchronisieren` and `Weiter zu Schritt {N}`

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
