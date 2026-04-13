---
phase: 10-h2c-hardware-validation-spike
plan: 02
type: execute
wave: 2
depends_on:
  - 10-01
files_modified:
  - .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh
  - .planning/phases/10-h2c-hardware-validation-spike/scripts/go2rtc-template.yaml
autonomous: true
requirements:
  - BAMBU-01
user_setup: []

must_haves:
  truths:
    - "Spike script accepts three positional args (IP, SERIAL, ACCESS_CODE) and refuses to run without them"
    - "Spike script runs on the App-VM and exercises all four verification steps: SSDP listen, RTSPS probe (live/1 AND live/2), MQTT sample, go2rtc smoketest"
    - "Every step has a bounded timeout so a hung printer cannot wedge the whole run (Live555 hang is a documented pitfall)"
    - "All output lands in a single timestamped log file under `.planning/research/` for committing as evidence"
    - "go2rtc smoketest starts in background, is probed via its :1984 HTTP API, and is always killed on exit (trap EXIT)"
  artifacts:
    - path: ".planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh"
      provides: "Executable spike script — four verification phases against a real H2C"
      contains: "openssl s_client"
    - path: ".planning/phases/10-h2c-hardware-validation-spike/scripts/go2rtc-template.yaml"
      provides: "Minimal go2rtc config for the smoketest with {{IP}}/{{CODE}} placeholders"
      contains: "rtspx://"
  key_links:
    - from: "run-spike.sh"
      to: ".planning/research/h2c-spike-<timestamp>.log"
      via: "tee-based logging"
      pattern: "tee.*h2c-spike"
    - from: "run-spike.sh go2rtc step"
      to: "go2rtc-template.yaml"
      via: "sed substitution of {{IP}}/{{CODE}}"
      pattern: "sed.*IP"
---

<objective>
Write the end-to-end spike script that runs against the real H2C. Session A work — still no H2C access, but the script must be complete and syntax-clean so that Plan 04 (with the user home) just invokes it with real credentials. No src/ changes, no npm deps.

Purpose: Codify the four verification phases from 10-CONTEXT.md (SSDP, RTSPS, MQTT, go2rtc smoketest) into a single deterministic bash run that captures ground truth about the H2C and writes it to a committable log. Time-box every external call so a hung Live555 or a wrong Access Code cannot wedge the spike.

Output: `scripts/run-spike.sh` + `scripts/go2rtc-template.yaml` — both committed. Not executed against the H2C in this plan (that's Plan 04); only dry-run / syntax-checked / tested where possible against local loopback.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-h2c-hardware-validation-spike/10-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md

Ground-truth assumptions to verify (from STACK.md + CONTEXT.md):
- SSDP NOTIFY on UDP ports 1990 AND 2021 (non-standard — NOT 1900)
- SSDP service URN: `urn:bambulab-com:device:3dprinter:1` (assumed from X1C/P1S)
- RTSPS on TCP 322, cert is self-signed and IP-only (no SAN matching hostname)
- RTSPS URL: `rtsps://bblp:<ACCESS_CODE>@<IP>:322/streaming/live/1`  (plus probe `/streaming/live/2` for Bird's-Eye)
- MQTT on TCP 8883, TLS with self-signed cert, user=`bblp`, password=ACCESS_CODE, topic base `device/<SERIAL>/#`
- go2rtc uses `rtspx://` scheme to skip TLS verification; HTTP API on :1984

Pitfalls to encode as safety rails (from PITFALLS.md):
- Live555 hangs ungracefully → every ffprobe / openssl / mosquitto call needs a hard timeout (10–60s max)
- Single-connection limit → do RTSPS probes sequentially, never in parallel; close each probe cleanly before the next
- `mosquitto_sub` needs `--insecure` + `--cafile /dev/null` for the self-signed cert
- go2rtc process must be killed on exit — use `trap` with a PID-kill, never leave orphans on the App-VM
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write go2rtc config template and the spike script skeleton</name>
  <files>.planning/phases/10-h2c-hardware-validation-spike/scripts/go2rtc-template.yaml, .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh</files>
  <action>
    Create `scripts/go2rtc-template.yaml` — minimal go2rtc config using the `rtspx://` scheme (per STACK.md — skips TLS verification for the printer's self-signed cert):
    ```yaml
    api:
      listen: ":1984"
    rtsp:
      listen: ":8554"
    streams:
      bambu:
        - rtspx://bblp:{{CODE}}@{{IP}}:322/streaming/live/1
    log:
      level: info
    ```

    Create `scripts/run-spike.sh` with the skeleton only (phases are stubbed; actual phase bodies land in Task 2). Requirements:
      - Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, `IFS=$'\n\t'`
      - Arg parse: expects exactly 3 positional args — IP, SERIAL, ACCESS_CODE. Print usage and exit 2 otherwise. Validate: IP is dotted-quad-ish (regex `^[0-9.]+$`), ACCESS_CODE is 8 chars.
      - `LOG=".planning/research/h2c-spike-$(date +%Y%m%d-%H%M%S).log"` — if the script is run on the App-VM where there is no `.planning/`, fall back to `$HOME/h2c-spike-<ts>.log` and print the fallback path. All output via `exec > >(tee -a "$LOG") 2>&1`.
      - Header logged: date, IP (last octet masked), SERIAL (masked), script version.
      - A `cleanup()` function registered with `trap cleanup EXIT INT TERM` that kills any go2rtc PID we spawned and removes the temp go2rtc yaml.
      - Four phase stubs — `phase_ssdp`, `phase_rtsps`, `phase_mqtt`, `phase_go2rtc` — each prints `=== Phase N: <name> ===` and `TODO` for now. Main body calls them in order.
      - Never abort on a failed phase: use `if phase_rtsps; then ... else echo "[WARN] phase failed — continuing"; fi` so a single broken probe does not prevent the others from producing evidence.

    Keep the file under ~60 lines in this task (body comes next).
  </action>
  <verify>
    <automated>bash -n .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh 2>&1 | head -5 | grep -q -i usage</automated>
  </verify>
  <done>Both files exist. Script passes `bash -n`. Invoking with no args prints a Usage message and exits non-zero. Trap + tee-logging + arg validation all in place.</done>
</task>

<task type="auto">
  <name>Task 2: Fill in the four verification phase bodies</name>
  <files>.planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh</files>
  <action>
    Flesh out the four phase functions. Every external call gets a hard timeout.

    **phase_ssdp** (target: ~10s budget):
    - Use `timeout 10 socat -u UDP-RECV:2021,reuseaddr - | od -c | head -200` redirected to the log. Also listen on 1990 in parallel (backgrounded, killed by trap).
    - Follow-up passive approach: `timeout 10 tcpdump -ni any -A 'udp and (port 1990 or port 2021)' -c 20` to capture Bambu NOTIFY packets.
    - Goal is EVIDENCE, not parse — dump whatever arrives; human reads the log.

    **phase_rtsps** (target: ~30s budget):
    - `echo | timeout 10 openssl s_client -connect "$IP:322" -showcerts 2>/dev/null | openssl x509 -noout -subject -issuer -fingerprint -sha256` — dumps cert subject/issuer/fingerprint
    - `timeout 15 ffprobe -hide_banner -rtsp_transport tcp -tls_verify 0 -rw_timeout 10000000 "rtsps://bblp:$CODE@$IP:322/streaming/live/1" 2>&1 | head -80` — codec/resolution/fps
    - Then PROBE BIRD'S-EYE: same ffprobe invocation with `/streaming/live/2`. Mark output "live/2 probe" clearly. Failure is informational, not fatal.
    - Sequential — never parallel — because of the single-connection limit.

    **phase_mqtt** (target: ~65s budget):
    - `timeout 60 mosquitto_sub -h "$IP" -p 8883 --insecure --cafile /dev/null -u bblp -P "$CODE" -t "device/$SERIAL/#" -v 2>&1 | head -200` — captures a 60-second window of MQTT topics and JSON payloads
    - If the initial connect fails (wrong code, TLS), mosquitto_sub will exit quickly; that's fine — the log captures the error.

    **phase_go2rtc** (target: ~30s budget):
    - Render `/opt/spike-h2c/go2rtc.yaml` from the template via `sed -e "s|{{IP}}|$IP|g" -e "s|{{CODE}}|$CODE|g" scripts/go2rtc-template.yaml > /tmp/go2rtc-spike.yaml` (adjust path to match wherever the script is run — accept a `GO2RTC_BIN` env override, default `/opt/spike-h2c/go2rtc`).
    - Start: `"$GO2RTC_BIN" -config /tmp/go2rtc-spike.yaml >/tmp/go2rtc-spike.log 2>&1 &`; record the PID in a global so `cleanup()` can kill it.
    - Sleep 5s for startup.
    - Hit `curl -s --max-time 5 http://127.0.0.1:1984/api/streams | jq .` and log the result.
    - Pull the restream with a short ffprobe: `timeout 10 ffprobe -hide_banner rtsp://127.0.0.1:8554/bambu 2>&1 | head -40`.
    - cleanup() kills the go2rtc PID and removes /tmp/go2rtc-spike.yaml.

    Keep total script under ~200 lines. No clever subshells — straight sequential bash, heavily commented.

    IMPORTANT: Do NOT invoke this script against any real printer in this task. The smoketest against 127.0.0.1:8554 will error because there is no real H2C — that is expected and acceptable; the point here is that the script runs end-to-end without syntax errors and each phase completes (with errors) rather than hanging.
  </action>
  <verify>
    <automated>bash -n .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "phase_ssdp" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "phase_rtsps" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "phase_mqtt" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "phase_go2rtc" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "streaming/live/2" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh && grep -q "trap" .planning/phases/10-h2c-hardware-validation-spike/scripts/run-spike.sh</automated>
  </verify>
  <done>run-spike.sh implements all four phases sequentially, uses `timeout` on every external call, probes both live/1 and live/2, uses `rtspx://` in the go2rtc template, has a trap-based cleanup killing the go2rtc PID, and logs via `tee` to a timestamped file under `.planning/research/` (with $HOME fallback). Passes `bash -n`.</done>
</task>

</tasks>

<verification>
1. `bash -n scripts/run-spike.sh` passes
2. Running with no args prints Usage and exits non-zero
3. Grep confirms all four phase functions, live/2 probe, trap, and `rtspx://` scheme are present
4. Peer-read the script and confirm every external command has a `timeout` prefix (Live555 hang protection)
</verification>

<success_criteria>
- `run-spike.sh` and `go2rtc-template.yaml` exist and are committed
- Script arg validation works
- Trap handler closes go2rtc cleanly on any exit path
- Every external call is time-bounded
- Script is ready to invoke in Plan 04 with real H2C credentials
</success_criteria>

<output>
After completion, create `.planning/phases/10-h2c-hardware-validation-spike/10-02-SUMMARY.md` capturing:
- Final script line count and top-level structure (4 phases + cleanup)
- Any deviations from 10-CONTEXT.md decisions (e.g., chose socat over tshark)
- Known-failure modes the script intentionally tolerates (go2rtc smoketest when no printer present, etc.)
</output>
