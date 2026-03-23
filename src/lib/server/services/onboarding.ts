import { connectToProxmox, executeOnContainer, pushFileToContainer, waitForContainerReady } from './ssh';
import { generateGo2rtcConfig, generateGo2rtcConfigLoxone, generateSystemdUnit, getInstallCommands, checkStreamHealth, getOnvifInstallCommands, generateOnvifConfig, generateOnvifSystemdUnit, generateNginxConfig, getNginxInstallCommands } from './go2rtc';
import { createContainer, startContainer } from './proxmox';
import { getSettings } from './settings';
import { encrypt, decrypt } from './crypto';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { StreamInfo } from '$lib/types';

/**
 * Tests connectivity to a Mobotix camera by probing its RTSP stream via ffprobe over SSH.
 */
export async function testMobotixConnection(
	ip: string,
	username: string,
	password: string
): Promise<{ success: boolean; resolution?: string; fps?: number; streamPath?: string; error?: string }> {
	const ssh = await connectToProxmox();

	try {
		// Try primary stream path
		const primaryPath = '/stream0/mobotix.mjpeg';
		const probeCmd = `ffprobe -v quiet -print_format json -show_streams -timeout 5000000 rtsp://${username}:${password}@${ip}:554${primaryPath} 2>&1 || echo PROBE_FAILED`;

		const result = await ssh.execCommand(probeCmd);

		if (result.stdout && !result.stdout.includes('PROBE_FAILED')) {
			const parsed = parseProbeResult(result.stdout);
			if (parsed) {
				return { success: true, ...parsed, streamPath: primaryPath };
			}
		}

		// Try alternate path
		const altPath = '/mobotix.mjpeg';
		const altCmd = `ffprobe -v quiet -print_format json -show_streams -timeout 5000000 rtsp://${username}:${password}@${ip}:554${altPath} 2>&1 || echo PROBE_FAILED`;

		const altResult = await ssh.execCommand(altCmd);

		if (altResult.stdout && !altResult.stdout.includes('PROBE_FAILED')) {
			const parsed = parseProbeResult(altResult.stdout);
			if (parsed) {
				return { success: true, ...parsed, streamPath: altPath };
			}
		}

		// Fallback: TCP connect test to port 554 + read config from Mobotix HTTP API
		const tcpCmd = `timeout 3 bash -c 'echo > /dev/tcp/${ip}/554' 2>/dev/null && echo REACHABLE || echo UNREACHABLE`;
		const tcpResult = await ssh.execCommand(tcpCmd);

		if (tcpResult.stdout?.includes('REACHABLE')) {
			// Read resolution + FPS from Mobotix config API
			let resolution: string | undefined;
			let fps: number | undefined;
			try {
				const configResult = await ssh.execCommand(
					`curl -s --basic -u "${username}:${password}" "http://${ip}/control/control?read&section=general&framerate100&customsize" --max-time 3`
				);
				const configText = configResult.stdout || '';
				const sizeMatch = configText.match(/customsize=(\d+x\d+)/);
				if (sizeMatch) resolution = sizeMatch[1];
				const fpsMatch = configText.match(/framerate100=(\d+)/);
				if (fpsMatch) fps = parseInt(fpsMatch[1]) / 100;
			} catch { /* ignore */ }

			return {
				success: true,
				resolution,
				fps,
				streamPath: primaryPath
			};
		}

		return { success: false, error: 'Camera not reachable on RTSP port 554' };
	} finally {
		ssh.dispose();
	}
}

function parseProbeResult(stdout: string): { resolution?: string; fps?: number } | null {
	try {
		const data = JSON.parse(stdout);
		const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
		if (!videoStream) return null;

		const resolution = videoStream.width && videoStream.height
			? `${videoStream.width}x${videoStream.height}`
			: undefined;

		let fps: number | undefined;
		if (videoStream.r_frame_rate) {
			const parts = videoStream.r_frame_rate.split('/');
			fps = parts.length === 2 ? Math.round(parseInt(parts[0]) / parseInt(parts[1])) : parseInt(parts[0]);
		}

		return { resolution, fps };
	} catch {
		return null;
	}
}

/**
 * Saves a camera record to the database.
 */
export async function saveCameraRecord(params: {
	name: string;
	ip: string;
	username: string;
	password: string;
	cameraType?: string;
	streamPath?: string;
	width?: number;
	height?: number;
	fps?: number;
	bitrate?: number;
	vmid: number;
	streamName?: string;
}): Promise<number> {
	const encryptedPassword = encrypt(params.password);
	const streamName = params.streamName || `cam-${params.vmid}`;

	db.insert(cameras)
		.values({
			vmid: params.vmid,
			name: params.name,
			ip: params.ip,
			username: params.username,
			password: encryptedPassword,
			cameraType: params.cameraType || 'mobotix',
			streamPath: params.streamPath || '/stream0/mobotix.mjpeg',
			width: params.width || 1280,
			height: params.height || 720,
			fps: params.fps || 20,
			bitrate: params.bitrate || 5000,
			streamName,
			status: 'pending'
		})
		.run();

	// Get the inserted camera by vmid
	const inserted = db.select({ id: cameras.id }).from(cameras).where(eq(cameras.vmid, params.vmid)).get();
	return inserted?.id ?? 0;
}

/**
 * Creates an LXC container for a camera, starts it, discovers its IP.
 */
export async function createCameraContainer(
	cameraId: number
): Promise<{ vmid: number; containerIp: string }> {
	const camera = getCameraById(cameraId);

	// Hostname from camera name: lowercase, no spaces/special chars
	const hostname = `cam-${camera.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
	await createContainer({
		vmid: camera.vmid,
		hostname,
		ostemplate: 'local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst',
		cameraName: camera.name,
		cameraIp: camera.ip,
		cameraType: camera.cameraType
	});

	await startContainer(camera.vmid);

	const ssh = await connectToProxmox();
	try {
		await waitForContainerReady(ssh, camera.vmid);

		// Discover container IP
		const ipResult = await executeOnContainer(ssh, camera.vmid, 'hostname -I');
		const containerIp = ipResult.stdout.trim().split(/\s+/)[0];

		// Update camera record
		db.update(cameras)
			.set({
				containerIp,
				status: 'container_created',
				updatedAt: new Date().toISOString()
			})
			.where(eq(cameras.id, cameraId))
			.run();

		return { vmid: camera.vmid, containerIp };
	} finally {
		ssh.dispose();
	}
}

/**
 * Installs nginx auth-proxy in the container (Loxone Intercom only).
 */
export async function configureNginx(cameraId: number): Promise<void> {
	const camera = getCameraById(cameraId);
	const ssh = await connectToProxmox();

	try {
		const nginxCmds = getNginxInstallCommands();
		for (const cmd of nginxCmds) {
			await executeOnContainer(ssh, camera.vmid, cmd);
		}

		const decryptedPassword = decrypt(camera.password);
		const nginxConfig = generateNginxConfig(camera.ip, camera.username, decryptedPassword);
		await pushFileToContainer(ssh, camera.vmid, nginxConfig, '/etc/nginx/nginx.conf');
		await executeOnContainer(ssh, camera.vmid, 'systemctl restart nginx');
	} finally {
		ssh.dispose();
	}
}

/**
 * Installs go2rtc in the container, deploys config and systemd unit, starts the service.
 */
export async function configureGo2rtc(cameraId: number): Promise<void> {
	const camera = getCameraById(cameraId);
	const ssh = await connectToProxmox();

	try {
		const installCmds = getInstallCommands();
		for (const cmd of installCmds) {
			await executeOnContainer(ssh, camera.vmid, cmd);
		}

		const decryptedPassword = decrypt(camera.password);
		let yamlContent: string;

		if (camera.cameraType === 'loxone') {
			// Loxone: go2rtc reads from local nginx proxy
			yamlContent = generateGo2rtcConfigLoxone({
				streamName: camera.streamName,
				width: camera.width,
				height: camera.height,
				fps: camera.fps,
				bitrate: camera.bitrate
			});
		} else {
			// Mobotix: go2rtc reads directly from camera RTSP
			yamlContent = generateGo2rtcConfig({
				streamName: camera.streamName,
				cameraIp: camera.ip,
				username: camera.username,
				password: decryptedPassword,
				width: camera.width,
				height: camera.height,
				fps: camera.fps,
				bitrate: camera.bitrate,
				streamPath: camera.streamPath
			});
		}

		await pushFileToContainer(ssh, camera.vmid, yamlContent, '/etc/go2rtc/go2rtc.yaml');

		const unitContent = generateSystemdUnit();
		await pushFileToContainer(ssh, camera.vmid, unitContent, '/etc/systemd/system/go2rtc.service');

		await executeOnContainer(ssh, camera.vmid, 'systemctl daemon-reload && systemctl enable go2rtc && systemctl restart go2rtc');

		db.update(cameras)
			.set({ status: 'go2rtc_configured', updatedAt: new Date().toISOString() })
			.where(eq(cameras.id, cameraId))
			.run();
	} finally {
		ssh.dispose();
	}
}

/**
 * Installs ONVIF server in the container, generates config, patches device naming, starts service.
 */
export async function configureOnvif(cameraId: number): Promise<void> {
	const camera = getCameraById(cameraId);
	const ssh = await connectToProxmox();

	try {
		// Install Node.js + ONVIF server
		const onvifCmds = getOnvifInstallCommands();
		for (const cmd of onvifCmds) {
			await executeOnContainer(ssh, camera.vmid, cmd);
		}

		// Get container MAC address and generate UUID
		const macResult = await executeOnContainer(ssh, camera.vmid, "ip link show eth0 | grep ether | awk '{print $2}'");
		const mac = macResult.stdout.trim() || 'bc:24:11:00:00:01';
		const uuidResult = await executeOnContainer(ssh, camera.vmid, 'cat /proc/sys/kernel/random/uuid');
		const uuid = uuidResult.stdout.trim();

		// Patch onvif-server.js for UniFi Protect (Manufacturer, Model, ONVIF name)
		const safeName = camera.name.replace(/[^a-zA-Z0-9]/g, '');
		await executeOnContainer(ssh, camera.vmid,
			`sed -i "s/CardinalHqCameraConfiguration/${safeName}HqCameraConfiguration/g; s/CardinalLqCameraConfiguration/${safeName}LqCameraConfiguration/g; s/Manufacturer: 'Onvif'/Manufacturer: '${safeName}'/g; s/Model: 'Cardinal'/Model: 'Mobotix'/g; s|onvif://www.onvif.org/name/Cardinal|onvif://www.onvif.org/name/MOBOTIXS15|g" /root/onvif-server/src/onvif-server.js`
		);

		// Generate and push ONVIF config
		const onvifConfig = generateOnvifConfig({
			streamName: camera.streamName,
			cameraName: camera.name,
			mac,
			uuid,
			width: camera.width,
			height: camera.height,
			fps: camera.fps,
			bitrate: camera.bitrate
		});
		await pushFileToContainer(ssh, camera.vmid, onvifConfig, '/root/onvif-server/config.yaml');

		// Generate and push ONVIF systemd unit
		const onvifUnit = generateOnvifSystemdUnit();
		await pushFileToContainer(ssh, camera.vmid, onvifUnit, '/etc/systemd/system/onvif-server.service');

		// Enable and start ONVIF server
		await executeOnContainer(ssh, camera.vmid, 'systemctl daemon-reload && systemctl enable onvif-server && systemctl restart onvif-server');

		// Update status
		db.update(cameras)
			.set({ status: 'configured', updatedAt: new Date().toISOString() })
			.where(eq(cameras.id, cameraId))
			.run();
	} finally {
		ssh.dispose();
	}
}

/**
 * Verifies the go2rtc stream is healthy via the HTTP API.
 */
export async function verifyStream(
	cameraId: number
): Promise<{ success: boolean; rtspUrl?: string; streamInfo: StreamInfo }> {
	const camera = getCameraById(cameraId);

	if (!camera.containerIp) {
		return {
			success: false,
			streamInfo: { active: false, codec: null, producers: 0, resolution: null }
		};
	}

	const streamInfo = await checkStreamHealth(camera.containerIp, camera.streamName);

	if (streamInfo.active) {
		const rtspUrl = `rtsp://${camera.containerIp}:8554/${camera.streamName}`;

		db.update(cameras)
			.set({
				rtspUrl,
				status: 'verified',
				updatedAt: new Date().toISOString()
			})
			.where(eq(cameras.id, cameraId))
			.run();

		return { success: true, rtspUrl, streamInfo };
	}

	return { success: false, streamInfo };
}

/**
 * Gets the next available VMID based on settings and existing cameras.
 */
export async function getNextVmid(): Promise<number> {
	// Auto-detect: find highest VMID on Proxmox, round up to next 1000, then increment
	try {
		const { listContainers } = await import('./proxmox');
		const containers = await listContainers();
		const allVmids = containers.map((c) => c.vmid);

		// Also include our DB entries
		const dbRows = db.select({ vmid: cameras.vmid }).from(cameras).all() as any[];
		for (const r of dbRows) {
			if (r.vmid > 0) allVmids.push(r.vmid);
		}

		if (allVmids.length === 0) return 2000;

		const maxVmid = Math.max(...allVmids);
		// Our managed VMIDs start at 2000+. If none of ours exist yet,
		// round up to next 1000 boundary. Otherwise just increment.
		const ourVmids = allVmids.filter((v) => v >= 2000);
		let next: number;
		if (ourVmids.length === 0) {
			// First managed container: round up to next 1000
			next = Math.ceil((maxVmid + 1) / 1000) * 1000;
		} else {
			// Subsequent: just max + 1
			next = Math.max(...ourVmids) + 1;
		}
		// Skip any that are already in use
		const usedSet = new Set(allVmids);
		while (usedSet.has(next)) next++;
		return next;
	} catch {
		// Fallback if Proxmox unreachable
		const rows = db.select({ maxVmid: sql<number>`MAX(${cameras.vmid})` }).from(cameras).all();
		const maxVmid = rows[0]?.maxVmid || 0;
		return maxVmid > 0 ? maxVmid + 1 : 2000;
	}
}

/**
 * Helper to get a camera record by ID.
 */
function getCameraById(cameraId: number): any {
	const rows = db.select().from(cameras).where(eq(cameras.id, cameraId)).all();
	if (rows.length === 0) {
		throw new Error(`Camera with id ${cameraId} not found`);
	}
	return rows[0];
}
