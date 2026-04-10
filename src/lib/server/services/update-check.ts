import { getCurrentVersion, type VersionInfo } from './version';
import { getSettings, saveSetting } from './settings';

const GITHUB_COMMITS_URL = 'https://api.github.com/repos/meintechblog/ip-cam-master/commits/main';
const FETCH_TIMEOUT_MS = 10_000;
const COMMIT_MESSAGE_MAX_LEN = 200;

export type UpdateCheckSuccess = {
	error: null;
	current: VersionInfo;
	latestSha: string;
	latestCommitDate: string;
	latestCommitMessage: string;
	hasUpdate: boolean;
	warning: 'dirty' | null;
	checkedAt: string;
};

export type UpdateCheckError =
	| { error: 'rate_limited'; resetAt: string }
	| { error: 'network'; message: string }
	| { error: 'dev_mode' };

export type UpdateCheckResult = UpdateCheckSuccess | UpdateCheckError;

export type StoredUpdateStatus = {
	lastCheckedAt: string | null;
	latestSha: string | null;
	latestCommitDate: string | null;
	latestCommitMessage: string | null;
	lastError: string | null;
	current: VersionInfo;
	hasUpdate: boolean;
};

function truncateCommitMessage(message: string): string {
	const firstLine = message.split('\n', 1)[0] ?? '';
	return firstLine.slice(0, COMMIT_MESSAGE_MAX_LEN);
}

function nullIfEmpty(value: string | undefined): string | null {
	if (value === undefined || value === '') return null;
	return value;
}

/**
 * Live-check GitHub for the latest main commit and persist results in the settings table.
 *
 * Never throws. Returns a discriminated union describing success or a specific error type.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const current = await getCurrentVersion();
	if (current.isDev) {
		return { error: 'dev_mode' };
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const res = await fetch(GITHUB_COMMITS_URL, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'ip-cam-master-update-check'
			},
			signal: controller.signal
		});

		if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
			const resetHeader = res.headers.get('x-ratelimit-reset');
			const resetUnix = resetHeader ? parseInt(resetHeader, 10) : 0;
			const resetAt = new Date(resetUnix * 1000).toISOString();
			await saveSetting('update_last_error', `rate_limited:${resetAt}`);
			return { error: 'rate_limited', resetAt };
		}

		if (!res.ok) {
			await saveSetting('update_last_error', 'network');
			return { error: 'network', message: `HTTP ${res.status}` };
		}

		const body = (await res.json()) as {
			sha: string;
			commit: { committer: { date: string }; message: string };
		};

		const latestSha = body.sha;
		const latestCommitDate = body.commit.committer.date;
		const latestCommitMessage = truncateCommitMessage(body.commit.message);
		const hasUpdate = current.sha !== latestSha && !current.isDirty;
		const warning: 'dirty' | null = current.isDirty ? 'dirty' : null;
		const checkedAt = new Date().toISOString();

		await saveSetting('update_last_checked_at', checkedAt);
		await saveSetting('update_latest_sha', latestSha);
		await saveSetting('update_latest_commit_date', latestCommitDate);
		await saveSetting('update_latest_commit_message', latestCommitMessage);
		await saveSetting('update_last_error', '');

		return {
			error: null,
			current,
			latestSha,
			latestCommitDate,
			latestCommitMessage,
			hasUpdate,
			warning,
			checkedAt
		};
	} catch (err) {
		const message = (err as Error)?.message ?? 'unknown';
		await saveSetting('update_last_error', 'network');
		return { error: 'network', message };
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Read the persisted update-check state from settings and compose it
 * with the current running version for display purposes.
 */
export async function getStoredUpdateStatus(): Promise<StoredUpdateStatus> {
	const [settingsMap, current] = await Promise.all([getSettings('update_'), getCurrentVersion()]);

	const latestSha = nullIfEmpty(settingsMap.update_latest_sha);
	const lastError = nullIfEmpty(settingsMap.update_last_error);
	const hasUpdate = !!latestSha && latestSha !== current.sha && !current.isDirty;

	return {
		lastCheckedAt: nullIfEmpty(settingsMap.update_last_checked_at),
		latestSha,
		latestCommitDate: nullIfEmpty(settingsMap.update_latest_commit_date),
		latestCommitMessage: nullIfEmpty(settingsMap.update_latest_commit_message),
		lastError,
		current,
		hasUpdate
	};
}
