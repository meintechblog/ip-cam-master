import { connectToProxmox, executeOnContainer, pushFileToContainer, waitForContainerReady } from './ssh';
import { generateGo2rtcConfig, generateSystemdUnit, getInstallCommands, checkStreamHealth } from './go2rtc';
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

		// Fallback: TCP connect test to port 554
		const tcpCmd = `timeout 3 bash -c 'echo > /dev/tcp/${ip}/554' 2>/dev/null && echo REACHABLE || echo UNREACHABLE`;
		const tcpResult = await ssh.execCommand(tcpCmd);

		if (tcpResult.stdout?.includes('REACHABLE')) {
			return {
				success: true,
				streamPath: primaryPath,
				error: 'Camera reachable but stream probe failed. Using default settings.'
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

	const result = db.insert(cameras)
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
		.returning();

	return result[0].id;
}

/**
 * Creates an LXC container for a camera, starts it, discovers its IP.
 */
export async function createCameraContainer(
	cameraId: number
): Promise<{ vmid: number; containerIp: string }> {
	const camera = getCameraById(cameraId);

	await createContainer({
		vmid: camera.vmid,
		hostname: `cam-${camera.vmid}`,
		ostemplate: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst',
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
 * Installs go2rtc in the container, deploys config and systemd unit, starts the service.
 */
export async function configureGo2rtc(cameraId: number): Promise<void> {
	const camera = getCameraById(cameraId);
	const ssh = await connectToProxmox();

	try {
		// Run install commands
		const installCmds = getInstallCommands();
		for (const cmd of installCmds) {
			await executeOnContainer(ssh, camera.vmid, cmd);
		}

		// Generate and push go2rtc config
		const decryptedPassword = decrypt(camera.password);
		const yamlContent = generateGo2rtcConfig({
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
		await pushFileToContainer(ssh, camera.vmid, yamlContent, '/etc/go2rtc/go2rtc.yaml');

		// Generate and push systemd unit
		const unitContent = generateSystemdUnit();
		await pushFileToContainer(ssh, camera.vmid, unitContent, '/etc/systemd/system/go2rtc.service');

		// Enable and start service
		await executeOnContainer(ssh, camera.vmid, 'systemctl daemon-reload && systemctl enable go2rtc && systemctl restart go2rtc');

		// Update status
		db.update(cameras)
			.set({
				status: 'configured',
				updatedAt: new Date().toISOString()
			})
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
	const settings = await getSettings('proxmox_');
	const vmidStart = parseInt(settings.proxmox_vmid_start || '200', 10);

	const rows = db.select({ maxVmid: sql<number>`MAX(${cameras.vmid})` })
		.from(cameras)
		.all();

	const maxVmid = rows[0]?.maxVmid || 0;
	return Math.max(vmidStart, maxVmid + 1);
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
