# Phase 18: Bambu Lab A1 Camera Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 18-bambu-a1-camera-integration
**Areas discussed:** Stream-Pipeline-Topologie, A1 Idle-UX (0.45 fps), Cloud-Mode-Handling (tutk_server), UI-Gating-Strategie für Model-Felder

---

## Stream-Pipeline-Topologie

### Q1: Wie soll der JPEG-Stream in go2rtc landen?

| Option | Description | Selected |
|--------|-------------|----------|
| go2rtc exec: + Node-Script | go2rtc spawnt unser Node-Script, das MJPEG auf stdout ausgibt. Gleiches Muster wie Loxone. Ein Prozess weniger, sauberes Restart-Verhalten. | ✓ |
| Node-Service → lokales RTSP → go2rtc | Separater Node-Service publisht RTSP auf 127.0.0.1:8553. Mehr Flexibilität, aber zwei systemd-Units. | |
| Node → ffmpeg → RTSP direkt (go2rtc skippen) | A1 läuft komplett outside go2rtc. Bricht die "go2rtc is sole RTSPS consumer"-Regel. | |
| Du entscheidest | Claude wählt beim Planen. | |

**User's choice:** go2rtc exec: + Node-Script
**Notes:** Reuses Loxone pattern verbatim; keeps go2rtc's health API + Phase-14 adaptive toggle semantics.

### Q2: Wo läuft das A1-Ingestion-Node-Script?

| Option | Description | Selected |
|--------|-------------|----------|
| Im LXC-Container | Script deployed pro Kamera ins selbe LXC wie go2rtc. Konsistent mit "one container per camera". | ✓ |
| Auf der App-VM | Script läuft zentral, füttert mehrere LXCs. Verletzt Isolation. | |

**User's choice:** Im LXC-Container
**Notes:** Deployment via existing SSH pattern used for Mobotix/Loxone configs.

---

## A1 Idle-UX (0.45 fps-Problem)

### Q1: Was soll der A1 bei Idle im UniFi Protect Feed zeigen?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase-14-Adaptive: Stream OFF bei Idle | go2rtc stoppt im Idle, Protect zeigt "offline" — wie H2C. Dashboard pullt Einzelbild direkt. | ✓ |
| Always-live, native ~0.45 fps | Protect bekommt kontinuierlich 0.45 fps. Wirkt wie Diashow. | |
| Always-live mit ffmpeg Frame-Padding | ffmpeg `-vsync cfr -r 5` dupliziert Frames. Fake-Smooth, Motion-Detection-Risiko. | |
| Du entscheidest | Claude wählt beim Planen. | |

**User's choice:** Phase-14-Adaptive: Stream OFF bei Idle
**Notes:** Konsistent mit H2C, vermeidet Slideshow-Effekt, reuse des existierenden Adaptive-Frameworks.

### Q2: Was soll die UI bei Idle-A1 zeigen?

| Option | Description | Selected |
|--------|-------------|----------|
| Live Einzelbild via on-demand Snapshot | Server triggert einzelnen :6000-Pull, zeigt aktuelles JPEG. "Letztes Bild: vor Xs". | ✓ |
| Letztes Live-Frame (gecached) | Gecachtes Frame vom letzten Druck. Kann stunden-/tagealt sein. | |
| Nur Status-Text, kein Bild | "Drucker idle — kein Livebild". Minimalstes UX. | |

**User's choice:** Live Einzelbild via on-demand Snapshot
**Notes:** Neuer Endpoint `GET /api/cameras/:id/a1-snapshot`. On-demand = kein Dauer-Traffic.

---

## Cloud-Mode-Handling (tutk_server)

### Q1: Was soll Preflight machen wenn `tutk_server = "enable"`?

| Option | Description | Selected |
|--------|-------------|----------|
| Preflight hart blockieren | Neuer Fehler `A1_CLOUD_MODE_ACTIVE` mit dt. Hinweis. Kamera nicht adopted bis Cloud aus. | ✓ |
| Nur warnen, nicht blockieren | Warnung, aber User kann weiter. Kann zu stillen Dropouts führen. | |
| Ignorieren, nachträglich klassifizieren | Kein Vorab-Check. Spätes Auftauchen des Fehlers. | |

**User's choice:** Preflight hart blockieren
**Notes:** Verhindert unnötige LXC-Provisionierung für nicht-funktionierende Konfiguration.

### Q2: Runtime-Watch auf `tutk_server`?

| Option | Description | Selected |
|--------|-------------|----------|
| Ja, als Error-State im Dashboard | MQTT überwacht laufend. Wechsel auf enable → "Cloud-Mode aktiv". Auto-recovery. | ✓ |
| Nein, nur beim Preflight | Einmal checken, danach vertrauen. | |

**User's choice:** Ja, als Error-State im Dashboard
**Notes:** Reuses Phase-13 error-taxonomy shape. Auto-recovery wenn User Cloud wieder ausschaltet.

---

## UI-Gating-Strategie für Model-Felder

### Q1: Wo definieren wir Model-Capabilities?

| Option | Description | Selected |
|--------|-------------|----------|
| Zentrale `PRINTER_CAPABILITIES`-Map in bambu-discovery.ts | Single source of truth. Kommende Modelle = one-line-change. | ✓ |
| Hartcodiert `if model === 'A1'` in Komponenten | Simpel, aber verstreute Konditionals. | |
| Serverseitig aus Payload strippen | Frontend weiß gar nicht was es gibt. Verliert UI-Hinweise. | |

**User's choice:** Zentrale `PRINTER_CAPABILITIES`-Map in bambu-discovery.ts
**Notes:** API gibt `capabilities` mit Kamera zurück. Frontend liest daraus. Erweitert auf H2C/X1C/P1S/H2D für Konsistenz.

### Q2: Wie stellen wir sicher, dass die Auth-Byte-Layout-Falle nie wieder Regression wird?

| Option | Description | Selected |
|--------|-------------|----------|
| Unit-Test mit exakten Byte-Assertions | Vitest byte-for-byte Buffer assert + golden fixture. | ✓ |
| Nur Integrationstest gegen Mock-TLS-Server | Verhaltenstest, weniger klare Fehlermeldung. | |
| Beides | Doppelter Schutz. | |

**User's choice:** Unit-Test mit exakten Byte-Assertions
**Notes:** Golden fixture `a1-auth-packet.bin` für visual review committed.

---

## Claude's Discretion

- Exact preflight structure (model param vs site-level branch)
- Snapshot endpoint rate limiting / caching (2-s server-side cache suggested)
- Deploy mechanics for Node script into LXC (reuse existing SSH patterns)
- German hint wording polish
- Naming of `A1_CLOUD_MODE_ACTIVE` — may need model-agnostic rename if P1P/A1 mini show same TUTK behavior

## Deferred Ideas

- Live-print FPS measurement (follow-up UAT)
- A1 mini / P1P support (same protocol likely, not validated)
- FTPS:990 SD-card access (out of scope for v1.2)
- Peer cert CN-pinning (nice-to-have hardening)
- Full-snapshot-only mode without LXC (for never-active-print users)
- Model-agnostic rename of the TUTK error if a second model needs it
