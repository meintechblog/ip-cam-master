import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveCameraRecord } from '$lib/server/services/onboarding';

export const POST: RequestHandler = async ({ request }) => {
	const { name, ip, username, password, width, height, fps, bitrate, vmid } = await request.json();

	if (!name || !ip || !username || !password || !vmid) {
		return json(
			{ success: false, error: 'Name, IP, Username, Passwort und VMID erforderlich' },
			{ status: 400 }
		);
	}

	try {
		const cameraId = await saveCameraRecord({
			name,
			ip,
			username,
			password,
			width: width || 1280,
			height: height || 720,
			fps: fps || 20,
			bitrate: bitrate || 5000,
			vmid
		});

		return json({ success: true, cameraId });
	} catch (err) {
		return json(
			{ success: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 }
		);
	}
};
