#!/usr/bin/env bash
# Phase 10 install-tooling — idempotent bootstrap for the H2C spike on the App-VM.
# Installs: openssl, ffmpeg/ffprobe, mosquitto-clients, tcpdump, socat, jq, curl, ca-certificates.
# Downloads latest go2rtc static binary to /opt/spike-h2c/go2rtc (skip if exists; --force re-downloads).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (use sudo or ssh root@...)" >&2
  exit 1
fi

FORCE=0
if [[ "${1:-}" == "--force" ]]; then FORCE=1; fi

echo "=== Phase 10 install-tooling ==="
echo "Host: $(hostname)  Debian: $(cat /etc/debian_version 2>/dev/null || echo '?')"

echo "--- apt-get install (idempotent) ---"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  openssl ffmpeg mosquitto-clients tcpdump socat ca-certificates curl jq

echo "--- /opt/spike-h2c ---"
mkdir -p /opt/spike-h2c

GO2RTC=/opt/spike-h2c/go2rtc
if [[ ! -x "$GO2RTC" || $FORCE -eq 1 ]]; then
  echo "Downloading go2rtc (linux_amd64)..."
  curl -fsSL -o "$GO2RTC" \
    https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64
  chmod +x "$GO2RTC"
else
  echo "go2rtc already present, skip download (use --force to re-download)"
fi

echo "=== Verification ==="
echo "openssl:       $(openssl version)"
echo "ffprobe:       $(ffprobe -version 2>&1 | head -1)"
echo "mosquitto_sub: $(mosquitto_sub --help 2>&1 | head -1)"
echo "tcpdump:       $(tcpdump --version 2>&1 | head -1)"
echo "socat:         $(socat -V 2>&1 | head -1)"
echo "jq:            $(jq --version)"
echo "go2rtc:        $($GO2RTC --version 2>&1 | head -1)"
echo "=== install-tooling done ==="
