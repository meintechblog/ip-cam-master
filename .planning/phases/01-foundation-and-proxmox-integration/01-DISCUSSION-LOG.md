# Phase 1: Foundation and Proxmox Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 01-foundation-and-proxmox-integration
**Areas discussed:** App-Navigation, Settings UI, Container-Ansicht, Proxmox Auth

---

## App-Navigation

### Navigation Style

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar links | Feste Sidebar links mit Icons + Labels (wie Proxmox UI, UniFi OS). Kollapsierbar auf Mobile. | |
| Top-Navigation | Horizontale Nav oben (wie viele Router-UIs). Einfacher, weniger Platz für viele Menüpunkte. | |
| Du entscheidest | Claude wählt basierend auf den Anforderungen | ✓ |

**User's choice:** Du entscheidest
**Notes:** User deferred to Claude's judgment

### Farbschema

| Option | Description | Selected |
|--------|-------------|----------|
| Dunkel (Recommended) | Dark Theme wie UniFi OS / Proxmox Dark Mode. Passt zu Infra-Tools. | ✓ |
| Hell | Light Theme, clean und modern | |
| Beides + Toggle | Dark/Light Mode umschaltbar | |

**User's choice:** Dunkel (Recommended)

### Hauptbereiche

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard | Kamera-Übersicht und Status | ✓ |
| Kameras | Kamera-Management, Onboarding, Container-Ansicht | ✓ |
| Settings | Proxmox-Config, UDM-Config, Credentials | ✓ |
| Logs/Status | System-Logs, Aktivität, Diagnosedaten | ✓ |

**User's choice:** All four selected

---

## Settings UI

### Settings Organisation

| Option | Description | Selected |
|--------|-------------|----------|
| Tabs (Recommended) | Tabs für Proxmox, UniFi, Credentials | ✓ |
| Separate Seiten | Jeder Bereich hat eine eigene Unterseite | |
| Eine Seite | Alles untereinander auf einer langen Seite | |

**User's choice:** Tabs (Recommended)

### Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Test-Button | Expliziter 'Verbindung testen' Button nach Eingabe | |
| Auto-Test | Automatisch testen beim Speichern, Feedback inline | ✓ |
| Beides | Auto-Test beim Speichern + manueller Test-Button jederzeit | |

**User's choice:** Auto-Test

### Ersteinrichtung

| Option | Description | Selected |
|--------|-------------|----------|
| Wizard (Recommended) | Schritt-für-Schritt beim ersten Start | |
| Direkt Settings | Einfach Settings-Seite öffnen, User füllt selbst aus | ✓ |

**User's choice:** Direkt Settings

---

## Container-Ansicht

### Darstellung

| Option | Description | Selected |
|--------|-------------|----------|
| Karten-Grid | Karten im Grid — eine Karte pro Container | ✓ |
| Tabelle/Liste | Tabellenansicht wie Proxmox | |
| Du entscheidest | Claude wählt das passende Layout | |

**User's choice:** Karten-Grid

### Aktionen

| Option | Description | Selected |
|--------|-------------|----------|
| Inline-Buttons | Direkt sichtbare Buttons pro Container (Play/Stop/Trash Icons) | ✓ |
| Kontextmenü | Drei-Punkte-Menü pro Container, Aktionen im Dropdown | |
| Du entscheidest | Claude wählt basierend auf dem Layout | |

**User's choice:** Inline-Buttons

### Container-Info

| Option | Description | Selected |
|--------|-------------|----------|
| Status | Running/Stopped/Error als farbiger Badge | ✓ |
| Kamera-Name + IP | Welche Kamera dieser Container bedient | ✓ |
| VMID + Hostname | Proxmox VMID und Container-Hostname | ✓ |
| Ressourcen | CPU/RAM-Nutzung (wenn verfügbar) | ✓ |

**User's choice:** All four selected

---

## Proxmox Auth

### Proxmox Authentifizierung

| Option | Description | Selected |
|--------|-------------|----------|
| API Token (Recommended) | Proxmox API Token (PVEAPIToken) | ✓ |
| Root SSH | SSH als root@proxmox | |
| Beides anbieten | User kann wählen | |

**User's choice:** API Token (Recommended)

### UDM Zugang

| Option | Description | Selected |
|--------|-------------|----------|
| SSH | SSH-Zugang für Log-Zugriff | |
| UniFi API | UniFi OS API — programmatisch | |
| Beides | SSH für Logs, API für Protect-Status | |

**User's choice:** Other — "eigentlich unifi api. wenn dort aber keine logs sind, nutze auch die ssh-funktion. aber nur für uns hier intern zum testen erstmal..."
**Notes:** Primary: UniFi OS API. SSH only as internal test fallback for log access. Not exposed in public distribution initially.

---

## Claude's Discretion

- Navigation layout style (sidebar vs top-nav)
- Component library and styling approach
- SQLite schema design
- Container card layout details
- Error/empty state designs
- Responsive behavior

## Deferred Ideas

- Setup wizard for first-time users — might revisit for Phase 5 installer experience
- Light/dark mode toggle — dark-only for now
