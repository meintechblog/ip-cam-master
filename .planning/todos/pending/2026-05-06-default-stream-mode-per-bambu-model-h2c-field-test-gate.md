---
created: 2026-05-06T19:35:51.404Z
title: Default stream_mode per Bambu model — H2C field-test gate before flipping to always_live
area: api
files:
  - src/routes/api/onboarding/bambu/save-camera/+server.ts:110
  - src/lib/server/services/bambu-mqtt.ts:66-114
  - .planning/debug/resolved/bambu-black-frame-protect.md
re_evaluate_after: 2026-05-27
---

## Problem

Heute (2026-05-06) musste cam 14 "Bob the Builder" (H2C, vmid 2011) per SQL-Hotfix
auf `stream_mode='always_live'` umgestellt werden, weil der Adaptive-Mode in
`bambu-mqtt.ts:66-114` bei jedem `print_state ∈ {FINISH, IDLE, FAILED}`
`systemctl stop go2rtc` ausgelöst hat → schwarzes Bild in UniFi Protect.

Der Provisioning-Default in `save-camera/+server.ts:110` weicht zwar je nach Modell
ab — aber nur für A1:

```ts
streamMode: validatedModel === 'A1' ? 'always_live' : 'adaptive'
```

Heißt: jedes künftige H2C-Onboarding tritt denselben Fallstrick. Cam 20 (A1 Mini)
wurde irgendwann manuell auf always_live geflippt; cam 14 (H2C) erst heute.

Die `adaptive`-Voreinstellung für H2C war intentional aus `1eb345e feat(14)`
(15. April) mit der Begründung "Protects the H2C's fragile Live555 server" —
diese Annahme ist heute weder validiert noch widerlegt. Ein 10-min-ffprobe-Smoketest
während dem Debug heute reicht NICHT, um sie umzudrehen.

Volle Investigation: `.planning/debug/resolved/bambu-black-frame-protect.md`

## Solution

**Phase 1 — Field-Test (passive, läuft jetzt):**
Cam 14 läuft seit 2026-05-06 19:22 UTC auf `always_live`. Beobachte bis ~2026-05-27
(3 Wochen Fenster, willkürlich) auf:

- RTSP-Server-Hang oder go2rtc-Crash auf vmid 2011
- Live555-spezifische Symptome im journalctl auf vmid 2011
  (port :322 connection refused / EOF / EAGAIN-Bursts)
- User-sichtbare Stream-Drops in Protect (cam.id=23 third-party-mirror)

Quick-Check-Command für die Auswertung:
```
ssh ip-cam-master "ssh -i /root/.ssh/ip-cam-master root@192.168.3.6 \
  'pct exec 2011 -- journalctl -u go2rtc --since=\"2026-05-06\" | grep -iE \"error|fail|refused|EOF\"'"
```

**Phase 2 — Code-Change (NACH erfolgreichem Field-Test):**

`src/routes/api/onboarding/bambu/save-camera/+server.ts:110`:
```ts
// VORHER:
streamMode: validatedModel === 'A1' ? 'always_live' : 'adaptive'
// NACHHER:
streamMode: ['A1', 'A1-Mini', 'H2C'].includes(validatedModel) ? 'always_live' : 'adaptive'
```

Plus 1-Zeilen-Migration für etwaige bestehende `model='H2C' AND stream_mode='adaptive'`
Rows. Heute: 0 (cam 14 ist bereits geflippt). Migration wahrscheinlich überflüssig.

Idealerweise als `/gsd:quick` mit ROADMAP-Eintrag und atomar-commit.

**Wenn Live555 zickt:**
Annahme bestätigt, Code lassen. Stattdessen Option C: UI-Banner in CameraDetailCard.svelte
"Stream paused while idle — switch to always-on?" mit One-Click-Toggle (PATCH gegen
`/api/cameras/[id]/bambu-state`). Größerer Brocken, eigene Phase.

## Re-Evaluate

~2026-05-27, beim nächsten `/gsd:resume-work` oder direkt als `/gsd:quick`.
