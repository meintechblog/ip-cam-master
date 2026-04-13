---
phase: 10-h2c-hardware-validation-spike
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh
  - .planning/phases/10-h2c-hardware-validation-spike/scripts/.gitignore
autonomous: true
requirements:
  - BAMBU-01
user_setup: []

must_haves:
  truths:
    - "App-VM (192.168.3.233) is reachable via passwordless SSH as root"
    - "openssl, ffmpeg (ffprobe), mosquitto-clients, tcpdump, socat are installed and runnable on the App-VM"
    - "go2rtc static binary is present on the App-VM at a known path and prints its version when invoked"
    - "Tooling install is idempotent — re-running the script produces no errors and no duplicate installs"
  artifacts:
    - path: ".planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh"
      provides: "Idempotent bootstrap script — runs apt-get install and downloads go2rtc binary on the App-VM"
      contains: "apt-get install"
  key_links:
    - from: "local dev machine"
      to: "root@192.168.3.233 (App-VM)"
      via: "ssh (passwordless, key-based)"
      pattern: "ssh root@192.168.3.233"
    - from: "install-tooling.sh on App-VM"
      to: "go2rtc GitHub release asset"
      via: "curl download of static binary"
      pattern: "AlexxIT/go2rtc"
---

<objective>
Prepare the production App-VM (192.168.3.233) with all tooling required for the Phase 10 hardware validation spike against the real Bambu Lab H2C. Session A work — runs while the H2C is not accessible (user not home). No src/ changes. No new npm deps. No app-code touch.

Purpose: Phase 10 must run end-to-end in ~15 minutes when the user is home. That only works if all tooling (openssl, ffprobe, mosquitto_sub, tcpdump, socat, go2rtc) is already installed, working, and verified on the App-VM. This plan is pure pre-preparation.

Output: An idempotent bash installer (`scripts/install-tooling.sh`) committed to the Phase-10 directory, plus the confirmed-working tooling footprint on the App-VM itself. Follow-up Plan 02 will build the spike script that *uses* this tooling.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/10-h2c-hardware-validation-spike/10-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md

Key constraints from 10-CONTEXT.md:
- Spike runs on **production App-VM 192.168.3.233** (not a throwaway container, not the dev Mac)
- Access is **passwordless SSH as root** — user asserts this is already configured; verify on first connection attempt
- Tooling needed: `openssl`, `ffmpeg` (provides `ffprobe`), `mosquitto-clients` (provides `mosquitto_sub`/`mosquitto_pub`), `tcpdump`, `socat`
- go2rtc: pull latest static binary from AlexxIT/go2rtc releases, verify it runs
- Debian 13 on App-VM → `apt-get`
- "Ein System für alles" — tooling stays installed on the VM after Phase 10; no cleanup step
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify SSH connectivity and write idempotent install script</name>
  <files>.planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh, .planning/phases/10-h2c-hardware-validation-spike/scripts/.gitignore</files>
  <action>
    First, verify passwordless SSH works: `ssh -o BatchMode=yes -o ConnectTimeout=5 root@192.168.3.233 'hostname && cat /etc/debian_version'`. If this fails, STOP and surface the error to the user — do not attempt to configure SSH here.

    Then create `.planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh` as an idempotent bash script that runs ON the App-VM (shebang `#!/usr/bin/env bash`, `set -euo pipefail`). It must:
      1. Check it is running as root (`[[ $EUID -eq 0 ]]`), abort otherwise
      2. `apt-get update` (quietly), then `apt-get install -y --no-install-recommends openssl ffmpeg mosquitto-clients tcpdump socat ca-certificates curl jq` — apt is naturally idempotent
      3. Create `/opt/spike-h2c/` directory (mkdir -p)
      4. Download the latest go2rtc static binary for linux_amd64 from `https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64` to `/opt/spike-h2c/go2rtc` ONLY if the file does not already exist OR `--force` flag was passed. Chmod +x.
      5. Print a verification block at the end: versions of openssl, ffprobe, mosquitto_sub, tcpdump, socat, and `/opt/spike-h2c/go2rtc --version`

    Keep the script small — target under 80 lines. Comments in English.

    Also create `.planning/phases/10-h2c-hardware-validation-spike/scripts/.gitignore` with one line: `*.log` — so later spike-run logs in this directory don't accidentally get committed via `git add .`.

    Do NOT invoke the script from here. Running it lives in Task 2 (so we can separate "script written" from "script executed on VM" cleanly in the commit history if needed).
  </action>
  <verify>
    <automated>bash -n .planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh</automated>
  </verify>
  <done>install-tooling.sh exists, passes bash syntax check (`bash -n`), is under ~80 lines, has `set -euo pipefail`, handles the `--force` flag for go2rtc re-download, and prints a verification block at the end. `.gitignore` contains `*.log`.</done>
</task>

<task type="auto">
  <name>Task 2: Execute install script on App-VM and capture verification output</name>
  <files>(remote: /opt/spike-h2c/go2rtc on 192.168.3.233 — no local src/ changes)</files>
  <action>
    Copy the install script to the VM and run it: 
      `scp .planning/phases/10-h2c-hardware-validation-spike/scripts/install-tooling.sh root@192.168.3.233:/root/install-tooling.sh`
      `ssh root@192.168.3.233 'bash /root/install-tooling.sh'`

    Capture the full stdout+stderr locally into a transient file (not committed — covered by `.gitignore`) so we can paste the verification block into the SUMMARY.md. Do NOT commit the log.

    Then verify idempotency by running the script a second time: `ssh root@192.168.3.233 'bash /root/install-tooling.sh'`. It must exit 0 without re-downloading go2rtc (the existence check short-circuits) and without apt errors.

    If any step fails (apt lock held, go2rtc download 404, permission error), capture the exact error and surface it — do NOT silently continue. Treat a failed second-run idempotency check as a failure of this task.
  </action>
  <verify>
    <automated>ssh -o BatchMode=yes root@192.168.3.233 'command -v openssl && command -v ffprobe && command -v mosquitto_sub && command -v tcpdump && command -v socat && test -x /opt/spike-h2c/go2rtc && /opt/spike-h2c/go2rtc --version'</automated>
  </verify>
  <done>All six tools present on the App-VM and runnable; `/opt/spike-h2c/go2rtc --version` prints a version string; second run of install-tooling.sh exits 0 with no re-download and no apt errors (idempotency proven).</done>
</task>

</tasks>

<verification>
1. `bash -n` passes on install-tooling.sh
2. SSH remote command verifies all six tools + go2rtc are present and runnable on 192.168.3.233
3. Second run of the installer is a no-op (idempotent)
</verification>

<success_criteria>
- SSH to root@192.168.3.233 works passwordlessly
- `openssl`, `ffprobe`, `mosquitto_sub`, `tcpdump`, `socat` all report a version on the App-VM
- `/opt/spike-h2c/go2rtc --version` returns successfully
- install-tooling.sh re-run exits 0 with no downloads / no apt changes
- install-tooling.sh committed to the Phase 10 scripts directory
</success_criteria>

<output>
After completion, create `.planning/phases/10-h2c-hardware-validation-spike/10-01-SUMMARY.md` capturing:
- SSH connectivity confirmed (yes/no)
- Tool versions observed on the App-VM (paste from verification block)
- go2rtc version downloaded
- Any surprises (e.g., Debian version actually observed, apt repository quirks)
</output>
