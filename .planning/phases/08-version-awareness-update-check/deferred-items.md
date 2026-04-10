# Deferred Items — Phase 08-01

Pre-existing TypeScript errors discovered during Task 3 `tsc --noEmit` verification. These are NOT caused by this plan's changes and are out of scope per the executor's scope boundary rule.

## Pre-existing TypeScript errors (not introduced by this plan)

- `src/lib/server/services/onboarding.ts(463,4)`: Property 'audioCodec' missing in StreamInfo
- `src/lib/server/services/onboarding.ts(468,6)`: Property 'audioCodec' missing in StreamInfo
- `src/lib/server/services/onboarding.ts(514,30)`: Property 'nodes' on Promise<Api>
- `src/routes/api/cameras/[id]/snapshot/+server.ts(49,24)`: Buffer not assignable to BodyInit
- `src/routes/api/cameras/status/+server.ts(29,9)`: CameraCardData missing cameraModel/firmwareVersion/liveFps
- `src/routes/api/cameras/status/+server.ts(139,7)`: Same CameraCardData shape mismatch

All are in files untouched by Phase 08. They should be addressed in a dedicated type-cleanup pass or during the phase that owns the affected subsystem.
