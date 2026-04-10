import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getCurrentVersion } from '$lib/server/services/version';
import { getStoredUpdateStatus } from '$lib/server/services/update-check';
import { spawnUpdateRun, getDirtyFiles } from '$lib/server/services/update-runner';
import { appendUpdateRun } from '$lib/server/services/update-history';

const CANDIDATE_INSTALL_DIRS = ['/opt/ip-cam-master', process.cwd()];

function findSchemaPath(): string | null {
	for (const dir of CANDIDATE_INSTALL_DIRS) {
		const candidate = path.join(dir, 'src', 'lib', 'server', 'db', 'schema.ts');
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

async function computePreSchemaHash(): Promise<string> {
	const schemaPath = findSchemaPath();
	if (!schemaPath) return '';
	try {
		const buf = await readFile(schemaPath);
		return createHash('sha256').update(buf).digest('hex');
	} catch {
		return '';
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { force?: boolean };
	const force = body.force === true;

	const current = await getCurrentVersion();

	if (current.isDev) {
		return json({ error: 'dev_mode' }, { status: 400 });
	}

	if (current.isDirty) {
		const dirtyFiles = await getDirtyFiles();
		return json({ error: 'dirty_tree', dirtyFiles }, { status: 409 });
	}

	const status = await getStoredUpdateStatus();
	if (!status.hasUpdate && !force) {
		return json({ error: 'already_up_to_date' }, { status: 400 });
	}

	const preSchemaHash = await computePreSchemaHash();
	const run = await spawnUpdateRun(current.sha, preSchemaHash);

	await appendUpdateRun({
		startedAt: run.startedAt,
		finishedAt: null,
		preSha: current.sha,
		postSha: null,
		result: 'running',
		logPath: run.logPath,
		unitName: run.unitName
	});

	return json(run, { status: 202 });
};
