export type ContainerStatus = 'running' | 'stopped' | 'error' | 'unknown';
export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'onvif' | 'bambu' | 'other';

export interface ProxmoxSettings {
	proxmox_host: string;
	proxmox_token_id: string;
	proxmox_token_secret: string;
	proxmox_storage: string;
	proxmox_bridge: string;
	proxmox_vmid_start: string;
}

export interface UnifiSettings {
	unifi_host: string;
	unifi_username: string;
	unifi_password: string;
}

export interface ContainerInfo {
	vmid: number;
	hostname: string;
	cameraName?: string;
	cameraIp?: string;
	cameraType?: CameraType;
	status: ContainerStatus;
	cpu?: number;
	memory?: { used: number; total: number };
	mac?: string | null;
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
	nodeName?: string;
}

export interface SettingRecord {
	key: string;
	value: string;
	encrypted: boolean;
}

export type CameraStatus = 'pending' | 'container_created' | 'go2rtc_configured' | 'configured' | 'verified';

export const CAMERA_STATUS = {
	PENDING: 'pending',
	CONTAINER_CREATED: 'container_created',
	GO2RTC_CONFIGURED: 'go2rtc_configured',
	CONFIGURED: 'configured',
	VERIFIED: 'verified'
} as const satisfies Record<string, CameraStatus>;

export interface TranscodeParams {
	width: number;
	height: number;
	fps: number;
	bitrate: number;
}

export interface Camera {
	id: number;
	vmid: number;
	name: string;
	ip: string;
	username: string;
	password: string;
	cameraType: CameraType;
	streamPath: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	streamName: string;
	rtspUrl: string | null;
	containerIp: string | null;
	status: CameraStatus;
	accessCode: string | null;
	serialNumber: string | null;
	// Bambu model code from SSDP (e.g. 'A1', 'H2C', 'O1C2'). Nullable:
	// null = assume H2C for pre-Phase-18 rows. Mirrors the schema column added
	// in Plan 18-01; used by the Phase 18 A1 branch in configureGo2rtc.
	model: string | null;
	printState: string | null;
	streamMode: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface OnboardingState {
	currentStep: number;
	cameraId: number | null;
	status: CameraStatus;
	error: string | null;
}

export interface StreamInfo {
	active: boolean;
	codec: string | null;
	audioCodec: string | null;
	producers: number;
	resolution: string | null;
	unifiConnected?: boolean;
	unifiStreams?: number;
}

/**
 * Per-model capability matrix (Phase 18 / D-07).
 * Mirrors the server-side `PRINTER_CAPABILITIES` export in
 * `src/lib/server/services/bambu-discovery.ts`. The server attaches this
 * to the Bambu camera payload so the dashboard can gate UI panels without
 * hardcoded model checks.
 */
export interface PrinterCapabilities {
	chamberHeater: boolean;
	ams: 'none' | 'lite' | 'full';
	xcamFeatures: readonly string[];
	cameraResolution: '480p' | '1080p' | '4k';
	cameraTransport: 'rtsps-322' | 'jpeg-tls-6000';
}

export interface CameraCardData {
	// Camera DB info
	id: number;
	vmid: number;
	name: string;
	cameraIp: string;
	cameraType: CameraType;
	containerIp: string | null;
	streamName: string;
	rtspUrl: string | null;
	status: CameraStatus;
	rtspAuthEnabled: boolean;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	// Live status
	containerStatus: ContainerStatus;
	go2rtcRunning: boolean;
	onvifRunning: boolean;
	streamInfo: StreamInfo | null;
	connectedClients: number;
	snapshotUrl: string | null;
	go2rtcWebUrl: string | null;
	cameraWebUrl: string | null;
	cameraModel: string | null;
	firmwareVersion: string | null;
	liveFps: number | null;
	lxcCpu: number | null;
	lxcMemory: { used: number; total: number } | null;
	lxcMac: string | null;
	protectStatus?: ProtectCameraMatch | null;
	protectConfigured?: boolean;
	protectUrl?: string | null;
	flapping?: boolean;
	// Bambu-only — populated when cameraType === 'bambu'
	printState?: string | null;
	streamMode?: string | null;
	bambuError?: string | null;
	bambuMqttConnected?: boolean;
	// Phase 18 / BAMBU-A1-11: capability-gated UI.
	// Present only for Bambu cameras (derived from cameras.model via
	// PRINTER_CAPABILITIES in the /api/cameras/status endpoint).
	capabilities?: PrinterCapabilities;
}

export interface ProtectCamera {
	id: string;
	name: string;
	type: string;
	modelKey: string;
	host: string;
	mac: string;
	state: string;
	isAdopted: boolean;
	isAdopting: boolean;
	isThirdPartyCamera: boolean;
	connectedSince: number;
	lastSeen: number;
	thirdPartyCameraInfo?: {
		port: number;
		rtspUrl: string;
		rtspUrlLQ: string;
		snapshotUrl: string;
	};
}

export interface ProtectCameraMatch {
	protectId: string;
	protectName: string;
	state: string;
	isAdopted: boolean;
	connectedSince: number | null;
	isThirdPartyCamera: boolean;
}

export type EventType = 'camera_disconnect' | 'camera_reconnect' | 'stream_failed' | 'adoption_changed' | 'aiport_error';
export type EventSeverity = 'info' | 'warning' | 'error';
export type EventSource = 'protect_api' | 'ssh_logs' | 'app';

export interface CameraEvent {
	id: number;
	cameraId: number | null;
	cameraName: string | null;
	eventType: EventType;
	severity: EventSeverity;
	message: string;
	source: EventSource;
	timestamp: string;
}

export interface ProtectStatus {
	connected: boolean;
	adoptedCount: number;
	connectedCount: number;
	totalProtectCameras: number;
	cameras: Map<number, ProtectCameraMatch>;
}
