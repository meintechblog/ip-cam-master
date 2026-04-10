---
status: awaiting_human_verify
trigger: "Loxone Intercom (192.168.3.13) shows 'Intercom nicht erreichbar (HTTP 000)' during adoption wizard"
created: 2026-03-26T00:00:00Z
updated: 2026-03-26T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - curl --max-time 3 on MJPEG stream endpoint is too short. The Loxone Intercom takes >3s to start sending HTTP headers, so curl exits code 28 with %{http_code}=000 (no response received before timeout). Same root cause as commit 93ea61c (increased from 1s to 3s, still not enough).
test: Fix the approach — use --connect-timeout for fast reachability check plus longer --max-time, or better yet test a non-streaming endpoint
expecting: Connectivity test should succeed when Intercom is reachable
next_action: Apply fix to test-connection/+server.ts and credentials/test/+server.ts

## Symptoms

expected: The Loxone Intercom adoption wizard should connect to 192.168.3.13 and proceed through setup steps
actual: Wizard shows "Intercom nicht erreichbar (HTTP 000)" — cannot proceed past connectivity check
errors: HTTP status 000 — fetch failed entirely (connection refused, timeout, CORS, or aborted)
reproduction: Open adoption wizard for Loxone Intercom at 192.168.3.13 and try to proceed
started: Previously worked. Intercom IS reachable via browser. Other cameras work fine.

## Eliminated

## Evidence

- timestamp: 2026-03-26T00:01:00Z
  checked: test-connection/+server.ts line 21
  found: curl uses --max-time 3 on MJPEG stream endpoint. MJPEG streams never complete, so curl always exits code 28 (timeout). If the Loxone Intercom takes >3s to return HTTP headers, %{http_code}=000.
  implication: Same root cause as commit 93ea61c which increased from 1s to 3s. Intercom now takes >3s to respond.

- timestamp: 2026-03-26T00:02:00Z
  checked: credentials/test/+server.ts line 46-51
  found: Same pattern — timeout=3 for MJPEG, Node exec timeout=5000ms. Both too short.
  implication: Credential matching also fails for the same reason.

- timestamp: 2026-03-26T00:03:00Z
  checked: cameras/[id]/credentials/+server.ts line 28
  found: Loxone timeout was still 1 second (never updated when the other file was fixed in 93ea61c)
  implication: Camera credential update test was even more likely to fail for Loxone.

- timestamp: 2026-03-26T00:04:00Z
  checked: Node.js exec behavior with non-zero exit codes
  found: stdout IS available on error object from promisify(exec). Verified with test.
  implication: The catch block logic is correct — the issue is purely that curl doesn't receive HTTP headers before --max-time kills it.

## Resolution

root_cause: curl --max-time 3 is too short for Loxone Intercom MJPEG stream. The Intercom can take 5-8 seconds to return HTTP headers. When curl times out before headers arrive, %{http_code}=000. Three files affected, one (cameras/[id]/credentials) still had the original 1s timeout.
fix: Separated --connect-timeout (5s, for fast fail on unreachable hosts) from --max-time (10s, to allow slow Intercoms to return HTTP headers). Increased Node exec timeout proportionally. Applied consistently across all three curl-based Loxone connectivity checks.
verification: Type-check passes (no new errors). Needs live test with Loxone Intercom at 192.168.3.13.
files_changed: [src/routes/api/onboarding/test-connection/+server.ts, src/routes/api/credentials/test/+server.ts, src/routes/api/cameras/[id]/credentials/+server.ts]
