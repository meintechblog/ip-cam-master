# Phase 1: Foundation and Proxmox Integration - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

SvelteKit app skeleton with dark-themed UI, settings page for infrastructure connections (Proxmox, UniFi Dream Machine), secure credential storage in SQLite, and LXC container lifecycle management (create with VAAPI passthrough, start, stop, restart, delete). This phase delivers the foundation that all subsequent phases build on.

</domain>

<decisions>
## Implementation Decisions

### App Navigation
- **D-01:** Claude's discretion on navigation style (sidebar vs top-nav) — user deferred choice
- **D-02:** Dark theme (like UniFi OS / Proxmox Dark Mode) — no light mode toggle needed
- **D-03:** Four main navigation areas: Dashboard (placeholder), Kameras (container management), Settings, Logs/Status (placeholder)
- **D-04:** Dashboard and Logs/Status are placeholder pages in Phase 1 — real content comes in Phase 4 and v2

### Settings UI
- **D-05:** Settings organized with tabs: Proxmox, UniFi, Credentials
- **D-06:** Connection validation is automatic on save — inline feedback (success/error), no separate test button
- **D-07:** No setup wizard — user goes directly to Settings page on first launch
- **D-08:** If settings are not configured, show a clear banner/hint directing to Settings

### Container View
- **D-09:** Containers displayed as card grid — one card per LXC container
- **D-10:** Each card shows: status badge (running/stopped/error with color), camera name + IP, VMID + hostname, resource usage (CPU/RAM if available from Proxmox API)
- **D-11:** Container actions as inline icon buttons directly on each card: Play (start), Stop, Restart, Trash (delete with confirmation)
- **D-12:** Delete action requires confirmation dialog before execution

### Proxmox Authentication
- **D-13:** Proxmox access via API Token (PVEAPIToken) — not root SSH. User creates token in Proxmox UI and enters it in Settings.
- **D-14:** Settings form fields: Proxmox host IP/hostname, API token ID, API token secret, target storage, network bridge, VMID range start
- **D-15:** App validates token permissions on save and shows specific feedback (e.g., "Missing VM.Allocate permission")

### UniFi Dream Machine Access
- **D-16:** Primary access via UniFi OS API (local, authenticated) for Protect status and camera management
- **D-17:** SSH access to UDM is a secondary fallback for log reading — internal/testing only, not exposed in the public distribution initially
- **D-18:** Settings form: UDM IP/hostname, UniFi OS username, UniFi OS password (stored in SQLite credentials, never in config files)

### Claude's Discretion
- Navigation layout style (sidebar recommended for infra tool UIs)
- Exact component library / styling approach (Tailwind recommended per research)
- SQLite schema design for credentials and settings
- Container card layout details (spacing, typography, icon choices)
- Error state designs and empty state content
- Responsive behavior on smaller screens

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research findings
- `.planning/research/STACK.md` — Technology stack decisions (SvelteKit 2, SQLite, Drizzle ORM, proxmox-api, unifi-protect)
- `.planning/research/ARCHITECTURE.md` — System structure, component boundaries, Proxmox API integration patterns
- `.planning/research/PITFALLS.md` — VAAPI passthrough gotchas, credential leakage risks, Proxmox API token permissions

### Project context
- `.planning/PROJECT.md` — Infrastructure details (Proxmox host 192.168.3.16, VM 192.168.3.233, UDM 192.168.3.1)
- `.planning/REQUIREMENTS.md` — Phase 1 requirements: INFRA-01..05, LXC-01, LXC-02, LXC-05..07

### External references
- Proxmox VE API documentation: https://pve.proxmox.com/pve-docs/api-viewer/
- go2rtc GitHub for config format reference
- UniFi Protect npm package (unifi-protect v4.27.x) for API patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, Phase 1 creates the foundation

### Established Patterns
- None yet — this phase establishes the patterns all subsequent phases follow

### Integration Points
- SQLite database will be shared across all features (credentials, camera configs, settings)
- Navigation structure established here will be extended in every subsequent phase
- Proxmox API client created here will be reused in Phases 2, 3, and 5
- Container management UI will be extended with camera-specific info in Phase 2+

</code_context>

<specifics>
## Specific Ideas

- UI should feel like UniFi OS or Proxmox's dark mode — professional infrastructure tool aesthetic
- Container cards should show at-a-glance health without clicking into details
- Settings validation should feel immediate — no "save and wait" pattern, inline feedback
- The reference style page at 192.168.3.191 was not reachable for design reference — proceed with standard dark infra-tool aesthetic

</specifics>

<deferred>
## Deferred Ideas

- Setup wizard for first-time users — user chose direct settings page instead, but might revisit for one-line-install experience (Phase 5)
- Light/dark mode toggle — user chose dark-only, could be added later if community requests it

</deferred>

---

*Phase: 01-foundation-and-proxmox-integration*
*Context gathered: 2026-03-22*
