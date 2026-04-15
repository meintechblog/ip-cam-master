import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';

const execAsync = promisify(exec);

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
		// Bambu cameras: snapshot not available until Phase 12 LXC is provisioned
		// and go2rtc restream is running.
		if (camera.cameraType === 'bambu') {
			if (!camera.containerIp) {
				return new Response(null, { status: 204 });
			}
			const { stdout } = await execAsync(
				`ffmpeg -y -v quiet -rtsp_transport tcp -i "rtsp://${camera.containerIp}:8554/${camera.streamName}" -frames:v 1 -f image2 -q:v 2 pipe:1`,
				{ timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
			);
			if (stdout.length < 500 || stdout[0] !== 0xff || stdout[1] !== 0xd8) {
				return new Response('Snapshot unavailable', { status: 502 });
			}
			return new Response(new Uint8Array(stdout), {
				headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' }
			});
		}

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

			return new Response(new Uint8Array(stdout), {
				headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' }
			});
		}

		// Mobotix: use node's native fetch with Basic auth. Replacing shell-exec
		// curl — that path was returning auth-failure HTML for some S16 firmwares
		// despite the same command working from a shell directly.
		const authHeader = 'Basic ' + Buffer.from(`${camera.username}:${password}`).toString('base64');
		async function fetchSnap(path: string): Promise<Buffer> {
			const { status, body } = await httpGetBuffer(`http://${camera.ip}${path}`, authHeader, 3000);
			if (status !== 200) return Buffer.alloc(0);
			return body;
		}
		function isJpeg(buf: Buffer): boolean {
			return buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8;
		}

		let body = await fetchSnap('/record/current.jpg');
		if (!isJpeg(body)) {
			// Fallback: extract first JPEG frame out of faststream multipart via ffmpeg
			try {
				const r = await execAsync(
					`ffmpeg -y -v quiet -headers "Authorization: ${authHeader}\\r\\n" -i "http://${camera.ip}/control/faststream.jpg?stream=full&fps=5&needlength" -frames:v 1 -f image2 -q:v 2 pipe:1`,
					{ timeout: 6000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
				);
				body = r.stdout as Buffer;
			} catch (e: any) {
				body = (e?.stdout as Buffer) ?? Buffer.alloc(0);
			}
		}
		if (!isJpeg(body)) {
			return new Response('Snapshot unavailable', { status: 502 });
		}

		return new Response(new Uint8Array(body), {
			headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' }
		});
	} catch {
		return new Response('Snapshot timeout', { status: 504 });
	}
};
