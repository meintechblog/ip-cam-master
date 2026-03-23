import { db } from '$lib/server/db/client';
import { events } from '$lib/server/db/schema';
import { eq, and, gt, desc, sql, like } from 'drizzle-orm';
import type { CameraEvent, EventType, EventSeverity, EventSource } from '$lib/types';

export function storeEvent(
	event: Omit<CameraEvent, 'id'>
): CameraEvent | null {
	// Dedup: skip if identical event already exists (same timestamp + type + message)
	const existing = db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.timestamp, event.timestamp),
				eq(events.eventType, event.eventType),
				eq(events.message, event.message)
			)
		)
		.get();
	if (existing) return null;

	const result = db
		.insert(events)
		.values({
			cameraId: event.cameraId,
			cameraName: event.cameraName,
			eventType: event.eventType,
			severity: event.severity,
			message: event.message,
			source: event.source,
			timestamp: event.timestamp
		})
		.returning()
		.get();

	return result as unknown as CameraEvent;
}

export function storeEvents(
	eventList: Omit<CameraEvent, 'id'>[]
): CameraEvent[] {
	const stored: CameraEvent[] = [];
	for (const event of eventList) {
		const result = storeEvent(event);
		if (result) stored.push(result);
	}
	return stored;
}

export function getEvents(filters?: {
	cameraId?: number;
	severity?: EventSeverity;
	eventType?: EventType;
	since?: string;
	until?: string;
	limit?: number;
	offset?: number;
}): { events: CameraEvent[]; total: number } {
	const conditions = [];

	if (filters?.cameraId) {
		conditions.push(eq(events.cameraId, filters.cameraId));
	}
	if (filters?.severity) {
		conditions.push(eq(events.severity, filters.severity));
	}
	if (filters?.eventType) {
		conditions.push(eq(events.eventType, filters.eventType));
	}
	if (filters?.since) {
		conditions.push(gt(events.timestamp, filters.since));
	}
	if (filters?.until) {
		conditions.push(sql`${events.timestamp} <= ${filters.until}`);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const limit = filters?.limit ?? 50;
	const offset = filters?.offset ?? 0;

	const rows = db
		.select()
		.from(events)
		.where(whereClause)
		.orderBy(desc(events.timestamp))
		.limit(limit)
		.offset(offset)
		.all();

	const countResult = db
		.select({ count: sql<number>`count(*)` })
		.from(events)
		.where(whereClause)
		.get();

	const total = countResult?.count ?? 0;

	return {
		events: rows as unknown as CameraEvent[],
		total
	};
}

export function detectFlapping(cameraId: number): boolean {
	const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
	const disconnects = db
		.select()
		.from(events)
		.where(
			and(
				eq(events.cameraId, cameraId),
				eq(events.eventType, 'camera_disconnect'),
				gt(events.timestamp, tenMinAgo)
			)
		)
		.all();

	return disconnects.length > 3;
}

export function getFlappingCameras(): number[] {
	const result = db
		.all(
			sql`SELECT camera_id FROM events WHERE event_type = 'camera_disconnect' AND timestamp > datetime('now', '-10 minutes') GROUP BY camera_id HAVING COUNT(*) > 3`
		) as { camera_id: number }[];

	return result.map((r) => r.camera_id);
}

export function cleanupOldEvents(): void {
	db.run(sql`DELETE FROM events WHERE timestamp < datetime('now', '-30 days')`);
}
