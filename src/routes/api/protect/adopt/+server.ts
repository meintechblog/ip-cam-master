import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyOnvifServer } from '$lib/server/services/protect';
import { getSetting } from '$lib/server/services/settings';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { cameraId } = await request.json();

		if (!cameraId || typeof cameraId !== 'number') {
			return json({ error: 'cameraId (number) ist erforderlich' }, { status: 400 });
		}

		const cam = db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
		if (!cam) {
			return json({ error: `Kamera mit ID ${cameraId} nicht gefunden` }, { status: 404 });
		}

		const containerIp = cam.containerIp;
		if (!containerIp) {
			return json({
				error: 'Keine Container-IP fuer diese Kamera konfiguriert',
				onvifRunning: false,
				containerReachable: false,
				instructions: []
			}, { status: 400 });
		}

		const onvifCheck = await verifyOnvifServer(containerIp);
		const unifiHost = await getSetting('unifi_host');

		if (!onvifCheck.running) {
			return json({
				onvifRunning: false,
				containerReachable: onvifCheck.reachable,
				instructions: [
					`ONVIF-Server laeuft nicht auf Container ${containerIp}. Bitte Container neu starten.`
				],
				protectUrl: unifiHost ? `https://${unifiHost}/protect/devices` : null
			});
		}

		return json({
			onvifRunning: true,
			containerReachable: true,
			instructions: [
				`Oeffne UniFi Protect auf https://${unifiHost || '<UniFi-Host>'}`,
				'Navigiere zu Geraete \u2192 Uebernehmen',
				`Kamera '${cam.name}' sollte in der Liste erscheinen (IP: ${containerIp})`,
				"Klicke auf 'Uebernehmen' (Adopt)"
			],
			protectUrl: unifiHost ? `https://${unifiHost}/protect/devices` : null
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
