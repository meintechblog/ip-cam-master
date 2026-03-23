import { scanUdmLogs } from './udm-logs';
import { storeEvents, cleanupOldEvents } from './events';

let logScanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
	// SSH log scan every 60s (per D-16) — SSH-based, slower than API
	if (!logScanInterval) {
		logScanInterval = setInterval(async () => {
			try {
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
				console.error('[scheduler] SSH log scan failed:', err);
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

	console.log('[scheduler] Started: SSH log scan (60s), event cleanup (1h)');
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
