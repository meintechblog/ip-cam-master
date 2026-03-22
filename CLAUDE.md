## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: tailwindcss, drizzle, vitest

---

<!-- GSD:project-start source:PROJECT.md -->
## Project

**IP-Cam-Master**

A modular web application that orchestrates IP camera integration into UniFi Protect. It manages the full lifecycle: discovering cameras in the network, provisioning LXC containers on Proxmox with the necessary transcoding services (go2rtc, nginx), and adopting the resulting streams into UniFi Protect — all through a single web interface. Built for self-hosters who want to integrate non-ONVIF cameras (Mobotix, Loxone Intercom) into UniFi Protect without manual setup.

**Core Value:** One-click camera onboarding: discover a camera in the network, and the app handles everything needed to get its stream into UniFi Protect — container creation, service configuration, stream adoption.

### Constraints

- **Security**: Camera credentials and host SSH keys must NEVER be committed to the public GitHub repo
- **Platform**: Runs on Proxmox VE as a VM, manages LXC containers on the same host
- **Network**: All components on the same local network (192.168.3.x)
- **Hardware Accel**: VAAPI on Intel — requires `/dev/dri` passthrough to LXC containers
- **Compatibility**: Must support Proxmox VE LXC container management API
- **Distribution**: Public GitHub repo (meintechblog/ip-cam-master), one-line install for anyone
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Framework
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| SvelteKit | 2.55+ (Svelte 5) | Full-stack web framework | Ships 50-70% less JS than React. Perfect for small-team dashboard tools. SSR + SPA hybrid. Single codebase for frontend and API routes. No separate backend server needed -- SvelteKit's server routes handle API logic directly. | HIGH |
| Node.js | 22 LTS | Runtime | LTS with best library ecosystem for Proxmox/UniFi/SSH tooling. Svelte 5 runes provide clean reactivity for real-time camera status. | HIGH |
| TypeScript | 5.x | Language | Type safety for complex infrastructure API interactions (Proxmox, UniFi, go2rtc). SvelteKit has first-class TS support. | HIGH |
- **vs Next.js:** Next.js is overkill for a self-hosted infrastructure tool. React ecosystem overhead, Vercel-centric defaults, larger bundles. SvelteKit is purpose-built for this scale.
- **vs plain Express + separate frontend:** SvelteKit gives you API routes (`+server.ts`) alongside pages. One deployment artifact, one process. Perfect for a self-hosted VM.
- **vs Go/Python backend:** The Proxmox API has a TypeScript client (`proxmox-api`), UniFi Protect has a mature Node.js library (`unifi-protect`), SSH has `ssh2`/`node-ssh`. The Node.js ecosystem has the best coverage for all three integration points. Go and Python lack coverage in at least one area.
### Database
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| SQLite via better-sqlite3 | 12.8+ | Persistent storage | Zero-dependency embedded database. No separate DB server to install/maintain -- critical for one-line installer. Synchronous API is simpler for config management. Stores camera configs, container mappings, credentials (encrypted). | HIGH |
| Drizzle ORM | 0.45+ | Schema management & queries | Type-safe SQL. Lightweight (no heavy abstraction). Native SQLite support with better-sqlite3 driver. Schema-as-code with migrations via drizzle-kit. | MEDIUM |
- Self-hosted tool on a single VM. No concurrent write pressure. Database is config + status, not high-volume data.
- One-line installer cannot assume PostgreSQL is available. SQLite is a file -- back it up with `cp`.
- `better-sqlite3` over Node.js native `node:sqlite`: Native module is still experimental (no extensions, limited API). `better-sqlite3` is battle-tested with 4800+ dependents.
- Drizzle is SQL-first and lightweight. Prisma requires a binary engine, complicates installation, and is heavier than needed for an embedded SQLite use case.
### Infrastructure Integration
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| proxmox-api | 1.1.1 | Proxmox VE API client | TypeScript-native, maps 100% of Proxmox API surface. Creates/starts/stops LXC containers, manages storage. Typed API viewer auto-generated from Proxmox schema. | MEDIUM |
| node-ssh | 2.0+ | SSH command execution | Promise-based wrapper over ssh2. Used for: executing commands inside LXC containers, deploying go2rtc configs, managing services via systemctl. Simpler API than raw ssh2. | HIGH |
| ssh2 | 1.16+ | SSH transport (dependency of node-ssh) | Pure JS SSH2 implementation. Battle-tested. node-ssh provides the ergonomic layer on top. | HIGH |
### Camera & Streaming
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| go2rtc | latest (managed binary) | Stream transcoding | Runs inside each LXC container. MJPEG-to-H.264 transcoding via ffmpeg. VAAPI hardware acceleration. Exposes RTSP on :8554 for UniFi Protect adoption. App generates YAML config files, does not embed go2rtc. | HIGH |
| unifi-protect | 4.27+ | UniFi Protect API client | Only complete Node.js implementation of the UniFi Protect API. Provides camera status, adoption monitoring, real-time event updates via WebSocket. Actively maintained (published 19 days ago). | HIGH |
- The app does NOT run go2rtc itself. It generates `go2rtc.yaml` config files and deploys them to LXC containers via SSH.
- go2rtc has an HTTP API at `:1984` for health checks and stream status (GET `/api/streams`).
- Streams can be added dynamically via PUT `/api/streams?src=...&name=...` but the YAML config approach is more reliable for persistence across container restarts.
- VAAPI config template: `-init_hw_device vaapi=intel:/dev/dri/renderD128 -filter_hw_device intel -c:v h264_vaapi`
- UniFi Protect 5.0+ natively supports ONVIF third-party cameras (no proxy needed for ONVIF-capable cameras).
- For non-ONVIF cameras (Mobotix without ONVIF, Loxone Intercom): go2rtc transcodes to RTSP, and adoption happens via the standard Protect RTSP adoption flow or `unifi-cam-proxy` if needed.
- The `unifi-protect` npm library monitors adoption status and camera health, not the adoption itself.
### Network Discovery
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-onvif | (or onvif npm) | ONVIF camera discovery | WS-Discovery probe for ONVIF devices on local subnet. Identifies cameras that already support ONVIF (display-only in the app). ~3 second scan. | MEDIUM |
| Custom ARP/ping scanner | N/A | Non-ONVIF device discovery | For Mobotix/Loxone that don't announce via ONVIF. Scan 192.168.3.x subnet, probe known ports (554 for RTSP, 80/443 for HTTP). Identify by MAC OUI (Mobotix: 00:03:C5, Loxone: 50:4F:94). | MEDIUM |
| nmap (system binary) | 7.x | Deep network scan fallback | Optional: call nmap via child_process for comprehensive port scanning. Requires nmap installed on the VM. Used as fallback when ARP scan isn't sufficient. | LOW |
### Frontend UI
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tailwind CSS | 4.x | Utility-first styling | Fast prototyping, consistent design. No component library lock-in. Works perfectly with SvelteKit. | HIGH |
| Lucide Svelte | latest | Icons | Lightweight, tree-shakeable icon set. Camera, network, server icons available. | HIGH |
| bits-ui | latest | Headless UI primitives | Accessible, unstyled components (modals, dropdowns, tabs). Style with Tailwind. Svelte-native. | MEDIUM |
- This is an infrastructure tool, not a SaaS product. Clean, functional UI > polished design system.
- Tailwind + bits-ui gives maximum control with minimum dependencies.
- shadcn-svelte is acceptable if more pre-built components are needed later -- it's Tailwind-based and tree-shakeable.
### Security
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js crypto (built-in) | N/A | Credential encryption | AES-256-GCM for encrypting camera passwords and SSH keys at rest in SQLite. No external dependency needed. | HIGH |
| dotenv | 16.x | Environment config | Load secrets from `.env` file (DB encryption key, Proxmox API tokens). Standard pattern for self-hosted tools. | HIGH |
### Process Management & Deployment
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| systemd | (OS-level) | Process management | The app runs as a systemd service on the VM. Auto-restart, logging via journalctl. Standard for Linux server processes. No PM2 needed. | HIGH |
| Bash installer script | N/A | One-line install | `curl -fsSL https://raw.githubusercontent.com/meintechblog/ip-cam-master/main/install.sh \| bash` -- installs Node.js (via NodeSource), clones repo, runs npm install, creates systemd service, opens firewall port. | HIGH |
- Target is a Proxmox VM (Debian/Ubuntu). systemd is already there.
- PM2 adds a dependency for no benefit on a single-process app.
- Docker adds complexity to a one-line installer on a VM that's already running inside Proxmox. The app manages LXC containers -- adding Docker as another layer of containerization is unnecessary.
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | SvelteKit | Next.js | Overkill for self-hosted tool, heavier bundles, Vercel-oriented defaults |
| Framework | SvelteKit | Express + React SPA | Two deployment artifacts, more boilerplate, no SSR benefits |
| Framework | SvelteKit | Go + htmx | Better raw performance, but poor library coverage for UniFi Protect and Proxmox APIs |
| Database | SQLite (better-sqlite3) | PostgreSQL | Requires separate server, complicates one-line install, overkill for config storage |
| Database | better-sqlite3 | node:sqlite (native) | Still experimental, no extensions, limited API surface |
| ORM | Drizzle | Prisma | Binary engine requirement, heavier, worse SQLite support for embedded use |
| Proxmox Client | proxmox-api (npm) | proxmoxer (Python) | Would require Python runtime alongside Node.js, or a separate service |
| Proxmox Client | proxmox-api (npm) | Direct REST calls | Viable fallback, but loses type safety. Keep as Plan B. |
| UniFi Client | unifi-protect (npm) | uiprotect (Python) | Same language mismatch problem as proxmoxer |
| Deployment | systemd | Docker Compose | Adds container-in-container complexity, harder one-line install |
| Deployment | systemd | PM2 | Extra dependency for no benefit on single-process app |
| CSS | Tailwind | Bootstrap | Heavier, opinionated design language doesn't fit infrastructure tools |
## Full Dependency List
# Core
# Backend / API
# Frontend
# Network discovery
# Dev dependencies
### SvelteKit Adapter
## Architecture Implications
## Version Pinning Strategy
## Sources
- [proxmox-api npm](https://www.npmjs.com/package/proxmox-api) -- TypeScript Proxmox API client, v1.1.1
- [proxmox-api GitHub](https://github.com/UrielCh/proxmox-api) -- Source, TypeScript, auto-generated types
- [unifi-protect npm](https://www.npmjs.com/package/unifi-protect) -- v4.27.7, hjdhjd
- [unifi-protect GitHub](https://github.com/hjdhjd/unifi-protect) -- Complete UniFi Protect API implementation
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) -- Ultimate camera streaming application
- [go2rtc API docs](https://github.com/AlexxIT/go2rtc/blob/master/api/README.md) -- HTTP API reference
- [go2rtc dynamic streams issue](https://github.com/AlexxIT/go2rtc/issues/1592) -- Dynamic add/remove via API
- [unifi-cam-proxy](https://github.com/keshavdv/unifi-cam-proxy) -- Third-party camera adoption into Protect
- [UniFi Protect Third-Party Cameras](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) -- Native ONVIF support in Protect 5.0
- [Florian Rhomberg guide](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) -- Third-party camera integration walkthrough
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0, fastest SQLite for Node.js
- [Drizzle ORM](https://orm.drizzle.team/) -- Type-safe ORM, v0.45.1
- [SvelteKit npm](https://www.npmjs.com/package/@sveltejs/kit) -- v2.55.0
- [Svelte 5 announcement](https://svelte.dev/blog) -- Runes-based reactivity
- [node-ssh npm](https://www.npmjs.com/package/node-ssh) -- Promise-based SSH
- [ssh2 GitHub](https://github.com/mscdex/ssh2) -- Pure JS SSH2 implementation
- [onvif npm](https://www.npmjs.com/package/onvif) -- ONVIF WS-Discovery for Node.js
- [Node.js native SQLite status](https://nodejs.org/api/sqlite.html) -- Still experimental in Node 22
- [Proxmox VE API docs](https://pve.proxmox.com/wiki/Proxmox_VE_API) -- REST API reference
- [Proxmox LXC creation via API](https://forum.proxmox.com/threads/create-lxc-container-via-curl-api-bad-request-400.27321/) -- POST /nodes/{node}/lxc
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
