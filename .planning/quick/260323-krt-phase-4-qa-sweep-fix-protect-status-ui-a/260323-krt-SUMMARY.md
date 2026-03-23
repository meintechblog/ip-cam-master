---
quick_id: 260323-krt
description: "Phase 4 QA sweep — fix Protect status UI and logic issues"
status: complete
date: 2026-03-23
commit: fe32585
---

## What Changed

### 1. ONVIF cameras: replace "Protect-Status prüfen" button with auto-display
- Removed misleading button that opened AdoptionGuide
- Now shows inline Protect status automatically (adopted/getrennt/nicht in Protect)
- Same visual style as pipeline cameras' Protect section

### 2. "In Protect aufnehmen" only shows when Protect is configured
- Added `protectConfigured` field to CameraCardData (from API)
- Button hidden when Protect API not configured (previously showed for all cameras)
- Prevents confusing "adopt" action when there's no Protect to adopt into

### 3. Status labels fixed for unconfigured Protect
- Pipeline card: "Nicht konfiguriert" instead of "Wartend"
- Dashboard table: "—" instead of "wartend"
- Pipeline card: "Nicht adoptiert" instead of "Wird adoptiert" when Protect sees camera but hasn't adopted

### 4. Scheduler guards SSH scanning
- Checks `unifi_host` setting before attempting SSH scan
- Silently skips when not configured (no error spam on fresh installs)

### 5. AdoptionGuide handles native ONVIF cameras
- Accepts `cameraIp` and `isNativeOnvif` props
- Uses camera IP (not container IP) for native ONVIF
- Different instructions: "direkt per ONVIF eingebunden — kein Container noetig"

### 6. Adopt API handles native ONVIF
- Detects native ONVIF cameras (vmid=0 or status/type check)
- Skips ONVIF server verification (they ARE ONVIF devices)
- Returns ONVIF-specific adoption instructions

## Files Modified
- `src/lib/types.ts` — added `protectConfigured` to CameraCardData
- `src/routes/api/cameras/status/+server.ts` — pass protectConfigured flag
- `src/lib/components/cameras/CameraDetailCard.svelte` — all UI fixes
- `src/routes/+page.svelte` — dashboard table fix
- `src/lib/server/services/scheduler.ts` — guard SSH scan
- `src/lib/components/cameras/AdoptionGuide.svelte` — native ONVIF support
- `src/routes/api/protect/adopt/+server.ts` — native ONVIF handling
