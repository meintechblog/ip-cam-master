# Architecture Research

**Domain:** IP camera orchestration platform (Proxmox + go2rtc + UniFi Protect)
**Researched:** 2026-03-22
**Confidence:** HIGH

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  App VM (192.168.3.233)                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Web Application                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ Dashboard│  │ Camera   │  │ Settings │  │ Network      │  │  │
│  │  │ UI       │  │ Wizard   │  │ UI       │  │ Scanner UI   │  │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │  │
│  │       └──────────────┴────────────┴────────────────┘          │  │
│  │                          │ REST API                           │  │
│  │  ┌───────────────────────┴───────────────────────────────┐    │  │
│  │  │                   Backend Server                       │    │  │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐   │    │  │
│  │  │  │ Proxmox     │  │ Camera       │  │ Network     │   │    │  │
│  │  │  │ Service     │  │ Pipeline Svc │  │ Scanner Svc │   │    │  │
│  │  │  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘   │    │  │
│  │  │  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴──────┐   │    │  │
│  │  │  │ UniFi       │  │ Config       │  │ Status      │   │    │  │
│  │  │  │ Protect Svc │  │ Store        │  │ Monitor Svc │   │    │  │
│  │  │  └─────────────┘  └──────────────┘  └─────────────┘   │    │  │
│  │  └────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                       │
         │ Proxmox API       │ SSH (UDM)             │ Network scan
         ▼                    ▼                       ▼
┌──────────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│ Proxmox Host     │  │ UniFi Dream  │  │ Camera Network           │
│ (192.168.3.16)   │  │ Machine      │  │ (192.168.3.x)            │
│                  │  │ (192.168.3.1)│  │                          │
│ ┌──────────────┐ │  │  UniFi       │  │ ┌────────┐ ┌──────────┐ │
│ │ LXC: cam-22  │ │  │  Protect     │  │ │Mobotix │ │Loxone    │ │
│ │ go2rtc       │─┼──┼─ RTSP adopt ─┤  │ │cameras │ │Intercom  │ │
│ │ (VAAPI)      │ │  │              │  │ └────────┘ └──────────┘ │
│ ├──────────────┤ │  └──────────────┘  └──────────────────────────┘
│ │ LXC: cam-13  │ │         ▲
│ │ nginx+go2rtc │─┼─────────┘
│ │ (VAAPI)      │ │
│ └──────────────┘ │
└──────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Dashboard UI** | Show all managed cameras, status, health | SPA frontend (status cards, logs) |
| **Camera Wizard** | Step-by-step onboarding flow for new cameras | Multi-step form (detect -> configure -> provision -> adopt) |
| **Settings UI** | Proxmox host config, UniFi credentials, global prefs | Form-based config pages |
| **Network Scanner UI** | Display discovered devices, trigger scans | Device list with type badges |
| **Proxmox Service** | Create/start/stop/destroy LXC containers, configure device passthrough | REST client to Proxmox API (`/nodes/{node}/lxc`) |
| **Camera Pipeline Service** | Orchestrate end-to-end camera setup (LXC + go2rtc + nginx + adoption) | Workflow engine coordinating other services |
| **Network Scanner Service** | Discover cameras on local network by type | ARP scan + port probing (554, 80, 443) + ONVIF WS-Discovery |
| **UniFi Protect Service** | Monitor adopted camera status, trigger adoption | SSH to UDM or UniFi Protect API |
| **Config Store** | Persist camera configs, credentials, host settings | Local JSON/SQLite on app VM filesystem |
| **Status Monitor Service** | Poll LXC containers and go2rtc instances for health | Periodic HTTP checks to go2rtc API + Proxmox container status |

## Recommended Project Structure

```
ip-cam-master/
├── frontend/                  # Web UI (SPA)
│   ├── src/
│   │   ├── pages/             # Dashboard, Cameras, Settings, Scanner
│   │   ├── components/        # Shared UI components
│   │   ├── api/               # API client (typed fetch wrappers)
│   │   └── stores/            # Client state
│   └── index.html
├── backend/                   # API server
│   ├── src/
│   │   ├── routes/            # HTTP route handlers
│   │   ├── services/          # Business logic
│   │   │   ├── proxmox.ts     # Proxmox API client
│   │   │   ├── camera-pipeline.ts  # Orchestration logic
│   │   │   ├── go2rtc.ts      # go2rtc config generation + API
│   │   │   ├── nginx.ts       # nginx config generation
│   │   │   ├── scanner.ts     # Network discovery
│   │   │   ├── unifi.ts       # UniFi Protect integration
│   │   │   └── monitor.ts     # Health checking
│   │   ├── config/            # App configuration management
│   │   ├── templates/         # go2rtc.yaml + nginx.conf templates
│   │   └── db/                # Data persistence layer
│   └── index.ts
├── templates/                 # LXC provisioning templates
│   ├── go2rtc.yaml.ejs        # go2rtc config template
│   ├── nginx.conf.ejs         # nginx auth-proxy template
│   └── setup.sh.ejs           # LXC post-create setup script
├── installer/                 # One-line install script
│   └── install.sh
├── docker-compose.yml         # Dev environment (optional)
└── package.json
```

### Structure Rationale

- **frontend/ + backend/ monorepo:** Single repo, two clear concerns. The app is simple enough that microservices would be overengineering. Backend serves frontend as static files in production.
- **services/ pattern:** Each external system (Proxmox, go2rtc, UniFi, network) gets its own service module. The Camera Pipeline Service orchestrates them. This keeps integration logic isolated and testable.
- **templates/:** Config files (go2rtc.yaml, nginx.conf) are generated from templates with camera-specific values injected. This is the core of what the app automates.

## Architectural Patterns

### Pattern 1: Pipeline Orchestrator

**What:** The Camera Pipeline Service coordinates a multi-step provisioning workflow: (1) create LXC, (2) install services, (3) write configs, (4) start services, (5) verify stream, (6) trigger adoption. Each step is independently retriable.

**When to use:** Every camera onboarding.

**Trade-offs:** Simple sequential execution is easy to debug but means partial failures leave orphaned resources. Each step should be idempotent and the pipeline should track state so it can resume or rollback.

**Example:**
```typescript
// Camera pipeline steps — each is idempotent
const pipeline = [
  { name: 'create-lxc',     exec: createLxcContainer,   rollback: destroyLxcContainer },
  { name: 'install-go2rtc', exec: installGo2rtc,         rollback: null },
  { name: 'configure',      exec: writeConfigs,          rollback: null },
  { name: 'passthrough-gpu',exec: configureVaapi,        rollback: null },
  { name: 'start-services', exec: startServices,         rollback: stopServices },
  { name: 'verify-stream',  exec: verifyRtspStream,      rollback: null },
  { name: 'adopt-protect',  exec: triggerUnifiAdoption,  rollback: null },
];
```

### Pattern 2: Config-as-Template

**What:** go2rtc.yaml and nginx.conf files are generated from templates with camera-specific variables (IP, credentials, resolution, port assignments). The app never edits config files in place -- it regenerates them entirely.

**When to use:** Any time a camera is added, modified, or removed.

**Trade-offs:** Full regeneration is simpler and safer than partial edits. Downside: requires a go2rtc restart (which go2rtc supports via POST /api/restart or simply restarting the process).

**Example go2rtc template:**
```yaml
# Generated by ip-cam-master — do not edit manually
streams:
  <%= cameraName %>:
    - <%= streamSource %>

rtsp:
  listen: ":8554"
  default_query: "video&audio"
  username: "admin"
  password: "<%= rtspPassword %>"

api:
  listen: ":1984"

ffmpeg:
  bin: "ffmpeg"
```

### Pattern 3: Health Polling with Tiered Checks

**What:** The Status Monitor polls each managed camera at three levels: (1) Proxmox container status (running/stopped), (2) go2rtc API reachable (HTTP GET to port 1984), (3) RTSP stream producing frames. Each tier gives progressively deeper health insight.

**When to use:** Dashboard display, alerting on failures.

**Trade-offs:** Polling is simple but adds network load. For 4-10 cameras this is negligible. A 30-second poll interval is sufficient.

## Data Flow

### Camera Onboarding Flow

```
User clicks "Add Camera" in UI
    │
    ▼
Frontend ──POST /api/cameras/provision──▶ Backend
    │
    ▼
Camera Pipeline Service:
    │
    ├─1─▶ Proxmox Service
    │       POST https://192.168.3.16:8006/api2/json/nodes/proxi3/lxc
    │       (create container with CT ID, network config, /dev/dri passthrough)
    │
    ├─2─▶ Proxmox Service (exec in container)
    │       Install go2rtc binary + nginx (if Loxone)
    │
    ├─3─▶ Config Generator
    │       Render go2rtc.yaml from template (stream source, ffmpeg transcode line)
    │       Render nginx.conf if Loxone (auth-proxy config)
    │       Upload configs to LXC via Proxmox exec API
    │
    ├─4─▶ Proxmox Service
    │       Configure /dev/dri passthrough in LXC conf
    │       Start container + services
    │
    ├─5─▶ go2rtc Health Check
    │       GET http://<lxc-ip>:1984/api/streams (verify stream is live)
    │
    └─6─▶ UniFi Protect Service
            Provide user instructions for RTSP adoption:
            "Add camera in Protect: rtsp://admin:pass@<lxc-ip>:8554/<stream>"
    │
    ▼
Frontend receives status updates ◀── Backend (pipeline progress events)
```

### Mobotix Camera Data Flow (steady state)

```
Mobotix Camera (192.168.3.22)
    │ RTSP/MJPEG (port 554)
    ▼
LXC Container (e.g., 192.168.3.x)
    │
    ├── go2rtc receives MJPEG stream
    │   ffmpeg transcode: MJPEG → H.264 (VAAPI hw accel via /dev/dri)
    │   Serves RTSP on :8554
    │
    ▼
UniFi Protect (192.168.3.1)
    │ Pulls RTSP from go2rtc
    │ Records, displays in Protect UI/app
    ▼
End User views in UniFi Protect app
```

### Loxone Intercom Data Flow (steady state)

```
Loxone Intercom (192.168.3.13)
    │ MJPEG over HTTP (requires auth header)
    ▼
LXC Container (e.g., 192.168.3.x)
    │
    ├── nginx reverse proxy
    │   Injects auth credentials into request
    │   Strips auth requirement for downstream
    │   Proxies: http://<intercom-ip>/mjpg/video.mjpg → http://localhost:8080/stream
    │
    ├── go2rtc receives unauthenticated MJPEG from nginx
    │   ffmpeg transcode: MJPEG → H.264 (VAAPI)
    │   Serves RTSP on :8554
    │
    ▼
UniFi Protect (192.168.3.1)
    │ Pulls RTSP from go2rtc
    ▼
End User views in UniFi Protect app
```

### Network Scanner Flow

```
User clicks "Scan Network" in UI
    │
    ▼
Frontend ──POST /api/scanner/scan──▶ Backend
    │
    ▼
Network Scanner Service:
    │
    ├── ARP scan 192.168.3.0/24 (discover live hosts)
    │
    ├── Port probe each host:
    │   ├── Port 554 (RTSP) → likely camera
    │   ├── Port 80/443 (HTTP) → check for camera web UI
    │   └── WS-Discovery multicast → ONVIF devices
    │
    ├── Fingerprint known types:
    │   ├── HTTP banner / page content → Mobotix, Loxone, etc.
    │   └── ONVIF GetDeviceInformation → manufacturer, model
    │
    └── Return device list with type classification:
        ├── ONVIF-capable (display only, no workflow needed)
        ├── Mobotix non-ONVIF (needs go2rtc pipeline)
        ├── Loxone Intercom (needs nginx + go2rtc pipeline)
        └── Unknown (show IP, let user classify)
```

### Status Monitoring Flow

```
Every 30 seconds:
    │
    Status Monitor Service:
    │
    ├── For each managed camera:
    │   ├── GET Proxmox API: /nodes/proxi3/lxc/{vmid}/status/current
    │   │   → container running/stopped
    │   │
    │   ├── GET http://<lxc-ip>:1984/api/streams
    │   │   → go2rtc responding, stream info
    │   │
    │   └── (Optional) Probe RTSP :8554
    │       → stream producing frames
    │
    └── Update camera status in Config Store
        → Dashboard reflects current state
```

## Integration Points

### External Services

| Service | Protocol | Auth Method | Key Endpoints | Gotchas |
|---------|----------|-------------|---------------|---------|
| **Proxmox VE API** | HTTPS (port 8006) | API Token (header: `Authorization: PVEAPIToken=user@realm!tokenid=secret`) | `POST /nodes/{node}/lxc` (create), `POST /nodes/{node}/lxc/{vmid}/status/start` (start), `GET /nodes/{node}/lxc/{vmid}/status/current` (status) | Bind mounts require `root@pam` user (not API tokens). Device passthrough (`/dev/dri`) needs manual LXC conf editing via Proxmox 8.2+ `dev0:` syntax or direct conf file manipulation. |
| **go2rtc API** | HTTP (port 1984) | Optional basic auth | `GET /api/streams` (list), `GET /api/config` (read config), `POST /api/config` (write config + restart), `POST /api/restart` | Config write triggers automatic restart. Port 8554 for RTSP output. |
| **UniFi Protect** | HTTPS / SSH | Local account or Ubiquiti cloud account | Manual adoption via Protect UI ("Add Device Manually" with RTSP URL). No official public API for programmatic adoption. | Adoption is semi-manual: user must enter RTSP URL in Protect UI. The app can only prepare the stream and provide copy-paste instructions. The `hjdhjd/unifi-protect` library provides unofficial API access for monitoring but adoption is not reliably automatable. |
| **nginx (in LXC)** | Config file | N/A | Runs as reverse proxy inside LXC, managed via config generation | Used only for Loxone Intercom auth-proxy pattern. Config is generated and uploaded by the app. |
| **Cameras (Mobotix)** | RTSP (port 554) | Basic auth in URL | `rtsp://user:pass@ip:554/stream0/mobotix.mjpeg` | Credentials vary per camera. MJPEG source requires ffmpeg transcode to H.264 for Protect. |
| **Cameras (Loxone)** | HTTP (port 80) | Token/basic auth header | `http://ip/mjpg/video.mjpg` | Auth cannot be embedded in URL (unlike RTSP). Requires nginx proxy to inject auth header. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend <-> Backend | REST API (JSON) | Single backend serves API + static frontend files |
| Backend <-> Proxmox | HTTPS REST API | API token auth, async operations return UPID (task ID) for polling |
| Backend <-> LXC containers | Via Proxmox exec API or direct SSH | Config upload, service management |
| Backend <-> go2rtc (in LXC) | HTTP API on port 1984 | Health checks, config read |
| Backend <-> Network | ARP scan, TCP port probe | Requires appropriate network permissions (raw sockets for ARP) |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 cameras | Current design. Single app VM, one LXC per camera. No issues. |
| 5-20 cameras | Still fine. Monitor Proxmox host resource usage (RAM ~128MB per LXC, CPU for VAAPI transcode). Stagger health poll intervals. |
| 20-50 cameras | VAAPI encoder has concurrent session limits (Intel iGPU: typically 8-16 simultaneous encodes). May need to batch cameras or use software fallback. Consider a second Proxmox node. |
| 50+ cameras | Out of scope per PROJECT.md (single Proxmox host). Would need multi-host orchestration. |

### Scaling Priorities

1. **First bottleneck: VAAPI encoder sessions.** Intel iGPUs have a hardware limit on concurrent encode sessions. For a typical Intel consumer CPU, this is around 8-16 sessions. Each camera uses one session. Monitor with `vainfo` and plan for software ffmpeg fallback.
2. **Second bottleneck: Proxmox host RAM.** Each LXC uses ~128-256MB. At 20 cameras that is 2.5-5GB just for containers. Ensure the host has sufficient memory.

## Anti-Patterns

### Anti-Pattern 1: Shared LXC for Multiple Cameras

**What people do:** Run one go2rtc instance with all camera streams to reduce container overhead.
**Why it's wrong:** One camera crash or misconfiguration takes down all streams. Updates require restarting all cameras. Debugging becomes harder. Resource accounting per camera is lost.
**Do this instead:** One LXC per camera (as designed). The overhead is minimal (~128MB RAM each) and isolation benefits are substantial.

### Anti-Pattern 2: Editing go2rtc Config In-Place

**What people do:** SSH into the LXC, manually edit go2rtc.yaml, restart the service.
**Why it's wrong:** Creates drift between what the app thinks the config is and what is actually running. Makes the dashboard unreliable and the "single source of truth" principle is lost.
**Do this instead:** Always generate configs from templates. The app owns all configuration. Manual edits are overwritten on next update.

### Anti-Pattern 3: Storing Secrets in the Database/Config Files Alongside Code

**What people do:** Put camera credentials and Proxmox API tokens in a config.json that gets committed or is world-readable.
**Why it's wrong:** Public GitHub repo. Anyone cloning gets credentials.
**Do this instead:** Secrets in a separate local-only file (e.g., `/etc/ip-cam-master/secrets.json`) excluded from git. Environment variables for Proxmox API token. Never log credentials.

### Anti-Pattern 4: Polling UniFi Protect for Adoption Status

**What people do:** Try to automate the adoption check by continuously hitting UniFi Protect APIs.
**Why it's wrong:** UniFi Protect has no stable public API. The unofficial API changes between firmware versions. Building automation on it creates fragile integrations that break on UDM updates.
**Do this instead:** Treat adoption as a manual step. The app prepares everything and shows the user clear instructions ("Go to Protect > Add Device Manually > Enter this RTSP URL"). Optionally, offer a "verify" button that checks if the go2rtc RTSP stream has active consumers (meaning Protect connected).

## Build Order (Dependency Chain)

The architecture implies the following build order based on component dependencies:

```
Phase 1: Foundation
├── Backend server skeleton (Express/Fastify + basic API routes)
├── Config Store (persistence layer for cameras, settings)
├── Proxmox Service (API client: auth, create/list/delete LXC, exec)
└── Frontend shell (dashboard page, settings page)

Phase 2: Camera Pipeline
├── Config Templates (go2rtc.yaml, nginx.conf generation)
├── Camera Pipeline Service (orchestrate: create LXC → install → configure → start)
├── Mobotix workflow (go2rtc only, no nginx)
└── Manual adoption instructions in UI

Phase 3: Loxone + Network
├── Loxone Intercom workflow (nginx auth-proxy + go2rtc)
├── Network Scanner Service (ARP + port scan + fingerprinting)
└── Scanner UI (discovered devices list)

Phase 4: Monitoring + Polish
├── Status Monitor Service (health polling)
├── Dashboard live status (online/offline/error per camera)
├── VAAPI hardware acceleration configuration
└── One-line installer script

Phase 5: Hardening
├── Error handling + rollback in pipeline
├── Credential security audit
├── UniFi Protect status verification
└── Documentation for end users
```

**Build order rationale:**
- Proxmox Service is the foundation -- everything depends on creating and managing LXC containers.
- Mobotix workflow before Loxone because it is simpler (no nginx layer) and validates the core pipeline.
- Network scanner is independent of provisioning and can be built in parallel, but is not needed for manual camera setup.
- Monitoring is a read-only concern that layers on top of working provisioning.
- The installer is last because the app must work before it can be packaged.

## Key Architecture Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **LXC management** | Proxmox REST API with API token auth | Well-documented, stable. Use `PVEAPIToken` header. Avoid password-based tickets (they expire). |
| **Config delivery to LXC** | Generate on backend, upload via Proxmox exec API or SCP | Simpler than running an agent inside each LXC. The LXC is a "dumb" runtime. |
| **UniFi adoption** | Semi-manual (app provides instructions) | No stable API exists. Automating via unofficial API would be fragile. |
| **go2rtc health check** | HTTP GET to port 1984 `/api/streams` | Built-in, no extra tooling needed. Returns stream status as JSON. |
| **VAAPI passthrough** | Proxmox 8.2+ `dev0: /dev/dri/renderD128` in LXC conf | Modern Proxmox supports this natively. Older versions need manual cgroup rules. |
| **Network scanning** | ARP scan + targeted port probe (554, 80) + ONVIF WS-Discovery | Lightweight, no dependencies beyond standard network tools. ONVIF probe finds compliant cameras; port scan finds the rest. |

## Sources

- [Proxmox VE API Documentation](https://pve.proxmox.com/wiki/Proxmox_VE_API) - REST API reference (HIGH confidence)
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) - Configuration, API, supported protocols (HIGH confidence)
- [Proxmox LXC Documentation](https://pve.proxmox.com/wiki/Linux_Container) - Container management (HIGH confidence)
- [UniFi Protect Third-Party Cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) - Official adoption docs (HIGH confidence)
- [unifi-cam-proxy](https://github.com/keshavdv/unifi-cam-proxy) - Third-party camera adoption approach (MEDIUM confidence)
- [hjdhjd/unifi-protect](https://github.com/hjdhjd/unifi-protect) - Unofficial Protect API (MEDIUM confidence)
- [Proxmox LXC iGPU Passthrough Tutorial](https://forum.proxmox.com/threads/proxmox-lxc-igpu-passthrough.141381/) - VAAPI device passthrough (MEDIUM confidence)
- [LoxWiki - Loxone Intercom + UniFi Protect via go2rtc](https://loxwiki.atlassian.net/wiki/spaces/LOXEN/pages/2517499917/) - Reference architecture for Loxone pipeline (MEDIUM confidence)
- [npm onvif package](https://www.npmjs.com/package/onvif) - Node.js ONVIF discovery (MEDIUM confidence)

---
*Architecture research for: IP camera orchestration platform*
*Researched: 2026-03-22*
