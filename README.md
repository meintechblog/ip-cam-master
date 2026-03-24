# IP-Cam-Master

One-click camera onboarding for UniFi Protect. Discover cameras in the network, and the app handles everything — container creation, stream transcoding, ONVIF wrapping, and Protect adoption.

Built for self-hosters who want to integrate non-ONVIF cameras (Mobotix, Loxone Intercom) into UniFi Protect without manual setup.

## Features

- **Auto-Discovery** — Scans the network for Mobotix cameras and Loxone Intercoms, shows them with name and type
- **Credential Presets** — Store standard logins once, cameras are auto-matched during onboarding
- **5-Step Onboarding Wizard** — From credential entry to verified stream in UniFi Protect
- **Native ONVIF Support** — Cameras with built-in ONVIF are registered without containers
- **Live Dashboard** — Snapshot preview, service pipeline status, LXC resources, UniFi Protect connection
- **Camera Probing** — Live FPS, model (e.g., MOBOTIX S15D-Sec), firmware version, codec directly from camera
- **Container Management** — Start, stop, restart, delete LXC containers from the UI
- **Dynamic Proxmox Config** — Storage and bridge dropdowns loaded from Proxmox API with disk space info

## How It Works

### Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────┐     ┌──────────────┐
│  Mobotix     │     │  LXC Container (Proxmox, 4GB/192MB)         │     │  UniFi       │
│  Camera      │     │                                              │     │  Protect     │
│              │     │  ┌─────────┐  ┌──────────┐  ┌────────────┐  │     │              │
│  MJPEG :554 ─┼────►│  │ go2rtc  │─►│ RTSP     │─►│ ONVIF      │──┼────►│  ONVIF       │
│              │     │  │ VAAPI   │  │ H.264    │  │ Server     │  │     │  Discovery   │
│              │     │  └─────────┘  └──────────┘  └────────────┘  │     │  + Adoption  │
└─────────────┘     └──────────────────────────────────────────────┘     └──────────────┘
```

### Two Camera Types

| Type | Example | Onboarding | Container |
|------|---------|-----------|-----------|
| **Pipeline** (no ONVIF) | Mobotix S15D | Full 5-step wizard | Yes — go2rtc + ONVIF Server |
| **Native ONVIF** | Mobotix S16B | Simple registration | No — direct Protect adoption |

### Onboarding Flow

1. **Auto-Discovery** scans the network, identifies cameras by type (Mobotix/Loxone/ONVIF)
2. **Credential matching** — saved presets are tried automatically. If matched: IP, name, user, password are pre-filled
3. **Connection test** — probes camera RTSP stream, shows live snapshot
4. **Container creation** — Debian 12 LXC on Proxmox with VAAPI passthrough, named `cam-<name>`
5. **Service setup** — installs go2rtc (MJPEG→H.264 VAAPI), ONVIF server (with correct device naming), both as systemd services
6. **Stream verification** — go2rtc API health check, RTSP URL displayed

### Camera Dashboard

Each camera gets a full-width card with:

- **Live snapshot** (refreshes every 10s, directly from camera)
- **LXC panel** — CPU/RAM bars, IP, MAC address, hostname, start/stop/restart/delete buttons
- **Service pipeline** — Kamera ► go2rtc ► ONVIF ► UniFi Protect with green/red status indicators
- **Camera details** — Model (MOBOTIX S15D-Sec), firmware (MX-V4.4.2.73), live FPS, codec
- **go2rtc details** — Transcode info, VAAPI, bitrate, connected clients
- **UniFi Protect** — Connection status (detected via GStreamer user agent), active streams
- **Editable name** — Click pencil icon, updates DB + LXC hostname

## Tech Stack

- **Frontend:** SvelteKit 2 (Svelte 5 Runes), Tailwind CSS 4, Lucide icons
- **Backend:** SvelteKit server routes, SQLite (better-sqlite3), Drizzle ORM
- **Infrastructure:** Proxmox VE API, SSH via node-ssh (key-based), go2rtc, daniela-hase/onvif-server
- **Security:** AES-256-GCM encryption for all stored credentials
- **Runtime:** Node.js 22 LTS

## Installation

One command on your Proxmox host — creates a VM with everything ready:

```bash
curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh | bash
```

The installer:
- Creates a Debian 12 VM on your Proxmox host
- Installs Node.js, the app, and all dependencies
- Sets up API tokens and SSH keys (VM can manage Proxmox automatically)
- Starts the app as a systemd service on port 80

Same command for **updates** (detects existing VM, pulls latest, rebuilds) and **uninstall** (removes VM + tokens).

### After Installation

1. Open `http://<vm-ip>` — set up login or click "Ohne Passwort fortfahren" (YOLO mode)
2. **Settings → Proxmox** — already configured by installer, verify connection is green
3. **Settings → Credentials** — add standard camera logins (tried automatically during onboarding)
4. **Kameras → + Kamera hinzufuegen** — discovered cameras appear with pre-filled credentials
5. Click **Einrichten** → follow wizard → camera appears in UniFi Protect

### Prerequisites

- **Proxmox VE 8.x** host (x86_64 only — no ARM support)
- **Intel GPU with VAAPI** on the Proxmox host (`/dev/dri/renderD128` must exist)
- Debian 12 LXC template: `pveam download local debian-12-standard_12.12-1_amd64.tar.zst`

### Why Intel VAAPI? Why not Software / ARM / Nvidia?

IP-Cam-Master requires hardware video transcoding (MJPEG → H.264) via Intel VAAPI. This is a deliberate design decision, not a limitation we plan to remove:

| Platform | Supported | Why |
|----------|-----------|-----|
| **Intel** (Core 6th+, Atom, N95/N100/N200) | **Yes** | VAAPI via `/dev/dri/renderD128`, passthrough to LXC containers works out of the box |
| **Software transcoding (CPU)** | No | Too slow for real-time multi-camera transcoding. A single Mobotix stream at 1080p20 would max out a CPU core |
| **Raspberry Pi 4/5** | No | Proxmox is x86_64 only. RPi uses VideoCore (V4L2), not VAAPI — entirely different ffmpeg pipeline. RPi 5 dropped the H.264 hardware encoder |
| **Nvidia GPU** | No | Would require NVENC support in go2rtc configs, different device paths, nvidia-container-toolkit in LXC. Possible but not implemented |
| **AMD GPU** | No | VA-API exists on AMD but untested. LXC device passthrough differs from Intel. May work with community patches |

The entire pipeline (go2rtc config generation, LXC `/dev/dri` passthrough, ffmpeg flags) is built around Intel VAAPI. Supporting other platforms would require a separate transcoding backend per platform — not worth the complexity for a homelab tool.

**Recommended hardware:** Intel N100 or N200 mini PCs (fanless, ~10W TDP, ~€150) handle 6+ camera streams easily.

### Development

```bash
git clone https://github.com/meintechblog/ip-cam-master.git
cd ip-cam-master
npm install
cp .env.example .env  # Set DB_ENCRYPTION_KEY (min 32 characters)
npx drizzle-kit push   # Create SQLite tables
npm run dev -- --host 0.0.0.0
```

### Container Specs

Each camera LXC container uses minimal resources:

| Resource | Value |
|----------|-------|
| RAM | 192 MB |
| Disk | 4 GB |
| CPU | 1 core |
| Services | go2rtc + ONVIF server (systemd) |
| Hostname | `cam-<camera-name>` |
| VMID | Auto-assigned (next 1000 boundary) |

## Settings

### Proxmox

| Field | Description |
|-------|-------------|
| Host | Proxmox IP (port 8006 added automatically) |
| API Token ID | Format: `user@realm!tokenname` |
| API Token Secret | UUID token |
| Storage Target | Dropdown from Proxmox (shows free space) |
| Network Bridge | Dropdown from Proxmox |

### Credentials

Standard logins tried in priority order when onboarding cameras. Stored AES-256-GCM encrypted.

## Background & References

This project automates the manual processes described in these blog posts on [meintechblog.de](https://meintechblog.de):

- **[Hardcore-Tech-Howto: Quasi jeden Uralt-Kamerastream in UniFi Protect nutzbar machen](https://meintechblog.de/2025/07/18/hardcore-tech-howto-quasi-jeden-uralt-kamerastream-in-unifi-protect-nutzbar-machen-nerdalarm/)** — Original Mobotix → go2rtc → ONVIF → UniFi Protect pipeline
- **[Howto: Loxone Intercom Videofeed in UniFi Protect einbinden](https://meintechblog.de/2025/10/07/howto-loxone-intercom-videofeed-in-unifi-protect-einbinden/)** — Loxone Intercom integration with nginx auth-proxy and ONVIF server setup
- **[Florian Rhomberg: Third-party camera integration](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/)** — General integration walkthrough

### What IP-Cam-Master Automates

| Manual (Blog) | IP-Cam-Master |
|---------------|---------------|
| Scan network manually for cameras | Auto-discovery with type detection |
| Remember and type credentials | Credential presets, auto-matched |
| SSH into Proxmox, create LXC | One click via Proxmox API + SSH |
| Install go2rtc, ffmpeg, Node.js | Automated in onboarding |
| Write go2rtc YAML config by hand | Generated from wizard inputs |
| Clone onvif-server, edit config | Auto-generated with MAC, UUID, stream mapping |
| Edit onvif-server.js for naming | Auto-patched (Manufacturer, Model, ONVIF name) |
| Check stream with separate tools | Live snapshot + service status dashboard |
| No overview of camera health | Dashboard with FPS, codec, model, UniFi connection |

## License

MIT
