import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VersionInfo } from '$lib/server/services/version';

vi.mock('$lib/server/services/version', () => ({
	getCurrentVersion: vi.fn()
}));

vi.mock('$lib/server/services/update-check', () => ({
	getStoredUpdateStatus: vi.fn()
}));

vi.mock('$lib/server/services/update-runner', () => ({
	spawnUpdateRun: vi.fn(),
	getDirtyFiles: vi.fn()
}));

vi.mock('$lib/server/services/update-history', () => ({
	appendUpdateRun: vi.fn()
}));

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(async () => Buffer.from('schema content'))
}));

vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(() => true)
	};
});

import { getCurrentVersion } from '$lib/server/services/version';
import { getStoredUpdateStatus } from '$lib/server/services/update-check';
import { spawnUpdateRun, getDirtyFiles } from '$lib/server/services/update-runner';
import { appendUpdateRun } from '$lib/server/services/update-history';
import { POST } from '../../../routes/api/update/run/+server';

const CLEAN_SHA = 'a'.repeat(40);
const LATEST_SHA = 'b'.repeat(40);

function makeVersion(overrides: Partial<VersionInfo> = {}): VersionInfo {
	return {
		version: `main @ ${CLEAN_SHA.slice(0, 7)}`,
		sha: CLEAN_SHA,
		tag: null,
		isDev: false,
		isDirty: false,
		...overrides
	};
}

function buildEvent(body: unknown = {}) {
	const request = new Request('http://localhost/api/update/run', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { request } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/update/run', () => {
	beforeEach(() => {
		vi.mocked(getCurrentVersion).mockReset();
		vi.mocked(getStoredUpdateStatus).mockReset();
		vi.mocked(spawnUpdateRun).mockReset();
		vi.mocked(getDirtyFiles).mockReset();
		vi.mocked(appendUpdateRun).mockReset();
		vi.mocked(appendUpdateRun).mockResolvedValue(undefined);
	});

	it('returns 400 dev_mode when getCurrentVersion().isDev', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion({ isDev: true }));

		const res = await POST(buildEvent());
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ error: 'dev_mode' });
		expect(spawnUpdateRun).not.toHaveBeenCalled();
	});

	it('returns 409 dirty_tree with dirtyFiles when isDirty', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion({ isDirty: true }));
		vi.mocked(getDirtyFiles).mockResolvedValue(['M src/foo.ts', '?? data/new.db']);

		const res = await POST(buildEvent());
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toEqual({ error: 'dirty_tree', dirtyFiles: ['M src/foo.ts', '?? data/new.db'] });
		expect(spawnUpdateRun).not.toHaveBeenCalled();
	});

	it('returns 400 already_up_to_date when !hasUpdate and !force', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.mocked(getStoredUpdateStatus).mockResolvedValue({
			lastCheckedAt: '2026-04-10T12:00:00Z',
			latestSha: CLEAN_SHA,
			latestCommitDate: null,
			latestCommitMessage: null,
			lastError: null,
			current: makeVersion(),
			hasUpdate: false
		});

		const res = await POST(buildEvent());
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ error: 'already_up_to_date' });
		expect(spawnUpdateRun).not.toHaveBeenCalled();
	});

	it('bypasses the up-to-date guard with {force:true}', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.mocked(getStoredUpdateStatus).mockResolvedValue({
			lastCheckedAt: '2026-04-10T12:00:00Z',
			latestSha: CLEAN_SHA,
			latestCommitDate: null,
			latestCommitMessage: null,
			lastError: null,
			current: makeVersion(),
			hasUpdate: false
		});
		vi.mocked(spawnUpdateRun).mockResolvedValue({
			logPath: '/tmp/ip-cam-master-update-1234.log',
			exitcodeFile: '/tmp/ip-cam-master-update-1234.exitcode',
			unitName: 'ip-cam-master-update-1234',
			startedAt: '2026-04-10T12:00:00.000Z'
		});

		const res = await POST(buildEvent({ force: true }));
		expect(res.status).toBe(202);
		expect(spawnUpdateRun).toHaveBeenCalledOnce();
	});

	it('happy path returns 202 with run info and calls appendUpdateRun once', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.mocked(getStoredUpdateStatus).mockResolvedValue({
			lastCheckedAt: '2026-04-10T12:00:00Z',
			latestSha: LATEST_SHA,
			latestCommitDate: null,
			latestCommitMessage: null,
			lastError: null,
			current: makeVersion(),
			hasUpdate: true
		});
		vi.mocked(spawnUpdateRun).mockResolvedValue({
			logPath: '/tmp/ip-cam-master-update-9999.log',
			exitcodeFile: '/tmp/ip-cam-master-update-9999.exitcode',
			unitName: 'ip-cam-master-update-9999',
			startedAt: '2026-04-10T13:00:00.000Z'
		});

		const res = await POST(buildEvent());
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body).toEqual({
			logPath: '/tmp/ip-cam-master-update-9999.log',
			exitcodeFile: '/tmp/ip-cam-master-update-9999.exitcode',
			unitName: 'ip-cam-master-update-9999',
			startedAt: '2026-04-10T13:00:00.000Z'
		});

		expect(spawnUpdateRun).toHaveBeenCalledOnce();
		expect(spawnUpdateRun).toHaveBeenCalledWith(
			CLEAN_SHA,
			expect.any(String) // preSchemaHash
		);
		// preSchemaHash should be a sha256 hex string (64 chars) computed from mocked schema contents
		const [, preSchemaHash] = vi.mocked(spawnUpdateRun).mock.calls[0];
		expect(preSchemaHash).toMatch(/^[0-9a-f]{64}$/);

		expect(appendUpdateRun).toHaveBeenCalledOnce();
		expect(appendUpdateRun).toHaveBeenCalledWith({
			startedAt: '2026-04-10T13:00:00.000Z',
			finishedAt: null,
			preSha: CLEAN_SHA,
			postSha: null,
			result: 'running',
			logPath: '/tmp/ip-cam-master-update-9999.log',
			unitName: 'ip-cam-master-update-9999'
		});
	});

	it('handles malformed JSON body by treating force as false', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.mocked(getStoredUpdateStatus).mockResolvedValue({
			lastCheckedAt: '2026-04-10T12:00:00Z',
			latestSha: CLEAN_SHA,
			latestCommitDate: null,
			latestCommitMessage: null,
			lastError: null,
			current: makeVersion(),
			hasUpdate: false
		});

		const request = new Request('http://localhost/api/update/run', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not json'
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ error: 'already_up_to_date' });
	});
});
