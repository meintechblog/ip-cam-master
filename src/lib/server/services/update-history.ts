import { readFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getSetting, saveSetting } from './settings';

const HISTORY_KEY = 'update_run_history';
const MAX_ENTRIES = 10;

export type UpdateRunEntry = {
	startedAt: string;
	finishedAt: string | null;
	preSha: string;
	postSha: string | null;
	result: 'running' | 'success' | 'failed' | 'rolled_back';
	logPath: string;
	unitName: string;
	backupPath?: string | null;
};

async function loadHistory(): Promise<UpdateRunEntry[]> {
	const raw = await getSetting(HISTORY_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed as UpdateRunEntry[];
	} catch {
		return [];
	}
}

async function saveHistory(entries: UpdateRunEntry[]): Promise<void> {
	await saveSetting(HISTORY_KEY, JSON.stringify(entries));
}

/**
 * Append a new update run entry to the persisted history.
 *
 * The history is bounded to the last {@link MAX_ENTRIES} entries — when the
 * limit is exceeded the oldest entry (first in the array) is dropped. Entries
 * are stored in chronological order (oldest first) in the settings table; the
 * reader reverses them for display.
 */
export async function appendUpdateRun(entry: UpdateRunEntry): Promise<void> {
	const current = await loadHistory();
	current.push(entry);
	const trimmed = current.slice(-MAX_ENTRIES);
	await saveHistory(trimmed);
}

/**
 * Patch an existing entry in place by unitName. No-op if not found.
 * Typically called from the SSE endpoint when the `done` event fires so the
 * finishedAt, result, and postSha fields are persisted.
 */
export async function updateUpdateRun(
	unitName: string,
	patch: Partial<UpdateRunEntry>
): Promise<void> {
	const current = await loadHistory();
	const idx = current.findIndex((entry) => entry.unitName === unitName);
	if (idx === -1) return;
	current[idx] = { ...current[idx], ...patch };
	await saveHistory(current);
}

/**
 * Read the last N entries in reverse-chronological order (newest first).
 */
export async function readUpdateRuns(limit: number = MAX_ENTRIES): Promise<UpdateRunEntry[]> {
	const current = await loadHistory();
	// Newest first
	const reversed = [...current].reverse();
	return reversed.slice(0, limit);
}

/**
 * Reconcile any entries still marked `running` against their exit-code files on
 * disk. The in-memory SSE watcher that normally patches the entry dies when the
 * app itself restarts during its own update, leaving the entry stuck as
 * `running`. On next boot we check the exit-code file the script wrote and
 * retroactively mark the entry as success / failed / rolled_back.
 */
export async function reconcileRunningEntries(): Promise<number> {
	const current = await loadHistory();
	let patched = 0;
	for (const entry of current) {
		if (entry.result !== 'running') continue;
		const exitcodePath = entry.logPath.replace(/\.log$/, '.exitcode');
		if (!existsSync(exitcodePath)) continue;
		let code: number;
		try {
			code = Number.parseInt(readFileSync(exitcodePath, 'utf-8').trim(), 10);
		} catch {
			continue;
		}
		entry.result = code === 0 ? 'success' : code === 2 ? 'rolled_back' : 'failed';
		entry.finishedAt = new Date().toISOString();
		if (code === 0) {
			const resultLine = readMarkerLine(entry.logPath);
			if (resultLine) {
				const match = resultLine.match(/-> ([0-9a-f]{40})/);
				if (match) entry.postSha = match[1];
			}
		}
		patched++;
	}
	if (patched > 0) await saveHistory(current);
	return patched;
}

function readMarkerLine(logPath: string): string | null {
	try {
		const content = readFileSync(logPath, 'utf-8');
		const lines = content.trim().split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].includes('UPDATE_RESULT')) return lines[i];
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Remove stale update log/exitcode files + history entries older than
 * {@link maxAgeDays}. Two-pass cleanup:
 *
 *   1. Drop history entries whose `startedAt` is older than the cutoff,
 *      unlinking their log and exitcode files if still present.
 *   2. Sweep `/tmp` for orphaned `ip-cam-master-update-*.{log,exitcode}`
 *      files that are not referenced by any remaining history entry and
 *      whose mtime is older than the cutoff.
 *
 * Never touches files younger than the cutoff (running update is always safe).
 * Returns a summary for logging.
 */
export async function cleanupOldUpdateLogs(maxAgeDays: number = 30): Promise<{
	entriesDropped: number;
	filesRemoved: number;
}> {
	const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
	const current = await loadHistory();

	const kept: UpdateRunEntry[] = [];
	const referencedFiles = new Set<string>();
	let entriesDropped = 0;
	let filesRemoved = 0;

	for (const entry of current) {
		const entryMs = Date.parse(entry.startedAt);
		if (Number.isFinite(entryMs) && entryMs < cutoffMs) {
			entriesDropped++;
			const exitcode = entry.logPath.replace(/\.log$/, '.exitcode');
			for (const p of [entry.logPath, exitcode]) {
				try {
					if (existsSync(p)) {
						unlinkSync(p);
						filesRemoved++;
					}
				} catch {
					/* tolerate permission / not-found */
				}
			}
			continue;
		}
		kept.push(entry);
		referencedFiles.add(entry.logPath);
		referencedFiles.add(entry.logPath.replace(/\.log$/, '.exitcode'));
	}

	if (entriesDropped > 0) await saveHistory(kept);

	try {
		const tmpFiles = readdirSync('/tmp');
		for (const name of tmpFiles) {
			if (!/^ip-cam-master-update-\d+\.(log|exitcode)$/.test(name)) continue;
			const full = join('/tmp', name);
			if (referencedFiles.has(full)) continue;
			try {
				const stat = statSync(full);
				if (stat.mtimeMs < cutoffMs) {
					unlinkSync(full);
					filesRemoved++;
				}
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* /tmp unreadable — unusual but survivable */
	}

	return { entriesDropped, filesRemoved };
}
