import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/services/crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// In-memory cache per camera (avoid hammering the camera)
const cache = new Map<number, { data: any; ts: number }>();
const CACHE_TTL = 15000; // 15 seconds

export const GET: RequestHandler = async ({ params }) => {
	const cameraId = parseInt(params.id);

	// Return cached result if fresh
	const cached = cache.get(cameraId);
	if (cached && Date.now() - cached.ts < CACHE_TTL) {
		return json(cached.data);
	}

	const camera = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;
	if (!camera) return json({ error: 'Camera not found' }, { status: 404 });

	let liveFps: number | null = null;
	let maxFps: number | null = null;
	let cameraModel: string | null = null;
	let firmwareVersion: string | null = null;
	let codec: string | null = null;

	try {
		const password = decrypt(camera.password);

		// Run ffprobe + camera info in parallel (both async, non-blocking)
		const [fpsResult, versionResult] = await Promise.allSettled([
			// Live FPS: count frames over 2 seconds
			execAsync(
				`timeout 4 ffprobe -v quiet -print_format json -show_entries stream=nb_read_frames -count_frames -read_intervals "%+2" -select_streams v -rtsp_transport tcp "rtsp://${camera.username}:${password}@${camera.ip}:554${camera.streamPath || '/stream0/mobotix.mjpeg'}"`,
				{ timeout: 6000, encoding: 'utf-8' }
			),
			// Model + firmware from /admin/version
			execAsync(
				`curl -s --basic -u "${camera.username}:${password}" "http://${camera.ip}/admin/version" --max-time 2`,
				{ timeout: 4000, encoding: 'utf-8' }
			)
		]);

		if (fpsResult.status === 'fulfilled') {
			try {
				const probeData = JSON.parse(fpsResult.value.stdout);
				const frames = parseInt(probeData.streams?.[0]?.nb_read_frames || '0');
				if (frames > 0) liveFps = Math.round(frames / 2);
			} catch { /* parse error */ }
		}

		if (versionResult.status === 'fulfilled') {
			const html = versionResult.value.stdout;
			const tdMatches = html.match(/<td[^>]*>(.*?)<\/td>/gs) || [];
			const tdTexts = tdMatches.map((td: string) => td.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
			if (tdTexts.length > 0 && tdTexts[0].includes('MOBOTIX')) {
				cameraModel = tdTexts[0];
			}
			const fwEntry = tdTexts.find((t: string) => t.startsWith('MX-V'));
			if (fwEntry) firmwareVersion = fwEntry;
		}

		// Configured FPS
		maxFps = camera.fps;
		codec = 'MxPEG';
	} catch {
		// Decryption failed
	}

	const result = { liveFps, maxFps: maxFps || camera.fps, configuredFps: camera.fps, cameraModel, firmwareVersion, codec };
	cache.set(cameraId, { data: result, ts: Date.now() });
	return json(result);
};
