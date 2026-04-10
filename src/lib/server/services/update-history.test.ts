import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory backing store shared by the mocked settings module
const store = new Map<string, string>();

vi.mock('./settings', () => ({
	getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
	saveSetting: vi.fn(async (key: string, value: string) => {
		store.set(key, value);
	})
}));

import {
	appendUpdateRun,
	updateUpdateRun,
	readUpdateRuns,
	type UpdateRunEntry
} from './update-history';

function makeEntry(overrides: Partial<UpdateRunEntry> = {}): UpdateRunEntry {
	return {
		startedAt: '2026-04-10T12:00:00.000Z',
		finishedAt: null,
		preSha: 'a'.repeat(40),
		postSha: null,
		result: 'running',
		logPath: '/tmp/ip-cam-master-update-1.log',
		unitName: 'ip-cam-master-update-1',
		...overrides
	};
}

describe('update-history', () => {
	beforeEach(() => {
		store.clear();
	});

	it('appendUpdateRun stores entry in settings key update_run_history as JSON array', async () => {
		const entry = makeEntry();
		await appendUpdateRun(entry);
		const raw = store.get('update_run_history');
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({ unitName: 'ip-cam-master-update-1', result: 'running' });
	});

	it('appendUpdateRun bounds the array to the last 10 entries (drops oldest)', async () => {
		for (let i = 1; i <= 12; i++) {
			await appendUpdateRun(makeEntry({ unitName: `ip-cam-master-update-${i}`, preSha: String(i) }));
		}
		const raw = store.get('update_run_history');
		const parsed: UpdateRunEntry[] = JSON.parse(raw!);
		expect(parsed).toHaveLength(10);
		// First entry should be the 3rd one we pushed (1 and 2 were dropped)
		expect(parsed[0].unitName).toBe('ip-cam-master-update-3');
		expect(parsed[9].unitName).toBe('ip-cam-master-update-12');
	});

	it('readUpdateRuns returns empty array when setting missing', async () => {
		const result = await readUpdateRuns();
		expect(result).toEqual([]);
	});

	it('readUpdateRuns returns last 5 entries in reverse-chronological order (newest first)', async () => {
		for (let i = 1; i <= 8; i++) {
			await appendUpdateRun(makeEntry({ unitName: `u${i}` }));
		}
		const result = await readUpdateRuns(5);
		expect(result).toHaveLength(5);
		expect(result[0].unitName).toBe('u8');
		expect(result[1].unitName).toBe('u7');
		expect(result[4].unitName).toBe('u4');
	});

	it('readUpdateRuns returns empty array when setting contains invalid JSON (does not throw)', async () => {
		store.set('update_run_history', '{not json');
		const result = await readUpdateRuns();
		expect(result).toEqual([]);
	});

	it('readUpdateRuns returns empty array when setting contains non-array JSON', async () => {
		store.set('update_run_history', '{"foo":"bar"}');
		const result = await readUpdateRuns();
		expect(result).toEqual([]);
	});

	it('updateUpdateRun finds entry by unitName and shallow-merges patch', async () => {
		await appendUpdateRun(makeEntry({ unitName: 'u1' }));
		await appendUpdateRun(makeEntry({ unitName: 'u2' }));
		await updateUpdateRun('u2', {
			finishedAt: '2026-04-10T12:05:00.000Z',
			result: 'success',
			postSha: 'b'.repeat(40)
		});

		const raw = store.get('update_run_history');
		const parsed: UpdateRunEntry[] = JSON.parse(raw!);
		expect(parsed).toHaveLength(2);
		const u2 = parsed.find((e) => e.unitName === 'u2');
		expect(u2?.finishedAt).toBe('2026-04-10T12:05:00.000Z');
		expect(u2?.result).toBe('success');
		expect(u2?.postSha).toBe('b'.repeat(40));
		// Other fields preserved
		expect(u2?.preSha).toBe('a'.repeat(40));
		// u1 untouched
		const u1 = parsed.find((e) => e.unitName === 'u1');
		expect(u1?.result).toBe('running');
	});

	it('updateUpdateRun is a no-op when unitName not found (no throw)', async () => {
		await appendUpdateRun(makeEntry({ unitName: 'u1' }));
		await expect(updateUpdateRun('nonexistent', { result: 'success' })).resolves.toBeUndefined();
		const raw = store.get('update_run_history');
		const parsed: UpdateRunEntry[] = JSON.parse(raw!);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].result).toBe('running');
	});

	it('UpdateRunEntry type has all fields', () => {
		const entry: UpdateRunEntry = {
			startedAt: '2026-04-10T12:00:00.000Z',
			finishedAt: '2026-04-10T12:05:00.000Z',
			preSha: 'a'.repeat(40),
			postSha: 'b'.repeat(40),
			result: 'success',
			logPath: '/tmp/ip-cam-master-update-1.log',
			unitName: 'ip-cam-master-update-1'
		};
		expect(entry).toBeDefined();
	});
});
