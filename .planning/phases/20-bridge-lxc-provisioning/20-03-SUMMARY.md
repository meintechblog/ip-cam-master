---
phase: 20
plan: 03
type: execute
status: complete
completed: 2026-05-06
---

# Plan 20-03 Summary — Bridge UAT against live Proxmox

## Result

**P20 fully closed.** Live UAT against Proxmox 192.168.3.6 with three
real-Proxmox provisioning runs found three orchestration bugs, all fixed at
source with regression tests, then re-verified end-to-end. All 11 UAT
criteria green on the final run.

## Live runs performed

| Run | Bridge VMID | Bridge IP | Wall time | Result |
|-----|-------------|-----------|-----------|--------|
| 1 | 2014 | 192.168.3.242 | 11.2s | bug 1 surfaced (cam-2000 streams) |
| 2 | 2014 (re-clone) | 192.168.3.202 | 12.3s | bugs 1+2 fixed, bug 3 surfaced (no onboot) |
| 3 | 2014 (re-clone) | 192.168.3.139 | 12.2s | all 11 UAT criteria green |

Each run: tear down LXC + DB row → deploy patch → re-provision via
`POST /api/protect-hub/bridge/provision`.

## Bugs found and fixed during UAT

### Bug 1 — go2rtc serves template's residual streams instead of hello-world

**Symptom:** `:1984/api/streams` after provision returned `cam-2000` and
`cam-2000-low` (Mobotix at 192.168.3.22) instead of the planned `test:`
stream.

**Root cause:** the per-cam template (`ipcm-base` vmid 105) carries a
residual `/etc/go2rtc/go2rtc.yaml` from before
`createTemplateFromContainer` added the cleanup step. When cloned, the
bridge LXC inherits a running go2rtc with that residual config in memory.
`systemctl daemon-reload && systemctl enable --now go2rtc` is a no-op for
already-running services, so the bridge keeps serving the template's
streams.

**Fix:** explicit `systemctl restart go2rtc` after pushing the bridge
config. Robust against any template state. Commit `2b1d44a`.

### Bug 2 — Bridge inherits 1 core from template instead of locked 2

**Symptom:** `pct config 2014` showed `cores: 1` instead of the locked 2
per P20 §"Bridge sizing".

**Root cause:** `cloneFromTemplate` had `memory?: number` override but no
`cores?` override. Template's 192MB/1c sizing was inherited.

**Fix:** add `cores?: number` to `cloneFromTemplate`, applied via
`pct set <vmid> -cores <n>` post-clone, mirroring the existing memory
override. Bridge orchestration passes `cores: BRIDGE_CORES` (=2). Same
commit as bug 1 (`2b1d44a`).

### Bug 3 — Bridge does not autostart after Proxmox host reboot

**Symptom:** `pct config 2014` showed no `onboot` line — bridge would
stay stopped if host rebooted, violating ROADMAP §SC-5.

**Root cause:** `createContainer` (raw-create slow path) sets `onboot: 1`
inline (line 146), but `cloneFromTemplate` inherited whatever onboot
value the template carried (templates default to 0). Per-cam containers
provisioned via the fast-path were also affected — latent bug.

**Fix:** `cloneFromTemplate` gains `onboot?: number` with default `1`
(matches `createContainer`'s default). Spike LXCs can pass `onboot: 0`
to opt out. Bridge code unchanged (relies on default). Commit `374e8a3`.

## Regression tests

- `bridge-provision.test.ts`:
  - existing `uses template clone when template exists` test now asserts
    `cores: 2` in clone params
  - new `explicitly restarts go2rtc after pushing the bridge config`
    asserts `systemctl daemon-reload` AND `systemctl restart go2rtc` are
    issued
  - new `does not pass onboot override` documents the no-override
    contract so future refactors don't silently flip the default to 0

All 30 protect-hub tests + 49 protect-hub area tests + type-check green.

## Final UAT — all 11 criteria green

Run against bridge vmid 2014 at 192.168.3.139:

| # | Criterion | Method | Result |
|---|-----------|--------|--------|
| 1 | Stream listing contains only `test`, no leftovers | curl `:1984/api/streams` | ✅ `Streams: ['test']` |
| 2 | Editor disabled (404) | curl `:1984/editor.html` | ✅ HTTP 404 |
| 3 | RTSP `:8554` reachable | nc -z | ✅ tcp/8554 open |
| 4 | Test stream plays via ffprobe (h264 640×360 @ 10fps) | `ffprobe rtsp://.../test` | ✅ `codec=h264 width=640 height=360 fps=10/1` |
| 5 | Cores=2, memory=1024 | `pct config` | ✅ both correct |
| 6 | YAML idempotency stamp + listen 0.0.0.0:1984 + ui_editor false + test stream defined | cat config | ✅ all present |
| 7 | onboot=1 (autostart on host reboot) | `pct config` | ✅ onboot: 1 |
| 8 | DB row matches running state with container_ip | sqlite3 query | ✅ status=running, ip set |
| 9 | VAAPI passthrough — `/dev/dri/{card0,renderD128}` present in LXC | `pct exec ls /dev/dri/` | ✅ both devices passed through |
| 10 | App VM can reach bridge `:1984/api/streams` (health probe path) | `ssh ip-cam-master curl …` | ✅ JSON returned |
| 11 | go2rtc process LimitNOFILE=4096 from systemd | `cat /proc/<pid>/limits` | ✅ Max open files 4096 4096 |

## Provisioning duration

12.2 s wall time on the third run (template-clone fast path). Well under the
plan's "30–90 s" budget for fast path; raw create (slow path) was not
exercised because the template existed.

## Performance numbers

- Bridge memory footprint: 25.8 MB (peak 26.3 MB) — well under 1024 MB
  allocation, room for many output streams in P21
- CPU usage during idle: <1% (one synthetic test stream)
- LXC start time: ~3 s
- ffmpeg + go2rtc install: skipped (template provided both)

## Acceptance criteria status

- [x] Real bridge LXC provisioned on Proxmox (vmid 2014, 192.168.3.139)
- [x] go2rtc responds on bridge IP:1984 with test stream
- [x] RTSP test stream plays via ffprobe on rtsp://bridge-ip:8554/test
- [x] go2rtc editor inaccessible (404)
- [x] Bridge container has `onboot=1` for host-reboot survival
- [x] Start/Stop/Restart wired (covered by 20-02 SUMMARY; not re-tested
      here)
- [n/a] Health probe `lastHealthCheckAt` updates every 5 min — health
       probe runs in scheduler tick; not re-verified in this UAT round,
       covered in 20-02 SUMMARY
- [x] YAML stamp present as first line
- [x] `pct config` shows memory=1024 cores=2 + VAAPI mount

## Downstream impact

- **P20** is fully closed. ROADMAP marker should flip from `[ ]` to `[x]`.
- **P21** can begin with confidence: the bridge provisioning surface is
  battle-tested against live infrastructure with three real runs; future
  bridge re-provisions (e.g. after a force-reset) will produce identical
  configs deterministically.
- Per-cam containers also benefit from the onboot=1 default fix — latent
  bug closed for the entire fleet on next clone.

---

*Phase: 20-bridge-lxc-provisioning*
*Plan: 03*
*Status: COMPLETE — 3 source bugs fixed mid-UAT, 11/11 criteria verified
on final run*
*UAT completed: 2026-05-06*
