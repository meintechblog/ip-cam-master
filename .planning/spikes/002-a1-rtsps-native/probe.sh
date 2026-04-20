#!/usr/bin/env bash
# Spike 002: ffprobe the H2C RTSPS URL template against A1.
# Requires $A1_IP and $A1_ACCESS_CODE in env (source .env.a1).
set -u
: "${A1_IP:?source .env.a1 first}"
: "${A1_ACCESS_CODE:?source .env.a1 first}"
echo "=== rtsps:// ==="
ffprobe -hide_banner -rtsp_transport tcp -tls_verify 0 \
  -i "rtsps://bblp:${A1_ACCESS_CODE}@${A1_IP}:322/streaming/live/1" 2>&1 \
  | sed "s|${A1_ACCESS_CODE}|<ACCESS_CODE>|g"
echo "Exit: $?"
echo ""
echo "=== rtspx:// ==="
ffprobe -hide_banner -rtsp_transport tcp \
  -i "rtspx://bblp:${A1_ACCESS_CODE}@${A1_IP}:322/streaming/live/1" 2>&1 \
  | sed "s|${A1_ACCESS_CODE}|<ACCESS_CODE>|g"
echo "Exit: $?"
