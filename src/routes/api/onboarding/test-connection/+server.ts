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
			// Loxone Intercom: test HTTP MJPEG stream with Basic auth
			const auth = Buffer.from(`${username}:${password}`).toString('base64');
			const { stdout } = await execAsync(
				`curl -s --max-time 5 -o /dev/null -w "%{http_code} %{size_download}" -H "Authorization: Basic ${auth}" "http://${ip}/mjpg/video.mjpg"`,
				{ timeout: 8000, encoding: 'utf-8' }
			);
			const [code, size] = stdout.trim().split(' ');
			if (code === '200' || code === '401') {
				return json({
					success: code === '200',
					resolution: '1280x720', // Loxone Intercom default
					fps: 20,
					streamPath: '/mjpg/video.mjpg',
					error: code === '401' ? 'Authentifizierung fehlgeschlagen — Passwort pruefen' : undefined
				});
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
