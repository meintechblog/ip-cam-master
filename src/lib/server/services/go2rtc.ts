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
 * Returns shell commands to install the ONVIF server in an LXC container.
 */
export function getOnvifInstallCommands(): string[] {
	return [
		'apt-get install -y -qq git curl',
		'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
		'apt-get install -y -qq nodejs',
		'cd /root && git clone https://github.com/daniela-hase/onvif-server.git',
		'cd /root/onvif-server && npm install --production'
	];
}

/**
 * Generates ONVIF server config.yaml for a camera stream.
 */
export function generateOnvifConfig(params: {
	streamName: string;
	cameraName: string;
	mac: string;
	uuid: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	onvifPort?: number;
}): string {
	const {
		streamName,
		cameraName,
		mac,
		uuid,
		width,
		height,
		fps,
		bitrate,
		onvifPort = 8899
	} = params;

	return `onvif:
  - mac: ${mac}
    ports:
      server: ${onvifPort}
      rtsp: 8556
      snapshot: 8580
    name: ${cameraName}
    uuid: ${uuid}
    highQuality:
      rtsp: /${streamName}
      snapshot: /api/frame.jpeg?src=${streamName}
      width: ${width}
      height: ${height}
      framerate: ${fps}
      bitrate: ${bitrate}
    target:
      hostname: localhost
      ports:
        rtsp: 8554
        snapshot: 1984
`;
}

/**
 * Generates a systemd unit file for the ONVIF server.
 */
export function generateOnvifSystemdUnit(): string {
	return `[Unit]
Description=ONVIF Server
After=go2rtc.service network-online.target

[Service]
Type=simple
WorkingDirectory=/root/onvif-server
ExecStartPre=/bin/sleep 12
ExecStart=/usr/bin/node /root/onvif-server/main.js /root/onvif-server/config.yaml
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`;
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
