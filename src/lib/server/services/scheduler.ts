import { scanUdmLogs } from './udm-logs';
import { storeEvents, cleanupOldEvents } from './events';
import { getSettings } from './settings';

let logScanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
	// SSH log scan every 60s — only if UDM/UniFi is configured
	if (!logScanInterval) {
		logScanInterval = setInterval(async () => {
			try {
				// Check if UniFi host is configured before attempting SSH
				const settings = await getSettings('unifi_');
				if (!settings.unifi_host) return; // silently skip — not configured yet

				const events = await scanUdmLogs();
				if (events.length > 0) {
					storeEvents(
						events.map((e) => ({
							cameraId: null,
							cameraName: e.cameraName || null,
							eventType: e.eventType,
							severity: e.severity,
							message: e.message,
							source: e.source as 'ssh_logs',
							timestamp: e.timestamp
						}))
					);
				}
			} catch (err) {
				// Log once, don't spam — SSH key might not be set up yet
				console.error('[scheduler] SSH log scan failed:', (err as Error).message);
			}
		}, 60_000);
	}

	// Cleanup old events once per hour
	if (!cleanupInterval) {
		cleanupInterval = setInterval(() => {
			try {
				cleanupOldEvents();
			} catch (err) {
				console.error('[scheduler] Event cleanup failed:', err);
			}
		}, 3600_000);
	}

	console.log('[scheduler] Started: event cleanup (1h), SSH log scan (60s, if configured)');
}

export function stopScheduler(): void {
	if (logScanInterval) {
		clearInterval(logScanInterval);
		logScanInterval = null;
	}
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}
