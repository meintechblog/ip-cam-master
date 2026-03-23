import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { credentials } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/services/crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Try all saved credentials against a camera IP.
 * Returns the first working credential set, or null.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { ip } = await request.json();
	if (!ip) return json({ success: false, error: 'IP erforderlich' }, { status: 400 });

	const rows = (db.select().from(credentials).all() as any[])
		.sort((a, b) => a.priority - b.priority);

	// Try multiple endpoints — Mobotix uses /record/current.jpg, Loxone uses /mjpg/video.mjpg
	const endpoints = ['/record/current.jpg', '/mjpg/video.mjpg'];

	for (const row of rows) {
		try {
			const password = decrypt(row.password);
			for (const endpoint of endpoints) {
				try {
					// MJPEG streams stay open — use 1s timeout, ignore exit code
					const timeout = endpoint.includes('mjpg') ? 1 : 3;
					let stdout = '';
					try {
						const result = await execAsync(
							`curl -s --basic -u "${row.username}:${password}" "http://${ip}${endpoint}" --max-time ${timeout} -o /dev/null -w "%{http_code}"`,
							{ timeout: 5000, encoding: 'utf-8' }
						);
						stdout = result.stdout;
					} catch (e: unknown) {
						// curl exits 28 on timeout for streaming — check stdout anyway
						stdout = (e as any)?.stdout || '';
					}
					const code = stdout.trim();
					if (code === '200' || code === '206') {
						return json({
							success: true,
							credentialId: row.id,
							name: row.name,
							username: row.username,
							password
						});
					}
				} catch { /* try next endpoint */ }
			}
		} catch {
			// Decryption failed, try next credential
		}
	}

	return json({ success: false, message: 'Kein gespeichertes Login hat funktioniert' });
};
