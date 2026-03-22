---
phase: 02-mobotix-camera-pipeline
plan: 02
subsystem: ui
tags: [svelte5, onboarding-wizard, stepper, webrtc, go2rtc, tailwind]

requires:
  - phase: 02-mobotix-camera-pipeline/01
    provides: Backend onboarding API routes and services (test-connection, create-container, configure-go2rtc, verify-stream)
provides:
  - 5-step onboarding wizard UI at /kameras/onboarding
  - StepIndicator progress bar component
  - StepCredentials form with smart transcode defaults
  - WebRTC live preview via go2rtc iframe in StepVerifyStream
  - Save-camera API endpoint for persisting camera records
  - "+Kamera hinzufuegen" entry point on Kameras page
affects: [02-mobotix-camera-pipeline/03, 03-loxone-intercom-pipeline]

tech-stack:
  added: []
  patterns: [wizard-stepper-pattern, auto-run-on-step-mount, retry-on-error-pattern]

key-files:
  created:
    - src/lib/components/onboarding/OnboardingWizard.svelte
    - src/lib/components/onboarding/StepIndicator.svelte
    - src/lib/components/onboarding/StepCredentials.svelte
    - src/lib/components/onboarding/StepTestConnection.svelte
    - src/lib/components/onboarding/StepCreateContainer.svelte
    - src/lib/components/onboarding/StepConfigureGo2rtc.svelte
    - src/lib/components/onboarding/StepVerifyStream.svelte
    - src/routes/kameras/onboarding/+page.svelte
    - src/routes/kameras/onboarding/+page.server.ts
    - src/routes/api/onboarding/save-camera/+server.ts
  modified:
    - src/routes/kameras/+page.svelte

key-decisions:
  - "Combined save-camera + advance to test step on credentials submit for smoother UX flow"
  - "Steps 1-4 auto-execute their API call on entry; user clicks Weiter to advance"
  - "Cosmetic sub-step progress in go2rtc configuration step via timer-based text changes"

patterns-established:
  - "Wizard stepper: currentStep state in parent, step components receive props+callbacks"
  - "Auto-run pattern: API call fires on step mount, loading/error/result triple for each step"
  - "Retry pattern: InlineAlert + 'Erneut versuchen' button on every step"

requirements-completed: [ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-06]

duration: 3min
completed: 2026-03-22
---

# Phase 02 Plan 02: Onboarding Wizard UI Summary

**5-step Mobotix camera onboarding wizard with progress indicator, auto-executing API steps, WebRTC live preview, and RTSP URL display**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T18:04:27Z
- **Completed:** 2026-03-22T18:07:19Z
- **Tasks:** 1
- **Files modified:** 11

## Accomplishments
- Full 5-step onboarding wizard accessible via "+Kamera hinzufuegen" button on Kameras page
- Progress indicator with completed (green), current (accent), and future (gray) step states
- Step 1 credentials form with smart defaults (1280x720, 20fps, 5000kbit/s) and auto-fill from detected camera params
- WebRTC iframe preview in step 5 via go2rtc stream.html with RTSP URL copy-to-clipboard
- Save-camera API endpoint that persists camera records with auto-derived streamName

## Task Commits

Each task was committed atomically:

1. **Task 1: Onboarding wizard components + Kameras page button** - `ed3e527` (feat)

## Files Created/Modified
- `src/lib/components/onboarding/OnboardingWizard.svelte` - Main wizard container with step state, API orchestration, error handling
- `src/lib/components/onboarding/StepIndicator.svelte` - 5-step horizontal progress bar
- `src/lib/components/onboarding/StepCredentials.svelte` - Camera name, IP, credentials, transcode params form
- `src/lib/components/onboarding/StepTestConnection.svelte` - Connection test with detected params display
- `src/lib/components/onboarding/StepCreateContainer.svelte` - Container creation with VMID/IP display
- `src/lib/components/onboarding/StepConfigureGo2rtc.svelte` - go2rtc config with cosmetic sub-step progress
- `src/lib/components/onboarding/StepVerifyStream.svelte` - WebRTC iframe preview + RTSP URL with copy button
- `src/routes/kameras/onboarding/+page.svelte` - Onboarding page shell
- `src/routes/kameras/onboarding/+page.server.ts` - Server load for next VMID
- `src/routes/api/onboarding/save-camera/+server.ts` - Save camera record API endpoint
- `src/routes/kameras/+page.svelte` - Added "+Kamera hinzufuegen" button

## Decisions Made
- Combined camera record save with credentials submit (step 0) rather than separate save step -- smoother UX, camera ID available for all subsequent API calls
- Steps auto-execute their API call on entry rather than requiring user to click "Run" -- reduces clicks in happy path
- Cosmetic sub-step progress in go2rtc configuration step (timer-based text changes) since actual API is one request -- gives user sense of progress during long operation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Onboarding wizard UI complete, calls all Plan 01 backend APIs
- Ready for Plan 03 (end-to-end integration testing or polish)
- Wizard pattern established and reusable for Loxone Intercom pipeline (Phase 03)

## Self-Check: PASSED

All 10 created files verified on disk. Commit ed3e527 verified in git log.

---
*Phase: 02-mobotix-camera-pipeline*
*Completed: 2026-03-22*
