import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs before importing the module under test so existsSync is controllable.
vi.mock('node:fs', () => ({
	existsSync: vi.fn(() => false)
}));

import { existsSync } from 'node:fs';
import {
	parseDescribe,
	formatVersionLabel,
	getCurrentVersion,
	resetVersionCacheForTests,
	type VersionInfo
} from './version';

describe('parseDescribe', () => {
	it('parses tag + parent count + sha', () => {
		expect(parseDescribe('v0.1.0-5-gabc1234')).toEqual({
			tag: 'v0.1.0',
			sha: 'abc1234',
			isDirty: false
		});
	});

	it('parses bare short sha', () => {
		expect(parseDescribe('abc1234')).toEqual({
			tag: null,
			sha: 'abc1234',
			isDirty: false
		});
	});

	it('parses bare short sha with dirty suffix', () => {
		expect(parseDescribe('abc1234-dirty')).toEqual({
			tag: null,
			sha: 'abc1234',
			isDirty: true
		});
	});

	it('parses tag-only with dirty suffix', () => {
		expect(parseDescribe('v1.2.3-dirty')).toEqual({
			tag: 'v1.2.3',
			sha: null,
			isDirty: true
		});
	});

	it('parses tag + parent count + sha with dirty', () => {
		expect(parseDescribe('v0.1.0-5-gabc1234-dirty')).toEqual({
			tag: 'v0.1.0',
			sha: 'abc1234',
			isDirty: true
		});
	});

	it('returns empty parse for garbage input', () => {
		expect(parseDescribe('not-a-valid-thing')).toEqual({
			tag: null,
			sha: null,
			isDirty: false
		});
	});
});

describe('formatVersionLabel', () => {
	const base: VersionInfo = {
		version: '',
		sha: 'abc1234',
		tag: null,
		isDev: false,
		isDirty: false
	};

	it('formats tag + sha', () => {
		expect(formatVersionLabel({ ...base, tag: 'v0.1.0', sha: 'abc1234' })).toBe('v0.1.0 (abc1234)');
	});

	it('formats bare sha as main @ sha', () => {
		expect(formatVersionLabel({ ...base, tag: null, sha: 'abc1234' })).toBe('main @ abc1234');
	});

	it('returns dev when isDev is true', () => {
		expect(formatVersionLabel({ ...base, isDev: true, sha: 'unknown' })).toBe('dev');
	});

	it('formats tag only when sha is missing', () => {
		expect(formatVersionLabel({ ...base, tag: 'v1.2.3', sha: '' })).toBe('v1.2.3');
	});

	it('formats dev even when tag + sha present', () => {
		expect(formatVersionLabel({ ...base, isDev: true, tag: 'v1.0.0', sha: 'abc1234' })).toBe('dev');
	});
});

describe('getCurrentVersion', () => {
	beforeEach(() => {
		resetVersionCacheForTests();
		vi.mocked(existsSync).mockReset();
	});

	it('returns dev fallback when no .git directory exists anywhere', async () => {
		vi.mocked(existsSync).mockReturnValue(false);

		const info = await getCurrentVersion();

		expect(info).toEqual({
			version: 'dev',
			sha: 'unknown',
			tag: null,
			isDev: true,
			isDirty: false
		});
	});

	it('caches the result across subsequent calls', async () => {
		vi.mocked(existsSync).mockReturnValue(false);

		const first = await getCurrentVersion();
		const callsBefore = vi.mocked(existsSync).mock.calls.length;

		const second = await getCurrentVersion();
		const callsAfter = vi.mocked(existsSync).mock.calls.length;

		expect(first).toBe(second); // referential identity
		expect(callsAfter).toBe(callsBefore); // no new existsSync calls on second invocation
	});
});
