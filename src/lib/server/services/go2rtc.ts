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
	streamPath?: string; // deprecated — HTTP MJPEG URL is now generated automatically
}

/**
 * Generates go2rtc YAML config with VAAPI hardware transcoding.
 * Works for both Mobotix (HTTP MJPEG + RTSP audio) and Loxone (nginx proxy, no audio).
 */
export function generateGo2rtcConfig(params: Go2rtcConfigParams): string {
	const { streamName, cameraIp, username, password, width, height, fps, bitrate } = params;
	const bufsize = bitrate * 2;
	const sourceUrl = `http://${username}:${password}@${cameraIp}/control/faststream.jpg?stream=full&fps=${fps}&needlength`;
	const vaapiBase = `#video=h264#raw=-g ${fps}#hardware=vaapi#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2`;

	// HQ: full resolution + audio passthrough
	const hqVideo = `ffmpeg:${sourceUrl}${vaapiBase}#width=${width}#height=${height}#raw=-maxrate ${bitrate}k#raw=-bufsize ${bufsize}k`;
	const audioSource = `ffmpeg:rtsp://${username}:${password}@${cameraIp}:554/stream0/mobotix.mjpeg#raw=-vn#audio=copy#raw=-rtsp_transport tcp`;

	// LQ: half resolution, lower bitrate, no audio
	const lqWidth = Math.round(width / 2);
	const lqHeight = Math.round(height / 2);
	const lqBitrate = Math.max(500, Math.round(bitrate / 5));
	const lqBufsize = lqBitrate * 2;
	const lqVideo = `ffmpeg:${sourceUrl}${vaapiBase}#width=${lqWidth}#height=${lqHeight}#raw=-maxrate ${lqBitrate}k#raw=-bufsize ${lqBufsize}k`;

	return `streams:
  ${streamName}:
    - ${hqVideo}
    - ${audioSource}
  ${streamName}-low:
    - ${lqVideo}

ffmpeg:
  bin: ffmpeg

log:
  level: info
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
		// Debian 13 (Trixie) ships intel-media-va-driver 25.x with Arrow Lake+ support
		'apt-get update -qq && apt-get install -y -qq ffmpeg intel-media-va-driver wget',
		'wget -q https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 -O /usr/local/bin/go2rtc && chmod +x /usr/local/bin/go2rtc',
		'mkdir -p /etc/go2rtc'
	];
}

/**
 * Generates go2rtc YAML config for a Loxone Intercom (reads from local nginx proxy, no audio).
 */
export function generateGo2rtcConfigLoxone(params: {
	streamName: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
}): string {
	const { streamName, width, height, fps, bitrate } = params;
	const bufsize = bitrate * 2;
	const sourceUrl = `http://localhost:8081/mjpg/video.mjpg`;
	const vaapiBase = `#video=h264#raw=-r ${fps}#raw=-g ${fps}#hardware=vaapi#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2`;

	// LQ: half resolution, lower bitrate
	const lqWidth = Math.round(width / 2);
	const lqHeight = Math.round(height / 2);
	const lqBitrate = Math.max(500, Math.round(bitrate / 5));
	const lqBufsize = lqBitrate * 2;

	return `streams:
  ${streamName}:
    - ffmpeg:${sourceUrl}${vaapiBase}#width=${width}#height=${height}#raw=-maxrate ${bitrate}k#raw=-bufsize ${bufsize}k
  ${streamName}-low:
    - ffmpeg:${sourceUrl}${vaapiBase}#width=${lqWidth}#height=${lqHeight}#raw=-maxrate ${lqBitrate}k#raw=-bufsize ${lqBufsize}k

ffmpeg:
  bin: ffmpeg

log:
  level: info
`;
}

/**
 * Generates nginx config for Loxone Intercom auth-proxy.
 */
export function generateNginxConfig(intercomIp: string, username: string, password: string): string {
	const authBase64 = Buffer.from(`${username}:${password}`).toString('base64');

	return `worker_processes 1;

events {
    worker_connections 1024;
}

http {
    server {
        listen 127.0.0.1:8081;

        location /mjpg/ {
            proxy_pass http://${intercomIp}/mjpg/;
            proxy_set_header Authorization "Basic ${authBase64}";
            proxy_set_header Host $host;
            proxy_set_header Connection "";
            proxy_http_version 1.1;
            proxy_buffering off;
        }
    }
}
`;
}

/**
 * Returns shell commands to install nginx in an LXC container.
 */
export function getNginxInstallCommands(): string[] {
	return [
		'apt-get install -y -qq nginx'
	];
}

/**
 * Returns shell commands to install the ONVIF server in an LXC container.
 */
export function getOnvifInstallCommands(): string[] {
	// Single combined command to minimize SSH roundtrips (saves ~2 min)
	return [
		'apt-get install -y -qq git curl && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs && cd /root && git clone https://github.com/daniela-hase/onvif-server.git && cd /root/onvif-server && npm install --production'
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

	const lqWidth = Math.round(width / 2);
	const lqHeight = Math.round(height / 2);
	const lqBitrate = Math.max(500, Math.round(bitrate / 5));

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
      quality: 4
    lowQuality:
      rtsp: /${streamName}-low
      snapshot: /api/frame.jpeg?src=${streamName}
      width: ${lqWidth}
      height: ${lqHeight}
      framerate: ${fps}
      bitrate: ${lqBitrate}
      quality: 1
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
ExecStartPre=/root/onvif-server/update-mac.sh
ExecStart=/usr/bin/node /root/onvif-server/main.js /root/onvif-server/config.yaml
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Returns a Node.js script that patches the ONVIF server to advertise
 * AudioSourceConfiguration + G.711 AudioEncoderConfiguration in profiles.
 * This makes UniFi Protect enable the mic toggle and receive audio.
 */
export function getOnvifAudioPatch(): string {
	return `const fs = require('fs');
const path = '/root/onvif-server/src/onvif-server.js';
let code = fs.readFileSync(path, 'utf8');

if (code.includes('AudioSourceConfiguration')) {
  console.log('Already patched');
  process.exit(0);
}

// Add audioSource after videoSource
code = code.replace(
  "this.profiles = [",
  \`this.audioSource = {
            attributes: { token: 'audio_src_token' },
            Channels: 1
        };

        this.profiles = [\`
);

// Audio config block for profiles
const audioConfig = \`                AudioSourceConfiguration: {
                    Name: 'AudioSource',
                    UseCount: 2,
                    attributes: { token: 'audio_src_config_token' },
                    SourceToken: 'audio_src_token'
                },
                AudioEncoderConfiguration: {
                    attributes: { token: 'audio_encoder_config_token' },
                    Name: 'G711',
                    UseCount: 1,
                    Encoding: 'G711',
                    Bitrate: 64,
                    SampleRate: 8,
                    SessionTimeout: 'PT1000S'
                },\`;

// Insert into MainStream profile
code = code.replace(
  \`                VideoEncoderConfiguration: {
                    attributes: {
                        token: 'encoder_hq_config_token'
                    },\`,
  audioConfig + \`
                VideoEncoderConfiguration: {
                    attributes: {
                        token: 'encoder_hq_config_token'
                    },\`
);

// Insert into SubStream profile
code = code.replace(
  \`                    VideoEncoderConfiguration: {
                        attributes: {
                            token: 'encoder_lq_config_token'
                        },\`,
  audioConfig.replace(/^/gm, '    ') + \`
                    VideoEncoderConfiguration: {
                        attributes: {
                            token: 'encoder_lq_config_token'
                        },\`
);

// Add GetAudioSources handler
code = code.replace(
  "GetProfiles: (args) =>",
  \`GetAudioSources: (args) => {
                        return { AudioSources: this.audioSource };
                    },
                    GetAudioEncoderConfigurations: (args) => {
                        return {
                            Configurations: {
                                attributes: { token: 'audio_encoder_config_token' },
                                Name: 'G711',
                                UseCount: 1,
                                Encoding: 'G711',
                                Bitrate: 64,
                                SampleRate: 8,
                                SessionTimeout: 'PT1000S'
                            }
                        };
                    },
                    GetProfiles: (args) =>\`
);

fs.writeFileSync(path, code);
console.log('ONVIF audio patch applied');
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
			return { active: false, codec: null, audioCodec: null, producers: 0, resolution: null };
		}

		const producers = Array.isArray(stream.producers) ? stream.producers.length : 0;
		const audioProducer = stream.producers?.find((p: any) =>
			p.medias?.some((m: string) => m.includes('audio'))
		);
		const audioCodec = audioProducer?.medias
			?.find((m: string) => m.includes('audio'))
			?.match(/audio,\s*\w+,\s*(.+)/)?.[1] || null;

		return {
			active: producers > 0,
			codec: stream.producers?.[0]?.codec || null,
			audioCodec,
			producers,
			resolution: stream.producers?.[0]?.resolution || null
		};
	} catch {
		return { active: false, codec: null, audioCodec: null, producers: 0, resolution: null };
	}
}
