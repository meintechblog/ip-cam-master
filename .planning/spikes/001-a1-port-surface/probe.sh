#!/usr/bin/env bash
# Probe TCP port surface on target. Prints PORT STATE LABEL per line.
# Uses nc with 2s timeout. Tests SYN+ACK only — no payload.
set -u
HOST="${1:-${A1_IP:-192.168.3.195}}"
PORTS=(
  "80:HTTP"
  "443:HTTPS"
  "322:Bambu RTSPS (H2C chamber cam)"
  "554:standard RTSP"
  "990:FTPS (Bambu SD-card)"
  "1984:go2rtc health"
  "6000:suspected A1 proprietary stream"
  "8883:Bambu MQTT (LAN mode)"
  "8553:unconfirmed"
  "8554:RTSP alt"
)
printf "Host: %s\n" "$HOST"
printf "Timestamp: %s\n\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "%-6s %-6s %s\n" PORT STATE LABEL
printf "%-6s %-6s %s\n" ---- ----- -----
for entry in "${PORTS[@]}"; do
  port="${entry%%:*}"
  label="${entry#*:}"
  if nc -z -G 2 -w 2 "$HOST" "$port" >/dev/null 2>&1; then
    printf "%-6s %-6s %s\n" "$port" "OPEN" "$label"
  else
    printf "%-6s %-6s %s\n" "$port" "closed" "$label"
  fi
done
