# Feature Research — v1.3 Protect Stream Hub

**Domain:** Self-hosted "stream re-distribution" bridge — surfaces UniFi Protect cameras outward as Loxone-friendly MJPEG and Frigate-friendly RTSP streams, hosted by a single shared go2rtc bridge LXC. Adds a "Hub" feature on top of an already-shipped per-camera-LXC product.
**Researched:** 2026-04-30
**Confidence:** MEDIUM-HIGH (UniFi Protect API surface for `isRtspEnabled` / `rtspAlias` is HIGH from official `unifi-protect` lib source; Loxone Motion Shape Extreme specifics flagged as MEDIUM and need verification against an actual Loxone install; Scrypted UX patterns are MEDIUM, Frigate UX patterns are HIGH from public docs)

---

## Scope Reminder (read first)

This file scopes **only** features that are *new* in v1.3. Existing capabilities listed below are intentionally **out of scope** here and must not be re-tabled:

- Camera discovery (Mobotix / Loxone / Bambu) and onboarding wizards
- Per-camera LXC provisioning
- App-managed go2rtc deployment via SSH
- Read-only Protect status monitoring (existing)
- Self-update / backup / log viewer / host vitals
- Bambu A1 ingestion pipeline

The new dimension is **reverse direction**: cameras that live in Protect, re-served outward via one shared LXC, surfaced inline in `/cameras` via a Settings toggle.

---

## Feature Landscape

### 1. Stream Catalog UX — Per-Cam Inventory

For each Protect camera, show every native quality channel with technical metadata, plus the Hub's re-served outputs.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **List all Protect channels (Low / Medium / High) per cam** | Users coming from Frigate/Scrypted expect to see every available quality and pick the right one for the right consumer. Frigate's go2rtc setup, Scrypted's "Rebroadcast Plugin" auto-quality picker, and Home Assistant's UniFi Protect integration *all* surface multiple channels per camera. Hiding them = product feels broken. | LOW | UniFi Protect API exposes `channels[]` per camera with `isRtspEnabled`, `rtspAlias`, `width`, `height`, `fps`, `bitrate`, `videoCodec`, `name` ("High"/"Medium"/"Low"). Verified against `unifi-protect` lib source ([hjdhjd/unifi-protect/src/protect-api.ts](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts)). Pull at discovery and on every reconciliation tick. |
| **Codec, resolution, framerate per channel** | These are the *first* questions a Loxone or Frigate user asks ("does this fit my use case?"). Frigate's docs are explicit: "main_stream for recording, sub_stream for detect" — picking requires seeing all metadata side by side. | LOW | Already in the Protect channel JSON; the work is just rendering. Bitrate as kbps. |
| **Native Protect RTSP URL per channel (when enabled)** | Power users want to copy-paste into VLC for a sanity check before they trust the bridge. Florian Rhomberg's blog and every `unifi-protect` tutorial show this URL pattern. | LOW | URL = `rtsps://<protect-host>:7441/<rtspAlias>` (UDM-Pro/UDM-SE) or `rtsp://<host>:7447/<rtspAlias>` (older). Show only when `channel.isRtspEnabled === true`. Mask with `•••` until the user clicks "show URL" — same pattern v1.x already uses for camera credentials. |
| **"Stream sharing not enabled in Protect" inline state per channel** | Without this, the user has no idea why their RTSP URL is empty. UniFi Protect's own UI says "RTSP" + toggle per channel — must mirror that mental model. | LOW | If `isRtspEnabled === false`, show "Disabled in Protect" with a CTA: "Enable via API" (if scope allows) or "Open in Protect → Camera → Settings → RTSP". |
| **Per-cam visual marker "Protect Hub" in `/cameras` list** | Already locked as a v1.3 design decision (PROJECT.md). Required for the user to distinguish app-managed vs Hub-managed cams at a glance. | LOW | Badge component, reuse existing `<Badge>` style. Color: differentiate from Bambu A1 / Mobotix / Loxone markers. |
| **Live status per active output** | If the bridge container is down or the source channel went offline, the user must see it without SSH'ing into the LXC. Industry standard — Frigate, Shinobi, MotionEye all show per-stream "running/error" state. | MEDIUM | Poll go2rtc `:1984/api/streams` every N seconds; map by stream slug. Surface `producers[].state` or "no stream" empty array as red/yellow. |
| **Copy-button per Hub URL** | Mandatory for any URL shown in a homelab tool. Loxone Config / Frigate YAML are *copy-paste* environments. If the user has to triple-click, the tool feels low-quality. | LOW | One-liner with `navigator.clipboard.writeText`; reuse existing pattern. |

**Justification — table stakes BECAUSE:** Every reference tool in this category (Frigate, Scrypted, MediaMTX dashboards, Shinobi) exposes channel metadata up-front. Loxone/Frigate users *won't* trust a bridge they can't introspect — they want to see exactly what they're consuming before they paste a URL into their config.

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Side-by-side native vs Hub-output preview** (codec, resolution, fps shown on the same row so the transcode delta is obvious) | Makes "why does Loxone look pixel-y?" debuggable in 1 second. Scrypted does this implicitly via the rebroadcast UI; Frigate does not. | LOW | **YES** — almost free once both data sources are loaded; high "feels professional" payoff. |
| **In-app MJPEG snapshot preview** of the final Hub output | Confirms the bridge actually produces video before the user wires up Loxone. Frigate has live preview, Scrypted has snapshot fallback. Reduces "did I configure this right?" friction by ~80% (inference). | LOW-MEDIUM | **YES** — go2rtc already exposes `frame.jpeg?src=<slug>` natively, just an `<img>` with periodic refresh. No transcode work in our app. |
| **In-app live MJPEG video preview** (continuous, not snapshot) | Even better confirmation. But: holds a stream open per UI tab, costs CPU, and a snapshot already answers the "is it working?" question. | MEDIUM | **NO for v1.3** — adds load on the bridge VM proportional to open browser tabs. Snapshot covers 95% of the value. Defer to v1.4. |
| **"Recommended profile" hints per output type** (e.g., "Loxone Motion Shape Extreme → Low channel @ 640×360 / 10fps MJPEG") | Self-hosters are *constantly* unsure which channel to pick. Scrypted's auto-defaults are hugely valued in the community. | LOW | **YES** — pure metadata: render a small "✓ Recommended for Loxone" sticker on the Low channel when Loxone output is enabled. |
| **Bandwidth estimate per active output** (sum of bitrates × active outputs) | Helps the user understand the load on their VM/Proxmox host before flipping toggles. | LOW-MEDIUM | **NO for v1.3** — nice-to-have, low payoff, easy to add in v1.4 once we have real telemetry from the bridge container. |
| **Channel comparison table view** (all cams × all channels in one grid) | Useful if you have 10+ Protect cams. Below 5 cams (the realistic homelab case) the per-cam page is enough. | MEDIUM | **NO for v1.3** — over-engineering for the typical user (2–6 Protect cams). |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Show all 7 possible Home Assistant-style "RTSP/RTSPS × channel" combinations** | HA's Protect integration creates up to 7 entities per cam (low/med/high × RTSP/RTSPS + WebRTC). | The HA model is for HA's *internal* entity registry; users find it confusing in raw form. We have 3 channels × ~2 transports max — collapse to 3 rows. | Show one row per **channel**, with a transport pill ("RTSPS" / "RTSP"). No combinatoric explosion. |
| **Allow editing channel bitrate/resolution from our UI** | "While I'm here, let me tune Protect." | Cross-cuts Protect's own settings; partial implementation guarantees drift bugs. v1.3 is **read-only** for Protect-side channel config. | Deep-link to Protect web UI: `https://<protect>/protect/devices/<id>` opens directly to the cam settings page. |
| **Show every codec / pixfmt / GOP detail** | Power users like data. | Visual noise crowds out the things 95% of users actually care about (resolution, fps, codec). | Collapse advanced details behind a "Show technical info" twirl-down. |

---

### 2. Output-Types-Per-Camera UX

Each cam can have N "outputs" (Loxone-MJPEG, Frigate-RTSP-passthrough, ...) toggled independently. v1.3 ships **two** output types; the model must extend to more later (locked decision).

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Per-cam, per-output toggle on the cam detail page** | Locked decision in PROJECT.md ("Toggles pro Output-Typ"). Industry standard: Scrypted's "extensions" / Home Assistant's "disabled by default" toggles. | LOW | Bool flag in DB (`hub_outputs` table: `cam_id`, `output_type`, `enabled`). Toggle triggers reconciliation → go2rtc.yaml regen → `pct exec` reload. |
| **One go2rtc.yaml stream entry per (cam × active output)** | The single bridge container holds all streams in one config — locked architectural decision. | LOW-MEDIUM | Slug pattern: `<cam-slug>-low-mjpeg`, `<cam-slug>-high-rtsp`. Reuse existing v1.x YAML-generation module pattern (the per-cam-LXC writer already does this). |
| **Output recipe template per type** (transcode params, source channel, target codec) | Each output type has fixed semantics — Loxone-MJPEG = "transcode Low channel to 640×360 @ 10fps MJPEG", Frigate-RTSP = "passthrough High channel as h264 copy". The template encapsulates that. | LOW | TypeScript const map: `OUTPUT_TYPES = { 'loxone-mjpeg': { sourceChannel: 'low', codec: 'mjpeg', size: '640x360', fps: 10, transcode: true, vaapi: true }, 'frigate-rtsp': { sourceChannel: 'high', codec: 'copy', transcode: false } }`. New types = new entries; no architecture work. |
| **Default-source-channel auto-pick per output type** | Loxone-MJPEG should default to Low channel (Florian Rhomberg's blog confirms). Frigate-RTSP should default to High (per [Frigate go2rtc docs](https://docs.frigate.video/guides/configuring_go2rtc/)). User can override but shouldn't have to think about it. | LOW | Already in the recipe template; UI shows it as a pre-selected dropdown the user can change. |
| **Source-channel dropdown per output** (override the default) | Users with weird cameras (e.g., G5 Bullet with non-standard channel ratings) will need this. | LOW | Dropdown of `channels[]` filtered to channels that match the output's codec requirements (e.g., for `frigate-rtsp` with `transcode: false`, only h264 channels are selectable). |
| **One-tap "disable all Hub outputs for this cam"** | Standard "decommission this cam from Hub" without disabling the whole feature. | LOW | Button on cam detail page → mass-update toggles → reconcile. |

**Justification — table stakes BECAUSE:** Single per-cam toggle is too coarse (user wants Frigate-RTSP but not Loxone-MJPEG for Cam A); single per-output-type toggle is too coarse (user wants Loxone for Cam A but not Cam B). The *matrix* is the natural model. Every comparable tool that supports multiple consumer profiles uses this exact pattern (Scrypted's per-cam plugin enable, Home Assistant's per-entity disable).

#### UX Pattern Decision: Per-Cam Page With Output Toggles ✓

**Three patterns considered:**

| Pattern | Where toggles live | Pros | Cons | Verdict |
|---------|-------------------|------|------|---------|
| **Per-cam page (chosen)** | Cam detail page → Outputs section → toggles | Mirrors mental model "this cam's outputs"; fits existing `/cameras/[slug]` page structure | Hard to see "all cams using Loxone" at once | **YES** — best fit for current `/cameras` UX, low effort |
| **Per-output-type page** | `/hub/outputs/loxone` lists which cams produce Loxone-MJPEG | Good for "give me the URL list to paste into Loxone Config" | Adds new top-level pages, drifts from "cams are the unit of work" mental model | **NO for v1.3** — but borrow the *idea*: add a flat "All Hub URLs" copy-list page (see differentiator below) |
| **Profile system** ("Loxone Profile" applied to N cams, mapped to channel X) | Profiles editable centrally, applied to cam sets | Most flexible | Over-engineered for 2 output types; users have to learn a new abstraction | **NO** — defer until we have ≥5 output types |

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Flat "All Hub URLs" copy-list page** (one row per active output, with cam-name + URL + copy button, grouped by output type) | Loxone setup = pasting N URLs into N camera blocks in Loxone Config. A single page that lists them all is the killer UX. Borrowed from Scrypted's "Rebroadcast → Streams" view. | LOW | **YES** — pure read-only render of existing data, ~1h effort, massive perceived polish. |
| **Bulk-toggle output type across all cams** ("Enable Loxone-MJPEG for all 4 Protect cams") | Common path: user just got a Loxone, wants every Hub cam ready at once. | LOW | **YES** — checkbox column in the cam list with a header bulk-action. |
| **Per-output health badge** (green/yellow/red derived from go2rtc producer state) | Same as Stream Catalog table-stake item, reused here. | LOW | **YES** — same data, displayed in the toggle row. |
| **Custom output-name override** (e.g., "doorbell-low-mjpeg" instead of auto-generated `intercom-low-mjpeg`) | Users will rename Protect cams; if our slug doesn't track, their Loxone config breaks silently. | MEDIUM | **NO for v1.3** — the *better* fix is stable cam-IDs (see §5). Manual override = config drift. |
| **Per-output rate-limit / max-clients setting** | Prevents Loxone reconnect storms from saturating the bridge container. | MEDIUM-HIGH | **NO for v1.3** — go2rtc already handles concurrent clients fine for the homelab scale (~5 cams × ~3 consumers). Premature. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **"Custom ffmpeg pipeline" UI per output** | Power users want it. | Becomes a vector for footguns and support nightmares (people pasting random ffmpeg commands and reporting "it doesn't work"). | Output recipes are code-defined. New target = new recipe in code (PR-able for community contributions). |
| **Drag-and-drop output reordering** | Looks fancy. | Order doesn't matter functionally — go2rtc.yaml is keyed by slug. Pure UI vanity. | Sort by cam name or output type label. |
| **Per-output authentication** (HTTP basic / RTSP user) | "I want to lock down access." | The bridge runs on a LAN-trusted LXC behind LAN firewalls; adding auth complicates Loxone config (Loxone's MJPEG support has auth quirks). | Document "this is LAN-only; do not port-forward port 8554/1984". Same threat-model stance as Bambu integration. |

---

### 3. Auto-Reconciliation Behavior

When the Protect-side state changes (cam added/removed, channels rotated, name changed), what should the Hub do automatically vs. ask the user?

#### Industry Patterns Observed

| Pattern | Example tool | What it does |
|---------|--------------|--------------|
| **Silent sync** | go2rtc native streams | Just re-reads config and adapts. No history kept. |
| **Sync with notification** | Home Assistant `unifiprotect` integration | Auto-discovers new devices, fires a persistent notification "New device found: X. [Configure]" |
| **Sync but soft-delete on the Hub side** | Scrypted plugin model | Removed source devices show as "disconnected" in Scrypted; user manually purges. |
| **Dry-run then confirm** | Frigate's manual `cameras:` config | Nothing happens until the user edits YAML. |

#### Recommendation for v1.3 (single-user self-hosted): **Hybrid — Silent for additions, soft-delete for removals, notify for renames**

This matches the user's mental model from the existing v1.x app (the LXC provisioner has similar reconcile semantics for Mobotix/Loxone) and avoids "where did my cam go?" panic.

#### Table Stakes

| Reconciliation Event | Default Behavior | User Notification | Complexity | Justification |
|----------------------|------------------|-------------------|------------|---------------|
| **New cam appears in Protect** | Auto-add to DB as `external` cam, `hub_active=false`, no outputs enabled. Surface in `/cameras` with a "New — configure outputs" CTA. | Inline badge on cam row + dashboard count "1 new Protect cam". No popup. | LOW | Table stakes BECAUSE: HA's `unifiprotect` integration does exactly this (auto-discover, surface as disabled-by-default entity); silent auto-creation feels invasive, but doing nothing means the user manually clicks "rescan". The middle path = auto-show, but require explicit toggle to activate outputs. |
| **Cam removed from Protect** | Mark as `soft_deleted=true` in DB, **stop and remove the corresponding go2rtc.yaml entries** (so the bridge doesn't try to pull a dead source), keep the row in `/cameras` with a "Source removed in Protect" badge for 7 days. | Inline badge; cam doesn't disappear silently. | MEDIUM | Table stakes BECAUSE: silent disappearance breaks Loxone config (URL stops responding without explanation). Soft-delete + grace window matches the user's request ("DB-Cleanup mit klarem Hinweis was passiert"). 7 days is convention from many tools (HomeBridge ignored-devices tombstone, Scrypted "trash"). |
| **Cam renamed in Protect** | Keep the existing slug stable (don't rotate URL), update the *display name* only. Show a "Renamed in Protect: Old → New" notice for 24h. | Inline notice. | MEDIUM | Table stakes BECAUSE: rotating URLs on rename = silent breakage in Loxone Config / Frigate config files. URL stability beats name accuracy. (See §5 — URL Hygiene.) |
| **Channel set rotated** (e.g., user disabled Medium channel in Protect) | Auto-update the catalog. If a Hub output was using that channel, mark it as `degraded` and switch to the closest available channel as fallback. | Inline notice on the cam: "Medium channel disabled in Protect — Loxone-MJPEG fell back to Low." | MEDIUM | Table stakes BECAUSE: `isRtspEnabled` per-channel is a user-controllable Protect setting. They *will* toggle it. Silent breakage = nightmare. |
| **`isRtspEnabled` toggled off for a channel currently used by Hub** | Stop the affected output, mark it `error: source RTSP disabled in Protect`, leave toggle ON (so it auto-recovers when re-enabled). | Inline error per output. | LOW | Table stakes BECAUSE: directly maps to the Protect API state — we already poll `channels[].isRtspEnabled`. |
| **Token / `rtspAlias` rotated** (Protect occasionally re-issues the alias) | Detect via diff, silently update the bridge's go2rtc.yaml source URL, log the event. | Background event; no popup unless it fails. | LOW-MEDIUM | Table stakes BECAUSE: the bridge URLs we expose are *our* slugs (`<cam-slug>-low-mjpeg`), not Protect's `rtspAlias`. The alias change is internal; users shouldn't ever see it. |
| **Reconciliation interval** | Every 60s, plus on-demand via Settings → "Sync now" button | n/a | LOW | Table stakes BECAUSE: matches the existing app's polling cadence (Protect status polling = 30s cache, Bambu MQTT watch = continuous). 60s is the right band. |
| **"Last sync" timestamp + result on the Hub status page** | Always visible. | n/a | LOW | Table stakes BECAUSE: when something feels "stuck", the first thing a power user looks at is "when did this last run?". Same pattern as v1.1 update-check timestamp. |

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Reconciliation event log** (rolling list of last 50 events: "added cam X", "renamed Y", "removed Z") | Postmortem for "wait, when did that disappear?" debugging. | LOW | **YES** — reuse existing event-log table from v1.x; one new event-type set. |
| **Dry-run mode** ("show me what reconcile would do without applying") | Useful for paranoid users. | MEDIUM | **NO for v1.3** — anti-pattern for a single-user self-hosted tool; the right answer is good rollback (which we have via the soft-delete grace window). |
| **Drift detection between desired (DB) and actual (go2rtc.yaml on container)** | Catches the case where someone SSH'd into the bridge and edited the YAML by hand. | MEDIUM | **YES** — small win, low cost: hash the rendered YAML, compare to the deployed file's hash. Surface as a single "Hub config in sync ✓ / ⚠ drift detected" indicator on the status page. The user-facing "fix it" button = re-deploy. |
| **Webhook on reconcile event** | Trigger n8n / HA flows. | LOW | **NO for v1.3** — premature. v1.4+ if requested. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Auto-enable Hub outputs on new Protect cams** | "Why do I have to click? It saw the cam." | Silent state changes that affect the *outside world* (Loxone polling new URL, Frigate seeing new RTSP) violate user agency. | Auto-discover, then leave outputs OFF until user clicks. Same as HA's "disabled by default" pattern. |
| **Hard-delete on Protect-side removal** | Cleanest DB. | If the user accidentally unadopted a cam in Protect (or it's a transient API hiccup), we just lost their toggle state. | Soft-delete with grace window. |

---

### 4. Lifecycle UX

Treated as **first-class** per the quality gate. Three lifecycle phases.

#### 4a. Onboarding Wizard

**Industry pattern survey (verified):**
- **Home Assistant config flow:** discovery → user selects → form (creds if needed) → confirm → creates `config_entry` + entity registry rows; "discovery never auto-finishes a flow" is an explicit HA design principle ([HA developer docs](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/)).
- **UniFi Protect's own "Adopt new camera" flow:** detect → preview frame → name → confirm → save.
- **Frigate's first-camera flow:** edit YAML, save, reload — *not* wizard-driven (a known UX gap they're working on).
- **Unraid app install:** template form → install → "container is starting…" → done; the container's data directory persists across removes ([Unraid docs](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/)).

#### Table Stakes

| Step | What Happens | Complexity | Notes |
|------|--------------|------------|-------|
| **Step 0: Settings toggle "Enable Protect Stream Hub"** | Activates the wizard the first time. After that, the toggle gates the whole feature. | LOW | Locked decision. Reuses existing settings UI pattern from v1.1 (boolean toggle with description). |
| **Step 1: Reuse or configure Protect connection** | If the existing v1.x Protect connection is healthy, default to "reuse" (one-click); otherwise show creds form. | LOW | The app already has a Protect connection (Phase 4 monitoring). Detect its health, skip the form in 95% of cases. |
| **Step 2: Provision (or reuse) bridge LXC on Proxmox** | Auto-detect a Proxmox host from existing v1.x config; default storage; pick next free VMID. Show a single "Create bridge container" button with a live progress log (reuse the existing onboarding stream-log component). | MEDIUM | Reuses existing `provisionLxc` module. Differences: this LXC needs `/dev/dri` passthrough (VAAPI for transcoding) — which the existing template already supports. |
| **Step 3: Discovery preview** | Auto-call Protect API, render a list of all cams with thumbnails + native channels. User sees what's available. | LOW-MEDIUM | One Protect API call; thumbnail = `frame.jpeg` from existing channels (some Protect models support snapshot endpoint, fall back to a placeholder). |
| **Step 4: Cam selection + default output type per cam** | Checkbox per cam, dropdown "Loxone-MJPEG / Frigate-RTSP / both / none". Defaults: none. | LOW | Just form state. "Select all" + "Loxone for all" + "Frigate for all" bulk actions. |
| **Step 5: Initial sync** | Reconciliation runs once: write go2rtc.yaml on bridge, restart go2rtc, poll until streams are healthy. Show per-stream progress. | MEDIUM | Reuses reconciliation engine + go2rtc health probe (`/api/streams`). |
| **Step 6: Done — show "Where to go next"** | "Cams are now in /cameras. Hub URLs available on each cam page. Need to configure Loxone? See [link]." | LOW | Pure copy. Link to a per-target documentation page (Loxone setup, Frigate setup). |
| **Skippable / resumable** | If wizard is interrupted, settings toggle stays OFF; partial state cleaned up. Re-running enters where it left off. | MEDIUM | Standard wizard state machine; reuse existing onboarding-wizard pattern. |
| **"Cancel" at any step doesn't leave residue** | If user bails at step 3 (after LXC provision), confirm dialog: "Bridge container 'cam-bridge' was created. Keep it for later, or remove?" | MEDIUM | Same pattern as offboarding — see §4c. |

**Justification — table stakes BECAUSE:** This *is* the user's first contact with the Hub. Every flagship self-hosted tool with discoverable integrations follows this exact arc (HA config flow, UniFi adoption, Scrypted plugin install). Skipping any step = "does this thing actually work?" anxiety. The 6-step structure is locked in PROJECT.md (`(1)…(6)`) — this just refines what each step contains.

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Live thumbnail per cam in step 3** (instead of just metadata) | Massive "feels real" payoff. Users *love* seeing their actual video confirm the connection. | MEDIUM | **YES** — Protect API exposes snapshot endpoints; one fetch per cam; cache. |
| **"Skip wizard, advanced setup" link to a single-page form** | For repeat installs / power users. | LOW | **NO for v1.3** — premature for a feature that ships on ~50 homelabs. Add if requested. |
| **Pre-flight check before LXC creation** ("Proxmox storage has 8 GB free, GPU passthrough OK") | Same pattern as v1.1 update preflight. Catches problems before the user waits 90s for a failed provision. | MEDIUM | **YES** — reuse the existing pre-flight UI component shape; check disk, GPU passthrough device, network reachability of Protect host. Aligns with existing app DNA. |
| **Recap step before activation** (Step 5.5: "About to enable 4 cams × 2 outputs = 8 streams. Estimated bandwidth ~12 Mbps. Continue?") | Sets expectations, avoids "why is my CPU pegged?" surprise. | LOW | **YES** — pure render of selected toggles, no new logic. |

#### Anti-Features (Onboarding)

| Anti-Feature | Why Problematic | Alternative |
|--------------|-----------------|-------------|
| **Auto-enable Hub on toggle without a wizard** | First contact = no context = bad surprises ("why are these cams in my list?"). | Always run the wizard the first time. After that, the toggle behaves immediately. |
| **Force-creating a new bridge LXC even if one exists** | Wasteful. | Detect existing Hub-LXC by metadata tag in Proxmox (or by VMID stored in DB) and offer "reuse" path. |

---

#### 4b. Operations (Steady-State)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Hub status page** (`/hub` or as a card on existing dashboard) showing: bridge container health, last reconcile timestamp, # active streams, # active outputs, drift indicator | Self-hosters live and breathe status pages. Comparable to v1.1's host-vitals dashboard. | LOW-MEDIUM | One server-rendered page; data sources already exist (proxmox-api for container, go2rtc API for streams). |
| **"Sync now" button** | When auto-reconciliation feels stuck, the manual override is non-negotiable. Every reconcile-loop tool ships this. | LOW | POST endpoint that triggers reconciliation. Idempotent. |
| **Pause Hub** (stop reconciling, leave deployed config running) | For maintenance windows in Protect (e.g., user is reconfiguring channels and doesn't want our drift detection screaming). | LOW | `hub_paused` boolean in settings. Reconciler checks before running. |
| **Restart bridge container button** | Goes through `pct stop && pct start`. Standard rescue action. | LOW | Reuse existing per-LXC restart action from v1.x. |
| **Log viewer for the bridge container** | The `/logs` page in v1.1 already shows journal logs. Extend to allow filtering by container = bridge. | LOW-MEDIUM | Existing component, new SSH target. |

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Per-stream metrics card** (uptime, fps, dropped frames from go2rtc producer state) | go2rtc's `/api/streams` endpoint exposes this. Lots of polish for low effort. | LOW | **YES** — render in the cam detail page as a small KPI strip per active output. |
| **VAAPI utilization display** | Confirms HW accel is actually engaged. | MEDIUM | **NO for v1.3** — needs `intel_gpu_top` or sysfs scraping inside the LXC; premature optimization. |
| **Rate-limit dashboard** (clients per stream) | go2rtc exposes consumer connections. | LOW | **YES — but small** — single line per stream "n consumers". Defer richer dashboards. |

---

#### 4c. Offboarding

The hardest UX in the milestone. Quality gate explicitly flags this. Patterns observed:

| Pattern | Tool | Behavior |
|---------|------|----------|
| **Reversible** | Unraid app remove | Container deleted, appdata persists for re-install |
| **Tombstone** | HA integration uninstall | Config entry removed; entities marked unavailable; user manually cleans |
| **Cascading purge w/ confirm** | UniFi Protect "Unadopt camera" | "This will remove footage and config. Confirm with camera name." |

#### Recommendation: **Tiered offboarding with explicit consequence preview** (closest to Unraid + UniFi hybrid)

#### Table Stakes

| Step | Behavior | Complexity | Justification |
|------|----------|------------|---------------|
| **Trigger: Settings toggle "Enable Protect Stream Hub" → OFF** | Opens a confirmation dialog (no immediate action). | LOW | Table stakes BECAUSE: a toggle that destroys infrastructure on click violates user agency. UniFi's "are you sure" pattern is the right precedent. |
| **Consequence preview list** in the dialog | "This will:<br>• Disable 4 Hub cams from `/cameras`<br>• Stop 8 streams currently being consumed (Loxone configs at these URLs will fail: …)<br>• Optionally: stop and delete the bridge container `cam-bridge`<br>• Optionally: disable RTSP Sharing in Protect for these channels<br>• Mark 4 external cams as soft-deleted (recoverable for 7 days)" | MEDIUM | Table stakes BECAUSE: this is the most consequential action in the app. Users *must* see the blast radius before clicking. |
| **Tiered options inside the dialog (radio buttons)** | **(a) Pause only** — keeps everything deployed, just stops reconciling. Reversible by re-enabling toggle.<br>**(b) Disable + keep bridge container** — stop streams, keep LXC for fast re-enable.<br>**(c) Full uninstall** — stop streams, delete bridge LXC, soft-delete DB rows.<br>Default: (b). | MEDIUM | Table stakes BECAUSE: "all or nothing" is wrong; the three real exit paths are "I'll come back tomorrow", "I'm done for now", and "I'm fully gone". Mirroring Unraid + UniFi mental models. |
| **Optional sub-toggle: "Also disable RTSP Sharing in Protect for these channels"** (default: OFF) | If checked, after stopping streams, call Protect API to set `isRtspEnabled=false` on every channel we previously enabled. | LOW-MEDIUM | Table stakes BECAUSE: leaves Protect in the state we found it. But default-OFF because some users *want* RTSP to stay available for non-Hub uses. See §6. |
| **Type-to-confirm for option (c) Full uninstall** | "Type DELETE to confirm." | LOW | Table stakes BECAUSE: hard-deletes a Proxmox container; deserves the friction. Same pattern as `git push --force-with-lease` and UniFi unadopt. |
| **Re-enable path after offboarding** | If bridge container exists (option b), re-enabling skips Step 2 of onboarding (no provision) and starts at Step 3 (discovery). | MEDIUM | Locked decision: "Re-Enable nach Offboarding: schneller Re-Onboarding-Pfad". |
| **What stays after option (b)** | DB rows for Hub cams (with `hub_active=false`), bridge LXC (stopped), encrypted Protect creds. | LOW | Standard reversibility. |
| **What stays after option (c)** | Encrypted Protect creds (still useful for the existing v1.x Protect monitoring). Nothing else. | LOW | Clean slate but doesn't break the parent feature. |

**Justification — Lifecycle UX as first class BECAUSE:** This is precisely the surface that turns power users into advocates or detractors. UniFi Protect itself blew this for years (unadopting a cam was opaque); HA does it well (config flow uninstall is documented). v1.3 must clear that bar.

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **"Export Hub config before uninstall" button** | One-click YAML/JSON dump for backup before destructive actions. | LOW | **YES** — lifts straight off the existing v1.1 backup component pattern. Tiny, big trust payoff. |
| **Show recently consumed-by clients per stream** (last consumer IP/UA from go2rtc logs) before showing the consequence list | Helps user know "is anyone actually using this Loxone URL right now?" | MEDIUM | **NO for v1.3** — needs log-scraping inside the LXC; complex for small win. v1.4+. |
| **Schedule offboarding** ("Disable in 7 days") | Useful for "I'm migrating to Frigate, drain old setup gradually." | MEDIUM | **NO for v1.3** — over-engineered for the realistic user. |

#### Anti-Features (Offboarding)

| Anti-Feature | Why Problematic | Alternative |
|--------------|-----------------|-------------|
| **Hard-delete DB rows immediately on toggle off** | Loses toggle state if user changes mind 5 min later. | Soft-delete with 7-day grace, surface in `/cameras` with "Removed — undo" affordance. |
| **Auto-purge bridge container without asking** | Container creation on Proxmox = ~60s of waiting; users hate redoing it. | Default option (b) keeps the LXC. |
| **Silently leave Protect's RTSP Sharing enabled forever** | Pollution of the user's Protect state. | Always *offer* to disable; default to OFF (don't presume) but make it a one-click sub-action. |

---

### 5. Stream URL Hygiene

What URLs the bridge exposes to outside consumers (Loxone, Frigate). Quality gate flagged this explicitly.

#### Decision: **Stable semantic slugs, no tokens, slug derived from a content-addressed cam-ID (not display name).**

#### Reasoning From Industry Patterns

| Approach | Used By | When It Works | When It Breaks |
|----------|---------|---------------|----------------|
| **Tokenized URLs** (`?token=…`) | UniFi Protect's WebRTC URLs, AWS Kinesis | Public exposure, short-lived consumers | Loxone Config and Frigate config files are *paste-once* environments — token rotation = silent breakage |
| **Display-name slug** (`<cam-name>`) | go2rtc's example configs | Stable names | User renames cam → URL changes → consumer breaks |
| **Stable internal slug** (`cam-04a7-low-mjpeg`) | Scrypted's internal stream IDs, Frigate's `cameras:` keys | Consumers paste once, work forever | Slug isn't human-readable — but display name shown alongside in our UI mitigates this |

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Slug = stable cam-ID + output-type suffix** | Survives renames in Protect, survives token rotations. Locked from §3 reconciliation logic. | LOW | Slug = `<cam-internal-id-slug>-<output-suffix>`. Internal ID can be a short hash of the Protect `id` field (which is stable across renames in Protect's API). |
| **No tokens or auth in URLs** | Loxone Config doesn't reliably support URL-embedded auth for MJPEG; LAN-only threat model accepted. | LOW | Same posture as Bambu integration. |
| **Slug doesn't change when user renames cam in Protect** | URLs in user's Loxone config keep working. | LOW | Drives the §3 reconciliation rule "rename = update display name only". |
| **Slug exposed verbatim in UI alongside display name** | User can copy with confidence. | LOW | UI shows: `eingang-cam` *(Display: "Eingang Kamera")* as the source-of-truth pairing. |
| **Slug uniqueness enforced at write time** | Two cams with same name don't collide. | LOW | Use the cam's Protect-side `id` (or a hash thereof) — guaranteed unique. |

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **User-customizable slug per cam** (override the auto-generated one) | Power users want pretty URLs. | MEDIUM | **NO for v1.3** — adds collision-detection logic and a migration path when the user *changes* it. The auto-slug is good enough. v1.4+ if requested. |
| **Pre-flight URL stability check on rename** | "Renamed in Protect — Hub URLs are unchanged ✓" inline confirmation | LOW | **YES** — pure confidence-building copy on the rename-detected notice. |
| **Per-output stable URL displayed in onboarding wizard step 6** | User can paste URLs into Loxone Config *before* leaving the wizard. | LOW | **YES** — natural extension of the "where to go next" step. |

#### Anti-Features

| Anti-Feature | Why Problematic | Alternative |
|--------------|-----------------|-------------|
| **Tokenized stream URLs that rotate** | Breaks Loxone's paste-once workflow. | Slug-based + LAN trust boundary. |
| **Display-name-derived slugs without an ID component** | Rename = breakage. | ID-derived slug. |

---

### 6. Protect "RTSP Sharing" Toggle Ownership

UniFi Protect's "RTSP" toggle is *per channel* inside the camera's settings. We rely on it being ON to read the source stream. Quality gate flagged the ownership question.

#### What `unifi-protect` Lib Exposes (verified MEDIUM-HIGH from [hjdhjd/unifi-protect](https://github.com/hjdhjd/unifi-protect))

- `camera.channels[]` — array per cam
- `channels[N].isRtspEnabled` — boolean (read)
- `channels[N].rtspAlias` — string, the RTSP path token (read)
- Modification: per the lib's docstring "the ability to modify the Protect NVR JSON or Protect devices" — confirms write path exists, but specific "set isRtspEnabled" examples are NOT in the publicly-searched docs. **Marked MEDIUM confidence; needs spike to confirm exact PATCH semantics.**

#### Decision: **We "borrow" the toggle, don't "own" it.**

#### Table Stakes

| Behavior | What Happens | Complexity | Notes |
|----------|--------------|------------|-------|
| **At onboarding, if `isRtspEnabled=false` on a needed channel: offer to enable via API** | Modal: "RTSP Sharing is required for this output. Enable it now in Protect? [Yes, enable] [Manual, I'll do it]". | LOW-MEDIUM | Confidence on API write: MEDIUM — needs verification spike (likely Phase 19 Plan 1). If write fails or unsupported on the user's Protect version, fall back to the manual instructions modal. |
| **Manual fallback modal** (when API write isn't viable) | Step-by-step screenshots: "Open Protect → Devices → [Cam Name] → Settings → Advanced → RTSP → enable High channel". Per cam. | MEDIUM | Required regardless because: (1) some users will have read-only Protect creds; (2) some Protect versions may not support the write path. Self-hosted tool default = always have a manual escape hatch. |
| **Detect manual disable behind our back** | Reconciliation polls `isRtspEnabled`. If a Hub-active output's source channel flips to `false` outside our action: surface "RTSP disabled in Protect — output stopped" notice on that output. Don't auto-re-enable. | LOW | Table stakes BECAUSE: respects user agency. They turned it off; presumably on purpose. We *report*, not *fight*. |
| **Track our own actions in DB** | When we enable a channel via API, log it: `protect_rtsp_actions(channel_id, enabled_by_us=true, timestamp)`. So at offboarding we know which channels to *offer* to disable (only the ones we enabled). | LOW | Critical for clean offboarding — see §4c. |
| **Offboarding sub-toggle "Restore RTSP Sharing to pre-Hub state"** | Only appears if there are channels we enabled. Disabled if user manually toggled them in the meantime (we don't undo their changes). | MEDIUM | Locked from PROJECT.md. The "only if we enabled" gating is the new finding here. |

#### Differentiators

| Feature | Value Proposition | Complexity | v1.3 yes/no |
|---------|-------------------|------------|-------------|
| **Diff view in Settings: "RTSP Sharing — channels we enabled"** | Transparency. User can audit our footprint. | LOW | **YES** — small read-only list, high trust payoff. |
| **Auto-conflict-resolution prompt** ("You just disabled RTSP for `eingang/high` in Protect. Hub output `eingang-high-rtsp` is now broken. Disable it on our side too? [Yes / No, leave as-is]") | Polished UX for a common drift. | MEDIUM | **YES** — reuses the §3 reconciliation notice pattern; just adds an action button. |

#### Anti-Features

| Anti-Feature | Why Problematic | Alternative |
|--------------|-----------------|-------------|
| **Auto-re-enable a manually disabled channel** | Fights the user. | Surface, don't fight. |
| **Auto-disable RTSP at offboarding without asking** | The user may want it on for non-Hub uses (VLC sanity check, RTI controller, etc.). | Sub-toggle, default OFF, only offered for channels we enabled. |
| **Treat our enable as authoritative forever** | Manual disable would be silently re-enabled. | Track per-channel enabled-by-us with a "last verified" timestamp; if user disables, mark `enabled_by_us=false` (we no longer "own" it). |

---

## Feature Dependencies

```
Settings Toggle (§4a Step 0)
    └── Onboarding Wizard (§4a)
            ├── Protect Connection (existing v1.x)
            ├── LXC Provisioning (existing v1.x — VAAPI passthrough required)
            ├── Discovery (Stream Catalog §1)
            │       └── Channel metadata
            │               └── isRtspEnabled / rtspAlias (§6 RTSP Sharing)
            │
            └── Initial Reconciliation (§3)
                    └── Output Recipes (§2)
                            └── go2rtc.yaml on Bridge LXC
                                    └── Stream URLs (§5 URL Hygiene)
                                            └── Consumed by Loxone / Frigate

Stream Catalog (§1) ──reads──> RTSP Sharing state (§6)
Output Toggles (§2) ──triggers──> Reconciliation (§3)
URL Hygiene (§5) ──depends on──> Stable cam-ID from Protect API
Reconciliation (§3) ──writes──> go2rtc.yaml on Bridge LXC
Offboarding (§4c) ──reads──> protect_rtsp_actions log (§6)

Drift Detection (§3 differentiator) ──conflicts with──> Manual go2rtc.yaml edits on bridge (anti-feature)
```

### Dependency Notes

- **Stream Catalog (§1) requires RTSP Sharing state (§6):** without `isRtspEnabled` per channel, the catalog can't tell users which channels are usable, and the bridge can't pull from disabled channels. Surfacing this state is what makes §6's manual fallback modal possible.
- **Output Toggles (§2) require Reconciliation (§3):** flipping a toggle is meaningless without a process that re-renders go2rtc.yaml and reloads the bridge.
- **URL Hygiene (§5) requires stable Protect cam-IDs:** the Protect API's per-cam `id` field is stable across renames (verified MEDIUM). This is the load-bearing primitive for stable slugs.
- **Offboarding (§4c) requires the protect_rtsp_actions log (§6):** without tracking which channels we enabled, "restore RTSP Sharing to pre-Hub state" is impossible to do safely.
- **Onboarding (§4a) requires the existing v1.x LXC provisioning module:** no new provisioning code; just a new container template variant (single bridge, n streams) that builds on the existing per-cam LXC pattern.
- **Drift Detection (§3) conflicts with manual SSH edits:** documented as an anti-pattern; the user-facing "fix it" button = re-deploy from DB-of-truth.

---

## MVP Definition

### Launch With (v1.3.0)

**Core (must ship):**

- [ ] Settings toggle "Enable Protect Stream Hub" with confirmation gating
- [ ] Onboarding wizard: 6 steps as scoped in §4a, with pre-flight check (differentiator) and live thumbnail in discovery (differentiator)
- [ ] Bridge LXC provisioning (single container, VAAPI passthrough, reuses existing template)
- [ ] Stream Catalog UI per cam: native channels with codec/res/fps/RTSP URL, plus per-output rows with health badges (§1 table stakes + side-by-side preview differentiator + snapshot preview differentiator + "recommended profile" hint differentiator)
- [ ] Output types: `loxone-mjpeg` (transcode) and `frigate-rtsp` (passthrough copy) — exactly two
- [ ] Per-cam, per-output toggle matrix on cam detail page (§2 table stakes)
- [ ] "All Hub URLs" copy-list page (§2 differentiator)
- [ ] Bulk-toggle output type across cams (§2 differentiator)
- [ ] Auto-reconciliation: silent additions, soft-delete on removal (7d grace), notify on rename, channel rotation handling (§3 table stakes + event log differentiator + drift detection differentiator)
- [ ] "Sync now" button + last-sync timestamp + reconcile event log
- [ ] Hub status page: container health, # streams, # outputs, drift indicator (§4b table stakes + per-stream metrics differentiator)
- [ ] Offboarding tiered dialog: pause / disable+keep / full uninstall, with consequence preview, type-to-confirm for full, optional Protect-RTSP-restore sub-toggle, "export Hub config before uninstall" differentiator (§4c table stakes + export differentiator)
- [ ] Stable slug-based URLs `<cam-id-slug>-<output-suffix>` with rename-stable URLs (§5 table stakes + URL stability confirmation differentiator)
- [ ] Protect RTSP Sharing: API-enable with manual fallback modal, action tracking, offboarding restore option (§6 table stakes + diff view differentiator + auto-conflict-resolution prompt differentiator)
- [ ] Reuse existing `/cameras` UI with "Protect Hub" badge (locked decision)
- [ ] Live snapshot preview per output (§1 differentiator)

### Add After Validation (v1.3.x patches)

- [ ] Custom output-name override (if users actually rename cams a lot in Protect and the auto-slug feels wrong)
- [ ] Bandwidth estimate per active output (once telemetry surface stabilizes)
- [ ] VAAPI utilization display on Hub status page

### Future Consideration (v1.4+)

- [ ] Live MJPEG preview (continuous, not snapshot) — wait for user signal
- [ ] Recently-consumed-by clients per stream — needs log scraping in LXC
- [ ] Schedule offboarding ("disable in 7 days") — niche use case
- [ ] Webhook on reconcile event — wait for n8n/HA integration requests
- [ ] Per-output rate-limit / max-clients setting — only if homelabs report contention
- [ ] Channel comparison grid view (all cams × channels) — only if users have ≥10 Protect cams
- [ ] Custom ffmpeg pipeline UI per output (anti-feature, but PR-able recipes in code) — handle as PR contributions instead of UI
- [ ] Profile system (Loxone Profile applied to N cams) — only at ≥5 output types
- [ ] Additional output types: HomeAssistant-WebRTC, Scrypted-friendly RTSP, motionEye-MJPEG — output recipe model already supports it; new types are recipe-only changes

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Settings toggle + confirmation gating | HIGH | LOW | P1 |
| Onboarding wizard (6 steps) | HIGH | MEDIUM | P1 |
| Bridge LXC provisioning (reuse existing) | HIGH | LOW-MEDIUM | P1 |
| Stream Catalog UI (channels + RTSP URLs) | HIGH | LOW | P1 |
| Output types: Loxone-MJPEG + Frigate-RTSP | HIGH | MEDIUM | P1 |
| Per-cam toggle matrix | HIGH | LOW | P1 |
| "All Hub URLs" copy-list page | HIGH | LOW | P1 |
| Auto-reconciliation (silent add / soft-delete / notify rename) | HIGH | MEDIUM | P1 |
| Sync-now + last-sync + event log | MEDIUM | LOW | P1 |
| Hub status page | MEDIUM | LOW-MEDIUM | P1 |
| Offboarding tiered dialog | HIGH | MEDIUM | P1 |
| Stable slug-based URLs | HIGH | LOW | P1 |
| Protect RTSP Sharing handling | HIGH | LOW-MEDIUM | P1 |
| `/cameras` integration with badge | HIGH | LOW | P1 |
| Snapshot preview per output | MEDIUM | LOW-MEDIUM | P1 |
| Side-by-side native vs Hub preview | MEDIUM | LOW | P1 |
| "Recommended profile" hints | MEDIUM | LOW | P1 |
| Bulk-toggle output type | MEDIUM | LOW | P1 |
| Drift detection | MEDIUM | MEDIUM | P1 |
| Reconcile event log | MEDIUM | LOW | P1 |
| Per-stream metrics card | MEDIUM | LOW | P1 |
| Pre-flight check before LXC create | MEDIUM | MEDIUM | P1 |
| Live thumbnail in discovery step | MEDIUM | MEDIUM | P1 |
| Recap step before activation | MEDIUM | LOW | P1 |
| Diff view of channels we enabled | MEDIUM | LOW | P1 |
| Auto-conflict-resolution prompt (RTSP toggle) | MEDIUM | MEDIUM | P1 |
| Export Hub config before uninstall | MEDIUM | LOW | P1 |
| URL stability confirmation on rename | LOW | LOW | P1 |
| Live continuous MJPEG preview | MEDIUM | MEDIUM | P3 |
| Custom output-name override | LOW | MEDIUM | P3 |
| Bandwidth estimate | LOW | LOW-MEDIUM | P3 |
| VAAPI utilization display | LOW | MEDIUM | P3 |
| Schedule offboarding | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (v1.3.0)
- P2: Should have, add when possible (v1.3.x patches)
- P3: Nice to have, future consideration (v1.4+)

---

## Competitor Feature Analysis

| Feature | UniFi Protect (native) | Scrypted | Frigate | Home Assistant `unifiprotect` | Our Approach (v1.3) |
|---------|------------------------|----------|---------|-------------------------------|---------------------|
| **Multi-quality channel surfacing** | Per-cam settings UI | "Rebroadcast Plugin" auto-picker w/ Local/Remote/HSV defaults | `inputs:` list in YAML | Up to 7 entities per cam (RTSP × channel × transport) | Per-cam page row-per-channel with metadata + RTSP URL |
| **Stream re-distribution** | Native RTSP/RTSPS endpoints (per channel) | Rebroadcast plugin → MediaMTX/MJPEG/HLS/etc. | go2rtc relay built-in | Reads from Protect, exposes via HA's stream platform | Single bridge LXC w/ go2rtc.yaml; Loxone-MJPEG (transcode) + Frigate-RTSP (copy) |
| **Onboarding flow** | "Adopt new camera" wizard (per cam) | Plugin install → per-device add | YAML edit, no wizard | Config flow: discover → confirm → entity registry | 6-step wizard with pre-flight + recap (best-of-breed) |
| **Auto-discovery of new cams** | Adoption alerts | Plugin polls | None | Auto-creates entities, surfaces in /devices | Auto-add to DB w/ "configure outputs" CTA, never auto-enable outputs |
| **Removal handling** | "Unadopt" with confirmation | "Trash" tombstone | YAML delete | Config entry remove → entities unavailable | 7-day soft-delete grace window + tiered uninstall dialog |
| **URL stability across rename** | RTSP `rtspAlias` is stable | Internal IDs stable | YAML stream name = user-controlled | Entity ID stable; friendly name updates | Slug derived from Protect cam-ID, NOT display name |
| **Manual config drift detection** | n/a | n/a | n/a | Reload integration | Hash-compare DB-rendered YAML vs deployed; surface as "drift" indicator |
| **Lifecycle export/backup** | NVR-level only | n/a | YAML is the backup | Config entry export | Per-uninstall "export config" button + existing v1.1 SQLite backup |

---

## Sources

### Verified — HIGH confidence
- [Frigate go2rtc Configuration](https://docs.frigate.video/guides/configuring_go2rtc/) — stream-name-as-stable-URL pattern, multi-quality channel handling
- [Frigate Camera Configuration](https://docs.frigate.video/configuration/cameras/) — multiple input streams with role assignment (`detect` vs `record`)
- [Frigate Live View](https://docs.frigate.video/configuration/live/) — per-camera stream selection dropdown UX
- [go2rtc README](https://github.com/AlexxIT/go2rtc) — `:1984/api/streams`, `stream.mjpeg?src=…`, `frame.jpeg?src=…` endpoints
- [hjdhjd/unifi-protect on GitHub](https://github.com/hjdhjd/unifi-protect) — `channels[]`, `isRtspEnabled`, `rtspAlias` fields verified in [protect-api.ts](https://github.com/hjdhjd/unifi-protect/blob/main/src/protect-api.ts)
- [Home Assistant Config Flow developer docs](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/) — discovery → confirm pattern; "discovery never auto-finishes a flow"
- [Home Assistant UniFi Protect integration](https://www.home-assistant.io/integrations/unifiprotect/) — up to 7 entities per cam, disabled-by-default for non-default channels
- [Unraid managing containers docs](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/) — appdata persistence pattern across remove

### Verified — MEDIUM confidence
- [Scrypted Add a Camera docs](https://docs.scrypted.app/add-camera.html) — Rebroadcast Plugin defaults: High = local/recording, Medium = remote, Low = analysis/Watch
- [Scrypted Camera Preparation](https://docs.scrypted.app/camera-preparation.html) — recommended config: High 1080p+/2 Mbps, Medium 720p/500 kbps, Low 320p/100 kbps
- [UniFi Protect community: How does RTSP work on Protect](https://community.ui.com/questions/How-does-RTSP-work-on-Protect/448bd517-7991-4d45-982c-33eff0d22184) — per-channel toggle in Protect UI, RTSP URL format
- [unifi-protect npm](https://www.npmjs.com/package/unifi-protect) — library scope: read + write access to Protect device JSON
- [Florian Rhomberg integration guide](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) — third-party camera adoption walkthrough
- [Loxone CCTV mailing list](https://groups.google.com/g/loxone-english/c/cd_n67zE91w) — MJPEG sub-stream requirement for Loxone display
- [Loxone iSpyConnect URL format reference](https://www.ispyconnect.com/camera/loxone) — MJPEG URL structures
- [WebRTC.link go2rtc tutorial](https://webrtc.link/en/articles/go2rtc-ultimate-streaming-solution/) — `:1984/api/stream.mp4?src=` URL pattern
- [seekwhencer/mediamtx-ui](https://github.com/seekwhencer/mediamtx-ui) — MediaMTX dashboard UI prototype, validates the "single page lists all streams" pattern

### Inference / LOW confidence (flagged in body)
- Loxone Motion Shape Extreme single low-quality vs dual-stream requirement — specific Loxone documentation not surfaced; rely on Florian Rhomberg's blog precedent + open question already logged in `STATE.md` Pending Todos
- Specific PATCH semantics for `isRtspEnabled` write via `unifi-protect` lib — needs spike to confirm in Phase 19
- "~80% friction reduction from snapshot preview" — qualitative inference from comparable patterns in Scrypted/Frigate UX, not a measured number

---

*Feature research for: ip-cam-master v1.3 Protect Stream Hub*
*Researched: 2026-04-30*
