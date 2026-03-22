# IP-Cam-Master

One-click camera onboarding for UniFi Protect. Discover a camera, and the app handles everything — container creation, stream transcoding, ONVIF wrapping, and Protect adoption.

Built for self-hosters who want to integrate non-ONVIF cameras (Mobotix, Loxone Intercom) into UniFi Protect without manual setup.

## How It Works

### The Problem

Cameras like Mobotix (MJPEG only, no ONVIF) or Loxone Intercoms can't be adopted into UniFi Protect directly. The manual process involves creating LXC containers, installing go2rtc, configuring ffmpeg transcoding, setting up an ONVIF server, and finally adopting — for each camera individually.

### The Solution

IP-Cam-Master automates the entire pipeline through a 5-step wizard:

```
┌─────────────┐     ┌───────────────────────────────────────────────────────────┐     ┌──────────────┐
│  Mobotix     │     │  LXC Container (Proxmox)                                 │     │  UniFi       │
│  Camera      │     │                                                           │     │  Protect     │
│              │     │  ┌─────────┐    ┌──────────────┐    ┌──────────────────┐  │     │              │
│  MJPEG :554 ─┼────►│  │  go2rtc │───►│  RTSP :8554  │───►│  ONVIF Server   │──┼────►│  Adoption    │
│              │     │  │  VAAPI  │    │  H.264       │    │  :8899           │  │     │  via ONVIF   │
│              │     │  └─────────┘    └──────────────┘    └──────────────────┘  │     │  Discovery   │
└─────────────┘     └───────────────────────────────────────────────────────────┘     └──────────────┘
```

### Onboarding Flow (5 Steps)

1. **Zugangsdaten** — Enter camera IP, credentials, and optional transcode parameters (auto-detected defaults).
2. **Verbindung testen** — App probes the camera's RTSP stream. Shows a live snapshot on success.
3. **Container erstellen** — Creates a Debian 12 LXC container on Proxmox with VAAPI device passthrough (`/dev/dri/renderD128`).
4. **go2rtc + ONVIF konfigurieren** — Installs ffmpeg, go2rtc, Node.js, and the [ONVIF server](https://github.com/daniela-hase/onvif-server). Generates configs, patches device naming, starts systemd services.
5. **Stream verifizieren** — Checks go2rtc API for active stream. Shows RTSP URL and WebRTC live preview. Camera is now discoverable by UniFi Protect via ONVIF.

### What Gets Created Per Camera

Each onboarded camera gets its own isolated LXC container with:

| Service | Port | Purpose |
|---------|------|---------|
| go2rtc | 8554 (RTSP), 1984 (HTTP/WebRTC) | MJPEG → H.264 transcoding via VAAPI |
| ONVIF Server | 8899 | Makes the stream discoverable by UniFi Protect |

**go2rtc** transcodes the camera's MJPEG stream to H.264 using Intel VAAPI hardware acceleration:

```yaml
streams:
  cam-1010: ffmpeg:rtsp://user:pass@192.168.3.22:554/stream0/mobotix.mjpeg#video=h264#width=1280#height=720#raw=-r 20#raw=-maxrate 5000k#raw=-bufsize 10000k#raw=-g 20#hardware=vaapi
```

**ONVIF Server** wraps the transcoded RTSP stream into an ONVIF-compliant device that UniFi Protect can discover and adopt — including proper device naming (no more "Cardinal").

## Tech Stack

- **Frontend:** SvelteKit 2 (Svelte 5 Runes), Tailwind CSS 4, Lucide icons
- **Backend:** SvelteKit server routes, SQLite (better-sqlite3), Drizzle ORM
- **Infrastructure:** Proxmox VE API, SSH via node-ssh, go2rtc, daniela-hase/onvif-server
- **Security:** AES-256-GCM encryption for all stored credentials
- **Runtime:** Node.js 22 LTS

## Infrastructure

| Component | IP | Role |
|-----------|-----|------|
| Proxmox Host (prox3) | 192.168.3.16 | Runs LXC containers for each camera |
| App VM (ip-cam-master) | 192.168.3.233 | Hosts the IP-Cam-Master web app |
| UniFi Dream Machine | 192.168.3.1 | Runs UniFi Protect |

## Prerequisites

- Proxmox VE with API token (`root@pam`, privilege separation disabled)
- SSH key-based access from the app VM to the Proxmox host (`ssh-copy-id root@<proxmox-host>`)
- Intel GPU on Proxmox host for VAAPI hardware transcoding (`/dev/dri/renderD128`)
- Debian 12 LXC template: `pveam download local debian-12-standard_12.12-1_amd64.tar.zst`

## Quick Start

```bash
# On the app VM
git clone https://github.com/meintechblog/ip-cam-master.git
cd ip-cam-master
npm install
cp .env.example .env  # Set DB_ENCRYPTION_KEY (min 32 characters)
npx drizzle-kit push   # Create SQLite tables
npm run dev -- --host 0.0.0.0
```

1. Open `http://<vm-ip>:5173`
2. Go to **Settings** → Configure Proxmox connection (host, API token)
3. Go to **Kameras** → **+ Kamera hinzufuegen**
4. Follow the 5-step wizard
5. Camera appears in UniFi Protect via ONVIF discovery

## Background & References

This project automates the manual processes described in these blog posts on [meintechblog.de](https://meintechblog.de):

- **[Hardcore-Tech-Howto: Quasi jeden Uralt-Kamerastream in UniFi Protect nutzbar machen (NERDALARM!)](https://meintechblog.de/2025/07/18/hardcore-tech-howto-quasi-jeden-uralt-kamerastream-in-unifi-protect-nutzbar-machen-nerdalarm/)** — Original Mobotix → go2rtc → Frigate → ONVIF → UniFi Protect pipeline. Describes the per-camera LXC setup, VAAPI transcoding, and ONVIF server configuration that IP-Cam-Master now automates.

- **[Howto: Loxone Intercom Videofeed in UniFi Protect einbinden](https://meintechblog.de/2025/10/07/howto-loxone-intercom-videofeed-in-unifi-protect-einbinden/)** — Loxone Intercom integration with nginx auth-proxy, go2rtc transcoding, and the ONVIF server setup including the "Cardinal" → camera name patching and full systemd service configuration.

Additional reference:
- **[Florian Rhomberg: How to integrate a third-party camera into UniFi Protect](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/)** — General third-party camera integration walkthrough

### Key Differences from Blog Posts

| Manual (Blog) | IP-Cam-Master |
|---------------|---------------|
| SSH into Proxmox, manually create LXC | One click — app calls Proxmox API + SSH |
| Manually install go2rtc, ffmpeg, Node.js | Automated in onboarding step 4 |
| Hand-write go2rtc YAML config | Generated from wizard form inputs |
| Clone onvif-server, edit config.yaml manually | Auto-generated with correct MAC, UUID, stream mapping |
| Manually edit onvif-server.js to fix "Cardinal" name | Auto-patched with `sed` during onboarding |
| Check stream with separate tools | Built-in WebRTC preview + go2rtc API health check |
| One container at a time | Wizard handles any number of cameras |

## License

MIT
