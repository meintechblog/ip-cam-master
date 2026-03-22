import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { listContainers } from '$lib/server/services/proxmox';
import { checkStreamHealth } from '$lib/server/services/go2rtc';
import { decrypt } from '$lib/server/services/crypto';
import type { CameraCardData, ContainerStatus } from '$lib/types';

export const GET: RequestHandler = async () => {
	try {
		const allCameras = db.select().from(cameras).all();
		if (allCameras.length === 0) {
			return json([]);
		}

		// Get container statuses from Proxmox
		let containerStatuses: Map<number, ContainerStatus> = new Map();
		try {
			const containers = await listContainers();
			containerStatuses = new Map(containers.map((c) => [c.vmid, c.status]));
		} catch {
			// Proxmox unreachable — all containers unknown
		}

		// Collect live data for each camera in parallel
		const results: CameraCardData[] = await Promise.all(
			allCameras.map(async (cam: any) => {
				const containerStatus = containerStatuses.get(cam.vmid) || 'unknown';
				const containerIp = cam.containerIp;

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
									(c: any) => c.user_agent?.includes('ui.com') || c.user_agent?.includes('Media Server')
								);
								const unifiStreams = consumerList.filter(
									(c: any) => c.user_agent?.includes('ui.com') || c.user_agent?.includes('Media Server')
								).length;
								streamInfo = {
									active: producers > 0,
									codec: stream.producers?.[0]?.codec || null,
									producers,
									resolution: stream.producers?.[0]?.resolution || null
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
				let liveFps: number | null = null;
				let cameraModel: string | null = null;
				let firmwareVersion: string | null = null;

				try {
					const decryptedPass = decrypt(cam.password);
					cameraWebUrl = `http://${cam.username}:${encodeURIComponent(decryptedPass)}@${cam.ip}`;

					// Probe camera for live FPS via ffprobe (non-blocking, 3s timeout)
					try {
						const { execSync } = await import('node:child_process');
						const probeJson = execSync(
							`ffprobe -v quiet -print_format json -show_streams -timeout 3000000 "rtsp://${cam.username}:${decryptedPass}@${cam.ip}:554${cam.streamPath || '/stream0/mobotix.mjpeg'}"`,
							{ timeout: 5000, encoding: 'utf-8' }
						);
						const probeData = JSON.parse(probeJson);
						const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
						if (videoStream?.r_frame_rate) {
							const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
							if (den > 0) liveFps = Math.round(num / den);
						}
					} catch {
						// ffprobe timeout or not available — skip live FPS
					}

					// Get model + firmware from Mobotix /admin/version page (has all info in <td> cells)
					try {
						const { execSync } = await import('node:child_process');
						const versionHtml = execSync(
							`curl -s --basic -u "${cam.username}:${decryptedPass}" "http://${cam.ip}/admin/version" --max-time 3`,
							{ timeout: 5000, encoding: 'utf-8' }
						);
						// Extract all <td> text content
						const tdMatches = versionHtml.match(/<td[^>]*>(.*?)<\/td>/gs) || [];
						const tdTexts = tdMatches.map((td: string) => td.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
						// First td is typically the model: "MOBOTIX S15D-Sec"
						if (tdTexts.length > 0 && tdTexts[0].includes('MOBOTIX')) {
							cameraModel = tdTexts[0];
						}
						// Firmware is in the format MX-V4.x.x.x
						const fwEntry = tdTexts.find((t: string) => t.startsWith('MX-V'));
						if (fwEntry) firmwareVersion = fwEntry;
					} catch {
						// Camera HTTP not reachable
					}
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
					cameraModel,
					firmwareVersion,
					liveFps,
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
					snapshotUrl: containerIp && go2rtcRunning
						? `/api/cameras/${cam.id}/snapshot`
						: null,
					go2rtcWebUrl: containerIp
						? `http://${containerIp}:1984`
						: null
				} satisfies CameraCardData;
			})
		);

		results.sort((a, b) => a.vmid - b.vmid);
		return json(results);
	} catch (err) {
		return json([], { status: 500 });
	}
};
