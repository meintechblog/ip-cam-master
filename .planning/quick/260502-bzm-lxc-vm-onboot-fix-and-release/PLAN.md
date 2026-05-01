---
quick_id: 260502-bzm
slug: lxc-vm-onboot-fix-and-release
date: 2026-05-02
status: in-progress
---

# Quick Task: LXC + VM start-at-boot fix + release

## Description

Existing LXC containers created via `createContainer` don't have `onboot=1`, and the IP-Cam-Master VM (104) itself also doesn't auto-start on Proxmox host reboot. Fix both, backfill existing infrastructure, cut a tag.

## Tasks

1. **Code fix** (`src/lib/server/services/proxmox.ts`)
   - Add `onboot: 1` to the create POST.
   - In the `alreadyExists` (idempotent) branch, set `onboot: 1` unconditionally so containers from older versions get backfilled on next config touch.
   - Remove the now-redundant `if (Object.keys(updateParams).length > 0)` guard.

2. **Test update** (`src/lib/server/services/proxmox.test.ts`)
   - `create` test asserts `onboot: 1` in the LXC POST.
   - `idempotent` test asserts `onboot: 1` is included in the config PUT.

3. **Backfill existing infrastructure** on proxi2:
   - LXCs (from app DB): 2000, 2002, 2004, 2005, 2006, 2007, 2010, 2011, 2013 → `pct set <vmid> -onboot 1`
   - VM 104 (ip-cam-master itself) → `qm set 104 -onboot 1`

4. **Release**
   - Bump `package.json` from `0.0.1` → `1.2.0` (next vX.Y per existing tag convention).
   - Commit, tag `v1.2`, push to GitHub via SSH.
