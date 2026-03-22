import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import http from 'node:http';

function fetchImage(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeoutMs);
		const req = http.get({
			hostname: parsed.hostname,
			port: parsed.port || 80,
			path: parsed.pathname + parsed.search,
			headers
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
			res.on('error', (err) => { clearTimeout(timer); reject(err); });
		});
		req.on('error', (err) => { clearTimeout(timer); reject(err); });
	});
}

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;

	if (!camera) {
		return new Response('Camera not found', { status: 404 });
	}

	try {
		const password = decrypt(camera.password);
		const auth = Buffer.from(`${camera.username}:${password}`).toString('base64');
		const url = `http://${camera.ip}/record/current.jpg`;
		const imageBuffer = await fetchImage(url, { Authorization: `Basic ${auth}` }, 5000);

		if (imageBuffer.length < 1000) {
			return new Response('Snapshot unavailable', { status: 502 });
		}

		return new Response(imageBuffer, {
			headers: {
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'no-cache, no-store'
			}
		});
	} catch {
		return new Response('Snapshot timeout', { status: 504 });
	}
};
