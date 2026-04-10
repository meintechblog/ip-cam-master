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
