---
slug: bambu-black-frame-protect
status: resolved
trigger: "H2C Bambu zeigt schwarzes Bild in UniFi Protect — Stream wird adoptiert (port 1984 fix), aber Frame ist schwarz. Vermutung: ffmpeg/transcoding pipeline (h2c protocol?), VAAPI Hardware-Accel auf prox2 (Arrow Lake), oder go2rtc YAML config. Phase v1.3 (Protect Stream Hub) läuft gerade. User will Root-Cause, nicht Symptom-Fix."
created: 2026-05-06T21:02:07
updated: 2026-05-06T19:35:00Z
resolved: 2026-05-06T19:30:00Z
goal: find_and_fix
---

# Debug Session: bambu-black-frame-protect

## Symptoms

**Expected behavior:**
Bambu H2C camera (Bob the Builder, 192.168.3.109) zeigt Live-Bild im UniFi Protect UI — RTSPS-Stream über go2rtc (rtspx://...:322) im LXC 2011 (192.168.3.112), von Protect adoptiert, Frames flowen.

**Actual behavior:**
Stream-Adoption in Protect klappt (Cam 23 status=connected im DB, Protect-Tile erscheint). Bild ist schwarz, weil go2rtc.service auf cam-bobthebuilder (vmid 2011) stopped ist.

**Error messages:**
Keine ffmpeg/TLS-Fehler. go2rtc-Service ist sauber `inactive (dead, status=0/SUCCESS)`. App-Log zeigt explizites Stop-Event.

**Timeline:**
- Lief schon mal mit echtem Live-Bild → **per Design während aktiver Drucke**
- Recent commits sind nicht ursächlich (siehe Eliminated Hypotheses)
- Adaptive-Mode-Code (`bambu-mqtt.ts`) seit 1eb345e (15. April) unverändert

**Reproduction:**
- LXC 2011 cam-bobthebuilder: `systemctl is-active go2rtc` → `inactive`
- DB: `cameras.id=14 print_state='FAILED' stream_mode='adaptive'`
- Protect zeigt black, weil RTSP-Endpoint :8554 keinen Server hat

## Initial Hypotheses (ALL TESTED)

H1. ❌ TLS-Regression durch Commit 7c08b4d — **eliminiert** (siehe Evidence)
H2. ❌ VAAPI Hardware-Accel broken — **eliminiert** (go2rtc startet sauber, ffprobe gegen Source liefert 1680×1080 30fps h264)
H3. ❌ Bambu source disconnected — **eliminiert** (port 322 open, ffprobe gegen rtspx liefert validen H264-Stream)
H4. ❌ Channel-selection fallback regression (95fb786) — **eliminiert** (P19/P21-Code touched nur Reverse-Path/Bridge, nicht Forward-Bambu)
H5. ❌ YAML config drift — **eliminiert** (yaml ist konsistent, mtime 2026-05-06 06:40 — hat Stunden vorher geliefert)

H6 (NEW). ✅ **Adaptive Stream-Mode Design**: cam.streamMode='adaptive' + print_state='FAILED' → bambu-mqtt-Service ruft `systemctl stop go2rtc` → Protect verliert Source.

## Current Focus

```yaml
hypothesis: H6 — Adaptive-Mode-Design stoppt go2rtc bei jedem print_state ∈ {FINISH, IDLE, FAILED}, was zu schwarzem Bild in Protect führt. Erwartetes (designed) Verhalten, aber UX-Lücke.
test: ABGESCHLOSSEN — Evidence vollständig, Root Cause bestätigt.
expecting: Lösungsoptionen abwägen (DB-Setting always_live vs. Code-Default-Switch vs. UX-Banner).
next_action: User Fix-Wahl präsentieren.
```

## Investigation Plan (executed)

1. ✅ **Lokalisieren**: cam.id=14 "Bob the Builder", vmid=2011, container_ip=192.168.3.112, host=prox2 (192.168.3.6), serial 31B8BP611201453 (H2C-Prefix)
2. ✅ **go2rtc Status**: `systemctl is-active go2rtc` = `inactive` (gestoppt 17:24:44 UTC heute)
3. ✅ **ffmpeg-Logs**: keine — clean exit
4. ✅ **Source-Reachability**: 192.168.3.109:322 erreichbar, ffprobe rtsps://...:322/streaming/live/1 → Stream #0:0 h264 1680×1080 30fps OK
5. ✅ **VAAPI**: nicht relevant (go2rtc läuft sauber wenn gestartet)
6. ✅ **Output-Verify**: nicht relevant (Service down ist die Ursache)
7. ✅ **Protect-Side**: cam.id=23 (third-party-mirror) status=connected, external_id=69fae75f03a2d303e41aaf10
8. ✅ **Diff-Analyse**: 7c08b4d/27297c6/61f72a9 alle in protect-hub/* (Reverse-Path), bambu-mqtt.ts seit April unverändert — keine Regression

## Evidence

- timestamp: 2026-05-06T19:04
  source: ssh ip-cam-master + pct exec 2011
  finding: |
    `systemctl status go2rtc` zeigt:
      Active: inactive (dead) since Wed 2026-05-06 17:24:44 UTC; 1h 40min ago
      Process: 441 ExecStart=/usr/local/bin/go2rtc -config /etc/go2rtc/go2rtc.yaml (code=exited, status=0/SUCCESS)
    → Service wurde aktiv gestoppt (kein Crash, exit 0)
  weight: critical

- timestamp: 2026-05-06T19:05
  source: journalctl -u ip-cam-master.service auf VM
  finding: |
    Genau zur gleichen Sekunde (17:24:44 UTC):
      [bambu-mqtt] cam=14 state=FAILED → idle (vmid=2011)
    Erkläre Trigger eindeutig: bambu-mqtt-Modul hat per SSH `systemctl stop go2rtc` ausgeführt.
  weight: critical

- timestamp: 2026-05-06T19:06
  source: src/lib/server/services/bambu-mqtt.ts
  finding: |
    Zeile 14-15: LIVE_STATES={RUNNING,PREPARE,PAUSE}, IDLE_STATES={FINISH,IDLE,FAILED}
    Zeile 66-73: toggleGo2rtc(vmid, action) → ssh.executeOnContainer → `systemctl ${action} go2rtc`
    Zeile 75-81: resolveDesiredGroup() — adaptive-mode schaltet bei mqttGroup='idle' tatsächlich auf 'idle' (= stop)
    Zeile 109: await toggleGo2rtc(camRow.vmid, desiredGroup === 'live' ? 'start' : 'stop')
    → Adaptive-Mode-Pfad ist eindeutig: print FAILED ⇒ go2rtc stop. Per Design.
  weight: critical

- timestamp: 2026-05-06T19:07
  source: cameras-Tabelle + Backup-DBs
  finding: |
    cam.id=14 stream_mode='adaptive' seit Anfang an (Backup vom 2026-05-04 23:33: bereits adaptive).
    cam.id=20 (A1 Mini) stream_mode='always_live' — User hat dort schon umgestellt.
    → User kennt den Setting, hat ihn aber für H2C nie geflippt (vermutlich weil Default).
  weight: high

- timestamp: 2026-05-06T19:08
  source: pct exec 2011 — manueller Service-Start + ffprobe-Smoke-Test
  finding: |
    `systemctl start go2rtc` → active in 2s, `/api/streams` JSON listet beide Streams.
    `ffprobe -rtsp_transport tcp rtsps://bblp:de0ad0a4@192.168.3.109:322/streaming/live/1`
       → Input #0, rtsp, "rtsp stream server"
       → Stream #0:0: Video: h264 (High), yuv420p, 1680x1080, 30 fps, 30 tbr
    → Pipeline ist physisch gesund. NUR der adaptive-mode-Stop verhindert Frames.
  weight: high

- timestamp: 2026-05-06T19:09
  source: git log src/lib/server/services/bambu-mqtt.ts
  finding: |
    Letzter Code-Touch: 49ab31b (gate A1_CLOUD_MODE_ACTIVE), älter als Phase 18.
    Adaptive-Mode-Code seit 1eb345e (15. April) unverändert.
    → Keine Regression aus 7-Tage-Fenster. Behavior ist by-design seit feat(14).
  weight: high

- timestamp: 2026-05-06T19:10
  source: cam.id=14 print_state heute
  finding: |
    Heutige Print-Timeline (UTC):
      15:29 PREPARE→live   (go2rtc gestartet)
      16:17 FINISH→idle    (go2rtc gestoppt → schwarz #1)
      16:47 PREPARE→live   (go2rtc gestartet)
      17:24 FAILED→idle    (go2rtc gestoppt → schwarz #2 = jetzt)
    → User hat während eines Drucks Bild gesehen ("lief mal"); sieht jetzt nach FAILED nichts ("jetzt schwarz"). Beides konsistent mit Design.
  weight: high

## Eliminated Hypotheses

- **H1 (TLS regression 7c08b4d)**: commit touched nur `src/lib/server/orchestration/protect-hub/yaml-builder.ts` — das ist Reverse-Path (UDM → Bridge LXC, vmid 2014). Bambu Forward-Path nutzt anderen YAML-Builder, ist nicht betroffen.
- **H2 (VAAPI broken)**: go2rtc start auf vmid 2011 ist sauber, low-stream Pipeline mit `hardware=vaapi` wird auch abgesetzt (siehe /api/streams Output). Wäre VAAPI broken, würde der Service zwar starten aber low-stream-Producer würde fehlern (was nicht passiert).
- **H3 (source disconnect)**: Bambu A1-spezifischer JPEG-over-TLS:6000 ist nicht der H2C-Pfad. H2C nutzt rtspx:322 mit Live555. Source ist erreichbar (ffprobe → 1680×1080 h264), Auth-Code de0ad0a4 funktioniert.
- **H4 (channel-selection 95fb786)**: 95fb786 baut Protect-Hub-Reconciler-URLs (rtspz://controller:7441/…), nicht Bambu-Forward-URLs. Disjoint code paths.
- **H5 (YAML drift)**: /etc/go2rtc/go2rtc.yaml ist gültig (rtspx-Source + ffmpeg low-stream). Wenn Service läuft, antwortet er sauber.

## Resolution

### Root Cause

`src/lib/server/services/bambu-mqtt.ts` Zeilen 14-23 und 66-114: **Adaptive Stream-Mode** stoppt `go2rtc.service` per SSH+systemctl auf dem Bambu-LXC, sobald die MQTT-State-Group auf 'idle' wechselt (FINISH, IDLE, FAILED). Während der Drucker idle ist, hat Protect keinen RTSP-Source-Endpoint mehr und zeigt das letzte (oder gar kein) Frame als schwarz.

Das Verhalten ist intentional (commit `1eb345e feat(14)`: "Protects the H2C's fragile Live555 server"), aber die UX-Konsequenz ist: in Protect sieht der User bei jedem nicht-druckenden Zustand schwarz. Der User hat für die A1 Mini bereits `stream_mode='always_live'` gesetzt, aber für die H2C nie.

**Es ist KEINE Regression** — das ist seit ~3 Wochen so. Die jüngsten Commits (7c08b4d, 27297c6, 61f72a9, 95fb786) betreffen alle den Reverse-Path (Protect-Hub-Bridge), nicht Bambu-Forward.

### Specialist Hint

`general` — der Fix ist eine Konfigurations-/UX-Entscheidung, kein TypeScript- oder Streaming-Spezialthema.

### Fix Options

**Option A — Quick: cam 14 auf always_live umstellen (kein Code-Change)**

```bash
ssh ip-cam-master "sqlite3 /opt/ip-cam-master/data/ip-cam-master.db \\
  \"UPDATE cameras SET stream_mode='always_live', updated_at=datetime('now') WHERE id=14;\""
ssh ip-cam-master "ssh -i /root/.ssh/ip-cam-master root@192.168.3.6 \\
  'pct exec 2011 -- systemctl start go2rtc'"
# (oder via UI: PATCH /api/cameras/14/bambu-state {streamMode:'always_live'})
```

Pro: Atomar, kein Code-Risk, sofortige Wirkung. Cam 20 läuft schon so seit Wochen ohne Probleme.
Contra: Wenn die Live555-Fragility-Annahme bei H2C zutrifft, könnte 24/7-Pull den Drucker stressen (heutige Smoke-Tests zeigen aber stabilen Stream).

**Option B — Default-Switch: stream_mode-Default per Modell (Code+Migration)**

`bambu-provision`-Endpoint und/oder `seedDefaultBambuMode()` setzt für H2C `always_live`, für A1/A1-Mini `adaptive`. Eine kleine Migration setzt bestehende H2C-Rows um.

Pro: Robust für zukünftige H2C-Onboardings.
Contra: Mehr Surface Area (Code+Migration+Test+Re-deploy), und löst den heutigen User-Pain nicht schneller als Option A.

**Option C — UX: Banner "Stream paused (printer idle) — switch to always-on?" mit One-Click-Toggle**

Pro: Nimmt den User an die Hand.
Contra: Mehr Code, neue UI-Komponente, Phase-Planning nötig.

### Recommended

**Option A jetzt** (sofortiger User-Pain weg) + ggf. Option B in einer kleinen Folge-Phase als saubere Default-Fixierung.

### Applied Fix (2026-05-06 19:22 UTC)

User picked Option A. Two atomic actions on the live VM:

1. **DB flip**: `UPDATE cameras SET stream_mode='always_live', updated_at=datetime('now') WHERE id=14;`
   Verified: `14|Bob the Builder|always_live|2026-05-06 19:22:13`
2. **go2rtc start**: `pct exec 2011 -- systemctl start go2rtc` (had been stopped since 17:24:44)
   Verified: `Active: active (running)` from 19:07:02 onward (investigator's smoke test was first-start; flip prevented re-stop on next mqtt event).

### Verification (live evidence)

- **Source → go2rtc**: `ffprobe rtspx://bblp:de0ad0a4@192.168.3.109:322/streaming/live/1` → h264 1680×1080 30fps ✅
- **go2rtc :8554**: `/api/streams` shows producer with 422,984,191 bytes / 306,531 packets received from upstream, low-stream consumer attached ✅
- **onvif-server :8556**: `ffprobe rtsp://127.0.0.1:8556/bambu-201453` → h264 1680×1080 ✅ (active running 12h)
- **Protect UI**: User confirmed "live-bild vom h2c läuft direkt wieder in unifi protect ohne änderung durch mich" at 19:30 UTC (within ~8 min of flip).

### Red Herring Investigated (UDM 10:47 disconnect log)

UDM `cameras.thirdParty.log` shows `2026-05-06T10:47:46 - warn: Bob the Builder ... considering disconnected`. Initially looked like a separate Protect-side stale-connection issue. **Eliminated:** at the same minute (10:47–10:48 UTC), Protect logged the same `considering disconnected` warning for *Park, Parkplatz, Terrasse, Hochbeet, Intercom* simultaneously — UDM-wide event (likely Protect-worker restart or network blip). The other cams self-healed because their RTSP sources stayed up. Bambu *would have* self-healed too, but its source was repeatedly killed by adaptive-mode → user perceived it as "permanent black".

### Why this happened today specifically

- 15:29 UTC: print PREPARE → go2rtc start, Protect happy
- 16:17 UTC: print FINISH → go2rtc stop (black #1)
- 16:47 UTC: print PREPARE → go2rtc start
- 17:24 UTC: print FAILED → go2rtc stop (black #2 — visible to user at 19:02 when he checked)
- always_live flip means: from 19:22 onward, MQTT print-state events are decoupled from go2rtc lifecycle on cam 14.

### Backlog (recommended follow-up)

- **Option B**: Provisioning default `stream_mode='always_live'` for H2C model in `seedDefaultBambuMode()` + one-shot migration for any existing H2C rows still on `adaptive`. Phase candidate or `/gsd:quick`. Avoids future onboarding gotcha.
- The Live555-fragility assumption from `1eb345e feat(14)` (April) hasn't been re-validated against current Bambu firmware. Cam 20 (A1 Mini) ran on always_live for weeks without issues; cam 14 (H2C) now testing the same.

Status: **resolved** — pipeline healthy, fix applied, user confirmed live image visible.
