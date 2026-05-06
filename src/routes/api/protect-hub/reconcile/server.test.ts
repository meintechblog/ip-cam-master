// v1.3 Phase 21 Wave-0 stub — Plan 05 fills in.
// Route-handler test. Mocks reconcile + db lookup. Covers HUB-RCN-03.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const mockReconcile = vi.fn();
const selectGet = vi.fn();

vi.mock('$lib/server/orchestration/protect-hub/reconcile', () => ({
	reconcile: mockReconcile,
	isReconcilerBusy: vi.fn()
}));

vi.mock('$lib/server/db/client', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ get: selectGet }) }) })
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	protectHubReconcileRuns: {},
	protectHubBridges: {}
}));

describe('POST/GET /api/protect-hub/reconcile (Wave 0 stub — Plan 05 fills in)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// HUB-RCN-03
	it.skip('POST — returns 202 + { ok: true, reconcileId }', () => {
		expect(true).toBe(true);
	});
	it.skip('GET — 400 if reconcileId param missing', () => {
		expect(true).toBe(true);
	});
	it.skip('GET — 404 if reconcileId not found', () => {
		expect(true).toBe(true);
	});
	it.skip('GET — 200 + run row on hit', () => {
		expect(true).toBe(true);
	});
});
