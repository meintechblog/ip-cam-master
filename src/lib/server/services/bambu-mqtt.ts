import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from './crypto';
import { connectToProxmox, executeOnContainer } from './ssh';

// Adaptive Stream Mode: MQTT-driven go2rtc toggle for Bambu printers.
// Reads print.gcode_state from device/<serial>/report, maps to live/idle group,
// starts/stops go2rtc on state-group transitions so the printer's Live555 server
// is left alone while idle.

const LIVE_STATES = new Set(['RUNNING', 'PREPARE', 'PAUSE']);
const IDLE_STATES = new Set(['FINISH', 'IDLE', 'FAILED']);

type StreamMode = 'adaptive' | 'always_live' | 'always_snapshot';

function groupForState(gcodeState: string): 'live' | 'idle' | 'unknown' {
	if (LIVE_STATES.has(gcodeState)) return 'live';
	if (IDLE_STATES.has(gcodeState)) return 'idle';
	return 'unknown';
}

interface Subscriber {
	cameraId: number;
	serial: string;
	client: MqttClient;
	lastGroup: 'live' | 'idle' | 'unknown';
	reconnectAttempts: number;
}

const subscribers = new Map<number, Subscriber>();

async function toggleGo2rtc(vmid: number, action: 'start' | 'stop'): Promise<void> {
	const ssh = await connectToProxmox();
	try {
		await executeOnContainer(ssh, vmid, `systemctl ${action} go2rtc`);
	} finally {
		ssh.dispose();
	}
}

function resolveDesiredGroup(streamMode: StreamMode, mqttGroup: 'live' | 'idle' | 'unknown'): 'live' | 'idle' {
	if (streamMode === 'always_live') return 'live';
	if (streamMode === 'always_snapshot') return 'idle';
	// adaptive: follow MQTT; fall back to live on unknown so we don't cut the stream
	// based on incomplete data
	return mqttGroup === 'idle' ? 'idle' : 'live';
}

async function handleStateChange(
	sub: Subscriber,
	newGcodeState: string
): Promise<void> {
	const camRow = db.select().from(cameras).where(eq(cameras.id, sub.cameraId)).get() as any;
	if (!camRow) return;

	const mqttGroup = groupForState(newGcodeState);
	const streamMode = (camRow.streamMode ?? 'adaptive') as StreamMode;
	const desiredGroup = resolveDesiredGroup(streamMode, mqttGroup);

	// Persist the observed state regardless (useful for UI + debugging)
	if (camRow.printState !== newGcodeState) {
		db.update(cameras)
			.set({ printState: newGcodeState, updatedAt: new Date().toISOString() })
			.where(eq(cameras.id, sub.cameraId))
			.run();
	}

	// No-op if group unchanged
	if (desiredGroup === sub.lastGroup) return;
	sub.lastGroup = desiredGroup;

	if (!camRow.vmid || camRow.vmid === 0) return; // not provisioned yet

	try {
		await toggleGo2rtc(camRow.vmid, desiredGroup === 'live' ? 'start' : 'stop');
		console.log(`[bambu-mqtt] cam=${sub.cameraId} state=${newGcodeState} → ${desiredGroup} (vmid=${camRow.vmid})`);
	} catch (err) {
		console.error(`[bambu-mqtt] cam=${sub.cameraId} go2rtc toggle failed:`, err);
	}
}

function attachHandlers(sub: Subscriber): void {
	const { client, serial, cameraId } = sub;

	client.on('connect', () => {
		sub.reconnectAttempts = 0;
		client.subscribe(`device/${serial}/report`, (err) => {
			if (err) console.error(`[bambu-mqtt] cam=${cameraId} subscribe error:`, err.message);
		});
	});

	client.on('message', (_topic, payload) => {
		let msg: any;
		try {
			msg = JSON.parse(payload.toString());
		} catch {
			return;
		}
		const gcodeState = msg?.print?.gcode_state;
		if (typeof gcodeState === 'string' && gcodeState) {
			void handleStateChange(sub, gcodeState);
		}
	});

	client.on('error', (err) => {
		console.error(`[bambu-mqtt] cam=${cameraId} client error:`, err.message);
	});

	client.on('close', () => {
		sub.reconnectAttempts += 1;
		// mqtt.js auto-reconnects; just log occasionally to avoid spam
		if (sub.reconnectAttempts % 10 === 1) {
			console.log(`[bambu-mqtt] cam=${cameraId} reconnecting (attempt ${sub.reconnectAttempts})`);
		}
	});
}

async function connectSubscriber(cameraId: number): Promise<void> {
	const cam = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;
	if (!cam || cam.cameraType !== 'bambu' || !cam.accessCode || !cam.serialNumber) return;

	const accessCode = decrypt(cam.accessCode);
	const url = `mqtts://${cam.ip}:8883`;

	const client = mqtt.connect(url, {
		username: 'bblp',
		password: accessCode,
		rejectUnauthorized: false,
		connectTimeout: 10_000,
		reconnectPeriod: 15_000,
		clean: true,
		clientId: `ipcm-${cam.serialNumber}-${Math.random().toString(16).slice(2, 8)}`
	});

	const sub: Subscriber = {
		cameraId,
		serial: cam.serialNumber,
		client,
		lastGroup: 'unknown',
		reconnectAttempts: 0
	};
	subscribers.set(cameraId, sub);
	attachHandlers(sub);
}

export async function startBambuSubscribers(): Promise<void> {
	const bambuCams = db.select().from(cameras).where(eq(cameras.cameraType, 'bambu')).all() as any[];
	for (const cam of bambuCams) {
		if (!cam.accessCode || !cam.serialNumber) continue;
		if (subscribers.has(cam.id)) continue;
		try {
			await connectSubscriber(cam.id);
		} catch (err) {
			console.error(`[bambu-mqtt] cam=${cam.id} connect failed:`, err);
		}
	}
	if (bambuCams.length > 0) {
		console.log(`[bambu-mqtt] started ${subscribers.size} subscriber(s)`);
	}
}

export function stopBambuSubscribers(): void {
	for (const sub of subscribers.values()) {
		sub.client.end(true);
	}
	subscribers.clear();
}

export async function addBambuSubscriber(cameraId: number): Promise<void> {
	if (subscribers.has(cameraId)) return;
	await connectSubscriber(cameraId);
}

export function removeBambuSubscriber(cameraId: number): void {
	const sub = subscribers.get(cameraId);
	if (!sub) return;
	sub.client.end(true);
	subscribers.delete(cameraId);
}

export function getBambuState(cameraId: number): {
	printState: string | null;
	streamGroup: 'live' | 'idle' | 'unknown';
	connected: boolean;
} {
	const sub = subscribers.get(cameraId);
	const cam = db.select().from(cameras).where(eq(cameras.id, cameraId)).get() as any;
	return {
		printState: cam?.printState ?? null,
		streamGroup: sub?.lastGroup ?? 'unknown',
		connected: !!sub?.client.connected
	};
}
