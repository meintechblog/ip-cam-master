import { json } from '@sveltejs/kit';
import { checkForUpdate, getStoredUpdateStatus } from '$lib/server/services/update-check';
import { formatVersionLabel } from '$lib/server/services/version';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const result = await checkForUpdate();
	// After the check (success or error), re-read the canonical stored status
	// so the UI has a single shape to render.
	const status = await getStoredUpdateStatus();
	return json({
		checkResult: result,
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
