# Phase 4: Dashboard and UniFi Protect - Research

**Researched:** 2026-03-23
**Domain:** UniFi Protect API integration, SSH log parsing, event system, dashboard enhancement
**Confidence:** MEDIUM-HIGH

## Summary

Phase 4 adds real UniFi Protect data to the existing dashboard, replacing indirect go2rtc consumer detection with actual Protect API camera status. The core technical challenge is integrating with the UniFi Protect API (undocumented but well-reverse-engineered), parsing UDM SSH logs for problem detection, and implementing an event system for flapping detection.

The `unifi-protect` npm package (v4.28.0) provides a TypeScript-native client with login, bootstrap, camera listing, and WebSocket real-time events. For this phase, use direct REST calls instead -- the package adds complexity (WebSocket management, event subscription) that is overkill for 30-second polling. The Protect API endpoints are simple: POST `/api/auth/login` for auth (cookie-based), GET `/proxy/protect/api/cameras` for camera list, and GET `/proxy/protect/api/bootstrap` for full state. These are already tested and working on the user's UDM.

Programmatic adoption of third-party cameras via API is NOT possible -- there is no adoption endpoint in either the official API (v5.3) or the reverse-engineered API. Adoption happens through Protect's ONVIF discovery mechanism. The app should provide a guided flow: verify ONVIF server is running on the container, then direct the user to Protect UI to adopt. The "In Protect aufnehmen" button should trigger ONVIF server verification + show step-by-step instructions rather than attempting API adoption.

**Primary recommendation:** Use direct REST calls (fetch) to the Protect API with cookie-based auth, 30s polling for camera status, 60s SSH log scanning, and SQLite events table with 30-day retention. Skip the `unifi-protect` npm package to avoid dependency complexity.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Hybrid approach: `unifi-protect` npm package (or direct REST) for structured data + SSH for raw log access
- D-02: Dedicated local UniFi OS user `ip-cam-master` with full Protect admin permissions -- credentials already stored in app settings
- D-03: Dedicated SSH key at `/opt/ip-cam-master/data/udm_key` for UDM root access -- already deployed and tested
- D-04: Protect API auth via POST to `https://{host}/api/auth/login` with cookie-based session. Session refresh on 401.
- D-05: Protect API base path: `https://{host}/proxy/protect/api/` -- cameras, events, NVR status all available here
- D-06: Camera matching between our DB and Protect: match by container IP (our cameras appear as third-party ONVIF devices at their container IP)
- D-07: Programmatic adoption IS possible -- user has required scopes (research update: no API endpoint exists, fallback to guided instructions per D-10)
- D-08: After onboarding wizard completes (stream verified), offer "In Protect aufnehmen" button that triggers adoption via API (research update: button triggers guided adoption flow)
- D-09: Adoption flow: ONVIF server is discoverable by Protect. App verifies ONVIF is running then guides user.
- D-10: If programmatic adoption fails or isn't reliable, fallback to guided instructions ("Oeffne Protect -> Geraete -> Uebernehmen")
- D-11: Collect events from two sources: Protect API (camera state changes) + SSH log parsing (detailed errors, stream failures)
- D-12: Store events in SQLite `events` table with: timestamp, camera_id, event_type, severity, message, source
- D-13: Event types: `camera_disconnect`, `camera_reconnect`, `stream_failed`, `adoption_changed`, `aiport_error`
- D-14: Noise filtering -- do NOT store routine ONVIF discovery updates, normal reconnects under 10s, go2rtc startup messages, periodic health checks
- D-15: Flapping detection: >3 disconnects in 10 minutes -> flag as "instabil" with warning severity
- D-16: Polling interval: Protect API every 30s for camera status. SSH log scan every 60s.
- D-17: Dashboard already has health banner, stat cards, resource bars, camera table -- keep and enhance
- D-18: Add "Letzte Ereignisse" section below stats
- D-19: UniFi Protect stat card: update from indirect to real API data
- D-20: Camera table: add Protect column with real adoption status
- D-21: CameraDetailCard pipeline: real API data for Protect status
- D-22: Flapping warning badge on unstable cameras
- D-23: Native ONVIF cameras: show Protect status too
- D-24: Activate Logs page with filterable event table
- D-25: Filters: by camera, severity, event type, date range
- D-26: Newest events first, paginated
- D-27: "Protect Logs" tab with raw recent entries from UDM SSH logs (on-demand)

### Claude's Discretion
- Protect API client implementation details (direct REST vs npm package) -- RECOMMENDATION: direct REST, see rationale above
- SSH log parsing regex patterns and implementation
- Event table schema details
- Exact polling/caching strategy
- Logs page component structure
- Event retention policy -- RECOMMENDATION: 30 days, with `DELETE WHERE timestamp < datetime('now', '-30 days')` cleanup on each scan

### Deferred Ideas (OUT OF SCOPE)
- Push notifications from app to phone (v2, MON-*)
- Disconnect pattern analysis with graphs/charts over time (v2, MON-03)
- Per-camera reliability score (v2, MON-04)
- Automatic go2rtc config fix when stream issues detected
- UniFi Protect event webhook subscription (WebSocket) for real-time updates -- could replace polling in future
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Dashboard shows all managed cameras in a grid/list view | Already built (camera table on +page.svelte). Enhance with Protect data. |
| DASH-02 | Each camera card shows: name, IP, type, container status, stream status | Already built in camera table. Add Protect adoption status column. |
| DASH-03 | Camera status updates automatically (polling go2rtc API + Proxmox API) | Already polling at 10s. Extend API to include Protect status via new protect.ts service. |
| DASH-04 | User can view live stream preview via go2rtc WebRTC/MSE player | Snapshot-based preview already works. go2rtc WebRTC at `http://{containerIp}:1984/stream.html?src={streamName}`. |
| DASH-05 | ONVIF-capable cameras displayed as "nativ nutzbar" without workflow actions | Already implemented -- native ONVIF cameras show different UI panel. |
| DASH-06 | Dashboard shows UniFi Protect adoption status per camera | New: Protect API service provides real adoption data. Match cameras by container IP to Protect's `host` field. |
| ONBD-05 | App triggers or guides UniFi Protect adoption | New: Guided adoption flow with ONVIF verification + step-by-step instructions. No programmatic adoption API exists. |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2+ | Events table storage | Already in project, synchronous API for event writes |
| drizzle-orm | 0.45.1 | Schema + queries for events table | Already in project, type-safe migrations |
| node-ssh | 13.2.1 | SSH to UDM for log parsing | Already in project, pattern exists in ssh.ts |
| lucide-svelte | 0.577.0 | Icons for events, filters, badges | Already in project |

### No New Dependencies Needed
| Instead of | Use | Rationale |
|------------|-----|-----------|
| `unifi-protect` npm | Direct `fetch()` to REST API | Avoids new dependency. API is 3 endpoints (login, cameras, bootstrap). Cookie auth is trivial with fetch. The npm package adds WebSocket management and event subscription that are not needed for 30s polling. |
| Custom log parsing lib | Regex patterns in service | UDM log format is simple timestamped lines. No need for a parsing library. |
| Virtual scroll library | Paginated table | Event counts will be manageable (~100s per day). Simple pagination suffices. |

**Installation:** No new packages needed. All dependencies already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/lib/server/services/
  protect.ts          # UniFi Protect API client (login, cameras, match, adoption status)
  udm-logs.ts         # SSH log parser for UDM (connect, tail logs, parse events)
  events.ts           # Event storage, retrieval, flapping detection, cleanup
src/lib/server/db/
  schema.ts           # Add events table
src/routes/api/
  protect/
    cameras/+server.ts     # GET: Protect cameras with adoption status
    events/+server.ts      # GET: Events with filters (camera, severity, type, date)
    adopt/+server.ts       # POST: Trigger guided adoption (verify ONVIF + return instructions)
  logs/
    protect/+server.ts     # GET: Raw UDM log entries (on-demand SSH)
src/routes/
  +page.svelte             # Dashboard: enhance with Protect data + "Letzte Ereignisse"
  logs/+page.svelte        # Logs page: event table + Protect logs tab
src/lib/components/
  events/
    EventList.svelte       # Compact event list for dashboard
    EventTable.svelte      # Full filterable event table for logs page
    EventFilters.svelte    # Filter controls (camera, severity, type, date)
  cameras/
    CameraDetailCard.svelte  # Enhance UniFi Protect section with real data
    AdoptionGuide.svelte     # Step-by-step Protect adoption instructions
```

### Pattern 1: Protect API Service with Session Management
**What:** Singleton service that manages Protect API authentication with automatic session refresh
**When to use:** All Protect API calls go through this service
**Example:**
```typescript
// src/lib/server/services/protect.ts
interface ProtectSession {
  cookies: string;
  csrfToken: string;
  expiresAt: number;
}

let session: ProtectSession | null = null;

async function login(): Promise<ProtectSession> {
  const settings = await getSettings('unifi_');
  const host = settings.unifi_host;
  const password = decrypt(settings.unifi_password);

  const res = await fetch(`https://${host}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: settings.unifi_username, password }),
    // Node.js fetch handles self-signed certs via NODE_TLS_REJECT_UNAUTHORIZED
  });

  if (!res.ok) throw new Error(`Protect login failed: ${res.status}`);

  const cookies = res.headers.getSetCookie().join('; ');
  const csrfToken = res.headers.get('x-csrf-token') || '';

  return { cookies, csrfToken, expiresAt: Date.now() + 8 * 60 * 1000 }; // 8min safety margin
}

async function protectFetch(path: string): Promise<any> {
  if (!session || Date.now() > session.expiresAt) {
    session = await login();
  }

  const settings = await getSettings('unifi_');
  const res = await fetch(`https://${settings.unifi_host}/proxy/protect/api/${path}`, {
    headers: { Cookie: session.cookies, 'X-CSRF-Token': session.csrfToken }
  });

  if (res.status === 401) {
    session = await login(); // Re-auth on 401
    // Retry once
  }

  return res.json();
}
```

### Pattern 2: Camera Matching (Our DB <-> Protect)
**What:** Match cameras in our database to Protect cameras using container IP
**When to use:** Every time Protect camera data is fetched
**Example:**
```typescript
// Our cameras have containerIp. Protect third-party cameras have host field = container IP.
// Protect camera fields of interest:
// - host: string (IP address)
// - mac: string
// - state: string ("CONNECTED" | "DISCONNECTED" | ...)
// - isAdopted: boolean
// - isThirdPartyCamera: boolean
// - connectedSince: number (timestamp ms)
// - name: string (user-configured name in Protect)

interface ProtectCameraMatch {
  protectId: string;
  protectName: string;
  state: string;
  isAdopted: boolean;
  connectedSince: number | null;
  isThirdPartyCamera: boolean;
}

function matchCameras(ourCameras: Camera[], protectCameras: any[]): Map<number, ProtectCameraMatch> {
  const matches = new Map();
  for (const cam of ourCameras) {
    const match = protectCameras.find(p =>
      p.host === cam.containerIp || p.host === cam.ip // containerIp for pipeline, ip for native
    );
    if (match) {
      matches.set(cam.id, {
        protectId: match.id,
        protectName: match.name,
        state: match.state,
        isAdopted: match.isAdopted,
        connectedSince: match.connectedSince,
        isThirdPartyCamera: match.isThirdPartyCamera
      });
    }
  }
  return matches;
}
```

### Pattern 3: SSH Log Parsing for UDM
**What:** Connect to UDM via SSH, read recent log entries, parse for relevant events
**When to use:** Every 60s background scan
**Example:**
```typescript
// Key log files on UDM at /srv/unifi-protect/logs/:
// - cameras.thirdParty.log  -- third-party camera events (primary)
// - cameras.log             -- all camera events
// - aiport.log              -- AI/stream processing errors

// Log line format (from user's manual debugging session):
// 2026-03-23T10:15:30.123Z [camera-name @ container-ip] disconnected
// 2026-03-23T10:15:45.678Z [camera-name @ container-ip] reconnected

async function scanUdmLogs(since: Date): Promise<ParsedEvent[]> {
  const ssh = new NodeSSH();
  await ssh.connect({
    host: '192.168.3.1', // From unifi_host setting
    username: 'root',
    privateKeyPath: '/opt/ip-cam-master/data/udm_key'
  });

  try {
    // Read last N lines of thirdParty log
    const result = await ssh.execCommand(
      `tail -500 /srv/unifi-protect/logs/cameras.thirdParty.log`
    );
    return parseLogLines(result.stdout, since);
  } finally {
    ssh.dispose();
  }
}
```

### Pattern 4: Flapping Detection
**What:** Detect cameras with >3 disconnects in 10 minutes
**When to use:** After each event batch is stored
**Example:**
```typescript
function detectFlapping(cameraId: number): boolean {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const disconnects = db.select()
    .from(events)
    .where(
      and(
        eq(events.cameraId, cameraId),
        eq(events.eventType, 'camera_disconnect'),
        gt(events.timestamp, tenMinAgo)
      )
    )
    .all();
  return disconnects.length > 3;
}
```

### Anti-Patterns to Avoid
- **Using WebSocket for real-time Protect updates:** Adds complexity for marginal benefit. 30s polling is sufficient for a dashboard that already polls at 10s. Deferred per CONTEXT.md.
- **Storing all log lines:** Only store events matching known patterns. Raw logs are available on-demand via SSH for debugging.
- **Polling SSH too frequently:** SSH connection per poll is expensive. 60s interval is the minimum. Cache SSH connection if possible, but dispose properly on error.
- **Matching cameras by MAC only:** Protect shows third-party cameras as `[MAC @ IP]`. Use IP as primary match key since our DB has container IPs. MAC is secondary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP cookie management | Custom cookie jar | Extract cookies from `Set-Cookie` header directly | Only 1 endpoint (login) sets cookies. Store as string, pass as `Cookie` header. |
| HTTPS with self-signed certs | Custom TLS handling | `NODE_TLS_REJECT_UNAUTHORIZED=0` in env or `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` | UDM uses self-signed cert. App is local-only, no security risk. |
| Date range filtering | Custom date math | SQLite `datetime()` functions | `WHERE timestamp > datetime('now', '-10 minutes')` is cleaner than JS date math |
| Event pagination | Custom offset logic | SQL `LIMIT ? OFFSET ?` with count query | Standard pattern, no library needed |

**Key insight:** This phase is mostly integration code (API calls, log parsing, data matching) rather than algorithmic complexity. Keep it simple with direct fetch calls and SQL queries.

## Common Pitfalls

### Pitfall 1: Protect Session Expiry Mid-Request
**What goes wrong:** API returns 401 during a data fetch, causing stale data on dashboard
**Why it happens:** Protect sessions expire after ~10 minutes. If the app has been idle, the first request after resuming will fail.
**How to avoid:** Implement retry-on-401: catch 401, re-login, retry the request once. Store session with expiry timestamp and proactively refresh before expiry.
**Warning signs:** Intermittent 401 errors in server logs, dashboard showing stale "wartend" status.

### Pitfall 2: Self-Signed Certificate Rejection
**What goes wrong:** `fetch()` to `https://192.168.3.1` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
**Why it happens:** Node.js rejects self-signed certificates by default. The UDM uses a self-signed cert.
**How to avoid:** Set `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` at the top of the protect service module. This is safe because the app only communicates on the local network.
**Warning signs:** Protect API calls failing immediately with TLS errors.

### Pitfall 3: SSH Connection Leaks
**What goes wrong:** SSH connections to UDM pile up, eventually causing "Too many authentication failures" or UDM becoming unresponsive
**Why it happens:** Not calling `ssh.dispose()` after each log scan, especially on error paths.
**How to avoid:** Always wrap SSH operations in try/finally with dispose. Consider a connection pool or reuse pattern, but ensure cleanup.
**Warning signs:** Increasing SSH processes on UDM (`ps aux | grep ssh` on UDM shows many connections).

### Pitfall 4: Log File Rotation and Large Files
**What goes wrong:** `tail -500` returns old events that were already processed, or log file rotates and events are missed
**Why it happens:** UDM rotates log files. The app doesn't track where it left off.
**How to avoid:** Track last-processed timestamp. Parse lines and only store events newer than last scan. Use `since` parameter to filter in the parser.
**Warning signs:** Duplicate events in the events table, or gaps in event history.

### Pitfall 5: Camera Matching Fails for Native ONVIF Cameras
**What goes wrong:** Native ONVIF cameras (e.g., 192.168.3.21) don't match to Protect cameras because matching uses containerIp which is null for native cameras
**Why it happens:** Native ONVIF cameras have vmid=0 and no container. They're directly adopted in Protect at their camera IP.
**How to avoid:** Match by `cam.ip` for native ONVIF cameras (vmid === 0), and by `cam.containerIp` for pipeline cameras (vmid > 0).
**Warning signs:** Native ONVIF cameras showing "wartend" in dashboard despite being adopted in Protect.

### Pitfall 6: Event Table Growing Unbounded
**What goes wrong:** Events accumulate over months, slowing queries and bloating SQLite DB
**Why it happens:** No cleanup/retention policy
**How to avoid:** Run cleanup on each scan cycle: `DELETE FROM events WHERE timestamp < datetime('now', '-30 days')`. 30 days gives enough history for debugging without unbounded growth.
**Warning signs:** Slow event queries, large `data/ip-cam-master.db` file size.

## Code Examples

### Events Table Schema (Drizzle)
```typescript
// Add to src/lib/server/db/schema.ts
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id'),  // nullable -- some events are system-wide
  cameraName: text('camera_name'), // denormalized for fast display
  eventType: text('event_type').notNull(), // camera_disconnect, camera_reconnect, stream_failed, adoption_changed, aiport_error
  severity: text('severity').notNull().default('info'), // info, warning, error
  message: text('message').notNull(),
  source: text('source').notNull(), // 'protect_api' | 'ssh_logs' | 'app'
  timestamp: text('timestamp').notNull().$defaultFn(() => new Date().toISOString()),
});
```

### Protect API Camera Response Structure
```typescript
// Key fields from GET /proxy/protect/api/cameras
interface ProtectCamera {
  id: string;
  name: string;
  type: string;
  modelKey: string;
  host: string;           // IP address -- this is how we match
  mac: string;
  state: string;          // "CONNECTED" | "DISCONNECTED" | "ADOPTING" | etc.
  isAdopted: boolean;
  isAdopting: boolean;
  isThirdPartyCamera: boolean;
  connectedSince: number; // Unix timestamp ms
  lastSeen: number;       // Unix timestamp ms
  thirdPartyCameraInfo?: {
    port: number;
    rtspUrl: string;
    rtspUrlLQ: string;
    snapshotUrl: string;
  };
}
```

### UDM SSH Log Parsing Regex Patterns
```typescript
// cameras.thirdParty.log patterns (observed from user's debugging session):
const LOG_PATTERNS = {
  // Camera disconnect/reconnect
  disconnect: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*\[([^\]]+)\s*@\s*([\d.]+)\].*disconnect/i,
  reconnect: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*\[([^\]]+)\s*@\s*([\d.]+)\].*reconnect/i,
  // Stream failures
  streamFailed: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*stream.*(?:failed|error|timeout)/i,
  // Adoption changes
  adopted: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*(?:adopted|adoption)/i,
  // aiport errors
  aiportError: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*aiport.*error/i,
};

// Noise filter -- skip these patterns:
const NOISE_PATTERNS = [
  /ONVIF discovery/i,
  /health check/i,
  /go2rtc.*started/i,
  /reconnect.*<10s/i,
];
```

### Dashboard "Letzte Ereignisse" Component
```typescript
// Compact event list for dashboard -- fetch last 10 events
// GET /api/protect/events?limit=10
// Display: timestamp | camera name | severity icon | message
```

### Guided Adoption Flow
```typescript
// POST /api/protect/adopt
// Step 1: Verify ONVIF server is running on container (port 8899)
// Step 2: Verify container is reachable from UDM network
// Step 3: Return adoption instructions:
//   - "Oeffne UniFi Protect → Geraete → Uebernehmen"
//   - "Kamera '{name}' sollte in der Liste erscheinen"
//   - "Klicke auf 'Uebernehmen' (Adopt)"
//   - Optional: direct link to Protect UI
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Indirect Protect detection (go2rtc consumer user-agent check) | Direct Protect API queries | Phase 4 | Accurate adoption status, disconnect counts, camera health |
| No event history | SQLite events table with 30-day retention | Phase 4 | Flapping detection, debugging, trend awareness |
| Placeholder logs page | Active logs page with filters | Phase 4 | Self-service debugging without manual SSH |
| No UDM log access | SSH log parsing service | Phase 4 | Detect problems before user notices in Protect app |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | vite.config.ts (test section) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Dashboard lists all cameras | manual-only (UI) | N/A -- visual verification | N/A |
| DASH-02 | Camera shows name, IP, type, status | manual-only (UI) | N/A -- visual verification | N/A |
| DASH-03 | Auto-updating camera status | unit | `npx vitest run src/lib/server/services/protect.test.ts -t "fetch cameras"` | Wave 0 |
| DASH-04 | Live stream preview | manual-only | N/A -- requires go2rtc running | N/A |
| DASH-05 | Native ONVIF shown differently | manual-only (UI) | N/A -- already working | N/A |
| DASH-06 | Protect adoption status display | unit | `npx vitest run src/lib/server/services/protect.test.ts -t "match cameras"` | Wave 0 |
| ONBD-05 | Guided adoption flow | unit | `npx vitest run src/lib/server/services/protect.test.ts -t "adoption"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/server/services/protect.test.ts` -- Protect API service (login mock, camera matching, session refresh)
- [ ] `src/lib/server/services/events.test.ts` -- Event storage, retrieval, flapping detection, cleanup
- [ ] `src/lib/server/services/udm-logs.test.ts` -- Log parsing regex patterns, noise filtering

## Open Questions

1. **Exact UDM log format for third-party cameras**
   - What we know: Logs are at `/srv/unifi-protect/logs/cameras.thirdParty.log`, user manually parsed them today
   - What's unclear: Exact timestamp format, field separators, all event types present in logs
   - Recommendation: During implementation, SSH to UDM and `tail -100` the log file to capture real format. Build regex patterns from actual log lines. The service should be robust to format variations.

2. **Protect API rate limits on local UDM**
   - What we know: No documented rate limits for local API access. User tested manually without issues.
   - What's unclear: Whether 30s polling causes any load issues on UDM
   - Recommendation: Start with 30s as decided. Monitor UDM performance. The API call is lightweight (GET cameras returns small JSON).

3. **Camera state values in Protect API**
   - What we know: `state` field exists on camera objects. Common values: "CONNECTED", "DISCONNECTED"
   - What's unclear: Full enum of possible state values (ADOPTING, PROVISIONING, etc.)
   - Recommendation: Treat "CONNECTED" as healthy, everything else as problem state. Log unknown states as warnings.

## Sources

### Primary (HIGH confidence)
- [ScottiByte UniFi Protect API docs](https://discussion.scottibyte.com/t/unifi-protect-camera-api/640) -- Verified API endpoints: auth/login, /proxy/protect/api/cameras, cookie-based auth
- [hjdhjd/unifi-protect GitHub](https://github.com/hjdhjd/unifi-protect) -- ProtectCameraConfig fields: host, mac, state, isAdopted, isThirdPartyCamera, connectedSince, thirdPartyCameraInfo
- [hjdhjd/unifi-protect ProtectApi.md](https://github.com/hjdhjd/unifi-protect/blob/main/docs/ProtectApi.md) -- API usage: login(), getBootstrap(), camera access pattern
- [Official Protect API v5.3](https://developer.ui.com/protect/v5.3.41/connectorput) -- Official endpoints: GET /v1/cameras, PATCH /v1/cameras/{id}, snapshots, RTSPS streams. NO adoption endpoint.
- [uiprotect discussion #442](https://github.com/uilibs/uiprotect/discussions/442) -- Official API in 5.3: integration endpoints, event WebSocket subscription

### Secondary (MEDIUM confidence)
- [Ubiquiti Third-Party Camera docs](https://help.ui.com/hc/en-us/articles/26301104828439-Third-Party-Cameras-in-UniFi-Protect) -- Adoption via ONVIF discovery, no programmatic API
- [npm: unifi-protect v4.28.0](https://www.npmjs.com/package/unifi-protect) -- Current version verified via npm registry
- [Florian Rhomberg guide](https://www.florian-rhomberg.net/2025/01/how-to-integrate-a-third-party-camera-into-unifi-protect/) -- Third-party camera integration walkthrough

### Tertiary (LOW confidence)
- UDM log format patterns -- Based on user's manual session today, needs verification against actual log files during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all patterns established in codebase
- Architecture: HIGH - Follows existing service/API/component patterns exactly
- Protect API integration: MEDIUM-HIGH - API endpoints verified from multiple sources, camera fields from type definitions
- Programmatic adoption: HIGH (that it's NOT possible) - Verified no adoption endpoint exists in official API v5.3 or reverse-engineered API
- SSH log parsing: MEDIUM - Log format needs verification against actual UDM logs during implementation
- Flapping detection: HIGH - Simple SQL query pattern, well-defined threshold from user

**Research date:** 2026-03-23
**Valid until:** 2026-04-22 (30 days -- Protect API is stable, UniFi rarely changes local API endpoints)
