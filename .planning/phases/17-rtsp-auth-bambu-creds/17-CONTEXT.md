# Phase 17: RTSP Auth + Bambu Credentials Management — Context

**Gathered:** 2026-04-20
**Status:** Ready to implement (incremental)

<domain>
## Phase Boundary

Zwei zusammenhängende Verbesserungen am Camera-Stream-Stack:

1. **RTSP-Auth auf go2rtc aktivieren** — go2rtc's eingebauter `rtsp.username/password` bekommt pro Container die Original-Kamera-Credentials. Beim Protect-Adoption-Flow gibt der User dieselben Creds ein, Protect verifiziert gegen go2rtc beim RTSP-Pull. Ergebnis: echte Zugriffskontrolle, nicht nur „Protect ist glücklich".

2. **Bambu-Credentials-Verwaltung in Settings** — aktuell werden Mobotix/Loxone-Creds in der `credentials`-Tabelle gespeichert (username/password). Für Bambu-Drucker brauchen wir eine analoge Ablage (serial_number + access_code). Im Bambu-Onboarding-Wizard können gespeicherte Creds dann wie bei den anderen Typen vorausgewählt werden.

**Out of Scope:**
- Fork oder Patch am `onvif-server` (nicht nötig — go2rtc ist der RTSP-Gatekeeper)
- Auth für die go2rtc HTTP-API auf Port 1984 (getrennter Concern, könnte Phase 18 werden)
- Zertifikat-basierte Auth / RTSPS-TLS (go2rtc kann das, aber Protect erwartet RTSP plain mit Basic/Digest)

</domain>

<decisions>
## Implementation Decisions

### Auth-Mechanismus (RTSP)
- **D-01:** go2rtc's nativer `rtsp.username/password`-Block (keine nginx/proxy-Kette nötig). Nachgewiesen in upstream Doku: `rtsp.username` und `rtsp.password` im YAML aktivieren RTSP-Auth auf Port 8554.
- **D-02:** Pro Container **eigene** Creds (nicht global), weil jede Kamera ihre eigenen Original-Credentials hat und diese 1:1 übernommen werden sollen.
- **D-03:** Credential-Quelle pro Kameratyp:
  - **Mobotix / Loxone:** `cameras.username` + `decrypt(cameras.password)`
  - **Bambu:** `cameras.serial_number` (als Username) + `decrypt(cameras.access_code)` (als Passwort)

### Datenmodell
- **D-04:** Neue Spalte `rtsp_auth_enabled` (boolean, default `false`) in `cameras`. Alt-Kameras bleiben auf `false` bis der User explizit opt-in macht (Migration-UX). Neue Onboardings setzen auf `true`.
- **D-05:** `credentials`-Tabelle erweitern: neue Spalte `type` (text, default `'mobotix'`), zusätzlich nullable `serial_number` und `access_code` (encrypted, analog zu `cameras`). Valide Werte: `'mobotix'` (bestehend, namens-historisch für HTTP-Basic-Auth), `'bambu'`.
  - Bestehende Zeilen: `type` default auf `'mobotix'` → keine Breaking-Change
  - `password`-Spalte bleibt NOT NULL — Bambu-Zeilen legen den `access_code` dort rein für Backward-Compat (oder wir machen eine eigene Spalte; Entscheidung im PLAN)

### Migration bestehender Kameras
- **D-06:** Keine Zwangs-Migration. Bestehende Adoptionen in Protect bleiben funktional. Jede Kamera bekommt auf der Detail-Card einen Button "RTSP-Auth aktivieren" der:
  1. `rtsp_auth_enabled = true` setzt
  2. go2rtc.yaml neu generiert und in den Container pusht
  3. go2rtc im Container restartet
  4. User-Hinweis: "Protect-Adoption muss erneuert werden" mit Button zu Protect-UI
- **D-07:** Dieselbe Button-Logik als Bulk-Action im Kamera-Dashboard (optional, falls einfach) — "Alle Kameras absichern".

### UI-Anreicherung
- **D-08:** Camera-Detail-Card zeigt bei aktiviertem Auth:
  - Username (camera.username oder serial_number)
  - Password (maskiert, mit "Zeigen"-Toggle oder Copy-Button)
  - Labels: "Für Protect-Adoption verwenden"
- **D-09:** RTSP-URL-Bar rendert mit embedded Creds wenn auth aktiv (`rtsp://user:pass@host:8554/cam-XXXX`). Nur in session-authentifizierter UI sichtbar (ohnehin). Fallback ohne Creds wenn auth aus.
- **D-10:** Bestehender ONVIF-Bar (aus Phase 16-Follow-up) bleibt wie er ist — keine Creds dort, weil der onvif-server keine Auth prüft (Protect sendet sie nur an den RTSP-Endpunkt).

### Bambu Creds in Settings
- **D-11:** CredentialsTab.svelte bekommt einen Typ-Switch (Radio/Tab): "Mobotix/Loxone (HTTP-Basic)" vs "Bambu (Serial + Access Code)". Formularfelder ändern sich passend.
- **D-12:** Bambu-Creds bekommen ein eigenes Präfix / Icon im Listen-View, damit klar ist welche Type. Prioritäts-Ordering bleibt pro Typ getrennt.
- **D-13:** `api/credentials` POST/PUT akzeptiert `type`-Feld. `api/credentials/test` wird nicht für Bambu verwendet — dafür baut der Bambu-Onboarding-Wizard seinen eigenen Pre-Flight.

### Sicherheit / Nicht-Ziele
- **D-14:** Die Creds landen in go2rtc.yaml **im Klartext** auf der LXC-Disk (`/etc/go2rtc/go2rtc.yaml`). Das ist der Status Quo — die Kamera-Creds stehen schon jetzt im Klartext im go2rtc-Stream-URL-Feld (`ffmpeg:http://admin:june11@...`). Kein neues Attack-Surface.
- **D-15:** Wir **erzwingen nicht** Re-Adoption. Wenn der User nie den "Aktivieren"-Button drückt, bleibt alles wie bisher. Der User entscheidet wann.

### Claude's Discretion
- Name des neuen API-Endpoints für opt-in Migration (`POST /api/cameras/:id/enable-rtsp-auth` oder ähnlich)
- Wortlaut der "Protect muss neu adoptiert werden"-Warning
- Ob der Bambu-Access-Code im Klartext oder maskiert in Settings angezeigt wird (wohl maskiert mit "Zeigen")
- Exakte Schema-Migration: ob `credentials.password` wiederverwendet wird für Bambu-access_code oder dedizierte `bambu_access_code`-Spalte

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing code
- `src/lib/server/services/go2rtc.ts` — Stream config generators (`generateGo2rtcConfig` Mobotix/Loxone, `generateGo2rtcConfigBambu`, `generateGo2rtcConfigLoxone`)
- `src/lib/server/services/onboarding.ts` §268-470 — `configureGo2rtc()` and `configureOnvif()`; Status-Transition-Maschine
- `src/lib/server/db/schema.ts:31-58` — `cameras`-Schema; `:60-68` — `credentials`-Schema
- `src/lib/components/settings/CredentialsTab.svelte` — UI für Credentials
- `src/lib/components/cameras/CameraDetailCard.svelte` — Detail-Card, bereits ONVIF-Bar (neu) + RTSP-Bar
- `src/routes/api/credentials/+server.ts` und `src/routes/api/credentials/test/+server.ts` — Credentials-API

### External specs
- go2rtc Upstream README (github.com/AlexxIT/go2rtc): RTSP-Auth-Config `rtsp.username/password`
- onvif-server README (daniela-hase/onvif-server): dokumentiert dass der onvif-server KEIN Auth verlangt — Protect-Adoption-Dialog-Creds werden nur für den Downstream-RTSP-Stream verwendet

### Research context in this phase
Siehe Discussion mit User 2026-04-20: onvif-server hat defenitiv keine Auth-Config (v1.0.0, upstream unverändert seit 2024, alle Forks bestätigen dies). Auth-Flow läuft über die von GetStreamUri zurückgegebene RTSP-URL → Protect öffnet diesen RTSP-Endpunkt mit den vom User eingegebenen Creds → go2rtc verifiziert dort.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable
- `crypto.ts` `encrypt`/`decrypt` — schon für Passwörter/Access-Codes in cameras-Tabelle verwendet
- `pushFileToContainer` + `executeOnContainer` in `ssh.ts` — standard Push-via-SSH-Pattern, schon von onboarding.ts genutzt → für go2rtc.yaml-redeploy wiederverwenden
- `CAMERA_STATUS` State-Machine — evtl. neuer Status `'rtsp_auth_enabled'` oder besser: `rtsp_auth_enabled` separater Boolean (flexibler)

### Patterns
- Drizzle-Migrations werden bisher über `npx drizzle-kit push` zur Laufzeit auf der VM ausgeführt (in `install.sh`). Für Schema-Änderungen Phase 17 kann derselbe Mechanismus verwendet werden — keine manuelle SQL-Migration nötig.
- Copy-Button-Pattern mit `navigator.clipboard.writeText` und 2s-Check-Icon → schon etabliert (Phase-16-Follow-up `copyOnvif`).

### Integration Points
- Onboarding-Wizard Step 4 (configure-go2rtc) → da muss der neue Config-Generator-Pfad rein
- Detail-Card Protect-Section → "RTSP-Auth aktivieren"-Button + Adoption-Creds-Display
- Settings > Credentials → neue Typ-Switch-UI

</code_context>

<specifics>
## Specific Ideas

- User-Zitat: **"Seriennummer als Benutzername und Zugangscode als Passwort"** für Bambu → D-03.
- User-Zitat: **"RTSP-Stream-URL mit Creds, weil App session-authentifiziert ist"** → D-09.
- User-Wille: **"mega geil umgesetzt"** → keine halbfertigen Teile, keine Breaking-Changes für bestehende Kameras, saubere Migration-UX mit Opt-In.

</specifics>

<deferred>
## Deferred Ideas

- **go2rtc HTTP-API-Auth (Port 1984)** — ist aktuell ohne Auth, hat Snapshots und Stream-Probe-Endpoints. Eigene Phase, weil es Nebenwirkungen auf die App-interne Health-Checks hätte.
- **RTSPS (RTSP-over-TLS)** — go2rtc kann das, aber Protect 5.0.34 unterstützt nur plain RTSP für 3rd-Party-Adoption (laut onvif-server-README und Erfahrung). Verschieben bis Protect hier nachrüstet.
- **Bulk "Alle Kameras absichern"-Button** — nice to have, aber erst nach individueller Opt-in-UX (damit der User sich nicht selbst in die Ecke malt wenn er nicht alle Protect-Adoptionen nacheinander erneuern will).
- **Auth-Test bei "RTSP-Auth aktivieren"-Button** — vor dem Redeploy einen Dry-Run-RTSP-Pull mit den Creds, um sicherzugehen. Optional, kann folgen wenn Feature live ist.

</deferred>

---

*Phase: 17-rtsp-auth-bambu-creds*
*Context gathered: 2026-04-20*
