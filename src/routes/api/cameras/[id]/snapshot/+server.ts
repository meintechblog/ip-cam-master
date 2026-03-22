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
		const { stdout } = await execAsync(
			`curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/record/current.jpg" --max-time 3`,
			{ timeout: 4000, maxBuffer: 1024 * 1024, encoding: 'buffer' }
		);

		if (stdout.length < 1000) {
			return new Response('Snapshot unavailable', { status: 502 });
		}

		return new Response(stdout, {
			headers: {
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'no-cache, no-store'
			}
		});
	} catch {
		return new Response('Snapshot timeout', { status: 504 });
	}
};
