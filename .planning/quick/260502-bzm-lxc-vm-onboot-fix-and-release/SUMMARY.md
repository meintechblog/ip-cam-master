---
quick_id: 260502-bzm
slug: lxc-vm-onboot-fix-and-release
date: 2026-05-02
status: complete
---

# Summary: LXC + VM start-at-boot fix + release

## Outcome

All Proxmox infrastructure managed by ip-cam-master now auto-starts on host reboot.

## Changes

### Code

- `src/lib/server/services/proxmox.ts`
  - `createContainer` POST: added `onboot: 1`.
  - `alreadyExists` branch: `updateParams` initialised with `{ onboot: 1 }` unconditionally → covers backfill on next config touch for any container created before this change.
  - Removed `if (Object.keys(updateParams).length > 0)` guard (now always true).
- `src/lib/server/services/proxmox.test.ts`
  - `create` test asserts `onboot: 1` in the LXC POST.
  - `idempotent` test asserts `onboot: 1` is included alongside `memory: 1024` in the config PUT.

### Infrastructure (proxi2, 192.168.3.6)

- 9 managed LXCs backfilled via `pct set <vmid> -onboot 1`: 2000 (cam-park), 2002 (cam-loxoneintercom), 2004 (cam-hochbeet), 2005 (cam-haustr), 2006 (cam-terrasse), 2007 (cam-parkplatz), 2010 (cam-balkon), 2011 (cam-bobthebuilder), 2013 (cam-a1mini).
- VM 104 (ip-cam-master itself): `qm set 104 -onboot 1`.
- Verified: `pct config <vmid> | grep onboot` returns `onboot: 1` for all 9 + VM.

### Release

- `package.json`: `0.0.1` → `1.2.0`.
- Tag: `v1.2` (next vX.Y per existing convention; v1.1 was last released tag).

## Tests

- 251 unit tests passing.
- 12 unit tests failing — **all pre-existing** (verified by stash + re-run on clean main: identical 12 failures). Failures are environmental (SSH key path checks running locally, mock setup issues), not regressions from this change.
- `svelte-check`: 0 errors, 25 warnings (pre-existing).

## Out of scope

- LXC 105 (`ipcm-base`): the template, not actively managed via the script. Skipped.
- Non-ip-cam-master containers on proxi2 (102 netzbetreiber-master, 103 fileflows, 903 energy-distribution-master): untouched per user instruction "die Container, die du bisher erzeugt hast über unser Skript".

## Next

`/gsd:autonomous` continues v1.3 from P20 (Bridge LXC Provisioning).
