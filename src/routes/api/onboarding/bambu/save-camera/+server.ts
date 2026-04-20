import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from '$lib/server/services/crypto';
import { BAMBU_MODEL_ALLOWLIST } from '$lib/server/services/bambu-discovery';
import { CAMERA_STATUS } from '$lib/types';

// Bambu cameras are saved BEFORE LXC provisioning (Phase 12 will create the
// container and update vmid). vmid=0 is the sentinel for "awaiting provisioning".
const BAMBU_PENDING_VMID = 0;

export const POST: RequestHandler = async ({ request }) => {
	const { name, ip, serialNumber, accessCode, model } = await request.json();

	if (!name || !ip || !serialNumber || !accessCode) {
		return json(
			{ success: false, error: 'Name, IP, Seriennummer und Access Code erforderlich' },
			{ status: 400 }
		);
	}
	if (typeof accessCode !== 'string' || accessCode.length !== 8) {
		return json(
			{ success: false, error: 'Access Code muss 8 Zeichen lang sein' },
			{ status: 400 }
		);
	}

	// Phase 18 / BAMBU-A1-02: SSDP-discovered model drives the capability matrix.
	// Validated against allowlist — an attacker-crafted model cannot flow into
	// `PRINTER_CAPABILITIES[model]` as an arbitrary key (T-18-29). Unknown or
	// absent → null, and the UI/preflight fall back to H2C defaults.
	const rawModel = typeof model === 'string' ? model.trim() : '';
	const validatedModel = (BAMBU_MODEL_ALLOWLIST as readonly string[]).includes(rawModel)
		? rawModel
		: null;

	const existing = db.select().from(cameras).where(eq(cameras.ip, ip)).get();
	if (existing) {
		return json({ success: true, cameraId: existing.id, alreadyExisted: true });
	}

	const result = db
		.insert(cameras)
		.values({
			vmid: BAMBU_PENDING_VMID,
			name,
			ip,
			username: 'bblp',
			password: '',
			cameraType: 'bambu',
			streamPath: '/streaming/live/1',
			width: 1680,
			height: 1080,
			fps: 30,
			bitrate: 2000,
			streamName: `bambu-${serialNumber.slice(-6)}`,
			status: CAMERA_STATUS.PENDING,
			accessCode: encrypt(accessCode),
			serialNumber,
			model: validatedModel,
			// Bambu go2rtc locks RTSP with serial as username + access code
			// as password — exactly the pair the user types in UniFi Protect.
			rtspAuthEnabled: true
		})
		.run();

	return json({ success: true, cameraId: Number(result.lastInsertRowid) });
};
