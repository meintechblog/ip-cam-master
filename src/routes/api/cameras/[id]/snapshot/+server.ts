import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;

	if (!camera) {
		return new Response('Camera not found', { status: 404 });
	}

	try {
		const password = decrypt(camera.password);

		if (camera.cameraType === 'loxone') {
			// Loxone Intercom: grab single frame from MJPEG stream via ffmpeg
			// Use containerIp nginx proxy if available, otherwise direct with auth
			let source: string;
			if (camera.containerIp) {
				source = `http://${camera.containerIp}:8081/mjpg/video.mjpg`;
			} else {
				const auth = Buffer.from(`${camera.username}:${password}`).toString('base64');
				source = `http://${camera.ip}/mjpg/video.mjpg`;
			}

			let stdout: Buffer;
			try {
				const result = await execAsync(
					`ffmpeg -y -v quiet -headers "Authorization: Basic ${Buffer.from(`${camera.username}:${password}`).toString('base64')}\\r\\n" -i "http://${camera.ip}/mjpg/video.mjpg" -frames:v 1 -f image2 -q:v 2 pipe:1`,
					{ timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
				);
				stdout = result.stdout;
			} catch (e: any) {
				// ffmpeg exits non-zero but might still have output
				stdout = e?.stdout || Buffer.alloc(0);
			}

			if (stdout.length < 500) {
				return new Response('Snapshot unavailable', { status: 502 });
			}

			return new Response(stdout, {
				headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' }
			});
		}

		// Mobotix: direct snapshot from /record/current.jpg
		const { stdout } = await execAsync(
			`curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/record/current.jpg" --max-time 3`,
			{ timeout: 4000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
		);

		if (stdout.length < 1000) {
			return new Response('Snapshot unavailable', { status: 502 });
		}

		return new Response(stdout, {
			headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' }
		});
	} catch {
		return new Response('Snapshot timeout', { status: 504 });
	}
};
