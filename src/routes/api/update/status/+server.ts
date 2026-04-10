import { json } from '@sveltejs/kit';
import { getStoredUpdateStatus } from '$lib/server/services/update-check';
import { formatVersionLabel } from '$lib/server/services/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const status = await getStoredUpdateStatus();
	return json({
		current: {
			label: formatVersionLabel(status.current),
			sha: status.current.sha,
			tag: status.current.tag,
			isDev: status.current.isDev,
			isDirty: status.current.isDirty
		},
		lastCheckedAt: status.lastCheckedAt,
		latestSha: status.latestSha,
		latestCommitDate: status.latestCommitDate,
		latestCommitMessage: status.latestCommitMessage,
		lastError: status.lastError,
		hasUpdate: status.hasUpdate
	});
};
