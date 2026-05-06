// v1.3 Phase 21 Wave-0 stub — Plan 05 fills in.
// Route-handler test. Mocks reconcile + events + db. Covers HUB-OUT-01,
// HUB-OUT-04, HUB-RCN-02.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

const mockReconcile = vi.fn();
const mockStoreEvent = vi.fn();

vi.mock('$lib/server/orchestration/protect-hub/reconcile', () => ({
	reconcile: mockReconcile
}));

vi.mock('$lib/server/services/events', () => ({
	storeEvent: mockStoreEvent
}));

// db mock filled in Plan 05 — we just need the path to exist for Wave 0
vi.mock('$lib/server/db/client', () => ({
	db: {}
}));
vi.mock('$lib/server/db/schema', () => ({
	cameras: {},
	cameraOutputs: {},
	protectHubBridges: {}
}));

describe('PUT /api/cameras/[id]/outputs (Wave 0 stub — Plan 05 fills in)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// HUB-OUT-01
	it.skip('200 — body { outputs: [{ outputType, enabled }] } → camera_outputs row written', () => {
		expect(true).toBe(true);
	});
	// HUB-OUT-04
	it.skip('hard cap — projected total > 6 MJPEG → 422 with reason vaapi_hard_cap_exceeded', () => {
		expect(true).toBe(true);
	});
	// HUB-RCN-02
	it.skip('triggers reconcile — successful PUT calls reconcile(bridgeId, output_toggle) once', () => {
		expect(true).toBe(true);
	});
});
