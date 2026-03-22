import type { StreamInfo } from '$lib/types';

export interface Go2rtcConfigParams {
	streamName: string;
	cameraIp: string;
	username: string;
	password: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	streamPath?: string;
}

/**
 * Generates go2rtc YAML config for a Mobotix camera with VAAPI hardware transcoding.
 */
export function generateGo2rtcConfig(params: Go2rtcConfigParams): string {
	const {
		streamName,
		cameraIp,
		username,
		password,
		width,
		height,
		fps,
		bitrate,
		streamPath = '/stream0/mobotix.mjpeg'
	} = params;

	const bufsize = bitrate * 2;

	return `streams:
  ${streamName}: ffmpeg:rtsp://${username}:${password}@${cameraIp}:554${streamPath}#video=h264#width=${width}#height=${height}#raw=-r ${fps}#raw=-maxrate ${bitrate}k#raw=-bufsize ${bufsize}k#raw=-g ${fps}#hardware=vaapi
`;
}

/**
 * Generates a systemd unit file for go2rtc.
 */
export function generateSystemdUnit(): string {
	return `[Unit]
Description=go2rtc streaming server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/go2rtc -config /etc/go2rtc/go2rtc.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Returns shell commands to install ffmpeg and go2rtc in an LXC container.
 */
export function getInstallCommands(): string[] {
	return [
		'apt-get update -qq && apt-get install -y -qq ffmpeg wget',
		'wget -q https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 -O /usr/local/bin/go2rtc && chmod +x /usr/local/bin/go2rtc',
		'mkdir -p /etc/go2rtc'
	];
}

/**
 * Checks stream health via go2rtc HTTP API.
 */
export async function checkStreamHealth(
	containerIp: string,
	streamName: string
): Promise<StreamInfo> {
	try {
		const response = await fetch(`http://${containerIp}:1984/api/streams`);
		const data = await response.json();

		const stream = data[streamName];
		if (!stream) {
			return { active: false, codec: null, producers: 0, resolution: null };
		}

		const producers = Array.isArray(stream.producers) ? stream.producers.length : 0;

		return {
			active: producers > 0,
			codec: stream.producers?.[0]?.codec || null,
			producers,
			resolution: stream.producers?.[0]?.resolution || null
		};
	} catch {
		return { active: false, codec: null, producers: 0, resolution: null };
	}
}
