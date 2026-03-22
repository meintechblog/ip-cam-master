import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { listContainers } from '$lib/server/services/proxmox';
import { getSettings } from '$lib/server/services/settings';
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
		let containerMap: Map<number, any> = new Map();
		const pxSettings = await getSettings('proxmox_');
		const pxHost = pxSettings.proxmox_host?.replace(/:.*$/, '') || '';
		const pxAuthHeader = `PVEAPIToken=${pxSettings.proxmox_token_id}=${pxSettings.proxmox_token_secret}`;
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
				let lxcMac: string | null = null;

				// Get MAC from Proxmox container config
				if (containerData && pxHost) {
					try {
						const { execSync } = await import('node:child_process');
						const configJson = execSync(
							`curl -sk -H "Authorization: ${pxAuthHeader}" "https://${pxHost}:8006/api2/json/nodes/prox3/lxc/${cam.vmid}/config" --max-time 2`,
							{ timeout: 3000, encoding: 'utf-8' }
						);
						const net0 = JSON.parse(configJson)?.data?.net0 || '';
						const macMatch = net0.match(/hwaddr=([A-Fa-f0-9:]+)/i);
						if (macMatch) lxcMac = macMatch[1].toLowerCase();
					} catch { /* skip */ }
				}

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
					lxcCpu: lxcCpu,
					lxcMemory: lxcMemory,
					lxcMac: lxcMac
				} satisfies CameraCardData;
			})
		);

		results.sort((a, b) => a.vmid - b.vmid);
		return json(results);
	} catch (err) {
		return json([], { status: 500 });
	}
};
