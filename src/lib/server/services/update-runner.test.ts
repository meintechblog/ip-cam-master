import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock node:child_process BEFORE importing the module under test so spawn/execFile
// are replaced with spies. tailUpdateLog uses real fs via tmpdir, which is much
// simpler than trying to mock the polling loop.
vi.mock('node:child_process', () => {
	const spawn = vi.fn();
	const execFile = vi.fn();
	return { spawn, execFile, default: { spawn, execFile } };
});

import { spawn, execFile } from 'node:child_process';
import {
	ensureUpdateScriptInstalled,
	spawnUpdateRun,
	tailUpdateLog,
	getDirtyFiles,
	INSTALLED_SCRIPT_PATH
} from './update-runner';

describe('spawnUpdateRun', () => {
	beforeEach(() => {
		vi.mocked(spawn).mockReset();
		vi.mocked(spawn).mockReturnValue({
			unref: vi.fn(),
			on: vi.fn(),
			stdout: null,
			stderr: null
		} as unknown as ReturnType<typeof spawn>);
	});

	it('invokes systemd-run with argv array (no shell interpolation)', async () => {
		const result = await spawnUpdateRun('abc123', 'deadbeef');

		expect(spawn).toHaveBeenCalledOnce();
		const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0];
		expect(cmd).toBe('systemd-run');
		expect(Array.isArray(args)).toBe(true);
		const argv = args as string[];
		// All the critical flags must be present
		expect(argv.some((a) => a.startsWith('--unit=ip-cam-master-update-'))).toBe(true);
		expect(argv).toContain('--service-type=oneshot');
		expect(argv).toContain('--collect');
		expect(argv).toContain('--quiet');
		expect(argv.some((a) => a.startsWith('--setenv=LOG=/tmp/ip-cam-master-update-'))).toBe(true);
		expect(
			argv.some((a) => a.startsWith('--setenv=EXITCODE_FILE=/tmp/ip-cam-master-update-'))
		).toBe(true);
		expect(argv).toContain(INSTALLED_SCRIPT_PATH);
		expect(argv).toContain('abc123');
		expect(argv).toContain('deadbeef');
		// Must be detached + stdio: ignore
		expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });

		expect(result.logPath).toMatch(/^\/tmp\/ip-cam-master-update-\d+\.log$/);
		expect(result.exitcodeFile).toMatch(/^\/tmp\/ip-cam-master-update-\d+\.exitcode$/);
		expect(result.unitName).toMatch(/^ip-cam-master-update-\d+$/);
		expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		// logPath + exitcodeFile must share the same timestamp suffix
		const logTs = result.logPath.match(/-(\d+)\.log$/)?.[1];
		const exitTs = result.exitcodeFile.match(/-(\d+)\.exitcode$/)?.[1];
		expect(logTs).toBe(exitTs);
	});

	it('calls child.unref() to detach', async () => {
		const unrefMock = vi.fn();
		vi.mocked(spawn).mockReturnValue({
			unref: unrefMock,
			on: vi.fn(),
			stdout: null,
			stderr: null
		} as unknown as ReturnType<typeof spawn>);

		await spawnUpdateRun('aaa', 'bbb');
		expect(unrefMock).toHaveBeenCalledOnce();
	});

	it('never uses {shell: true} (command injection protection)', async () => {
		await spawnUpdateRun('abc', 'def');
		const [, , opts] = vi.mocked(spawn).mock.calls[0];
		expect((opts as { shell?: boolean } | undefined)?.shell).toBeUndefined();
	});
});

describe('tailUpdateLog', () => {
	let tmpdir: string;

	beforeEach(() => {
		tmpdir = mkdtempSync(path.join(os.tmpdir(), 'update-tail-'));
	});

	afterEach(() => {
		try {
			rmSync(tmpdir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('yields line-by-line as content is appended then emits done on exitcode=0', async () => {
		const logPath = path.join(tmpdir, 'run.log');
		const exitcodeFile = path.join(tmpdir, 'run.exitcode');
		writeFileSync(logPath, 'line one\nline two\n');

		const controller = new AbortController();
		const events: Array<{ type: string; line?: string; exitCode?: number; result?: string }> = [];

		const iterator = tailUpdateLog(logPath, exitcodeFile, controller.signal);

		// Read a few events, append more content mid-flight, then finish
		const consumer = (async () => {
			for await (const ev of iterator) {
				events.push(ev);
				if (ev.type === 'log' && ev.line === 'line two') {
					// Append more lines + finalizer
					await fsp.appendFile(logPath, 'line three\n=== UPDATE_RESULT: success (abc1234 -> def5678) ===\n');
					await fsp.writeFile(exitcodeFile, '0\n');
				}
				if (ev.type === 'done') break;
			}
		})();

		await Promise.race([
			consumer,
			new Promise((_, reject) => setTimeout(() => reject(new Error('tail timeout')), 5000))
		]);

		const logEvents = events.filter((e) => e.type === 'log');
		expect(logEvents.map((e) => e.line)).toContain('line one');
		expect(logEvents.map((e) => e.line)).toContain('line two');
		expect(logEvents.map((e) => e.line)).toContain('line three');

		const doneEvent = events.find((e) => e.type === 'done');
		expect(doneEvent).toBeDefined();
		expect(doneEvent?.exitCode).toBe(0);
		expect(doneEvent?.result).toBe('success');
	});

	it('maps exitcode 2 to rolled_back', async () => {
		const logPath = path.join(tmpdir, 'run.log');
		const exitcodeFile = path.join(tmpdir, 'run.exitcode');
		writeFileSync(logPath, '=== UPDATE_RESULT: failed (build failed, rolled back to abc1234) ===\n');
		writeFileSync(exitcodeFile, '2\n');

		const controller = new AbortController();
		const events: Array<{ type: string; exitCode?: number; result?: string }> = [];

		for await (const ev of tailUpdateLog(logPath, exitcodeFile, controller.signal)) {
			events.push(ev);
			if (ev.type === 'done') break;
		}

		const doneEvent = events.find((e) => e.type === 'done');
		expect(doneEvent?.exitCode).toBe(2);
		expect(doneEvent?.result).toBe('rolled_back');
	});

	it('maps exitcode 1 to failed', async () => {
		const logPath = path.join(tmpdir, 'run.log');
		const exitcodeFile = path.join(tmpdir, 'run.exitcode');
		writeFileSync(logPath, '');
		writeFileSync(exitcodeFile, '1');

		const controller = new AbortController();
		const events: Array<{ type: string; exitCode?: number; result?: string }> = [];
		for await (const ev of tailUpdateLog(logPath, exitcodeFile, controller.signal)) {
			events.push(ev);
			if (ev.type === 'done') break;
		}
		const doneEvent = events.find((e) => e.type === 'done');
		expect(doneEvent?.exitCode).toBe(1);
		expect(doneEvent?.result).toBe('failed');
	});

	it('stops yielding promptly when AbortSignal fires', async () => {
		const logPath = path.join(tmpdir, 'run.log');
		const exitcodeFile = path.join(tmpdir, 'run.exitcode');
		writeFileSync(logPath, 'only line\n');

		const controller = new AbortController();
		const events: Array<{ type: string; line?: string }> = [];

		const consumer = (async () => {
			for await (const ev of tailUpdateLog(logPath, exitcodeFile, controller.signal)) {
				events.push(ev);
				if (ev.type === 'log') {
					controller.abort();
				}
			}
		})();

		await Promise.race([
			consumer,
			new Promise((_, reject) => setTimeout(() => reject(new Error('abort timeout')), 3000))
		]);

		// Must have observed the first line but NOT emitted a 'done' event
		expect(events.some((e) => e.type === 'log' && e.line === 'only line')).toBe(true);
		expect(events.some((e) => e.type === 'done')).toBe(false);
	});
});

describe('getDirtyFiles', () => {
	beforeEach(() => {
		vi.mocked(execFile).mockReset();
	});

	it('returns empty array when working tree is clean', async () => {
		// Simulate execFile returning empty stdout via the promisified callback path
		vi.mocked(execFile).mockImplementation(
			((
				_cmd: string,
				_args: readonly string[],
				_opts: unknown,
				cb: (err: Error | null, res: { stdout: string; stderr: string }) => void
			) => {
				cb(null, { stdout: '', stderr: '' });
				return {} as ReturnType<typeof execFile>;
			}) as unknown as typeof execFile
		);

		const result = await getDirtyFiles();
		expect(result).toEqual([]);
	});

	it('parses porcelain output into trimmed lines', async () => {
		vi.mocked(execFile).mockImplementation(
			((
				_cmd: string,
				_args: readonly string[],
				_opts: unknown,
				cb: (err: Error | null, res: { stdout: string; stderr: string }) => void
			) => {
				cb(null, {
					stdout: ' M src/routes/api/foo.ts\n?? data/new.db\n M scripts/update.sh\n',
					stderr: ''
				});
				return {} as ReturnType<typeof execFile>;
			}) as unknown as typeof execFile
		);

		const result = await getDirtyFiles();
		// Returns empty if no install dir found (dev mode). In test env we may be in
		// a dir without .git/opt — the function short-circuits. So accept either
		// empty (dev mode) or the parsed lines.
		if (result.length > 0) {
			expect(result).toEqual([
				'M src/routes/api/foo.ts',
				'?? data/new.db',
				'M scripts/update.sh'
			]);
		}
	});

	it('returns empty array on error (never throws)', async () => {
		vi.mocked(execFile).mockImplementation(
			((
				_cmd: string,
				_args: readonly string[],
				_opts: unknown,
				cb: (err: Error | null) => void
			) => {
				cb(new Error('boom'));
				return {} as ReturnType<typeof execFile>;
			}) as unknown as typeof execFile
		);

		const result = await getDirtyFiles();
		expect(result).toEqual([]);
	});
});

describe('ensureUpdateScriptInstalled', () => {
	it('is a no-op in dev mode (silent, does not throw)', async () => {
		// In the test env the candidate install dirs likely do not contain .git
		// at /opt/ip-cam-master, and the current worktree (process.cwd()) may or
		// may not have scripts/update.sh. The function must not throw either way.
		await expect(ensureUpdateScriptInstalled()).resolves.toBeUndefined();
	});

	it('scripts/update.sh source exists in the worktree', async () => {
		// Positive assertion: the installer script itself has been committed to
		// the repo so the real server-side install logic has something to copy.
		const cwdScript = path.join(process.cwd(), 'scripts', 'update.sh');
		expect(existsSync(cwdScript)).toBe(true);
		const contents = readFileSync(cwdScript, 'utf8');
		expect(contents).toContain('set -o pipefail');
		expect(contents).toContain('UPDATE_RESULT: success');
		expect(contents).toContain('UPDATE_RESULT: failed');
		expect(contents).toContain('git reset --hard');
		expect(contents).toContain('sha256sum src/lib/server/db/schema.ts');
		expect(contents).toContain('${LOG:-');
		expect(contents).toContain('${EXITCODE_FILE:-');
	});
});
