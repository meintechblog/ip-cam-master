import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testMobotixConnection } from '$lib/server/services/onboarding';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const POST: RequestHandler = async ({ request }) => {
	const { ip, username, password, cameraType } = await request.json();
	if (!ip || !username || !password) {
		return json({ success: false, error: 'IP, Username und Passwort erforderlich' }, { status: 400 });
	}

	try {
		if (cameraType === 'loxone') {
			// Loxone Intercom: test HTTP MJPEG stream (stays open — use 3s timeout for slow response)
			let code = '000';
			try {
				const { stdout } = await execAsync(
					`curl -s --basic -u "${username}:${password}" "http://${ip}/mjpg/video.mjpg" --max-time 3 -o /dev/null -w "%{http_code}"`,
					{ timeout: 8000, encoding: 'utf-8' }
				);
				code = stdout.trim();
			} catch (e: unknown) {
				code = (e as any)?.stdout?.trim() || '000';
			}
			if (code === '200') {
				return json({
					success: true,
					resolution: '1280x720',
					fps: 20,
					streamPath: '/mjpg/video.mjpg'
				});
			} else if (code === '401') {
				return json({ success: false, error: 'Authentifizierung fehlgeschlagen — Passwort prüfen' });
			}
			return json({ success: false, error: `Intercom nicht erreichbar (HTTP ${code})` });
		}

		// Mobotix: test via RTSP
		const result = await testMobotixConnection(ip, username, password);
		return json(result);
	} catch (err) {
		return json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
};
