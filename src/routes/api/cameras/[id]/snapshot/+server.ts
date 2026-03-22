import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;

	if (!camera?.containerIp) {
		return new Response('Camera not found', { status: 404 });
	}

	try {
		const url = `http://${camera.containerIp}:1984/api/frame.jpeg?src=${camera.streamName}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

		if (!res.ok) {
			return new Response('Snapshot unavailable', { status: 502 });
		}

		const imageBuffer = await res.arrayBuffer();
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
