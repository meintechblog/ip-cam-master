import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { listContainers } from '$lib/server/services/proxmox';
import { checkStreamHealth } from '$lib/server/services/go2rtc';
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

				return {
					id: cam.id,
					vmid: cam.vmid,
					name: cam.name,
					cameraIp: cam.ip,
					cameraType: cam.cameraType || 'mobotix',
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
