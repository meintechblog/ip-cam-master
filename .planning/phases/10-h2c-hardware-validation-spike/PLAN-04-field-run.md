---
phase: 10-h2c-hardware-validation-spike
plan: 04
type: execute
wave: 3
depends_on:
  - 10-01
  - 10-02
  - 10-03
files_modified:
  - .planning/research/H2C-FIELD-NOTES.md
  - .planning/research/h2c-spike-<timestamp>.log
autonomous: false
requirements:
  - BAMBU-01
  - BAMBU-02
user_setup:
  - service: bambu-h2c-printer
    why: "Spike must run against real H2C on the local network — no emulation possible"
    env_vars: []
    dashboard_config:
      - task: "Enable LAN Mode on printer (Settings → WLAN → LAN Mode ON)"
        location: "Bambu Lab H2C printer display"
      - task: "Note 8-digit Access Code from Settings → WLAN → Access Code"
        location: "Bambu Lab H2C printer display"
      - task: "Note Serial Number from printer sticker or Bambu Handy → Device Info"
        location: "Printer hardware / Bambu Handy app"

must_haves:
  truths:
    - "run-spike.sh executed against the real H2C on 192.168.3.x with real IP, Serial, Access Code"
    - "`.planning/research/H2C-FIELD-NOTES.md` frontmatter flipped from `status: template` to `status: validated` with validated_date and firmware_version filled"
    - "All six sections (SSDP, RTSPS, MQTT, go2rtc, Surprises, Recommendations) have REAL observed values — no placeholder leftovers"
    - "Live/2 Bird's-Eye probe result recorded (present/absent + codec/res if present)"
    - "Any divergence from X1C/P1S assumptions is explicitly flagged in the 'Surprises' and 'Recommendations' sections so Phase 11 plans can be revised before execution"
    - "Raw spike log committed (sanitized — Access Code redacted) or referenced by path with retention-on-VM disclosed"
  artifacts:
    - path: ".planning/research/H2C-FIELD-NOTES.md"
      provides: "Ground-truth field notes that Phases 11-14 cite"
      contains: "status: validated"
  key_links:
    - from: ".planning/research/H2C-FIELD-NOTES.md"
      to: "Phase 11 plans (SSDP listener, RTSPS pre-flight)"
      via: "Recommendations section cross-referenced when Phase 11 is planned"
      pattern: "H2C-FIELD-NOTES"
---

<objective>
Execute the spike against the real H2C and fill the field-notes document with observed ground truth. This is Session B — user is home, H2C is on the LAN, IP / Serial / Access Code are known.

Purpose: Close Phase 10. Everything about Phases 11-14 depends on the real values captured here. A wrong assumption discovered after those phases start would force backtracking across multiple files (per SUMMARY.md phase-ordering rationale).

Output: Committed, validated `H2C-FIELD-NOTES.md` with every placeholder replaced by observed data.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-h2c-hardware-validation-spike/10-CONTEXT.md
@.planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md
@.planning/research/H2C-FIELD-NOTES.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md

Ground-truth probes (from 10-CONTEXT.md scope):
1. SSDP verification on UDP 1990 + 2021 — confirm service URN, capture sample packet
2. RTSPS verification on TCP 322 — cert, Live/1 codec/res/fps/audio, Live/2 probe
3. MQTT on TCP 8883 — topic map, identify print-state field for Phase 14 Adaptive Stream Mode
4. go2rtc smoketest — `rtspx://` config, restream at :8554, API at :1984 returns a live stream

Pitfalls to watch actively (from PITFALLS.md):
- Pitfall 1: Live555 can hang — if RTSPS probe times out, surface power-cycle advice and continue with MQTT/go2rtc phases; do NOT retry in tight loop
- Pitfall 8: H2C is newer than ecosystem — DOCUMENT every divergence, even small ones (different port, different URN, different MQTT field path)
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Gate — user confirms H2C is ready for the spike</name>
  <what-built>Plans 01-03 artifacts: tooling installed on 192.168.3.233, `run-spike.sh` + `go2rtc-template.yaml` ready, `H2C-FIELD-NOTES.md` skeleton committed, `RUN-GUIDE.md` available.</what-built>
  <how-to-verify>
    Before this plan proceeds, user must confirm all of the following (answer in one message):

      1. I am home with the Bambu Lab H2C printer on 192.168.3.x
      2. LAN Mode is ENABLED on the printer display (Settings → WLAN → LAN Mode ON)
      3. I have the 8-digit Access Code (from the printer display)
      4. I have the printer Serial Number (from sticker or Bambu Handy)
      5. I have the printer IP address on 192.168.3.x

    Provide all three values (IP, Serial, Access Code) in the message. Values are used ONLY for the live run — they will not be committed.

    If printer is currently printing, note it — the spike will still capture valid data but the MQTT phase will show active-print state rather than idle (both are useful — ideally we eventually want BOTH, see Task 3 note).
  </how-to-verify>
  <resume-signal>Reply with: "Ready: IP=<...> SERIAL=<...> CODE=<...>  [printing/idle]"</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Execute run-spike.sh against the real H2C and capture the log</name>
  <files>(remote: /root/run-spike.sh on 192.168.3.233; local: .planning/research/h2c-spike-<ts>.log — sanitized before commit)</files>
  <action>
    With IP, SERIAL, CODE from the gate task:

    1. Ensure scripts are current on the App-VM:
       `scp .planning/phases/10-h2c-hardware-validation-spike/scripts/{run-spike.sh,go2rtc-template.yaml} root@192.168.3.233:/root/`

    2. Execute the spike:
       `ssh root@192.168.3.233 "cd /root && bash run-spike.sh '$IP' '$SERIAL' '$CODE'"` — the script writes its own log via tee to `.planning/research/h2c-spike-<ts>.log` OR fallback `$HOME/h2c-spike-<ts>.log` on the VM. Note the actual path from the script's opening header line.

    3. Retrieve the log:
       `scp root@192.168.3.233:<log-path> .planning/research/h2c-spike-<ts>.log`

    4. SANITIZE: `sed -i.bak "s|$CODE|<REDACTED_ACCESS_CODE>|g" .planning/research/h2c-spike-<ts>.log && rm .planning/research/h2c-spike-<ts>.log.bak`. Verify with `grep -c "$CODE" .planning/research/h2c-spike-<ts>.log` returning 0. Do NOT proceed to commit until this returns 0.

    5. If Pitfall 1 triggers (RTSPS probe times out / appears hung), note it, power-cycle the printer per user, re-run ONCE. Do not retry in a loop.

    6. If the user was printing during the run, OPTIONALLY run a second spike while the printer is idle (or vice versa) to capture BOTH MQTT states — but time-box this to one additional run. Save the second log alongside.

    Do not edit H2C-FIELD-NOTES.md yet — that's Task 3. This task just captures raw evidence.
  </action>
  <verify>
    <automated>ls .planning/research/h2c-spike-*.log | head -1 && test $(grep -c "bblp" .planning/research/h2c-spike-*.log | awk -F: '{s+=$2}END{print s}') -gt 0</automated>
  </verify>
  <done>At least one `h2c-spike-*.log` exists in `.planning/research/`, contains evidence from the run (e.g., `bblp` appears in the captured RTSPS command lines), Access Code is fully redacted (grep returns 0), and the phases clearly ran against the real IP (the log header shows the masked IP).</done>
</task>

<task type="auto">
  <name>Task 3: Fill H2C-FIELD-NOTES.md from the raw log and flag divergences</name>
  <files>.planning/research/H2C-FIELD-NOTES.md</files>
  <action>
    Read the sanitized log carefully. Replace EVERY placeholder in `H2C-FIELD-NOTES.md` with observed values:

    - Frontmatter: `status: validated`, `validated_date: 2026-04-NN`, `firmware_version: <from MQTT info topic if captured, else "not captured">`
    - Status banner at top: flip to "STATUS: validated against real H2C on <date>"
    - Header: real IP (can leave last octet masked if the user prefers), real Serial (can mask middle digits), tester name
    - SSDP: actual ports seen (did 1990 fire? did 2021 fire? both?), actual service URN string from the NOTIFY headers, sample packet excerpt from the tcpdump dump
    - RTSPS: cert subject/issuer/fingerprint from openssl, Live/1 codec/resolution/fps/audio from ffprobe, Live/2 presence (and if present its codec/res)
    - MQTT: exact topic names seen, identify the candidate print-state field (check `print.gcode_state`, `print.mc_print_stage`, `print.print_type` per CONTEXT.md), paste a sanitized excerpt for active-print AND idle states (if both were captured)
    - go2rtc smoketest: YAML used, :1984 JSON response confirming `bambu` stream is live, ffprobe of the :8554 restream, note whether `#video=copy` (via `rtspx://` passthrough) produced a parseable stream
    - Raw Log section: link to the sanitized log file path

    **Surprises section** — explicitly list every divergence from X1C/P1S assumptions. Examples:
      - "SSDP fired on port X only, not both" — or "both, as assumed"
      - "Service URN is `<actual>`, not `urn:bambulab-com:device:3dprinter:1`" — or "matches assumption"
      - "Live/1 path is `/streaming/live/1` — confirmed" — or "404, actual path is `<new>`"
      - "Live/2 Bird's-Eye is present at /streaming/live/2 with codec X" — or "404, absent"
      - "Cert is IP-only as expected" — or "Cert has SAN for `<x>`, surprising"
      - "MQTT print-state field is `print.<exact.field.path>`"

    **Recommendations for Phases 11-14** — numbered, each citing the specific observed value:
      1. "Phase 11 SSDP listener: bind port <actual> (confirmed by capture)"
      2. "Phase 11 pre-flight: RTSPS URL template = `rtspx://bblp:<code>@<ip>:322<actual-path>` — matches / differs from research assumption"
      3. "Phase 12 go2rtc YAML: use `#video=copy` — smoketest confirms parseable / requires VAAPI re-encode"
      4. "Phase 14 Adaptive Stream Mode: subscribe to `device/<serial>/report`, trigger on field `<exact path>` — transitions observed as `<idle-value>` ↔ `<print-value>`"
      5. (optional) "Bird's-Eye camera is `<present/absent>` — keep deferred to v1.3 as per REQUIREMENTS.md"
      6. "Any new pitfall observed that PITFALLS.md missed"

    If a phase (e.g., MQTT) failed entirely — for instance auth rejected — write exactly what failed and surface it as a blocker for Phase 11 rather than guessing at values.
  </action>
  <verify>
    <automated>grep -q "status: validated" .planning/research/H2C-FIELD-NOTES.md && ! grep -q "TODO — filled in Plan 04" .planning/research/H2C-FIELD-NOTES.md && grep -q "Recommendations for Phases 11-14" .planning/research/H2C-FIELD-NOTES.md</automated>
  </verify>
  <done>Frontmatter status is `validated`, zero TODO placeholders remain in the document, Recommendations section has at least 4 numbered items each citing observed data, any divergence from X1C/P1S is called out in Surprises.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: User reviews H2C-FIELD-NOTES.md before commit</name>
  <what-built>Filled-in `H2C-FIELD-NOTES.md` based on the real spike run against the user's H2C.</what-built>
  <how-to-verify>
    1. Open `.planning/research/H2C-FIELD-NOTES.md` and read it top to bottom.
    2. Confirm the observed values match what the user remembers seeing / knows about the printer (rough sanity: IP on 192.168.3.x, Serial looks right, resolution is whatever the H2C natively streams).
    3. Confirm no plaintext Access Code anywhere (spot-check `grep`).
    4. Confirm the sanitized raw log path referenced in the document exists.
    5. Approve the commit, or list corrections.
  </how-to-verify>
  <resume-signal>Reply with "approved" or list corrections.</resume-signal>
</task>

<task type="auto">
  <name>Task 5: Commit field notes and raw log</name>
  <files>.planning/research/H2C-FIELD-NOTES.md, .planning/research/h2c-spike-<ts>.log</files>
  <action>
    Commit both artifacts in a single atomic commit via gsd-tools:
      `gsd-tools commit "docs(10): H2C field notes validated against real hardware" --files .planning/research/H2C-FIELD-NOTES.md .planning/research/h2c-spike-*.log`

    If the user declined to commit the raw log (their call — it may contain the masked IP + serial they prefer to keep local), commit only H2C-FIELD-NOTES.md and note in the SUMMARY that the log was retained on the App-VM only.

    Do NOT commit any unredacted logs. Final safeguard: `grep -rn "$CODE" .planning/research/` must return empty before the commit. If not empty, abort and re-sanitize.
  </action>
  <verify>
    <automated>git log -1 --name-only | grep -q "H2C-FIELD-NOTES.md"</automated>
  </verify>
  <done>Commit exists with H2C-FIELD-NOTES.md (and optionally sanitized log). Status=validated frontmatter is in the committed version. No Access Code leakage.</done>
</task>

</tasks>

<verification>
1. `H2C-FIELD-NOTES.md` frontmatter is `status: validated`
2. No "TODO" or "filled in Plan 04" placeholders remain
3. Recommendations section has 4+ numbered items citing observed data
4. Any divergence from X1C/P1S assumptions is explicitly flagged
5. Access Code is not present anywhere in committed artifacts
6. Git log shows the commit
</verification>

<success_criteria>
- BAMBU-01 satisfied: real H2C spike results captured
- BAMBU-02 satisfied: H2C-FIELD-NOTES.md is committed ground-truth document
- Phase 11 planner can cite H2C-FIELD-NOTES.md for SSDP port, RTSPS URL path, MQTT print-state field
- User has reviewed and approved the filled document
- No credentials leaked
</success_criteria>

<output>
After completion, create `.planning/phases/10-h2c-hardware-validation-spike/10-04-SUMMARY.md` capturing:
- Run date + printer firmware observed
- One-line verdict per phase (SSDP: confirmed / differed; RTSPS: confirmed / differed; MQTT: topics captured yes/no + print-state field; go2rtc: #video=copy works yes/no)
- Top 3 divergences from X1C/P1S that Phase 11 must honor
- Blockers for Phase 11, if any (e.g., "MQTT auth refused — LAN Mode setup issue on printer, must resolve before Phase 11 starts")
</output>
