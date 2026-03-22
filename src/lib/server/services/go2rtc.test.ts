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

import { generateGo2rtcConfig, generateSystemdUnit, getInstallCommands, checkStreamHealth } from './go2rtc';

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
				bitrate: 5000
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
				bitrate: 5000
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
				bitrate: 5000
			});

			expect(yaml).toContain('-bufsize 10000k');
		});

		it('uses provided streamPath in RTSP URL', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 5000,
				streamPath: '/custom/path.mjpeg'
			});

			expect(yaml).toContain('/custom/path.mjpeg');
		});

		it('defaults streamPath to /stream0/mobotix.mjpeg', () => {
			const yaml = generateGo2rtcConfig({
				streamName: 'cam',
				cameraIp: '192.168.3.22',
				username: 'admin',
				password: 'secret',
				width: 1280,
				height: 720,
				fps: 20,
				bitrate: 5000
			});

			expect(yaml).toContain('/stream0/mobotix.mjpeg');
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
});
