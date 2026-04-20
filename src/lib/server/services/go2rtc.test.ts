import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
	env: {
		DB_ENCRYPTION_KEY: 'a'.repeat(32)
	}
}));

vi.mock('$lib/server/db/client', () => ({
	db: {}
}));
vi.mock('$lib/server/db/schema', () => ({
	settings: {},
	containers: {},
	cameras: {}
}));

import { generateGo2rtcConfig, generateSystemdUnit, getInstallCommands, checkStreamHealth, generateGo2rtcConfigBambuA1 } from './go2rtc';

describe('go2rtc service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	describe('generateGo2rtcConfig', () => {
		it('produces YAML with correct stream name and all hash params', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam-200',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 2000
			});

			expect(yaml).toContain('cam-200:');
			expect(yaml).toContain('#width=1280');
			expect(yaml).toContain('#height=720');
			expect(yaml).toContain('#video=h264');
			expect(yaml).toContain('192.168.3.22');
			expect(yaml).toContain('admin:secret');
		});

		it('includes #hardware=vaapi', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 2000
			});

			expect(yaml).toContain('#hardware=vaapi');
		});

		it('calculates bufsize as bitrate*2', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 2000
			});

			expect(yaml).toContain('-bufsize 4000k');
		});

		it('uses HTTP MJPEG for video + RTSP audio passthrough with reconnect', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 2000
			});

			// HTTP video source with reconnect
			expect(yaml).toContain('http://admin:secret@192.168.3.22/control/faststream.jpg');
			expect(yaml).toContain('stream=full');
			expect(yaml).toContain('-reconnect 1');
			// RTSP audio passthrough
			expect(yaml).toContain('rtsp://admin:secret@192.168.3.22:554/stream0/mobotix.mjpeg');
			expect(yaml).toContain('audio=copy');
			expect(yaml).toContain('-vn');
		});
	});

	describe('generateSystemdUnit', () => {
		it('contains ExecStart and Restart=always', () => {
			const unit = generateSystemdUnit();

			expect(unit).toContain('ExecStart=/usr/local/bin/go2rtc');
			expect(unit).toContain('Restart=always');
			expect(unit).toContain('-config /etc/go2rtc/go2rtc.yaml');
		});
	});

	describe('getInstallCommands', () => {
		it('includes ffmpeg install and go2rtc binary download', () => {
			const cmds = getInstallCommands();

			expect(cmds.length).toBeGreaterThanOrEqual(3);
			expect(cmds.some((c: string) => c.includes('ffmpeg'))).toBe(true);
			expect(cmds.some((c: string) => c.includes('go2rtc_linux_amd64'))).toBe(true);
			expect(cmds.some((c: string) => c.includes('mkdir -p /etc/go2rtc'))).toBe(true);
		});
	});

	describe('checkStreamHealth', () => {
		it('returns active=true when stream has producers', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({
					'cam-200': {
						producers: [{ url: 'rtsp://...' }],
						consumers: []
					}
				}), { status: 200 })
			);

			const result = await checkStreamHealth('10.0.0.5', 'cam-200');

			expect(result.active).toBe(true);
			expect(result.producers).toBeGreaterThan(0);
		});

		it('returns active=false when stream not found', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({}), { status: 200 })
			);

			const result = await checkStreamHealth('10.0.0.5', 'cam-200');

			expect(result.active).toBe(false);
			expect(result.producers).toBe(0);
		});

		it('returns active=false when fetch throws', async () => {
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

			const result = await checkStreamHealth('10.0.0.5', 'cam-200');

			expect(result.active).toBe(false);
			expect(result.producers).toBe(0);
		});
	});

	describe('generateGo2rtcConfigBambuA1 (Phase 18 / BAMBU-A1-08)', () => {
		it('emits exec: source with env-var access code and kill signals', () => {
			const yaml = generateGo2rtcConfigBambuA1({
				streamName: 'bambu_a1_test',
				printerIp: '192.168.3.195',
				accessCode: 'abc12345'
			});

			expect(yaml).toContain('bambu_a1_test:');
			expect(yaml).toContain('exec:env A1_ACCESS_CODE=abc12345');
			expect(yaml).toContain('node /opt/ipcm/bambu-a1-camera.mjs');
			expect(yaml).toContain('--ip=192.168.3.195');
			expect(yaml).toContain('#killsignal=15');
			expect(yaml).toContain('#killtimeout=5');
			// Access code must NOT appear as --access-code= (ps-ax leak per Anti-Pattern 4)
			expect(yaml).not.toContain('--access-code=');
		});

		it('includes the rtsp server block when rtspAuth is provided', () => {
			const yaml = generateGo2rtcConfigBambuA1({
				streamName: 'bambu_a1',
				printerIp: '10.0.0.1',
				accessCode: 'z',
				rtspAuth: { username: 'bambu', password: 'z' }
			});

			expect(yaml).toContain('rtsp:');
			expect(yaml).toContain("username: 'bambu'");
		});
	});

	describe('getInstallCommands — Bambu A1 Node hoist (Phase 18 / Pitfall 5)', () => {
		it('without forBambuA1 flag, installs the existing baseline (no Node)', () => {
			const cmds = getInstallCommands();
			expect(cmds.some((c) => c.includes('nodesource.com'))).toBe(false);
		});

		it('with forBambuA1=true, appends exactly one NodeSource Node 22 install line', () => {
			const base = getInstallCommands();
			const withA1 = getInstallCommands(true);

			expect(withA1.length).toBe(base.length + 1);
			expect(withA1[withA1.length - 1]).toMatch(/nodesource\.com\/setup_22\.x/);
			expect(withA1[withA1.length - 1]).toContain('nodejs');
		});
	});
});
