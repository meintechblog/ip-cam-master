# Phase 5: Installer and Distribution - Validation

**Generated:** 2026-03-23
**Source:** 05-RESEARCH.md Validation Architecture section

## Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | vite.config.ts (test.include: src/**/*.test.ts) |
| Quick run command | `npx vitest --run` |
| Full suite command | `npx vitest --run` |

## Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INST-01 | install.sh is valid bash, contains VM creation commands | smoke | `bash -n install.sh` | Will create |
| INST-02 | install.sh installs Node.js, ffmpeg, systemd service | smoke | `grep -q "nodesource\|apt-get\|systemctl" install.sh` | Will create |
| INST-03 | install.sh detects existing VM and runs update flow | smoke | `grep -q "update\|git pull" install.sh` | Will create |
| INST-04 | systemd service file has Restart=on-failure | smoke | `grep -q "Restart=on-failure" ip-cam-master.service` | Exists |
| INST-05 | Script targets Debian (apt-get based) | smoke | `grep -q "apt-get" install.sh` | Will create |
| D-22/D-27 | Auth service: hash, verify, session, YOLO | unit | `npx vitest --run src/lib/server/services/auth.test.ts` | Wave 0 |

## Sampling Rate

- **Per task commit:** `npx vitest --run`
- **Per wave merge:** `npx vitest --run && bash -n install.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

## Wave 0 Gaps

- [ ] `src/lib/server/services/auth.test.ts` -- covers auth service (hashPassword, verifyPassword, sessions, YOLO)
- [ ] `bash -n install.sh` -- syntax validation for the bash installer
