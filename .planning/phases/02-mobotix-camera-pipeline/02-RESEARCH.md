# Phase 2: Mobotix Camera Pipeline - Research

**Researched:** 2026-03-22
**Domain:** Mobotix MJPEG-to-H.264 transcoding pipeline via go2rtc in Proxmox LXC containers, with SSH provisioning and SvelteKit wizard UI
**Confidence:** HIGH

## Summary

Phase 2 implements the core value proposition: end-to-end Mobotix camera onboarding. The user enters camera credentials in a 5-step wizard, the app tests the MJPEG connection, creates a Proxmox LXC container (reusing Phase 1 infrastructure), installs go2rtc + ffmpeg via SSH, deploys a generated YAML config for VAAPI hardware transcoding, and verifies the resulting H.264 RTSP stream with a WebRTC live preview.

The technical domains are well-understood. Phase 1 already provides the Proxmox client, container creation with VAAPI passthrough, settings/credentials storage, and the Kameras page. Phase 2 adds three new server-side services (SSH, go2rtc config generation, stream verification), extends the DB schema for transcode parameters, and builds a multi-step onboarding wizard. The go2rtc binary is mature (v1.9.10+, latest release January 2026), its HTTP API is straightforward, and its built-in `stream.html` page provides a ready-made WebRTC/MSE player embeddable via iframe.

**Primary recommendation:** Build three new services (`ssh.ts`, `go2rtc.ts`, `onboarding.ts`), extend the DB schema with a `cameras` table for transcode params, and create a custom stepper wizard component with 5 steps that calls sequential API endpoints. Use go2rtc's built-in `stream.html?src=<name>` as the WebRTC preview via iframe -- do not build a custom WebRTC player.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** "+Kamera hinzufuegen" button on the Kameras page starts the onboarding
- **D-02:** 5-step Stepper/Wizard UI:
  1. Kamera-IP + Credentials + Transcode-Parameter (optional, with smart defaults)
  2. Verbindung testen (RTSP probe, detect native resolution)
  3. Container erstellen (LXC on Proxmox via existing API)
  4. go2rtc konfigurieren (install binary, deploy YAML, start service)
  5. Stream verifizieren (go2rtc API check + WebRTC live preview)
- **D-03:** Progress indicator at top showing all 5 steps
- **D-04:** On error: retry in the same step -- user stays on current step with error message + retry button until it succeeds
- **D-05:** After completion, return to Kameras page where new camera appears in the container grid
- **D-06:** LXC base image: Debian 12 (Bookworm) -- standard Proxmox template
- **D-07:** go2rtc installed via SSH into the container: download latest binary from GitHub releases, no package manager
- **D-08:** go2rtc managed as systemd service inside the container -- auto-restart, journalctl logs
- **D-09:** App generates `go2rtc.yaml` config file and deploys it to the container via SSH (SCP/SFTP)
- **D-10:** ffmpeg also needed in container for VAAPI transcoding -- install via apt
- **D-11:** Transcode parameters shown in Wizard Step 1 as optional fields with smart defaults
- **D-12:** Defaults are camera-dependent: on connection test (Step 2), detect native resolution from RTSP stream and pre-fill resolution/fps
- **D-13:** Fallback defaults if detection fails: 1280x720, 20fps, 5000kbit/s (proven values from blog setup)
- **D-14:** Parameters stored in DB per camera for later editing
- **D-15:** go2rtc YAML template: `ffmpeg:rtsp://<user>:<pw>@<ip>:554/stream0/mobotix.mjpeg#video=h264#width={W}#height={H}#raw=-r {FPS}#raw=-maxrate {BITRATE}#raw=-bufsize {BITRATE*2}#raw=-g {FPS}#hardware=vaapi`
- **D-16:** Verification via go2rtc HTTP API (`:1984/api/streams`) -- check stream is active and codec is H.264
- **D-17:** WebRTC/MSE live preview in the final wizard step -- small player window showing the transcoded stream from go2rtc
- **D-18:** Display stream info: RTSP URL (`rtsp://<container-ip>:8554/cam`), codec, resolution, fps
- **D-19:** This RTSP URL is what gets adopted into UniFi Protect (shown to user, adoption is Phase 4)

### Claude's Discretion
- Wizard component implementation (custom stepper vs bits-ui)
- SSH command sequences and error handling details
- go2rtc binary version pinning strategy
- WebRTC player component choice (go2rtc provides built-in WebRTC endpoint)
- Container naming convention (e.g., `cam-{ip-suffix}` or `mobotix-{vmid}`)
- How transcode parameter editing works post-onboarding (Kamera-Detail-Seite)

### Deferred Ideas (OUT OF SCOPE)
- Auto-Discovery of cameras on the network -- Phase 3
- Post-onboarding parameter editing on a camera detail page -- could be Phase 2 scope if time permits, otherwise later
- UniFi Protect adoption of the RTSP stream -- Phase 4
- Loxone Intercom pipeline (nginx auth-proxy) -- Phase 3
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LXC-03 | App installs and configures go2rtc inside the LXC container | SSH service (node-ssh) executes commands to download go2rtc binary, install ffmpeg, create systemd unit, deploy YAML config |
| G2R-01 | App generates correct go2rtc YAML config for Mobotix cameras (MJPEG->H.264, VAAPI) | go2rtc YAML template with ffmpeg source, `#video=h264#hardware=vaapi` hash params, width/height/fps/bitrate customization |
| G2R-04 | App deploys generated configs to the LXC container and restarts services | SSH putFile for YAML deploy + `systemctl restart go2rtc` via execCommand |
| G2R-05 | User can customize transcode parameters (resolution, fps, bitrate) per camera | New `cameras` DB table with transcode fields, wizard Step 1 form with smart defaults |
| G2R-06 | App validates stream is accessible after config deployment | HTTP fetch to go2rtc API `GET /api/streams` on container IP:1984, check for active producers with H.264 codec |
| ONBD-01 | User can start onboarding flow for a non-ONVIF camera | "+Kamera hinzufuegen" button on Kameras page opens wizard route/modal |
| ONBD-02 | Onboarding flow: enter credentials -> test connection -> create container -> deploy config -> verify stream | 5-step wizard with sequential API calls, each step has retry on error |
| ONBD-03 | Each onboarding step shows clear success/error with retry option | Wizard stays on current step on error, shows InlineAlert with error message + retry button |
| ONBD-04 | After successful stream verification, app provides RTSP URL for UniFi Protect adoption | Step 5 displays `rtsp://<container-ip>:8554/<stream-name>` with copy button |
| ONBD-06 | Mobotix-specific pipeline works end-to-end (MJPEG source -> H.264 RTSP output) | Complete chain: Mobotix MJPEG at `rtsp://<ip>:554/stream0/mobotix.mjpeg` -> go2rtc ffmpeg VAAPI transcode -> RTSP :8554 output |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-ssh | 13.2.1 | SSH command execution + SFTP file transfer | Already in package.json. Promise-based, supports execCommand and putFile/putDirectory. Wraps ssh2. |
| better-sqlite3 | 12.6.2 | Database | Already installed, stores camera and transcode config |
| drizzle-orm | 0.45.1 | Schema management | Already installed, schema-as-code with migrations |
| SvelteKit | 2.50+ | Full-stack framework | Already installed, provides server routes + pages |

### New (phase-specific, no npm install needed)
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| go2rtc | latest (binary) | Stream transcoding in LXC | Downloaded into container via `wget` from GitHub releases. NOT an npm dependency. |
| ffmpeg | apt package | VAAPI hardware encoding | Installed via `apt-get install -y ffmpeg` inside LXC container |

### No New npm Dependencies Required
All npm dependencies for Phase 2 are already in package.json from Phase 1. The `node-ssh` package handles all SSH/SFTP operations. go2rtc and ffmpeg are installed inside LXC containers, not on the app server.

## Architecture Patterns

### New Files Structure
```
src/
├── lib/
│   ├── server/
│   │   └── services/
│   │       ├── ssh.ts              # SSH connection manager (node-ssh wrapper)
│   │       ├── ssh.test.ts         # SSH service tests
│   │       ├── go2rtc.ts           # go2rtc config generation + API health checks
│   │       ├── go2rtc.test.ts      # go2rtc service tests
│   │       ├── onboarding.ts       # Orchestrates the 5-step pipeline
│   │       └── onboarding.test.ts  # Onboarding orchestration tests
│   ├── components/
│   │   └── onboarding/
│   │       ├── OnboardingWizard.svelte    # Main wizard container with stepper
│   │       ├── StepIndicator.svelte       # Progress bar showing 5 steps
│   │       ├── StepCredentials.svelte     # Step 1: IP + credentials + params
│   │       ├── StepTestConnection.svelte  # Step 2: RTSP probe
│   │       ├── StepCreateContainer.svelte # Step 3: LXC creation
│   │       ├── StepConfigureGo2rtc.svelte # Step 4: Install + deploy
│   │       └── StepVerifyStream.svelte    # Step 5: Verify + WebRTC preview
│   └── types.ts                    # Extended with camera/onboarding types
├── routes/
│   ├── kameras/
│   │   ├── +page.svelte            # MODIFIED: add "+Kamera hinzufuegen" button
│   │   └── onboarding/
│   │       └── +page.svelte        # Onboarding wizard page
│   └── api/
│       └── onboarding/
│           ├── test-connection/+server.ts  # Step 2 API
│           ├── create-container/+server.ts # Step 3 API
│           ├── configure-go2rtc/+server.ts # Step 4 API
│           └── verify-stream/+server.ts    # Step 5 API
└── lib/server/db/
    └── schema.ts                   # MODIFIED: add cameras table
```

### Pattern 1: Wizard Step as API Call
**What:** Each wizard step maps to one API endpoint. The frontend calls the endpoint, shows a loading state, and transitions to next step on success or shows an error with retry on failure.
**When to use:** All 5 onboarding steps follow this pattern.
**Example:**
```typescript
// src/routes/api/onboarding/test-connection/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const { ip, username, password } = await request.json();

  try {
    // Probe Mobotix RTSP endpoint
    const streamInfo = await testMobotixConnection(ip, username, password);
    return json({
      success: true,
      resolution: streamInfo.resolution,
      fps: streamInfo.fps
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: message }, { status: 400 });
  }
};
```

### Pattern 2: SSH Service with Connection Reuse
**What:** A service that manages SSH connections to LXC containers, executing command sequences and deploying files. Connections are established per-operation (not pooled) since onboarding is an infrequent operation.
**When to use:** Steps 2 (connection test via Proxmox host), 4 (go2rtc install + config deploy), 5 (health check).
**Example:**
```typescript
// src/lib/server/services/ssh.ts
import { NodeSSH } from 'node-ssh';

export async function executeOnContainer(
  proxmoxHost: string,
  vmid: number,
  commands: string[]
): Promise<{ stdout: string; stderr: string }[]> {
  const ssh = new NodeSSH();
  // Connect to Proxmox host, then use pct exec to run inside container
  await ssh.connect({
    host: proxmoxHost,
    username: 'root',
    privateKey: '/path/to/key' // or password
  });

  const results = [];
  for (const cmd of commands) {
    const result = await ssh.execCommand(`pct exec ${vmid} -- bash -c '${cmd}'`);
    results.push({ stdout: result.stdout, stderr: result.stderr });
    if (result.code !== 0) {
      throw new Error(`Command failed: ${cmd}\n${result.stderr}`);
    }
  }

  ssh.dispose();
  return results;
}
```

### Pattern 3: go2rtc YAML Config Generation
**What:** Generate go2rtc.yaml from camera parameters using a template. The config maps the Mobotix MJPEG source to an H.264 RTSP output via ffmpeg with VAAPI.
**When to use:** Step 4 of onboarding.
**Example:**
```typescript
// src/lib/server/services/go2rtc.ts
export function generateGo2rtcConfig(params: {
  streamName: string;
  cameraIp: string;
  username: string;
  password: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}): string {
  const source = [
    `ffmpeg:rtsp://${params.username}:${params.password}@${params.cameraIp}:554/stream0/mobotix.mjpeg`,
    '#video=h264',
    `#width=${params.width}`,
    `#height=${params.height}`,
    `#raw=-r ${params.fps}`,
    `#raw=-maxrate ${params.bitrate}k`,
    `#raw=-bufsize ${params.bitrate * 2}k`,
    `#raw=-g ${params.fps}`,
    '#hardware=vaapi'
  ].join('');

  return `streams:
  ${params.streamName}: ${source}
`;
}
```

### Pattern 4: Container Access via `pct exec`
**What:** Instead of SSH-ing directly into each LXC container (which requires separate network config and SSH server inside the container), use `pct exec <vmid>` from the Proxmox host. This is the standard Proxmox pattern -- SSH into the PVE host, then `pct exec` to run commands inside any container.
**When to use:** All container provisioning commands.
**Why:** Avoids needing SSH server installed inside each LXC container. Requires only one SSH connection (to the Proxmox host). Works even if the container has no network yet.

**File transfer alternative:** For deploying files (go2rtc.yaml), use `pct push <vmid> <local-path> <container-path>` from the Proxmox host. Upload the file to the Proxmox host first via SFTP, then `pct push` it into the container.

### Anti-Patterns to Avoid
- **SSH directly into LXC containers:** Requires installing sshd in each container and managing separate keys/passwords. Use `pct exec` through the Proxmox host instead.
- **Polling for container readiness without timeout:** After container start, network may take 5-10 seconds. Use a retry loop with exponential backoff and a 30-second timeout.
- **Storing plaintext credentials in go2rtc.yaml comments:** The YAML already contains credentials in the RTSP URL. Never log or expose the full YAML content in API responses.
- **Building a custom WebRTC player:** go2rtc provides `stream.html?src=<name>` with auto-codec-selection. Embed it via iframe.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebRTC video player | Custom WebRTC signaling + player | go2rtc built-in `stream.html?src=<name>` iframe | WebRTC negotiation is complex; go2rtc handles codec auto-selection, ICE candidates, fallback to MSE/HLS |
| SSH command execution | Raw ssh2 API with stream handling | node-ssh `execCommand()` and `putFile()` | Promise-based, handles stderr/stdout, connection management |
| YAML serialization | String concatenation for complex YAML | Template literals for simple go2rtc config | go2rtc YAML is simple (just streams + optional api section). Full YAML library overkill for 5-line config. |
| Container command execution | Direct SSH into LXC containers | `pct exec` via SSH to Proxmox host | Standard Proxmox pattern, no sshd needed in containers |
| Stream codec detection | Manual RTSP parsing | go2rtc API `GET /api/streams` response | Returns codec info, producer count, consumer count per stream |

## Common Pitfalls

### Pitfall 1: LXC Container Not Ready After Creation
**What goes wrong:** Container is created but `pct exec` fails because the container hasn't fully started yet or network is not up.
**Why it happens:** Proxmox container creation is async. The API returns immediately with a task UPID, but the container isn't started yet.
**How to avoid:** After `createContainer()`, explicitly call `startContainer()`, then poll with `pct exec <vmid> -- echo ready` in a retry loop (max 30 seconds, 2-second intervals).
**Warning signs:** "container is not running" or "unable to connect to container" errors.

### Pitfall 2: go2rtc Binary Download Fails Inside Container
**What goes wrong:** `wget` to GitHub releases fails because the container lacks DNS or internet access.
**Why it happens:** DHCP may not have assigned an IP yet, or DNS resolver isn't configured in the minimal Debian template.
**How to avoid:** Verify network connectivity first (`pct exec <vmid> -- ping -c1 8.8.8.8`). If DNS fails, temporarily use `echo "nameserver 8.8.8.8" > /etc/resolv.conf`. Consider downloading the binary on the Proxmox host and using `pct push` as a fallback.
**Warning signs:** wget timeouts, DNS resolution failures.

### Pitfall 3: VAAPI Not Available Inside Container
**What goes wrong:** ffmpeg fails with "Failed to open device: /dev/dri/renderD128" despite VAAPI config being set on the container.
**Why it happens:** The container was started before VAAPI device passthrough was configured, or the device permissions are wrong.
**How to avoid:** Always configure VAAPI before starting the container (Phase 1's `configureVaapi()` does this). Verify inside container with `ls -la /dev/dri/renderD128`. The device needs `mode=0666` (already set in Phase 1).
**Warning signs:** ffmpeg exits with code 1, `vainfo` shows no display.

### Pitfall 4: go2rtc Stream Shows No Producers
**What goes wrong:** `GET /api/streams` returns the stream entry but with zero producers -- the RTSP source isn't connecting.
**Why it happens:** Wrong Mobotix RTSP URL path, wrong credentials, camera not accessible from container network, or ffmpeg crashed during VAAPI init.
**How to avoid:** Test the camera connection (Step 2) before deploying go2rtc config. Check go2rtc logs via `journalctl -u go2rtc -n 50` for ffmpeg error output. The stream path for classic Mobotix cameras is `rtsp://<user>:<pw>@<ip>:554/stream0/mobotix.mjpeg`.
**Warning signs:** Empty producers array in `/api/streams`, go2rtc logs showing ffmpeg restart loops.

### Pitfall 5: Mobotix RTSP Path Varies by Model
**What goes wrong:** The hardcoded `/stream0/mobotix.mjpeg` path doesn't work for all Mobotix models.
**Why it happens:** Classic Mobotix (M/D/S/Q/T series) use `/stream0/mobotix.mjpeg` or just `/mobotix.mjpeg`. Mobotix MOVE series use `/stream/profile0`. HTTP MJPEG alternative is `/cgi-bin/faststream.jpg`.
**How to avoid:** In Step 2 (connection test), try the primary RTSP path first, then fall back to alternatives. Log which path succeeded and use it in the go2rtc config.
**Warning signs:** RTSP connection timeout on Step 2 despite camera being reachable on port 80.

### Pitfall 6: Wizard State Lost on Page Refresh
**What goes wrong:** User refreshes browser during Step 4 (container already created) and re-runs the whole flow, creating a duplicate container.
**Why it happens:** Wizard state is client-side only (Svelte $state).
**How to avoid:** Container creation is already idempotent (Phase 1's `createContainer` checks VMID). For the wizard, track onboarding state in the DB (`cameras` table with a `status` field: 'pending' | 'container_created' | 'configured' | 'verified'). On page load, check for in-progress onboarding and resume from the correct step.

## Code Examples

### SSH Connection to Proxmox Host
```typescript
// Source: node-ssh npm docs (https://www.npmjs.com/package/node-ssh)
import { NodeSSH } from 'node-ssh';

const ssh = new NodeSSH();
await ssh.connect({
  host: '192.168.3.16',     // Proxmox host
  username: 'root',
  privateKey: '/path/to/id_rsa'  // or password: 'xxx'
});

// Execute command inside LXC container via pct exec
const result = await ssh.execCommand('pct exec 200 -- apt-get update');
console.log(result.stdout);

// Upload file to Proxmox host, then push to container
await ssh.putFile('/tmp/go2rtc.yaml', '/tmp/go2rtc.yaml');
await ssh.execCommand('pct push 200 /tmp/go2rtc.yaml /etc/go2rtc/go2rtc.yaml');

ssh.dispose();
```

### go2rtc YAML Config for Mobotix
```yaml
# Source: CLAUDE.md + go2rtc docs (https://github.com/AlexxIT/go2rtc)
streams:
  cam: ffmpeg:rtsp://admin:meinsm@192.168.3.22:554/stream0/mobotix.mjpeg#video=h264#width=1280#height=720#raw=-r 20#raw=-maxrate 5000k#raw=-bufsize 10000k#raw=-g 20#hardware=vaapi
```

### go2rtc Systemd Service Unit
```ini
# /etc/systemd/system/go2rtc.service
[Unit]
Description=go2rtc streaming server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/go2rtc -config /etc/go2rtc/go2rtc.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### go2rtc Stream Health Check
```typescript
// Source: go2rtc API (https://github.com/AlexxIT/go2rtc)
export async function checkStreamHealth(containerIp: string, streamName: string): Promise<{
  active: boolean;
  codec?: string;
  producers: number;
}> {
  const res = await fetch(`http://${containerIp}:1984/api/streams`);
  const streams = await res.json();
  const stream = streams[streamName];

  if (!stream || !stream.producers) {
    return { active: false, producers: 0 };
  }

  const producer = stream.producers[0];
  return {
    active: stream.producers.length > 0,
    codec: producer?.codecs?.find((c: string) => c.startsWith('H264')) ? 'H.264' : 'unknown',
    producers: stream.producers.length
  };
}
```

### WebRTC Preview via iframe
```svelte
<!-- Source: go2rtc stream.html (https://github.com/AlexxIT/go2rtc/issues/1790) -->
<script lang="ts">
  let { containerIp, streamName }: { containerIp: string; streamName: string } = $props();
</script>

<div class="rounded-lg overflow-hidden border border-border">
  <iframe
    src="http://{containerIp}:1984/stream.html?src={streamName}"
    width="640"
    height="360"
    frameborder="0"
    allowfullscreen
    title="Camera Preview"
  ></iframe>
</div>
```

### DB Schema Extension for Cameras
```typescript
// Extension to src/lib/server/db/schema.ts
export const cameras = sqliteTable('cameras', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vmid: integer('vmid').notNull().references(() => containers.vmid),
  name: text('name').notNull(),
  ip: text('ip').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(),  // encrypted
  cameraType: text('camera_type').notNull().default('mobotix'),
  streamPath: text('stream_path').notNull().default('/stream0/mobotix.mjpeg'),
  // Transcode parameters
  width: integer('width').notNull().default(1280),
  height: integer('height').notNull().default(720),
  fps: integer('fps').notNull().default(20),
  bitrate: integer('bitrate').notNull().default(5000),  // kbit/s
  // go2rtc config
  streamName: text('stream_name').notNull(),  // e.g., "cam" -- used in go2rtc.yaml
  rtspUrl: text('rtsp_url'),  // output: rtsp://<container-ip>:8554/<stream-name>
  containerIp: text('container_ip'),
  // Status tracking
  status: text('status').notNull().default('pending'),  // pending | container_created | configured | verified
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});
```

### Container Provisioning Command Sequence
```typescript
// Full sequence for Step 4: configure-go2rtc
const commands = [
  // 1. Update package list and install ffmpeg
  'apt-get update -qq && apt-get install -y -qq ffmpeg wget',

  // 2. Download go2rtc binary
  'wget -q https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 -O /usr/local/bin/go2rtc',
  'chmod +x /usr/local/bin/go2rtc',

  // 3. Create config directory
  'mkdir -p /etc/go2rtc',

  // 4. Create systemd service (content deployed via pct push)
  'systemctl daemon-reload',
  'systemctl enable go2rtc',
  'systemctl restart go2rtc',
];
```

## Discretion Recommendations

### Wizard Implementation: Custom Stepper
**Recommendation:** Build a custom stepper component rather than using bits-ui. The wizard has very specific behavior (stay on error, async step execution, loading states) that doesn't map well to generic tab/accordion primitives. A simple `currentStep` state variable with conditional rendering is cleaner.

### Container Naming Convention: `cam-{vmid}`
**Recommendation:** Use `cam-{vmid}` (e.g., `cam-200`). It's short, unique (VMID is unique in Proxmox), and avoids special characters. The IP suffix approach (`cam-22` for 192.168.3.22) risks collision if IPs change.

### go2rtc Version Strategy: Pin to Latest at Install Time
**Recommendation:** Always download `latest` from GitHub releases. Store the installed version in the DB for diagnostics. Don't pin a specific version -- the user gets the latest stable features and fixes. The go2rtc API is stable between minor versions.

### WebRTC Player: go2rtc iframe
**Recommendation:** Use `<iframe src="http://{containerIp}:1984/stream.html?src={streamName}">`. This provides auto-codec-selection (WebRTC with H.264 fallback to MSE/HLS/MJPEG), browser compatibility handling, and zero custom WebRTC code. Style the iframe container to match the dark theme.

### SSH Authentication: Use Proxmox Host SSH Key
**Recommendation:** The app needs SSH access to the Proxmox host only (not individual containers). Store the Proxmox SSH credentials (host, username, private key path or password) in the settings table, extending the existing settings pattern from Phase 1. Add a new "SSH" section to the settings page, or reuse the Proxmox tab since it's the same host.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| unifi-cam-proxy for RTSP adoption | go2rtc native RTSP output on :8554 | go2rtc v1.0+ (2023) | No need for unifi-cam-proxy in the transcoding step; go2rtc outputs RTSP directly |
| Manual ffmpeg command line | go2rtc `#hardware=vaapi` hash param | go2rtc v1.2+ | go2rtc auto-configures VAAPI init_hw_device when `#hardware=vaapi` is specified |
| Static go2rtc config only | Dynamic stream add via PUT API | go2rtc 2024+ | Could use `PUT /api/streams?src=...&name=...` but YAML config is more reliable for persistence across restarts |
| Mobotix MxPEG proprietary codec | MJPEG fallback via RTSP | Always available | Classic Mobotix cameras support MJPEG as a standard fallback stream, no MxPEG decoder needed |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vite.config.ts (test section) |
| Quick run command | `npm run test -- --run` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LXC-03 | go2rtc install + config deploy via SSH | unit | `npx vitest run src/lib/server/services/ssh.test.ts` | No -- Wave 0 |
| G2R-01 | Generate correct go2rtc YAML config | unit | `npx vitest run src/lib/server/services/go2rtc.test.ts` | No -- Wave 0 |
| G2R-04 | Deploy config and restart service | unit | `npx vitest run src/lib/server/services/ssh.test.ts` | No -- Wave 0 |
| G2R-05 | Transcode parameter customization | unit | `npx vitest run src/lib/server/services/go2rtc.test.ts` | No -- Wave 0 |
| G2R-06 | Stream health validation | unit | `npx vitest run src/lib/server/services/go2rtc.test.ts` | No -- Wave 0 |
| ONBD-01 | Start onboarding flow | manual-only | Manual: click "+Kamera hinzufuegen" button | N/A |
| ONBD-02 | Complete 5-step wizard | unit | `npx vitest run src/lib/server/services/onboarding.test.ts` | No -- Wave 0 |
| ONBD-03 | Error handling with retry | unit | `npx vitest run src/lib/server/services/onboarding.test.ts` | No -- Wave 0 |
| ONBD-04 | RTSP URL displayed after verification | manual-only | Manual: complete wizard, verify URL shown | N/A |
| ONBD-06 | End-to-end Mobotix pipeline | integration | Requires real hardware -- manual only | N/A |

### Sampling Rate
- **Per task commit:** `npm run test -- --run`
- **Per wave merge:** `npm run test -- --run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/server/services/ssh.test.ts` -- covers LXC-03, G2R-04 (mock node-ssh)
- [ ] `src/lib/server/services/go2rtc.test.ts` -- covers G2R-01, G2R-05, G2R-06 (YAML generation, stream health check)
- [ ] `src/lib/server/services/onboarding.test.ts` -- covers ONBD-02, ONBD-03 (orchestration logic)

## Open Questions

1. **Proxmox Host SSH Credentials Storage**
   - What we know: The app needs SSH access to the Proxmox host. Phase 1 stores Proxmox API token in settings.
   - What's unclear: Where to configure SSH credentials (private key path vs password). Should this be a new settings tab or extend the Proxmox tab?
   - Recommendation: Extend the Proxmox settings tab with SSH fields (username, auth method, private key path or password). Mark password as sensitive in `SENSITIVE_KEYS`.

2. **Container IP Address Discovery**
   - What we know: After creating and starting an LXC container with `ip=dhcp`, it gets an IP from DHCP.
   - What's unclear: How to reliably discover the container's IP after start. Options: parse `pct exec <vmid> -- hostname -I`, query Proxmox API for network interfaces, or use `lxc-info`.
   - Recommendation: Use `pct exec <vmid> -- hostname -I` with retry (DHCP may take a few seconds). Store the IP in the cameras table.

3. **Connection Test Implementation (Step 2)**
   - What we know: Need to probe Mobotix RTSP endpoint and detect resolution/fps.
   - What's unclear: Best way to probe from the app server without ffmpeg installed on it. Options: use `ffprobe` if available, attempt a raw RTSP DESCRIBE, or use a lightweight RTSP probe via TCP.
   - Recommendation: Use `ffprobe` if available on the app server (`ffprobe -v quiet -print_format json -show_streams rtsp://...`), or fall back to a simple TCP connection to port 554 + RTSP OPTIONS/DESCRIBE request. For resolution detection, ffprobe is the most reliable approach.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/server/services/proxmox.ts`, `schema.ts`, `settings.ts` -- Phase 1 patterns
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) -- README, YAML config syntax, ffmpeg hash params
- [go2rtc releases](https://github.com/AlexxIT/go2rtc/releases) -- Latest version (2026-01-19), binary download URL
- [node-ssh npm](https://www.npmjs.com/package/node-ssh) -- v13.2.1 API: connect, execCommand, putFile, dispose

### Secondary (MEDIUM confidence)
- [Mobotix RTSP URLs](https://community.mobotix.com/t/rtsp-streaming-with-mobotix-cameras/4912) -- Classic Mobotix RTSP path patterns
- [Mobotix RTSP guide](https://www.camtuber.com/rtsp-guide/mobotix) -- Default credentials (admin/meinsm), port 554, stream paths
- [go2rtc WebRTC embedding](https://github.com/AlexxIT/go2rtc/issues/1790) -- stream.html?src= iframe embedding pattern
- [go2rtc VAAPI issue #464](https://github.com/AlexxIT/go2rtc/issues/464) -- MJPEG to H264 hardware acceleration confirmation

### Tertiary (LOW confidence)
- [go2rtc API README](https://github.com/AlexxIT/go2rtc/blob/master/api/README.md) -- Could not fetch (404 on raw URL), API endpoint details inferred from README and issues

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and used in Phase 1, go2rtc is well-documented
- Architecture: HIGH -- extends established Phase 1 patterns (services, API routes, DB schema, testing)
- Pitfalls: HIGH -- based on real Proxmox LXC + go2rtc deployment experience documented in community forums
- go2rtc API details: MEDIUM -- README is comprehensive but `/api/streams` response format details are from secondary sources

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, go2rtc API changes slowly)
