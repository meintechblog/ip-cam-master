import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'update.sh');

/**
 * TEXTUAL fallback — always runs, even in CI where git + bash integration is
 * flaky. Verifies every rollback branch of scripts/update.sh has the expected
 * marker strings so the CI signal stays reliable.
 */
describe('scripts/update.sh static invariants', () => {
	let script: string;

	beforeAll(() => {
		script = readFileSync(SCRIPT_PATH, 'utf8');
	});

	it('has set -o pipefail', () => {
		expect(script).toContain('set -o pipefail');
	});

	it('has UPDATE_RESULT: success marker', () => {
		expect(script).toContain('UPDATE_RESULT: success');
	});

	it('has UPDATE_RESULT: failed marker for build failure branch', () => {
		expect(script).toMatch(/UPDATE_RESULT: failed .+rolled back/);
	});

	it('writes exitcode 2 from the rollback helper', () => {
		expect(script).toMatch(/write_exit 2/);
	});

	it('writes exitcode 0 only on success path', () => {
		expect(script).toMatch(/write_exit 0/);
	});

	it('calls git reset --hard $PRE_SHA in rollback paths', () => {
		expect(script).toContain('git reset --hard "$PRE_SHA"');
	});

	it('has a schema hash comparison via sha256sum', () => {
		expect(script).toContain('sha256sum src/lib/server/db/schema.ts');
	});

	it('emits WARNING: schema.ts changed on mismatch', () => {
		expect(script).toContain('WARNING: schema.ts changed');
	});

	it('reads LOG and EXITCODE_FILE from env with defaults', () => {
		expect(script).toContain('LOG="${LOG:-');
		expect(script).toContain('EXITCODE_FILE="${EXITCODE_FILE:-');
	});

	it('rolls back on install failure', () => {
		expect(script).toMatch(/rollback "install failed"/);
	});

	it('rolls back on build failure', () => {
		expect(script).toMatch(/rollback "build failed"/);
	});

	it('rolls back on restart failure', () => {
		expect(script).toMatch(/rollback "restart failed"/);
	});

	it('rolls back on service-inactive-after-restart', () => {
		expect(script).toMatch(/rollback "service inactive after restart"/);
	});

	it('handles git pull failure with a reset + failed marker', () => {
		expect(script).toMatch(/UPDATE_RESULT: failed .*pull failed/);
	});
});

/**
 * INTEGRATION test — spawns the real scripts/update.sh against a throwaway git
 * repo with stubbed npm and systemctl binaries on PATH so nothing is actually
 * installed or restarted. Simulates a build failure and asserts:
 *  1. git reset --hard $PRE_SHA runs
 *  2. The log file contains the UPDATE_RESULT: failed marker
 *  3. The exitcode file contains `2`
 *
 * This test is skipped unless TEST_UPDATE_ROLLBACK=1 is set because it shells
 * out to git + bash and is too flaky on some CI runners.
 */
const integrationEnabled = process.env.TEST_UPDATE_ROLLBACK === '1';

describe.skipIf(!integrationEnabled)('scripts/update.sh integration rollback', () => {
	let tmpdir: string;
	let preSha: string;

	beforeAll(async () => {
		const rootTmp = mkdtempSync(path.join(os.tmpdir(), 'update-rollback-'));
		const originDir = path.join(rootTmp, 'origin.git');
		tmpdir = path.join(rootTmp, 'workdir');

		// 1. Create a bare origin so `git pull origin main` actually works.
		mkdirSync(originDir, { recursive: true });
		await execFileAsync('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: originDir });

		// 2. Clone it into the working tree.
		await execFileAsync('git', ['clone', '-q', originDir, tmpdir]);
		await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpdir });
		await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tmpdir });

		// 3. Initial commit on main with a package.json whose build will fail and
		//    a schema file so the sha256sum compare has something to read.
		writeFileSync(
			path.join(tmpdir, 'package.json'),
			JSON.stringify({ name: 'fake', scripts: { build: "node -e 'process.exit(1)'" } }, null, 2)
		);
		mkdirSync(path.join(tmpdir, 'src', 'lib', 'server', 'db'), { recursive: true });
		writeFileSync(path.join(tmpdir, 'src', 'lib', 'server', 'db', 'schema.ts'), '// empty\n');
		await execFileAsync('git', ['add', '.'], { cwd: tmpdir });
		await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: tmpdir });
		await execFileAsync('git', ['branch', '-M', 'main'], { cwd: tmpdir });
		await execFileAsync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: tmpdir });

		const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpdir });
		preSha = stdout.trim();

		// Stubbed bin dir — npm always succeeds for install but we'll let the real
		// package.json build script be what runs via `npm run build`. To keep the
		// test hermetic we stub npm entirely: install returns 0, run build returns 1.
		const binDir = path.join(tmpdir, 'bin');
		mkdirSync(binDir, { recursive: true });
		writeFileSync(
			path.join(binDir, 'npm'),
			`#!/bin/sh
case "$1" in
  install) exit 0 ;;
  run)
    case "$2" in
      build) exit 1 ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac
`
		);
		writeFileSync(
			path.join(binDir, 'systemctl'),
			`#!/bin/sh
exit 0
`
		);
		chmodSync(path.join(binDir, 'npm'), 0o755);
		chmodSync(path.join(binDir, 'systemctl'), 0o755);
	});

	it('rolls back to PRE_SHA when npm run build fails', async () => {
		const logPath = path.join(tmpdir, 'update.log');
		const exitcodeFile = path.join(tmpdir, 'update.exitcode');

		// Clear any prior state
		if (existsSync(logPath)) rmSync(logPath);
		if (existsSync(exitcodeFile)) rmSync(exitcodeFile);

		// Simulate upstream commit by pushing a new commit to origin from a
		// scratch clone, so `git pull` in the workdir has something to fast-forward to.
		const pushDir = path.join(path.dirname(tmpdir), 'push-clone');
		if (existsSync(pushDir)) rmSync(pushDir, { recursive: true, force: true });
		const originDir = path.join(path.dirname(tmpdir), 'origin.git');
		await execFileAsync('git', ['clone', '-q', originDir, pushDir]);
		await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: pushDir });
		await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: pushDir });
		writeFileSync(path.join(pushDir, 'new-upstream.txt'), 'upstream commit\n');
		await execFileAsync('git', ['add', '.'], { cwd: pushDir });
		await execFileAsync('git', ['commit', '-q', '-m', 'upstream'], { cwd: pushDir });
		await execFileAsync('git', ['push', '-q', 'origin', 'main'], { cwd: pushDir });

		try {
			await execFileAsync('bash', [SCRIPT_PATH, preSha, 'deadbeef'], {
				cwd: tmpdir,
				env: {
					...process.env,
					PATH: `${tmpdir}/bin:${process.env.PATH}`,
					LOG: logPath,
					EXITCODE_FILE: exitcodeFile,
					INSTALL_DIR: tmpdir
				},
				timeout: 30_000
			});
		} catch {
			// Script exits 0 in the rollback path (it uses `exit 0` after writing 2
			// to the exitcode file so systemd-run treats the unit as succeeded). If
			// execFileAsync throws, the test still validates the files below.
		}

		// Exit code file should contain 2 (rolled back)
		expect(existsSync(exitcodeFile)).toBe(true);
		expect(readFileSync(exitcodeFile, 'utf8').trim()).toBe('2');

		// Log should contain the failed marker and rollback evidence
		const log = readFileSync(logPath, 'utf8');
		expect(log).toMatch(/UPDATE_RESULT: failed \(build failed.+rolled back/);
		expect(log).toMatch(/ROLLBACK: build failed/);

		// Git HEAD should match preSha
		const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpdir });
		expect(stdout.trim()).toBe(preSha);
	}, 60_000);
});
