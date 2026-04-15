# Phase 11 — CONTEXT

**Goal**: User can discover their Bambu printer, enter credentials securely, and receive a clear pre-flight verdict before any LXC is provisioned.

**Requirements**: BAMBU-03, BAMBU-04, BAMBU-05, BAMBU-06, BAMBU-07, BAMBU-08, BAMBU-09, BAMBU-10

**Ground truth source**: `.planning/research/H2C-FIELD-NOTES.md` (validated 2026-04-15 against real H2C "Bob the Builder" — fw 01.01.05.00, model code O1C2). Cite over STACK.md when they conflict.

> Mode: discuss-phase ran in `--auto` — defensible defaults chosen by Claude based on field-note ground truth, existing codebase patterns, and the v1.2 roadmap scope.

---

## Existing assets to reuse (do NOT rebuild)

| Asset | Path | How Phase 11 uses it |
|-------|------|----------------------|
| `cameras` table | `src/lib/server/db/schema.ts` | **Extend** with two nullable columns (`access_code`, `serial_number`) — additive migration |
| `crypto.ts` service | `src/lib/server/services/crypto.ts` | AES-256-GCM helpers — wrap Access Code on write, unwrap on read |
| Discovery API route | `src/routes/api/discovery/+server.ts` | **Augment** with Bambu SSDP results merged into the same response (don't fork the route) |
| Onboarding wizard | `src/lib/components/onboarding/`, `src/routes/kameras/onboarding/` | **Extend** with a Bambu branch (different credential fields) |
| `test-connection` route | `src/routes/api/onboarding/test-connection/+server.ts` | **Extend** to dispatch on cameraType — Bambu gets the new pre-flight handler |

## Decisions (locked — research/planner do not re-ask)

### 1. Database schema — extend `cameras` table, additive only

- Add two **nullable** columns to existing `cameras` table:
  - `access_code TEXT` — AES-256-GCM ciphertext, NULL for non-Bambu rows
  - `serial_number TEXT` — plaintext (also appears unencrypted in SSDP broadcasts, so no security gain from encrypting), NULL for non-Bambu rows
- For Bambu rows: `username = 'bblp'` (hardcoded constant), `password` column unused (NULL or empty string), `access_code` carries the secret
- Cameratype enum extended: `'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu'`
- `transport` field: **deferred** — not introduced in Phase 11. v1.2 is LAN-only; cloud transport is v1.3 territory. Re-evaluate when v1.3 is scoped.
- Migration via drizzle-kit (`npm run db:generate`); rollout = `npm run db:migrate` on App-VM. Existing rows untouched. (BAMBU-08, BAMBU-09)

### 2. Discovery — add SSDP listener, merge into existing /api/discovery response

- New service module: `src/lib/server/services/bambu-discovery.ts`
  - UDP socket bound to **port 2021** (per H2C-FIELD-NOTES — NOT 1990)
  - Listens for `NT: urn:bambulab-com:device:3dprinter:1`
  - Extracts: source IP, `USN:` (= serial), `DevModel.bambu.com:` (allowlist `O1C2`, `H2C`, `H2D`, plus `X1C`, `P1S`, `A1` for forward-compat — non-H2C still surfaces as "Bambu Lab <model>")
  - Window: open socket, listen 6 seconds (Bambu broadcasts every ~3–5s), close, return de-duped device list
- `/api/discovery/+server.ts` runs the existing HTTP-probe scan AND the SSDP listener **in parallel** (`Promise.all`), merges results, dedupes by IP. SSDP-discovered Bambu rows annotated with `type: 'bambu'`. (BAMBU-03, BAMBU-04, BAMBU-06)
- Discovered Bambu rows include `lanModeHint: 'likely_on'` because SSDP broadcasts only fire when LAN Mode is enabled — useful UX signal but **not authoritative** (real check is in pre-flight).
- Manual-add path: extend existing manual-add UI with a "Bambu Lab" device-type radio, accepting IP only at this stage (Serial + Access Code captured in the wizard credential step). (BAMBU-05)

### 3. Pre-flight — new endpoint with structured error taxonomy

- New API route: `src/routes/api/onboarding/bambu/preflight/+server.ts`
  - Input: `{ ip, serialNumber, accessCode }`
  - Three sequential checks (each with hard timeout, never run in parallel — H2C single-connection limit per PITFALLS.md):
    1. **TCP reachability**: `net.connect(322, ip)` with 3s timeout → `PRINTER_UNREACHABLE` if fail
    2. **RTSPS handshake**: spawn `ffprobe` with `rtsp_transport=tcp tls_verify=0`, URL `rtsps://bblp:<code>@<ip>:322/streaming/live/1`, 12s timeout. Parse stderr:
       - exit code 0 → OK
       - `401 Unauthorized` → `WRONG_ACCESS_CODE`
       - timeout / no response → `RTSPS_HANDSHAKE_HUNG` (Live555 wedged — surface power-cycle hint per PITFALLS Pitfall 1)
       - connection refused → `LAN_MODE_OFF`
    3. **MQTT TLS handshake**: use `mqtt` npm package — `mqtt.connectAsync('mqtts://<ip>:8883', { username: 'bblp', password: code, rejectUnauthorized: false, connectTimeout: 5000 })`, immediately `end()` on success. **Do NOT shell out to mosquitto_sub** — broken on Debian 13 with self-signed cert (proven in Phase 10).
       - auth error → `WRONG_ACCESS_CODE`
       - connect timeout → `LAN_MODE_OFF` (port 8883 blocked when LAN Mode off)
  - Output: `{ ok: true }` OR `{ ok: false, error: 'CODE', hint: 'human-readable German' }`
- UI: dedicated Bambu pre-flight result screen with one of the four error codes mapped to actionable copy. (BAMBU-10)

### 4. Credential storage — reuse existing crypto, no new dependency

- `crypto.ts` exports `encrypt(plaintext)` / `decrypt(ciphertext)` using AES-256-GCM with key from `IPCM_DB_KEY` env var (already established convention)
- Bambu Access Code = 8 ASCII chars → encrypt → base64 → store in `cameras.access_code`
- Read path: only the pre-flight handler and (later, Phase 12) the go2rtc config generator decrypt; never expose plaintext to the SvelteKit client. (BAMBU-07)

### 5. Wizard UX — minimum-viable in Phase 11

- Add a "Bambu Lab" tile to the device-type chooser in the existing onboarding wizard
- Bambu credential step: 2 fields — Serial Number (text), Access Code (text, monospace, 8-char hint)
- Inline help links deferred to Phase 14 (where the polished wizard ships); Phase 11 ships functional, not polished. (BAMBU-07; polish = Phase 14)

---

## Out of scope for Phase 11 (explicit deferrals)

- **LXC provisioning** for Bambu cameras → Phase 12
- **go2rtc config generation** → Phase 12
- **UniFi Protect adoption** → Phase 13
- **MQTT subscription for print-state / Adaptive Mode** → Phase 14 (Phase 11 only does a 1-shot MQTT *handshake* check, no subscribe loop)
- **Wizard polish & inline help** → Phase 14
- **`transport` column / cloud-mode field** → v1.3
- **Bird's-Eye `/streaming/live/2`** → confirmed absent on H2C; permanently out of v1.2 scope per REQUIREMENTS

---

## Open questions for the planner

None — all gray areas decided above. Planner should produce 3–4 plans:

- **Plan 11-01**: schema migration + crypto wiring (Wave 1 — blocks everything)
- **Plan 11-02**: SSDP discovery service + /api/discovery integration (Wave 2)
- **Plan 11-03**: pre-flight handler + error taxonomy (Wave 2 — parallel with 11-02)
- **Plan 11-04**: wizard branch (device-type tile + Bambu credential step + manual-add) (Wave 3 — depends on 01 + 03)

---

## Pitfalls to encode (from PITFALLS.md + Phase 10 Findings)

- Live555 hang → ALL ffprobe calls in pre-flight need hard `timeout` (10–15s)
- H2C single-connection limit → never run RTSPS + MQTT probes in parallel
- mosquitto-clients 2.0.21 cannot talk to H2C self-signed cert → use Node `mqtt` package
- `print.print_type = 'cloud'` even in LAN-only operation → never use it as LAN-mode signal
- TLS cert issuer is model-versioned (`BBL Device CA O1C2-V2`) → don't pin issuer CN
- DevModel = `O1C2` for H2C → display label "Bambu Lab H2C" but match on `O1C2` in code

## Success for Phase 11 (from ROADMAP.md)

- [ ] User sees their Bambu H2C in the discovery list (labeled "Bambu Lab H2C", with IP + serial)
- [ ] User can manually add a Bambu printer by IP; UI differentiates Bambu rows from Mobotix/Loxone/ONVIF
- [ ] User enters 8-digit Access Code + Serial → values land AES-256-GCM encrypted in SQLite without breaking existing rows
- [ ] Pre-flight returns one of four distinct error codes (LAN Mode off / wrong code / unreachable / handshake hung) — never an opaque error
