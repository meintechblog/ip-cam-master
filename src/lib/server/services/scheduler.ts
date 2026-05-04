import { scanUdmLogs } from './udm-logs';
import { storeEvents, cleanupOldEvents, storeHealthEvent } from './events';
import { getSettings } from './settings';
import { cleanupExpiredSessions } from './auth';
import { getProtectStatus } from './protect';
import { cleanupOldUpdateLogs } from './update-history';
import { startBambuSubscribers, stopBambuSubscribers } from './bambu-mqtt';
import { db } from '$lib/server/db/client';
import { cameras, protectHubBridges } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

let logScanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let protectPollInterval: ReturnType<typeof setInterval> | null = null;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateLogCleanupInterval: ReturnType<typeof setInterval> | null = null;

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
					// Check go2rtc API.
					// Adaptive-mode Bambu cameras intentionally stop go2rtc when
					// the printer is idle (gcode_state=FINISH/IDLE/PAUSE) to free
					// CPU/RAM in the LXC. Logging "unreachable" for that expected
					// dormant state spams the operator with non-issues — the bambu
					// MQTT subscriber will start go2rtc back up the moment the
					// printer transitions to RUNNING. So skip the check entirely
					// when adaptive + idle is the live config.
					const isAdaptiveIdle =
						cam.cameraType === 'bambu' &&
						(cam.streamMode ?? 'adaptive') === 'adaptive' &&
						(cam.printState === 'FINISH' ||
							cam.printState === 'IDLE' ||
							cam.printState === 'PAUSE' ||
							cam.printState === 'FAILED' ||
							cam.printState === null);

					if (!isAdaptiveIdle) {
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
				// Bridge health probe (HUB-BRG-08)
					const bridge = db.select().from(protectHubBridges).get();
					if (bridge && bridge.status === 'running' && bridge.containerIp) {
						try {
							const controller = new AbortController();
							const timeout = setTimeout(() => controller.abort(), 3000);
							await fetch(`http://${bridge.containerIp}:1984/api/streams`, {
								signal: controller.signal
							});
							clearTimeout(timeout);
							db.update(protectHubBridges)
								.set({ lastHealthCheckAt: new Date().toISOString() })
								.where(eq(protectHubBridges.id, bridge.id))
								.run();
						} catch {
							storeHealthEvent(
								0,
								'Protect Hub Bridge',
								`go2rtc unreachable on ${bridge.containerIp}:1984`,
								'warning'
							);
						}
					}
			} catch (err) {
				console.error('[scheduler] Health check failed:', err);
			}
		}, 5 * 60_000);
	}

	// Update log cleanup — once per 24h, drop entries + files older than 30 days
	if (!updateLogCleanupInterval) {
		const runCleanup = async () => {
			try {
				const { entriesDropped, filesRemoved } = await cleanupOldUpdateLogs(30);
				if (entriesDropped > 0 || filesRemoved > 0) {
					console.log(
						`[scheduler] update log cleanup: dropped ${entriesDropped} entries, removed ${filesRemoved} files`
					);
				}
			} catch (err) {
				console.error('[scheduler] update log cleanup failed:', (err as Error).message);
			}
		};
		// Run shortly after boot so orphans left from previous lifetimes get swept,
		// then once per 24h.
		setTimeout(runCleanup, 60_000);
		updateLogCleanupInterval = setInterval(runCleanup, 86_400_000);
	}

	// Start Bambu MQTT subscribers (Adaptive Stream Mode driven by print.gcode_state)
	startBambuSubscribers().catch((err) =>
		console.error('[scheduler] bambu-mqtt startup failed:', err)
	);

	console.log('[scheduler] Started: event cleanup (1h), SSH log scan (60s), Protect poll (30s), health checks (5m), update log cleanup (24h), bambu MQTT');
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
	stopBambuSubscribers();
	if (updateLogCleanupInterval) {
		clearInterval(updateLogCleanupInterval);
		updateLogCleanupInterval = null;
	}
}
