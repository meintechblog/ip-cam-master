# Pitfalls Research

**Domain:** IP camera management webapp with Proxmox LXC orchestration
**Researched:** 2026-03-22
**Confidence:** HIGH (most pitfalls verified across multiple sources including Proxmox forums, go2rtc GitHub issues, and UniFi community)

## Critical Pitfalls

### Pitfall 1: VAAPI Device Passthrough Fails Silently in LXC Containers

**What goes wrong:**
Hardware-accelerated transcoding (VAAPI) appears configured but ffmpeg falls back to software encoding without clear errors. The LXC container either cannot see `/dev/dri/renderD128` at all, or can see it but lacks permissions. CPU usage spikes to 100%+ per camera because transcoding runs on CPU instead of GPU. Since this is MJPEG-to-H.264 transcoding (not just remuxing), the CPU cost without hardware acceleration is enormous.

**Why it happens:**
LXC containers do not automatically inherit GPU device access from the host. Three things must align: (1) the device node must be passed through in the LXC config, (2) cgroup device-allow rules must permit access to the character device (major 226), and (3) the UID/GID mapping inside unprivileged containers must map to the host's `video` and `render` groups. Missing any one of these causes silent failure. Additionally, the VAAPI drivers (`intel-media-va-driver` or `i965-va-driver`) must be installed inside the container itself, not just on the host.

**How to avoid:**
- Use Proxmox's built-in Device Passthrough feature (PVE 8.x+) via `dev0: /dev/dri/renderD128,mode=0666` in the LXC config
- Add `lxc.cgroup2.devices.allow: c 226:0 rwm` and `lxc.cgroup2.devices.allow: c 226:128 rwm` to the container config
- Create a persistent udev rule on the host: `KERNEL=="renderD128", MODE="0666"` in `/etc/udev/rules.d/`
- Install `vainfo` inside the container and verify output as a post-provision health check
- Include VAAPI driver installation (e.g., `intel-media-va-driver`) in the container provisioning script

**Warning signs:**
- go2rtc/ffmpeg logs show "No VA display found for device /dev/dri/renderD128"
- `ls /dev/dri/` inside the container shows nothing or only `card0`
- CPU usage per container exceeds 50% for a single 720p stream (should be <5% with VAAPI)
- `vainfo` returns "error: can't connect to X server" or "No device available"

**Phase to address:**
Phase 1 (LXC provisioning). The container template/creation script must configure device passthrough and driver installation from day one. Retrofitting VAAPI onto existing containers is error-prone.

---

### Pitfall 2: Credentials Leaked in Public GitHub Repository

**What goes wrong:**
Camera credentials (RTSP usernames/passwords), Proxmox API tokens, SSH keys for the UDM, or UniFi Protect credentials end up committed to the public `meintechblog/ip-cam-master` repository. Once pushed, they are permanently in git history even if the file is deleted later. Attackers actively scan public GitHub repos for credentials, with over 5,000 API keys leaked daily across GitHub.

**Why it happens:**
During development, credentials get hardcoded into config files, test scripts, or environment files. The go2rtc YAML config format embeds RTSP URLs which include `user:password@ip` inline. Copy-pasting a working config into the repo is the fastest way to test, and `.gitignore` entries are forgotten or added after the first commit.

**How to avoid:**
- Create `.gitignore` with all credential-bearing patterns BEFORE the first commit: `*.env`, `config.local.*`, `secrets/`, `go2rtc.yaml` (the real one with credentials)
- Ship a `go2rtc.yaml.example` with placeholder values (`rtsp://USER:PASSWORD@CAMERA_IP:554/...`)
- Store credentials in a local-only config file that the app reads at runtime (e.g., `/etc/ip-cam-master/credentials.json`)
- Use environment variables for Proxmox API tokens and SSH key paths
- Add a pre-commit hook (or GitHub secret scanning) that blocks commits containing patterns like `rtsp://[^@]+@`, API token UUIDs, or SSH private key headers
- Never generate the real go2rtc config in the repository; generate it at runtime from templates + local credentials

**Warning signs:**
- Any file in the repo containing `@192.168.` (credential-bearing URLs)
- Proxmox API token UUIDs in source files
- SSH private key files anywhere in the working tree
- `.gitignore` missing credential file patterns

**Phase to address:**
Phase 0 (project setup). The `.gitignore` and credential-handling architecture must be established before any code is written. This is a "never acceptable to skip" item.

---

### Pitfall 3: go2rtc Loses Camera Connection and Does Not Recover

**What goes wrong:**
go2rtc loses the RTSP/MJPEG connection to a camera (network blip, camera reboot, DHCP renewal) and does not automatically reconnect. The stream appears "online" in go2rtc's API but delivers no frames. UniFi Protect shows the camera as offline or with a frozen frame. The only fix is restarting the go2rtc process or the entire LXC container.

**Why it happens:**
go2rtc has a known limitation where it sometimes fails to recover connections automatically, particularly with MJPEG sources and wireless cameras. The MJPEG-over-HTTP protocol (used by both Mobotix and Loxone Intercom) is a long-lived HTTP connection that does not have built-in reconnection semantics like RTSP does. When the connection drops, the HTTP stream simply ends, and go2rtc may not detect or retry it reliably.

**How to avoid:**
- Wrap go2rtc in a systemd service with `Restart=always` and `RestartSec=5` as a baseline
- Implement an external health-check script that runs every 30-60 seconds:
  - Query go2rtc API (`http://localhost:1984/api/streams`) to check stream status
  - Verify frames are actually being produced (not just "connected")
  - Restart the go2rtc process if the stream is stale
- For MJPEG sources specifically, consider using the `ffmpeg:` source prefix in go2rtc config instead of direct HTTP, as ffmpeg has more robust reconnection handling
- Use `ffmpeg:http://...#video=h264#...` with additional flags like `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 30`

**Warning signs:**
- Camera shows "online" in go2rtc web UI but video player shows black/frozen
- UniFi Protect reports "camera not available" for adopted cameras
- go2rtc logs show EOF errors or no new log entries for a camera stream
- Health check API returns stream info but with stale timestamps

**Phase to address:**
Phase 2 (stream pipeline). Must be addressed when implementing the go2rtc configuration, not deferred to a "reliability" phase. Streams that work once but fail after 24 hours are not actually working.

---

### Pitfall 4: UniFi Protect Third-Party Camera Adoption Is Fragile

**What goes wrong:**
UniFi Protect successfully adopts the camera initially, but breaks after any configuration change to go2rtc (stream parameters, port, IP change). The camera must be fully removed from Protect and re-adopted -- there is no "update stream URL" function. Protect opens two RTSP connections (HQ and LQ streams) which doubles the transcoding load. After Protect firmware updates, adopted third-party cameras sometimes need re-adoption.

**Why it happens:**
UniFi Protect treats third-party cameras as second-class citizens. It caches the stream configuration at adoption time and does not re-discover or re-negotiate. The adoption process uses a specific handshake involving port 1984 (go2rtc API) and port 8554 (RTSP), and both must be reachable from the UDM. Protect automatically detects the "highest and lowest quality streams" and expects two streams per camera.

**How to avoid:**
- Design the go2rtc config to be stable: use fixed container IPs (not DHCP), fixed port mappings, and fixed stream names
- Provide both an HQ and LQ stream in go2rtc config to give Protect what it expects (e.g., `camera_hq` at 1280x720 and `camera_lq` at 640x360)
- Document the re-adoption procedure prominently in the UI (it will happen)
- Build a "test stream" step into the onboarding workflow that verifies the RTSP stream is working BEFORE attempting Protect adoption
- Store the adoption state in the app's database so the dashboard can detect when re-adoption is needed
- Ensure ports 1984 and 8554 are accessible from the UDM's network to every LXC container

**Warning signs:**
- Camera appears in Protect but shows "Disconnected" within minutes
- Protect shows the camera but with no video preview
- go2rtc logs show two connections from the UDM IP (this is expected/normal)
- After any container restart, Protect loses the camera

**Phase to address:**
Phase 3 (UniFi Protect integration). This is the single most complex integration point and needs thorough testing with the actual UDM hardware. Cannot be fully validated without real hardware.

---

### Pitfall 5: Proxmox API Token Permissions and Privilege Separation

**What goes wrong:**
The app connects to the Proxmox API successfully but operations fail with empty responses (`data: null`) or 403 errors. Container creation appears to succeed but the container is misconfigured. The API token can do more than intended (security risk) or less than needed (broken functionality).

**Why it happens:**
Proxmox API tokens have "privilege separation" enabled by default, meaning the token only gets permissions explicitly granted to it, not the full permissions of the user it belongs to. Developers test with the root user's ticket-based auth during development, then switch to API tokens for production and everything breaks. The Authorization header format (`PVEAPIToken=USER@REALM!TOKENID=UUID`) is easy to get wrong -- confusing the token ID with the token secret is extremely common.

**How to avoid:**
- Create a dedicated Proxmox user (e.g., `ipcammaster@pve`) with only the permissions needed: `VM.Allocate`, `VM.Config.*`, `VM.PowerMgmt`, `Datastore.AllocateSpace` on the specific storage and node
- Disable privilege separation on the API token (or explicitly grant matching permissions)
- Use API tokens from day one in development, never test with root tickets
- Store the token in a local config file, not in the codebase
- Validate the API connection and permissions at app startup (try a lightweight operation like listing containers)
- Use the correct header format: `Authorization: PVEAPIToken=ipcammaster@pve!token-id=<secret-uuid>`

**Warning signs:**
- API calls return `{ "data": null }` instead of data
- Container creation works via Proxmox web UI but fails via the app
- 401 "No Ticket" errors despite providing a token
- CSRF token errors on POST/PUT/DELETE requests (note: API tokens do NOT need CSRF tokens, only ticket-based auth does)

**Phase to address:**
Phase 1 (Proxmox integration). Must be validated with a real Proxmox host before building any container orchestration logic on top.

---

### Pitfall 6: Loxone Intercom Auth Proxy Misconfiguration

**What goes wrong:**
The nginx auth-proxy strips or incorrectly formats the Basic Authentication header for the Loxone Intercom's MJPEG stream. The Intercom returns 401 Unauthorized, but nginx may return a 502 Bad Gateway or simply an empty response. go2rtc then receives no frames and reports the stream as unavailable. Alternatively, the proxy works but leaks credentials in nginx access logs.

**Why it happens:**
The Loxone Intercom (new model) does not accept Basic Authentication credentials in the URL (i.e., `http://user:pass@ip/mjpg/video.mjpg` does not work). Authentication must be passed via the `Authorization` header with Base64-encoded credentials. The nginx `proxy_set_header Authorization "Basic <base64>"` directive must encode `user:password` correctly. A single character error in the Base64 string breaks auth silently. Additionally, nginx's default `proxy_pass` behavior may modify headers or buffer the MJPEG stream incorrectly.

**How to avoid:**
- Generate the Base64 auth header programmatically during container provisioning (never hand-encode)
- Disable response buffering in nginx for MJPEG streams: `proxy_buffering off;` and `proxy_request_buffering off;`
- Set `proxy_http_version 1.1;` (MJPEG streams are long-lived and benefit from HTTP/1.1 keepalive)
- Suppress credential logging in nginx: use a custom `log_format` that excludes the Authorization header
- Test the nginx proxy independently before connecting go2rtc (curl the proxied URL and verify MJPEG frames arrive)
- Configure the nginx proxy to return a clear error page (not default 502) when the Intercom is unreachable

**Warning signs:**
- nginx error log shows "upstream prematurely closed connection"
- go2rtc receives 0 bytes from the MJPEG source
- Intercom is reachable directly (via browser with credentials) but not through nginx
- Base64 string in nginx config is the wrong length or contains padding errors

**Phase to address:**
Phase 2 (Loxone Intercom pipeline). The nginx config generation must be part of the automated container provisioning, not a manual step.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded container IPs in go2rtc config | Fast to set up | Every new camera requires manual IP assignment; conflicts if network changes | Never -- use app-managed IP allocation from a defined range |
| Privileged LXC containers | Avoids all permission issues with /dev/dri | Security risk; host kernel exposed; breaks if Proxmox tightens defaults | Never -- unprivileged with device passthrough is the correct approach |
| Polling camera status via RTSP reconnect | Simple implementation | Constant reconnection overhead; missed state transitions | MVP only -- move to event-driven status via go2rtc API |
| Single go2rtc config per container | Simple 1:1 mapping | One container per camera wastes ~30-50MB RAM each | Acceptable for v1 scope (4 cameras), revisit if scaling to 20+ |
| SSH to UDM for Protect status | Direct access to logs | Brittle; breaks on firmware updates; security risk of storing UDM SSH keys | MVP only -- replace with UniFi Protect API if/when available |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Proxmox API | Using ticket auth in production (expires, needs CSRF token) | Use API tokens with `Authorization: PVEAPIToken=...` header; no CSRF needed |
| Proxmox API | Creating container from template fails with "unable to use volume" | Verify template exists on the target storage; use full volume path `local:vztmpl/template.tar.zst` |
| go2rtc | Putting credentials in stream name (visible in API/UI) | Use stream config with credential substitution; keep names like `mobotix_22`, not `admin:pass@192...` |
| go2rtc | Assuming RTSP port 554 works for all cameras | Mobotix uses 554, but the stream path varies by model; always verify with VLC first |
| UniFi Protect | Adopting camera before stream is stable | Verify stream plays for >60 seconds in VLC/go2rtc web UI before triggering adoption |
| UniFi Protect | Changing go2rtc config after adoption | Any change requires full remove + re-adopt in Protect; design config to be stable |
| nginx (Loxone) | Using `proxy_pass` with default buffering for MJPEG | MJPEG is a continuous stream; must disable buffering or nginx holds frames |
| Loxone Intercom | Putting credentials in URL | Intercom rejects URL-based auth; must use Authorization header with Base64 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Software transcoding without VAAPI | CPU >100% per camera, frame drops, container OOM | Verify `vainfo` in every container at provision time | Immediately with 2+ cameras on most hardware |
| go2rtc opens HQ+LQ streams to camera | Double bandwidth from camera, camera firmware crashes | Configure two separate quality levels in go2rtc output, not two connections to camera source | With cameras that support only 1-2 concurrent RTSP connections |
| LXC container per camera RAM overhead | Host RAM exhausted with 10+ cameras | Use minimal container base (Alpine or Debian slim); ~50MB per container baseline | At 10-15 cameras on a 16GB Proxmox host |
| ffmpeg transcoding generates I-frames too infrequently | UniFi Protect buffering, slow stream start | Set `-g 20` (keyframe every 20 frames at 20fps = 1 second) in ffmpeg args | Noticeable with any stream >5 seconds to load |
| nginx proxy buffers entire MJPEG response | Memory leak in nginx; delayed video | `proxy_buffering off;` in nginx config | Within minutes of starting the Loxone stream |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing Proxmox root API token | Full host compromise if token leaks | Create limited-permission user; token with only LXC management rights |
| Camera credentials in go2rtc.yaml committed to repo | Attacker accesses camera feeds; pivots to network | Generate go2rtc.yaml at runtime from template + local credential store |
| UDM SSH key without passphrase in repo | Full UniFi network compromise | Store SSH key path in local config; never commit key material |
| go2rtc web UI (port 1984) exposed without auth | Anyone on network can view all camera streams, modify config | Bind go2rtc to localhost inside container; proxy through app with auth if needed |
| Proxmox API over HTTP (not HTTPS) | Credentials transmitted in plaintext on local network | Always use `https://` for Proxmox API even on local network; accept self-signed cert |
| Installer script runs as root without verification | Supply-chain attack via compromised GitHub repo | Provide checksum verification; pin to tagged releases; show script before execution |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress indication during LXC creation | User thinks app is frozen (container creation takes 30-60s) | Show step-by-step progress: creating container, installing packages, configuring go2rtc, testing stream |
| Camera shows "online" but stream is frozen | False confidence; user discovers failure much later | Health check that verifies frame production, not just process status |
| Re-adoption required but no explanation | User sees "offline" in Protect with no action path | Dashboard shows "needs re-adoption" with one-click re-adopt button and explanation |
| Network scanner finds too many devices | User overwhelmed with non-camera results | Filter by known camera manufacturers (Mobotix MAC prefix, Loxone MAC prefix); show "camera" vs "other" |
| Error messages show raw stderr from ffmpeg | User cannot diagnose the problem | Parse common ffmpeg errors into human-readable messages ("Camera not responding", "Authentication failed", "Hardware acceleration unavailable") |

## "Looks Done But Isn't" Checklist

- [ ] **LXC container creation:** Often missing `/dev/dri` passthrough -- verify with `vainfo` inside container
- [ ] **go2rtc config:** Often missing `-g` (keyframe interval) flag -- verify stream starts within 2 seconds in VLC
- [ ] **RTSP stream:** Often works once but fails on camera reboot -- verify after power-cycling the camera
- [ ] **UniFi adoption:** Often succeeds initially but breaks after go2rtc restart -- verify after container restart
- [ ] **Loxone nginx proxy:** Often works for a few minutes but leaks memory -- verify after 1 hour of continuous streaming
- [ ] **Installer script:** Often works on the developer's machine but fails on fresh Proxmox -- test on a clean VM
- [ ] **Camera discovery:** Often finds cameras but with wrong metadata -- verify discovered info matches actual camera capabilities
- [ ] **Credential handling:** Often secure in production but credentials in test fixtures -- audit entire repo with `git log -p | grep -i password`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Credentials committed to public repo | HIGH | Rotate ALL exposed credentials immediately; use `git filter-branch` or BFG Repo Cleaner to purge from history; force push; notify affected services |
| VAAPI not working in containers | MEDIUM | Stop containers; update LXC configs with device passthrough; install VAAPI drivers in container; restart; verify with `vainfo` |
| go2rtc stream stuck | LOW | Restart go2rtc systemd service; if persistent, restart LXC container; automate with health check |
| UniFi Protect adoption broken | MEDIUM | Remove camera from Protect; wait 60 seconds; verify RTSP stream is stable; re-adopt; takes 2-5 minutes per camera |
| Proxmox API token wrong permissions | LOW | Create new token with correct permissions; update local config; no restart needed |
| nginx auth proxy misconfigured | LOW | Test Intercom auth with curl; regenerate Base64 header; reload nginx |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Credentials in repo | Phase 0 (project setup) | `.gitignore` exists with credential patterns; pre-commit hook blocks secrets; no credentials in `git log` |
| VAAPI device passthrough | Phase 1 (LXC provisioning) | `vainfo` returns valid output in every provisioned container |
| Proxmox API permissions | Phase 1 (Proxmox integration) | App can create, start, stop, and destroy a test container using API token |
| go2rtc stream recovery | Phase 2 (stream pipeline) | Stream recovers within 60 seconds after simulated camera disconnect |
| Loxone nginx auth proxy | Phase 2 (Loxone pipeline) | Proxied MJPEG stream runs for >1 hour without memory leak or auth failure |
| UniFi Protect adoption fragility | Phase 3 (Protect integration) | Camera survives container restart and go2rtc process restart without needing re-adoption |
| Installer fails on fresh system | Phase 4 (distribution) | Installer succeeds on a clean Proxmox 8.x VM with no prior configuration |

## Sources

- [Proxmox LXC iGPU passthrough tutorial](https://forum.proxmox.com/threads/proxmox-lxc-igpu-passthrough.141381/)
- [iGPU passthrough into unprivileged LXC (solved)](https://forum.proxmox.com/threads/solved-igpu-passthrough-into-unprivileged-lxc.158325/)
- [go2rtc Hardware Acceleration wiki](https://github.com/AlexxIT/go2rtc/wiki/Hardware-acceleration)
- [go2rtc VAAPI encoding in LXC - Issue #973](https://github.com/AlexxIT/go2rtc/issues/973)
- [go2rtc does not recover connection - Issue #762](https://github.com/AlexxIT/go2rtc/issues/762)
- [go2rtc 100% CPU usage - Issue #1677](https://github.com/AlexxIT/go2rtc/issues/1677)
- [UniFi Protect Third-Party Cameras documentation](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect)
- [Loxone Intercom integration via go2rtc (LoxWiki)](https://loxwiki.atlassian.net/wiki/spaces/LOXEN/pages/2517499917/Integrating+Loxone+Intercom+Video+into+UniFi+Protect+via+go2rtc)
- [Loxone Intercom + UniFi Protect - go2rtc Issue #1825](https://github.com/AlexxIT/go2rtc/issues/1825)
- [Florian Rhomberg - How to integrate third party camera into UniFi Protect](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/)
- [meintechblog - Loxone Intercom in UniFi Protect](https://meintechblog.de/2025/10/07/howto-loxone-intercom-videofeed-in-unifi-protect-einbinden/)
- [Proxmox API authentication documentation](https://pve.proxmox.com/wiki/Proxmox_VE_API)
- [Proxmox API token configuration (forum)](https://forum.proxmox.com/threads/api-token-config.92465/)
- [Frigate go2rtc configuration guide](https://docs.frigate.video/guides/configuring_go2rtc/)
- [GitHub storing secrets safely](https://docs.github.com/en/get-started/learning-to-code/storing-your-secrets-safely)

---
*Pitfalls research for: IP camera management with Proxmox LXC orchestration*
*Researched: 2026-03-22*
