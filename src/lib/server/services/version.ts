import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type VersionInfo = {
	version: string;
	sha: string;
	tag: string | null;
	isDev: boolean;
	isDirty: boolean;
};

type ParsedDescribe = {
	tag: string | null;
	sha: string | null;
	isDirty: boolean;
};

let cachedVersion: VersionInfo | null = null;

/**
 * Parse the output of `git describe --tags --always --dirty --abbrev=7`.
 * Returns the tag, short sha, and dirty flag.
 */
export function parseDescribe(describe: string): ParsedDescribe {
	let isDirty = false;
	let value = describe.trim();
	if (value.endsWith('-dirty')) {
		isDirty = true;
		value = value.slice(0, -'-dirty'.length);
	}

	// Tag + parent count + sha: v0.1.0-5-gabc1234
	const tagWithCommits = value.match(/^(v[^-]+)-\d+-g([0-9a-f]{7,})$/);
	if (tagWithCommits) {
		return { tag: tagWithCommits[1], sha: tagWithCommits[2], isDirty };
	}

	// Tag only: v1.2.3
	const tagOnly = value.match(/^(v[^-]+)$/);
	if (tagOnly) {
		return { tag: tagOnly[1], sha: null, isDirty };
	}

	// Bare short sha: abc1234
	const bareSha = value.match(/^([0-9a-f]{7,})$/);
	if (bareSha) {
		return { tag: null, sha: bareSha[1], isDirty };
	}

	return { tag: null, sha: null, isDirty };
}

/**
 * Build a human-readable label from a VersionInfo.
 */
export function formatVersionLabel(info: VersionInfo): string {
	if (info.isDev) return 'dev';
	if (info.tag && info.sha) return `${info.tag} (${info.sha})`;
	if (info.tag && !info.sha) return info.tag;
	return `main @ ${info.sha}`;
}

/**
 * Resolve the current running version by shelling out to git.
 * Caches the result in-process after the first call.
 *
 * Returns a dev-mode fallback if no .git directory is reachable.
 */
export async function getCurrentVersion(): Promise<VersionInfo> {
	if (cachedVersion) return cachedVersion;

	const candidateDirs = ['/opt/ip-cam-master', process.cwd()];
	const gitDir = candidateDirs.find((dir) => existsSync(path.join(dir, '.git')));

	if (!gitDir) {
		cachedVersion = {
			version: 'dev',
			sha: 'unknown',
			tag: null,
			isDev: true,
			isDirty: false
		};
		return cachedVersion;
	}

	try {
		const [describeRes, revParseRes] = await Promise.all([
			execFileAsync('git', ['describe', '--tags', '--always', '--dirty', '--abbrev=7'], {
				cwd: gitDir
			}),
			execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: gitDir })
		]);

		const parsed = parseDescribe(describeRes.stdout);
		const fullSha = revParseRes.stdout.trim();
		const shortSha = parsed.sha ?? fullSha.slice(0, 7);

		const info: VersionInfo = {
			version: '',
			sha: fullSha,
			tag: parsed.tag,
			isDev: false,
			isDirty: parsed.isDirty
		};
		info.version = formatVersionLabel({ ...info, sha: shortSha });

		cachedVersion = info;
		return cachedVersion;
	} catch (err) {
		console.error('[version] git failed:', err);
		cachedVersion = {
			version: 'dev',
			sha: 'unknown',
			tag: null,
			isDev: true,
			isDirty: false
		};
		return cachedVersion;
	}
}

/**
 * Test-only: clear the in-process version cache.
 */
export function resetVersionCacheForTests(): void {
	cachedVersion = null;
}
