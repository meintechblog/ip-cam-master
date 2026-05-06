// v1.3 Phase 21 Wave-0 stub — Plan 04 fills in.
// ws-manager only reads bridge rows via mocked db; no in-mem DDL needed at this
// level. Fake-timers cover the [5,10,30,60,120,300]s backoff (HUB-RCN-07).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

describe('ws-manager (Wave 0 stub — Plan 04 fills in)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-06T13:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// HUB-RCN-07: backoff schedule [5,10,30,60,120,300]s
	it.skip('backoff schedule — [5,10,30,60,120,300]s; cap at 5min', () => {
		expect(true).toBe(true);
	});
	it.skip('single-flight — only one reconnect in flight at a time', () => {
		expect(true).toBe(true);
	});
	it.skip('on success — _attempt resets to 0 + reconcile(bridgeId, ws_reconnect) called once', () => {
		expect(true).toBe(true);
	});
	it.skip('stopWs — cancels in-flight backoff (no further reconnect after stop)', () => {
		expect(true).toBe(true);
	});
});
