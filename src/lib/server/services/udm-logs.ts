import { NodeSSH } from 'node-ssh';
import { getSettings, getSetting } from './settings';
import type { EventType, EventSeverity, EventSource } from '$lib/types';

let lastScanTimestamp: string | null = null;

const LOG_PATTERNS: Record<
	string,
	{ regex: RegExp; eventType: EventType; severity: EventSeverity }
> = {
	disconnect: {
		regex: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s.*\[([^\]]+)\s*@\s*([\d.]+)\].*disconnect/i,
		eventType: 'camera_disconnect',
		severity: 'warning'
	},
	reconnect: {
		regex: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s.*\[([^\]]+)\s*@\s*([\d.]+)\].*reconnect/i,
		eventType: 'camera_reconnect',
		severity: 'info'
	},
	streamFailed: {
		regex: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s.*stream.*(?:failed|error|timeout)/i,
		eventType: 'stream_failed',
		severity: 'error'
	},
	adopted: {
		regex: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s.*(?:adopted|adoption)/i,
		eventType: 'adoption_changed',
		severity: 'info'
	},
	aiportError: {
		regex: /(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s.*aiport.*error/i,
		eventType: 'aiport_error',
		severity: 'error'
	}
};

const NOISE_PATTERNS = [
	/ONVIF discovery/i,
	/health check/i,
	/go2rtc.*started/i,
	/periodic/i
];

interface ParsedEvent {
	eventType: EventType;
	severity: EventSeverity;
	message: string;
	cameraName: string | null;
	cameraIp: string | null;
	timestamp: string;
	source: EventSource;
}

export function parseLogLines(stdout: string, since: Date): ParsedEvent[] {
	const lines = stdout.split('\n').filter((line) => line.trim());
	const parsed: ParsedEvent[] = [];

	for (const line of lines) {
		// Skip noise
		if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
			continue;
		}

		for (const [, pattern] of Object.entries(LOG_PATTERNS)) {
			const match = pattern.regex.exec(line);
			if (match) {
				const timestamp = match[1];
				const lineDate = new Date(timestamp);

				// Filter lines older than since
				if (lineDate <= since) continue;

				const cameraName = match[2]?.trim() || null;
				const cameraIp = match[3] || null;

				parsed.push({
					eventType: pattern.eventType,
					severity: pattern.severity,
					message: line.trim(),
					cameraName,
					cameraIp,
					timestamp: lineDate.toISOString(),
					source: 'ssh_logs'
				});

				break; // Only match first pattern per line
			}
		}
	}

	return parsed;
}

async function connectToUdm(): Promise<NodeSSH> {
	const settings = await getSettings('unifi_');
	const host = settings.unifi_host;
	if (!host) throw new Error('UniFi host not configured');

	// Strip port if present
	const sshHost = host.replace(/:.*$/, '');

	const keyPath =
		(await getSetting('udm_ssh_key_path')) || '/opt/ip-cam-master/data/udm_key';

	const ssh = new NodeSSH();
	await ssh.connect({
		host: sshHost,
		username: 'root',
		privateKeyPath: keyPath
	});

	return ssh;
}

export async function scanUdmLogs(): Promise<ParsedEvent[]> {
	const ssh = await connectToUdm();

	try {
		const result = await ssh.execCommand(
			'tail -500 /srv/unifi-protect/logs/cameras.thirdParty.log'
		);

		if (result.code !== null && result.code !== 0) {
			console.error('UDM log read failed:', result.stderr);
			return [];
		}

		// Use lastScanTimestamp or 5 minutes ago
		const since = lastScanTimestamp
			? new Date(lastScanTimestamp)
			: new Date(Date.now() - 5 * 60 * 1000);

		const events = parseLogLines(result.stdout, since);

		// Update last scan timestamp
		lastScanTimestamp = new Date().toISOString();

		return events;
	} finally {
		ssh.dispose();
	}
}

export async function fetchRawProtectLogs(lines: number = 100): Promise<string> {
	const ssh = await connectToUdm();

	try {
		const result = await ssh.execCommand(
			`tail -${lines} /srv/unifi-protect/logs/cameras.thirdParty.log`
		);

		if (result.code !== null && result.code !== 0) {
			throw new Error(`Failed to read UDM logs: ${result.stderr}`);
		}

		return result.stdout;
	} finally {
		ssh.dispose();
	}
}
