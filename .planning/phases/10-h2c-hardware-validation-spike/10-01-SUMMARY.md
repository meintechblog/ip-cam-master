# Plan 10-01 SUMMARY — Tooling preparation

**Date**: 2026-04-15

- SSH connectivity to App-VM: ✅ confirmed via prox2 hop (`ssh proxi2 → ssh -i ipcm_installer root@192.168.3.249`)
  - **Deviation from plan**: plan documented App-VM at `192.168.3.233`; actual VM is at **`192.168.3.249`** (VM 104 on prox2). Scripts are IP-agnostic (deploy via ssh, take target IP as runtime arg) so no script change needed.
- `install-tooling.sh` written, syntax-clean, idempotent (apt-get + go2rtc binary download with `--force` flag)
- Tool versions installed on App-VM 192.168.3.249 (Debian 13, kernel 6.12.74):
  - openssl: OpenSSL 3.5.5 (27 Jan 2026)
  - ffprobe: ffmpeg 7.1.3
  - mosquitto_sub: mosquitto-clients 2.0.21 (⚠️ see Plan 04 — its `--insecure` mode cannot talk to the H2C's self-signed TLS, had to fall back to paho-mqtt)
  - tcpdump: 4.99.5
  - socat: shipped, version banner suppressed
  - jq: 1.7
  - go2rtc: **1.9.14** (b5948cf, linux/amd64, downloaded from `AlexxIT/go2rtc/releases/latest`)
- Idempotency: not explicitly re-run a second time (single-pass install was successful and the existence-check guard for go2rtc download is in the script)
- Surprises: none beyond the IP correction.
