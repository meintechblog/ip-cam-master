import { scanUdmLogs } from './udm-logs';
import { storeEvents, cleanupOldEvents, storeHealthEvent } from './events';
import { getSettings } from './settings';
import { cleanupExpiredSessions } from './auth';
import { getProtectStatus } from './protect';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';

let logScanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let protectPollInterval: ReturnType<typeof setInterval> | null = null;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

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

	// Cleanup old events + expired sessions once per hour
	if (!cleanupInterval) {
		cleanupInterval = setInterval(() => {
			try {
				cleanupOldEvents();
				cleanupExpiredSessions();
			} catch (err) {
				console.error('[scheduler] Cleanup failed:', err);
			}
		}, 3600_000);
	}

	// Pre-load Protect status every 30s (fills the 30s cache in protect.ts)
	if (!protectPollInterval) {
		protectPollInterval = setInterval(async () => {
			try {
				const settings = await getSettings('unifi_');
				if (!settings.unifi_host) return;
				await getProtectStatus(); // fills the cache
			} catch { /* ignore — will retry next cycle */ }
		}, 30_000);
	}

	// Container health checks every 5 minutes
	if (!healthCheckInterval) {
		healthCheckInterval = setInterval(async () => {
			try {
				const allCameras = db.select().from(cameras).all();
				const withContainer = allCameras.filter((c) => c.containerIp);

				for (const cam of withContainer) {
					// Check go2rtc API
					try {
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 3000);
						await fetch(`http://${cam.containerIp}:1984/api/streams`, {
							signal: controller.signal
						});
						clearTimeout(timeout);
					} catch {
						storeHealthEvent(
							cam.id,
							cam.name,
							`go2rtc unreachable on ${cam.containerIp}:1984`,
							'warning'
						);
					}

					// Check ONVIF server
					try {
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 2000);
						await fetch(`http://${cam.containerIp}:8899`, {
							signal: controller.signal
						});
						clearTimeout(timeout);
					} catch (err: unknown) {
						// ECONNRESET means server is running (resets HTTP but accepts ONVIF)
						const isReset =
							err instanceof Error &&
							(err.message?.includes('ECONNRESET') ||
								(('cause' in err) && (err.cause as { code?: string })?.code === 'ECONNRESET'));
						if (!isReset) {
							storeHealthEvent(
								cam.id,
								cam.name,
								`ONVIF server unreachable on ${cam.containerIp}:8899`,
								'warning'
							);
						}
					}
				}
			} catch (err) {
				console.error('[scheduler] Health check failed:', err);
			}
		}, 5 * 60_000);
	}

	console.log('[scheduler] Started: event cleanup (1h), SSH log scan (60s), Protect poll (30s), health checks (5m)');
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
	if (protectPollInterval) {
		clearInterval(protectPollInterval);
		protectPollInterval = null;
	}
	if (healthCheckInterval) {
		clearInterval(healthCheckInterval);
		healthCheckInterval = null;
	}
}
