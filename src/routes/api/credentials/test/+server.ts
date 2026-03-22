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

	for (const row of rows) {
		try {
			const password = decrypt(row.password);
			// Try HTTP Basic auth to camera's snapshot endpoint
			const { stdout } = await execAsync(
				`curl -s --basic -u "${row.username}:${password}" "http://${ip}/record/current.jpg" --max-time 3 -o /dev/null -w "%{http_code}"`,
				{ timeout: 5000, encoding: 'utf-8' }
			);
			const code = stdout.trim();
			if (code === '200') {
				return json({
					success: true,
					credentialId: row.id,
					name: row.name,
					username: row.username,
					password // Return decrypted for use in onboarding form
				});
			}
		} catch {
			// This credential failed, try next
		}
	}

	return json({ success: false, message: 'Kein gespeichertes Login hat funktioniert' });
};
