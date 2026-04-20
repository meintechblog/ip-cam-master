import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { fetchA1SnapshotJpeg } from '$lib/server/services/bambu-a1-camera';

/**
 * Bambu A1 on-demand JPEG snapshot endpoint (Phase 18 / BAMBU-A1-10 / D-04).
 *
 * A1 streams via proprietary JPEG-over-TLS on port 6000. No RTSPS:322.
 * Spike 004 (`.planning/spikes/004-a1-stream-fallback/README.md`) validated
 * the protocol against the live A1 at 192.168.3.195. `fetchA1SnapshotJpeg`
 * (Plan 18-04) does one TLS handshake + auth packet + first-frame pull and
 * returns the decoded JPEG buffer.
 *
 * Security:
 *   - Module-scope 2-second cache per camera id (RESEARCH §Security Threat
 *     Model T-18-24): DoS mitigation — printer sees ≤1 TLS session per 2s
 *     per camera regardless of request rate.
 *   - Access code is decrypted at use-site, never logged, never written to
 *     response body, headers, or error messages (T-18-23).
 *   - `id` path param validated as integer > 0 before any DB query (T-18-26).
 */

const JPEG_HEADERS = {
	'Content-Type': 'image/jpeg',
	'Cache-Control': 'no-cache, no-store'
};

const cache = new Map<number, { buf: Buffer; expiresAt: number }>();
const CACHE_TTL_MS = 2000;

export const GET: RequestHandler = async ({ params }) => {
	const id = Number.parseInt(params.id ?? '', 10);
	if (!Number.isInteger(id) || id <= 0) {
		return new Response('Invalid camera id', { status: 400 });
	}

	const cam = db.select().from(cameras).where(eq(cameras.id, id)).get() as
		| {
				id: number;
				cameraType: string;
				model: string | null;
				accessCode: string | null;
				ip: string;
		  }
		| undefined;

	if (!cam) return new Response('Camera not found', { status: 404 });
	if (cam.cameraType !== 'bambu') return new Response('Not a Bambu camera', { status: 404 });
	if (cam.model !== 'A1') return new Response('Not an A1 printer', { status: 400 });
	if (!cam.accessCode) return new Response('A1 missing access code', { status: 500 });

	// Cache hit? 2s window — serves identical JPEG buffer without re-handshaking
	// the printer. Prevents DoS if the UI polls more aggressively than expected.
	const cached = cache.get(id);
	if (cached && cached.expiresAt > Date.now()) {
		return new Response(new Uint8Array(cached.buf), { headers: JPEG_HEADERS });
	}

	// Decrypt at use-site; the plaintext stays in this local variable and is
	// passed only to `fetchA1SnapshotJpeg`. Never log; never surface in response.
	let accessCode: string;
	try {
		accessCode = decrypt(cam.accessCode);
	} catch {
		return new Response('A1 access code could not be decrypted', { status: 500 });
	}

	const buf = await fetchA1SnapshotJpeg(cam.ip, accessCode, 8000);
	if (!buf) return new Response('Snapshot unavailable', { status: 502 });

	cache.set(id, { buf, expiresAt: Date.now() + CACHE_TTL_MS });
	return new Response(new Uint8Array(buf), { headers: JPEG_HEADERS });
};
