import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { request as httpRequest } from 'node:http';

const JPEG_HEADERS = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' };

/**
 * Fetch a JPEG frame from go2rtc's built-in frame API.
 * Works for all camera types (Mobotix, Loxone, Bambu) as long as
 * go2rtc is running in the container and the stream is active.
 */
async function fetchGo2rtcFrame(containerIp: string, streamName: string): Promise<Buffer | null> {
	try {
		const frameUrl = `http://${containerIp}:1984/api/frame.jpeg?src=${streamName}`;
		const res = await fetch(frameUrl, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		// Validate: minimum size + JPEG magic bytes
		if (buf.length > 500 && buf[0] === 0xff && buf[1] === 0xd8) {
			return buf;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Direct HTTP fetch with Basic auth — fallback for native ONVIF cameras
 * that have no go2rtc container.
 */
function httpGetBuffer(url: string, authHeader: string, timeoutMs: number): Promise<{ status: number; body: Buffer }> {
	return new Promise((resolve) => {
		const req = httpRequest(url, {
			method: 'GET',
			headers: { Authorization: authHeader, 'User-Agent': 'ip-cam-master/1', Connection: 'close' },
			agent: false
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
			res.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
		});
		req.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
		req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, body: Buffer.alloc(0) }); });
		req.end();
	});
}

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;

	if (!camera) {
		return new Response('Camera not found', { status: 404 });
	}

	try {
		// Primary path: go2rtc frame API (works for all camera types with a container)
		if (camera.containerIp) {
			const frame = await fetchGo2rtcFrame(camera.containerIp, camera.streamName);
			if (frame) {
				return new Response(new Uint8Array(frame), { headers: JPEG_HEADERS });
			}
			// go2rtc frame API failed — stream might not be active (e.g. Bambu idle)
			return new Response('Snapshot unavailable', { status: 502 });
		}

		// Fallback: native ONVIF cameras without a container (e.g. Auffahrt)
		// Use direct HTTP fetch with Basic auth
		if (camera.cameraType === 'mobotix-onvif' || camera.cameraType === 'onvif') {
			const password = decrypt(camera.password);
			const authHeader = 'Basic ' + Buffer.from(`${camera.username}:${password}`).toString('base64');
			const { status, body } = await httpGetBuffer(`http://${camera.ip}/record/current.jpg`, authHeader, 3000);
			if (status === 200 && body.length > 1000 && body[0] === 0xff && body[1] === 0xd8) {
				return new Response(new Uint8Array(body), { headers: JPEG_HEADERS });
			}
			return new Response('Snapshot unavailable', { status: 502 });
		}

		// No container, not native ONVIF — nothing we can do
		return new Response(null, { status: 204 });
	} catch {
		return new Response('Snapshot timeout', { status: 504 });
	}
};
