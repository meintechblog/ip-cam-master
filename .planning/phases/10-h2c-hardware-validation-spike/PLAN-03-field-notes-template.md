---
phase: 10-h2c-hardware-validation-spike
plan: 03
type: execute
wave: 2
depends_on: []
files_modified:
  - .planning/research/H2C-FIELD-NOTES.md
  - .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md
autonomous: true
requirements:
  - BAMBU-02
user_setup: []

must_haves:
  truths:
    - "User can open `.planning/research/H2C-FIELD-NOTES.md` and see the exact sections the spike must fill — SSDP, RTSPS, MQTT, go2rtc, surprises, recommendations"
    - "User can open `RUN-GUIDE.md` and execute Plan 04 without re-reading CONTEXT.md"
    - "Every field in H2C-FIELD-NOTES.md is a PLACEHOLDER — no pre-filled X1C guesses that could ship stale"
  artifacts:
    - path: ".planning/research/H2C-FIELD-NOTES.md"
      provides: "Empty-placeholder field-notes document — ground-truth container for Phases 11-14"
      contains: "SSDP"
    - path: ".planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md"
      provides: "Step-by-step runbook for the user when home with the H2C"
      contains: "LAN Mode"
  key_links:
    - from: "RUN-GUIDE.md"
      to: "scripts/run-spike.sh"
      via: "invocation instructions with IP/SERIAL/CODE placeholders"
      pattern: "run-spike.sh"
    - from: "H2C-FIELD-NOTES.md"
      to: "subsequent phase plans (11-14)"
      via: "ground-truth citation"
      pattern: "H2C-FIELD-NOTES"
---

<objective>
Commit the empty-placeholder field-notes document and the user-facing runbook. Session A work — no hardware access needed. Plan 04 fills the placeholders with real data.

Purpose: The field-notes document exists BEFORE the run, so when the user is home we do not spend context re-deciding structure. The runbook makes Plan 04 a ~15-minute exercise.

Output: Two committed markdown files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-h2c-hardware-validation-spike/10-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md

Field-notes structure is dictated by 10-CONTEXT.md "Output Artifact" section — use verbatim, every value is a `<placeholder>` until Plan 04. Run-guide content is driven by 10-CONTEXT.md "What User Needs to Provide (when home)".
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create H2C-FIELD-NOTES.md skeleton with explicit placeholders</name>
  <files>.planning/research/H2C-FIELD-NOTES.md</files>
  <action>
    Create `.planning/research/H2C-FIELD-NOTES.md` using the structure from 10-CONTEXT.md "Output Artifact". Every value is `<TODO — filled in Plan 04>`, NEVER a pre-filled X1C assumption.

    YAML frontmatter: `status: template`, `validated_date:`, `firmware_version:` — Plan 04 flips status to `validated`.

    Status banner at top: "STATUS: template / awaiting hardware run (Plan 04)".

    Sections in order:
      - Header: Tested date, Printer (IP, serial, firmware), Tester
      - ## SSDP — Port observed (1990 / 2021 / both / neither), Service type string, Sample packet (hexdump/text)
      - ## RTSPS (port 322) — Cert subject, Cert issuer, Cert SHA-256 fingerprint, Live/1 (codec, resolution, fps, audio yes/no), Live/2 Bird's-Eye (present/absent; if present codec/res/fps)
      - ## MQTT (port 8883) — Auth (bblp + access code), TLS behavior (--insecure handshake), Topics observed (list), Print-state field path (Adaptive Stream Mode in Phase 14), Sample active-print message, Sample idle message
      - ## go2rtc Smoketest — Config YAML, Restream URL, ffprobe result, `#video=copy` works (yes/no), :1984 /api/streams response
      - ## Known Issues / Surprises — bullet list, divergences from X1C/P1S
      - ## Recommendations for Phases 11-14 — numbered corrections (e.g., "Phase 11 SSDP listener MUST bind ports X+Y")
      - ## Raw Log — link to `.planning/research/h2c-spike-<timestamp>.log`
  </action>
  <verify>
    <automated>test -f .planning/research/H2C-FIELD-NOTES.md && grep -q "status: template" .planning/research/H2C-FIELD-NOTES.md && grep -q "## SSDP" .planning/research/H2C-FIELD-NOTES.md && grep -q "## RTSPS" .planning/research/H2C-FIELD-NOTES.md && grep -q "## MQTT" .planning/research/H2C-FIELD-NOTES.md && grep -q "## go2rtc" .planning/research/H2C-FIELD-NOTES.md && grep -q "Bird" .planning/research/H2C-FIELD-NOTES.md && grep -q "Recommendations for Phases 11-14" .planning/research/H2C-FIELD-NOTES.md</automated>
  </verify>
  <done>File exists with all six required sections, frontmatter has `status: template`, every data field is a placeholder.</done>
</task>

<task type="auto">
  <name>Task 2: Create RUN-GUIDE.md — operational runbook for when user is home</name>
  <files>.planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md</files>
  <action>
    Create `.planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md` with these sections:

    1. Purpose — one paragraph: operational runbook for executing Plan 04 against the real H2C on the same LAN as the App-VM.

    2. Pre-flight checklist (per 10-CONTEXT.md):
       - Printer ON, same LAN as 192.168.3.233
       - LAN Mode ENABLED: Printer display → Settings → WLAN → LAN Mode ON
       - (Recommended per PITFALLS.md Pitfall 3) Developer Mode ENABLED
       - Access Code visible: Printer display → Settings → WLAN → Access Code (8 digits)
       - Serial Number: printer sticker OR Bambu Handy → Device Info → SN

    3. Values to provide — fill-in table (IP / Serial / Access Code), filled locally, never commit.

    4. Running the spike:
       - `ssh root@192.168.3.233`
       - `bash /root/run-spike.sh <IP> <SERIAL> <ACCESS_CODE> 2>&1 | tee /tmp/spike.out`
       - Runtime ~2–3 minutes (SSDP 10s + RTSPS 30s + MQTT 60s + go2rtc 30s + overhead)

    5. Where output lands — `.planning/research/h2c-spike-<timestamp>.log` on the App-VM (fallback `$HOME/h2c-spike-<ts>.log`). `scp` it back to the dev machine.

    6. What to do with the output — Plan 04 fills `H2C-FIELD-NOTES.md` from the raw log in a Claude session.

    7. Troubleshooting bullets:
       - SSH refused → check passwordless key
       - RTSPS probe hangs past timeout → Live555 hung; power-cycle printer (PITFALLS Pitfall 1)
       - MQTT connect refused → LAN Mode OFF or Access Code rotated
       - ffprobe 401 Unauthorized on RTSPS → Access Code wrong/rotated
       - SSDP captures nothing → re-run; Bambu announces on slow interval (~30s)

    8. Safety / scope:
       - Do NOT adopt in UniFi Protect during Plan 04 (that's Phase 13)
       - Bird's-Eye `/streaming/live/2` probed for evidence only; OUT OF SCOPE for v1.2 per REQUIREMENTS.md
       - Raw log contains the Access Code embedded in RTSPS URLs → treat as sensitive; redact the code before committing the log, OR keep log only on the VM and paste sanitized excerpts into H2C-FIELD-NOTES.md

    Keep it actionable. No philosophy.
  </action>
  <verify>
    <automated>test -f .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md && grep -q "LAN Mode" .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md && grep -q "run-spike.sh" .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md && grep -q -i "troubleshoot" .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md && grep -q -i "access code" .planning/phases/10-h2c-hardware-validation-spike/RUN-GUIDE.md</automated>
  </verify>
  <done>RUN-GUIDE.md exists with all 8 sections, references run-spike.sh, has troubleshooting list including Live555 power-cycle advice, reminds Protect adoption is Phase 13.</done>
</task>

</tasks>

<verification>
1. Both files exist at their declared paths
2. H2C-FIELD-NOTES.md has all six required sections + frontmatter status=template
3. RUN-GUIDE.md references `run-spike.sh`, LAN Mode checklist, Access Code handling, troubleshooting
</verification>

<success_criteria>
- H2C-FIELD-NOTES.md skeleton committed with status=template
- RUN-GUIDE.md committed with full operational checklist
- No stale X1C assumptions baked into the field-notes template
</success_criteria>

<output>
After completion, create `.planning/phases/10-h2c-hardware-validation-spike/10-03-SUMMARY.md` capturing the two files created and noting that Plan 04 is gated on user + H2C access.
</output>
