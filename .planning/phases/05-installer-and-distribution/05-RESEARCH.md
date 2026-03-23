# Phase 5: Installer and Distribution - Research

**Researched:** 2026-03-23
**Domain:** Proxmox host-level bash installer, cloud-init VM provisioning, API token management, app-level auth
**Confidence:** HIGH

## Summary

Phase 05 requires a fundamentally different installer than what was previously implemented. The old approach ran `curl | bash` inside an existing VM. The new approach runs `curl | bash` on the **Proxmox Host itself**, which then creates a VM, provisions the app inside it, and sets up API tokens so the VM can manage the host's LXC containers.

The technical approach is well-understood: download a Debian 12 cloud image, import it as a VM disk via `qm importdisk`, configure cloud-init for SSH access and first-boot provisioning, then SSH into the VM to install the app. Proxmox provides all necessary CLI tools (`qm`, `pveum`, `pvesh`) on the host. The auth system (setup/login/YOLO) was previously implemented and reverted -- it needs to be re-implemented.

**Primary recommendation:** Use Debian 12 genericcloud qcow2 image with cloud-init for VM creation. Use `cicustom` user-data with `runcmd` for app installation inside the VM. Create a dedicated `ipcm@pve` user with a scoped API token for least-privilege access.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Single command runs on the Proxmox host console: `curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh | bash`
- **D-02:** Script detects current state: no installation / existing VM / broken permissions
- **D-03:** Fresh install flow: security warning -> create VM -> install Node.js/clone/build/systemd -> create API token -> store token in VM's .env -> start app
- **D-04:** Update flow: detect existing VM -> SSH into VM -> git pull, npm install, build, restart -> re-create token if broken
- **D-05:** Uninstall flow: interactive menu when VM exists (Update / Remove / Cancel). Remove destroys VM and cleans up API token
- **D-06:** Permission repair: re-creates token and updates VM's .env if API access is broken
- **D-07:** Clear security warning before any action -- user must confirm
- **D-08:** API token has minimal necessary permissions (VM management, not full admin)
- **D-09:** Script explains what it will do before doing it
- **D-10:** VM based on Debian cloud image or minimal template
- **D-11:** VM gets a static IP or DHCP with hostname ip-cam-master
- **D-12:** App runs on port 80 inside VM (systemd, adapter-node)
- **D-13:** /dev/dri passthrough for VAAPI hardware acceleration (needed for go2rtc in LXC containers)
- **D-14:** Installer generates SSH key in VM for Proxmox host access
- **D-15:** Adds public key to Proxmox host's authorized_keys automatically
- **D-16:** Auto-restart on failure (RestartSec=5)
- **D-17:** Environment: NODE_ENV=production, PORT=80, DB_ENCRYPTION_KEY=(generated)
- **D-18:** ExecStart: node build/index.js
- **D-19:** .env generated with random DB_ENCRYPTION_KEY on fresh install
- **D-20:** SQLite DB in data/ -- preserved across updates
- **D-21:** drizzle-kit push runs on install AND update
- **D-22:** First start: setup screen with user/password fields + "Speichern"
- **D-23:** "YOLO" option -- skip login, app usable without auth
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

### Deferred Ideas (OUT OF SCOPE)
- Docker Compose alternative
- Auto-update check in the web UI
- Backup/restore of camera configurations
- LXC instead of VM (simpler but less isolated)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | One-line install command (`curl \| bash`) sets up app on a fresh Proxmox VM | Cloud-init VM creation workflow, qm/pvesh commands documented below |
| INST-02 | Installer handles all dependencies (Node.js, systemd service, SQLite) | Cloud-init runcmd provisioning installs everything inside the VM |
| INST-03 | Same command performs updates (detects existing install, pulls latest, restarts service) | VM detection via Proxmox tags (`pvesh get /cluster/resources`), SSH update flow |
| INST-04 | App runs as systemd service with automatic restart on failure | Existing ip-cam-master.service file pattern, adapted for VM context |
| INST-05 | Install script works on Debian/Ubuntu-based Proxmox VMs | Script runs on Proxmox host (Debian-based), creates Debian 12 VM |
</phase_requirements>

## Standard Stack

### Core (Proxmox Host CLI Tools)
| Tool | Available On | Purpose | Why Standard |
|------|-------------|---------|--------------|
| `qm` | PVE host | VM lifecycle (create, start, stop, destroy, config) | Official Proxmox QEMU Manager CLI |
| `pveum` | PVE host | User/token/ACL management | Official Proxmox User Manager CLI |
| `pvesh` | PVE host | REST API access from CLI | Official Proxmox Shell API client |
| `wget`/`curl` | PVE host | Download cloud images | Available on all Proxmox hosts |
| `jq` | Install if missing | JSON parsing for pvesh output | Standard for CLI JSON processing |

### Inside the VM
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| Node.js | 22 LTS | Runtime | Via NodeSource, per existing stack |
| npm | (bundled) | Package management | Comes with Node.js |
| git | (apt) | Clone/update repo | Standard |
| ffmpeg | (apt) | Camera probing/snapshots | Required by app |
| systemd | (built-in) | Process management | Standard on Debian 12 |

### Auth System (Inside App)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Node.js crypto (built-in) | N/A | scryptSync password hashing | Consistent with existing crypto.ts pattern |
| In-memory Map | N/A | Session storage | Acceptable for homelab, sessions expire on restart |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cloud-init cicustom | SSH-in after VM boots and run commands | cicustom is cleaner but more complex; SSH approach is simpler and debuggable |
| Debian genericcloud | Ubuntu cloud image | Debian matches Proxmox host OS, smaller image, no Canonical telemetry |
| DHCP | Static IP | DHCP is simpler but user may want predictable IP; ask during install |

## Architecture Patterns

### Installer Architecture (Host-Side Script)

```
install.sh (runs on Proxmox host)
├── detect_state()         # Check for existing VM via tags
├── fresh_install()        # Full VM creation + provisioning
│   ├── download_image()   # Debian 12 genericcloud qcow2
│   ├── create_vm()        # qm create + importdisk + cloud-init
│   ├── wait_for_vm()      # Poll until SSH available
│   ├── provision_app()    # SSH into VM, install deps, clone, build
│   ├── create_api_token() # pveum user/token/acl setup
│   └── inject_token()     # SSH: write token to VM's .env
├── update()               # SSH into existing VM, git pull, rebuild
├── repair_permissions()   # Re-create token if broken
└── uninstall()            # Destroy VM, remove user/token
```

### Pattern 1: VM Creation via Cloud-Init

**What:** Download Debian cloud image, import as disk, configure cloud-init, boot VM.

**When to use:** Fresh install only.

**Procedure:**
```bash
# 1. Get next available VMID
VMID=$(pvesh get /cluster/nextid)

# 2. Download Debian 12 cloud image (if not cached)
IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
IMG_PATH="/var/lib/vz/template/iso/debian-12-genericcloud-amd64.qcow2"
if [ ! -f "$IMG_PATH" ]; then
  wget -q "$IMG_URL" -O "$IMG_PATH"
fi

# 3. Create VM
qm create "$VMID" \
  --name ip-cam-master \
  --tags ip-cam-master \
  --memory 2048 \
  --cores 2 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci \
  --ostype l26 \
  --agent enabled=1

# 4. Import disk
qm set "$VMID" --scsi0 local-lvm:0,import-from="$IMG_PATH"

# 5. Add cloud-init drive
qm set "$VMID" --ide2 local-lvm:cloudinit

# 6. Configure boot and console
qm set "$VMID" --boot order=scsi0
qm set "$VMID" --serial0 socket --vga serial0

# 7. Resize disk (10GB should be sufficient)
qm disk resize "$VMID" scsi0 10G

# 8. Configure cloud-init
qm set "$VMID" --ciuser root
qm set "$VMID" --ipconfig0 ip=dhcp
qm set "$VMID" --sshkeys /root/.ssh/authorized_keys
# Or generate a dedicated key pair for the installer

# 9. Start VM
qm start "$VMID"
```
Source: [Proxmox Cloud-Init Support](https://pve.proxmox.com/wiki/Cloud-Init_Support)

### Pattern 2: VM Detection via Tags

**What:** Use Proxmox VM tags to detect existing IP-Cam-Master installation.

**When to use:** Every invocation of install.sh to determine mode.

```bash
detect_existing_vm() {
  local node
  node=$(hostname)

  # Search for VMs with tag 'ip-cam-master'
  VMID=$(pvesh get /cluster/resources --type vm --output-format json 2>/dev/null \
    | jq -r '.[] | select(.type=="qemu" and .tags!=null and (.tags | contains("ip-cam-master"))) | .vmid' \
    | head -1)

  if [ -n "$VMID" ] && [ "$VMID" != "null" ]; then
    echo "$VMID"
    return 0
  fi
  return 1
}
```
Source: [Proxmox forum - Using tags in CLI](https://forum.proxmox.com/threads/using-tags-in-cli.123368/)

### Pattern 3: API Token Creation with Least Privilege

**What:** Create a dedicated user + token with only the permissions the app needs.

**When to use:** Fresh install, permission repair.

```bash
# Create user (if not exists)
pveum user add ipcm@pve --comment "IP-Cam-Master service account" 2>/dev/null || true

# Create custom role with minimal permissions
pveum role add IPCamMaster --privs \
  "VM.Allocate VM.Audit VM.Config.Disk VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.PowerMgmt VM.Console Datastore.AllocateSpace Datastore.Audit SDN.Use" \
  2>/dev/null || true

# Create token (privsep=1 for separate permissions)
TOKEN_OUTPUT=$(pveum user token add ipcm@pve ipcm --privsep 1 --output-format json 2>/dev/null)
TOKEN_SECRET=$(echo "$TOKEN_OUTPUT" | jq -r '.value // .data.value')
TOKEN_ID="ipcm@pve!ipcm"

# Assign role on the node and storage paths
NODE=$(hostname)
pveum acl modify / --user ipcm@pve --role IPCamMaster
pveum acl modify /nodes/$NODE --tokens ipcm@pve!ipcm --role IPCamMaster
pveum acl modify /storage --tokens ipcm@pve!ipcm --role IPCamMaster
```
Source: [Proxmox pveum(1)](https://pve.proxmox.com/pve-docs/pveum.1.html), [Proxmox User Management](https://pve.proxmox.com/wiki/User_Management)

### Pattern 4: App-Level Auth (Re-implementation)

**What:** Setup/login/YOLO authentication flow using SvelteKit hooks.

**When to use:** D-22 through D-27.

This was previously implemented (commit `feccfe6`) and reverted (`20dd652`). Re-implement with the same architecture:

```
src/lib/server/services/auth.ts    # hashPassword, verifyPassword, sessions
src/hooks.server.ts                 # Auth middleware (check session, redirect)
src/routes/setup/                   # First-run setup page
src/routes/login/                   # Login page
```

Key patterns from previous implementation:
- `scryptSync` for password hashing (consistent with existing `crypto.ts`)
- In-memory `Map<string, Session>` for session storage
- `auth_yolo` setting in DB to skip all auth
- Single `users` table with upsert semantics (D-27)
- hooks.server.ts checks: no user + no YOLO -> redirect to `/setup`; user exists + no session -> redirect to `/login`

### Pattern 5: SSH into VM After Boot

**What:** Wait for VM to be accessible, then SSH in for provisioning.

```bash
wait_for_ssh() {
  local ip="$1"
  local max_attempts=30
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 \
         -i "$SSH_KEY" root@"$ip" "echo ok" 2>/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}
```

### Anti-Patterns to Avoid

- **Hardcoding VMID:** Use `pvesh get /cluster/nextid` to get next available ID. Never assume a VMID is free.
- **Full admin token:** Never use `--privsep 0` or assign Administrator role. Create a custom role with only needed privileges.
- **Assuming storage name:** Detect available storage with `pvesh get /nodes/$NODE/storage --output-format json`. The default may be `local-lvm`, `local`, or custom names.
- **Skipping cloud-init drive:** Without `--ide2 local-lvm:cloudinit`, the VM won't get SSH keys or network config.
- **Ignoring QEMU guest agent:** Install `qemu-guest-agent` in the VM for `qm guest exec` and proper IP reporting via `qm agent $VMID network-get-interfaces`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VM creation | Custom API calls | `qm create` + cloud-init | Handles disk, network, boot config in one flow |
| Token management | Manual file editing | `pveum user token add` | Proper ACL integration, returns secret exactly once |
| Password hashing | Custom hash function | `crypto.scryptSync` | Already used in codebase, timing-safe comparison |
| Session management | Database sessions | In-memory Map | Homelab tool, sessions lost on restart is acceptable |
| VM IP discovery | IP scanning | `qm agent $VMID network-get-interfaces` or cloud-init DHCP | QEMU guest agent reports actual IP reliably |
| Next VMID | Manual ID selection | `pvesh get /cluster/nextid` | Cluster-safe, avoids conflicts |

**Key insight:** The Proxmox host already has all the CLI tools needed. The installer is a bash script orchestrating these tools, not a custom application.

## Common Pitfalls

### Pitfall 1: Storage Backend Mismatch
**What goes wrong:** `qm set --scsi0 local-lvm:0,import-from=...` fails because the storage is named differently (e.g., `local`, `zfs-pool`, `ceph`).
**Why it happens:** Proxmox installations vary widely in storage configuration.
**How to avoid:** Detect the first available storage that supports `images` content type:
```bash
STORAGE=$(pvesh get /nodes/$NODE/storage --output-format json \
  | jq -r '[.[] | select(.content | contains("images"))] | .[0].storage')
```
**Warning signs:** Error message containing "storage 'local-lvm' does not exist".

### Pitfall 2: Cloud Image Not Booting (No Serial Console)
**What goes wrong:** VM created from cloud image shows blank/black screen, appears stuck.
**Why it happens:** Many cloud images require serial console (`--serial0 socket --vga serial0`). Without it, there's no console output.
**How to avoid:** Always add `--serial0 socket --vga serial0` to the VM config.
**Warning signs:** VM status shows "running" but no SSH access or console output.

### Pitfall 3: Token Secret Lost
**What goes wrong:** API token secret is shown only once during creation. If not captured, it's gone.
**Why it happens:** Proxmox never stores or displays the secret again after initial creation.
**How to avoid:** Capture output immediately: `TOKEN_OUTPUT=$(pveum user token add ... --output-format json)`. If the token already exists but secret is lost, delete and recreate: `pveum user token remove ipcm@pve ipcm && pveum user token add ipcm@pve ipcm --privsep 1`.
**Warning signs:** App shows "401 Unauthorized" when connecting to Proxmox.

### Pitfall 4: GPU Passthrough Complexity for VMs
**What goes wrong:** Attempting full iGPU passthrough to the IP-Cam-Master VM requires IOMMU, driver blacklisting, and complex configuration.
**Why it happens:** The VM itself does not need GPU -- the LXC containers need `/dev/dri` which they get from the Proxmox host directly.
**How to avoid:** Do NOT configure GPU passthrough for the IP-Cam-Master VM. The VM only manages LXC containers via Proxmox API. The LXC containers get `/dev/dri` passthrough from the host directly (already handled by the app's container creation code in `proxmox.ts`).
**Warning signs:** D-13 mentions `/dev/dri passthrough` but this refers to the LXC containers the app creates, NOT the VM itself.

### Pitfall 5: SSH Key Confusion (Two Separate Key Pairs)
**What goes wrong:** Confusing the host-to-VM key (for installer provisioning) with the VM-to-host key (for app's SSH access to Proxmox).
**Why it happens:** There are two different SSH relationships:
1. **Host -> VM:** Installer uses this to SSH into the VM during provisioning. Set via cloud-init `--sshkeys`.
2. **VM -> Host:** App uses this to SSH into Proxmox host to manage LXC containers (D-14, D-15).
**How to avoid:** Generate both key pairs explicitly. Host key can be the root's existing key. VM-to-host key is generated inside the VM and its public key is added to the host's `authorized_keys`.

### Pitfall 6: pveum Token Output Format
**What goes wrong:** Parsing the token secret from `pveum user token add` output fails.
**Why it happens:** Default output is a text table, not easily parseable. JSON output format varies between PVE versions.
**How to avoid:** Use `--output-format json` and parse with `jq -r '.value'`. Test on target PVE version.
**Warning signs:** Token variable is empty or contains table formatting characters.

## Code Examples

### Complete VM Creation Sequence
```bash
# Source: Proxmox Cloud-Init docs + community best practices

NODE=$(hostname)
VMID=$(pvesh get /cluster/nextid)
VM_NAME="ip-cam-master"
IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
IMG_PATH="/var/lib/vz/template/iso/debian-12-genericcloud-amd64.qcow2"

# Detect storage
STORAGE=$(pvesh get /nodes/$NODE/storage --output-format json \
  | jq -r '[.[] | select(.content | contains("images"))] | .[0].storage')

# Download image (cached)
[ -f "$IMG_PATH" ] || wget -q --show-progress "$IMG_URL" -O "$IMG_PATH"

# Create VM
qm create "$VMID" \
  --name "$VM_NAME" \
  --tags "$VM_NAME" \
  --memory 2048 --cores 2 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci \
  --ostype l26 \
  --agent enabled=1

# Import disk + cloud-init
qm set "$VMID" --scsi0 "$STORAGE:0,import-from=$IMG_PATH"
qm set "$VMID" --ide2 "$STORAGE:cloudinit"
qm set "$VMID" --boot order=scsi0
qm set "$VMID" --serial0 socket --vga serial0

# Resize to 10GB
qm disk resize "$VMID" scsi0 10G

# Cloud-init config
qm set "$VMID" --ciuser root --ipconfig0 ip=dhcp
# SSH key for host -> VM access
qm set "$VMID" --sshkeys /root/.ssh/id_rsa.pub

# Start
qm start "$VMID"
```

### Get VM IP After Boot
```bash
# Source: Proxmox qm(1) documentation

get_vm_ip() {
  local vmid="$1"
  local max=30
  local i=0

  while [ $i -lt $max ]; do
    local ip
    ip=$(qm agent "$vmid" network-get-interfaces 2>/dev/null \
      | jq -r '.[] | select(.name != "lo") | .["ip-addresses"][]? | select(.["ip-address-type"] == "ipv4") | .["ip-address"]' \
      | head -1)

    if [ -n "$ip" ] && [ "$ip" != "null" ]; then
      echo "$ip"
      return 0
    fi
    i=$((i + 1))
    sleep 5
  done
  return 1
}
```

### Provision App Inside VM via SSH
```bash
# Source: Project-specific, based on existing install.sh patterns

provision_vm() {
  local ip="$1"
  local ssh_cmd="ssh -o StrictHostKeyChecking=no -i /root/.ssh/id_rsa root@$ip"

  $ssh_cmd bash <<'REMOTE_SCRIPT'
set -euo pipefail

# Install dependencies
apt-get update -qq
apt-get install -y -qq curl git ffmpeg qemu-guest-agent > /dev/null 2>&1

# Node.js 22 LTS
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
fi

# Clone and build
git clone https://github.com/meintechblog/ip-cam-master.git /opt/ip-cam-master
cd /opt/ip-cam-master
npm install --omit=dev
mkdir -p data

# Generate .env
DB_ENCRYPTION_KEY=$(openssl rand -hex 32)
cat > .env <<EOF
DB_ENCRYPTION_KEY=$DB_ENCRYPTION_KEY
EOF

# Build
npm run build

# DB migration
npx drizzle-kit push

# systemd
cp ip-cam-master.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable ip-cam-master

# Generate SSH key for VM -> Proxmox host access
mkdir -p /root/.ssh
ssh-keygen -t ed25519 -f /root/.ssh/ip-cam-master -N "" -q
cat /root/.ssh/ip-cam-master.pub
REMOTE_SCRIPT
}
```

### API Token Injection
```bash
# After creating token on host, inject into VM's .env

inject_token() {
  local ip="$1"
  local host_ip="$2"
  local token_id="$3"
  local token_secret="$4"
  local ssh_cmd="ssh -o StrictHostKeyChecking=no -i /root/.ssh/id_rsa root@$ip"

  # Append Proxmox settings to .env (app reads from settings DB, but
  # we also pre-seed via the settings API or direct DB insert)
  $ssh_cmd bash <<REMOTE
cd /opt/ip-cam-master

# The app reads settings from SQLite via the settings service.
# We need to insert the Proxmox connection settings directly.
# Use node to run a quick script that uses the app's settings service.
node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/ip-cam-master.db');
const now = new Date().toISOString();
const upsert = db.prepare('INSERT INTO settings (key, value, encrypted, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?');
upsert.run('proxmox_host', '$host_ip', now, '$host_ip', now);
upsert.run('proxmox_token_id', '$token_id', now, '$token_id', now);
upsert.run('proxmox_token_secret', '$token_secret', now, '$token_secret', now);
"

systemctl start ip-cam-master
REMOTE
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Install script runs IN a VM | Install script runs ON Proxmox host, creates VM | Context revision 2026-03-23 | Completely different installer architecture |
| Auth implemented + reverted | Needs re-implementation | Reverted at `20dd652` | Same patterns apply, can reference old commits |
| Manual API token setup | Automated by installer | This phase | User no longer manually configures Proxmox connection |

**Important context:** The auth system (D-22 through D-27) was fully implemented in commits `4831746`/`feccfe6` and then reverted in `20dd652`. The same patterns and architecture should be re-used. Key decisions from the previous implementation:
- scryptSync for password hashing
- In-memory session Map
- YOLO mode via `auth_yolo` setting
- Single users table with upsert

## Open Questions

1. **Cloud-init vs SSH provisioning**
   - What we know: Cloud-init `cicustom` with `runcmd` can run installation commands on first boot. SSH-based provisioning waits for boot then runs commands remotely.
   - What's unclear: Whether cicustom user-data snippets storage is reliably available on all Proxmox setups (requires snippets content type on storage).
   - Recommendation: Use SSH-based provisioning (wait for VM to boot, SSH in, run commands). It's simpler, more debuggable, and doesn't depend on storage configuration supporting snippets. Cloud-init is used only for basic config (SSH key, network, hostname).

2. **DHCP vs Static IP**
   - What we know: DHCP is simpler but the user may want a predictable IP for bookmarking.
   - What's unclear: Whether the user's DHCP server will reliably assign the same IP.
   - Recommendation: Default to DHCP. The script prints the assigned IP at the end. Optionally ask "Enter static IP or press Enter for DHCP" during install.

3. **Storage detection reliability**
   - What we know: Storage names vary across Proxmox installations (local-lvm, local, ceph, zfs).
   - What's unclear: Edge cases with exotic storage configurations.
   - Recommendation: Auto-detect storage that supports `images` content type. Fall back to asking the user if none found or multiple options exist.

4. **Token output format across PVE versions**
   - What we know: `pveum user token add --output-format json` returns the secret.
   - What's unclear: Exact JSON structure may vary between PVE 7 and PVE 8.
   - Recommendation: Parse with `jq`, test on PVE 8.x (current target). Add error handling if secret parsing fails.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | vite.config.ts (test.include: src/**/*.test.ts) |
| Quick run command | `npx vitest --run` |
| Full suite command | `npx vitest --run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INST-01 | install.sh is valid bash, contains VM creation commands | smoke | `bash -n install.sh` | Will create |
| INST-02 | install.sh installs Node.js, ffmpeg, systemd service | smoke | `grep -q "nodesource\|apt-get\|systemctl" install.sh` | Will create |
| INST-03 | install.sh detects existing VM and runs update flow | smoke | `grep -q "update\|git pull" install.sh` | Will create |
| INST-04 | systemd service file has Restart=on-failure | smoke | `grep -q "Restart=on-failure" ip-cam-master.service` | Exists |
| INST-05 | Script targets Debian (apt-get based) | smoke | `grep -q "apt-get" install.sh` | Will create |
| D-22/D-27 | Auth service: hash, verify, session, YOLO | unit | `npx vitest --run src/lib/server/services/auth.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest --run`
- **Per wave merge:** `npx vitest --run && bash -n install.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/server/services/auth.test.ts` -- covers auth service (hashPassword, verifyPassword, sessions, YOLO)
- [ ] `bash -n install.sh` -- syntax validation for the bash installer

## Sources

### Primary (HIGH confidence)
- [Proxmox Cloud-Init Support](https://pve.proxmox.com/wiki/Cloud-Init_Support) -- Official VM creation with cloud-init workflow
- [Proxmox qm(1)](https://pve.proxmox.com/pve-docs/qm.1.html) -- Official qm command reference
- [Proxmox pveum(1)](https://pve.proxmox.com/pve-docs/pveum.1.html) -- Official user/token management reference
- [Proxmox User Management](https://pve.proxmox.com/wiki/User_Management) -- Roles, ACLs, token privileges
- [Proxmox PCI Passthrough](https://pve.proxmox.com/wiki/PCI_Passthrough) -- Confirmed GPU passthrough is KVM-only, LXC uses host drivers directly
- [Debian Cloud Images](https://cloud.debian.org/images/cloud/bookworm/latest/) -- debian-12-genericcloud-amd64.qcow2 (332MB, 2026-03-16)
- Existing codebase: `src/lib/server/services/proxmox.ts` -- uses `proxmox_token_id` and `proxmox_token_secret` settings
- Git history: commits `feccfe6` (auth implementation), `20dd652` (auth revert) -- proven auth patterns

### Secondary (MEDIUM confidence)
- [Proxmox forum - Using tags in CLI](https://forum.proxmox.com/threads/using-tags-in-cli.123368/) -- Tag-based VM detection
- [Proxmox forum - QM Create using next available VMID](https://forum.proxmox.com/threads/qm-create-using-the-next-available-vmid-cli.123873/) -- `pvesh get /cluster/nextid`
- [Proxmox forum - API token permission to create VMs](https://forum.proxmox.com/threads/api-token-permission-to-create-vms.130337/) -- Token permission patterns
- [Creating Debian 12 Cloud-Init Templates](https://spiffyeight77.com/posts/all/2025/08/creating-debian-12-cloud-init-templates-proxmox-ve/) -- Complete template workflow

### Tertiary (LOW confidence)
- [Proxmox forum - VAAPI in a VM](https://forum.proxmox.com/threads/vaapi-in-a-vm.40770/) -- Confirmed: VM does NOT need GPU passthrough for this use case

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Proxmox CLI tools are well-documented, cloud-init is standard
- Architecture: HIGH -- Cloud image + cloud-init + SSH provisioning is proven pattern
- Pitfalls: HIGH -- Storage detection, token handling, GPU confusion all verified against official docs
- Auth system: HIGH -- Previously implemented and tested, patterns proven in git history

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (Proxmox tools are stable, Debian cloud images update regularly)
