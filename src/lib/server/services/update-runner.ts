import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fsp, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createBackup } from './backup';

const execFileAsync = promisify(execFile);

/**
 * Absolute path the detached systemd-run unit executes.
 * Owned by root, installed by ensureUpdateScriptInstalled() at app startup.
 */
export const INSTALLED_SCRIPT_PATH = '/usr/local/bin/ip-cam-master-update.sh';

/**
 * Candidate directories to find the installed ip-cam-master git worktree in.
 * Must match the candidate list in src/lib/server/services/version.ts so the
 * same dir is picked regardless of which service asks first.
 */
const CANDIDATE_INSTALL_DIRS = ['/opt/ip-cam-master', process.cwd()];

/** Resolve the first candidate dir that contains a .git entry. Returns null in dev mode. */
function findInstallDir(): string | null {
	for (const dir of CANDIDATE_INSTALL_DIRS) {
		if (existsSync(path.join(dir, '.git'))) return dir;
	}
	return null;
}

/**
 * Copy scripts/update.sh from the running install dir to /usr/local/bin so the
 * detached systemd-run unit invokes a script on the root filesystem that cannot
 * disappear when the worktree swaps during `git pull`.
 *
 * No-op in dev mode (no install dir found) or when the target is already at least
 * as new as the source (mtime compare).
 */
export async function ensureUpdateScriptInstalled(): Promise<void> {
	const installDir = findInstallDir();
	if (!installDir) {
		// Dev mode — nothing to install
		return;
	}

	const sourcePath = path.join(installDir, 'scripts', 'update.sh');
	if (!existsSync(sourcePath)) {
		// Source missing (partial worktree?) — silent no-op
		return;
	}

	try {
		const sourceStat = await fsp.stat(sourcePath);
		let shouldCopy = true;
		if (existsSync(INSTALLED_SCRIPT_PATH)) {
			const targetStat = await fsp.stat(INSTALLED_SCRIPT_PATH);
			if (targetStat.mtimeMs >= sourceStat.mtimeMs) {
				shouldCopy = false;
			}
		}
		if (shouldCopy) {
			await fsp.copyFile(sourcePath, INSTALLED_SCRIPT_PATH);
			await fsp.chmod(INSTALLED_SCRIPT_PATH, 0o755);
		}
	} catch (err) {
		// Surface error to caller log but do not throw — update script install
		// is best-effort at boot and must not crash the app.
		console.error('[update-runner] ensureUpdateScriptInstalled failed:', err);
	}
}

export type SpawnedRun = {
	logPath: string;
	exitcodeFile: string;
	unitName: string;
	startedAt: string;
	backupPath: string | null;
};

function hhmmss(d: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Spawn a detached systemd-run unit that executes the update script.
 *
 * Before spawning, this writes an initial header to the log file and creates
 * an auto-backup via the existing createBackup() helper. The backup path is
 * returned so it can be persisted in the run history. If the backup fails the
 * update is aborted — we do not start a potentially destructive update without
 * a known-good rollback target.
 */
export async function spawnUpdateRun(
	preSha: string,
	preSchemaHash: string
): Promise<SpawnedRun> {
	const ts = Date.now();
	const logPath = `/tmp/ip-cam-master-update-${ts}.log`;
	const exitcodeFile = `/tmp/ip-cam-master-update-${ts}.exitcode`;
	const unitName = `ip-cam-master-update-${ts}`;
	const startedAt = new Date(ts).toISOString();

	writeFileSync(logPath, `[${hhmmss()}] Pre-update auto-backup...\n`);

	let backupPath: string | null = null;
	try {
		const backup = await createBackup();
		backupPath = backup.absPath;
		appendFileSync(logPath, `[${hhmmss()}] Backup created: ${backup.absPath}\n`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		appendFileSync(
			logPath,
			`[${hhmmss()}] BACKUP FAILED — update aborted (no known-good restore point): ${msg}\n`
		);
		appendFileSync(logPath, `=== UPDATE_RESULT: failed (backup-aborted) ===\n`);
		writeFileSync(exitcodeFile, '1\n');
		throw new Error(`Auto-backup failed: ${msg}`);
	}

	const args = [
		`--unit=${unitName}`,
		'--service-type=oneshot',
		'--collect',
		'--quiet',
		`--setenv=LOG=${logPath}`,
		`--setenv=EXITCODE_FILE=${exitcodeFile}`,
		INSTALLED_SCRIPT_PATH,
		preSha,
		preSchemaHash
	];

	const child: ChildProcess = spawn('systemd-run', args, {
		detached: true,
		stdio: 'ignore'
	});
	child.unref();

	return { logPath, exitcodeFile, unitName, startedAt, backupPath };
}

export type TailEvent =
	| { type: 'log'; line: string }
	| { type: 'done'; exitCode: number; result: 'success' | 'failed' | 'rolled_back' };

function exitCodeToResult(code: number): 'success' | 'failed' | 'rolled_back' {
	if (code === 0) return 'success';
	if (code === 2) return 'rolled_back';
	return 'failed';
}

/** Sleep helper that rejects when aborted so the tail loop can exit promptly. */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			resolve();
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Async generator that tails a growing log file line-by-line and terminates
 * once an exitcode file appears.
 *
 * Strategy: poll-based with 500ms interval. This is simpler than fs.watch and
 * works across every filesystem the app might run on (tmpfs, ext4, overlayfs).
 */
export async function* tailUpdateLog(
	logPath: string,
	exitcodeFile: string,
	signal: AbortSignal
): AsyncIterable<TailEvent> {
	let position = 0;
	let buffer = '';

	while (!signal.aborted) {
		// Drain any new bytes from the log file first
		if (existsSync(logPath)) {
			try {
				const handle = await fsp.open(logPath, 'r');
				try {
					const stat = await handle.stat();
					if (stat.size > position) {
						const toRead = stat.size - position;
						const buf = Buffer.alloc(toRead);
						await handle.read(buf, 0, toRead, position);
						position = stat.size;
						buffer += buf.toString('utf8');
						let idx: number;
						while ((idx = buffer.indexOf('\n')) !== -1) {
							const line = buffer.slice(0, idx);
							buffer = buffer.slice(idx + 1);
							yield { type: 'log', line };
						}
					} else if (stat.size < position) {
						// Log rotated / truncated — reset and start over
						position = 0;
						buffer = '';
					}
				} finally {
					await handle.close();
				}
			} catch {
				// Transient read error — retry next tick
			}
		}

		// Check for completion marker
		if (existsSync(exitcodeFile)) {
			// Drain any final bytes
			if (existsSync(logPath)) {
				try {
					const handle = await fsp.open(logPath, 'r');
					try {
						const stat = await handle.stat();
						if (stat.size > position) {
							const toRead = stat.size - position;
							const buf = Buffer.alloc(toRead);
							await handle.read(buf, 0, toRead, position);
							position = stat.size;
							buffer += buf.toString('utf8');
							let idx: number;
							while ((idx = buffer.indexOf('\n')) !== -1) {
								const line = buffer.slice(0, idx);
								buffer = buffer.slice(idx + 1);
								yield { type: 'log', line };
							}
						}
					} finally {
						await handle.close();
					}
				} catch {
					/* ignore */
				}
			}
			if (buffer.length > 0) {
				yield { type: 'log', line: buffer };
				buffer = '';
			}
			try {
				const raw = (await fsp.readFile(exitcodeFile, 'utf8')).trim();
				const exitCode = Number.parseInt(raw, 10);
				const safeCode = Number.isFinite(exitCode) ? exitCode : 1;
				yield { type: 'done', exitCode: safeCode, result: exitCodeToResult(safeCode) };
			} catch {
				yield { type: 'done', exitCode: 1, result: 'failed' };
			}
			return;
		}

		await sleepAbortable(500, signal);
	}
}

/**
 * Parse `git status --porcelain` inside the install dir and return the list of
 * dirty entries (one per line, already trimmed). Returns an empty array on any
 * error so callers can rely on the shape.
 */
export async function getDirtyFiles(): Promise<string[]> {
	const installDir = findInstallDir();
	if (!installDir) return [];
	try {
		const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: installDir });
		return stdout
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch {
		return [];
	}
}
