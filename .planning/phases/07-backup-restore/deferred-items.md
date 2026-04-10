# Deferred items — Phase 07 Backup & Restore

Pre-existing `svelte-check` errors discovered while running Task 2 verification. None are caused by this plan's changes; all live in unrelated files. Logged here per GSD deviation scope rules.

## Pre-existing TypeScript errors (unrelated to Phase 07)

1. `src/lib/server/services/onboarding.ts:463` — `Property 'audioCodec' is missing in type ... StreamInfo`
2. `src/lib/server/services/onboarding.ts:468` — same `audioCodec` missing
3. `src/lib/server/services/onboarding.ts:514` — `Property 'nodes' does not exist on type 'Promise<Api>'`
4. `src/routes/api/cameras/[id]/snapshot/+server.ts:49` — `Buffer<ArrayBufferLike>` not assignable to `BodyInit`
5. `src/routes/api/cameras/status/+server.ts:29` — `CameraCardData` missing `cameraModel`, `firmwareVersion`, `liveFps`
6. `src/routes/api/cameras/status/+server.ts:139` — same `CameraCardData` mismatch
7. `src/lib/components/cameras/CameraDetailCard.svelte:135` — `CameraStatus` vs `'native-onvif'` comparison
8. `src/routes/+page.svelte:85` — same `'native-onvif'` comparison
9. `src/routes/+page.svelte:401` — same `'native-onvif'` comparison

These errors exist on `main` before this plan and do not block the build (`npm run build` succeeds). The Phase 07 backup routes and service compile cleanly with no new errors.

## Recommended action

Address in a dedicated `/gsd:quick` pass for type cleanup, or fold into a future maintenance phase. Do not block Phase 07 on them.
