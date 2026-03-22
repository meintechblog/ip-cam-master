import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { execSync } from 'node:child_process';

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);
	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;

	if (!camera) return json({ error: 'Camera not found' }, { status: 404 });

	let liveFps: number | null = null;
	let maxFps: number | null = null;
	let cameraModel: string | null = null;
	let firmwareVersion: string | null = null;
	let codec: string | null = null;
	let configuredFps: number | null = null;

	try {
		const password = decrypt(camera.password);

		// 1. Live FPS via ffprobe (count frames over 2 seconds)
		try {
			const probeJson = execSync(
				`ffprobe -v quiet -print_format json -show_entries stream=nb_read_frames -count_frames -read_intervals "%+2" -select_streams v -rtsp_transport tcp "rtsp://${camera.username}:${password}@${camera.ip}:554${camera.streamPath || '/stream0/mobotix.mjpeg'}"`,
				{ timeout: 6000, encoding: 'utf-8' }
			);
			const probeData = JSON.parse(probeJson);
			const frames = parseInt(probeData.streams?.[0]?.nb_read_frames || '0');
			if (frames > 0) liveFps = Math.round(frames / 2);
		} catch {
			// ffprobe not available or timeout
		}

		// 2. Configured FPS + max FPS from Mobotix API
		try {
			const fpsResponse = execSync(
				`curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/control/control?read&section=general&framerate100" --max-time 2`,
				{ timeout: 4000, encoding: 'utf-8' }
			);
			const fpsMatch = fpsResponse.match(/framerate100=(\d+)/);
			if (fpsMatch) {
				configuredFps = parseInt(fpsMatch[1]) / 100;
				// Max FPS: 0 = unlimited (camera default ~25fps for Mobotix)
				maxFps = configuredFps === 0 ? 25 : configuredFps;
			}
		} catch {
			// Camera API not reachable
		}

		// 3. Model, firmware, codec from /admin/version
		try {
			const versionHtml = execSync(
				`curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/admin/version" --max-time 2`,
				{ timeout: 4000, encoding: 'utf-8' }
			);
			const tdMatches = versionHtml.match(/<td[^>]*>(.*?)<\/td>/gs) || [];
			const tdTexts = tdMatches.map((td: string) => td.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
			if (tdTexts.length > 0 && tdTexts[0].includes('MOBOTIX')) {
				cameraModel = tdTexts[0];
			}
			const fwEntry = tdTexts.find((t: string) => t.startsWith('MX-V'));
			if (fwEntry) firmwareVersion = fwEntry;
		} catch {
			// Camera HTTP not reachable
		}

		// 4. Codec from faststream header
		try {
			const streamHeader = execSync(
				`timeout 2 curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/control/faststream.jpg?stream=full&needlength&fps=0" --max-time 2 2>/dev/null | head -c 500`,
				{ timeout: 4000, encoding: 'utf-8' }
			);
			if (streamHeader.includes('MxPEG') || streamHeader.includes('mxpeg')) {
				codec = 'MxPEG';
			} else if (streamHeader.includes('image/jpeg')) {
				codec = 'MJPEG';
			}
		} catch {
			codec = 'MJPEG'; // Mobotix default
		}
	} catch {
		// Decryption failed
	}

	return json({
		liveFps,
		maxFps: maxFps || camera.fps,
		configuredFps: configuredFps || camera.fps,
		cameraModel,
		firmwareVersion,
		codec
	});
};
