import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VersionInfo } from './version';

// Mock dependencies BEFORE importing the module under test
vi.mock('./version', () => ({
	getCurrentVersion: vi.fn()
}));

vi.mock('./settings', () => ({
	getSettings: vi.fn(),
	saveSetting: vi.fn()
}));

import { getCurrentVersion } from './version';
import { saveSetting } from './settings';
import { checkForUpdate } from './update-check';

const CURRENT_SHA = 'a'.repeat(40);
const LATEST_SHA = 'b'.repeat(40);

function makeVersion(overrides: Partial<VersionInfo> = {}): VersionInfo {
	return {
		version: `main @ ${CURRENT_SHA.slice(0, 7)}`,
		sha: CURRENT_SHA,
		tag: null,
		isDev: false,
		isDirty: false,
		...overrides
	};
}

function makeCommitResponse(sha: string, message = 'commit subject') {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => ({
			sha,
			commit: {
				committer: { date: '2026-04-10T12:00:00Z' },
				message
			}
		})
	} as unknown as Response;
}

describe('checkForUpdate', () => {
	beforeEach(() => {
		vi.mocked(getCurrentVersion).mockReset();
		vi.mocked(saveSetting).mockReset();
		vi.mocked(saveSetting).mockResolvedValue(undefined);
		vi.unstubAllGlobals();
	});

	it('success path: saves 5 settings and flags hasUpdate=true when shas differ', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		const fetchMock = vi.fn().mockResolvedValue(makeCommitResponse(LATEST_SHA));
		vi.stubGlobal('fetch', fetchMock);

		const result = await checkForUpdate();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.error).toBeNull();
		if (result.error !== null) return; // type narrow
		expect(result.hasUpdate).toBe(true);
		expect(result.warning).toBeNull();
		expect(result.latestSha).toBe(LATEST_SHA);

		const savedKeys = vi.mocked(saveSetting).mock.calls.map((c) => c[0]);
		expect(savedKeys).toContain('update_last_checked_at');
		expect(savedKeys).toContain('update_latest_sha');
		expect(savedKeys).toContain('update_latest_commit_date');
		expect(savedKeys).toContain('update_latest_commit_message');
		expect(savedKeys).toContain('update_last_error');
		expect(savedKeys.length).toBe(5);
	});

	it('up-to-date: hasUpdate=false when current sha matches latest', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCommitResponse(CURRENT_SHA)));

		const result = await checkForUpdate();

		expect(result.error).toBeNull();
		if (result.error !== null) return;
		expect(result.hasUpdate).toBe(false);
		expect(result.warning).toBeNull();
	});

	it('dirty working tree: hasUpdate=false, warning=dirty, still persists latest values', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion({ isDirty: true }));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCommitResponse(LATEST_SHA)));

		const result = await checkForUpdate();

		expect(result.error).toBeNull();
		if (result.error !== null) return;
		expect(result.hasUpdate).toBe(false);
		expect(result.warning).toBe('dirty');

		const savedKeys = vi.mocked(saveSetting).mock.calls.map((c) => c[0]);
		expect(savedKeys).toContain('update_latest_sha');
		expect(savedKeys).toContain('update_latest_commit_date');
		expect(savedKeys).toContain('update_latest_commit_message');
	});

	it('rate limited: returns rate_limited error without touching latest_sha', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		const resetUnix = '1717000000';
		const rateLimitRes = {
			ok: false,
			status: 403,
			headers: new Headers({
				'x-ratelimit-remaining': '0',
				'x-ratelimit-reset': resetUnix
			}),
			json: async () => ({ message: 'API rate limit exceeded' })
		} as unknown as Response;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rateLimitRes));

		const result = await checkForUpdate();

		expect(result.error).toBe('rate_limited');
		if (result.error !== 'rate_limited') return;
		expect(result.resetAt).toBe(new Date(parseInt(resetUnix, 10) * 1000).toISOString());

		// Only update_last_error should be persisted
		const savedKeys = vi.mocked(saveSetting).mock.calls.map((c) => c[0]);
		expect(savedKeys).toEqual(['update_last_error']);
		expect(vi.mocked(saveSetting).mock.calls[0][1]).toBe(
			`rate_limited:${result.resetAt}`
		);
	});

	it('network error: fetch throws → returns network error, only persists update_last_error', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
		);

		const result = await checkForUpdate();

		expect(result.error).toBe('network');

		const savedKeys = vi.mocked(saveSetting).mock.calls.map((c) => c[0]);
		expect(savedKeys).toEqual(['update_last_error']);
		expect(vi.mocked(saveSetting).mock.calls[0][1]).toBe('network');
	});

	it('dev mode: returns dev_mode error and does NOT call fetch', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(
			makeVersion({ isDev: true, sha: 'unknown', version: 'dev' })
		);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await checkForUpdate();

		expect(result.error).toBe('dev_mode');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(vi.mocked(saveSetting)).not.toHaveBeenCalled();
	});

	it('commit message: truncates to first line and max 200 chars', async () => {
		vi.mocked(getCurrentVersion).mockResolvedValue(makeVersion());
		const longLine = 'x'.repeat(300);
		const multiLine = `${longLine}\n\nBody paragraph that should be stripped`;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(makeCommitResponse(LATEST_SHA, multiLine))
		);

		await checkForUpdate();

		const messageCall = vi
			.mocked(saveSetting)
			.mock.calls.find((c) => c[0] === 'update_latest_commit_message');
		expect(messageCall).toBeDefined();
		expect(messageCall![1]).toBe('x'.repeat(200));
		expect(messageCall![1]).not.toContain('\n');
	});
});
