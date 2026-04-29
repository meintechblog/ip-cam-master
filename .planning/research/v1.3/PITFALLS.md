# Pitfalls Research — v1.3 Protect Stream Hub (Loxone + Frigate-ready)

**Domain:** UniFi-Protect-to-external-consumer stream bridge with auto-reconciliation, layered onto an existing camera-management webapp (IP-Cam-Master v1.0–v1.2)
**Researched:** 2026-04-30
**Confidence:** MEDIUM-HIGH (HIGH on go2rtc/Protect-share-token/codec issues — many independent reports; MEDIUM on Loxone-side caching and integration-into-existing-scheduler concerns — fewer field reports for *this exact* combo)

> **Scope discipline:** This document covers pitfalls *specific to v1.3*. Generic SvelteKit/SQLite/Proxmox/SSH pitfalls already mitigated in v1.0–v1.2 are NOT re-listed. The focus is on the integration of a *new bridge container with auto-reconciliation* into an *existing* per-camera-container app.

---

## Critical Pitfalls

### Pitfall 1: Protect "Share Livestream" RTSPS token rotates on every Protect restart — silent stream death

**What goes wrong:**
The user-facing way to expose a Protect camera as `rtsps://...:7441/<token>?enableSrtp` is the **Share Livestream → Enable Secure RTSPS Output** toggle. The generated URL embeds a per-camera token in the path. **Every time UniFi Protect restarts** (firmware OTA, UDM reboot, Protect app upgrade, manual restart), Protect regenerates a new token for each shared stream. Every cached URL becomes a 404 dead link. Confirmed by [openHAB #20072](https://github.com/openhab/openhab-addons/issues/20072): "Every time openHAB restarts, the links for Enable Secure RTSPS Output under Share Livestream in the UniFi Protect web interface changes."

For v1.3 this is a **catastrophic** failure mode: the bridge's go2rtc.yaml stores rtsps URLs with embedded tokens. After a single UDM reboot, every Loxone tile and Frigate camera goes black until reconciliation runs. Worse: if reconciliation only diffs by camera ID/name, it won't re-pull the URL, and drift goes undetected.

**Why it happens:**
Protect generates the share-token at the moment "Enable Secure RTSPS Output" is toggled on, stores it in its own DB, and on restart re-issues a fresh token (likely tied to the controller's session/bootstrap state). Tokens are not stable identifiers — they are session-scoped capabilities.

**How to avoid:**
1. **Never trust a cached rtsps share-URL across reconciliation cycles.** On every reconcile pass, re-fetch the bootstrap and re-extract the current rtsps URL from `camera.channels[].rtspsAlias` (or whichever field the current `unifi-protect` lib version exposes).
2. **Detect Protect-side restart explicitly.** The `unifi-protect` lib emits WebSocket disconnect events; on every reconnect, treat the bootstrap as freshly-issued and force a full URL refresh in the bridge YAML.
3. **Prefer the internal RTSPS endpoint over the Share-Livestream token URL** when possible. Protect cameras also expose `rtsps://<udm-ip>:7441/<channelToken>?enableSrtp` from the bootstrap directly — these tokens are more stable across restarts than the Share-Livestream tokens (still rotatable, but less aggressively). Verify against the user's actual UDM in the Phase 19 spike.
4. **Hash the *resolved* upstream URL inside the deployed YAML** and compare on every reconcile. If Protect rotated the token, the hash differs → trigger redeploy automatically.
5. Surface a dedicated dashboard error when reconciliation detects a token rotation: *"Protect controller restarted — refreshed N stream tokens"* so the user understands why streams blipped.

**Warning signs:**
- Loxone tiles show "no signal" hours/days after a known-good adoption.
- go2rtc log: `RTSP error: 404 Not Found` against `*:7441/<token>`.
- Bridge container's `go2rtc.yaml` mtime is older than the last UDM reboot.
- `unifi-protect` lib emits a WebSocket close event that wasn't followed by a redeploy.

**Phase to address:** Phase 19 (data model — store *which Protect token URL field* we trust, never cache stale tokens), Phase 21 (reconciliation loop must re-fetch URLs every pass, not just metadata), Phase 22 (UI surfaces "tokens rotated" event).

---

### Pitfall 2: Camera identity drift — `id` is mutable across Protect backup/restore; `mac` is not

**What goes wrong:**
The `unifi-protect` bootstrap exposes per-camera `id` (a 24-char hex like `61b3dc384...`), `mac` (12-char hex), and `name` (user-editable). Choosing the wrong field as the v1.3 primary key causes:

- **Backup/restore:** UniFi Protect's backup-restore preserves cameras by **MAC address** ([UI Help](https://help.ui.com/hc/en-us/articles/19118654419607-Migrating-Cameras-Between-NVRs)). The Protect-internal `id` may change after a restore from backup or migration to a new UDM/UNVR.
- **Re-adoption:** If a user un-adopts and re-adopts a camera (common during Protect troubleshooting), the `id` *will* change. MAC is constant.
- **Name editing:** Users rename cameras frequently. Using `name` as a key breaks every reconciliation pass after a rename.

If v1.3 uses `id` as the primary key in our SQLite `external_cameras` table, every Protect restore/migration causes the bridge to:
1. See "all old cameras gone" → tear down all bridge streams.
2. See "all new cameras appeared" → onboard them as fresh entries.
3. User loses every per-camera output toggle they configured.

**How to avoid:**
1. **Primary key = `mac`** (normalized to lowercase, no separators). MAC is stable across backup/restore, re-adoption, rename. Confirmed by Protect's own filesystem layout (`/src/unifi-protect/video/<MAC>/`).
2. **Store `id` and `name` as denormalized cache fields** for display and API calls, but never join on them. On every reconcile, look up by MAC and refresh `id`/`name`.
3. **Reconciliation algorithm:** `external_cameras` keyed by MAC; on each pass, build `Map<mac, ProtectCamera>` from bootstrap; diff sets by MAC, not by `id`.
4. Add a migration check in v1.4+: if the user's existing `external_cameras` rows ever had `id` as PK, migrate to MAC-keyed and log warning if collisions occur.
5. Display both name *and* MAC in `/cameras` for external cams so the user can disambiguate after a rename.

**Warning signs:**
- After Protect restore: all bridge cams show "gone" + "newly discovered" in the same reconcile.
- After camera rename: user's per-output toggles reset.
- Database has `external_cameras.id` rows that no longer match any bootstrap entry but the MAC still exists.

**Phase to address:** Phase 19 (schema design — MUST lock MAC as PK before any code is written; this is irreversible later without a painful migration).

---

### Pitfall 3: WebSocket reconnect storm against Protect during UDM reboots / firmware updates

**What goes wrong:**
The `unifi-protect` lib opens a long-lived WebSocket to `wss://<udm>/proxy/protect/ws/updates` for real-time camera state. When the UDM reboots (firmware update, reset, ISP outage), the WS drops. A naive reconnect implementation (1-second backoff) hammers the UDM during its 60–120 second boot window, causing:

- Hundreds of failed handshakes piling up in our log.
- Possible UDM-side rate-limit or temporary IP block.
- Wasted CPU on the app VM.
- Race condition: when the UDM finally accepts the connection, our code is in a partial-state because we already issued N parallel reconnect attempts.

This is a known class of bug: see [bananamafia.dev cloudless UniFi writeup](https://bananamafia.dev/post/unifi/) and the general pattern across UniFi clients. The Protect controller firmware bug [hjdhjd/homebridge-unifi-protect #701](https://github.com/hjdhjd/homebridge-unifi-protect/issues/701) shows that even mature plugins hit disconnect storms when the controller has bugs.

**How to avoid:**
1. **Exponential backoff** on WebSocket reconnect: start at 5s, double up to 5min cap. Same pattern as Bambu MQTT (Pitfall 7 from v1.2).
2. **Single-flight reconnect**: a global `reconnecting: Promise<void>` so multiple parts of the app awaiting Protect updates don't trigger N parallel reconnects.
3. **Health-state machine**: `connected` → `disconnected` → `reconnecting` → `connected`. Reconciliation only runs when `connected`. Pause reconcile loop during reconnect — do NOT keep diffing against stale bootstrap.
4. **Mark the disconnect explicitly in DB** (`hub_state.protect_last_seen`) so the dashboard can show "Protect unreachable for N seconds" and the user knows the bridge is paused, not broken.
5. On every successful reconnect, **re-fetch full bootstrap** and force a reconciliation pass (Pitfall 1's token rotation likely happened too).

**Warning signs:**
- App log shows >10 WS connect attempts within 60 seconds.
- `journalctl -u ip-cam-master | grep -c "WS reconnect"` exceeds 1 per 5min over a 24h window.
- Dashboard shows "live" but Protect updates are seconds/minutes stale.

**Phase to address:** Phase 21 (reconciliation orchestrator + Protect connection lifecycle — these MUST be co-designed; the connection state machine drives the reconciler).

---

### Pitfall 4: Single-channel cameras (G3 Flex, AI Bullet basic, etc.) — silent skip vs. error

**What goes wrong:**
Not every UniFi camera exposes Low/Medium/High RTSP channels. Older models, low-end cameras, or some firmware versions only expose **one channel** (or even zero RTSP-enabled channels until the user opts-in via the Protect UI). Confirmed by [community.ui.com on RTSP availability](https://community.ui.com/questions/Access-UniFi-Protect-camera-RTSP-stream/b1ba4c62-0764-4223-80d0-650768b0f87f) and [BenSoftware forum](https://bensoftware.com/forum/discussion/4592/optimal-unifi-rtsp-settings) — "you can enable a minimum of one stream."

Failure modes specific to v1.3:

- User enables Frigate-RTSP-passthrough (expects High channel) on a cam that only has Low → bridge tries to copy a non-existent stream → ffmpeg dies with cryptic error.
- Stream-Catalog UI shows "Low/Medium/High" placeholders for a cam that only has one — user gets a misleading view of capabilities.
- Reconciler treats "channel disappeared" (user toggled off in Protect) the same as "camera offline" → wrong remediation.

**How to avoid:**
1. **Build the Stream Catalog from bootstrap, not from assumptions.** For each camera, iterate `camera.channels[]` and surface only the channels where `isRtspEnabled === true` AND `bitrate > 0` (some channels exist in metadata but aren't actually streamable).
2. **In the UI, show actual channel inventory per cam** ("This cam exposes 2 of 3 possible channels: Medium @ 1280×720, Low @ 640×360 — High is disabled in Protect"). Provide a deeplink hint to Protect's channel-enable page.
3. **Output toggles must be gated on channel availability.** Frigate-RTSP toggle disabled if no high-bitrate channel exists; Loxone-MJPEG toggle requires *any* channel as source.
4. **Differentiate "no RTSP enabled" from "camera offline"** in reconciler state. The former is a user-action prompt; the latter is a transient health issue.
5. **Cache the channel inventory + invalidate on every bootstrap**, so a user enabling the High channel in Protect's UI gets reflected within one reconcile cycle.

**Warning signs:**
- Bridge logs `ffmpeg: Server returned 404 Not Found` against an `rtsp://...:7441/<token>` URL.
- User reports "I selected Frigate output but nothing comes through" — check if the cam has a high-bitrate channel.
- UI shows "Low/Medium/High" on every camera regardless of model — that's the bug, real cams have variable inventories.

**Phase to address:** Phase 20 (Stream Catalog modeling — schema must allow N-channel cams, not assume always-3); Phase 22 (UI gating output toggles on channel availability).

---

### Pitfall 5: go2rtc YAML drift — go2rtc can rewrite the file out from under us

**What goes wrong:**
go2rtc's web UI editor (at `:1984/editor.html`) **writes back** to the YAML when used. Even without UI editing, the `POST /api/config` endpoint **persists** changes and triggers restart. If anyone (including go2rtc itself for runtime additions via `PUT /api/streams`) modifies the YAML, our hash-based drift detection sees "drift" on the next reconcile and overwrites their changes — potentially in a loop.

Worse: go2rtc may **rewrite the file with reformatted YAML** (different key ordering, comment stripping) even if the *semantic* content is identical. A naive `sha256(fileContents)` comparison then triggers spurious "drift detected" alerts.

**How to avoid:**
1. **Single writer principle:** v1.3 is the *sole* writer of the bridge's go2rtc.yaml. Document this loudly. Disable go2rtc's web UI editor in the deployed config (`api: { ui_editor: false }` or block port 1984 from LAN if possible — at minimum bind it to localhost only inside the LXC).
2. **Compare on canonical form, not raw bytes.** Hash the YAML *after* parsing and re-serializing through a stable serializer (e.g., `js-yaml` with `sortKeys: true`). Drift = semantic difference, not whitespace difference.
3. **Don't use `PUT /api/streams` from our reconciler.** YAML-as-source-of-truth is the only sane model. Deploys are: write YAML → SSH → `systemctl restart go2rtc`. Never the runtime API for persistent changes.
4. **Idempotency stamp**: write a comment header into the YAML like `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>` and check on reconcile that the stamp is *ours*. If a foreign stamp or no stamp appears, log a *warning* but don't auto-overwrite — surface to dashboard so user is aware of conflict.
5. **Mtime-based fast-path:** if YAML mtime hasn't changed since our last write AND our stamp is intact, skip the full hash check — saves SSH round-trips during quiet periods.

**Warning signs:**
- Reconcile log shows "drift detected" on every pass even when nothing changed.
- go2rtc restarts every reconcile cycle (visible in container uptime).
- The deployed YAML lacks our `# managed by ip-cam-master` stamp.

**Phase to address:** Phase 21 (reconciliation algorithm — drift detection on canonical form, idempotency stamp); Phase 20 (YAML template authorship — explicit `api.ui_editor: false` and binding choices).

---

### Pitfall 6: Reconciliation race conditions — user toggling outputs while reconcile is mid-flight

**What goes wrong:**
The reconciler runs on a timer (e.g., every 60s) and on Protect events (camera added/removed). Concurrently, the user can toggle outputs in the UI. Without locking:

- User toggles Loxone-MJPEG **on** for camA → API writes `external_outputs` row → reconciler reads the *old* state (stream pre-toggle) mid-cycle → deploys YAML *without* camA → user sees their toggle "reverted itself."
- Two reconciles spawn from two triggers (timer + WS event) → both deploy in parallel → SSH to bridge container has interleaved writes → corrupted YAML.
- User mass-disables a feature toggle while reconciler is mid-deploy → half-deployed state.

**How to avoid:**
1. **Single-flight reconciler:** module-scoped `reconciling: Promise<void>` lock. New triggers either await the in-flight pass or schedule a "dirty" flag for a follow-up pass.
2. **Read-then-write transaction inside the reconciler:** read DB state at pass start, generate YAML, write YAML, commit `last_reconciled_at` — all in one logical unit. If the user toggles during this, the *next* pass picks it up.
3. **Always do a second pass when `dirty` flag is set during a reconcile.** This guarantees the user's toggle is reflected within one pass after their action, never lost.
4. **Optimistic UI** in the toggle: write the desired state to DB immediately, show "applying..." spinner, the next reconcile reflects it. Don't try to deploy synchronously from the toggle handler — the UX gets worse, not better, when a 30s reconcile blocks the click.
5. **Per-bridge mutex** (not per-camera) — the entire bridge YAML is one atomic unit. Trying per-camera locking creates worse races.

**Warning signs:**
- User reports "I toggled X on but it didn't stick — had to toggle it again."
- Two reconcile log entries within seconds of each other.
- Bridge YAML has corrupted/duplicate entries.

**Phase to address:** Phase 21 (reconciler concurrency model + DB transaction boundaries); Phase 22 (toggle UI uses optimistic-write pattern, not synchronous deploy-on-click).

---

### Pitfall 7: VAAPI contention with N concurrent ffmpeg encoders sharing one `/dev/dri/renderD128`

**What goes wrong:**
The bridge container hosts *all* Loxone-MJPEG transcodes (one ffmpeg process per active Loxone output) on a single `/dev/dri/renderD128`. With Mobotix/Loxone/Bambu containers also using the same `/dev/dri` on the host (Pitfall 12 from v1.2's docs explicitly says VAAPI is shared), the total concurrent encoder count grows quickly:

- 3 Mobotix + 1 Loxone + 1 Bambu (existing managed cams) + N Loxone-bound Protect cams (new bridge) = 5+N parallel VAAPI encoders.
- Intel iGPU encoder concurrency limits: roughly 4–8 simultaneous encodes on consumer Intel iGPUs (varies by generation).
- Symptoms when over the limit: random encoder failures, ffmpeg dying with `vaapi: VA-API encoder failed`, video freezing on some streams while others work, [#252 reports VAAPI confusion with multiple GPU devices](https://github.com/AlexxIT/go2rtc/issues/252).

For v1.3 the risk is amplified because the bridge centralizes streams that previously had natural fan-out (per-cam containers each used their tiny share). One bridge with 8 cams × Loxone-MJPEG-transcode = 8 concurrent VAAPI sessions in a single LXC.

**How to avoid:**
1. **Cap concurrent VAAPI encodes per bridge.** Soft limit: 4 simultaneous Loxone outputs; show warning past that. Hard limit: 6; deny additional output toggles past that.
2. **Loxone-MJPEG default config: 640×360 @ 10fps, h264 baseline, low bitrate (~500kbps).** This is the lightest possible encode and matches the [Florian Rhomberg blogpost](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) recipe. Lower-spec encodes are far more parallel-friendly than 1080p60.
3. **Frigate-RTSP output should be `-c:v copy` (passthrough), zero VAAPI cost.** Document this loudly: only Loxone-MJPEG burns VAAPI.
4. **Surface VAAPI utilization on the Hub dashboard** — read `/sys/class/drm/renderD128/device/...` or use `intel_gpu_top` output via SSH, display "VAAPI: 3/6 encoders active." Catches resource exhaustion before it cascades.
5. **Test:** Phase 19/20 acceptance must include "8 simultaneous Loxone outputs run for 30 minutes without ffmpeg failure." If the user's specific iGPU can't hit 8, the cap shifts down accordingly.

**Warning signs:**
- ffmpeg log: `VA-API encoder failed`, `Failed to allocate VAAPI encode session`.
- Some Loxone tiles work, others freeze randomly without an obvious pattern.
- `intel_gpu_top` shows engine queue saturation.

**Phase to address:** Phase 19 (Bridge-LXC provisioning — `/dev/dri` passthrough + concurrency planning); Phase 20 (output-type Loxone vs Frigate cost model — explicitly document Loxone=expensive, Frigate=free); Phase 22 (UI enforces concurrency cap with user-visible counter).

---

### Pitfall 8: Bridge container TLS verification of UDM's self-signed cert (`rtsps://`)

**What goes wrong:**
UDM/UNVR controllers ship with a self-signed cert on port 7441. go2rtc/ffmpeg pulling `rtsps://<udm>:7441/...` will fail TLS verification by default:

- ffmpeg log: `tls: failed to verify certificate: x509: certificate signed by unknown authority`
- Stream works in VLC (no validation) but not in go2rtc inside the bridge.

This is the same class of issue as Bambu's self-signed cert (Pitfall 2 from v1.2), but the UDM cert has *additional* quirks:
- The cert may be valid for the UDM's hostname (`unifi.local` or hardware serial) but **not** for the IP we use.
- If the user has a custom CA installed on the UDM (some users do this for their LAN PKI), the cert may chain to a private CA that go2rtc has no access to inside the LXC.
- Some UniFi firmware versions present *different* certs on port 443 (web UI) vs 7441 (RTSPS) — checking one doesn't validate the other.

**How to avoid:**
1. **Use go2rtc's `rtspx://` scheme** for Protect streams — go2rtc-specific TLS-skip variant. This is the canonical way for UniFi cams; documented in go2rtc's own examples.
2. Alternative: pass `#tls_verify=0` in the source URL params, OR set `ffmpeg.bin: ffmpeg -tls_verify 0` template.
3. **Always use IP, not hostname**, in the deployed YAML. Resolve mDNS/DHCP hostname → IP at write-time.
4. Phase 19 spike must verify the user's actual UDM (192.168.3.1 per CLAUDE.md context) — confirm rtspx:// works against their specific firmware version before locking the template.
5. Document in onboarding wizard: "Protect TLS certs are self-signed; we skip cert validation on the LAN. If your security model requires strict cert validation, install a custom CA on the bridge container."

**Warning signs:**
- All Protect streams fail with TLS errors in go2rtc logs.
- VLC/browser pulls work fine but bridge does not.
- TLS error message specifically mentions `not valid for IP` or `unknown authority`.

**Phase to address:** Phase 19 (spike validates UDM TLS path); Phase 20 (go2rtc YAML template uses rtspx:// or tls_verify=0).

---

### Pitfall 9: Onboarding wizard interrupted mid-flow — non-recoverable state

**What goes wrong:**
The Phase-19/20 onboarding wizard has 6 steps (per PROJECT.md):
1. Protect connection
2. Bridge LXC provision
3. Discovery preview
4. Cam selection + default outputs
5. Initial reconcile
6. Done

Failure points and the resulting orphan states:

- **Step 2 fails (Proxmox API error, container slot full, network mid-failure):** Half-provisioned LXC, partial DB rows, `hub_enabled=true` but no working bridge → `/cameras` shows "loading..." forever.
- **Step 5 fails (SSH dropped, go2rtc start failed):** YAML deployed but go2rtc not running, DB says everything is fine.
- **User closes browser at step 3:** `hub_enabled=true`, container exists but has no streams; no clear "resume" path next visit.
- **Protect creds wrong at step 1:** User enters bad password → 401 → wizard shows "wrong creds" but didn't roll back; if user navigates away, `hub_enabled=true` with broken creds persists.

**How to avoid:**
1. **State machine + idempotent resume:** every wizard step writes its outcome to a `hub_onboarding_state` table (`{step, status, error, started_at}`). On settings page reload, if `hub_onboarding_state.step != "completed"`, *resume the wizard at that step* instead of re-starting from scratch.
2. **Idempotent provisioning:** Step 2 (LXC creation) checks "is bridge LXC already created?" before creating. Re-running the step doesn't create a duplicate. Same pattern as Phase-04/05's existing per-cam provisioning.
3. **`hub_enabled = false` until Step 6 completes successfully.** The toggle in Settings is the *outcome* of successful onboarding, not the *trigger*. This prevents `/cameras` from showing broken external entries while wizard is incomplete.
4. **Explicit "abort onboarding" button** at every step. Cleanup runs on abort: stop+destroy bridge LXC if Step 2+ completed, delete `hub_onboarding_state`, leave nothing dangling.
5. **Distinguish "creds wrong" from "controller unreachable"** at Step 1. Different remediation: re-enter creds vs. check network.
6. **Test:** Phase 22 acceptance must include "kill app process during Step 5; restart; resume; complete successfully" without manual DB cleanup.

**Warning signs:**
- DB has `hub_enabled=true` but `bridge_container_status != "running"`.
- DB has half-populated `external_cameras` rows from a previous wizard.
- User opens Settings and sees "enable hub" toggle, clicks, but a wizard appears mid-state with no explanation.

**Phase to address:** Phase 22 (wizard implementation — state machine MUST be the foundation, not bolted on); Phase 19 (schema includes `hub_onboarding_state` table from day 1).

---

### Pitfall 10: Offboarding leaves orphans — bridge container, Protect-side share toggles, DB rows

**What goes wrong:**
Offboarding (per PROJECT.md): toggle off → confirm dialog → optional container destroy or stop-only → DB cleanup → optional Protect-share-toggle disable. Failure modes:

- **User picks "stop only, keep container":** great for re-enable, but if user later destroys the LXC manually in Proxmox UI, our DB still has `bridge_container_id=N` pointing to nothing. Re-enable later finds container "stopped" (404), confused state.
- **User picks "destroy container":** container destroy SSH fails halfway → DB says destroyed, container still exists → next install attempt collides on container ID.
- **Protect-side share toggles left enabled:** if we ever auto-enabled "Share Livestream" on cameras (open question per STATE.md), and offboarding fails to clean those up, the user's Protect UI shows N cameras with "Share Livestream: ON" forever — a privacy-implication footgun.
- **DB cleanup partial:** `external_cameras` deleted but `external_outputs` orphaned (FK without cascade), or vice versa.
- **`/cameras` UI shows ghost rows after offboarding** if cache wasn't invalidated.

**How to avoid:**
1. **Cleanup script with explicit idempotent steps**, each retryable:
   - (a) Stop bridge container (idempotent: already stopped = OK).
   - (b) Optional destroy (idempotent: already gone = OK).
   - (c) For each `external_camera` row: if Protect-share was auto-enabled by us, call `setRtspsAlias(cameraId, false)` via `unifi-protect`; tolerate 404/auth-failure (controller may be unreachable but offboarding should still complete locally).
   - (d) Delete `external_outputs` rows (FK cascade or explicit).
   - (e) Delete `external_cameras` rows.
   - (f) Set `hub_enabled=false`, `bridge_container_id=NULL`.
2. **Track "what we enabled in Protect" explicitly.** `external_cameras.share_enabled_by_us BOOLEAN` — only disable on offboarding what we ourselves enabled. Never touch user-configured shares.
3. **Confirm-dialog must list concrete consequences:** "N cameras will disappear from /cameras", "Loxone tiles for cam-X, cam-Y will go offline", "Frigate config referencing rtsp://bridge:8554/* will need updating", "M Protect-side Share-Livestream toggles will be turned off."
4. **Re-enable path detects orphans:** if `hub_enabled=true` but bridge container missing, treat as "offboarding was interrupted; finish cleanup before re-enabling." Don't silently re-create on top of stale state.
5. **Add "force cleanup" admin action** in Settings for the rare case all the above fails — wipes hub state from DB, resets to "never enabled."

**Warning signs:**
- After offboarding, `/cameras` still shows external entries.
- Proxmox UI shows the bridge container exists but app says it doesn't.
- Protect web UI shows "Share Livestream: ON" for cameras the user never explicitly shared.

**Phase to address:** Phase 22 (offboarding flow — must be implemented as cleanup-script, not as a delete-cascade-and-hope; tests must cover partial failures).

---

### Pitfall 11: Reconciler false-positive drift after go2rtc internal config rewrite

**What goes wrong:**
go2rtc's `POST /api/config` and `PUT /api/streams` endpoints write back to the YAML file. If anyone touches go2rtc's web UI editor (even just to view it), the file may be silently rewritten with reformatted YAML even if no semantic change was made. Our reconciler then sees "drift" and redeploys, creating an infinite loop.

(This is closely related to Pitfall 5 but worth calling out as a distinct race: even *without* malicious intent, the YAML can drift from format alone.)

**How to avoid:**
1. (See Pitfall 5 mitigations — canonical-form hashing.)
2. **Disable the go2rtc web UI editor in the deployed config**: bind the API to localhost-only inside the bridge LXC (`api: { listen: "127.0.0.1:1984" }`), expose only `:1984/api/streams.mjpeg` and `:8554/<name>` externally via firewall rules.
3. **Health-check endpoints (`GET /api/streams`) are read-only** — these are safe for our app to use to verify deploy success without triggering rewrite.

**Warning signs:**
- Bridge YAML mtime changes without an app-initiated deploy.
- Reconciler log shows "drift, redeploying" with no DB-side change.
- go2rtc internal stats show recent restarts that don't correlate with our deploy log.

**Phase to address:** Phase 20 (deployed go2rtc config — bind API to localhost, document the constraint).

---

### Pitfall 12: Settings toggle flapping — user toggles hub on/off in quick succession

**What goes wrong:**
User clicks "Enable Hub" → wizard starts → user changes mind, clicks "Disable Hub" before wizard finishes → in-flight wizard step (e.g., LXC provision) completes after disable was acknowledged → orphaned container.

Or: user toggles repeatedly to test → multiple parallel onboarding flows kick off → race conditions in DB state.

**How to avoid:**
1. **Toggle is disabled (greyed out) while a transition is in flight.** UI shows "starting hub..." or "tearing down hub..." with a non-cancellable spinner until the state-machine reaches a stable state.
2. **State machine in DB:** `hub_state ENUM('disabled', 'starting', 'enabled', 'stopping', 'error')`. Transitions are explicit and one-way until terminal. The settings toggle reads this and only allows action from `disabled` or `enabled`.
3. **Cancellation is a separate explicit action**: while in `starting`, an "abort" button appears (different from the toggle); aborting transitions to `stopping` which runs the cleanup (Pitfall 10).
4. **Idempotent transitions:** if a duplicate "enable" arrives while already `starting`, return current progress, don't kick a parallel flow.

**Warning signs:**
- DB has multiple in-flight `hub_onboarding_state` rows.
- Multiple bridge containers exist on Proxmox.
- User reports "the toggle just spins forever."

**Phase to address:** Phase 22 (Settings UI + state-machine for hub lifecycle).

---

### Pitfall 13: Self-update reload (v1.1 feature) clobbers in-flight bridge deploy

**What goes wrong:**
v1.1 shipped self-update via `git pull` + `systemd-run --transient` restart. If the user clicks "update" while a reconcile is mid-deploy (mid-SSH, mid-YAML-write), the app process restarts and:

- SSH session aborted mid-write → bridge has half-written YAML → go2rtc fails to start on next boot.
- Reconciler in-memory state lost → `dirty` flag pending writes lost.
- Onboarding wizard mid-step gets killed.

**How to avoid:**
1. **In-flight reconcile lock visible to update endpoint.** Self-update API call (`POST /api/self-update`) checks `reconciler.busy` and returns `409 Conflict {reason: "reconcile in progress, retry in N seconds"}`.
2. **Onboarding wizard in-flight = block self-update.** Same gate.
3. **Graceful shutdown** in the SvelteKit hook: on SIGTERM (which `systemd-run` will send), wait up to 30s for in-flight reconcile to complete before exiting. Don't hard-kill mid-SSH.
4. **YAML deployment uses atomic write** (write to `go2rtc.yaml.tmp`, then `mv` — single syscall). Even if killed mid-write, the existing YAML survives.
5. Surface "self-update will resume in N seconds (waiting for reconcile)" so the user understands the pause.

**Warning signs:**
- After self-update, bridge container has corrupted YAML.
- After self-update, hub state is `starting` indefinitely (wizard was killed mid-flow).
- `journalctl` shows SIGTERM during a reconcile.

**Phase to address:** Phase 21 (reconciler exposes `busy` flag; self-update endpoint respects it); Phase 22 (graceful shutdown in hooks.server.ts).

---

## Moderate Pitfalls

### Pitfall 14: Stream that goes offline mid-bridge — go2rtc holds the consumer connection

**What goes wrong:**
A Protect camera reboots (firmware update, power blip, manual restart). go2rtc's source connection drops. Per [#762](https://github.com/AlexxIT/go2rtc/issues/762) and [#258](https://github.com/AlexxIT/go2rtc/issues/258), go2rtc has historical issues with reconnect logic — sometimes it holds the consumer-side connection open while the source is dead, sometimes it drops both sides.

**Consumer-side impact:**
- **Loxone tile:** holds onto the persistent MJPEG connection, sees no new frames, eventually times out after 30–60s and goes blank. User-visible disruption.
- **Frigate:** depends on Frigate's own RTSP-source reconnect logic. Frigate is relatively robust; usually self-recovers within seconds.

**How to avoid:**
1. **Document `disable_static = false`** in the deployed go2rtc YAML so streams stay defined even if source briefly drops.
2. **Health-check loop:** every 30s, hit `GET /api/streams` and verify each declared stream has `producers > 0` (i.e., at least one upstream connection alive). If `0` for >2min, surface "stream X upstream disconnected" in dashboard.
3. **Force reconnect:** when our health check sees `producers=0` and Protect bootstrap shows the camera is back online, call `DELETE /api/streams?src=<name>` followed by `PUT /api/streams?...` to force go2rtc to redial. Or, in worst case, restart the entire go2rtc service.
4. Document the user-visible behavior: "After a Protect camera reboots, expect 30–60s of Loxone tile blackness."

**Phase to address:** Phase 21 (reconciler health-check sub-loop separate from the main reconcile; runs more often).

---

### Pitfall 15: Bridge container exposes streams to entire LAN — security model documentation

**What goes wrong:**
The bridge's `:1984/api/stream.mjpeg` and `:8554/<cam>` endpoints are unauthenticated by default. Anyone on the LAN with the bridge's IP can pull every Protect camera's stream. For homelab this is *probably acceptable* (LAN trust boundary) but should be **explicit** in docs and considered when the user has IoT VLANs or guest networks bridged to the same subnet.

**How to avoid:**
1. **Document the LAN trust boundary explicitly** in the v1.3 README and onboarding wizard final step. Same wording as v1.2's Bambu integration: "All bridge endpoints are LAN-accessible without auth. If your network has untrusted devices on the same subnet, configure firewall rules to limit access to the bridge IP."
2. **Bind only to the LXC's primary interface**, not 0.0.0.0 across all interfaces. (Default is 0.0.0.0 — change in deployed YAML if container has multiple NICs.)
3. **Optional Phase 23+ feature:** go2rtc supports basic auth on stream endpoints (`api: { username: ..., password: ... }`). Defer to v1.4 unless user explicitly requests in v1.3.
4. **No secrets in publicly-fetched URLs.** The Loxone tile URL `http://bridge:1984/api/stream.mjpeg?src=<cam>-low` doesn't embed creds — only stream name. Safe to copy/paste in Loxone Config.

**Warning signs:**
- N/A (this is a documentation / awareness issue, not an implementation bug).

**Phase to address:** Phase 22 (onboarding wizard final step + README); Phase 19 (LXC network config — single-NIC by default).

---

### Pitfall 16: Stream URL stability — Loxone caches the URL

**What goes wrong:**
Loxone Miniserver's Camera-Config + Motion Shape Extreme caches the camera URL aggressively. If the bridge IP changes (LXC re-provisioned, DHCP re-lease), Loxone keeps polling the old IP for hours/days. User has to manually update Loxone Config and re-upload to Miniserver for each affected camera.

**How to avoid:**
1. **Bridge LXC must have a static IP** (DHCP reservation OR static config in container). Mirror the existing per-cam container pattern that already does this.
2. **Document the expected URL format** in copy-friendly form: `http://<bridge-ip>:1984/api/stream.mjpeg?src=<cam-mac-low>`. Surface in cam detail page with copy button.
3. **mDNS / hostname approach is unreliable** — Loxone Miniserver doesn't always resolve mDNS; some firmware versions don't resolve hostnames at all. Always use IP.
4. **Re-onboarding the bridge to a new IP** is the user's responsibility for v1.3; document the steps. (v1.4+ candidate: sync URL changes back to Loxone via Loxone API — out of scope for v1.3.)

**Warning signs:**
- Loxone tiles black after a bridge container restart, recover only after manual Miniserver edit.
- User reports "URL changed and now nothing works."

**Phase to address:** Phase 19 (LXC provisioning — static IP); Phase 22 (cam detail page — copy-friendly URLs, doc snippet).

---

### Pitfall 17: Loxone-MJPEG endpoint is a *persistent* HTTP connection, not polling

**What goes wrong:**
Loxone consumes MJPEG via a persistent HTTP connection (multipart/x-mixed-replace), not by repeatedly fetching JPEGs. Implications:

- Each Loxone tile = one open TCP socket to the bridge for the duration the tile is visible.
- 10 tiles × 3 viewers (3 Loxone apps open) = 30 open sockets per bridge.
- go2rtc handles this fine, but ulimit on the LXC may need bumping (default LXC `nofile` ~ 1024 should be plenty, but worth verifying).
- If the bridge restarts, all 30 sockets break simultaneously; Loxone clients reconnect with their typical 1–5s backoff, all at once = mini-thundering-herd.

**How to avoid:**
1. Verify LXC `nofile` ulimit is ≥ 4096 in Phase 19 provisioning. Document in onboarding.
2. After a planned bridge restart (e.g., reconcile-driven), expect 1–5s blip on Loxone tiles. Mitigation: minimize bridge restarts — only restart when YAML actually changed (drift detection).
3. The Loxone Motion Shape Extreme blogpost recipe (640×360 @ 10fps) keeps per-stream bandwidth low (~50–100 kB/s per active tile), so 30 sockets ≈ 3 MB/s — well within the bridge LXC's 100Mbit network share.

**Warning signs:**
- Loxone tile shows "loading" repeatedly with brief frame glimpses.
- Bridge log shows hundreds of `Too many open files` errors.

**Phase to address:** Phase 19 (LXC ulimits); Phase 22 (Loxone-output toggle UX includes "tile may blip during config changes" note).

---

### Pitfall 18: Frigate codec-passthrough breaks on Protect's "smart codec" channels

**What goes wrong:**
For RTSP-passthrough to Frigate (`-c:v copy`, no transcode), the upstream stream must have:

- Standard H.264 (not H.264+, not H.265+, not "smart codec" variants — Frigate explicitly warns against these per [Frigate docs](https://docs.frigate.video/guides/configuring_go2rtc/)).
- Reasonable GOP size (≤ frame rate × 2).
- Proper SPS/PPS in keyframes.
- AUD (Access Unit Delimiter) NAL units — some Protect cameras omit these.

UniFi Protect cameras *generally* emit clean H.264, but:
- Some older firmwares had GOP issues.
- Some camera models have "Enhance Detail" or similar settings that produce non-standard B-frame patterns.
- Audio passthrough (`-c:a copy`) often fails with `pcm_mulaw`-style errors per the search; Frigate wants AAC.

**How to avoid:**
1. **Test passthrough against the user's actual Protect cams** in Phase 19 spike. Pull `ffprobe rtsp://bridge:8554/<cam>-high` and verify codec is `h264 (Constrained Baseline)` or `h264 (Main)`, GOP ≤ 60, AUD present.
2. **Provide a "passthrough vs re-encode" toggle** per camera in v1.3+, default to passthrough. If user reports Frigate issues, switch to lightweight re-encode (`-c:v libx264 -preset ultrafast -g 30`) — costs ~10% CPU per stream, no VAAPI needed since the load is low.
3. **Strip audio by default** for Frigate output (`-an`). Frigate doesn't need it; Protect's audio codec is often incompatible. User can opt-in if needed.
4. **Document Frigate-side config snippet** with `inputs:` block, `roles: [detect, record]` example, and warning about pcm_mulaw audio.

**Warning signs:**
- Frigate log: `Could not find tag for codec pcm_mulaw in stream`.
- Frigate log: `No frames have been received` despite go2rtc showing producers=1.
- Black/garbled video in Frigate UI but VLC plays the same stream cleanly.

**Phase to address:** Phase 19 (spike validates passthrough on user's UDM); Phase 20 (output template — `-an` default for Frigate); Phase 22 (cam detail page — passthrough-vs-reencode toggle).

---

## Minor Pitfalls

### Pitfall 19: Container-template reuse — bridge LXC is bigger than per-cam LXC

The existing per-cam LXC template (used for Mobotix/Loxone/Bambu) is sized for one stream: ~512 MB RAM, 1 core. The bridge serving N streams needs more: ~2–4 GB RAM, 2–4 cores depending on concurrent Loxone-MJPEG transcodes. **Don't blindly reuse the per-cam template** — extend it (or fork) with bridge-specific resource sizing.

**Phase to address:** Phase 19 (provisioning template — explicit bridge-LXC sizing parameters).

---

### Pitfall 20: SSH key — bridge management vs per-cam containers

The existing app uses a single SSH key to manage all per-cam containers. **Recommendation: reuse the same key for the bridge.** Don't introduce a new key — adds operational complexity for zero security benefit (both target the same Proxmox host, same trust boundary). Same encryption-at-rest (AES-256-GCM in SQLite) applies.

**Phase to address:** Phase 19 (SSH key reuse, not creation).

---

### Pitfall 21: Mixed visualization in `/cameras` UI — managed vs external indistinguishability

Per PROJECT.md, external (Protect-Hub) cams should appear inline in `/cameras` with a "Protect Hub" marker. Risk: marker too subtle → user confused about which cams are app-managed vs Protect-managed → user clicks "delete container" on an external cam expecting it to remove the LXC, but external cams have no LXC.

**How to avoid:**
1. Visual marker must be high-contrast: badge (e.g., `[Protect Hub]` colored differently) AND grouped section OR sort order that puts external cams together AND tooltip on hover explaining "this camera is in UniFi Protect; this app re-distributes it via the bridge."
2. **Action menu per-row is class-aware:** managed cams show "stop container", "view logs"; external cams show "toggle outputs", "view in Protect", and explicitly *no* "delete container" action (only "remove from hub").

**Phase to address:** Phase 22 (UI design — `/cameras` row component branches on camera class).

---

### Pitfall 22: Stream-Catalog UI showing channels the user can't actually use

Showing "High channel: 3840×2160 @ 30fps" on a low-end UDM that can't transcode that many streams in real-time is misleading — passthrough is fine but if user picks Loxone-MJPEG transcode at that resolution, VAAPI dies.

**How to avoid:** In the Stream-Catalog row, badge each channel with "Loxone-MJPEG: ✅ supported" / "Loxone-MJPEG: ⚠ high cost (recommend Low channel)" based on resolution. Don't hide options, but inform the user.

**Phase to address:** Phase 22 (Stream-Catalog UI — cost annotations).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use Protect `id` (not `mac`) as PK in `external_cameras` | Schema matches API directly, no normalization | Backup/restore wipes all hub state; rename loses toggles | **Never** — MAC-as-PK from day 1 |
| Hash YAML by raw bytes (not canonical form) | One-line implementation | Spurious "drift" loops, redeploys every reconcile | **Never** — canonical-hash from day 1 |
| Pull Protect creds at wizard step 1, cache forever | Simpler code | Token rotates → silent stream death within hours/days | **Never** — refresh per reconcile pass |
| Single global SSH lock for "anything bridge-related" | Avoids race conditions | Reconciler blocks user-toggle UX; deadlock risk | OK for v1.3 if accompanied by 30s timeout + dirty-flag retry |
| Reuse per-cam LXC template verbatim for bridge | Faster to ship | OOM / CPU starvation under load | **Never** — explicitly resize for bridge use case |
| Skip onboarding state-machine, treat wizard as "happy path only" | Saves 1 week | Every interrupted flow becomes a support ticket | **Never** — state machine is foundational |
| Bind go2rtc API to 0.0.0.0 (listen everywhere) | Default config works | YAML editor exposes admin to LAN; foreign writes possible | **Never** — bind to 127.0.0.1 inside LXC |
| Auto-enable Protect Share-Livestream on every cam by default | One-step user setup | Privacy footgun; offboarding leaves toggles on if cleanup fails | OK only with explicit per-cam opt-in + tracked `share_enabled_by_us` flag |
| Trust mDNS/hostname for bridge IP in Loxone URLs | "Cleaner" URL | Loxone caches; one DHCP rotation = all tiles dead | **Never** — static IP + IP-only URL |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `unifi-protect` lib WebSocket | Naive 1s reconnect on disconnect | Exponential backoff (5s → 5min); single-flight; full bootstrap re-fetch on reconnect |
| Protect Share-Livestream URL | Cache the URL in DB indefinitely | Re-fetch on every reconcile; treat token as ephemeral |
| Camera identity | Use `id` or `name` as PK | Use `mac` as PK; `id`/`name` denormalized |
| go2rtc YAML deployment | `PUT /api/streams` for runtime adds | YAML-as-source-of-truth; SSH write + restart only |
| go2rtc config | Default-bound API port (0.0.0.0:1984) | Bind to 127.0.0.1 inside LXC; firewall on host |
| go2rtc → Protect rtsps:// | Validate self-signed cert | Use `rtspx://` scheme or `tls_verify=0` |
| Frigate RTSP passthrough | `-c:a copy` audio | `-an` default; user opts in to audio if needed |
| VAAPI on bridge | Assume unlimited concurrent encoders | Cap at 4–6; surface utilization in UI |
| Loxone URL | Use mDNS hostname | Static IP; document IP-only URL format |
| Onboarding wizard | Treat as linear happy-path | State machine + idempotent resume |
| Self-update during reconcile | Hard SIGKILL | Graceful 30s drain; lock check before update |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N concurrent VAAPI encoders | Random ffmpeg failures, frozen tiles | Cap at 4–6, prefer Frigate-passthrough over Loxone-transcode | After 4–8 simultaneous transcodes (iGPU dependent) |
| Reconcile every 60s with full bootstrap fetch | Protect controller load, app CPU spike | Diff-based reconcile; full fetch only on WS-reconnect | At >50 cameras |
| Health-check polling go2rtc `/api/streams` every 5s | App CPU + container CPU constant | Poll every 30s; surface state changes via WS if available | Always — start at 30s |
| WebSocket reconnect storm during UDM reboot | Hundreds of failed handshakes per minute | Exponential backoff, single-flight | Every UDM reboot/firmware update |
| Large YAML hash on every reconcile | App CPU spike per pass | mtime fast-path before hashing | At >50 cameras |
| Loxone Miniserver opening N persistent MJPEG connections | LXC `nofile` exhaustion | Bump LXC ulimit to 4096; cap output count | At >100 concurrent tiles (well above home use) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing Protect admin creds in plaintext | LAN compromise → Protect admin | Reuse v1.0 AES-256-GCM credential store |
| Storing share-livestream tokens in plaintext YAML | Tokens are short-lived, but still grant stream access | Acceptable IF YAML is on bridge container only and bridge is LAN-only; document explicitly |
| Bridge endpoints unauthenticated by default | LAN clients can pull any cam | Document LAN trust boundary; opt-in basic auth in v1.4 |
| go2rtc web UI editor exposed | Foreign config writes; YAML clobber | Bind go2rtc API to 127.0.0.1 inside LXC |
| Auto-enabling Protect Share-Livestream silently | User doesn't know which cams are exposed via 7441 | Explicit per-cam opt-in; `share_enabled_by_us` flag for clean offboarding |
| Self-update during in-flight reconcile | Mid-deploy YAML corruption | Reconciler `busy` flag blocks self-update |
| Reuse per-cam SSH key for bridge | Single compromise = wider blast radius | Acceptable — same trust boundary (Proxmox host); document |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Marker for "Protect Hub" cams too subtle in `/cameras` | User accidentally treats external as managed; confusion | High-contrast badge + grouped section + class-aware action menu |
| Onboarding wizard with no resume support | Closing browser = restart from scratch | State-machine; resume at last completed step |
| "Hub disabled" toggle without consequences-list | User accidentally tears down working setup | Confirm dialog enumerates affected cams + downstream consumers |
| "Stream URL" copy button without explanation | User doesn't know how to use it | Inline doc snippet per target system (Loxone Motion Shape Extreme, Frigate cameras: block) |
| Toggle flapping during transitions | Multiple parallel onboardings, orphan containers | State-machine grays out toggle during transitions |
| Stream-Catalog showing all channels equally | User picks unsupportable Loxone-MJPEG at 4K | Cost annotations: "high cost — recommend Low channel" |
| Token rotation appears as "stream offline" | User blames hub, restarts hub, restart triggers more rotation | Dedicated "Protect controller restarted — N tokens refreshed" toast |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Reconciler** — Often missing canonical-form YAML hashing — verify "no-op reconcile" doesn't redeploy
- [ ] **Reconciler** — Often missing single-flight lock — verify two simultaneous triggers result in one (or sequential two) deploys, not two parallel
- [ ] **Reconciler** — Often missing full-bootstrap-on-WS-reconnect — verify behavior after simulated UDM reboot
- [ ] **Onboarding wizard** — Often missing resume-after-interruption — verify killing app process mid-step recovers cleanly
- [ ] **Offboarding** — Often missing partial-failure recovery — verify SSH-fail mid-cleanup leaves consistent state
- [ ] **Offboarding** — Often missing Protect-side share-toggle cleanup — verify only `share_enabled_by_us=true` cams are touched
- [ ] **External camera schema** — Often uses Protect `id` as PK — verify MAC-as-PK before any code is committed
- [ ] **Stream Catalog** — Often hard-codes Low/Medium/High — verify single-channel cams render correctly
- [ ] **Bridge LXC** — Often reuses per-cam template sizing — verify dedicated RAM/CPU for N concurrent transcodes
- [ ] **Bridge LXC** — Often missing static IP — verify Loxone tile survives a bridge restart (URL still valid)
- [ ] **go2rtc YAML** — Often binds API to 0.0.0.0 — verify `:1984/editor.html` is unreachable from LAN
- [ ] **go2rtc YAML** — Often missing `# managed by ip-cam-master` stamp — verify drift detection doesn't false-positive on first boot
- [ ] **Protect URL** — Often cached across reconciles — verify URL is re-extracted from bootstrap every pass
- [ ] **Frigate output template** — Often includes `-c:a copy` — verify default `-an` and audio is opt-in
- [ ] **Self-update endpoint** — Often missing reconcile-busy check — verify update during reconcile returns 409, not chaos
- [ ] **Settings toggle** — Often allows flapping — verify mid-transition clicks are blocked
- [ ] **Cam detail page** — Often missing copy buttons for URLs — verify each output URL has copy button + target-system snippet

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Protect token rotation broke streams | LOW | Trigger manual reconcile; URLs re-extracted; deploys within 60s |
| Camera identity drift after Protect restore | MEDIUM | If MAC-as-PK: zero-touch (auto-recovers); if `id`-as-PK: manual DB reconcile + user re-toggles outputs |
| WebSocket reconnect storm | LOW | Exponential backoff naturally settles; force-restart reconnect logic from admin endpoint if hung |
| YAML hash drift loop | MEDIUM | Stop reconciler; manually align YAML to expected canonical form; verify stamp; restart reconciler |
| Onboarding wizard interrupted | LOW (with state machine) / HIGH (without) | Resume at last completed step; or admin "force cleanup" + restart wizard |
| Offboarding orphan container | MEDIUM | Admin "force cleanup" action: stops + destroys container if exists, wipes hub DB state |
| VAAPI exhaustion | LOW | Reduce active Loxone outputs; switch some to Frigate-passthrough |
| Bridge IP changed (DHCP) | HIGH (manual Loxone reconfig) | Document static-IP requirement; if breached, user updates Loxone Config + Miniserver |
| go2rtc clobbered our YAML | MEDIUM | Detect via missing/foreign stamp; warn in dashboard; user clicks "force redeploy" |
| Self-update killed mid-deploy | LOW (with atomic write) | Existing YAML survives; reconciler reapplies on next pass |

---

## Phase-Specific Warnings (for Roadmap)

| Phase Topic | Likely Pitfalls | Mitigation |
|-------------|----------------|------------|
| Phase 19 — Schema + Bridge LXC provisioning | 2 (camera-id strategy), 7 (VAAPI sizing), 8 (TLS spike), 16 (static IP), 17 (ulimits), 19 (template sizing), 20 (SSH key reuse) | MAC as PK locked in schema; spike against user's actual UDM for rtspx:// + Protect channel inventory; bridge LXC template explicitly resized; static IP via DHCP reservation; ulimit nofile=4096 |
| Phase 20 — Stream Catalog + go2rtc YAML template | 4 (single-channel cams), 5 (foreign writes), 7 (VAAPI cost annotations), 8 (rtspx://), 11 (api bind 127.0.0.1), 18 (Frigate -an default) | Channels iterated from bootstrap (no hardcoded 3); idempotency stamp; cost-annotated capability matrix; rtspx:// in source URLs; api.listen=127.0.0.1; -an default for Frigate |
| Phase 21 — Reconciliation loop | 1 (token re-fetch), 3 (WS exp backoff), 5 (canonical hash), 6 (single-flight + dirty flag), 11 (mtime fast-path), 13 (busy flag for self-update), 14 (health sub-loop) | Re-fetch URLs every pass; exponential WS backoff; canonical-form hash with stamp check; single-flight lock + dirty retry; mtime fast-path; expose busy flag; separate health-check loop polling /api/streams |
| Phase 22 — UI + Lifecycle | 9 (wizard state machine), 10 (offboarding cleanup script), 12 (toggle flapping), 13 (graceful shutdown), 15 (security docs), 16 (URL copy buttons), 21 (class-aware UI), 22 (stream-catalog cost) | hub_onboarding_state table; cleanup-script with idempotent steps; state machine for hub_state; SIGTERM grace period; LAN-trust-boundary docs in wizard final step + README; copy buttons + per-target snippets; class-aware row component; cost-annotated channel UI |
| Phase 23+ (future) | Optional auth on bridge endpoints; Loxone-side URL auto-update; multi-bridge scaling | Defer; v1.3 documents the LAN trust boundary explicitly |

---

## Sources

**HIGH confidence (multiple independent reports):**
- [openHAB #20072 — Share Livestream URL changes on every restart](https://github.com/openhab/openhab-addons/issues/20072) — confirms token rotation behavior
- [hjdhjd/unifi-protect — Library README and API docs](https://github.com/hjdhjd/unifi-protect) — WebSocket reconnect, bootstrap structure
- [hjdhjd/unifi-protect/docs/ProtectApi.md — bootstrap modelKeys](https://github.com/hjdhjd/unifi-protect/blob/main/docs/ProtectApi.md) — `add`/`update`/`remove` action semantics
- [hjdhjd/homebridge-unifi-protect #701 — Protect controller WS bugs](https://github.com/hjdhjd/homebridge-unifi-protect/issues/701) — disconnect storms during firmware
- [community.ui.com — How does RTSP work on Protect](https://community.ui.com/questions/How-does-RTSP-work-on-Protect/448bd517-7991-4d45-982c-33eff0d22184) — channel availability variance
- [UI Help — Migrating Cameras Between NVRs](https://help.ui.com/hc/en-us/articles/19118654419607-Migrating-Cameras-Between-NVRs) — MAC-keyed video storage confirms MAC stability
- [Frigate docs — Configuring go2rtc](https://docs.frigate.video/guides/configuring_go2rtc/) — codec recommendations, B-frame/GOP guidance
- [Frigate docs — Live View](https://docs.frigate.video/configuration/live/) — H.264 + GOP requirements
- [AlexxIT/go2rtc Configuration wiki](https://github.com/AlexxIT/go2rtc/wiki/Configuration) — config format, runtime API behavior
- [AlexxIT/go2rtc/wiki/Hardware-acceleration](https://github.com/AlexxIT/go2rtc/wiki/Hardware-acceleration) — VAAPI config patterns
- [AlexxIT/go2rtc #1855 — WebRTC port collision panic](https://github.com/AlexxIT/go2rtc/issues/1855) — port-binding edge case
- [AlexxIT/go2rtc #762 — Doesn't recover from camera disconnect without restart](https://github.com/AlexxIT/go2rtc/issues/762) — reconnect logic gaps
- [AlexxIT/go2rtc #258 — Reconnection stops after some retries](https://github.com/AlexxIT/go2rtc/issues/258) — same family of bugs
- [AlexxIT/go2rtc #252 — VAAPI hwaccel breaks with multiple GPUs](https://github.com/AlexxIT/go2rtc/issues/252) — VAAPI device-selection quirks
- [Florian Rhomberg — Third-party camera into Protect](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) — proven Loxone 640×360@10fps recipe

**MEDIUM confidence (single source or community consensus):**
- [community.ui.com — Access UniFi Protect camera RTSP stream](https://community.ui.com/questions/Access-UniFi-Protect-camera-RTSP-stream/b1ba4c62-0764-4223-80d0-650768b0f87f) — Low/Medium/High channel toggle UI
- [Channels DVR community — RTSP issues from Protect](https://community.getchannels.com/t/rtsp-streaming-issue-from-unifi-protect/32701) — codec quirks from Protect output
- [Lukas Klein — Using your Unifi cameras in Loxone](https://medium.com/@lukas.klein/using-your-unifi-cameras-in-loxone-a777a17c139c) — Loxone-side integration patterns
- [community.ui.com — Integrating cameras with Loxone via JPG](https://community.ui.com/questions/Integrating-cameras-with-Loxone-via-JPG-stream/306b851b-3ffe-490d-836c-9320220cd5a3) — MJPEG vs single-JPG patterns
- [bananamafia.dev — Cloudless UniFi setup](https://bananamafia.dev/post/unifi/) — long-running daemon WS patterns
- [home-assistant/core #133241 — Fingerprint reader event triggers on reboot](https://github.com/home-assistant/core/issues/133241) — example of UDM reboot WS event class

**Inherited / reused (LOW marginal cost — already validated in v1.0–v1.2):**
- AES-256-GCM credential pattern (v1.0 Phase 1)
- LXC `/dev/dri` passthrough (v1.0 Phase 5)
- SSH-based deployment to LXCs (v1.0 Phase 2; v1.2 Phase 11)
- self-update via systemd-run (v1.1 Phase 9)
- existing PITFALLS.md from v1.2 — TLS-self-signed-cert handling, MQTT-style exponential backoff

---

*Pitfalls research for: v1.3 Protect Stream Hub (Loxone + Frigate-ready)*
*Researched: 2026-04-30*
