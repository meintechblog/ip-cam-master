import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { listContainers } from '$lib/server/services/proxmox';
import { getSettings } from '$lib/server/services/settings';
import { decrypt } from '$lib/server/services/crypto';
import { getProtectStatus } from '$lib/server/services/protect';
import { getFlappingCameras } from '$lib/server/services/events';
import type { CameraCardData, ProtectCameraMatch } from '$lib/types';

export const GET: RequestHandler = async () => {
	try {
		const allCameras = db.select().from(cameras).all();
		if (allCameras.length === 0) {
			return json([]);
		}

		// Get container statuses from Proxmox
		let containerMap: Map<number, any> = new Map();
		try {
			const containers = await listContainers();
			containerMap = new Map(containers.map((c) => [c.vmid, c]));
		} catch {
			// Proxmox unreachable
		}

		// Collect live data for each camera in parallel
		const results: CameraCardData[] = await Promise.all(
			allCameras.map(async (cam: any) => {
				const containerData = containerMap.get(cam.vmid);
				const containerStatus = containerData?.status || 'unknown';
				const containerIp = cam.containerIp;
				const lxcCpu = containerData?.cpu ?? null;
				const lxcMemory = containerData?.memory ?? null;
				const lxcMac: string | null = containerData?.mac ?? null;

				let go2rtcRunning = false;
				let onvifRunning = false;
				let streamInfo = null;
				let connectedClients = 0;

				if (containerIp && containerStatus === 'running') {
					// Check go2rtc API
					try {
						const res = await fetch(`http://${containerIp}:1984/api/streams`, {
							signal: AbortSignal.timeout(3000)
						});
						if (res.ok) {
							go2rtcRunning = true;
							const data = await res.json();
							const stream = data[cam.streamName];
							if (stream) {
								const producers = Array.isArray(stream.producers) ? stream.producers.length : 0;
								const consumerList = Array.isArray(stream.consumers) ? stream.consumers : [];
								const consumers = consumerList.length;
								const unifiConnected = consumerList.some(
									(c: any) => c.user_agent?.includes('ui.com') || c.user_agent?.includes('Media Server') || c.user_agent?.includes('GStreamer')
								);
								const unifiStreams = consumerList.filter(
									(c: any) => c.user_agent?.includes('ui.com') || c.user_agent?.includes('Media Server') || c.user_agent?.includes('GStreamer')
								).length;
								// Extract video codec from first video producer, audio from audio producer
							const videoProducer = stream.producers?.find((p: any) =>
								p.medias?.some((m: string) => m.includes('video'))
							);
							const audioProducer = stream.producers?.find((p: any) =>
								p.medias?.some((m: string) => m.includes('audio'))
							);
							const audioCodec = audioProducer?.medias
								?.find((m: string) => m.includes('audio'))
								?.match(/audio,\s*\w+,\s*(.+)/)?.[1] || null;

							streamInfo = {
								active: producers > 0,
								codec: videoProducer?.medias?.find((m: string) => m.includes('video'))?.match(/video,\s*\w+,\s*(.+)/)?.[1] || stream.producers?.[0]?.codec || null,
								audioCodec,
								producers,
								resolution: videoProducer?.resolution || stream.producers?.[0]?.resolution || null
							};
								connectedClients = consumers;
								(streamInfo as any).unifiConnected = unifiConnected;
								(streamInfo as any).unifiStreams = unifiStreams;
							}
						}
					} catch {
						// go2rtc not reachable
					}

					// Check ONVIF server (port 8899)
					try {
						const res = await fetch(`http://${containerIp}:8899`, {
							signal: AbortSignal.timeout(2000)
						});
						onvifRunning = res.status !== 0;
					} catch (err: any) {
						// Connection refused = not running, ECONNRESET/other = running (ONVIF responds oddly to plain HTTP)
						if (err?.cause?.code === 'ECONNRESET' || err?.message?.includes('ECONNRESET')) {
							onvifRunning = true;
						}
					}
				}

				let cameraWebUrl: string | null = null;
				try {
					const decryptedPass = decrypt(cam.password);
					cameraWebUrl = `http://${cam.username}:${encodeURIComponent(decryptedPass)}@${cam.ip}`;
				} catch {
					cameraWebUrl = `http://${cam.ip}`;
				}

				return {
					id: cam.id,
					vmid: cam.vmid,
					name: cam.name,
					cameraIp: cam.ip,
					cameraType: cam.cameraType || 'mobotix',
					cameraWebUrl,
					containerIp,
					streamName: cam.streamName,
					rtspUrl: containerIp ? `rtsp://${containerIp}:8554/${cam.streamName}` : null,
					status: cam.status,
					width: cam.width,
					height: cam.height,
					fps: cam.fps,
					bitrate: cam.bitrate,
					containerStatus,
					go2rtcRunning,
					onvifRunning,
					streamInfo,
					connectedClients,
					snapshotUrl: `/api/cameras/${cam.id}/snapshot`,
					go2rtcWebUrl: containerIp
						? `http://${containerIp}:1984`
						: null,
					cameraModel: null,
					firmwareVersion: null,
					liveFps: null,
					lxcCpu,
					lxcMemory,
					lxcMac,
					printState: cam.cameraType === 'bambu' ? (cam.printState ?? null) : null,
					streamMode: cam.cameraType === 'bambu' ? (cam.streamMode ?? 'adaptive') : null
				} satisfies CameraCardData;
			})
		);

		// Fetch Protect status (30s cache, cheap on 10s polling) and flapping cameras
		let protectMatches = new Map<number, ProtectCameraMatch>();
		let protectConfigured = false;
		let flappingIds: number[] = [];
		try {
			const protectStatus = await getProtectStatus();
			protectConfigured = protectStatus.connected;
			protectMatches = protectStatus.cameras;
		} catch {
			// Protect unreachable — continue without
		}
		try {
			flappingIds = getFlappingCameras();
		} catch {
			// Events DB issue — continue without
		}

		// Get UniFi host for Protect deep-links
		let unifiHost: string | null = null;
		if (protectConfigured) {
			try {
				const s = await getSettings('unifi_');
				unifiHost = s.unifi_host || null;
			} catch { /* ignore */ }
		}

		// Enrich results with Protect status and flapping
		for (const result of results) {
			(result as any).protectStatus = protectMatches.get(result.id) || null;
			(result as any).protectConfigured = protectConfigured;
			(result as any).protectUrl = unifiHost ? `https://${unifiHost}/protect/devices` : null;
			(result as any).flapping = flappingIds.includes(result.id);
		}

		results.sort((a, b) => a.name.localeCompare(b.name));
		return json(results);
	} catch (err) {
		return json([], { status: 500 });
	}
};
