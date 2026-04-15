# Phase 10 — RUN-GUIDE

Operational runbook for executing **Plan 04 (field run)** against the real Bambu Lab H2C on the local network.

## 1. Pre-flight checklist

- [ ] Printer powered ON, on the same LAN as the App-VM
- [ ] **LAN Mode ENABLED**: Printer display → Settings → WLAN → LAN Mode = ON
- [ ] (Recommended) Developer Mode enabled (PITFALLS Pitfall 3)
- [ ] **Access Code** noted (8 digits): Settings → WLAN → Access Code
- [ ] **Serial Number** noted: printer sticker OR Bambu Handy → Device Info → SN
- [ ] **Printer IP** noted (DHCP lease in router or `nmap -sn 192.168.3.0/24`)

## 2. Values to provide

Fill locally — **never commit**:

| Value        | Example              | Yours |
|--------------|----------------------|-------|
| IP           | `192.168.3.109`      |       |
| Serial       | `31B8BPxxxxxxxxx`    |       |
| Access Code  | `xxxxxxxx` (8 char)  |       |

## 3. Running the spike

> **Note:** App-VM is reachable as `root@192.168.3.249` via the prox2 hop with the `ipcm_installer` SSH key. From the dev Mac:

```bash
# Deploy scripts (once, from repo root)
scp .planning/phases/10-h2c-hardware-validation-spike/scripts/{run-spike.sh,go2rtc-template.yaml,install-tooling.sh} \
    proxi2:/tmp/

ssh proxi2 'scp -i /root/.ssh/ipcm_installer -o StrictHostKeyChecking=no \
    /tmp/{run-spike.sh,go2rtc-template.yaml,install-tooling.sh} \
    root@192.168.3.249:/root/'

# Run the spike
ssh proxi2 "ssh -i /root/.ssh/ipcm_installer root@192.168.3.249 \
    'cd /root && bash run-spike.sh <IP> <SERIAL> <ACCESS_CODE>'"
```

Runtime ≈ 2–3 min: SSDP 10s + RTSPS 30s + MQTT 60s + go2rtc 30s + overhead.

## 4. Where output lands

- On the App-VM: `/root/h2c-spike-<timestamp>.log` (fallback when run from `/root`).
- Pull back to dev Mac: `scp` via the same prox2 hop into `.planning/research/`.
- **Sanitize** before commit: redact the 8-digit Access Code (`sed -i "s|<CODE>|<REDACTED>|g"`).

## 5. What to do with the output

Plan 04 fills `.planning/research/H2C-FIELD-NOTES.md` from the sanitized log in a Claude session, flips frontmatter `status: validated`, and commits both files.

## 6. Troubleshooting

| Symptom | Cause / Action |
|---------|----------------|
| SSH refused | Check `ipcm_installer` key on prox2 |
| RTSPS probe hangs past 15s | Live555 wedged — power-cycle printer (PITFALLS Pitfall 1) |
| MQTT connect refused | LAN Mode OFF or Access Code rotated |
| ffprobe `401 Unauthorized` on RTSPS | Access Code wrong/rotated |
| SSDP captures nothing | Re-run; Bambu announces on ~30s interval |

## 7. Safety / scope

- **Do NOT** adopt in UniFi Protect during Plan 04 — that's Phase 13.
- Bird's-Eye `/streaming/live/2` is **probed for evidence only**; OUT OF SCOPE for v1.2 per REQUIREMENTS.md.
- Raw log embeds the Access Code in RTSPS URLs → treat as sensitive. Either redact before commit OR keep log only on the VM and paste sanitized excerpts into `H2C-FIELD-NOTES.md`.
