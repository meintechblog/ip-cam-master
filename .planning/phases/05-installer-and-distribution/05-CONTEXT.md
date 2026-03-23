# Phase 5: Installer and Distribution - Context

**Gathered:** 2026-03-23 (revised)
**Status:** Ready for re-planning

<domain>
## Phase Boundary

One-line install command runs on the **Proxmox Host** itself (not in a VM). The script creates a VM on the Proxmox host, installs IP-Cam-Master inside it, and sets up all necessary permissions (API tokens) so the VM can control the Proxmox host. Same command handles updates, permission repair, and uninstall.

</domain>

<decisions>
## Implementation Decisions

### Install Concept (NEW — replaces old in-VM approach)
- **D-01:** Single command runs on the Proxmox host console: `curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh | bash`
- **D-02:** Script detects current state: no installation / existing VM / broken permissions
- **D-03:** Fresh install flow:
  1. Security warning: "This script will create a VM and grant it API access to this Proxmox host. Do you understand the risks? (y/N)"
  2. Creates a Debian/Ubuntu VM on the Proxmox host (via qm/pvesh)
  3. Installs Node.js 22 LTS, clones repo, npm install, builds, creates systemd service inside VM
  4. Creates Proxmox API token for the VM (PVEAPIToken) with necessary permissions
  5. Stores token in VM's .env automatically
  6. Starts the app — ready to use
- **D-04:** Update flow (VM already exists):
  1. Detects existing VM (by hostname, tag, or config marker)
  2. SSHs into VM, runs git pull, npm install, npm run build, restart service
  3. If Proxmox API token is broken/expired: re-creates token, updates .env in VM
- **D-05:** Uninstall flow (interactive option when VM exists):
  1. Asks: "Install already detected. Choose: [U]pdate / [R]emove / [C]ancel"
  2. Remove: destroys VM, removes API token from Proxmox host, cleans up
- **D-06:** Permission repair: if API access from VM doesn't work anymore, the install command re-creates the token and updates the VM's .env

### Security
- **D-07:** Clear security warning before any action — user must confirm
- **D-08:** API token has minimal necessary permissions (VM management, not full admin)
- **D-09:** Script explains what it will do before doing it

### VM Setup
- **D-10:** VM based on Debian cloud image or minimal template
- **D-11:** VM gets a static IP or DHCP with hostname ip-cam-master
- **D-12:** App runs on port 80 inside VM (systemd, adapter-node)
- **D-13:** /dev/dri passthrough for VAAPI hardware acceleration (needed for go2rtc)

### SSH Key Setup (VM to Proxmox Host)
- **D-14:** Installer generates SSH key in VM for Proxmox host access
- **D-15:** Adds public key to Proxmox host's authorized_keys automatically

### systemd Service (inside VM)
- **D-16:** Auto-restart on failure (RestartSec=5)
- **D-17:** Environment: NODE_ENV=production, PORT=80, DB_ENCRYPTION_KEY=(generated)
- **D-18:** ExecStart: node build/index.js

### DB & .env
- **D-19:** .env generated with random DB_ENCRYPTION_KEY on fresh install
- **D-20:** SQLite DB in data/ — preserved across updates
- **D-21:** drizzle-kit push runs on install AND update

### Zugangsschutz (App-Level Auth)
- **D-22:** First start: setup screen with user/password fields + "Speichern"
- **D-23:** "YOLO" option — skip login, app usable without auth
- **D-24:** Session-based login (cookie) after credentials set
- **D-25:** Settings page: change/remove credentials
- **D-26:** Password hashed (bcrypt/scrypt) in SQLite
- **D-27:** Single user only

### Claude's Discretion
- VM creation details (disk size, RAM, cores)
- Exact Proxmox API token permissions
- Network config approach (bridge, DHCP vs static)
- Cloud-init vs manual provisioning
- Error handling and rollback on failed install

</decisions>

<canonical_refs>
## Canonical References

### Existing codebase
- `CLAUDE.md` — Technology stack, adapter-node, systemd deployment notes
- `package.json` — Dependencies, build scripts
- `svelte.config.js` — adapter-node configuration
- `drizzle.config.ts` — Database configuration

### Proxmox APIs
- Proxmox VE API: `pvesh`, `qm` CLI tools on the host
- API token management: `/access/users/{user}/token/{token}`
- VM creation: `qm create`, cloud-init config

### Project context
- `.planning/PROJECT.md` — Distribution constraint: public GitHub repo, one-line install
- `.planning/REQUIREMENTS.md` — INST-01 through INST-05

</canonical_refs>

<specifics>
## Specific Ideas

- Install command: `curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh | bash`
- Should work on Proxmox VE 8.x (Debian 12 based)
- VM name/hostname: ip-cam-master
- VM tag for detection: ip-cam-master (Proxmox tags)
- ffmpeg must be installed in VM (camera probing/snapshots)
- The UDM SSH key setup belongs in the app Settings page (not installer) — SSH access can change anytime

</specifics>

<deferred>
## Deferred Ideas

- Docker Compose alternative — too complex for one-line install
- Auto-update check in the web UI
- Backup/restore of camera configurations
- LXC instead of VM (simpler but less isolated)

</deferred>

---

*Phase: 05-installer-and-distribution*
*Context gathered: 2026-03-23 (revised with Proxmox host installer concept)*
