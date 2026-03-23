---
phase: 05-installer-and-distribution
plan: 02
subsystem: infra
tags: [bash, proxmox, cloud-init, vm-provisioning, installer, systemd]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "SvelteKit app with settings API, crypto encryption, systemd service"
  - phase: 05-installer-and-distribution (plan 01)
    provides: "Auth system (setup/login/YOLO) for first-run experience"
provides:
  - "One-line Proxmox host installer (curl | bash) that creates VM with app"
  - "Update flow via SSH into existing VM"
  - "Remove flow that destroys VM and cleans up tokens"
  - "Automated API token creation with least-privilege role"
  - "Bidirectional SSH key setup (host->VM for provisioning, VM->host for LXC management)"
affects: []

# Tech tracking
tech-stack:
  added: [cloud-init, qm, pveum, pvesh]
  patterns: [proxmox-host-installer, tag-based-vm-detection, ssh-provisioning]

key-files:
  created: []
  modified: [install.sh]

key-decisions:
  - "SSH-based provisioning over cloud-init cicustom (simpler, more debuggable)"
  - "Settings injected via app PUT /api/settings for proper AES-256-GCM encryption"
  - "Cleanup trap destroys partial VM on failed fresh install"
  - "Full npm install before build (devDeps needed), prune after"

patterns-established:
  - "Tag-based VM detection: pvesh get /cluster/resources filtered by tag"
  - "Dynamic storage detection: first storage with images content type"
  - "Installer SSH key at /root/.ssh/ipcm_installer on Proxmox host"

requirements-completed: [INST-01, INST-02, INST-03, INST-04, INST-05]

# Metrics
duration: 2min
completed: 2026-03-23
---

# Phase 05 Plan 02: Proxmox Host Installer Summary

**Bash installer that creates a Debian 12 VM on Proxmox host with full app provisioning, API token setup, and SSH key exchange**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-23T21:32:27Z
- **Completed:** 2026-03-23T21:34:44Z
- **Tasks:** 2 (1 implementation + 1 verification-only)
- **Files modified:** 1

## Accomplishments
- Complete rewrite of install.sh from in-VM installer to Proxmox host-level installer
- Three operational modes: fresh install (VM creation), update (SSH pull/rebuild), remove (destroy VM + cleanup)
- Automated API token creation with custom IPCamMaster role (least-privilege permissions)
- Bidirectional SSH key setup and settings injection via app API with encryption

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite install.sh as Proxmox host-level installer** - `c32ab98` (feat)
2. **Task 2: Update systemd service file for VM context** - no commit (verification-only, file already correct)

## Files Created/Modified
- `install.sh` - Complete Proxmox host installer with fresh install, update, and remove flows

## Decisions Made
- Used SSH-based provisioning instead of cloud-init cicustom runcmd (simpler, more debuggable, no snippets storage dependency)
- Settings injected via PUT /api/settings endpoint rather than direct DB writes (ensures proper AES-256-GCM encryption for sensitive keys like proxmox_token_secret)
- Added cleanup trap that destroys partially created VM on failure during fresh install
- Full npm install (not --omit=dev) before build since drizzle-kit and vite are devDependencies; npm prune --omit=dev runs after build and DB push

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used PUT instead of POST for settings API**
- **Found during:** Task 1
- **Issue:** Plan specified curl POST to /api/settings but the actual endpoint uses PUT method
- **Fix:** Changed to PUT to match the existing API endpoint in src/routes/api/settings/+server.ts
- **Files modified:** install.sh
- **Committed in:** c32ab98

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for correctness. The POST method would have returned 405.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Installer is complete and ready for real-world testing on a Proxmox host
- Auth system from plan 05-01 provides the setup/login flow the user encounters after install
- App will be accessible at the VM's DHCP-assigned IP on port 80

## Self-Check: PASSED

- install.sh: FOUND
- ip-cam-master.service: FOUND
- Commit c32ab98: FOUND

---
*Phase: 05-installer-and-distribution*
*Completed: 2026-03-23*
