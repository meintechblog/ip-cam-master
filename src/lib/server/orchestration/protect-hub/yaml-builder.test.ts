// v1.3 Phase 21 Wave-0 stub — Plan 02 fills in.
// yaml-builder is a pure unit (no DB, no SSH); only $env mock is required so
// downstream imports of $lib/* don't blow up at module load.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DB_ENCRYPTION_KEY: 'a'.repeat(32) }
}));

describe('yaml-builder (Wave 0 stub — Plan 02 fills in)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// HUB-OUT-02: Loxone-MJPEG ffmpeg form per D-PIPE-02
	it.skip('loxone — emits #video=mjpeg#width=640#height=360#raw=-r 10#raw=-an#hardware=vaapi', () => {
		expect(true).toBe(true);
	});

	// HUB-OUT-03: Frigate-RTSP ffmpeg form per D-PIPE-04
	it.skip('frigate — emits #video=copy#raw=-an passthrough', () => {
		expect(true).toBe(true);
	});

	// HUB-OUT-06: slug stable across name edits
	it.skip('slug stable — same MAC + different cam name → identical YAML', () => {
		expect(true).toBe(true);
	});

	// HUB-OUT-07: URLs in YAML follow correct format
	it.skip('emits stream URLs with mac-slug-low|high naming', () => {
		expect(true).toBe(true);
	});

	// P21-#5: canonical hash is byte-stable
	it.skip('canonicalHash — strips stamp + sorts keys + sha256 stable across renders', () => {
		expect(true).toBe(true);
	});
});
