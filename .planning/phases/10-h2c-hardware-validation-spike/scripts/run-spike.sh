#!/usr/bin/env bash
# Phase 10 H2C spike — four sequential probes against a real Bambu Lab H2C.
# Phases: SSDP listen, RTSPS probe (live/1 + live/2), MQTT subscribe, go2rtc smoketest.
# Every external call is time-bounded (Live555 hang protection — see PITFALLS.md Pitfall 1).
set -euo pipefail
IFS=$'\n\t'

SCRIPT_VERSION="1.0"
GO2RTC_BIN="${GO2RTC_BIN:-/opt/spike-h2c/go2rtc}"
GO2RTC_PID=""
SSDP_BG_PIDS=()

usage() {
  cat >&2 <<EOF
Usage: $0 <IP> <SERIAL> <ACCESS_CODE>
  IP           Printer IPv4 (e.g. 192.168.3.109)
  SERIAL       Printer serial (e.g. 31B8BPxxxxxxxxx)
  ACCESS_CODE  8-digit Access Code from printer display (LAN Mode)

Optional env: GO2RTC_BIN (default /opt/spike-h2c/go2rtc)
Output: tee'd to .planning/research/h2c-spike-<ts>.log (or \$HOME fallback).
EOF
  exit 2
}

[[ $# -eq 3 ]] || usage
IP="$1"; SERIAL="$2"; CODE="$3"
[[ "$IP" =~ ^[0-9.]+$ ]] || { echo "ERROR: IP not dotted-quad: $IP" >&2; exit 2; }
[[ ${#CODE} -eq 8 ]] || { echo "ERROR: ACCESS_CODE must be 8 chars (got ${#CODE})" >&2; exit 2; }

TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR=".planning/research"
if [[ -d "$LOG_DIR" ]]; then
  LOG="$LOG_DIR/h2c-spike-$TS.log"
else
  LOG="$HOME/h2c-spike-$TS.log"
  echo "[INFO] .planning/research not present — log fallback: $LOG"
fi
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

cleanup() {
  local rc=$?
  echo
  echo "--- cleanup (rc=$rc) ---"
  if [[ -n "$GO2RTC_PID" ]] && kill -0 "$GO2RTC_PID" 2>/dev/null; then
    echo "killing go2rtc PID=$GO2RTC_PID"
    kill "$GO2RTC_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$GO2RTC_PID" 2>/dev/null || true
  fi
  for p in "${SSDP_BG_PIDS[@]}"; do
    kill "$p" 2>/dev/null || true
  done
  rm -f /tmp/go2rtc-spike.yaml /tmp/go2rtc-spike.log
  echo "--- done ---"
}
trap cleanup EXIT INT TERM

mask_ip() { echo "$1" | sed -E 's/\.[0-9]+$/.XXX/'; }
mask_sn() { local s="$1"; echo "${s:0:4}******${s: -3}"; }

echo "=========================================="
echo "Phase 10 H2C Spike  v$SCRIPT_VERSION"
echo "Date:    $(date -Iseconds)"
echo "Host:    $(hostname)"
echo "IP:      $(mask_ip "$IP")"
echo "Serial:  $(mask_sn "$SERIAL")"
echo "Log:     $LOG"
echo "=========================================="

# -----------------------------------------------------------------------------
phase_ssdp() {
  echo
  echo "=== Phase 1: SSDP (UDP 1990 + 2021) ==="
  echo "--- tcpdump (20 packets, 10s budget) ---"
  timeout 10 tcpdump -ni any -A -c 20 'udp and (port 1990 or port 2021)' 2>&1 | head -200 || true

  echo "--- socat UDP-RECV:2021 (10s budget) ---"
  timeout 10 socat -u UDP-RECV:2021,reuseaddr - 2>&1 | od -c | head -100 || true

  echo "--- socat UDP-RECV:1990 (10s budget) ---"
  timeout 10 socat -u UDP-RECV:1990,reuseaddr - 2>&1 | od -c | head -100 || true
}

# -----------------------------------------------------------------------------
phase_rtsps() {
  echo
  echo "=== Phase 2: RTSPS (TCP 322) ==="
  echo "--- TLS cert (openssl s_client, 10s budget) ---"
  echo | timeout 10 openssl s_client -connect "$IP:322" -showcerts 2>/dev/null \
    | openssl x509 -noout -subject -issuer -fingerprint -sha256 -dates 2>&1 || true

  echo "--- ffprobe live/1 (15s budget) ---"
  timeout 15 ffprobe -hide_banner -rtsp_transport tcp -tls_verify 0 -rw_timeout 10000000 \
    "rtsps://bblp:$CODE@$IP:322/streaming/live/1" 2>&1 | head -80 || true

  echo "--- ffprobe live/2 probe (Bird's-Eye, 15s budget) ---"
  timeout 15 ffprobe -hide_banner -rtsp_transport tcp -tls_verify 0 -rw_timeout 10000000 \
    "rtsps://bblp:$CODE@$IP:322/streaming/live/2" 2>&1 | head -80 || true
}

# -----------------------------------------------------------------------------
phase_mqtt() {
  echo
  echo "=== Phase 3: MQTT (TCP 8883, 60s window) ==="
  echo "--- mosquitto_sub on device/$SERIAL/# ---"
  timeout 60 mosquitto_sub \
    -h "$IP" -p 8883 \
    --insecure --cafile /dev/null \
    -u bblp -P "$CODE" \
    -t "device/$SERIAL/#" -v 2>&1 | head -400 || true
}

# -----------------------------------------------------------------------------
phase_go2rtc() {
  echo
  echo "=== Phase 4: go2rtc smoketest ==="
  if [[ ! -x "$GO2RTC_BIN" ]]; then
    echo "[WARN] $GO2RTC_BIN not executable — skipping go2rtc phase"
    return 0
  fi

  local tmpl
  tmpl="$(dirname "$0")/go2rtc-template.yaml"
  if [[ ! -f "$tmpl" ]]; then
    echo "[WARN] template not found at $tmpl — skipping"
    return 0
  fi

  sed -e "s|{{IP}}|$IP|g" -e "s|{{CODE}}|$CODE|g" "$tmpl" > /tmp/go2rtc-spike.yaml
  echo "--- rendered config (CODE redacted) ---"
  sed "s|$CODE|<REDACTED>|g" /tmp/go2rtc-spike.yaml

  echo "--- starting go2rtc ---"
  "$GO2RTC_BIN" -config /tmp/go2rtc-spike.yaml >/tmp/go2rtc-spike.log 2>&1 &
  GO2RTC_PID=$!
  echo "go2rtc PID=$GO2RTC_PID — sleeping 5s for startup"
  sleep 5

  echo "--- :1984/api/streams ---"
  curl -s --max-time 5 http://127.0.0.1:1984/api/streams 2>&1 | jq . 2>&1 | head -80 || true

  echo "--- ffprobe restream rtsp://127.0.0.1:8554/bambu (10s budget) ---"
  timeout 10 ffprobe -hide_banner rtsp://127.0.0.1:8554/bambu 2>&1 | head -40 || true

  echo "--- go2rtc stderr tail ---"
  tail -40 /tmp/go2rtc-spike.log 2>&1 | sed "s|$CODE|<REDACTED>|g" || true
}

# -----------------------------------------------------------------------------
# Never abort on a failed phase — always continue so partial evidence is captured.
if phase_ssdp;   then echo "[OK] SSDP phase exited cleanly";   else echo "[WARN] SSDP phase failed — continuing"; fi
if phase_rtsps;  then echo "[OK] RTSPS phase exited cleanly";  else echo "[WARN] RTSPS phase failed — continuing"; fi
if phase_mqtt;   then echo "[OK] MQTT phase exited cleanly";   else echo "[WARN] MQTT phase failed — continuing"; fi
if phase_go2rtc; then echo "[OK] go2rtc phase exited cleanly"; else echo "[WARN] go2rtc phase failed — continuing"; fi

echo
echo "=========================================="
echo "Spike complete — log: $LOG"
echo "=========================================="
