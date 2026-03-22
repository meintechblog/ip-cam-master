# Phase 1: Foundation and Proxmox Integration - Research

**Researched:** 2026-03-22
**Domain:** SvelteKit webapp foundation + Proxmox LXC management via API
**Confidence:** HIGH

## Summary

Phase 1 establishes a greenfield SvelteKit 2 (Svelte 5) web application with dark theme, tabbed settings pages for infrastructure connections (Proxmox, UniFi, Credentials), secure credential storage in SQLite via Drizzle ORM, and LXC container lifecycle management through the Proxmox REST API. The project root currently contains only CLAUDE.md -- everything must be scaffolded from scratch.

The critical technical risks are: (1) the `proxmox-api` npm package was last published Sep 2024 (v1.1.1) but the Proxmox REST API is stable, so a thin direct-fetch fallback is viable; (2) VAAPI device passthrough (`/dev/dri`) to LXC containers requires the `dev0:` parameter in the Proxmox API PUT config call (available since PVE 8.1+), which must be validated early; (3) credential storage in SQLite must be encrypted at rest from day one since the repo is public.

**Primary recommendation:** Scaffold the SvelteKit project using `npx sv create`, add Drizzle+SQLite via `npx sv add drizzle`, use Tailwind 4 with forced dark class, implement Proxmox API integration with `proxmox-api` package (with direct REST fallback ready), and build the container card grid with real-time status polling.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Claude's discretion on navigation style (sidebar vs top-nav) -- user deferred choice
- **D-02:** Dark theme (like UniFi OS / Proxmox Dark Mode) -- no light mode toggle needed
- **D-03:** Four main navigation areas: Dashboard (placeholder), Kameras (container management), Settings, Logs/Status (placeholder)
- **D-04:** Dashboard and Logs/Status are placeholder pages in Phase 1 -- real content comes in Phase 4 and v2
- **D-05:** Settings organized with tabs: Proxmox, UniFi, Credentials
- **D-06:** Connection validation is automatic on save -- inline feedback (success/error), no separate test button
- **D-07:** No setup wizard -- user goes directly to Settings page on first launch
- **D-08:** If settings are not configured, show a clear banner/hint directing to Settings
- **D-09:** Containers displayed as card grid -- one card per LXC container
- **D-10:** Each card shows: status badge (running/stopped/error with color), camera name + IP, VMID + hostname, resource usage (CPU/RAM if available from Proxmox API)
- **D-11:** Container actions as inline icon buttons directly on each card: Play (start), Stop, Restart, Trash (delete with confirmation)
- **D-12:** Delete action requires confirmation dialog before execution
- **D-13:** Proxmox access via API Token (PVEAPIToken) -- not root SSH. User creates token in Proxmox UI and enters it in Settings.
- **D-14:** Settings form fields: Proxmox host IP/hostname, API token ID, API token secret, target storage, network bridge, VMID range start
- **D-15:** App validates token permissions on save and shows specific feedback (e.g., "Missing VM.Allocate permission")
- **D-16:** Primary access via UniFi OS API (local, authenticated) for Protect status and camera management
- **D-17:** SSH access to UDM is a secondary fallback for log reading -- internal/testing only, not exposed in the public distribution initially
- **D-18:** Settings form: UDM IP/hostname, UniFi OS username, UniFi OS password (stored in SQLite credentials, never in config files)

### Claude's Discretion
- Navigation layout style (sidebar recommended for infra tool UIs)
- Exact component library / styling approach (Tailwind recommended per research)
- SQLite schema design for credentials and settings
- Container card layout details (spacing, typography, icon choices)
- Error state designs and empty state content
- Responsive behavior on smaller screens

### Deferred Ideas (OUT OF SCOPE)
- Setup wizard for first-time users -- user chose direct settings page instead, but might revisit for one-line-install experience (Phase 5)
- Light/dark mode toggle -- user chose dark-only, could be added later if community requests it
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | User can configure Proxmox host connection (IP, API token, storage target, network bridge) | Settings page with Proxmox tab, Drizzle schema for settings table, form fields per D-14 |
| INFRA-02 | App validates Proxmox connection on save and shows success/error | proxmox-api `nodes.$get()` call with API token auth; inline validation per D-06/D-15 |
| INFRA-03 | User can configure UniFi Dream Machine connection (IP, SSH credentials) | Settings page with UniFi tab, form fields per D-18 |
| INFRA-04 | User can configure credential store for camera access (local-only, never in repo) | Credentials tab in settings, SQLite storage with AES-256-GCM encryption |
| INFRA-05 | App stores all secrets in local SQLite database outside of git-tracked files | SQLite DB file in data/ directory, .gitignore excludes *.db, encryption at rest |
| LXC-01 | App creates a Proxmox LXC container for a camera via Proxmox API | POST `/nodes/{node}/lxc` with vmid, hostname, ostemplate, memory, net0 params |
| LXC-02 | App configures VAAPI device passthrough (/dev/dri) in LXC container | PUT `/nodes/{node}/lxc/{vmid}/config` with `dev0: /dev/dri/renderD128,mode=0666` (PVE 8.1+) |
| LXC-05 | User can start, stop, and restart a camera's LXC container from the dashboard | POST `/nodes/{node}/lxc/{vmid}/status/{start|stop|reboot}` via proxmox-api; inline buttons on cards per D-11 |
| LXC-06 | User can delete a camera's LXC container with confirmation dialog | DELETE `/nodes/{node}/lxc/{vmid}` with confirmation modal per D-12 |
| LXC-07 | Container creation is idempotent -- running again repairs, does not duplicate | Check if VMID exists before creating; if exists, update config instead of creating new |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.55.0 | Full-stack framework | SSR + API routes in one process; `npx sv create` scaffolds project |
| Svelte | 5.54.1 | UI framework | Runes-based reactivity, less JS shipped than React |
| TypeScript | 5.x | Language | First-class SvelteKit support, type-safe API interactions |
| @sveltejs/adapter-node | 5.5.4 | Production build | Produces standalone `node build/` runnable by systemd |
| Tailwind CSS | 4.2.2 | Styling | Utility-first, dark theme via `@theme` directive, no config file needed in v4 |
| better-sqlite3 | 12.8.0 | Database | Synchronous SQLite, zero-dependency, battle-tested |
| Drizzle ORM | 0.45.1 | Schema + queries | Type-safe SQL, lightweight, native better-sqlite3 driver |
| drizzle-kit | 0.31.10 | Migrations | Schema-as-code with `drizzle-kit push` and `drizzle-kit generate` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| proxmox-api | 1.1.1 | Proxmox VE API client | All Proxmox operations (LXC CRUD, status, config). Last published Sep 2024; Proxmox API is stable. |
| node-ssh | 13.2.1 | SSH execution | Deploying configs to LXC containers, managing services inside containers |
| lucide-svelte | 0.577.0 | Icons | Play, Stop, Trash, Settings icons on container cards and navigation |
| bits-ui | 2.16.3 | Headless UI | Tabs (settings), Dialog (delete confirm), accessible primitives styled with Tailwind |
| dotenv | 17.3.1 | Environment config | Load DB encryption key from `.env` file |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| proxmox-api | Direct fetch to Proxmox REST API | Loses TypeScript types but zero dependency risk; keep as fallback |
| bits-ui | shadcn-svelte | More pre-built components but heavier; acceptable to switch later |
| better-sqlite3 | node:sqlite (built-in) | Still experimental in Node 22; avoid for production |

**Installation:**
```bash
# Scaffold SvelteKit project
npx sv create ip-cam-master --template minimal --types ts
cd ip-cam-master

# Add Drizzle via Svelte CLI (configures better-sqlite3 automatically)
npx sv add drizzle

# Add Tailwind via Svelte CLI
npx sv add tailwindcss

# Core dependencies
npm install proxmox-api node-ssh lucide-svelte bits-ui dotenv

# Dev dependencies
npm install -D @sveltejs/adapter-node @types/better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure

```
ip-cam-master/
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle schema (settings, credentials, containers)
│   │   │   │   ├── client.ts          # Database connection singleton
│   │   │   │   └── migrations/        # Drizzle-kit generated migrations
│   │   │   ├── services/
│   │   │   │   ├── proxmox.ts         # Proxmox API client (create, start, stop, delete LXC)
│   │   │   │   ├── crypto.ts          # AES-256-GCM encrypt/decrypt for credentials
│   │   │   │   └── settings.ts        # Settings CRUD with validation
│   │   │   └── proxmox-types.ts       # Additional type helpers if needed
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.svelte     # Navigation sidebar
│   │   │   │   └── AppShell.svelte    # Main layout wrapper
│   │   │   ├── settings/
│   │   │   │   ├── ProxmoxTab.svelte  # Proxmox connection settings form
│   │   │   │   ├── UnifiTab.svelte    # UniFi connection settings form
│   │   │   │   └── CredentialsTab.svelte # Camera credential management
│   │   │   ├── containers/
│   │   │   │   ├── ContainerCard.svelte   # Single container card with status + actions
│   │   │   │   ├── ContainerGrid.svelte   # Card grid layout
│   │   │   │   └── DeleteConfirmDialog.svelte
│   │   │   └── ui/
│   │   │       ├── StatusBadge.svelte # Running/Stopped/Error badge
│   │   │       ├── Banner.svelte      # "Configure settings" banner
│   │   │       └── InlineAlert.svelte # Success/error feedback inline
│   │   └── types.ts                   # Shared TypeScript types
│   ├── routes/
│   │   ├── +layout.svelte             # App shell with sidebar nav
│   │   ├── +layout.server.ts          # Load settings status (configured or not)
│   │   ├── +page.svelte               # Dashboard (placeholder in Phase 1)
│   │   ├── kameras/
│   │   │   ├── +page.svelte           # Container card grid
│   │   │   └── +page.server.ts        # Load containers from Proxmox
│   │   ├── settings/
│   │   │   ├── +page.svelte           # Tabbed settings page
│   │   │   └── +page.server.ts        # Load/save settings
│   │   ├── logs/
│   │   │   └── +page.svelte           # Placeholder page
│   │   └── api/
│   │       ├── proxmox/
│   │       │   ├── validate/+server.ts     # POST: test Proxmox connection
│   │       │   ├── containers/+server.ts   # GET: list, POST: create LXC
│   │       │   └── containers/[vmid]/
│   │       │       ├── +server.ts          # DELETE: destroy container
│   │       │       ├── start/+server.ts    # POST: start container
│   │       │       ├── stop/+server.ts     # POST: stop container
│   │       │       └── restart/+server.ts  # POST: restart container
│   │       └── settings/+server.ts    # PUT: save settings with validation
│   └── app.css                        # Tailwind imports + dark theme base
├── data/                              # SQLite database directory (gitignored)
├── drizzle.config.ts                  # Drizzle-kit configuration
├── .env                               # DB_ENCRYPTION_KEY (gitignored)
├── .env.example                       # Template with placeholder values
├── .gitignore                         # Must include: data/, .env, *.db
├── svelte.config.js
├── vite.config.ts
└── package.json
```

### Pattern 1: SvelteKit Server Routes as API Layer

**What:** Use SvelteKit `+server.ts` files for REST API endpoints and `+page.server.ts` for page data loading. No separate Express/Fastify backend needed.

**When to use:** All server-side operations (Proxmox API calls, database reads/writes, credential encryption).

**Example:**
```typescript
// src/routes/api/proxmox/containers/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProxmoxClient } from '$lib/server/services/proxmox';

export const GET: RequestHandler = async () => {
  const proxmox = await getProxmoxClient();
  const containers = await proxmox.nodes.$(nodeName).lxc.$get();
  return json(containers);
};

export const POST: RequestHandler = async ({ request }) => {
  const { vmid, hostname, ostemplate, memory, cores, net0 } = await request.json();
  const proxmox = await getProxmoxClient();

  // Idempotency check (LXC-07)
  const existing = await proxmox.nodes.$(nodeName).lxc.$get();
  if (existing.find(c => c.vmid === vmid)) {
    // Update config instead of creating
    await proxmox.nodes.$(nodeName).lxc.$(vmid).config.$put({ memory, cores, net0 });
    return json({ status: 'updated', vmid });
  }

  const upid = await proxmox.nodes.$(nodeName).lxc.$post({
    vmid, hostname, ostemplate, memory, cores, net0,
    start: false
  });
  return json({ status: 'created', vmid, upid });
};
```

### Pattern 2: Proxmox API Token Authentication

**What:** Connect to Proxmox using API tokens (not password tickets). API tokens do NOT require CSRF tokens for write operations.

**When to use:** All Proxmox API calls.

**Example:**
```typescript
// src/lib/server/services/proxmox.ts
import proxmoxApi from 'proxmox-api';
import { getSettings } from './settings';

// Proxmox uses self-signed certs by default
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function getProxmoxClient() {
  const settings = await getSettings();
  if (!settings.proxmoxHost || !settings.proxmoxTokenId || !settings.proxmoxTokenSecret) {
    throw new Error('Proxmox not configured');
  }

  return proxmoxApi({
    host: settings.proxmoxHost,
    tokenID: settings.proxmoxTokenId,     // format: user@realm!tokenname
    tokenSecret: settings.proxmoxTokenSecret  // UUID
  });
}

export async function validateProxmoxConnection(): Promise<{
  valid: boolean;
  error?: string;
  permissions?: string[];
}> {
  try {
    const proxmox = await getProxmoxClient();
    const nodes = await proxmox.nodes.$get();
    if (!nodes || nodes.length === 0) {
      return { valid: false, error: 'No nodes found. Check API token permissions.' };
    }
    // Try listing containers to verify LXC permissions
    const node = nodes[0].node;
    await proxmox.nodes.$(node).lxc.$get();
    return { valid: true };
  } catch (err: any) {
    if (err.message?.includes('401')) {
      return { valid: false, error: 'Authentication failed. Verify token ID and secret.' };
    }
    return { valid: false, error: `Connection failed: ${err.message}` };
  }
}
```

### Pattern 3: Encrypted Credential Storage

**What:** Store secrets in SQLite encrypted with AES-256-GCM. The encryption key lives in `.env` (outside git).

**When to use:** All credentials -- Proxmox token secret, UniFi password, camera passwords.

**Example:**
```typescript
// src/lib/server/services/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = env.DB_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('DB_ENCRYPTION_KEY must be set in .env (minimum 32 chars)');
  }
  return Buffer.from(key.slice(0, 32), 'utf-8');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(stored: string): string {
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}
```

### Pattern 4: VAAPI Device Passthrough via API

**What:** Configure `/dev/dri/renderD128` passthrough on LXC containers using the Proxmox API (PVE 8.1+). Uses the `dev0` parameter on PUT config.

**When to use:** After LXC container creation, before first start.

**Example:**
```typescript
// Configure VAAPI passthrough (LXC-02)
export async function configureVaapiPassthrough(
  proxmox: ReturnType<typeof proxmoxApi>,
  node: string,
  vmid: number
) {
  // PVE 8.1+ supports dev0 parameter for device passthrough
  // This replaces manual lxc.cgroup2 rules
  await proxmox.nodes.$(node).lxc.$(vmid).config.$put({
    dev0: '/dev/dri/renderD128,mode=0666'
  } as any); // Type assertion needed if proxmox-api types don't include dev0 yet

  // If proxmox-api doesn't support dev0, fallback to direct API call:
  // await fetch(`https://${host}:8006/api2/json/nodes/${node}/lxc/${vmid}/config`, {
  //   method: 'PUT',
  //   headers: { 'Authorization': `PVEAPIToken=${tokenId}=${tokenSecret}` },
  //   body: new URLSearchParams({ dev0: '/dev/dri/renderD128,mode=0666' })
  // });
}
```

### Pattern 5: Dark Theme with Tailwind 4

**What:** Force dark theme using Tailwind 4 CSS-first configuration. No JavaScript theme toggle needed.

**When to use:** App-wide styling.

**Example:**
```css
/* src/app.css */
@import 'tailwindcss';

@theme {
  --color-bg-primary: #0f1419;
  --color-bg-secondary: #1a1f2e;
  --color-bg-card: #1e2433;
  --color-bg-input: #252b3b;
  --color-border: #2d3548;
  --color-text-primary: #e4e8f1;
  --color-text-secondary: #8b95a8;
  --color-accent: #3b82f6;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
}
```

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary">
  <!-- Sidebar + main content -->
  {@render children()}
</div>
```

### Anti-Patterns to Avoid

- **Password-based Proxmox auth:** Tickets expire, require CSRF tokens for writes, and break after session timeout. Always use API tokens.
- **Storing encryption key in SQLite:** The key that encrypts credentials must NOT be in the same database. Keep it in `.env` only.
- **Global `NODE_TLS_REJECT_UNAUTHORIZED`:** Set it narrowly for Proxmox client only, not globally. Use the `proxmox-api` `tlsOptions` config if available.
- **Polling Proxmox API too frequently:** Container status does not change often. Poll every 15-30 seconds for the card grid, not continuously.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proxmox API client | Custom REST wrapper with auth handling | `proxmox-api` npm (with fetch fallback) | Typed API surface covering 100% of endpoints; handles auth header format |
| Database migrations | Manual SQL scripts | `drizzle-kit push` / `drizzle-kit generate` | Schema-as-code with type safety; migrations auto-generated |
| Tabs component | Custom tab state management | `bits-ui` Tabs primitive | Accessible, keyboard nav, ARIA attributes handled |
| Confirmation dialog | Custom modal overlay | `bits-ui` Dialog primitive | Focus trapping, escape key, backdrop click, accessibility |
| Icons | SVG files or custom icon component | `lucide-svelte` | Tree-shakeable, consistent sizing, 1400+ icons |
| Project scaffolding | Manual file structure | `npx sv create` + `npx sv add` | Correct SvelteKit config, Vite setup, TypeScript config out of the box |

**Key insight:** SvelteKit's `+server.ts` routes eliminate the need for a separate backend framework. The Svelte CLI (`npx sv add drizzle`) automates the database setup that would otherwise require 5-6 manual configuration steps.

## Common Pitfalls

### Pitfall 1: proxmox-api Types Don't Include dev0 Parameter

**What goes wrong:** The `proxmox-api` package types were generated from an older Proxmox API schema. The `dev0` parameter for device passthrough (added in PVE 8.1) may not be in the type definitions, causing TypeScript errors.
**Why it happens:** Package last published Sep 2024 (v1.1.1). PVE 8.1 added device passthrough in late 2023, but the types may not have been regenerated.
**How to avoid:** Use `as any` type assertion for the dev0 parameter, or prepare a direct `fetch` fallback for the PUT config call. Validate early in development.
**Warning signs:** TypeScript error "Property 'dev0' does not exist on type..." when calling config.$put().

### Pitfall 2: Proxmox API Token Format Confusion

**What goes wrong:** Authentication fails with 401 despite correct credentials. The token ID and token secret are easily confused.
**Why it happens:** Token ID format is `user@realm!tokenname` (e.g., `ipcammaster@pve!mytoken`). Token secret is a UUID. The `Authorization` header format is `PVEAPIToken=user@realm!tokenname=secret-uuid`. Getting any part wrong yields a generic 401.
**How to avoid:** Show clear field labels in Settings UI: "Token ID (format: user@realm!tokenname)" and "Token Secret (UUID from Proxmox)". Validate format client-side before attempting connection.
**Warning signs:** 401 errors even with seemingly correct credentials; `data: null` responses.

### Pitfall 3: VAAPI Passthrough Fails Silently

**What goes wrong:** Container sees `/dev/dri` but ffmpeg falls back to CPU transcoding without error. CPU spikes to 100%+.
**Why it happens:** Three things must align: device passthrough in LXC config, correct device permissions (mode 0666), and VAAPI drivers installed inside the container. The `dev0:` parameter handles the first two but drivers must be installed separately.
**How to avoid:** After container creation, verify with `vainfo` command inside the container. Include `intel-media-va-driver` in the container provisioning script. Check for `/dev/dri/renderD128` existence.
**Warning signs:** `vainfo` returns "No VA display found"; CPU usage exceeds 50% for single stream.

### Pitfall 4: SQLite File in Git

**What goes wrong:** The SQLite database (containing encrypted credentials) gets committed to the public GitHub repo.
**Why it happens:** `.gitignore` is created after the first commit, or the data directory isn't excluded, or the developer tests with a DB file in the project root.
**How to avoid:** Create `.gitignore` BEFORE `git init` with patterns: `data/`, `*.db`, `*.sqlite`, `.env`. Use a fixed path like `data/ip-cam-master.db` and ensure the directory is gitignored.
**Warning signs:** `git status` shows `.db` files as untracked; `data/` directory not in `.gitignore`.

### Pitfall 5: SvelteKit Server-Only Code Leaking to Client

**What goes wrong:** Proxmox API credentials or database code gets bundled into client-side JavaScript.
**Why it happens:** Importing from `$lib/server/` in a `.svelte` file or `+page.ts` (without `.server`) causes the server module to be included in the client bundle.
**How to avoid:** All database and API code goes in `$lib/server/` only. Use `+page.server.ts` (not `+page.ts`) for data loading. SvelteKit enforces this boundary -- imports from `$lib/server/` in client code will throw a build error.
**Warning signs:** Build error: "Cannot import $lib/server/... into client-side code".

### Pitfall 6: Proxmox Self-Signed Certificate Rejection

**What goes wrong:** All API calls fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN`.
**Why it happens:** Proxmox VE uses a self-signed certificate by default. Node.js rejects self-signed certs.
**How to avoid:** Set `NODE_TLS_REJECT_UNAUTHORIZED=0` in the environment (or pass `rejectUnauthorized: false` to the HTTP agent). Document this as a known requirement. For production, recommend the user install a proper cert or use the Proxmox CA.
**Warning signs:** HTTPS connection errors to port 8006; works in browser (which has cert exception) but fails in Node.

## Code Examples

### Drizzle Schema for Settings and Credentials

```typescript
// src/lib/server/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(), // encrypted for sensitive values
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const containers = sqliteTable('containers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vmid: integer('vmid').notNull().unique(),
  hostname: text('hostname').notNull(),
  cameraName: text('camera_name'),
  cameraIp: text('camera_ip'),
  cameraType: text('camera_type'), // 'mobotix' | 'loxone' | 'onvif' | 'other'
  status: text('status').notNull().default('unknown'), // cached status
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString())
});

export const credentials = sqliteTable('credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(), // e.g., "Mobotix Front Door"
  username: text('username').notNull(),
  password: text('password').notNull(), // AES-256-GCM encrypted
  cameraIp: text('camera_ip'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString())
});
```

### Container Card Component

```svelte
<!-- src/lib/components/containers/ContainerCard.svelte -->
<script lang="ts">
  import { Play, Square, RotateCw, Trash2 } from 'lucide-svelte';
  import StatusBadge from '$lib/components/ui/StatusBadge.svelte';

  let { container, onAction } = $props<{
    container: {
      vmid: number;
      hostname: string;
      cameraName?: string;
      cameraIp?: string;
      status: 'running' | 'stopped' | 'error' | 'unknown';
      cpu?: number;
      memory?: { used: number; total: number };
    };
    onAction: (vmid: number, action: string) => void;
  }>();
</script>

<div class="bg-bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors">
  <div class="flex items-center justify-between mb-3">
    <StatusBadge status={container.status} />
    <span class="text-text-secondary text-sm">VMID {container.vmid}</span>
  </div>

  <h3 class="text-text-primary font-medium">
    {container.cameraName ?? container.hostname}
  </h3>
  {#if container.cameraIp}
    <p class="text-text-secondary text-sm">{container.cameraIp}</p>
  {/if}

  {#if container.cpu !== undefined || container.memory}
    <div class="mt-2 text-xs text-text-secondary space-y-1">
      {#if container.cpu !== undefined}
        <div>CPU: {(container.cpu * 100).toFixed(1)}%</div>
      {/if}
      {#if container.memory}
        <div>RAM: {Math.round(container.memory.used / 1024 / 1024)}MB / {Math.round(container.memory.total / 1024 / 1024)}MB</div>
      {/if}
    </div>
  {/if}

  <div class="mt-3 flex gap-2 border-t border-border pt-3">
    <button onclick={() => onAction(container.vmid, 'start')}
      class="p-1.5 rounded hover:bg-success/20 text-success" title="Start">
      <Play size={16} />
    </button>
    <button onclick={() => onAction(container.vmid, 'stop')}
      class="p-1.5 rounded hover:bg-warning/20 text-warning" title="Stop">
      <Square size={16} />
    </button>
    <button onclick={() => onAction(container.vmid, 'restart')}
      class="p-1.5 rounded hover:bg-accent/20 text-accent" title="Restart">
      <RotateCw size={16} />
    </button>
    <button onclick={() => onAction(container.vmid, 'delete')}
      class="p-1.5 rounded hover:bg-danger/20 text-danger ml-auto" title="Delete">
      <Trash2 size={16} />
    </button>
  </div>
</div>
```

### Settings Save with Auto-Validation (D-06)

```typescript
// src/routes/api/settings/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { settings } from '$lib/server/db/schema';
import { encrypt } from '$lib/server/services/crypto';
import { validateProxmoxConnection } from '$lib/server/services/proxmox';
import { eq } from 'drizzle-orm';

const SENSITIVE_KEYS = ['proxmox_token_secret', 'unifi_password'];

export const PUT: RequestHandler = async ({ request }) => {
  const data = await request.json();
  const results: Record<string, { saved: boolean; validation?: { valid: boolean; error?: string } }> = {};

  for (const [key, value] of Object.entries(data)) {
    const isEncrypted = SENSITIVE_KEYS.includes(key);
    const storedValue = isEncrypted ? encrypt(value as string) : (value as string);

    await db.insert(settings)
      .values({ key, value: storedValue, encrypted: isEncrypted, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value: storedValue, updatedAt: new Date().toISOString() } });

    results[key] = { saved: true };
  }

  // Auto-validate Proxmox connection if Proxmox settings were saved (D-06)
  if (data.proxmox_host || data.proxmox_token_id || data.proxmox_token_secret) {
    const validation = await validateProxmoxConnection();
    results['proxmox_validation'] = { saved: true, validation };
  }

  return json(results);
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind config file (tailwind.config.js) | CSS-first config via `@theme` directive | Tailwind v4 (2025) | No config file needed; themes defined in CSS |
| SvelteKit manual setup | `npx sv create` + `npx sv add` CLI | Svelte CLI 2024 | Automated project scaffolding with add-ons |
| Proxmox LXC cgroup rules for device passthrough | `dev0:` parameter in LXC config | PVE 8.1 (late 2023) | No manual cgroup rules needed; works with unprivileged containers |
| Svelte stores ($: reactive) | Svelte 5 runes ($state, $derived, $effect) | Svelte 5 (late 2024) | New reactivity model; do NOT use legacy $: syntax |
| Drizzle manual setup | `npx sv add drizzle` auto-setup | Svelte CLI 2024 | Auto-configures DB client, schema location, drizzle-kit |

**Deprecated/outdated:**
- **Svelte 4 reactive declarations (`$:`):** Replaced by Svelte 5 runes. Use `$state()`, `$derived()`, `$effect()`.
- **Tailwind `darkMode: 'class'` config:** In Tailwind v4, dark mode is handled differently -- use `@theme` or `@variant dark` in CSS.
- **Proxmox `lxc.cgroup2.devices.allow` for GPU passthrough:** Replaced by `dev0:` parameter in PVE 8.1+.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (comes with SvelteKit) |
| Config file | `vite.config.ts` (Vitest uses Vite config) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Settings form saves Proxmox config to SQLite | unit | `npx vitest run src/lib/server/services/settings.test.ts -t "save proxmox"` | Wave 0 |
| INFRA-02 | Proxmox connection validation returns success/error | unit | `npx vitest run src/lib/server/services/proxmox.test.ts -t "validate"` | Wave 0 |
| INFRA-03 | Settings form saves UniFi config to SQLite | unit | `npx vitest run src/lib/server/services/settings.test.ts -t "save unifi"` | Wave 0 |
| INFRA-04 | Credentials stored encrypted in SQLite | unit | `npx vitest run src/lib/server/services/crypto.test.ts` | Wave 0 |
| INFRA-05 | DB file exists in data/ directory, not in git-tracked path | unit | `npx vitest run src/lib/server/db/client.test.ts` | Wave 0 |
| LXC-01 | Proxmox service creates LXC container with correct params | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "create"` | Wave 0 |
| LXC-02 | VAAPI passthrough configured on container | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "vaapi"` | Wave 0 |
| LXC-05 | Container start/stop/restart calls correct API endpoints | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "lifecycle"` | Wave 0 |
| LXC-06 | Container delete requires VMID and calls DELETE endpoint | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "delete"` | Wave 0 |
| LXC-07 | Container creation checks for existing VMID first | unit (mocked) | `npx vitest run src/lib/server/services/proxmox.test.ts -t "idempotent"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/server/services/proxmox.test.ts` -- covers LXC-01, LXC-02, LXC-05, LXC-06, LXC-07, INFRA-02
- [ ] `src/lib/server/services/settings.test.ts` -- covers INFRA-01, INFRA-03
- [ ] `src/lib/server/services/crypto.test.ts` -- covers INFRA-04
- [ ] `src/lib/server/db/client.test.ts` -- covers INFRA-05
- [ ] Vitest config: already included by SvelteKit scaffold
- [ ] Test utilities: mock factory for proxmox-api client

## Open Questions

1. **proxmox-api `dev0` type support**
   - What we know: The package types are auto-generated from Proxmox API schema. PVE 8.1+ supports `dev0`.
   - What's unclear: Whether v1.1.1 includes `dev0` in its types.
   - Recommendation: Try using it directly first. If TypeScript rejects it, use `as any` assertion or switch to direct fetch for config updates only.

2. **Container OS template for LXC**
   - What we know: LXC creation requires an `ostemplate` parameter (e.g., `local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst`).
   - What's unclear: Which template is already available on the user's Proxmox host at 192.168.3.16.
   - Recommendation: List available templates via API (`GET /nodes/{node}/storage/{storage}/content?content=vztmpl`) and let the user select or auto-detect a Debian 12 template.

3. **Proxmox node name**
   - What we know: The Proxmox host is at 192.168.3.16.
   - What's unclear: The exact node name (could be `pve`, `proxi3`, etc.).
   - Recommendation: Auto-detect via `GET /nodes` API call. Store the node name in settings after first successful connection.

## Sources

### Primary (HIGH confidence)
- [proxmox-api npm](https://www.npmjs.com/package/proxmox-api) -- v1.1.1, TypeScript Proxmox API client, last published Sep 2024
- [proxmox-api GitHub](https://github.com/UrielCh/proxmox-api) -- API token auth example, path mapping convention
- [Proxmox VE API docs](https://pve.proxmox.com/wiki/Proxmox_VE_API) -- REST API reference, auth header format
- [SvelteKit project structure](https://kit.svelte.dev/docs/project-structure) -- Official routing and file conventions
- [Tailwind CSS SvelteKit guide](https://tailwindcss.com/docs/guides/sveltekit) -- v4 setup with @tailwindcss/vite
- [Svelte CLI drizzle add-on](https://svelte.dev/docs/cli/drizzle) -- Auto-setup for Drizzle + SQLite + better-sqlite3
- [Drizzle ORM SQLite](https://orm.drizzle.team/docs/get-started/sqlite-new) -- Official setup guide

### Secondary (MEDIUM confidence)
- [Proxmox device passthrough forum](https://forum.proxmox.com/threads/lxc-device-passthrough-proxmox-8-1.137773/) -- PVE 8.1+ dev0 syntax confirmed
- [Proxmox LXC iGPU passthrough](https://forum.proxmox.com/threads/proxmox-lxc-igpu-passthrough.141381/) -- VAAPI configuration details
- [SvelteKit + SQLite + Drizzle guide](https://fullstacksveltekit.com/blog/sveltekit-sqlite-drizzle) -- Integration walkthrough
- [Proxmox forum: API token permissions](https://forum.proxmox.com/threads/api-token-config.92465/) -- Privilege separation details

### Tertiary (LOW confidence)
- proxmox-api dev0 type support -- not verified, needs early validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via npm registry on 2026-03-22
- Architecture: HIGH -- SvelteKit patterns are well-documented, Proxmox API is stable REST
- Pitfalls: HIGH -- verified across Proxmox forums, go2rtc issues, and prior research documents
- proxmox-api dev0 support: LOW -- not verified whether v1.1.1 types include PVE 8.1+ parameters

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days -- stable domain, no fast-moving dependencies)
