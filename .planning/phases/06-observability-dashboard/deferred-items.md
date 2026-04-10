# Deferred Items — Phase 06 Observability Dashboard

Issues discovered during Plan 06-01 execution that are **outside the scope** of this plan (SCOPE BOUNDARY rule). None of these are caused by plan work; they exist on the base branch.

## Pre-existing TypeScript errors (tsc --noEmit)

- `src/lib/server/services/onboarding.ts:463,468` — `audioCodec` missing on `{active:false, ...}` literal vs `StreamInfo` type.
- `src/lib/server/services/onboarding.ts:514` — `nodes` property accessed on `Promise<Api>` (proxmox API client — likely needs `await`).
- `src/routes/api/cameras/[id]/snapshot/+server.ts:49` — `Buffer<ArrayBufferLike>` not assignable to `BodyInit`.
- `src/routes/api/cameras/status/+server.ts:29,139` — `CameraCardData` missing `cameraModel`, `firmwareVersion`, `liveFps`.

## Pre-existing svelte-check errors

- `src/lib/components/cameras/CameraDetailCard.svelte:135` — `CameraStatus` vs `'native-onvif'` type mismatch.
- `src/routes/+page.svelte:69,382` — same mismatch (`CameraStatus` union no longer contains `'native-onvif'`). Plan 06-01 does NOT fix or introduce these; they already existed in the poll loop and table renderer on the base commit.

## Note

Plan 06-01 adds three new source files and modifies `+page.svelte` only to inject `<HealthWidgets>` + a third `fetch` into the existing `Promise.all`. It does NOT touch the `CameraStatus` union or the onboarding/camera services. These errors were present on the phase-06 base commit and remain for a separate bug-fix plan.
