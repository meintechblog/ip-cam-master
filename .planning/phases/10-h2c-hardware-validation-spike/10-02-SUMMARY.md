# Plan 10-02 SUMMARY — Spike script + go2rtc template

**Date**: 2026-04-15

- `scripts/run-spike.sh` (~135 lines) and `scripts/go2rtc-template.yaml` (10 lines) written.
- Top-level structure of run-spike.sh: arg-parse + validation → tee-logging setup → trap-cleanup (kills go2rtc PID, removes /tmp configs) → 4 sequential phase functions (`phase_ssdp`, `phase_rtsps`, `phase_mqtt`, `phase_go2rtc`) → wrap-up.
- Every external call has a `timeout` prefix (Live555 hang protection per PITFALLS Pitfall 1):
  - SSDP: 10s × 3 calls (tcpdump + 2 socats)
  - RTSPS: 10s openssl + 15s × 2 ffprobes
  - MQTT: 60s mosquitto_sub
  - go2rtc: 5s curl + 10s ffprobe
- Deviations from PLAN-02:
  - tcpdump moved BEFORE socat (better evidence collection — captures full headers, socat just dumps raw bytes)
  - openssl cert dump includes `-dates` (validity window) — not asked for but trivially useful
- Known intentional-failure modes the script tolerates:
  - any single phase failure → `[WARN] phase failed — continuing` (catches MQTT failure during spike, which actually happened)
  - go2rtc smoketest with no real printer → would error harmlessly (not exercised this run since real H2C was available)
- Run-time observed against real H2C: ~110s end-to-end (well within 2–3 min budget).
