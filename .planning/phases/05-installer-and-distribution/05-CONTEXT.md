# Phase 5: Installer and Distribution - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

One-line install script (`curl | bash`) that sets up IP-Cam-Master from scratch on a Proxmox VM. Same command handles updates. App runs as systemd service on port 80. SSH key to Proxmox host configured during install.

</domain>

<decisions>
## Implementation Decisions

### Install Script
- **D-01:** Single `install.sh` script in the GitHub repo root — handles both fresh install and updates
- **D-02:** Detects existing installation (checks if /opt/ip-cam-master exists)
- **D-03:** Fresh install: clones repo, installs Node.js 22 LTS, npm install, creates .env, runs drizzle-kit push, creates systemd service, starts app
- **D-04:** Update: git pull, npm install, drizzle-kit push (auto-migration), restart service

### SSH Key Setup
- **D-05:** Installer asks for Proxmox host IP during install
- **D-06:** Generates SSH key (ed25519) if not exists
- **D-07:** Asks Proxmox root password once, runs ssh-copy-id automatically
- **D-08:** After key exchange, no password needed anymore

### Production Setup
- **D-09:** App runs on port 80 (HTTP standard) — no port number needed in browser
- **D-10:** Uses Node.js adapter-node with PORT=80 environment variable
- **D-11:** Requires root or setcap for port 80 — systemd runs as root (acceptable for homelab)
- **D-12:** No reverse proxy — app listens directly on port 80

### systemd Service
- **D-13:** Service file: /etc/systemd/system/ip-cam-master.service
- **D-14:** Auto-restart on failure (RestartSec=5)
- **D-15:** Environment: NODE_ENV=production, PORT=80
- **D-16:** WorkingDirectory=/opt/ip-cam-master
- **D-17:** ExecStart: node build/index.js (adapter-node output)

### DB Migrations
- **D-18:** drizzle-kit push runs automatically during install AND update
- **D-19:** SQLite DB preserved across updates (in /opt/ip-cam-master/data/)

### .env Generation
- **D-20:** Installer generates random DB_ENCRYPTION_KEY (64 hex chars) on fresh install
- **D-21:** Existing .env preserved during updates

### Zugangsschutz
- **D-22:** Beim ersten Start der App: Bildschirm mit User + Passwort Feldern + "Speichern" Button
- **D-23:** Alternativ: "YOLO" Button (gleicher Button, heisst "YOLO" wenn Felder leer) — App ohne Login nutzbar
- **D-24:** Wenn Login gesetzt: Session-basierter Login (Cookie), einfacher Login-Screen
- **D-25:** In Settings: Zugang anlegen/aendern/entfernen. Ganz rudimentaer, kein fancy UI
- **D-26:** Passwort gehasht in SQLite gespeichert (bcrypt oder scrypt)
- **D-27:** Nur ein User (kein Multi-User, kein Rollen-System)

### Claude's Discretion
- Exact install script structure and error handling
- Firewall configuration (ufw allow 80)
- Node.js version pinning strategy
- Build step (npm run build) for production
- Log rotation for systemd journal

</decisions>

<canonical_refs>
## Canonical References

### Existing codebase
- `CLAUDE.md` — Technology stack, adapter-node, systemd deployment notes
- `package.json` — Dependencies, build scripts
- `svelte.config.js` — adapter-node configuration
- `.env.example` — Required environment variables
- `drizzle.config.ts` — Database configuration

### Project context
- `.planning/PROJECT.md` — Distribution constraint: public GitHub repo, one-line install
- `.planning/REQUIREMENTS.md` — INST-01 through INST-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.env.example` already documents DB_ENCRYPTION_KEY
- `drizzle.config.ts` configured for SQLite in data/ directory
- `svelte.config.js` uses adapter-node
- `vite.config.ts` has server.allowedHosts for ip-cam-master.local

### Established Patterns
- App runs at /opt/ip-cam-master on the VM
- SQLite DB at data/ip-cam-master.db
- Node.js 22 LTS (already installed on VM)
- SSH key-based auth to Proxmox host (already working)

### Integration Points
- `npm run build` produces build/ directory (adapter-node)
- `node build/index.js` starts production server
- PORT env var controls listening port
- DB_ENCRYPTION_KEY env var required for crypto service

</code_context>

<specifics>
## Specific Ideas

- Install command: `curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh | bash`
- Should work on Debian 12/13 and Ubuntu 22.04+ (typical Proxmox VM base)
- ffmpeg needs to be installed on the VM too (for camera probing/snapshots)

</specifics>

<deferred>
## Deferred Ideas

- UniFi Protect log analysis (SSH to Dream Machine, parse camera disconnect patterns) — v2 MON-01..04
- Docker Compose alternative — too complex for one-line install, maybe v2
- Auto-update check in the web UI — nice-to-have for later
- Backup/restore of camera configurations — v2 ADV-03

</deferred>

---

*Phase: 05-installer-and-distribution*
*Context gathered: 2026-03-23*
